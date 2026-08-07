const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');

let _initialized = false;
function ensureInit() {
  if (!_initialized) {
    admin.initializeApp();
    _initialized = true;
  }
}
function getDb() {
  ensureInit();
  return admin.firestore();
}

// FieldValue (y el resto del namespace admin.firestore.*) solo existe DESPUÉS
// de initializeApp(). Antes, capturarlo en carga de módulo devolvía undefined
// y activateTrial/redeemLicenseKey/resolveTrialExpiry fallaban con
// "Cannot read properties of undefined (reading 'serverTimestamp'|'delete')".
ensureInit();
const FieldValue = admin.firestore.FieldValue;

// Duración de la prueba gratuita (14 días en milisegundos).
const TRIAL_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

// Secretos de Lemon Squeezy
const lemonSqueezyApiKey = defineSecret('LEMON_SQUEEZY_API_KEY');
const lemonSqueezyWebhookSecret = defineSecret('LEMON_SQUEEZY_WEBHOOK_SECRET');
const lemonSqueezySchoolVariantId = defineSecret('LEMON_SQUEEZY_SCHOOL_VARIANT_ID');

const ALLOWED_ORIGINS = [
  'https://ediagil-new-2026.web.app',
  'http://localhost:3000',
  'http://localhost:5173',
];

