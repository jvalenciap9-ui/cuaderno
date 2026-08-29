/**
 * test-rules.mjs — Fase 1: auditoría de firestore.rules contra el emulador.
 *
 * Requiere: emuladores + seed (node scripts/seed-emulator.mjs)
 * Uso:      node scripts/test-rules.mjs
 */
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';
import { doc, setDoc, updateDoc, getDoc, getDocs, deleteDoc, collection, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import { signUp } from './helpers.mjs';

const PROJECT_ID = 'ediagil-new-2026';
const RULES = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const YEAR = String(new Date().getFullYear());

let pass = 0;
let fail = 0;
const failures = [];

function check(name, fn) {
  return fn().then(
    () => { pass++; console.log(`  ✅ ${name}`); },
    (err) => { fail++; failures.push({ name, err }); console.log(`  ❌ ${name} — ${err?.message}`); },
  );
}

function expectSucceeds(name, promise) {
  return check(name, () => assertSucceeds(promise));
}
function expectFails(name, promise) {
  return check(name, () => assertFails(promise));
}

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { host: 'localhost', port: 8081, rules: RULES },
});

// Idempotencia: el emulador persiste entre ejecuciones; limpiar garantiza un
// estado conocido (los usuarios de Auth se re-sembran abajo o se reutilizan).
await testEnv.clearFirestore();

// ── Preparación: crear usuarios de auth y sembrar estados con reglas OFF ──
const u = {};
for (const [name, email] of [['free', 'free@test.local'], ['pro', 'pro@test.local'], ['trialExp', 'trial-exp@test.local'], ['paidStale', 'paid-stale@test.local'], ['other', 'other@test.local'], ['fresh', 'fresh@test.local'], ['teacherB', 'teacherB@test.local'], ['admin', 'admin@test.local']]) {
  u[name] = await signUp(email);
}

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const base = (uid) => ({ plan: 'free', email: `${uid}@test.local`, createdAt: NOW, aiCallsThisMonth: 0, aiCallsResetAt: NOW });
  await setDoc(doc(db, 'users', u.trialExp.uid), { ...base(u.trialExp.uid), plan: 'pro', isTrial: true, trialStartedAt: NOW - 20 * DAY, trialEndsAt: NOW - 6 * DAY, trialUsed: true, paymentProvider: 'trial' });
  await setDoc(doc(db, 'users', u.paidStale.uid), { ...base(u.paidStale.uid), plan: 'pro', isTrial: true, trialStartedAt: NOW - 20 * DAY, trialEndsAt: NOW - 6 * DAY, trialUsed: true, paymentProvider: 'lemonsqueezy', expiresAt: NOW + 30 * DAY });
  await setDoc(doc(db, 'users', u.pro.uid), { ...base(u.pro.uid), plan: 'pro' });
  await setDoc(doc(db, 'users', u.teacherB.uid), { ...base(u.teacherB.uid), plan: 'pro' });
  await setDoc(doc(db, 'users', u.free.uid), base(u.free.uid));
  await setDoc(doc(db, 'users', u.other.uid), base(u.other.uid));
  await setDoc(doc(db, 'users', u.admin.uid), { ...base(u.admin.uid), plan: 'school', role: 'admin', institutionId: 'inst-test-100' });
  await setDoc(doc(db, 'institutions', 'inst-test-100'), { name: 'Colegio Test', adminUid: u.admin.uid, createdAt: NOW });
  await setDoc(doc(db, 'institutionUsers', u.admin.uid), { userId: u.admin.uid, role: 'admin', institutionId: 'inst-test-100', createdAt: NOW });
});

// ── Helpers ──
function makeSubject(id, uid, name = 'Asignatura') {
  return { userId: uid, name, color: '#123456', teacher: 'Prof', schedule: 'L 8:00' };
}

function counterData(uid, count, yearCount = count, year = YEAR, writes = 1, windowStart = NOW) {
  return { subjectCount: count, createdThisYear: yearCount, yearKey: year, updatedAt: NOW, writes, writeWindowStart: windowStart };
}

