const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
require('firebase-admin/firestore');
require('firebase-admin/auth');
const crypto = require('crypto');

const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

let _initialized = false;
function ensureInit() {
  if (!_initialized) {
    admin.initializeApp();
    _initialized = true;
  }
}
function getDb() {
  ensureInit();
  return getFirestore();
}
function getAuthInstance() {
  ensureInit();
  return getAuth();
}

// FieldValue lazy getter - ensures Firebase Admin is initialized first
let _fieldValue = null;
function getFieldValue() {
  if (!_fieldValue) {
    ensureInit();
    _fieldValue = require('firebase-admin/firestore').FieldValue;
  }
  return _fieldValue;
}

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
    { processedAt: getFieldValue().serverTimestamp() },
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
  if (userData.subscriptionId && String(userData.subscriptionId) !== String(subId)) {
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
    updatedAt: getFieldValue().serverTimestamp(),
  }, { merge: true });
  return true;
}

async function handleSubscriptionExpired(uid, subId) {
  if (!(await userStillOnSubscription(uid, subId))) return false;
  await getDb().collection('users').doc(uid).set({
    plan: 'free',
    subscriptionId: subId,
    subscriptionExpiredAt: Date.now(),
    updatedAt: getFieldValue().serverTimestamp(),
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
      const decoded = await getAuthInstance().verifyIdToken(idToken);
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
            createdAt: getFieldValue().serverTimestamp(),
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
            updatedAt: getFieldValue().serverTimestamp()
          });
        } else {
          tx.update(userRef, {
            aiCallsThisMonth: getFieldValue().increment(1),
            updatedAt: getFieldValue().serverTimestamp()
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
    const snap = await keyRef.get();
    if (!snap.exists || snap.data().used === true) {
      throw new HttpsError('invalid-argument', 'Código inválido o ya usado');
    }
    const keyData = snap.data();
    const keyPlan = keyData.plan;
    const validPlans = ['pro', 'school', 'school_admin', 'school_teacher'];
    if (!validPlans.includes(keyPlan)) {
      throw new HttpsError('invalid-argument', 'Código inválido o ya usado');
    }

    let plan = keyPlan;
    let role = 'teacher';
    let keyInstitutionId = null;

    if (keyPlan === 'school_admin' || keyPlan === 'school_teacher') {
      plan = 'school';
      role = keyPlan === 'school_admin' ? 'admin' : 'teacher';
      keyInstitutionId = String(keyData.institutionId || '').trim();
      if (!keyInstitutionId) {
        throw new HttpsError('invalid-argument', 'Este código no tiene una institución asignada. Contacta al soporte.');
      }
    } else if (keyPlan === 'school') {
      plan = 'school';
      role = 'teacher';
      keyInstitutionId = String(keyData.institutionId || '').trim() || null;
    }

    // 1. Verifica que institutions/{institutionId} exista si la licencia especifica institución
    if (keyInstitutionId) {
      const instRef = getDb().collection('institutions').doc(keyInstitutionId);
      const instSnap = await instRef.get();
      if (!instSnap.exists) {
        throw new HttpsError('failed-precondition', 'La institución asociada a este código ya no existe. Contacta al soporte.');
      }
      const userSnap = await getDb().collection('users').doc(uid).get();
      const existingInstitutionId = userSnap.exists ? userSnap.data().institutionId : null;
      if (existingInstitutionId && existingInstitutionId !== keyInstitutionId) {
        throw new HttpsError('failed-precondition', 'Tu cuenta ya pertenece a otra institución.');
      }
    }

    // 4. Usa batch write
    const batch = getDb().batch();

    // Marcar la clave como usada
    batch.update(keyRef, {
      used: true,
      usedBy: uid,
      usedAt: getFieldValue().serverTimestamp(),
    });

    const userUpdate = {
      plan,
      role,
      paymentProvider: 'licensekey',
      // CR-01: un pago/canje real termina la prueba (limpia estado de trial).
      isTrial: false,
      trialEndsAt: getFieldValue().delete(),
      trialStartedAt: getFieldValue().delete(),
      // MEDIUM-5: el canje consume el derecho a prueba gratuita.
      trialUsed: true,
      updatedAt: getFieldValue().serverTimestamp(),
    };

    if (keyInstitutionId) {
      userUpdate.institutionId = keyInstitutionId;
      if (keyData.institutionName) userUpdate.institutionName = keyData.institutionName;

      // 3. Crea/actualiza institutionUsers/{uid} con userId, institutionId y role
      const instUserRef = getDb().collection('institutionUsers').doc(uid);
      batch.set(instUserRef, {
        userId: uid,
        institutionId: keyInstitutionId,
        role,
        joinedAt: getFieldValue().serverTimestamp(),
      }, { merge: true });
    }

    // 2. Actualiza users/{uid} con role e institutionId
    const userRef = getDb().collection('users').doc(uid);
    batch.set(userRef, userUpdate, { merge: true });

    await batch.commit();

    const message = role === 'admin'
      ? 'Licencia Institucional activada. Acceso de administrador habilitado.'
      : plan === 'school'
        ? 'Licencia Institucional activada correctamente.'
        : 'Licencia Pro activada correctamente.';
    return { success: true, plan, role, message };
  } catch (err) {
    if (err instanceof HttpsError || (err && err.code && ['invalid-argument', 'unauthenticated', 'failed-precondition', 'not-found', 'already-exists'].includes(err.code))) {
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
        updatedAt: getFieldValue().serverTimestamp(),
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
        paymentProvider: getFieldValue().delete(),
        trialEndsAt: getFieldValue().delete(),
        trialStartedAt: getFieldValue().delete(),
        updatedAt: getFieldValue().serverTimestamp(),
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

// ─── Sprint 4: Métricas Institucionales (KPIs, tendencias, distribución, retención) ────────────────
exports.getInstitutionalMetrics = onCall({ timeoutSeconds: 120, memory: '1GiB' }, async (request) => {
  const { calculateStudentRisk, generateRecommendations } = require('./lib/risk-calculator');
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  const uid = request.auth.uid;
  await assertAdmin(uid);

  const adminSnap = await getDb().collection('users').doc(uid).get();
  const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;
  if (!adminInstitutionId) {
    throw new HttpsError('failed-precondition', 'Tu cuenta de administrador no tiene una institución asignada.');
  }

  const turno = parseTurnoFilter(request.data);
  const nivel = parseNivelFilter(request.data);

  const rows = await loadInstitutionData(adminInstitutionId);
  const subjectMeta = new Map(); // subjectId → { name, periodo, nivelEducativo, userId }
  const teacherNameById = new Map();
  for (const { teacher, subjects, students } of rows) {
    teacherNameById.set(teacher.uid, teacher.displayName || (teacher.email || '').split('@')[0] || 'Docente');
    for (const sub of subjects) {
      if (!subjectMatchesFilters(sub, turno, nivel)) continue;
      subjectMeta.set(sub.id, {
        name: sub.name || 'Sin nombre',
        periodo: sub.periodo || null,
        nivelEducativo: sub.nivelEducativo || null,
        userId: teacher.uid,
      });
    }
  }
  const subjectIds = new Set(subjectMeta.keys());
  const studentsAll = [];
  for (const { students } of rows) {
    for (const s of students) if (subjectIds.has(s.subjectId)) studentsAll.push(s);
  }

  // Evaluaciones / notas / asistencia de las asignaturas que matchean los filtros.
  const teacherUids = Array.from(new Set(rows.map((r) => r.teacher.uid)));
  const bySubject = (arr) => (arr || []).filter((x) => subjectIds.has(x.subjectId));
  const loaded = await Promise.allSettled(teacherUids.map(async (teacherUid) => {
    const [evaluations, grades, attendance] = await Promise.all([
      getAllDocsForUser('evaluations', teacherUid),
      getAllDocsForUser('grades', teacherUid),
      getAllDocsForUser('attendance', teacherUid),
    ]);
    return { evaluations: bySubject(evaluations), grades: bySubject(grades), attendance: bySubject(attendance) };
  }));
  const evalsAll = [];
  const gradesAll = [];
  const attendanceAll = [];
  for (const r of loaded) {
    if (r.status !== 'fulfilled') continue;
    evalsAll.push(...r.value.evaluations);
    gradesAll.push(...r.value.grades);
    attendanceAll.push(...r.value.attendance);
  }

  // Asistencia global + por turno + por nivel educativo.
  const attByTurno = {
    matutino: { present: 0, total: 0 },
    vespertino: { present: 0, total: 0 },
    nocturno: { present: 0, total: 0 },
  };
  const attByGrado = new Map(); // nivelEducativo → { present, total }
  const attGlobal = { present: 0, total: 0 };
  for (const a of attendanceAll) {
    const meta = subjectMeta.get(a.subjectId);
    const isPresent = (a.status || 'present') === 'present';
    attGlobal.total += 1;
    if (isPresent) attGlobal.present += 1;
    const turnoKey = meta && meta.periodo && attByTurno[meta.periodo] ? meta.periodo : null;
    if (turnoKey) {
      attByTurno[turnoKey].total += 1;
      if (isPresent) attByTurno[turnoKey].present += 1;
    }
    const gKey = meta && meta.nivelEducativo ? meta.nivelEducativo : 'sin-nivel';
    if (!attByGrado.has(gKey)) attByGrado.set(gKey, { present: 0, total: 0 });
    attByGrado.get(gKey).total += 1;
    if (isPresent) attByGrado.get(gKey).present += 1;
  }
  const pctOf = (present, total) => (total > 0 ? Math.round((present / total) * 1000) / 10 : null);

  // Promedio general de notas (0-100 normalizado por maxScore).
  const maxScoreByEval = new Map(evalsAll.map((e) => [e.id, Number(e.maxScore) || 0]));
  let gradeSum = 0;
  let gradeCount = 0;
  for (const g of gradesAll) {
    const max = maxScoreByEval.get(g.evaluationId);
    const score = Number(g.score);
    if (max && max > 0 && Number.isFinite(score)) {
      gradeSum += (score / max) * 100;
      gradeCount += 1;
    }
  }

  // Riesgo por persona (consolidada por cédula/nombre) × asignatura.
  const byPerson = new Map();
  for (const s of studentsAll) {
    const key = String(s.cedula || '').trim() || `${normText(s.firstName)}|${normText(s.lastName)}`;
    if (!byPerson.has(key)) {
      byPerson.set(key, { studentId: s.id, cedula: s.cedula || '', firstName: s.firstName || '', lastName: s.lastName || '', memberships: [] });
    }
    byPerson.get(key).memberships.push(s);
  }

  const riskOrder = { low: 0, medium: 1, high: 2 };
  const riskSummary = { low: 0, medium: 0, high: 0 };
  const atRiskStudents = [];
  for (const person of byPerson.values()) {
    let worst = 'low';
    for (const st of person.memberships) {
      const meta = subjectMeta.get(st.subjectId);
      const pcts = gradesAll
        .filter((g) => g.subjectId === st.subjectId && g.studentId === st.id)
        .map((g) => {
          const max = maxScoreByEval.get(g.evaluationId);
          return max && max > 0 ? (Number(g.score) / max) * 100 : null;
        })
        .filter((v) => v !== null);
      const gradePct = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
      const attRecords = attendanceAll.filter((a) => a.subjectId === st.subjectId && a.studentId === st.id);
      const attPct = attRecords.length > 0
        ? (attRecords.filter((a) => a.status === 'present').length / attRecords.length) * 100
        : null;
      const risk = calculateStudentRisk(attPct, gradePct !== null ? [gradePct] : []);
      if (riskOrder[risk.level] > riskOrder[worst]) worst = risk.level;
      if (risk.level !== 'low') {
        atRiskStudents.push({
          studentId: person.studentId,
          cedula: person.cedula,
          studentName: `${person.firstName} ${person.lastName}`.trim(),
          asignatura: meta ? meta.name : 'Sin nombre',
          docente: meta ? teacherNameById.get(meta.userId) || 'Docente' : 'Docente',
          periodo: meta ? meta.periodo : null,
          nivelEducativo: meta ? meta.nivelEducativo : null,
          asistencia: attPct !== null ? Math.round(attPct * 10) / 10 : null,
          nota: gradePct !== null ? Math.round(gradePct * 10) / 10 : null,
          nivelRiesgo: risk.level,
          razones: risk.reasons,
        });
      }
    }
    riskSummary[worst] += 1;
  }
  atRiskStudents.sort((a, b) => riskOrder[b.nivelRiesgo] - riskOrder[a.nivelRiesgo] || (a.studentName || '').localeCompare(b.studentName || '', 'es'));
  if (atRiskStudents.length > 50) atRiskStudents.length = 50;

  const byGradoOut = {};
  for (const [k, v] of attByGrado.entries()) byGradoOut[k] = pctOf(v.present, v.total);

  // --- SPRINT 4: Tendencias (trends) ---
  const trendsAttMap = new Map(); // YYYY-MM -> { present, total }
  for (const a of attendanceAll) {
    if (!a.date) continue;
    const month = a.date.substring(0, 7);
    if (!trendsAttMap.has(month)) trendsAttMap.set(month, { present: 0, total: 0 });
    trendsAttMap.get(month).total += 1;
    if ((a.status || 'present') === 'present') trendsAttMap.get(month).present += 1;
  }
  const attendanceTrends = Array.from(trendsAttMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, counts]) => ({ date, value: pctOf(counts.present, counts.total) || 0 }));

  const trendsGradesMap = new Map(); // YYYY-MM -> { sum, count }
  const evalsById = new Map(evalsAll.map(e => [e.id, e]));
  for (const g of gradesAll) {
    const ev = evalsById.get(g.evaluationId);
    if (!ev || !ev.date) continue;
    const month = ev.date.substring(0, 7);
    const max = maxScoreByEval.get(g.evaluationId);
    const score = Number(g.score);
    if (max && max > 0 && Number.isFinite(score)) {
      if (!trendsGradesMap.has(month)) trendsGradesMap.set(month, { sum: 0, count: 0 });
      trendsGradesMap.get(month).sum += (score / max) * 100;
      trendsGradesMap.get(month).count += 1;
    }
  }
  const gradesTrends = Array.from(trendsGradesMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, counts]) => ({ date, value: Math.round((counts.sum / counts.count) * 10) / 10 }));

  // --- SPRINT 4: Distribución (distribution) ---
  const distByTurno = { matutino: 0, vespertino: 0, nocturno: 0 };
  const distByGrado = {};
  for (const person of byPerson.values()) {
    const turnosSet = new Set();
    const gradosSet = new Set();
    for (const st of person.memberships) {
      const meta = subjectMeta.get(st.subjectId);
      if (meta && meta.periodo) turnosSet.add(meta.periodo);
      if (meta && meta.nivelEducativo) gradosSet.add(meta.nivelEducativo);
    }
    for (const t of turnosSet) {
      if (distByTurno[t] !== undefined) distByTurno[t] += 1;
    }
    for (const g of gradosSet) {
      distByGrado[g] = (distByGrado[g] || 0) + 1;
    }
  }

  // --- SPRINT 4: Retención (retention) ---
  const retention = {
    estimatedRate: null,
    totalActive: byPerson.size,
    totalPrevious: null,
  };

  return {
    generatedAt: Date.now(),
    institutionId: adminInstitutionId,
    attendance: {
      global: pctOf(attGlobal.present, attGlobal.total),
      byTurno: {
        matutino: pctOf(attByTurno.matutino.present, attByTurno.matutino.total),
        vespertino: pctOf(attByTurno.vespertino.present, attByTurno.vespertino.total),
        nocturno: pctOf(attByTurno.nocturno.present, attByTurno.nocturno.total),
      },
      byGrado: byGradoOut,
    },
    grades: { global: gradeCount > 0 ? Math.round((gradeSum / gradeCount) * 10) / 10 : null },
    riskSummary,
    atRiskStudents,
    trends: {
      attendance: attendanceTrends,
      grades: gradesTrends,
    },
    distribution: {
      byTurno: distByTurno,
      byGrado: distByGrado,
    },
    retention,
  };
});