function setCors(res, req) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  } else {
    res.set('Access-Control-Allow-Origin', 'https://ediagil-new-2026.web.app');
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// C1: la variante 'school' YA NO es una constante hardcodeada (había un
// copy-paste que la hacía idéntica a LEMON_SQUEEZY_STORE_ID). Ahora se lee
// del secret LEMON_SQUEEZY_SCHOOL_VARIANT_ID. Si no está configurada, el
// checkout institucional devuelve un error claro en vez de apuntar a una
// variante inexistente.
const LEMON_SQUEEZY_STORE_ID = '1814001';

function schoolVariantId() {
  const raw = process.env.LEMON_SQUEEZY_SCHOOL_VARIANT_ID || null;
  if (raw === null || typeof raw !== 'string') return null;
  const v = raw.trim();
  if (v.length === 0) return null;
  if (v === LEMON_SQUEEZY_STORE_ID) {
    console.error('⚠️ LEMON_SQUEEZY_SCHOOL_VARIANT_ID no puede ser igual a LEMON_SQUEEZY_STORE_ID');
    return null;
  }
  return v;
}

function planFromVariantId(variantId) {
  const v = String(variantId);
  if (v === '1158973') return 'pro';
  if (v === schoolVariantId()) return 'school';
  return null;
}

// ─── C3: idempotencia del webhook ─────────────────────────────────────────
// Registra los eventId ya procesados en la colección `webhookEvents` para
// que un re-delivery de Lemon Squeezy no vuelva a escribir el perfil del
// usuario (evita sobreescribir planes con eventos viejos).
async function isEventProcessed(eventId) {
  if (!eventId) return false;
  const snap = await getDb().collection('webhookEvents').doc(eventId).get();
  return snap.exists;
}

async function markEventProcessed(eventId) {
  if (!eventId) return;
  await getDb().collection('webhookEvents').doc(eventId).set(
    { processedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

// Guard de orden de eventos: la degradación a 'free' SOLO procede si el
// evento pertenece a la suscripción activa del usuario. Un
// subscription_cancelled/expired reenviado tarde no debe matar una
// suscripción nueva.
async function userStillOnSubscription(uid, subId) {
  if (!uid || !subId) return false;
  const userSnap = await getDb().collection('users').doc(uid).get();
  if (!userSnap.exists) return false;
  const userData = userSnap.data();
  if (userData.subscriptionId && userData.subscriptionId !== subId) {
    console.warn(`⚠️ Webhook de sub ${subId} ignorado: la suscripción activa es ${userData.subscriptionId}`);
    return false;
  }
  return true;
}

// C4: cancelación mantiene el acceso hasta el fin del período pagado
// (ends_at). La degradación real ocurre en subscription_expired.
async function handleSubscriptionCancelled(uid, subId, endsAt) {
  if (!(await userStillOnSubscription(uid, subId))) return false;
  const userSnap = await getDb().collection('users').doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() : {};
  const parsedEnds = endsAt ? Date.parse(endsAt) : NaN;
  const expiresAt = Number.isFinite(parsedEnds) ? parsedEnds : (userData.expiresAt || Date.now());
  await getDb().collection('users').doc(uid).set({
    subscriptionId: subId,
    subscriptionCancelledAt: Date.now(),
    expiresAt,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return true;
}

async function handleSubscriptionExpired(uid, subId) {
  if (!(await userStillOnSubscription(uid, subId))) return false;
  await getDb().collection('users').doc(uid).set({
    plan: 'free',
    subscriptionId: subId,
    subscriptionExpiredAt: Date.now(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return true;
}

// C6: comparación de firma HMAC en tiempo constante.
function signaturesMatch(computed, received) {
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(received, 'hex');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function uidFromCustomData(event) {
  return (
    event.data?.attributes?.checkout_data?.custom?.user_id ||
    event.meta?.custom_data?.user_id ||
    null
  );
}

// Nombre de la institución enviado al crear el checkout (opcional).
// Solo se acepta si es string y ≤ 200 caracteres; en cualquier otro caso null.
function institutionNameFromOrder(event) {
  const raw =
    event.data?.attributes?.checkout_data?.custom?.institutionName ||
    event.meta?.custom_data?.institutionName ||
    null;
  if (raw === null || typeof raw !== 'string') return null;
  const name = raw.trim();
  if (name.length === 0 || name.length > 200) return null;
  return name;
}

function expiresAtFromRenewsAt(renewsAt) {
  if (renewsAt) {
    const ts = Date.parse(renewsAt);
    if (!Number.isNaN(ts)) return ts;
  }
  return Date.now() + 365 * 24 * 60 * 60 * 1000;
}

// ─── Health Check ───────────────────────────────────────────────────────────
exports.health = onRequest((req, res) => {
  setCors(res, req);
  res.json({ ok: true, provider: 'lemon-squeezy' });
});

// ─── Gemini Proxy ─────────────────────────────────────────────────────────

const geminiApiKey = defineSecret('GEMINI_API_KEY');

exports.geminiproxy = onRequest(
  {
    timeoutSeconds: 180,
    memory: '1GiB',
    invoker: 'public',
    secrets: [geminiApiKey],
  },
  async (req, res) => {
    setCors(res, req);
    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }
    if (req.method === 'GET') {
      return res.json({ status: 'ok', message: 'geminiproxy funcionando' });
    }
    try {
      // 1. Validar el token de autenticación de Firebase
      const authHeader = req.headers.authorization || '';
      const idToken = authHeader.replace('Bearer ', '');
      if (!idToken) {
        return res.status(401).json({ error: 'Debes iniciar sesión' });
      }
      ensureInit();
      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;

      // 2. Validar el cuerpo de la solicitud ANTES de reservar cuota
      const apiKey = geminiApiKey.value();
      const { model = 'gemini-2.5-flash', contents, config = {} } = req.body;
      if (!contents) return res.status(400).json({ error: '"contents" requerido' });
      const bodyStr = JSON.stringify(req.body);
      if (bodyStr.length > 10 * 1024 * 1024) {
        return res.status(413).json({ error: 'Solicitud demasiado grande (max 10MB)' });
      }
      let geminiContents;
      if (Array.isArray(contents)) {
        const isConversation = contents.some(c => c.role);
        if (isConversation) {
          geminiContents = contents.map(c => ({ role: c.role || 'user', parts: c.parts || [] }));
        } else {
          const parts = contents.map(c => {
            if (typeof c === 'string') return { text: c };
            if (c.inlineData) return { inlineData: c.inlineData };
            if (c.text) return { text: c.text };
            if (c.parts) return c.parts[0] || { text: '' };
            return { text: JSON.stringify(c) };
          });
          geminiContents = [{ role: 'user', parts }];
        }
      } else if (typeof contents === 'string') {
        geminiContents = [{ role: 'user', parts: [{ text: contents }] }];
      } else {
        geminiContents = [{ role: 'user', parts: contents.parts || [{ text: JSON.stringify(contents) }] }];
      }

      // 3. Reservar cuota de IA de forma ATÓMICA (transacción).
      // Se lee + verifica + incrementa el contador en una sola transacción para
      // evitar que N requests paralelos pasen la verificación antes del primer
      // incremento (race condition H1).
      const userRef = getDb().collection('users').doc(uid);
      const PLAN_LIMITS = {
        free: 15,
        pro: 2000,
        school: 9999
      };
      const oneMonth = 30 * 24 * 60 * 60 * 1000;

      const quota = await getDb().runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        const now = Date.now();
        let userData;
        let needsReset = false;

        if (snap.exists) {
          userData = snap.data();
          const resetAt = userData.aiCallsResetAt || 0;
          needsReset = now - resetAt > oneMonth;
        } else {
          // Primer uso: crear el documento de usuario con plan free
          userData = {
            plan: 'free',
            email: decoded.email || null,
            createdAt: FieldValue.serverTimestamp(),
            aiCallsThisMonth: 0,
            aiCallsResetAt: now
          };
          await tx.set(userRef, userData);
        }

        const plan = userData.plan || 'free';
        // HR-01: si la prueba expiró, tratar al usuario como free a efectos de
        // cuota IA (el plan 'pro' prestado por el trial no debe mantenerse).
        // Un usuario que pagó (paymentProvider != 'trial') nunca se degrada,
        // aunque quede isTrial stale en el doc.
        const paidUser = userData.paymentProvider && userData.paymentProvider !== 'trial';
        const trialActive = userData.isTrial === true
          && typeof userData.trialEndsAt === 'number'
          && userData.trialEndsAt > now;
        let effectivePlan = plan;
        if (!paidUser && userData.isTrial === true && !trialActive) {
          effectivePlan = 'free';
        }
        const limitVal = PLAN_LIMITS[effectivePlan] || 15;
        const aiCallsThisMonth = needsReset ? 0 : (userData.aiCallsThisMonth || 0);

        if (aiCallsThisMonth >= limitVal) {
          return { exceeded: true, limitVal };
        }

        // Reservar el incremento ANTES de llamar a Gemini (evita over-commit).
        // Si la llamada falla, releaseAiCall() lo revierte (max(0)).
        if (needsReset) {
          tx.update(userRef, {
            aiCallsThisMonth: 1,
            aiCallsResetAt: now,
            updatedAt: FieldValue.serverTimestamp()
          });
        } else {
          tx.update(userRef, {
            aiCallsThisMonth: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp()
          });
        }

        return { exceeded: false, limitVal };
      });

      if (quota.exceeded) {
        return res.status(429).json({ error: 'Límite de solicitudes de IA excedido para este mes.' });
      }

      // 4. Procesar llamada a Gemini
      const body = { contents: geminiContents };
      if (config.responseMimeType) body.generationConfig = { responseMimeType: config.responseMimeType };
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      try {
        const geminiRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!geminiRes.ok) {
          const geminiErr = await geminiRes.text();
          console.error('Gemini API error:', geminiErr?.slice(0, 2000));
          await releaseAiCall(uid);
          return res.status(geminiRes.status).json({ error: `Gemini error: ${geminiRes.status}`, details: geminiErr });
        }
        const data = await geminiRes.json();
        const generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return res.json({ text: generatedText });
      } catch (err) {
        await releaseAiCall(uid);
        throw err;
      }
    } catch (err) {
      console.error('❌ geminiproxy error:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Error desconocido' });
    }
  }
);

// Revertir la reserva de cuota IA si la llamada a Gemini falló.
// Se usa una transacción con Math.max(0, ...) para nunca dejar el contador negativo.
async function releaseAiCall(uid) {
  try {
    const userRef = getDb().collection('users').doc(uid);
    await getDb().runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const current = snap.exists ? (snap.data().aiCallsThisMonth || 0) : 0;
      tx.update(userRef, { aiCallsThisMonth: Math.max(0, current - 1) });
    });
  } catch (err) {
    console.warn('⚠️ No se pudo revertir la reserva de cuota IA:', err?.message || err);
  }
}

// ─── Canje de licencia (License Keys) ─────────────────────────────────────
// Flujo legítimo para cambiar el plan: los clientes NO pueden tocar el campo
// `plan` por reglas de Firestore; solo una Cloud Function (que bypassa las
// reglas) puede hacerlo. Las claves se marcan como usadas de forma atómica.
//
// Tipos de clave soportados:
//   'pro'            → plan pro, rol teacher
//   'school'         → plan school, rol teacher (docente institucional)
//   'school_admin'   → plan school, rol admin, vincula institutionId
//   'school_teacher' → plan school, rol teacher, vincula institutionId
exports.redeemLicenseKey = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  }
  const uid = request.auth.uid;
  const key = String((request.data && request.data.key) || '').trim();
  if (!key || key.length > 128) {
    throw new HttpsError('invalid-argument', 'Código inválido o ya usado');
  }

  const keyRef = getDb().collection('licenseKeys').doc(key);

  try {
    const result = await getDb().runTransaction(async (tx) => {
      const snap = await tx.get(keyRef);
      if (!snap.exists || snap.data().used === true) {
        throw new HttpsError('invalid-argument', 'Código inválido o ya usado');
      }
      const keyData = snap.data();
      const keyPlan = keyData.plan;
      const validPlans = ['pro', 'school', 'school_admin', 'school_teacher'];
      if (!validPlans.includes(keyPlan)) {
        throw new HttpsError('invalid-argument', 'Código inválido o ya usado');
      }

      // Marcar la clave como usada
      tx.update(keyRef, {
        used: true,
        usedBy: uid,
        usedAt: FieldValue.serverTimestamp(),
      });

      const userUpdate = {
        paymentProvider: 'licensekey',
        // CR-01: un pago/canje real termina la prueba (limpia estado de trial).
        isTrial: false,
        trialEndsAt: FieldValue.delete(),
        trialStartedAt: FieldValue.delete(),
        // MEDIUM-5: el canje consume el derecho a prueba gratuita.
        trialUsed: true,
        updatedAt: FieldValue.serverTimestamp(),
      };

      let plan = keyPlan;
      let role = 'teacher';

      if (keyPlan === 'pro') {
        plan = 'pro';
        role = 'teacher';
      } else if (keyPlan === 'school') {
        plan = 'school';
        role = 'teacher';
      } else if (keyPlan === 'school_admin') {
        plan = 'school';
        role = 'admin';
        if (keyData.institutionId) userUpdate.institutionId = keyData.institutionId;
        if (keyData.institutionName) userUpdate.institutionName = keyData.institutionName;
      } else if (keyPlan === 'school_teacher') {
        plan = 'school';
        role = 'teacher';
        if (keyData.institutionId) userUpdate.institutionId = keyData.institutionId;
        if (keyData.institutionName) userUpdate.institutionName = keyData.institutionName;
      }

      userUpdate.plan = plan;
      userUpdate.role = role;

      // Aplicar el plan y el rol al usuario (única vía legítima de cambio)
      tx.set(getDb().collection('users').doc(uid), userUpdate, { merge: true });

      return { plan, role };
    });

    const message = result.role === 'admin'
      ? 'Licencia Institucional activada. Acceso de administrador habilitado.'
      : result.plan === 'school'
        ? 'Licencia Institucional activada correctamente.'
        : 'Licencia Pro activada correctamente.';
    return { success: true, plan: result.plan, role: result.role, message };
  } catch (err) {
    if (err && err.code && (err.code === 'invalid-argument' || err.code === 'unauthenticated')) {
      throw err;
    }
    console.error('❌ redeemLicenseKey error:', err?.message || err);
    throw new HttpsError('internal', 'Error al canjear el código. Intenta de nuevo.');
  }
});