async function createSubjectWithCounter(db, uid, count, yearCount, year = YEAR) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'userCounters', uid), counterData(uid, count, yearCount, year));
  batch.set(doc(db, 'subjects', `sub-${uid}-${count}`), makeSubject(`sub-${uid}-${count}`, uid));
  return batch.commit();
}

// ── 1. Límite de asignaturas por plan ──
console.log('\n📦 Límite de asignaturas (reglas)');
{
  const freeCtx = testEnv.authenticatedContext(u.free.uid);
  const db = freeCtx.firestore();

  await expectSucceeds('Free: 1ª asignatura con contador 0→1', createSubjectWithCounter(db, u.free.uid, 1, 1));
  await expectSucceeds('Free: 2ª asignatura con contador 1→2', createSubjectWithCounter(db, u.free.uid, 2, 2));
  await expectFails('Free: 3ª asignatura 2→3 DENEGADA', createSubjectWithCounter(db, u.free.uid, 3, 3));
  await expectFails('Free: crear asignatura SIN tocar contador DENEGADA',
    setDoc(doc(db, 'subjects', 'sub-sin-contador'), makeSubject('sub-sin-contador', u.free.uid)));

const proCtx = testEnv.authenticatedContext(u.pro.uid);
  const dbPro = proCtx.firestore();
  await expectSucceeds('Pro: 1ª asignatura PERMITIDA', createSubjectWithCounter(dbPro, u.pro.uid, 1, 1));
  await expectSucceeds('Pro: 2ª asignatura PERMITIDA', createSubjectWithCounter(dbPro, u.pro.uid, 2, 2));
  await expectSucceeds('Pro: 3ª asignatura 2→3 PERMITIDA',
    createSubjectWithCounter(dbPro, u.pro.uid, 3, 3));
}

// ── 2. Trial expirado = free; pagado con trial stale = pro ──
console.log('\n⏰ Trial expirado (HR-01)');
{
  const expCtx = testEnv.authenticatedContext(u.trialExp.uid);
  const db = expCtx.firestore();
  await expectSucceeds('Trial activo (1ª asignatura)',
    createSubjectWithCounter(db, u.trialExp.uid, 1, 1));
  await expectSucceeds('Trial activo (2ª asignatura)',
    createSubjectWithCounter(db, u.trialExp.uid, 2, 2));
  await expectFails('Trial EXpirado: 3ª asignatura DENEGADA (se trata como free)',
    createSubjectWithCounter(db, u.trialExp.uid, 3, 3));

  const paidCtx = testEnv.authenticatedContext(u.paidStale.uid);
  const dbPaid = paidCtx.firestore();
  await expectSucceeds('Pagado con trial stale: 1ª asignatura PERMITIDA',
    createSubjectWithCounter(dbPaid, u.paidStale.uid, 1, 1));
  await expectSucceeds('Pagado con trial stale: 2ª asignatura PERMITIDA',
    createSubjectWithCounter(dbPaid, u.paidStale.uid, 2, 2));
  await expectSucceeds('Pagado con trial stale: 3ª asignatura PERMITIDA (nunca se degrada)',
    createSubjectWithCounter(dbPaid, u.paidStale.uid, 3, 3));
}

// ── 3. userCounters: manipulación directa ──
console.log('\n🔢 userCounters (integridad del contador)');
{
  const ctx = testEnv.authenticatedContext(u.free.uid);
  const db = ctx.firestore();
  await expectFails('Inflar contador a 100 sin crear asignatura DENEGADA',
    setDoc(doc(db, 'userCounters', u.free.uid), counterData(u.free.uid, 100, 100)));
  await expectFails('Saltar de 2 a 5 (delta ≠ 1) DENEGADA',
    setDoc(doc(db, 'userCounters', u.free.uid), counterData(u.free.uid, 5, 5)));
  await expectFails('yearKey del año pasado DENEGADA',
    setDoc(doc(db, 'userCounters', u.free.uid), counterData(u.free.uid, 3, 1, '2025')));
  await expectFails('Reset a 0 sin instrumentación de writes DENEGADA',
    setDoc(doc(db, 'userCounters', u.free.uid), counterData(u.free.uid, 0, 2)));
  await expectFails('Borrar userCounters DENEGADO', deleteDoc(doc(db, 'userCounters', u.free.uid)));
}