// ─── Sprint 2: Detalle del estudiante y recomendaciones ───────────────────
exports.getStudentRiskReport = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { calculateStudentRisk, generateRecommendations } = require('./lib/risk-calculator');
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  const uid = request.auth.uid;
  await assertAdmin(uid);

  const adminSnap = await getDb().collection('users').doc(uid).get();
  const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;
  if (!adminInstitutionId) {
    throw new HttpsError('failed-precondition', 'Tu cuenta de administrador no tiene una institución asignada.');
  }

  const studentId = typeof request.data?.studentId === 'string' ? request.data.studentId.trim() : '';
  if (!studentId) {
    throw new HttpsError('invalid-argument', 'Indica el id o la cédula del estudiante.');
  }

  const rows = await loadInstitutionData(adminInstitutionId);
  const subjectMeta = new Map(); // subjectId → { name, periodo, nivelEducativo, userId }
  const teacherNameById = new Map();
  for (const { teacher, subjects } of rows) {
    teacherNameById.set(teacher.uid, teacher.displayName || (teacher.email || '').split('@')[0] || 'Docente');
    for (const sub of subjects) {
      subjectMeta.set(sub.id, {
        name: sub.name || 'Sin nombre',
        periodo: sub.periodo || null,
        nivelEducativo: sub.nivelEducativo || null,
        userId: teacher.uid,
      });
    }
  }

  // Localizar al estudiante (id de documento o cédula) y consolidar la persona
  // por cédula (o nombre si no hay cédula).
  let person = null;
  const allStudents = [];
  for (const { students } of rows) allStudents.push(...students);
  for (const st of allStudents) {
    if (String(st.id) === studentId || (st.cedula && String(st.cedula).trim() === studentId)) { person = st; break; }
  }
  if (!person) {
    throw new HttpsError('not-found', 'El estudiante no existe en la institución.');
  }
  const personKey = String(person.cedula || '').trim() || `${normText(person.firstName)}|${normText(person.lastName)}`;
  const memberships = allStudents.filter((st) => {
    const k = String(st.cedula || '').trim() || `${normText(st.firstName)}|${normText(st.lastName)}`;
    return k === personKey;
  });

  const riskOrder = { low: 0, medium: 1, high: 2 };
  const subjects = [];
  let worst = 'low';
  const reasons = [];
  let attPresent = 0;
  let attTotal = 0;
  let sumGrade = 0;
  let countGrade = 0;
  let fails = 0;

  for (const st of memberships) {
    const meta = subjectMeta.get(st.subjectId);
    const [evals, grades, attendance] = await Promise.all([
      getAllDocsForUserBySubject('evaluations', st.userId, st.subjectId),
      getAllDocsForUserBySubject('grades', st.userId, st.subjectId),
      getAllDocsForUserBySubject('attendance', st.userId, st.subjectId),
    ]);
    const maxByEval = new Map(evals.map((e) => [e.id, Number(e.maxScore) || 0]));
    const pcts = grades
      .filter((g) => g.studentId === st.id)
      .map((g) => {
        const max = maxByEval.get(g.evaluationId);
        return max && max > 0 ? (Number(g.score) / max) * 100 : null;
      })
      .filter((v) => v !== null);
    const gradePct = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
    const stAtt = attendance.filter((a) => a.studentId === st.id);
    const attPct = stAtt.length > 0 ? (stAtt.filter((a) => a.status === 'present').length / stAtt.length) * 100 : null;

    const risk = calculateStudentRisk(attPct, gradePct !== null ? [gradePct] : []);
    if (riskOrder[risk.level] > riskOrder[worst]) worst = risk.level;
    for (const reason of risk.reasons) {
      if (!reasons.includes(reason)) reasons.push(reason);
    }
    if (gradePct !== null) {
      sumGrade += gradePct;
      countGrade += 1;
      if (gradePct < 60) fails += 1;
    }
    attPresent += stAtt.filter((a) => a.status === 'present').length;
    attTotal += stAtt.length;

    const gs = meta ? deriveGradoSeccion(meta.name) : { grado: null, seccion: null };
    subjects.push({
      subjectId: st.subjectId,
      subjectName: meta ? meta.name : 'Sin nombre',
      teacherName: meta ? teacherNameById.get(meta.userId) || 'Docente' : 'Docente',
      periodo: meta ? meta.periodo : null,
      nivelEducativo: meta ? meta.nivelEducativo : null,
      attendance: attPct !== null ? Math.round(attPct * 10) / 10 : null,
      finalGrade: gradePct !== null ? Math.round(gradePct * 10) / 10 : null,
      grado: gs.grado,
      seccion: gs.seccion,
    });
  }

  const overallAtt = attTotal > 0 ? (attPresent / attTotal) * 100 : null;
  const promedioGeneral = countGrade > 0 ? Math.round((sumGrade / countGrade) * 10) / 10 : null;
  const gradoSeccion = subjects.find((s) => s.grado) || { grado: null, seccion: null };

  return {
    student: {
      studentId: person.id,
      cedula: person.cedula || '',
      firstName: person.firstName || '',
      lastName: person.lastName || '',
      grado: gradoSeccion.grado,
      seccion: gradoSeccion.seccion,
      // El esquema no tiene correo del estudiante.
      correo: null,
    },
    subjects,
    promedioGeneral,
    riskLevel: worst,
    reasons,
    recommendations: generateRecommendations(worst, overallAtt, fails),
  };
});

