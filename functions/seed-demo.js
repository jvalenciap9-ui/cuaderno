/*
 * seed-demo.js — Crea datos de ejemplo para grabar el video promocional.
 *
 * Usa la sesión del Firebase CLI (configstore/firebase-tools.json): intercambia
 * el refresh_token por un access_token de Google (scope cloud-platform) y
 * escribe en Firestore PRODUCCIÓN vía REST (mismo mecanismo que
 * `firebase firestore:delete`, que ignora las reglas de seguridad).
 *
 * Cuentas creadas:
 *   demo@ediagil.com            / Demo1234!   (admin institucional "Colegio Aurora")
 *   maestra.ana@ediagil.com     / Teacher1234! (docente)
 *   profe.carlos@ediagil.com    / Teacher1234! (docente)
 *
 * Uso: node seed-demo.js
 */
'use strict';

const path = require('path');
const fs = require('fs');

const PROJECT_ID = 'ediagil-new-2026';
const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const IDK = 'https://identitytoolkit.googleapis.com';

function loadRefreshToken() {
  const candidates = [
    path.join(process.env.USERPROFILE || '', '.config', 'configstore', 'firebase-tools.json'),
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      const rt = raw?.tokens?.refresh_token;
      if (!rt) throw new Error(`No hay refresh_token en ${p}`);
      console.log(`Sesión CLI cargada desde ${p} (${raw?.user?.email || '?'})`);
      return rt;
    }
  }
  throw new Error('No se encontró la sesión del Firebase CLI. Corre `firebase login` primero.');
}

const REFRESH_TOKEN = loadRefreshToken();
let TOKEN = null;

// API key web del proyecto, leída de la sesión del CLI (webconfig).
let WEB_API_KEY = null;
{
  const p = path.join(process.env.USERPROFILE || '', '.config', 'configstore', 'firebase-tools.json');
  if (fs.existsSync(p)) {
    WEB_API_KEY = JSON.parse(fs.readFileSync(p, 'utf8'))?.webconfig?.[PROJECT_ID]?.apiKey || null;
  }
}
if (!WEB_API_KEY) throw new Error('No se pudo leer la API key web del proyecto desde la sesión del CLI.');

async function getToken() {
  if (TOKEN) return TOKEN;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Fallo el intercambio de token: ' + JSON.stringify(data));
  TOKEN = data.access_token;
  return TOKEN;
}

const authHeaders = async () => ({ Authorization: `Bearer ${await getToken()}` });

// ── Firestore REST (PATCH con updateMask = merge/set parcial por campos) ──

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === 'number') return { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  throw new Error('Tipo no soportado: ' + typeof v + ' → ' + JSON.stringify(v));
}
function toFields(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = toValue(v);
  return out;
}

async function writeDoc(col, id, obj) {
  const fields = toFields(obj);
  const mask = Object.keys(fields)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join('&');
  const res = await fetch(`${BASE}/${col}/${encodeURIComponent(id)}?${mask}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`FIRESTORE ${col}/${id}: HTTP ${res.status} ${await res.text()}`);
}

function rid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const setDoc = (col, id, obj) => writeDoc(col, id, obj);
const addDoc = (col, id, obj) => writeDoc(col, id, obj);

// ── Identity Toolkit (crear cuentas y marcarlas verificadas) ──

async function lookupUser(email) {
  const res = await fetch(`${IDK}/v1/accounts:lookup?key=${WEB_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: [email] }),
  });
  const data = await res.json();
  return data.users && data.users.length ? data.users[0] : null;
}

async function createUser(email, password, displayName) {
  const existing = await lookupUser(email);
  if (existing) {
    console.log(`  👤 Ya existía: ${email}`);
    return existing.localId;
  }
  const res = await fetch(`${IDK}/v1/accounts:signUp?key=${WEB_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!data.localId) {
    if (data.error && data.error.message === 'EMAIL_EXISTS') {
      const res2 = await fetch(`${IDK}/v1/accounts:signInWithPassword?key=${WEB_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      });
      const data2 = await res2.json();
      if (data2.localId) {
        console.log(`  👤 Ya existía: ${email}`);
        return data2.localId;
      }
      throw new Error(`No se pudo recuperar ${email}: ${JSON.stringify(data2)}`);
    }
    throw new Error(`No se pudo crear ${email}: ${JSON.stringify(data)}`);
  }
  try {
    await fetch('https://www.googleapis.com/identitytoolkit/v3/relyingparty/setAccountInfo', {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, emailVerified: true }),
    });
  } catch (e) {
    console.warn(`  ⚠️ No se pudo marcar verificado ${email}: ${e.message}`);
  }
  console.log(`  👤 Cuenta creada: ${email} (${data.localId})`);
  return data.localId;
}