// ─── Prueba gratuita (Demo real) ──────────────────────────────────────────
// Activa la prueba Pro de 14 días SIN tarjeta de crédito. Es idempotente: si
// el usuario ya tiene una prueba activa devuelve la existente sin extenderla.
exports.activateTrial = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  }
  const uid = request.auth.uid;

  const userRef = getDb().collection('users').doc(uid);

  try {
    const result = await getDb().runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const userData = snap.exists ? snap.data() : {};
      const now = Date.now();

      // Prueba ya activa y vigente → devolver sin extender.
      if (userData.isTrial === true && userData.trialEndsAt > now) {
        return { ok: true, trialEndsAt: userData.trialEndsAt, alreadyActive: true };
      }

      // HIGH-2: usuario que pagó/canjeó una licencia nunca puede activar la
      // prueba (evita que la race pago↔trial deje el plan 'pro' como trial y
      // sea degradado al expirar). La transacción asegura consistencia.
      if (userData.paymentProvider && userData.paymentProvider !== 'trial') {
        throw new HttpsError('failed-precondition', 'Ya tienes un plan activo');
      }

      // LOW-8: la prueba ya se usó antes → mensaje claro, incluso si el plan
      // sigue siendo 'pro' por un trial expirado sin resolver. Debe ir ANTES
      // del guard de plan para no mostrar "Ya tienes un plan activo".
      if (userData.trialUsed === true) {
        throw new HttpsError('already-exists', 'Ya usaste tu prueba gratuita');
      }

      // Plan de pago activo → no se puede activar la prueba encima.
      if (userData.plan === 'pro' || userData.plan === 'school') {
        throw new HttpsError('failed-precondition', 'Ya tienes un plan activo');
      }

      const trialEndsAt = now + TRIAL_DAYS_MS;
      tx.set(userRef, {
        plan: 'pro',
        isTrial: true,
        paymentProvider: 'trial',
        trialStartedAt: now,
        trialEndsAt,
        trialUsed: true,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return { ok: true, trialEndsAt };
    });
    return result;
  } catch (err) {
    if (err && err.code && ['unauthenticated', 'failed-precondition', 'already-exists'].includes(err.code)) {
      throw err;
    }
    console.error('❌ activateTrial error:', err?.message || err);
    // TEMP-DEBUG: diagnóstico del worker del emulador
    console.error('TEMP-DEBUG admin.firestore.FieldValue =', typeof admin.firestore?.FieldValue, '| FieldValue =', typeof FieldValue, '| apps =', admin.apps?.length);
    throw new HttpsError('internal', 'Error al activar la prueba. Intenta de nuevo.');
  }
});