// ─── Sprint 3: Desempeño por docente ──────────────────────────────────────
exports.getTeacherPerformance = onCall({ timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  const uid = request.auth.uid;
  await assertAdmin(uid);

  const adminSnap = await getDb().collection('users').doc(uid).get();
  const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;
  if (!adminInstitutionId) {
    throw new HttpsError('failed-precondition', 'Tu cuenta de administrador no tiene una institución asignada.');
  }

  const teacherId = typeof request.data?.teacherId === 'string' ? request.data.teacherId.trim() : '';
  if (!teacherId) throw new HttpsError('invalid-argument', 'Indica el docente.');

  const teacherSnap = await getDb().collection('users').doc(teacherId).get();
  if (!teacherSnap.exists) throw new HttpsError('not-found', 'El docente no existe.');
  const teacherData = teacherSnap.data();
  if (teacherData.institutionId !== adminInstitutionId) {
    throw new HttpsError('not-found', 'El docente no pertenece a tu institución.');
  }

  // `periodo` → turno de la asignatura; `grado` → nivel educativo (no hay
  // campo "grado" en el esquema: se filtra por el nivel de la asignatura).
  const turno = parseTurnoFilter({ turno: request.data?.periodo });
  const nivel = parseNivelFilter({ nivelEducativo: request.data?.grado });

  const [subjects, students, evaluations, grades, attendance] = await Promise.all([
    getAllDocsForUser('subjects', teacherId),
    getAllDocsForUser('students', teacherId),
    getAllDocsForUser('evaluations', teacherId),
    getAllDocsForUser('grades', teacherId),
    getAllDocsForUser('attendance', teacherId),
  ]);
  const filtered = applyDashboardFilters({ subjects, students, evaluations, grades, attendance }, turno, nivel);

  const maxByEval = new Map(filtered.evaluations.map((e) => [e.id, Number(e.maxScore) || 0]));
  const teacherName = teacherData.displayName || (teacherData.email || '').split('@')[0] || 'Docente';

  // Métricas por asignatura + promedio general del docente.
  const subjectOut = [];
  let sumGrade = 0;
  let countGrade = 0;
  for (const sub of filtered.subjects) {
    const subGrades = filtered.grades.filter((g) => g.subjectId === sub.id);
    const subAtt = filtered.attendance.filter((a) => a.subjectId === sub.id);
    let gradeSum = 0;
    let gradeCount = 0;
    for (const g of subGrades) {
      const max = maxByEval.get(g.evaluationId);
      if (max && max > 0) { gradeSum += (Number(g.score) / max) * 100; gradeCount += 1; }
    }
    const present = subAtt.filter((a) => a.status === 'present').length;
    sumGrade += gradeSum;
    countGrade += gradeCount;
    subjectOut.push({
      subjectId: sub.id,
      subjectName: sub.name || 'Sin nombre',
      periodo: sub.periodo || null,
      nivelEducativo: sub.nivelEducativo || null,
      promedioCalificaciones: gradeCount > 0 ? Math.round((gradeSum / gradeCount) * 10) / 10 : null,
      promedioAsistencia: subAtt.length > 0 ? Math.round((present / subAtt.length) * 1000) / 10 : null,
      numEstudiantes: filtered.students.filter((s) => s.subjectId === sub.id).length,
    });
  }

  // Estudiantes en riesgo del docente (persona × asignatura, mismo criterio).
  const riskOrder = { low: 0, medium: 1, high: 2 };
  const byPerson = new Map();
  for (const s of filtered.students) {
    const key = String(s.cedula || '').trim() || `${normText(s.firstName)}|${normText(s.lastName)}`;
    if (!byPerson.has(key)) {
      byPerson.set(key, { studentId: s.id, cedula: s.cedula || '', firstName: s.firstName || '', lastName: s.lastName || '', memberships: [] });
    }
    byPerson.get(key).memberships.push(s);
  }
  const atRisk = [];
  for (const person of byPerson.values()) {
    for (const st of person.memberships) {
      const sub = filtered.subjects.find((x) => x.id === st.subjectId);
      const pcts = filtered.grades
        .filter((g) => g.subjectId === st.subjectId && g.studentId === st.id)
        .map((g) => {
          const max = maxByEval.get(g.evaluationId);
          return max && max > 0 ? (Number(g.score) / max) * 100 : null;
        })
        .filter((v) => v !== null);
      const gradePct = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
      const stAtt = filtered.attendance.filter((a) => a.subjectId === st.subjectId && a.studentId === st.id);
      const attPct = stAtt.length > 0 ? (stAtt.filter((a) => a.status === 'present').length / stAtt.length) * 100 : null;
      const risk = calculateStudentRisk(attPct, gradePct !== null ? [gradePct] : []);
      if (risk.level !== 'low') {
        atRisk.push({
          studentId: person.studentId,
          cedula: person.cedula,
          studentName: `${person.firstName} ${person.lastName}`.trim(),
          subjectName: sub ? sub.name : 'Sin nombre',
          asistencia: attPct !== null ? Math.round(attPct * 10) / 10 : null,
          nota: gradePct !== null ? Math.round(gradePct * 10) / 10 : null,
          nivelRiesgo: risk.level,
          razones: risk.reasons,
        });
      }
    }
  }
  atRisk.sort((a, b) => riskOrder[b.nivelRiesgo] - riskOrder[a.nivelRiesgo] || a.studentName.localeCompare(b.studentName, 'es'));
  if (atRisk.length > 50) atRisk.length = 50;

  // Evolución por trimestre (I/II/III): asistencia y calificaciones.
  const evolution = ['I', 'II', 'III'].map((periodo) => {
    const pEvalIds = new Set(filtered.evaluations.filter((e) => evDateInPeriodo(e.date, periodo)).map((e) => e.id));
    let gradeSum = 0;
    let gradeCount = 0;
    for (const g of filtered.grades) {
      const max = maxByEval.get(g.evaluationId);
      if (pEvalIds.has(g.evaluationId) && max && max > 0) {
        gradeSum += (Number(g.score) / max) * 100;
        gradeCount += 1;
      }
    }
    const pAtt = filtered.attendance.filter((a) => evDateInPeriodo(a.date, periodo));
    const pPresent = pAtt.filter((a) => a.status === 'present').length;
    return {
      periodo,
      attendance: pAtt.length > 0 ? Math.round((pPresent / pAtt.length) * 1000) / 10 : null,
      grades: gradeCount > 0 ? Math.round((gradeSum / gradeCount) * 10) / 10 : null,
    };
  });

  return {
    teacher: {
      uid: teacherId,
      email: teacherData.email || '',
      displayName: teacherName,
      institutionId: adminInstitutionId,
      institutionName: adminSnap.data().institutionName || 'Institución',
      subjectsCount: filtered.subjects.length,
      totalStudents: filtered.students.length,
      promedioGeneral: countGrade > 0 ? Math.round((sumGrade / countGrade) * 10) / 10 : null,
    },
    subjects: subjectOut,
    atRiskStudents: atRisk,
    evolution,
  };
});

// ─── Métricas institucionales globales (adminGetInstitutionStats) ──────────
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function toTs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    const t = m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v.toMillis === 'function') return v.toMillis();
  return null;
}