const now = Date.now();
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function iso(d) { return d.toISOString().slice(0, 10); }
function daysAgo(n) { return new Date(now - n * DAY_MS); }
function daysAhead(n) { return new Date(now + n * DAY_MS); }
function recentWeekdays(count) {
  const out = [];
  let d = daysAgo(20);
  for (let i = 0; i < 40 && out.length < count; i++) {
    const day = d.getDay();
    if (day >= 1 && day <= 5) out.push(iso(d));
    d = new Date(d.getTime() + DAY_MS);
  }
  return out;
}
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STUDENT_NAMES = [
  ['Sofía', 'Hernández', 'M'], ['Mateo', 'González', 'M'], ['Valentina', 'Rojas', 'F'],
  ['Santiago', 'Pérez', 'M'], ['Isabella', 'Molina', 'F'], ['Sebastián', 'Torres', 'M'],
  ['Camila', 'Ramírez', 'F'], ['Nicolás', 'Silva', 'M'], ['Gabriela', 'Vargas', 'F'],
  ['Diego', 'Castillo', 'M'], ['María', 'Flores', 'F'], ['Luis', 'Mendoza', 'M'],
  ['Daniela', 'Acosta', 'F'], ['Javier', 'Cordero', 'M'], ['Alejandra', 'Guerrero', 'F'],
  ['Andrés', 'Salazar', 'M'], ['Carolina', 'Blanco', 'F'], ['Emilio', 'Reyes', 'M'],
];
const STATUSES = ['present', 'present', 'present', 'present', 'present', 'late', 'absent'];

async function seedUsers() {
  const adminUid = await createUser('demo@ediagil.com', 'Demo1234!', 'Directora Elena Vargas');
  const instId = rid();
  await setDoc('institutions', instId, {
    name: 'Colegio Aurora',
    adminId: adminUid,
    createdAt: new Date(),
    subscription: { plan: 'school', docentes: 30, expiresAt: now + YEAR_MS },
    periodos: {
      matutino: { activo: true, horarioInicio: '07:00', horarioFin: '12:00' },
      vespertino: { activo: true, horarioInicio: '13:00', horarioFin: '18:00' },
      nocturno: { activo: false, horarioInicio: '18:00', horarioFin: '22:00' },
    },
    planRules: { reglaSeleccionada: 'trimestral', recomendarADocentes: true },
  });
  await setDoc('institutionUsers', adminUid, {
    userId: adminUid, role: 'admin', institutionId: instId, joinedAt: new Date(),
  });
  await setDoc('users', adminUid, {
    email: 'demo@ediagil.com',
    displayName: 'Directora Elena Vargas',
    createdAt: daysAgo(90).getTime(),
    lastLoginAt: now,
    plan: 'school',
    role: 'admin',
    institutionId: instId,
    institutionName: 'Colegio Aurora',
    paymentProvider: 'lemonsqueezy',
    expiresAt: now + YEAR_MS,
    isTrial: false,
    trialUsed: true,
    aiCallsThisMonth: 0,
    aiCallsResetAt: now,
    updatedAt: new Date(),
  });
  console.log(`  🏫 Institución "Colegio Aurora" = ${instId}`);

  const teachers = [
    { email: 'maestra.ana@ediagil.com', displayName: 'Prof. Ana Martínez' },
    { email: 'profe.carlos@ediagil.com', displayName: 'Prof. Carlos Ruiz' },
  ];
  const teacherUids = [];
  for (const t of teachers) {
    const uid = await createUser(t.email, 'Teacher1234!', t.displayName);
    teacherUids.push(uid);
    await setDoc('institutionUsers', uid, {
      userId: uid, role: 'teacher', institutionId: instId, joinedAt: new Date(),
    });
    await setDoc('users', uid, {
      email: t.email,
      displayName: t.displayName,
      createdAt: daysAgo(80).getTime(),
      lastLoginAt: daysAgo(1).getTime(),
      plan: 'school',
      role: 'teacher',
      institutionId: instId,
      institutionName: 'Colegio Aurora',
      isTrial: false,
      trialUsed: true,
      aiCallsThisMonth: 0,
      aiCallsResetAt: now,
      updatedAt: new Date(),
    });
    console.log(`  👩‍🏫 Docente: ${t.email}`);
  }
  return { adminUid, teacherUids, instId };
}

