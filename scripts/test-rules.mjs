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
for (const [name, email] of [['free', 'free@test.local'], ['pro', 'pro@test.local'], ['trialExp', 'trial-exp@test.local'], ['paidStale', 'paid-stale@test.local'], ['other', 'other@test.local'], ['fresh', 'fresh@test.local']]) {
  u[name] = await signUp(email);
}

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const base = (uid) => ({ plan: 'free', email: `${uid}@test.local`, createdAt: NOW, aiCallsThisMonth: 0, aiCallsResetAt: NOW });
  await setDoc(doc(db, 'users', u.trialExp.uid), { ...base(u.trialExp.uid), plan: 'pro', isTrial: true, trialStartedAt: NOW - 20 * DAY, trialEndsAt: NOW - 6 * DAY, trialUsed: true, paymentProvider: 'trial' });
  await setDoc(doc(db, 'users', u.paidStale.uid), { ...base(u.paidStale.uid), plan: 'pro', isTrial: true, trialStartedAt: NOW - 20 * DAY, trialEndsAt: NOW - 6 * DAY, trialUsed: true, paymentProvider: 'lemonsqueezy', expiresAt: NOW + 30 * DAY });
  await setDoc(doc(db, 'users', u.pro.uid), { ...base(u.pro.uid), plan: 'pro' });
  await setDoc(doc(db, 'users', u.free.uid), base(u.free.uid));
  await setDoc(doc(db, 'users', u.other.uid), base(u.other.uid));
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

await testEnv.cleanup();

console.log(`\n═══════════════════════════════════`);
console.log(`RESULTADO: ${pass} PASS · ${fail} FAIL`);
console.log(`═══════════════════════════════════`);
if (failures.length) {
  for (const f of failures) console.log(`\n💥 ${f.name}\n   ${f.err?.message}`);
  process.exit(1);
}