function weekStartKey(ts) {
  const d = new Date(ts);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

exports.adminGetInstitutionStats = onCall({ timeoutSeconds: 120, memory: '1GiB' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
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

  const teachers = teachersSnap.docs
    .map((d) => ({ uid: d.id, ...d.data() }))
    .filter((t) => t.uid !== uid && (t.role || 'teacher') !== 'admin');

  const results = await Promise.allSettled(teachers.map(async (teacherData) => {
    const teacherUid = teacherData.uid;
    const [subjects, students, evaluations, attendance, grades, notes, materials, calendarEvents] = await Promise.all([
      getAllDocsForUser('subjects', teacherUid),
      getAllDocsForUser('students', teacherUid),
      getAllDocsForUser('evaluations', teacherUid),
      getAllDocsForUser('attendance', teacherUid),
      getAllDocsForUser('grades', teacherUid),
      getAllDocsForUser('notes', teacherUid),
      getAllDocsForUser('materials', teacherUid),
      getAllDocsForUser('calendarEvents', teacherUid),
    ]);
    return { teacherData, subjects, students, evaluations, attendance, grades, notes, materials, calendarEvents };
  }));

  const weekKeys = [];
  for (let i = 7; i >= 0; i--) weekKeys.push(weekStartKey(Date.now() - i * WEEK_MS));
  const weekly = {};
  weekKeys.forEach((k) => {
    weekly[k] = { week: k, sessions: 0, evaluations: 0, notes: 0, materials: 0, events: 0 };
  });

  const byPlan = { free: 0, pro: 0, school: 0 };
  const attendanceTotal = { present: 0, late: 0, absent: 0, total: 0 };
  const subjectMap = new Map();
  const teachersOut = [];
  let totals = { subjects: 0, students: 0, evaluations: 0, gradesCount: 0, attendanceCount: 0, sessions: 0 };
  let aiCallsThisMonth = 0;
  let teachersWithAiUsage = 0;
  let gradeAvgSum = 0;
  let gradeAvgCount = 0;

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { teacherData, subjects, students, evaluations, attendance, grades, notes, materials, calendarEvents } = r.value;

    const teacherUid = teacherData.uid;
    const plan = teacherData.plan || 'free';
    if (Object.prototype.hasOwnProperty.call(byPlan, plan)) byPlan[plan] += 1;

    const aiCalls = Number(teacherData.aiCallsThisMonth) || 0;
    aiCallsThisMonth += aiCalls;
    if (aiCalls > 0) teachersWithAiUsage += 1;

    const lastActivity = toTs(teacherData.lastLoginAt) || toTs(teacherData.updatedAt) || null;
    const active7d = lastActivity !== null && Date.now() - lastActivity < 7 * DAY_MS;
    const active30d = lastActivity !== null && Date.now() - lastActivity < 30 * DAY_MS;

    totals.subjects += subjects.length;
    totals.students += students.length;
    totals.evaluations += evaluations.length;
    totals.gradesCount += grades.length;
    totals.attendanceCount += attendance.length;

    const attBySubject = new Map();
    const sessionSet = new Set();
    for (const a of attendance) {
      const key = `${teacherUid}|${a.subjectId}`;
      const status = a.status === 'late' ? 'late' : a.status === 'absent' ? 'absent' : 'present';
      if (!attBySubject.has(key)) {
        attBySubject.set(key, { subjectId: a.subjectId, present: 0, late: 0, absent: 0, total: 0 });
      }
      attBySubject.get(key)[status] += 1;
      attBySubject.get(key).total += 1;
      attendanceTotal[status] += 1;
      attendanceTotal.total += 1;
      sessionSet.add(`${a.subjectId}|${a.date}`);
    }
    totals.sessions += sessionSet.size;
    for (const pair of sessionSet) {
      const ts = toTs(pair.split('|')[1]);
      const wk = ts === null ? null : weekStartKey(ts);
      if (wk && weekly[wk]) weekly[wk].sessions += 1;
    }

    const addWeekly = (arr, dateField, bucketField) => {
      for (const d of arr) {
        const ts = toTs(d[dateField]);
        if (ts === null) continue;
        const wk = weekStartKey(ts);
        if (weekly[wk]) weekly[wk][bucketField] += 1;
      }
    };
    addWeekly(notes, 'date', 'notes');
    addWeekly(materials, 'date', 'materials');
    addWeekly(calendarEvents, 'date', 'events');
    addWeekly(evaluations, 'date', 'evaluations');

    const maxScoreByEval = new Map();
    for (const ev of evaluations) maxScoreByEval.set(ev.id, Number(ev.maxScore) || null);

    const gradesBySubject = new Map();
    for (const g of grades) {
      const key = `${teacherUid}|${g.subjectId}`;
      if (!gradesBySubject.has(key)) {
        gradesBySubject.set(key, {
          subjectId: g.subjectId,
          sumPct: 0,
          count: 0,
          students: new Set(),
          evaluationsWithGrades: new Set(),
          evaluationsWithoutGrades: new Set(),
        });
      }
      const entry = gradesBySubject.get(key);
      const maxScore = maxScoreByEval.get(g.evaluationId);
      const score = Number(g.score);
      if (maxScore && maxScore > 0 && Number.isFinite(score)) {
        entry.sumPct += (score / maxScore) * 100;
        entry.count += 1;
      }
      entry.students.add(g.studentId);
      entry.evaluationsWithGrades.add(g.evaluationId);
    }
    for (const ev of evaluations) {
      const key = `${teacherUid}|${ev.subjectId}`;
      const entry = gradesBySubject.get(key);
      if (entry && !entry.evaluationsWithGrades.has(ev.id)) entry.evaluationsWithoutGrades.add(ev.id);
    }

    const studentsBySubject = new Map();
    for (const s of students) {
      const key = `${teacherUid}|${s.subjectId}`;
      if (!studentsBySubject.has(key)) studentsBySubject.set(key, new Set());
      studentsBySubject.get(key).add(s.id);
    }

    for (const sub of subjects) {
      const key = `${teacherUid}|${sub.id}`;
      if (subjectMap.has(key)) continue;
      const att = attBySubject.get(key);
      const gr = gradesBySubject.get(key);
      const stCount = studentsBySubject.get(key) ? studentsBySubject.get(key).size : 0;
      subjectMap.set(key, {
        subjectId: sub.id,
        subjectName: sub.name || 'Sin nombre',
        teacherName: teacherData.displayName || teacherData.email?.split('@')[0] || 'Docente',
        periodo: sub.periodo || null,
        students: stCount,
        evaluations: evaluations.filter((e) => e.subjectId === sub.id).length,
        evaluationsWithGrades: gr ? gr.evaluationsWithGrades.size : 0,
        evaluationsWithoutGrades: gr ? gr.evaluationsWithoutGrades.size : 0,
        attendanceTotal: att ? att.total : 0,
        attendancePresent: att ? att.present : 0,
        attendanceLate: att ? att.late : 0,
        attendanceAbsent: att ? att.absent : 0,
        attendanceRate: att && att.total > 0 ? Math.round((att.present / att.total) * 1000) / 10 : 0,
        avgPct: gr && gr.count > 0 ? Math.round((gr.sumPct / gr.count) * 10) / 10 : null,
      });
    }

    let teacherSumPct = 0;
    let teacherCount = 0;
    for (const entry of gradesBySubject.values()) {
      teacherSumPct += entry.sumPct;
      teacherCount += entry.count;
    }
    gradeAvgSum += teacherSumPct;
    gradeAvgCount += teacherCount;

    teachersOut.push({
      uid: teacherUid,
      displayName: teacherData.displayName || teacherData.email?.split('@')[0] || 'Docente',
      plan,
      lastActivity,
      active7d,
      active30d,
      aiCallsThisMonth: aiCalls,
      subjects: subjects.length,
      students: students.length,
      evaluations: evaluations.length,
      attendanceCount: attendance.length,
      gradesCount: grades.length,
    });
  }

  const subjectStats = Array.from(subjectMap.values())
    .sort((a, b) => b.students - a.students || b.attendanceTotal - a.attendanceTotal)
    .slice(0, 12);

  teachersOut.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
  totals.teachers = teachersOut.length;

  return {
    generatedAt: Date.now(),
    institutionId: adminInstitutionId,
    totals,
    byPlan,
    attendance: {
      present: attendanceTotal.present,
      late: attendanceTotal.late,
      absent: attendanceTotal.absent,
      total: attendanceTotal.total,
      passRate: attendanceTotal.total > 0 ? Math.round((attendanceTotal.present / attendanceTotal.total) * 1000) / 10 : 0,
    },
    grades: {
      count: gradeAvgCount,
      avgPct: gradeAvgCount > 0 ? Math.round((gradeAvgSum / gradeAvgCount) * 10) / 10 : null,
    },
    subjectStats,
    weeklyActivity: weekKeys.map((k) => weekly[k]),
    teachers: teachersOut,
    aiUsage: { callsThisMonth: aiCallsThisMonth, teachersWithUsage: teachersWithAiUsage },
  };
});