// Comprueba si la prueba gratuita del usuario ya expiró y, en ese caso, la
// degrada a 'free' dentro de una transacción para evitar condiciones de carrera.
exports.resolveTrialExpiry = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  }
  const uid = request.auth.uid;

  const userRef = getDb().collection('users').doc(uid);

  const result = await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const userData = snap.exists ? snap.data() : {};
    const plan = userData.plan || 'free';

    if (userData.isTrial !== true) {
      return { ok: true, plan };
    }

    // CR-01: un usuario que ya pagó (order_created / subscription_created /
    // subscription_updated / redeemLicenseKey) NUNCA debe ser degradado por la
    // expiración del trial. La presencia de paymentProvider lo marca como pagado.
    if (userData.paymentProvider && userData.paymentProvider !== 'trial') {
      return { ok: true, plan };
    }

    const trialEndsAt = userData.trialEndsAt;
    if (typeof trialEndsAt === 'number' && trialEndsAt <= Date.now()) {
      // La prueba terminó → degradar a plan free manteniendo trialUsed.
      tx.set(userRef, {
        plan: 'free',
        isTrial: false,
        trialUsed: true,
        // LOW-7: limpiar campos stale del trial.
        paymentProvider: FieldValue.delete(),
        trialEndsAt: FieldValue.delete(),
        trialStartedAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { ok: true, plan: 'free' };
    }

    return { ok: true, plan, trialEndsAt };
  });

  return result;
});

// ─── Utilidades de administrador institucional ────────────────────────────

// Determina el rol del usuario actual leyendo su doc de perfil.
// Devuelve 'admin', 'teacher' o null (si no se pudo determinar).
async function getUserRole(uid) {
  const snap = await getDb().collection('users').doc(uid).get();
  if (!snap.exists) return null;
  return snap.data().role || 'teacher';
}

// Verifica que el usuario autenticado sea administrador institucional.
async function assertAdmin(uid) {
  const role = await getUserRole(uid);
  if (role !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo administradores institucionales pueden realizar esta acción.');
  }
  return role;
}

// Lee TODOS los documentos de una colección para un usuario, paginando
// por __name__ para evitar el límite de 500 por query de Firestore.
async function getAllDocsForUser(colName, userId) {
  const all = [];
  let last = null;
  for (;;) {
    let q = getDb().collection(colName).where('userId', '==', userId).orderBy('__name__', 'asc').limit(1000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.docs.length === 0) break;
    snap.docs.forEach(d => all.push({ id: d.id, ...d.data() }));
    last = snap.docs[snap.docs.length - 1];
  }
  return all;
}