// ── 4. Campos sensibles del perfil ──
console.log('\n🛡️ users: campos sensibles backend-only');
{
  const ctx = testEnv.authenticatedContext(u.free.uid);
  const db = ctx.firestore();
  const ref = doc(db, 'users', u.free.uid);

  await expectFails('Cliente cambia plan a pro DENEGADO', updateDoc(ref, { plan: 'pro' }));
  await expectFails('Cliente escribe isTrial DENEGADO', updateDoc(ref, { isTrial: true }));
  await expectFails('Cliente escribe trialEndsAt DENEGADO', updateDoc(ref, { trialEndsAt: NOW + 10 * DAY }));
  await expectSucceeds('Cliente actualiza lastLoginAt PERMITIDO', updateDoc(ref, { lastLoginAt: NOW }));

  await expectFails('Crear perfil con plan pro DENEGADO',
    setDoc(doc(db, 'users', u.free.uid), { plan: 'pro', email: 'x@x.com', createdAt: NOW, aiCallsThisMonth: 0 }));
  await expectSucceeds('Crear perfil free válido PERMITIDO',
    setDoc(doc(testEnv.authenticatedContext(u.fresh.uid).firestore(), 'users', u.fresh.uid),
      { plan: 'free', email: u.fresh.email, createdAt: NOW, aiCallsThisMonth: 0 }));
  await expectFails('Borrar propio perfil DENEGADO', deleteDoc(ref));
}

// ── 5. licenseKeys inaccesibles ──
console.log('\n🔑 licenseKeys');
{
  const ctx = testEnv.authenticatedContext(u.free.uid);
  const db = ctx.firestore();
  await expectFails('Leer licenseKey DENEGADO', getDoc(doc(db, 'licenseKeys', 'PRO-TEST-0001')));
  await expectFails('Listar licenseKeys DENEGADO', getDocs(query(collection(db, 'licenseKeys'), where('used', '==', false))));
  await expectFails('Escribir licenseKey DENEGADO', setDoc(doc(db, 'licenseKeys', 'HACK-0001'), { plan: 'pro' }));
}

// ── 6. Aislamiento entre usuarios ──
console.log('\n🔒 Aislamiento entre usuarios');
{
  const otherCtx = testEnv.authenticatedContext(u.other.uid);
  const dbOther = otherCtx.firestore();
  await expectFails('Leer asignatura ajena DENEGADO', getDoc(doc(dbOther, 'subjects', 'sub-sin-contador')));
  await expectFails('Actualizar asignatura ajena DENEGADO',
    updateDoc(doc(dbOther, 'subjects', 'sub-sin-contador'), { name: 'Hack' }));
  await expectFails('Leer perfil ajeno DENEGADO', getDoc(doc(dbOther, 'users', u.free.uid)));
}