// ─── Alertas de riesgo institucional ──────────────────────────────────────
exports.adminGetInstitutionAlerts = onCall({ timeoutSeconds: 120, memory: '1GiB' }, async (request) => {
  const { computeInstitutionAlerts } = require('./lib/institution-alerts');
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

  const teachers = teachersSnap.docs
    .map((d) => ({ uid: d.id, ...d.data() }))
    .filter((t) => t.uid !== uid && (t.role || 'teacher') !== 'admin');

  const turno = parseTurnoFilter(request.data);
  const nivel = parseNivelFilter(request.data);

  const results = await Promise.allSettled(teachers.map(async (teacherData) => {
    const teacherUid = teacherData.uid;
    const [subjects, students, evaluations, grades, attendance] = await Promise.all([
      getAllDocsForUser('subjects', teacherUid),
      getAllDocsForUser('students', teacherUid),
      getAllDocsForUser('evaluations', teacherUid),
      getAllDocsForUser('grades', teacherUid),
      getAllDocsForUser('attendance', teacherUid),
    ]);
    return {
      ...applyDashboardFilters({ subjects, students, evaluations, grades, attendance }, turno, nivel),
      teacher: teacherData,
    };
  }));

  const rows = results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);

  const alerts = computeInstitutionAlerts(rows);

  const summary = alerts.reduce(
    (acc, a) => {
      acc.total += 1;
      if (a.severity === 'critical') acc.critical += 1;
      else acc.warning += 1;
      if (a.type === 'student_grades' || a.type === 'student_attendance') {
        if (!acc.studentIds.has(a.studentId)) { acc.studentIds.add(a.studentId); acc.studentsAtRisk += 1; }
      }
      if (a.type === 'group_grades' || a.type === 'group_attendance') {
        const k = `${a.teacherUid}|${a.subjectId}`;
        if (!acc.groupKeys.has(k)) { acc.groupKeys.add(k); acc.groupsAtRisk += 1; }
      }
      return acc;
    },
    { total: 0, critical: 0, warning: 0, studentsAtRisk: 0, groupsAtRisk: 0, studentIds: new Set(), groupKeys: new Set() }
  );

  return {
    generatedAt: Date.now(),
    institutionId: adminInstitutionId,
    institutionName: adminSnap.data().institutionName || 'Institución',
    summary: {
      total: summary.total,
      critical: summary.critical,
      warning: summary.warning,
      studentsAtRisk: summary.studentsAtRisk,
      groupsAtRisk: summary.groupsAtRisk,
    },
    alerts,
  };
});

// ─── Inteligencia Institucional (Gemini AI) ───────────────────────────────
exports.adminGenerateInstitutionInsights = onCall(
  { timeoutSeconds: 120, memory: '1GiB' },
  async (request) => {
    const { calculateStudentRisk, generateRecommendations } = require('./lib/risk-calculator');
    const { computeInstitutionAlerts } = require('./lib/institution-alerts');
    const { schoolConfigOut } = require('./lib/school-config');
    if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión');

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
    const teachers = teachersSnap.docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .filter((t) => t.uid !== uid && (t.role || 'teacher') !== 'admin');

    const turno = parseTurnoFilter(request.data);
    const nivel = parseNivelFilter(request.data);

    const results = await Promise.allSettled(teachers.map(async (teacherData) => {
      const teacherUid = teacherData.uid;
      const [subjects, students, evaluations, grades, attendance] = await Promise.all([
        getAllDocsForUser('subjects', teacherUid),
        getAllDocsForUser('students', teacherUid),
        getAllDocsForUser('evaluations', teacherUid),
        getAllDocsForUser('grades', teacherUid),
        getAllDocsForUser('attendance', teacherUid),
      ]);
      return {
        ...applyDashboardFilters({ subjects, students, evaluations, grades, attendance }, turno, nivel),
        teacher: teacherData,
      };
    }));

    const rows = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);

    const alerts = computeInstitutionAlerts(rows);

    // Resumen compacto para el prompt (sin nombres de estudiantes ni docentes
    // para no microgestionar; solo patrones agregados).
    const alertTypes = { student_grades: 0, student_attendance: 0, group_grades: 0, group_attendance: 0, teacher_inactive: 0 };
    for (const a of alerts) alertTypes[a.type] = (alertTypes[a.type] || 0) + 1;

    // Promedios globales de notas y asistencia.
    let sumPct = 0;
    let countPct = 0;
    let attPresent = 0;
    let attTotal = 0;
    const subjectsSnapshot = [];
    const evalScoreById = new Map();
    for (const row of rows) {
      const teacherName = row.teacher.displayName || row.teacher.email?.split('@')[0] || 'Docente';
      for (const ev of row.evaluations || []) evalScoreById.set(ev.id, Number(ev.maxScore) || null);
      const gradesBySubject = new Map();
      for (const g of row.grades || []) {
        const maxScore = evalScoreById.get(g.evaluationId);
        const score = Number(g.score);
        if (maxScore && maxScore > 0 && Number.isFinite(score)) {
          const p = (score / maxScore) * 100;
          sumPct += p;
          countPct += 1;
          const key = `${g.subjectId}|${teacherName}`;
          if (!gradesBySubject.has(key)) gradesBySubject.set(key, { name: row.subjects.find(s => s.id === g.subjectId)?.name || 'Sin nombre', teacherName, sum: 0, n: 0 });
          gradesBySubject.get(key).sum += p;
          gradesBySubject.get(key).n += 1;
        }
      }
      for (const a of row.attendance || []) {
        attTotal += 1;
        if (a.status !== 'absent') attPresent += 1;
      }
      for (const entry of gradesBySubject.values()) {
        subjectsSnapshot.push({ asignatura: entry.name, docente: entry.teacherName, promedio: Math.round((entry.sum / entry.n) * 10) / 10 });
      }
    }
    subjectsSnapshot.sort((a, b) => a.promedio - b.promedio);
    const lowestSubjects = subjectsSnapshot.slice(0, 5);
    const highestSubjects = subjectsSnapshot.slice(-5).reverse();

    // Reservar cuota de IA de forma atómica.
    const quota = await reserveAiQuota(uid, request.auth.token?.email || null);
    if (quota.exceeded) {
      throw new HttpsError('resource-exhausted', 'Límite de solicitudes de IA excedido para este mes.');
    }

    const prompt = `Eres el director de análisis pedagógico de la institución educativa ${adminSnap.data().institutionName || 'la institución'}. Tu tarea es detectar PATRONES institucionales de rendimiento a partir de datos agregados, a nivel directivo, SIN señalar ni microgestionar a docentes ni estudiantes individuales.

Datos agregados de la institución:
- Docentes con datos: ${rows.length}
- Total de notas registradas: ${countPct}, promedio general: ${countPct > 0 ? Math.round((sumPct / countPct) * 10) / 10 : 'sin datos'}%
- Asistencia general: ${attTotal > 0 ? Math.round((attPresent / attTotal) * 1000) / 10 : 'sin datos'}% de presencia (${attTotal} registros)
- Alertas de riesgo detectadas: ${alerts.length} (${alertTypes.student_grades} por notas de estudiantes, ${alertTypes.student_attendance} por asistencia de estudiantes, ${alertTypes.group_grades} por grupos con notas bajas, ${alertTypes.group_attendance} por grupos con baja asistencia, ${alertTypes.teacher_inactive} docentes inactivos)
- Asignaturas con peor promedio: ${JSON.stringify(lowestSubjects)}
- Asignaturas con mejor promedio: ${JSON.stringify(highestSubjects)}

Instrucciones:
- Identifica hasta 4 patrones institucionales (p. ej. tendencia general de notas, problema sistémico de asistencia, asignaturas consistentemente débiles, falta de actividad de docentes, desequilibrios por turno si los datos lo sugieren). NO nombres personas ni asignaturas como culpables; habla de patrones.
- Escribe un resumen ejecutivo de 2-3 oraciones.
- Propón hasta 4 recomendaciones accionables a nivel de dirección.
- Devuelve ÚNICAMENTE JSON válido con esta estructura exacta (sin markdown):
{"resumen": string, "patrones": [{"titulo": string, "detalle": string}], "recomendaciones": [string]}`;

    let generatedText = '';
    try {
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      };
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey.value()}`;
      const geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!geminiRes.ok) {
        const geminiErr = await geminiRes.text();
        console.error('Gemini error (adminGenerateInstitutionInsights):', geminiErr?.slice(0, 2000));
        throw new HttpsError('internal', `Error del proveedor de IA: ${geminiRes.status}`);
      }
      const data = await geminiRes.json();
      generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (err) {
      await releaseAiCall(uid);
      throw err;
    }

    let insights;
    try {
      insights = JSON.parse(generatedText);
    } catch {
      await releaseAiCall(uid);
      throw new HttpsError('internal', 'No se pudo interpretar la respuesta de la IA.');
    }

    return {
      institutionName: adminSnap.data().institutionName || 'Institución',
      stats: {
        teachersWithData: rows.length,
        gradesCount: countPct,
        avgPct: countPct > 0 ? Math.round((sumPct / countPct) * 10) / 10 : null,
        attendancePct: attTotal > 0 ? Math.round((attPresent / attTotal) * 1000) / 10 : null,
        alertsCount: alerts.length,
      },
      insights: {
        resumen: typeof insights.resumen === 'string' ? insights.resumen : '',
        patrones: Array.isArray(insights.patrones)
          ? insights.patrones.slice(0, 4).map((p) => ({
              titulo: typeof p?.titulo === 'string' ? p.titulo : '',
              detalle: typeof p?.detalle === 'string' ? p.detalle : '',
            }))
          : [],
        recomendaciones: Array.isArray(insights.recomendaciones)
          ? insights.recomendaciones.slice(0, 4).map(String)
          : [],
      },
    };
  }
);

// ─── Sprint 2: Insights del estudiante ────────────────────────────────────
exports.adminGenerateStudentInsights = onCall(
  { timeoutSeconds: 180, memory: '1GiB', secrets: [geminiApiKey] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
    const uid = request.auth.uid;
    await assertAdmin(uid);

    const adminSnap = await getDb().collection('users').doc(uid).get();
    const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;
    if (!adminInstitutionId) {
      throw new HttpsError('failed-precondition', 'Tu cuenta de administrador no tiene una institución asignada.');
    }

    const studentDocId = typeof request.data?.studentId === 'string' ? request.data.studentId : '';
    if (!studentDocId) throw new HttpsError('invalid-argument', 'Falta el estudiante.');

    const { person, memberships } = await loadStudentBoletin(adminInstitutionId, studentDocId);

    // Reservar cuota de IA de forma atómica.
    const quota = await reserveAiQuota(uid, request.auth.token?.email || null);
    if (quota.exceeded) {
      throw new HttpsError('resource-exhausted', 'Límite de solicitudes de IA excedido para este mes.');
    }

    // Construir contexto del estudiante.
    const studentName = `${person.firstName} ${person.lastName}`.trim();
    const cedula = person.cedula || '—';
    const subjects = [];
    for (const m of memberships) {
      const [evals, grades, attendance] = await Promise.all([
        getAllDocsForUserBySubject('evaluations', m.userId, m.subjectId),
        getAllDocsForUserBySubject('grades', m.userId, m.subjectId),
        getAllDocsForUserBySubject('attendance', m.userId, m.subjectId),
      ]);
      const maxByEval = new Map(evals.map((e) => [e.id, Number(e.maxScore) || 0]));
      const pcts = grades
        .filter((g) => g.studentId === m.id)
        .map((g) => {
          const max = maxByEval.get(g.evaluationId);
          return max && max > 0 ? (Number(g.score) / max) * 100 : null;
        })
        .filter((v) => v !== null);
      const gradePct = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
      const stAtt = attendance.filter((a) => a.studentId === m.id);
      const attPct = stAtt.length > 0 ? (stAtt.filter((a) => a.status === 'present').length / stAtt.length) * 100 : null;
      subjects.push({
        subjectId: m.subjectId,
        subjectName: m.subjectName || 'Sin nombre',
        teacherName: m.teacherName || 'Docente',
        attendance: attPct !== null ? Math.round(attPct * 10) / 10 : null,
        finalGrade: gradePct !== null ? Math.round(gradePct * 10) / 10 : null,
      });
    }

    const prompt = `Eres un orientador pedagógico experto. Analiza los datos académicos de un estudiante y genera un informe breve y accionable.