// Resumen de cuentas docentes de la institución del administrador.
exports.adminListTeachers = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  }
  const uid = request.auth.uid;
  await assertAdmin(uid);

  const adminSnap = await getDb().collection('users').doc(uid).get();
  const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;
  if (!adminInstitutionId) {
    throw new HttpsError('failed-precondition', 'Tu cuenta de administrador no tiene una institución asignada.');
  }

  const teachersSnap = await getDb()
    .collection('users')
    .where('institutionId', '==', adminInstitutionId)
    .get();

  const teachers = [];

  for (const docSnap of teachersSnap.docs) {
    const teacherData = docSnap.data();
    const teacherUid = docSnap.id;

    // El propio admin no aparece en su lista
    if (teacherUid === uid) continue;

    const role = teacherData.role || 'teacher';
    if (role === 'admin') continue; // no listar otros admins

    const [subjects, students, evaluations, attendanceSessions, grades] = await Promise.all([
      getAllDocsForUser('subjects', teacherUid),
      getAllDocsForUser('students', teacherUid),
      getAllDocsForUser('evaluations', teacherUid),
      getAllDocsForUser('attendance', teacherUid),
      getAllDocsForUser('grades', teacherUid),
    ]);

    const lastActivity = teacherData.lastLoginAt || teacherData.updatedAt || null;

    teachers.push({
      uid: teacherUid,
      email: teacherData.email || '',
      displayName: teacherData.displayName || teacherData.email?.split('@')[0] || 'Docente',
      photoURL: teacherData.photoURL || null,
      plan: teacherData.plan || 'free',
      createdAt: teacherData.createdAt || null,
      lastActivity,
      counts: {
        subjects: subjects.length,
        students: students.length,
        evaluations: evaluations.length,
        grades: grades.length,
        attendance: attendanceSessions.length,
      },
    });
  }

  teachers.sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''), 'es'));

  return { institutionId: adminInstitutionId, teachers };
});

// Datos completos de un docente para generar el reporte Excel igual al suyo.
exports.adminGetTeacherData = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  }
  const uid = request.auth.uid;
  await assertAdmin(uid);

  const teacherUid = request.data && request.data.teacherUid;
  if (!teacherUid || typeof teacherUid !== 'string') {
    throw new HttpsError('invalid-argument', 'Falta teacherUid');
  }

  const adminSnap = await getDb().collection('users').doc(uid).get();
  const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;

  const teacherSnap = await getDb().collection('users').doc(teacherUid).get();
  if (!teacherSnap.exists) {
    throw new HttpsError('not-found', 'Docente no encontrado');
  }
  const teacherData = teacherSnap.data();
  if (!adminInstitutionId || teacherData.institutionId !== adminInstitutionId) {
    throw new HttpsError('permission-denied', 'Este docente no pertenece a tu institución.');
  }

  // Configuración de calificación del docente (ponderaciones, escala, etc.)
  let settings = {};
  const settingsSnap = await getDb().collection('userSettings').doc(teacherUid).get();
  if (settingsSnap.exists) settings = settingsSnap.data();

  const subjects = await getAllDocsForUser('subjects', teacherUid);

  const subjectData = await Promise.all(subjects.map(async (sub) => {
    const [students, subjectModules, evaluations, grades, attendance, notes, materials, calendarEvents] = await Promise.all([
      getAllDocsForUserBySubject('students', teacherUid, sub.id),
      getAllDocsForUserBySubject('subjectModules', teacherUid, sub.id),
      getAllDocsForUserBySubject('evaluations', teacherUid, sub.id),
      getAllDocsForUserBySubject('grades', teacherUid, sub.id),
      getAllDocsForUserBySubject('attendance', teacherUid, sub.id),
      getAllDocsForUserBySubject('notes', teacherUid, sub.id),
      getAllDocsForUserBySubject('materials', teacherUid, sub.id),
      getAllDocsForUserBySubject('calendarEvents', teacherUid, sub.id),
    ]);
    return {
      ...sub,
      students,
      subjectModules,
      evaluations,
      grades,
      attendance,
      notes,
      materials,
      calendarEvents,
    };
  }));

  return {
    teacher: {
      uid: teacherUid,
      email: teacherData.email || '',
      displayName: teacherData.displayName || teacherData.email?.split('@')[0] || 'Docente',
      institutionId: teacherData.institutionId,
      institutionName: teacherData.institutionName || '',
    },
    settings,
    subjects: subjectData,
  };
});

