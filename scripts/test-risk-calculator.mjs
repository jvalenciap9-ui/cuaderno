/**
 * test-risk-calculator.mjs — Sprint 1 Métricas: validación de la lógica pura de
 * riesgo estudiantil (functions/lib/risk-calculator.js). Cubre los umbrales:
 * asistencia <80% → medio, <70% → alto; nota <60% en 1 materia → medio, en 2+
 * → alto; combinación de asistencia y notas → alto; y estados sin riesgo.
 *
 * Uso: node scripts/test-risk-calculator.mjs   (no requiere emulador)
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { calculateStudentRisk, generateRecommendations, THRESHOLDS } = require('../functions/lib/risk-calculator.js');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name} ${extra}`); }
}

console.log('── umbrales ──');
check('umbrales configurados (80/70/60)',
  THRESHOLDS.attendanceMedium === 80 && THRESHOLDS.attendanceHigh === 70 && THRESHOLDS.gradeFail === 60);

console.log('── asistencia ──');
check('asistencia 90% y notas ok → bajo',
  (() => { const r = calculateStudentRisk(90, [80, 85, 90]); return r.level === 'low' && r.reasons.length === 0; })());
check('asistencia 85% y notas ok → bajo',
  calculateStudentRisk(85, [70, 80]).level === 'low');
check('asistencia 79% → medio (>=70 y <80)',
  (() => { const r = calculateStudentRisk(79, [80, 85]); return r.level === 'medium' && r.reasons.some((x) => x.includes('Asistencia')); })());
check('asistencia 69% → alto (<70)',
  (() => { const r = calculateStudentRisk(69, [80, 85]); return r.level === 'high' && r.reasons.some((x) => x.includes('Asistencia baja')); })());
check('asistencia exactamente 80 → bajo',
  calculateStudentRisk(80, [80, 85]).level === 'low');
check('asistencia exactamente 70 → medio',
  calculateStudentRisk(70, [80, 85]).level === 'medium');
check('asistencia null y notas ok → bajo',
  calculateStudentRisk(null, [80, 85]).level === 'low');

console.log('── notas ──');
check('1 materia <60 → medio',
  (() => { const r = calculateStudentRisk(90, [55, 80, 90]); return r.level === 'medium' && r.reasons.some((x) => x.includes('1 materia')); })());
check('2+ materias <60 → alto',
  (() => { const r = calculateStudentRisk(90, [45, 50, 80]); return r.level === 'high' && r.reasons.some((x) => x.includes('2 materias')); })());
check('nota exactamente 60 no cuenta como reprobada',
  calculateStudentRisk(90, [60, 70]).level === 'low');
check('nota null se ignora',
  calculateStudentRisk(90, [null, 80]).level === 'low');

console.log('── combinación → alto ──');
check('asistencia media + 1 nota baja → alto',
  calculateStudentRisk(75, [50, 80]).level === 'high');
check('asistencia media + notas ok → medio',
  calculateStudentRisk(75, [80, 85]).level === 'medium');
check('asistencia ok + 1 nota baja → medio',
  calculateStudentRisk(85, [50, 80]).level === 'medium');
check('asistencia alta (<70) + nota baja → alto',
  calculateStudentRisk(60, [50, 80]).level === 'high');
check('asistencia alta (<70) + notas ok → alto',
  calculateStudentRisk(60, [80, 85]).level === 'high');
check('combinación incluye razón de combinación',
  (() => { const r = calculateStudentRisk(75, [50, 80]); return r.reasons.some((x) => x.includes('Combinación')); })());

console.log('── robustez ──');
check('sin argumentos → bajo',
  (() => { const r = calculateStudentRisk(); return r.level === 'low' && Array.isArray(r.reasons); })());
check('gradePcts no array se ignora',
  calculateStudentRisk(90, 'no-array').level === 'low');
check('niveles son low/medium/high',
  (() => { const levels = ['low', 'medium', 'high']; return [calculateStudentRisk(90, [80]), calculateStudentRisk(75, [80]), calculateStudentRisk(60, [50])].every((r) => levels.includes(r.level)); })());

console.log('── generateRecommendations ──');
check('asistencia <80 → contacto al acudiente y reunión',
  (() => { const r = generateRecommendations('medium', 75, 0); return r.some((x) => x.includes('acudiente')) && r.some((x) => x.includes('reunión')); })());
check('2 materias bajas → refuerzo y tutorías',
  (() => { const r = generateRecommendations('high', 90, 2); return r.some((x) => x.includes('refuerzo') && x.includes('2 materias')) && r.some((x) => x.includes('tutorías')); })());
check('riesgo alto → atención prioritaria',
  generateRecommendations('high', 90, 0).some((x) => x.includes('Priorizar')));
check('riesgo bajo → seguimiento positivo',
  generateRecommendations('low', 90, 0).some((x) => x.includes('positivo')));
check('sin condiciones → monitoreo regular',
  generateRecommendations('medium', 85, 0).some((x) => x.includes('monitoreo')));
check('combinación completa (asistencia 65 + 2 bajas + alto)',
  (() => {
    const r = generateRecommendations('high', 65, 2);
    return r.some((x) => x.includes('acudiente')) && r.some((x) => x.includes('refuerzo')) && r.some((x) => x.includes('Priorizar'));
  })());

console.log('\n──────────────────────────────');
console.log(`Resultado: ${pass} ✅ / ${fail} ❌`);
if (fail > 0) {
  console.log('Fallos:', failures.join(', '));
  process.exit(1);
}