Estudiante: ${studentName}
Cédula: ${cedula}
Materias (${subjects.length}):
${subjects.map(s => `- ${s.subjectName} (docente: ${s.teacherName}): asistencia ${s.attendance !== null ? s.attendance + '%' : '—'}, nota final ${s.finalGrade !== null ? s.finalGrade : '—'}`).join('\n')}

Instrucciones:
- Escribe un resumen ejecutivo de 2-3 oraciones.
- Identifica hasta 3 fortalezas y 3 áreas de mejora.
- Propón hasta 4 recomendaciones accionables.
- Devuelve ÚNICAMENTE JSON válido con esta estructura exacta:
{"resumen": string, "fortalezas": [string], "areasMejora": [string], "recomendaciones": [string]}`;

    let generatedText = '';
    try {
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      };
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey.value()}`;
      const geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!geminiRes.ok) {
        const geminiErr = await geminiRes.text();
        console.error('Gemini error (adminGenerateStudentInsights):', geminiErr?.slice(0, 2000));
        throw new HttpsError('internal', `Error del proveedor de IA: ${geminiRes.status}`);
      }
      const data = await geminiRes.json();
      generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (err) {
      await releaseAiCall(uid);
      throw err;
    }

    let insights;
    try {
      insights = JSON.parse(generatedText);
    } catch {
      await releaseAiCall(uid);
      throw new HttpsError('internal', 'No se pudo interpretar la respuesta de la IA.');
    }

    return {
      studentName,
      cedula,
      subjects: subjects.map(s => ({ subjectName: s.subjectName, teacherName: s.teacherName, attendance: s.attendance, finalGrade: s.finalGrade })),
      insights: {
        resumen: typeof insights.resumen === 'string' ? insights.resumen : '',
        fortalezas: Array.isArray(insights.fortalezas) ? insights.fortalezas.slice(0, 3).map(String) : [],
        areasMejora: Array.isArray(insights.areasMejora) ? insights.areasMejora.slice(0, 3).map(String) : [],
        recomendaciones: Array.isArray(insights.recomendaciones) ? insights.recomendaciones.slice(0, 4).map(String) : [],
      },
    };
  }
);

// ─── Boletín del estudiante con navegación de periodo (admin) ─────────────
exports.adminGetStudentBoletin = onCall({ timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  const uid = request.auth.uid;
  await assertAdmin(uid);

  const adminSnap = await getDb().collection('users').doc(uid).get();
  const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;
  if (!adminInstitutionId) {
    throw new HttpsError('failed-precondition', 'Tu cuenta de administrador no tiene una institución asignada.');
  }

  const studentDocId = typeof request.data?.studentId === 'string' ? request.data.studentId : '';
  if (!studentDocId) throw new HttpsError('invalid-argument', 'Falta el estudiante.');

  const periodo = typeof request.data?.periodo === 'string' ? request.data.periodo : null;
  const { person, memberships } = await loadStudentBoletin(adminInstitutionId, studentDocId);

  // Obtener datos académicos de todas las membresías
  const subjects = [];
  for (const m of memberships) {
    const [evals, grades, attendance] = await Promise.all([
      getAllDocsForUserBySubject('evaluations', m.userId, m.subjectId),
      getAllDocsForUserBySubject('grades', m.userId, m.subjectId),
      getAllDocsForUserBySubject('attendance', m.userId, m.subjectId),
    ]);
    const maxByEval = new Map(evals.map((e) => [e.id, Number(e.maxScore) || 0]));
    const pcts = grades
      .filter((g) => g.studentId === m.id)
      .map((g) => {
        const max = maxByEval.get(g.evaluationId);
        return max && max > 0 ? (Number(g.score) / max) * 100 : null;
      })
      .filter((v) => v !== null);
    const gradePct = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
    const stAtt = attendance.filter((a) => a.studentId === m.id);
    const attPct = stAtt.length > 0 ? (stAtt.filter((a) => a.status === 'present').length / stAtt.length) * 100 : null;
    const gs = deriveGradoSeccion(m.subjectName || '');
    subjects.push({
      subjectId: m.subjectId,
      subjectName: m.subjectName || 'Sin nombre',
      teacherName: m.teacherName || 'Docente',
      periodo: m.periodo || null,
      nivelEducativo: m.nivelEducativo || null,
      attendance: attPct !== null ? Math.round(attPct * 10) / 10 : null,
      finalGrade: gradePct !== null ? Math.round(gradePct * 10) / 10 : null,
      grado: gs.grado,
      seccion: gs.seccion,
    });
  }

  // Filtrar por periodo si se proporciona (I, II, III)
  let filteredSubjects = subjects;
  if (periodo && ['I', 'II', 'III'].includes(periodo)) {
    filteredSubjects = subjects.filter(s => s.periodo === periodo);
  }

  return {
    student: {
      studentId: person.id,
      cedula: person.cedula || '',
      firstName: person.firstName || '',
      lastName: person.lastName || '',
      grado: filteredSubjects[0]?.grado || null,
      seccion: filteredSubjects[0]?.seccion || null,
      correo: null,
    },
    subjects: filteredSubjects,
    periodos: ['I', 'II', 'III'],
    periodoSeleccionado: periodo || 'todos',
    institutionName: adminSnap.data().institutionName || 'Institución',
  };
});

// ─── Admin: Invitar docente a la institución ──────────────────────────────
exports.adminInviteTeacher = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  const uid = request.auth.uid;
  await assertAdmin(uid);

  const adminSnap = await getDb().collection('users').doc(uid).get();
  const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;
  if (!adminInstitutionId) {
    throw new HttpsError('failed-precondition', 'Tu cuenta de administrador no tiene una institución asignada.');
  }

  const email = typeof request.data?.email === 'string' ? request.data.email.trim() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Email inválido');
  }

  // Verificar si ya existe un usuario con ese email
  const existingSnap = await getDb().collection('users').where('email', '==', email).limit(1).get();
  if (!existingSnap.empty) {
    throw new HttpsError('already-exists', 'Ya existe un usuario con ese email');
  }

  // Crear usuario en Auth (sin contraseña, se le enviará email de configuración)
  const userRecord = await getAuthInstance().createUser({
    email,
    emailVerified: false,
    disabled: false,
  });

  // Crear documento en users con plan free y rol teacher
  await getDb().collection('users').doc(userRecord.uid).set({
    email,
    displayName: email.split('@')[0],
    plan: 'free',
    role: 'teacher',
    institutionId: adminInstitutionId,
    institutionName: adminSnap.data().institutionName || 'Institución',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Enviar email de invitación (opcional: usar Firebase Auth sendPasswordResetEmail o custom)
  await getAuthInstance().generatePasswordResetLink(email).catch(() => {});

  return { success: true, uid: userRecord.uid, email };
});