// ── 7. Aulas Multiasignatura (classGroups & reglas de seguridad) ──
console.log('\n🏫 Aulas Multiasignatura (classGroups & seguridad)');
{
  const ctxA = testEnv.authenticatedContext(u.pro.uid);
  const dbA = ctxA.firestore();
  const ctxB = testEnv.authenticatedContext(u.teacherB.uid);
  const dbB = ctxB.firestore();
  const dbAnon = testEnv.unauthenticatedContext().firestore();

  // 7.1 Casos permitidos (Docente Propietario A)
  const groupAData = { userId: u.pro.uid, name: '3.º A', modalidad: 'varias', createdAt: NOW, updatedAt: NOW, nivelEducativo: 'primaria', grado: '3', seccion: 'A' };
  await expectSucceeds('Docente A: Crear su Aula/Grupo', setDoc(doc(dbA, 'classGroups', 'cg-aula-3a'), groupAData));
  await expectSucceeds('Docente A: Leer su Aula/Grupo', getDoc(doc(dbA, 'classGroups', 'cg-aula-3a')));

  const subMathA = { userId: u.pro.uid, name: 'Matemáticas', color: '#123456', teacher: 'Prof A', schedule: 'L 8:00', groupId: 'cg-aula-3a' };
  const subSpanishA = { userId: u.pro.uid, name: 'Español', color: '#654321', teacher: 'Prof A', schedule: 'M 8:00', groupId: 'cg-aula-3a' };
  await expectSucceeds('Docente A: Crear materia interna Matemáticas', setDoc(doc(dbA, 'subjects', 'sub-math-3a'), subMathA));
  await expectSucceeds('Docente A: Crear materia interna Español', setDoc(doc(dbA, 'subjects', 'sub-spanish-3a'), subSpanishA));
  await expectSucceeds('Docente A: Actualizar su materia', updateDoc(doc(dbA, 'subjects', 'sub-math-3a'), { schedule: 'L 9:00' }));

  const studentAData = { userId: u.pro.uid, subjectId: 'sub-math-3a', cedula: 'V-11111111', firstName: 'Juan', lastName: 'Pérez' };
  await expectSucceeds('Docente A: Crear estudiante compartido bajo canónica', setDoc(doc(dbA, 'students', 'stu-juan-3a'), studentAData));
  await expectSucceeds('Docente A: Registrar asistencia diaria', setDoc(doc(dbA, 'attendance', 'att-juan-1'), { userId: u.pro.uid, subjectId: 'sub-math-3a', studentId: 'stu-juan-3a', date: '2026-08-27', status: 'present' }));

  const evalMathA = { userId: u.pro.uid, subjectId: 'sub-math-3a', title: 'Examen 1', maxScore: 100, date: '2026-08-27', type: 'teorica' };
  const evalSpanishA = { userId: u.pro.uid, subjectId: 'sub-spanish-3a', title: 'Lectura 1', maxScore: 100, date: '2026-08-27', type: 'practica' };
  await expectSucceeds('Docente A: Crear evaluación de Matemáticas', setDoc(doc(dbA, 'evaluations', 'ev-math-1'), evalMathA));
  await expectSucceeds('Docente A: Crear evaluación de Español', setDoc(doc(dbA, 'evaluations', 'ev-spanish-1'), evalSpanishA));

  await expectSucceeds('Docente A: Guardar nota de Matemáticas (misma materia)', setDoc(doc(dbA, 'grades', 'gr-math-1'), { userId: u.pro.uid, subjectId: 'sub-math-3a', evaluationId: 'ev-math-1', studentId: 'stu-juan-3a', score: 95 }));
  await expectSucceeds('Docente A: Guardar nota de Español (estudiante canónico en materia hermana del mismo aula)', setDoc(doc(dbA, 'grades', 'gr-spanish-1'), { userId: u.pro.uid, subjectId: 'sub-spanish-3a', evaluationId: 'ev-spanish-1', studentId: 'stu-juan-3a', score: 88 }));
  await expectFails('Docente A: Guardar nota con evaluationId de Español en subjectId de Matemáticas DENEGADO por desajuste de materia', setDoc(doc(dbA, 'grades', 'gr-mismatch-1'), { userId: u.pro.uid, subjectId: 'sub-math-3a', evaluationId: 'ev-spanish-1', studentId: 'stu-juan-3a', score: 88 }));

  // 7.2 Casos prohibidos (Docente No Propietario B)
  await expectFails('Docente B: Leer el aula de Docente A DENEGADO', getDoc(doc(dbB, 'classGroups', 'cg-aula-3a')));
  await expectFails('Docente B: Vincular materia propia a groupId ajeno DENEGADO', setDoc(doc(dbB, 'subjects', 'sub-hack-b'), { userId: u.teacherB.uid, name: 'Hack B', color: '#000000', teacher: 'Prof B', schedule: 'V 8:00', groupId: 'cg-aula-3a' }));
  await expectFails('Docente B: Consultar estudiante de Docente A DENEGADO', getDoc(doc(dbB, 'students', 'stu-juan-3a')));
  await expectFails('Docente B: Modificar asistencia de Docente A DENEGADA', setDoc(doc(dbB, 'attendance', 'att-juan-1'), { userId: u.teacherB.uid, subjectId: 'sub-math-3a', studentId: 'stu-juan-3a', date: '2026-08-27', status: 'absent' }));
  await expectFails('Docente B: Leer nota de Docente A DENEGADA', getDoc(doc(dbB, 'grades', 'gr-math-1')));
  await expectFails('Docente B: Crear nota cruzada con subjectId ajeno DENEGADA', setDoc(doc(dbB, 'grades', 'gr-hack-b'), { userId: u.teacherB.uid, subjectId: 'sub-spanish-3a', evaluationId: 'ev-spanish-1', studentId: 'stu-juan-3a', score: 100 }));
  await expectFails('Docente B: Cambiar userId para apropiarse de aula ajena DENEGADO', updateDoc(doc(dbA, 'classGroups', 'cg-aula-3a'), { userId: u.teacherB.uid }));

  // 7.3 Usuario Free
  const ctxFree = testEnv.authenticatedContext(u.free.uid);
  const dbFree = ctxFree.firestore();
  const freeGroupData = { userId: u.free.uid, name: 'Aula Free', modalidad: 'varias', createdAt: NOW, updatedAt: NOW };
  await expectFails('Usuario Free: Crear Aula Multiasignatura DENEGADO', setDoc(doc(dbFree, 'classGroups', 'cg-free-1'), freeGroupData));

  // 7.3 Usuario Anónimo / No Autenticado
  await expectFails('Anónimo: Leer classGroups DENEGADO', getDoc(doc(dbAnon, 'classGroups', 'cg-aula-3a')));
  await expectFails('Anónimo: Leer materias DENEGADO', getDoc(doc(dbAnon, 'subjects', 'sub-math-3a')));
  await expectFails('Anónimo: Leer estudiantes DENEGADO', getDoc(doc(dbAnon, 'students', 'stu-juan-3a')));
  await expectFails('Anónimo: Leer asistencia DENEGADO', getDoc(doc(dbAnon, 'attendance', 'att-juan-1')));
  await expectFails('Anónimo: Leer evaluaciones DENEGADO', getDoc(doc(dbAnon, 'evaluations', 'ev-math-1')));
  await expectFails('Anónimo: Leer calificaciones DENEGADO', getDoc(doc(dbAnon, 'grades', 'gr-math-1')));
  await expectFails('Anónimo: Crear classGroup DENEGADO', setDoc(doc(dbAnon, 'classGroups', 'cg-anon'), groupAData));

  // 7.4 Institucional
  const ctxAdmin = testEnv.authenticatedContext(u.admin.uid);
  const dbAdmin = ctxAdmin.firestore();
  await expectSucceeds('Admin: Consultar su institución', getDoc(doc(dbAdmin, 'institutions', 'inst-test-100')));
  await expectFails('Admin: Modificar calificaciones directamente DENEGADO', setDoc(doc(dbAdmin, 'grades', 'gr-admin-hack'), { userId: u.admin.uid, subjectId: 'sub-math-3a', evaluationId: 'ev-math-1', studentId: 'stu-juan-3a', score: 100 }));
  await expectFails('Admin: Modificar asistencia directamente DENEGADA', setDoc(doc(dbAdmin, 'attendance', 'att-admin-hack'), { userId: u.admin.uid, subjectId: 'sub-math-3a', studentId: 'stu-juan-3a', date: '2026-08-27', status: 'present' }));
  await expectFails('Docente: Modificar institución ajena DENEGADO', updateDoc(doc(dbA, 'institutions', 'inst-test-100'), { name: 'Hack Name' }));
}

await testEnv.cleanup();

console.log(`\n═══════════════════════════════════`);
console.log(`RESULTADO: ${pass} PASS · ${fail} FAIL`);
console.log(`═══════════════════════════════════`);
if (failures.length) {
  for (const f of failures) console.log(`\n💥 ${f.name}\n   ${f.err?.message}`);
  process.exit(1);
}