const TEACHER_SUBJECTS = [
  {
    teacher: 'maestra.ana@ediagil.com',
    subjects: [
      { name: 'Matemáticas — 1er Año A', color: '#6366f1', periodo: 'matutino', plan: 'trimestral', schedule: 'Lun · Mi · Vie — 8:00 a 9:30' },
      { name: 'Ciencias Naturales — 1er Año B', color: '#0ea5e9', periodo: 'vespertino', plan: 'trimestral', schedule: 'Mar · Jue — 1:00 a 2:30' },
    ],
  },
  {
    teacher: 'profe.carlos@ediagil.com',
    subjects: [
      { name: 'Lengua y Literatura — 2do Año B', color: '#10b981', periodo: 'matutino', plan: 'trimestral', schedule: 'Lun · Mi · Vie — 10:00 a 11:30' },
      { name: 'Estudios Sociales — 2do Año A', color: '#f59e0b', periodo: 'vespertino', plan: 'trimestral', schedule: 'Mar · Jue — 3:00 a 4:30' },
    ],
  },
];
const EVAL_TEMPLATES = [
  { title: 'Evaluación Parcial I', type: 'teorica', maxScore: 20 },
  { title: 'Trabajo Práctico: Resolución de Ejercicios', type: 'practica', maxScore: 20 },
  { title: 'Evaluación Apreciativa: Participación', type: 'apreciativa', maxScore: 20 },
];
const NOTES = [
  { title: 'Inicio de la unidad: repaso de conceptos previos', content: 'Se repasaron los contenidos del trimestre anterior. La mayoría del grupo domina los conceptos básicos; hacer énfasis en los ejercicios de aplicación.\n\nTarea para casa: resolver los ejercicios 1 al 5 de la guía de la unidad.' },
  { title: 'Dificultades con la resolución de problemas', content: 'Grupo dividido: un tercio resuelve con fluidez, el resto necesita acompañamiento paso a paso. Se formarán grupos de trabajo mixtos para la próxima clase.\n\nPlan de refuerzo: taller de ejemplos guiados el próximo jueves.' },
  { title: 'Clase práctica: trabajo en equipos', content: 'Se trabajó en equipos de 4 estudiantes. Buen ambiente, respeto de turnos y participación activa. Se recolectaron las guías resueltas para revisión.' },
];
const MATERIALS = [
  { type: 'book', title: 'Guía Didáctica de la Unidad', description: 'Material de apoyo entregado en clase para todo el trimestre.' },
  { type: 'video', title: 'Videos explicativos — Playlist', description: 'Colección de videos cortos por tema, disponibles para repasar en casa.' },
  { type: 'document', title: 'Plan de Evaluación del Trimestre', description: 'Fechas y porcentajes de cada evaluación.' },
];
const EVENTS = [
  { title: 'Evaluación Parcial I', type: 'exam', startTime: '08:00', endTime: '09:00' },
  { title: 'Entrega de trabajo práctico', type: 'deadline', startTime: null, endTime: null },
  { title: 'Salida pedagógica: museo', type: 'other', startTime: '09:00', endTime: '13:00' },
  { title: 'Clase de repaso previo al parcial', type: 'class', startTime: '08:00', endTime: '09:30' },
];