// Datos resumidos de un docente para el panel administrativo: las mismas
// colecciones que adminGetTeacherData pero sin contenido pesado (notes.content,
// materials.attachment), suficiente para resúmenes, calendario y tabs.
exports.adminGetTeacherSummary = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  }
  const uid = request.auth.uid;
  await assertAdmin(uid);

  const teacherUid = request.data && request.data.teacherUid;
  if (!teacherUid || typeof teacherUid !== 'string') {
    throw new HttpsError('invalid-argument', 'Falta teacherUid');
  }

  const adminSnap = await getDb().collection('users').doc(uid).get();
  const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;

  const teacherSnap = await getDb().collection('users').doc(teacherUid).get();
  if (!teacherSnap.exists) {
    throw new HttpsError('not-found', 'Docente no encontrado');
  }
  const teacherData = teacherSnap.data();
  if (!adminInstitutionId || teacherData.institutionId !== adminInstitutionId) {
    throw new HttpsError('permission-denied', 'Este docente no pertenece a tu institución.');
  }

  let settings = {};
  const settingsSnap = await getDb().collection('userSettings').doc(teacherUid).get();
  if (settingsSnap.exists) settings = settingsSnap.data();

  const subjects = await getAllDocsForUser('subjects', teacherUid);

  const subjectData = await Promise.all(subjects.map(async (sub) => {
    const [students, subjectModules, evaluations, grades, attendance, notes, materials, calendarEvents] = await Promise.all([
      getAllDocsForUserBySubject('students', teacherUid, sub.id),
      getAllDocsForUserBySubject('subjectModules', teacherUid, sub.id),
      getAllDocsForUserBySubject('evaluations', teacherUid, sub.id),
      getAllDocsForUserBySubject('grades', teacherUid, sub.id),
      getAllDocsForUserBySubject('attendance', teacherUid, sub.id),
      getAllDocsForUserBySubject('notes', teacherUid, sub.id),
      getAllDocsForUserBySubject('materials', teacherUid, sub.id),
      getAllDocsForUserBySubject('calendarEvents', teacherUid, sub.id),
    ]);
    return {
      ...sub,
      students,
      subjectModules,
      evaluations,
      grades,
      attendance,
      // Sin contenido pesado: solo conteo + metadatos de fechas/títulos
      notes: notes.map(n => ({ id: n.id, title: n.title, date: n.date, createdAt: n.createdAt, updatedAt: n.updatedAt })),
      noteCount: notes.length,
      materials: materials.map(m => ({
        id: m.id,
        title: m.title,
        type: m.type,
        date: m.date,
        startTime: m.startTime,
        endTime: m.endTime,
        moduleId: m.moduleId,
        description: m.description,
      })),
      calendarEvents,
    };
  }));

  return {
    teacher: {
      uid: teacherUid,
      email: teacherData.email || '',
      displayName: teacherData.displayName || teacherData.email?.split('@')[0] || 'Docente',
      institutionId: teacherData.institutionId,
      institutionName: teacherData.institutionName || '',
    },
    settings,
    subjects: subjectData,
  };
});

async function getAllDocsForUserBySubject(colName, userId, subjectId) {
  const all = [];
  let last = null;
  for (;;) {
    let q = getDb().collection(colName)
      .where('userId', '==', userId)
      .where('subjectId', '==', subjectId)
      .orderBy('__name__', 'asc')
      .limit(1000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.docs.length === 0) break;
    snap.docs.forEach(d => all.push({ id: d.id, ...d.data() }));
    last = snap.docs[snap.docs.length - 1];
  }
  return all;
}