// ─── Búsqueda de estudiantes (admin) ──────────────────────────────────────
exports.adminSearchStudents = onCall(async (request) => {
  const { buildSearchRows } = require('./lib/student-search');
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  const uid = request.auth.uid;
  await assertAdmin(uid);

  const adminSnap = await getDb().collection('users').doc(uid).get();
  const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;
  if (!adminInstitutionId) {
    throw new HttpsError('failed-precondition', 'Tu cuenta de administrador no tiene una institución asignada.');
  }

  const query = typeof request.data?.query === 'string' ? request.data.query.trim() : '';
  if (query.length < 2) throw new HttpsError('invalid-argument', 'La búsqueda debe tener al menos 2 caracteres');

  const rows = await loadInstitutionData(adminInstitutionId);
  const result = buildSearchRows(rows, query, { limit: 50 });
  return result;
});

// ─── Búsqueda de estudiante por id/cedula (admin, para boletín) ───────────
exports.searchStudent = onCall(async (request) => {
  const { buildSearchRows } = require('./lib/student-search');
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  const uid = request.auth.uid;
  await assertAdmin(uid);

  const adminSnap = await getDb().collection('users').doc(uid).get();
  const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;
  if (!adminInstitutionId) {
    throw new HttpsError('failed-precondition', 'Tu cuenta de administrador no tiene una institución asignada.');
  }

  const query = typeof request.data?.query === 'string' ? request.data.query.trim() : '';
  if (query.length < 2) throw new HttpsError('invalid-argument', 'La búsqueda debe tener al menos 2 caracteres');

  const rows = await loadInstitutionData(adminInstitutionId);
  const result = buildSearchRows(rows, query, { limit: 50 });
  return result;
});

// ─── Fase 5: Configuración post-login de la institución ──────────────────
// Carga el documento institutions/{id} (ausente → {}). Usada por
// adminGetSchoolConfig, adminSaveSchoolConfig y adminRestoreInstitutionBackup.
async function loadSchoolConfig(institutionId) {
  const snap = await getDb().collection('institutions').doc(institutionId).get();
  return snap.exists ? snap.data() : {};
}

exports.adminGetSchoolConfig = onCall(async (request) => {
  const { schoolConfigOut } = require('./lib/school-config');
  const { gradingWeightOut } = require('./lib/grading-weight');
  const { periodosOut, planRulesOut } = require('./lib/periodos-plan');
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  const uid = request.auth.uid;
  await assertAdmin(uid);

  const adminSnap = await getDb().collection('users').doc(uid).get();
  const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;
  if (!adminInstitutionId) {
    throw new HttpsError('failed-precondition', 'Tu cuenta de administrador no tiene una institución asignada.');
  }

  const inst = await loadSchoolConfig(adminInstitutionId);
  return {
    institutionId: adminInstitutionId,
    institutionName: inst.name || adminSnap.data().institutionName || 'Institución',
    schoolConfig: schoolConfigOut(inst),
    gradingWeight: gradingWeightOut(inst),
    periodos: periodosOut(inst),
    planRules: planRulesOut(inst),
  };
});

// Guarda la configuración de personalización de la institución. Admin
// únicamente; el cliente no puede escribir institutions/* directamente.
exports.adminSaveSchoolConfig = onCall(async (request) => {
  const { sanitizeSchoolConfigInput, schoolConfigOut } = require('./lib/school-config');
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  const uid = request.auth.uid;
  await assertAdmin(uid);

  const adminSnap = await getDb().collection('users').doc(uid).get();
  const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;
  if (!adminInstitutionId) {
    throw new HttpsError('failed-precondition', 'Tu cuenta de administrador no tiene una institución asignada.');
  }

  const data = request.data || {};
  let sanitized;
  try {
    sanitized = sanitizeSchoolConfigInput(data);
  } catch (err) {
    if (err && err.message === 'LOGO_URL_INVALID') {
      throw new HttpsError('invalid-argument', 'La URL del logo debe ser una URL http(s) válida.');
    }
    if (err && err.message === 'PRIMARY_COLOR_INVALID') {
      throw new HttpsError('invalid-argument', 'El color primario debe ser un código hexadecimal válido (#RRGGBB).');
    }
    throw new HttpsError('invalid-argument', 'Datos de configuración inválidos.');
  }
  const { name, schoolConfig } = sanitized;
  schoolConfig.onboardingDone = true;
  schoolConfig.updatedAt = FieldValue.serverTimestamp();

  const update = { schoolConfig };
  if (name) update.name = name;
  await getDb().collection('institutions').doc(adminInstitutionId).set(update, { merge: true });

  const inst = { name: name || (await loadSchoolConfig(adminInstitutionId)).name, schoolConfig };
  return {
    institutionId: adminInstitutionId,
    institutionName: name || adminSnap.data().institutionName || 'Institución',
    schoolConfig: schoolConfigOut(inst),
  };
});

// Traduce los códigos GRADING_* del módulo puro a mensajes para el cliente.
function gradingWeightErrorMessage(code) {
  switch (code) {
    case 'GRADING_MODE_INVALID': return 'El modo de ponderación no es válido.';
    case 'GRADING_APPLY_TO_INVALID': return 'La opción de aplicación no es válida.';
    case 'GRADING_SUM_INVALID': return 'Los porcentajes deben sumar 100.';
    case 'GRADING_CUSTOM_TOO_FEW': return 'Define al menos 2 categorías de ponderación.';
    case 'GRADING_CUSTOM_TOO_MANY': return 'Máximo 12 categorías de ponderación.';
    default: return 'Datos de ponderación inválidos.';
  }
}

// Guarda la ponderación global de calificaciones de la institución (Módulo 4).
// Admin únicamente; el cliente no puede escribir institutions/* directamente.
// Esta función SOLO añade la capa de configuración: no modifica el cálculo
// de notas. Un futuro consumidor del cálculo leerá gradingWeight desde
// institutions/{id} para decidir cómo calcular la nota final (o lo expondrá
// vía adminGetSchoolConfig).
exports.adminSaveGradingWeight = onCall(async (request) => {
  const { sanitizeGradingWeightInput, gradingWeightOut } = require('./lib/grading-weight');
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  const uid = request.auth.uid;
  await assertAdmin(uid);

  const adminSnap = await getDb().collection('users').doc(uid).get();
  const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;
  if (!adminInstitutionId) {
    throw new HttpsError('failed-precondition', 'Tu cuenta de administrador no tiene una institución asignada.');
  }

  const data = request.data || {};
  let sanitized;
  try {
    sanitized = sanitizeGradingWeightInput(data);
  } catch (err) {
    if (err && typeof err.message === 'string' && err.message.startsWith('GRADING_')) {
      throw new HttpsError('invalid-argument', gradingWeightErrorMessage(err.message));
    }
    throw new HttpsError('invalid-argument', 'Datos de ponderación inválidos.');
  }
  // Auditoría ligera (política institucional): quién guardó y snapshot del
  // valor anterior. Sin historial de versiones — solo el último cambio.
  const instRef = getDb().collection('institutions').doc(adminInstitutionId);
  const instSnap = await instRef.get();
  const currentGw = instSnap.exists ? instSnap.data().gradingWeight : null;
  if (currentGw && typeof currentGw === 'object') {
    try {
      const previous = gradingWeightOut({ gradingWeight: currentGw });
      delete previous.updatedAt;
      delete previous.updatedBy;
      sanitized.previousWeight = previous;
    } catch {
      // snapshot anterior ilegible: se omite sin bloquear el guardado
    }
  }
  sanitized.updatedAt = getFieldValue().serverTimestamp();
  sanitized.updatedBy = uid;
  await instRef.set({ gradingWeight: sanitized }, { merge: true });

  return {
    institutionId: adminInstitutionId,
    gradingWeight: gradingWeightOut(sanitized),
  };
});

// ─── Módulo 1: Periodos de clase y reglas del plan ───────────────────────
exports.adminSavePeriodos = onCall(async (request) => {
  const { sanitizePeriodosInput, periodosOut } = require('./lib/periodos-plan');
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  const uid = request.auth.uid;
  await assertAdmin(uid);

  const adminSnap = await getDb().collection('users').doc(uid).get();
  const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;
  if (!adminInstitutionId) {
    throw new HttpsError('failed-precondition', 'Tu cuenta de administrador no tiene una institución asignada.');
  }

  const sanitized = sanitizePeriodosInput(request.data || {});
  await getDb().collection('institutions').doc(adminInstitutionId).set({ periodos: sanitized }, { merge: true });

  return {
    institutionId: adminInstitutionId,
    periodos: periodosOut(sanitized),
  };
});

// Guarda la regla de planificación institucional (semanal/mensual/trimestral/
// cuatrimestral/anual) y la opción "Recomendar a docentes" en
// institutions/{id}.planRules. Admin únicamente; el cliente no puede escribir
// institutions/* directamente.
exports.adminSavePlanRules = onCall(async (request) => {
  const { sanitizePlanRulesInput, planRulesOut } = require('./lib/periodos-plan');
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  const uid = request.auth.uid;
  await assertAdmin(uid);

  const adminSnap = await getDb().collection('users').doc(uid).get();
  const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;
  if (!adminInstitutionId) {
    throw new HttpsError('failed-precondition', 'Tu cuenta de administrador no tiene una institución asignada.');
  }

  const data = request.data || {};
  let sanitized;
  try {
    sanitized = sanitizePlanRulesInput(data);
  } catch (err) {
    if (err && err.message === 'PLAN_RULE_INVALID') {
      throw new HttpsError('invalid-argument', 'La regla de planificación seleccionada no es válida.');
    }
    throw new HttpsError('invalid-argument', 'Datos de reglas de planificación inválidos.');
  }
  await getDb().collection('institutions').doc(adminInstitutionId).set({ planRules: sanitized }, { merge: true });

  return {
    institutionId: adminInstitutionId,
    planRules: planRulesOut(sanitized),
  };
});

