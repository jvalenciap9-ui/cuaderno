/**
 * test-stats-admin.mjs — Smoke test del módulo de métricas institucionales
 * (adminGetInstitutionStats) contra los emuladores.
 *
 * Requiere: emuladores corriendo (npm run emulators)
 * Uso:      node scripts/test-stats-admin.mjs
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';
import { doc, setDoc } from 'firebase/firestore';
import { signUp, callFunction } from './helpers.mjs';

const PROJECT_ID = 'ediagil-new-2026';
const RULES = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

let pass = 0;
let fail = 0;
const failures = [];

function record(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name} ${extra}`); }
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { host: 'localhost', port: 8081, rules: RULES },
});

const admin = async (fn) => testEnv.withSecurityRulesDisabled(fn);

const adminUser = await signUp('stats-admin-smoke@test.local');
const normalUser = await signUp('stats-normal-smoke@test.local');

const T = 'stats-teacher-smoke';
const ymd = (offsetDays) => {
  const d = new Date(NOW + offsetDays * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

await admin(async (ctx) => {
  const db = ctx.firestore();
  await db.collection('users').doc(adminUser.uid).set({
    plan: 'school', email: adminUser.email, displayName: 'Admin Smoke',
    role: 'admin', institutionId: 'inst-smoke', institutionName: 'Colegio Smoke',
    aiCallsThisMonth: 0, createdAt: NOW, updatedAt: NOW,
  });
  await db.collection('users').doc(T).set({
    plan: 'school', email: 'stats-teacher@test.local', displayName: 'Docente Stats',
    role: 'teacher', institutionId: 'inst-smoke', institutionName: 'Colegio Smoke',
    aiCallsThisMonth: 5, lastLoginAt: NOW, createdAt: NOW, updatedAt: NOW,
  });
  const subj1 = `${T}_mat1`, subj2 = `${T}_mat2`;
  await db.doc(`subjects/${subj1}`).set({ userId: T, name: 'Matemáticas', color: 'blue', teacher: 'T', schedule: 'Lun', createdAt: NOW });
  await db.doc(`subjects/${subj2}`).set({ userId: T, name: 'Física', color: 'red', teacher: 'T', schedule: 'Mar', createdAt: NOW });
  await db.doc(`students/${T}_est1`).set({ userId: T, subjectId: subj1, cedula: '1', firstName: 'Ana', lastName: 'López' });
  await db.doc(`students/${T}_est2`).set({ userId: T, subjectId: subj1, cedula: '2', firstName: 'Luis', lastName: 'Pérez' });
  await db.doc(`evaluations/${T}_ev1`).set({ userId: T, subjectId: subj1, title: 'Parcial 1', maxScore: 20, date: ymd(0), type: 'teorica' });
  await db.doc(`evaluations/${T}_ev2`).set({ userId: T, subjectId: subj2, title: 'Quiz', maxScore: 10, date: ymd(-3), type: 'practica' });
  await db.doc(`grades/${T}_g1`).set({ userId: T, subjectId: subj1, evaluationId: `${T}_ev1`, studentId: `${T}_est1`, score: 16 });
  await db.doc(`grades/${T}_g2`).set({ userId: T, subjectId: subj1, evaluationId: `${T}_ev1`, studentId: `${T}_est2`, score: 18 });
  await db.doc(`grades/${T}_g3`).set({ userId: T, subjectId: subj2, evaluationId: `${T}_ev2`, studentId: `${T}_est1`, score: 8 });
  const at = ['present', 'present', 'late', 'absent'];
  for (let i = 0; i < at.length; i++) {
    await db.doc(`attendance/${T}_at${i + 1}`).set({ userId: T, subjectId: subj1, studentId: `${T}_est1`, date: ymd(-2), status: at[i] });
  }
  await db.doc(`notes/${T}_n1`).set({ userId: T, subjectId: subj1, title: 'Apunte', date: ymd(-5), createdAt: NOW, updatedAt: NOW });
  await db.doc(`materials/${T}_m1`).set({ userId: T, subjectId: subj1, title: 'Libro', type: 'book', date: ymd(-4) });
  await db.doc(`calendarEvents/${T}_c1`).set({ userId: T, subjectId: subj1, title: 'Examen', date: ymd(-1), type: 'exam' });
});

console.log('\n🛡️ adminGetInstitutionStats (smoke)');

{
  const r0 = await callFunction('adminGetInstitutionStats', {}, normalUser.idToken);
  record('docente → permission-denied', r0?.body?.error?.status === 'PERMISSION_DENIED' || String(r0?.body?.error?.message || '').includes('Solo administradores'), JSON.stringify(r0.body));

  const r2 = await callFunction('adminGetInstitutionStats', {}, adminUser.idToken);
  record('admin → ok', r2.status === 200, `status=${r2.status} ${JSON.stringify(r2.body)}`);
  const s = r2?.body?.result;
  record('totals: 1 docente / 2 asig / 2 estud / 2 eval / 3 notas / 4 marc', s?.totals?.teachers === 1 && s?.totals?.subjects === 2 && s?.totals?.students === 2 && s?.totals?.evaluations === 2 && s?.totals?.gradesCount === 3 && s?.totals?.attendanceCount === 4, JSON.stringify(s?.totals));
  record('byPlan: school=1', s?.byPlan?.school === 1 && s?.byPlan?.free === 0, JSON.stringify(s?.byPlan));
  record('asistencia 2P/1T/1A → passRate=50', s?.attendance?.present === 2 && s?.attendance?.late === 1 && s?.attendance?.absent === 1 && s?.attendance?.passRate === 50, JSON.stringify(s?.attendance));
  record('sesiones = 1 (fecha única)', s?.totals?.sessions === 1, `sessions=${s?.totals?.sessions}`);
  const mat = (s?.subjectStats || []).find((x) => x.subjectName === 'Matemáticas');
  record('Matemáticas: avgPct=85, 4 marc (2P/1T/1A)', mat?.avgPct === 85 && mat?.attendanceTotal === 4 && mat?.attendancePresent === 2 && mat?.attendanceLate === 1 && mat?.attendanceAbsent === 1, JSON.stringify(mat));
  const fisica = (s?.subjectStats || []).find((x) => x.subjectName === 'Física');
  record('Física: avgPct=80', fisica?.avgPct === 80, JSON.stringify(fisica));
  // La nota de prueba está en ymd(-5), que puede caer en la semana ANTERIOR al
  // grupo de sesiones (ymd(-2)) según el día de la semana actual. Para no hacer
  // la aserción dependiente del día, se verifica el TOTAL agregado de las 8
  // semanas: cada tipo de actividad debe aparecer al menos una vez.
  const weeks = s?.weeklyActivity || [];
  const wk = weeks.find((w) => w.sessions > 0);
  const totalIn = (k) => weeks.reduce((a, w) => a + (w[k] || 0), 0);
  record('actividad semanal: sesiones+eval+notas+mat+eventos',
    !!wk && totalIn('sessions') >= 1 && totalIn('evaluations') >= 1
      && totalIn('notes') >= 1 && totalIn('materials') >= 1 && totalIn('events') >= 1,
    JSON.stringify(weeks));
  const tRow = (s?.teachers || []).find((t) => t.uid === T);
  record('docente: IA=5, activo 7d, school', tRow?.aiCallsThisMonth === 5 && tRow?.active7d === true && tRow?.plan === 'school', JSON.stringify(tRow));
  record('aiUsage agregado = 5', s?.aiUsage?.callsThisMonth === 5 && s?.aiUsage?.teachersWithUsage === 1, JSON.stringify(s?.aiUsage));
}

await testEnv.cleanup();
console.log(`\n═══════════════════════════════════`);
console.log(`RESULTADO: ${pass} PASS · ${fail} FAIL`);
console.log(`═══════════════════════════════════`);
if (failures.length) {
  for (const f of failures) console.log(`\n💥 ${f}`);
  process.exit(1);
}