async function seedSubjectData(uid, teacherName, subTpl, index) {
  const rng = mulberry32(index * 7919 + uid.length * 31);
  const subjectId = rid();
  const createdAt = daysAgo(40 - index * 3).getTime();
  await setDoc('subjects', subjectId, {
    userId: uid,
    name: subTpl.name,
    color: subTpl.color,
    teacher: teacherName,
    schedule: subTpl.schedule,
    periodo: subTpl.periodo,
    plan: subTpl.plan,
    startDate: iso(daysAgo(45)),
    endDate: iso(daysAhead(75)),
    createdAt,
  });

  const students = [];
  const usedCedulas = new Set();
  let cedula = 26000000 + index * 97;
  for (let i = 0; i < 10; i++) {
    const [firstName, lastName, gender] = STUDENT_NAMES[(index * 10 + i) % STUDENT_NAMES.length];
    cedula += 37;
    let c = String(cedula);
    while (usedCedulas.has(c)) c = String(cedula + 1 + i);
    usedCedulas.add(c);
    const sId = rid();
    await addDoc('students', sId, { userId: uid, subjectId, cedula: c, firstName, lastName, gender });
    students.push(sId);
  }

  const modules = [];
  for (let m = 1; m <= 2; m++) {
    const modId = rid();
    await setDoc('subjectModules', modId, {
      userId: uid, subjectId, title: `Unidad ${m}: ${subTpl.name.split(' — ')[0]} — ${['Fundamentos', 'Aplicaciones'][m - 1]}`,
      description: `Contenidos centrales de la unidad ${m} del trimestre.`,
      order: m,
      createdAt: createdAt + m * DAY_MS,
      startDate: iso(daysAhead((m - 1) * 30)),
      endDate: iso(daysAhead(m * 30)),
    });
    modules.push(modId);
  }

  const evaluations = [];
  for (let e = 0; e < EVAL_TEMPLATES.length; e++) {
    const tpl = EVAL_TEMPLATES[e];
    const evalId = rid();
    await setDoc('evaluations', evalId, {
      userId: uid, subjectId, title: tpl.title, maxScore: tpl.maxScore,
      date: iso(daysAhead(7 + e * 14)), type: tpl.type, moduleId: modules[Math.min(e, 1)],
    });
    evaluations.push({ id: evalId, type: tpl.type });
  }

  for (const studentId of students) {
    for (const ev of evaluations) {
      const score = ev.type === 'apreciativa' ? 0 : Math.round((14 + rng() * 6) * 10) / 10;
      await addDoc('grades', rid(), {
        userId: uid, subjectId, evaluationId: ev.id, studentId, score,
      });
    }
  }

  const dates = recentWeekdays(6);
  for (const studentId of students) {
    for (const date of dates) {
      if (rng() < 0.97) {
        await addDoc('attendance', rid(), {
          userId: uid, subjectId, studentId, date, status: pick(rng, STATUSES), moduleId: modules[0],
        });
      }
    }
  }

  for (const n of NOTES.slice(0, 2 + (index % 2))) {
    await addDoc('notes', rid(), {
      userId: uid, subjectId, moduleId: modules[index % 2], title: n.title, content: n.content,
      date: iso(daysAgo(2 + index + Math.floor(rng() * 10))),
      attachment: null,
      createdAt: daysAgo(10).getTime(), updatedAt: daysAgo(1).getTime(),
    });
  }

  for (const m of MATERIALS) {
    await addDoc('materials', rid(), {
      userId: uid, subjectId, moduleId: modules[0], title: m.title, type: m.type,
      description: m.description, date: iso(daysAgo(15)),
    });
  }

  for (const ev of EVENTS) {
    await addDoc('calendarEvents', rid(), {
      userId: uid, subjectId, moduleId: modules[0], title: ev.title, type: ev.type,
      date: iso(daysAhead(2 + Math.floor(rng() * 20))), startTime: ev.startTime, endTime: ev.endTime,
    });
  }

  return { subjectId, students: students.length, evaluations: evaluations.length };
}

async function main() {
  const { adminUid, teacherUids, instId } = await seedUsers();
  const displayNames = { [teacherUids[0]]: 'Prof. Ana Martínez', [teacherUids[1]]: 'Prof. Carlos Ruiz' };

  let count = 0;
  for (let t = 0; t < TEACHER_SUBJECTS.length; t++) {
    const tpl = TEACHER_SUBJECTS[t];
    const uid = tpl.teacher === TEACHER_SUBJECTS[0].teacher ? teacherUids[0] : teacherUids[1];
    for (const sub of tpl.subjects) {
      const res = await seedSubjectData(uid, displayNames[uid], sub, count);
      console.log(`  📚 ${sub.name} → ${res.students} estudiantes, ${res.evaluations} evaluaciones, ${res.subjectId}`);
      count++;
    }
    await setDoc('userCounters', uid, {
      count: tpl.subjects.length,
      createdThisYear: tpl.subjects.length,
      yearKey: String(1970 + Math.floor(now / 31557600000)),
    });
  }

  const adminSub = await seedSubjectData(
    adminUid, 'Directora Elena Vargas',
    { name: 'Gestión Pedagógica — Reuniones de Coordinación', color: '#8b5cf6', periodo: 'nocturno', plan: 'mensual', schedule: 'Vie — 5:00 a 6:30' },
    count
  );
  console.log(`  📚 Gestión Pedagógica (admin) → ${adminSub.students} estudiantes`);
  await setDoc('userCounters', adminUid, {
    count: 1, createdThisYear: 1, yearKey: String(1970 + Math.floor(now / 31557600000)),
  });

  console.log('\n✅ SEED COMPLETADO');
  console.log('──────────────────────────────────────────────');
  console.log(`Institución: "Colegio Aurora" (${instId})`);
  console.log('Cuentas para grabar:');
  console.log('  Admin    → demo@ediagil.com         / Demo1234!');
  console.log('  Docente  → maestra.ana@ediagil.com  / Teacher1234!');
  console.log('  Docente  → profe.carlos@ediagil.com / Teacher1234!');
  console.log('──────────────────────────────────────────────');
  process.exit(0);
}

main().catch((err) => { console.error('❌ SEED FALLÓ:', err); process.exit(1); });