// ─── 1. Crear checkout de Lemon Squeezy ──────────────────────────────────
exports.createLemonSqueezyCheckout = onRequest(
  {
    invoker: 'public',
    secrets: [lemonSqueezyApiKey, lemonSqueezySchoolVariantId],
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    setCors(res, req);
    if (req.method === 'OPTIONS') {
      return res.status(204).send('');
    }
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');

    try {
      const authHeader = req.headers.authorization || '';
      const idToken = authHeader.replace('Bearer ', '');
      if (!idToken) {
        return res.status(401).json({ error: 'Debes iniciar sesión' });
      }
      ensureInit();
      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;
      const email = decoded.email || '';

      const { plan, institutionName } = req.body; // 'pro' o 'school'
      if (!plan || (plan !== 'pro' && plan !== 'school')) {
        return res.status(400).json({ error: 'Plan inválido' });
      }
      if (institutionName !== undefined && (typeof institutionName !== 'string' || institutionName.length > 200)) {
        return res.status(400).json({ error: 'institutionName inválido (debe ser texto de máximo 200 caracteres)' });
      }

      const variantId = plan === 'pro'
        ? '1158973'
        : schoolVariantId();
      if (!variantId) {
        return res.status(503).json({ error: 'El plan institucional no está disponible todavía. Configura LEMON_SQUEEZY_SCHOOL_VARIANT_ID.' });
      }
      const APP_URL = process.env.APP_URL || 'https://ediagil-new-2026.web.app';

      const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${lemonSqueezyApiKey.value()}`,
        },
        body: JSON.stringify({
          data: {
            type: 'checkouts',
            attributes: {
              checkout_data: {
                email: email,
                custom: { user_id: uid, ...(institutionName ? { institutionName } : {}) },
              },
              product_options: {
                redirect_url: `${APP_URL}/settings?checkout=success&plan=${plan}`,
              },
              expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
            },
            relationships: {
              store: {
                data: {
                  type: 'stores',
                  id: LEMON_SQUEEZY_STORE_ID,
                },
              },
              variant: {
                data: {
                  type: 'variants',
                  id: variantId,
                },
              },
            },
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('Lemon Squeezy error:', data);
        throw new Error(data.errors?.[0]?.detail || 'Error creando checkout');
      }

      const checkoutUrl = data.data.attributes.url;
      return res.json({ url: checkoutUrl });
    } catch (err) {
      console.error('❌ createLemonSqueezyCheckout error:', err.message);
      return res.status(500).json({ error: err.message || 'Error al crear el enlace de pago' });
    }
  }
);

// ─── 2. Webhook de Lemon Squeezy (ESTA ES LA QUE FALTA) ──────────────────
exports.lemonSqueezyWebhook = onRequest(
  {
    timeoutSeconds: 30,
    memory: '256MiB',
    invoker: 'public',
    secrets: [lemonSqueezyWebhookSecret, lemonSqueezySchoolVariantId],
  },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');

    try {
      const secret = lemonSqueezyWebhookSecret.value();
      const signature = req.headers['x-signature'];

      if (!secret || !signature) {
        console.warn('⚠️ Lemon Squeezy webhook: missing signature or secret');
        return res.status(401).send('Unauthorized');
      }

      // Verificar firma HMAC-SHA256 con el body crudo (rawBody)
      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(rawBody);
      const computedSignature = hmac.digest('hex');

      if (!signaturesMatch(computedSignature, signature)) {
        console.warn('⚠️ Lemon Squeezy webhook: invalid signature');
        return res.status(401).send('Invalid signature');
      }

      const event = req.body;
      const eventName = event.meta?.event_name;
      const eventId = event.data?.id;
      console.log(`📬 Lemon Squeezy event: ${eventName} (${eventId})`);

      // C3: idempotencia — si ya procesamos este evento, no reprocesar
      // (protege de re-deliveries que sobreescriban el plan actual).
      if (await isEventProcessed(eventId)) {
        console.log(`🔁 Evento ${eventId} ya procesado, omitido`);
        return res.json({ received: true, duplicate: true });
      }

      if (eventName === 'order_created') {
        const order = event.data;
        const customData = order.attributes?.checkout_data?.custom || {};
        const uid = customData.user_id;
        const variantId = order.relationships?.variant?.data?.id;
        const plan = planFromVariantId(variantId);

        if (uid && plan) {
          const expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000; // 1 año
          const institutionName = institutionNameFromOrder(event);
          await getDb().collection('users').doc(uid).set({
            plan,
            paymentProvider: 'lemonsqueezy',
            paymentOrderId: order.id,
            expiresAt,
            // CR-01: el pago real termina la prueba.
            isTrial: false,
            trialEndsAt: FieldValue.delete(),
            trialStartedAt: FieldValue.delete(),
            // MEDIUM-5: el pago consume el derecho a prueba gratuita.
            trialUsed: true,
            ...(plan === 'school' ? { role: 'admin', institutionId: uid } : {}),
            ...(plan === 'school' && institutionName ? { institutionName } : {}),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          console.log(`✅ Plan actualizado para ${uid} → ${plan}`);
        } else {
          console.warn('⚠️ No se pudo identificar usuario o plan en el webhook');
        }
      } else if (eventName === 'subscription_created') {
        const sub = event.data;
        const uid = uidFromCustomData(event);
        const plan = planFromVariantId(sub.relationships?.variant?.data?.id);
        if (uid && plan) {
          const institutionName = institutionNameFromOrder(event);
          await getDb().collection('users').doc(uid).set({
            plan,
            paymentProvider: 'lemonsqueezy',
            subscriptionId: sub.id,
            expiresAt: expiresAtFromRenewsAt(sub.attributes?.renews_at),
            // CR-01: el pago real termina la prueba.
            isTrial: false,
            trialEndsAt: FieldValue.delete(),
            trialStartedAt: FieldValue.delete(),
            // MEDIUM-5: el pago consume el derecho a prueba gratuita.
            trialUsed: true,
            ...(plan === 'school' ? { role: 'admin', institutionId: uid } : {}),
            ...(plan === 'school' && institutionName ? { institutionName } : {}),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          console.log(`✅ Suscripción creada para ${uid} → ${plan}`);
        } else {
          console.warn('⚠️ No se pudo identificar usuario o plan en subscription_created');
        }
      } else if (eventName === 'subscription_updated') {
        const sub = event.data;
        const status = sub.attributes?.status;
        const uid = uidFromCustomData(event);
        if (status === 'cancelled') {
          if (uid) {
            const ok = await handleSubscriptionCancelled(uid, sub.id, sub.attributes?.ends_at);
            console.log(`✅ Suscripción ${status} para ${uid} → mantiene acceso hasta fin de período`);
            if (!ok) console.warn(`⚠️ subscription_updated(${status}) ignorado para ${uid}`);
          }
        } else if (status === 'expired') {
          if (uid) {
            const ok = await handleSubscriptionExpired(uid, sub.id);
            console.log(`✅ Suscripción ${status} para ${uid} → plan free`);
            if (!ok) console.warn(`⚠️ subscription_updated(${status}) ignorado para ${uid}`);
          }
        } else if (status === 'active' && uid) {
          const plan = planFromVariantId(sub.relationships?.variant?.data?.id);
          if (plan) {
            const institutionName = institutionNameFromOrder(event);
            // Si es plan institucional: garantizar rol admin SIN sobrescribir
            // institutionId/institutionName existentes.
            const existingSnap = await getDb().collection('users').doc(uid).get();
            const existing = existingSnap.exists ? existingSnap.data() : {};
            // Compra de plan school => rol admin SIEMPRE (consistente con
            // order_created/subscription_created), preservando institutionId/institutionName.
            const applySchoolAdmin = plan === 'school';
            await getDb().collection('users').doc(uid).set({
              plan,
              paymentProvider: 'lemonsqueezy',
              subscriptionId: sub.id,
              expiresAt: expiresAtFromRenewsAt(sub.attributes?.renews_at),
              // CR-01: el pago real termina la prueba.
              isTrial: false,
              trialEndsAt: FieldValue.delete(),
              trialStartedAt: FieldValue.delete(),
              // MEDIUM-5: el pago consume el derecho a prueba gratuita.
              trialUsed: true,
              ...(applySchoolAdmin
                ? { role: 'admin', institutionId: existing.institutionId || uid }
                : {}),
              ...(applySchoolAdmin && institutionName && !existing.institutionName
                ? { institutionName }
                : {}),
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            console.log(`✅ Suscripción reactivada para ${uid} → ${plan}`);
          }
        }
      } else if (eventName === 'subscription_cancelled') {
        const sub = event.data;
        const uid = uidFromCustomData(event);
        if (uid) {
          const ok = await handleSubscriptionCancelled(uid, sub.id, sub.attributes?.ends_at);
          console.log(`✅ subscription_cancelled para ${uid} → mantiene acceso hasta fin de período`);
          if (!ok) console.warn(`⚠️ subscription_cancelled ignorado para ${uid}`);
        }
      } else if (eventName === 'subscription_expired') {
        const sub = event.data;
        const uid = uidFromCustomData(event);
        if (uid) {
          const ok = await handleSubscriptionExpired(uid, sub.id);
          console.log(`✅ subscription_expired para ${uid} → plan free`);
          if (!ok) console.warn(`⚠️ subscription_expired ignorado para ${uid}`);
        }
      } else if (eventName === 'subscription_payment_success') {
        const sub = event.data;
        const uid = uidFromCustomData(event);
        if (uid) {
          await getDb().collection('users').doc(uid).set({
            expiresAt: expiresAtFromRenewsAt(sub.attributes?.renews_at),
            subscriptionId: sub.id,
            // MEDIUM-4: un pago real marca al usuario como pagador y termina la
            // prueba (consistente con los demás paths de pago).
            paymentProvider: 'lemonsqueezy',
            isTrial: false,
            trialEndsAt: FieldValue.delete(),
            trialStartedAt: FieldValue.delete(),
            // MEDIUM-5: el pago consume el derecho a prueba gratuita.
            trialUsed: true,
            lastPaymentAt: Date.now(),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          console.log(`✅ Pago de suscripción recibido para ${uid}`);
        }
      }

      await markEventProcessed(eventId);
      return res.json({ received: true });
    } catch (err) {
      console.error('❌ Lemon Squeezy webhook error:', err.message);
      return res.status(500).json({ error: err.message || 'Internal error' });
    }
  }
);

// ─── 3. Customer Portal de Lemon Squeezy ──────────────────────────────────
exports.createCustomerPortal = onRequest(
  {
    invoker: 'public',
    secrets: [lemonSqueezyApiKey],
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    setCors(res, req);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');

    try {
      const authHeader = req.headers.authorization || '';
      const idToken = authHeader.replace('Bearer ', '');
      if (!idToken) return res.status(401).json({ error: 'Debes iniciar sesión' });
      ensureInit();
      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;

      const userRef = getDb().collection('users').doc(uid);
      const userSnap = await userRef.get();
      const userData = userSnap.exists ? userSnap.data() : {};
      const subscriptionId = userData.subscriptionId;

      if (!subscriptionId) {
        return res.status(404).json({ error: 'No tienes una suscripción activa' });
      }

      // C2: la API oficial de Lemon Squeezy NO tiene POST /v1/customer-portals.
      // El portal se obtiene de la URL firmada `urls.customer_portal` de la
      // propia suscripción.
      const response = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${subscriptionId}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${lemonSqueezyApiKey.value()}`,
        },
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('Lemon Squeezy subscription error:', data);
        throw new Error(data.errors?.[0]?.detail || 'Error obteniendo tu suscripción');
      }

      const portalUrl = data.data?.attributes?.urls?.customer_portal;
      if (!portalUrl) {
        return res.status(404).json({ error: 'No encontramos un portal de gestión para tu suscripción' });
      }

      return res.json({ url: portalUrl });
    } catch (err) {
      console.error('❌ createCustomerPortal error:', err.message);
      return res.status(500).json({ error: err.message || 'Error al abrir el portal' });
    }
  }
);

// ─── 4. Configurar productos (ejecutar una sola vez) ──────────────────────
exports.setupLemonSqueezyProducts = onRequest(
  {
    invoker: 'public',
    secrets: [lemonSqueezyApiKey],
  },
  async (req, res) => {
    setCors(res, req);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).send('Method not allowed');

    try {
      const storeId = LEMON_SQUEEZY_STORE_ID;
      const schoolVariant = schoolVariantId();
      return res.json({ 
        ok: true, 
        message: 'Crea tus productos manualmente en Lemon Squeezy. La variante Pro (1158973) es constante; la variante School se lee del secret LEMON_SQUEEZY_SCHOOL_VARIANT_ID.',
        storeId: storeId || 'No definido',
        schoolVariantConfigured: Boolean(schoolVariant),
      });
    } catch (err) {
      console.error('❌ setupLemonSqueezyProducts error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }
);