// ─── Respaldo institucional: restauración (operación extraordinaria) ──────
//
// SEMÁNTICA: institution-config-restore. Esta función implementa EXCLUSIVAMENTE
// restauración de CONFIGURACIÓN por upsert (no destructiva). Una hipotética
// institution-full-restore futura (reemplazo total del estado con documentos
// crudos) DEBE ser una Cloud Function SEPARADA con su propia validación —
// NUNCA reutilizar silenciosamente esta misma semántica para ambos propósitos.
//
// DECISIÓN DE DISEÑO (documentada): el export actual es ANALÍTICO (agregados +
// detalle por docente), NO documentos crudos de Firestore. Por eso esta
// función restaura ÚNICAMENTE la configuración institucional del payload —
// name, schoolConfig, gradingWeight, periodos y planRules — re-sanitizada en
// el servidor con los mismos módulos puros que las funciones de guardado.
//
// NO se restauran teachers/teacherDetails/students/metrics/etc: son vistas
// calculadas que pueden venir incompletas (fetches fallidos → null, filtros
// activos al exportar) y un upsert parcial crearía referencias rotas entre
// subjects/students/evaluations/grades. Se reportan en `skipped` con avisos.
// NUNCA se borran colecciones enteras; solo set(..., {merge:true}) upsert.
//
// POLÍTICA NO DESTRUCTIVA (documentada): esta función es una restauración de
// CONFIGURACIÓN por upsert — "restaurar NO elimina registros existentes".
// Si el respaldo omite información presente en el sistema (o una sección del
// payload llega corrupta), esa información NO se elimina: solo se actualizan
// los campos incluidos y válidos en el respaldo. Por lo tanto NO es un
// snapshot exacto con reemplazo total del estado institucional.
//
// COMPATIBILIDAD FUTURA (solo preparación, sin features): export.type
// ('institution-full-backup') y schemaVersion ('1.0') permanecen ESTABLES.
// Una futura restauración COMPLETA (docentes/asignaturas/notas como documentos
// crudos) requeriría un NUEVO tipo de export con documentos crudos (p. ej.
// 'institution-full-backup-v2') y su propia validación específica.
exports.adminRestoreInstitutionBackup = onCall(async (request) => {
  const { validateInstitutionBackup } = require('./lib/backup-validate');
  const { sanitizeSchoolConfigInput, schoolConfigOut } = require('./lib/school-config');
  const { sanitizeGradingWeightInput, gradingWeightOut } = require('./lib/grading-weight');
  const { sanitizePeriodosInput, periodosOut } = require('./lib/periodos-plan');
  const { sanitizePlanRulesInput, planRulesOut } = require('./lib/periodos-plan');
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión');
  const uid = request.auth.uid;
  await assertAdmin(uid);

  const adminSnap = await getDb().collection('users').doc(uid).get();
  const adminInstitutionId = adminSnap.exists ? adminSnap.data().institutionId : null;
  if (!adminInstitutionId) {
    throw new HttpsError('failed-precondition', 'Tu cuenta de administrador no tiene una institución asignada.');
  }

  // Revalidación COMPLETA en el servidor: nunca confiar en el frontend.
  const validation = validateInstitutionBackup(request.data || {}, adminInstitutionId);
  if (!validation.ok) {
    throw new HttpsError('invalid-argument', validation.userMessage);
  }
  const payload = request.data;

  const restored = {};
  const skipped = [];
  const warnings = [];
  const update = {};

  // Nombre de la institución
  if (typeof payload.institutionName === 'string' && payload.institutionName.trim()) {
    update.name = payload.institutionName.trim().slice(0, 200);
    restored.name = 1;
  }

  // Configuración de personalización (logo, slogan, director, contacto, color)
  if (payload.schoolConfig && typeof payload.schoolConfig === 'object') {
    try {
      const sanitizedSchool = sanitizeSchoolConfigInput({
        ...payload.schoolConfig,
        name: update.name,
      });
      // Un respaldo procede de una institución ya configurada: el onboarding
      // se marca hecho para que el wizard no vuelva a abrirse tras restaurar.
      sanitizedSchool.schoolConfig.onboardingDone = true;
      sanitizedSchool.schoolConfig.updatedAt = getFieldValue().serverTimestamp();
      Object.assign(update, { schoolConfig: sanitizedSchool.schoolConfig });
      restored.schoolConfig = 1;
    } catch (err) {
      const code = err && err.message;
      warnings.push(
        code === 'LOGO_URL_INVALID' ? 'schoolConfig omitido: URL de logo inválida.' :
        code === 'PRIMARY_COLOR_INVALID' ? 'schoolConfig omitido: color primario inválido.' :
        'schoolConfig omitido: datos inválidos.'
      );
      skipped.push('schoolConfig');
    }
  } else {
    skipped.push('schoolConfig');
  }

  // Ponderación global de calificaciones. Inválida en el respaldo → se OMITE
  // (con aviso exacto) y la restauración continúa con el resto; la vigente se
  // conserva. Nunca se aplica una ponderación que no sume 100%.
  if (payload.gradingWeight && typeof payload.gradingWeight === 'object') {
    try {
      const sanitizedGrading = sanitizeGradingWeightInput(payload.gradingWeight);
      sanitizedGrading.updatedAt = getFieldValue().serverTimestamp();
      Object.assign(update, { gradingWeight: sanitizedGrading });
      restored.gradingWeight = 1;
    } catch {
      warnings.push('La ponderación académica del respaldo es inválida y fue omitida.');
      skipped.push('gradingWeight');
    }
  } else {
    skipped.push('gradingWeight');
  }

  // Periodos operativos (sanitizePeriodosInput no lanza: normaliza siempre)
  if (payload.periodos && typeof payload.periodos === 'object') {
    Object.assign(update, { periodos: sanitizePeriodosInput(payload.periodos) });
    restored.periodos = 1;
  } else {
    skipped.push('periodos');
  }

  // Reglas del plan
  if (payload.planRules && typeof payload.planRules === 'object') {
    try {
      Object.assign(update, { planRules: sanitizePlanRulesInput(payload.planRules) });
      restored.planRules = 1;
    } catch (err) {
      if (err && err.message === 'PLAN_RULE_INVALID') {
        warnings.push('planRules omitido: regla seleccionada inválida.');
      } else {
        warnings.push('planRules omitido: datos inválidos.');
      }
      skipped.push('planRules');
    }
  } else {
    skipped.push('planRules');
  }

  // Secciones analíticas SIEMPRE fuera de la restauración (decisión documentada)
  for (const section of ['metrics', 'alerts', 'teachers', 'teacherDetails', 'students', 'discrepancies', 'stats', 'insights']) {
    skipped.push(section);
  }
  warnings.push(
    'Los datos académicos del respaldo (docentes, asignaturas, notas, asistencia) son agregados analíticos y no se restauran en esta versión. La configuración institucional sí fue procesada.'
  );

  if (Object.keys(restored).length === 0) {
    throw new HttpsError('failed-precondition', 'El respaldo no contenía información institucional restaurable.');
  }

  await getDb().collection('institutions').doc(adminInstitutionId).set(update, { merge: true });

  const inst = await loadSchoolConfig(adminInstitutionId);
  return {
    institutionId: adminInstitutionId,
    institutionName: inst.name || adminSnap.data().institutionName || 'Institución',
    restored,
    skipped,
    warnings,
    schoolConfig: schoolConfigOut(inst),
    gradingWeight: gradingWeightOut(inst),
    periodos: periodosOut(inst),
    planRules: planRulesOut(inst),
  };
});

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
      const decoded = await getAuthInstance().verifyIdToken(idToken);
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
      const subStatus = event.data?.attributes?.status;
      const eventId = event.meta?.event_id || `${eventName}${subStatus ? `:${subStatus}` : ''}:${event.data?.id}`;
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
            trialEndsAt: getFieldValue().delete(),
            trialStartedAt: getFieldValue().delete(),
            // MEDIUM-5: el pago consume el derecho a prueba gratuita.
            trialUsed: true,
            ...(plan === 'school' ? { role: 'admin', institutionId: uid } : {}),
            ...(plan === 'school' && institutionName ? { institutionName } : {}),
            updatedAt: getFieldValue().serverTimestamp(),
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
            trialEndsAt: getFieldValue().delete(),
            trialStartedAt: getFieldValue().delete(),
            // MEDIUM-5: el pago consume el derecho a prueba gratuita.
            trialUsed: true,
            ...(plan === 'school' ? { role: 'admin', institutionId: uid } : {}),
            ...(plan === 'school' && institutionName ? { institutionName } : {}),
            updatedAt: getFieldValue().serverTimestamp(),
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
              trialEndsAt: getFieldValue().delete(),
              trialStartedAt: getFieldValue().delete(),
              // MEDIUM-5: el pago consume el derecho a prueba gratuita.
              trialUsed: true,
              ...(applySchoolAdmin
                ? { role: 'admin', institutionId: existing.institutionId || uid }
                : {}),
              ...(applySchoolAdmin && institutionName && !existing.institutionName
                ? { institutionName }
                : {}),
              updatedAt: getFieldValue().serverTimestamp(),
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
            trialEndsAt: getFieldValue().delete(),
            trialStartedAt: getFieldValue().delete(),
            // MEDIUM-5: el pago consume el derecho a prueba gratuita.
            trialUsed: true,
            lastPaymentAt: Date.now(),
            updatedAt: getFieldValue().serverTimestamp(),
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
      const decoded = await getAuthInstance().verifyIdToken(idToken);
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
