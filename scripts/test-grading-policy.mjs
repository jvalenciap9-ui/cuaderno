/**
 * test-grading-policy.mjs — Política institucional de ponderaciones (PARTE B).
 * Verifica:
 *   a) La matriz de prioridad resolveEffectiveGradingWeight
 *      (functions/lib/grading-policy.js, espejo de gradingUtils.getEffectiveGradingWeight):
 *      docente institucional NO puede editar; admin institucional sí; el
 *      individual (Premium Pro) conserva su personal; applyTo ya NO decide.
 *   b) Validaciones de la ponderación (functions/lib/grading-weight.js):
 *      suma 100 válida; 90 rechazada; negativo/NaN/Infinity/>100 rechazados;
 *      personalizada vacía o con <2 categorías rechazada.
 *   c) gradingWeightOut expone auditoría (updatedAt millis, updatedBy) y es
 *      tolerante a documentos sin auditoría (compatibilidad hacia atrás).
 *
 * Uso: node scripts/test-grading-policy.mjs   (no requiere emulador)
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { resolveEffectiveGradingWeight } = require('../functions/lib/grading-policy.js');
const { sanitizeGradingWeightInput, gradingWeightOut } = require('../functions/lib/grading-weight.js');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name} ${extra}`); }
}

function expectGradingFail(name, payload) {
  try {
    sanitizeGradingWeightInput(payload);
    check(name, false, '(no lanzó error)');
  } catch (err) {
    check(name, err && typeof err.message === 'string' && err.message.startsWith('GRADING_'), `(got ${err?.message})`);
  }
}

const INST_W = { mode: 'tradicional', weights: { teoria: 30, practica: 60, apreciativa: 10 }, customWeights: {}, applyTo: 'global' };
const PERSONAL_W = { mode: 'tradicional', weights: { teoria: 50, practica: 30, apreciativa: 20 }, customWeights: {}, applyTo: 'global' };

// ── a) Matriz de prioridad ──────────────────────────────────────────────────
console.log('── resolveEffectiveGradingWeight (matriz de prioridad) ──');

const teacher = resolveEffectiveGradingWeight({ isInstitutionalMember: true, isAdmin: false }, PERSONAL_W, INST_W);
check('docente institucional: usa la institucional', teacher.weight === INST_W);
check('docente institucional: NO puede editar', teacher.canEdit === false);
check('docente institucional: source institucional', teacher.source === 'institutional');

const teacherNoInst = resolveEffectiveGradingWeight({ isInstitutionalMember: true, isAdmin: false }, PERSONAL_W, null);
check('docente institucional sin institucional legible: weight null (no personal)', teacherNoInst.weight === null);
check('docente institucional sin institucional: sigue sin poder editar', teacherNoInst.canEdit === false);

const admin = resolveEffectiveGradingWeight({ isInstitutionalMember: true, isAdmin: true }, PERSONAL_W, INST_W);
check('admin institucional: usa la institucional', admin.weight === INST_W);
check('admin institucional: PUEDE editar', admin.canEdit === true);

const premium = resolveEffectiveGradingWeight({ isInstitutionalMember: false, isAdmin: false }, PERSONAL_W, null);
check('Premium Pro individual: conserva su personal', premium.weight === PERSONAL_W);
check('Premium Pro individual: puede editar', premium.canEdit === true);

const individual = resolveEffectiveGradingWeight({ isInstitutionalMember: false, isAdmin: false }, null, null);
check('individual sin configuración: weight null, puede editar', individual.weight === null && individual.canEdit === true);

const overrideInst = { ...INST_W, applyTo: 'override' };
const globalInst = { ...INST_W, applyTo: 'global' };
const legacyGlobal = resolveEffectiveGradingWeight({ isInstitutionalMember: true, isAdmin: false }, PERSONAL_W, globalInst);
const legacyOverride = resolveEffectiveGradingWeight({ isInstitutionalMember: true, isAdmin: false }, PERSONAL_W, overrideInst);
check('applyTo global ya NO da prioridad al docente', legacyGlobal.weight === globalInst);
check('applyTo override: institucional gana igual (sin efecto)', legacyOverride.weight === overrideInst);

// ── b) Validaciones ─────────────────────────────────────────────────────────
console.log('── sanitizeGradingWeightInput (validaciones) ──');

let okSum100 = null;
try { okSum100 = sanitizeGradingWeightInput({ mode: 'tradicional', applyTo: 'global', weights: { teoria: 40, practica: 40, apreciativa: 20 } }); } catch { okSum100 = null; }
check('suma 100 → válida', okSum100 !== null && okSum100.weights.teoria === 40);

expectGradingFail('suma 90 → rechazada', { mode: 'tradicional', applyTo: 'global', weights: { teoria: 30, practica: 40, apreciativa: 20 } });
expectGradingFail('peso negativo → rechazado', { mode: 'tradicional', applyTo: 'global', weights: { teoria: -10, practica: 80, apreciativa: 30 } });
expectGradingFail('peso NaN → rechazado', { mode: 'tradicional', applyTo: 'global', weights: { teoria: NaN, practica: 60, apreciativa: 10 } });
expectGradingFail('peso Infinity → rechazado', { mode: 'tradicional', applyTo: 'global', weights: { teoria: Infinity, practica: 60, apreciativa: 10 } });
expectGradingFail('peso > 100 → rechazado', { mode: 'tradicional', applyTo: 'global', weights: { teoria: 120, practica: 0, apreciativa: -20 } });
expectGradingFail('personalizada vacía → rechazada', { mode: 'personalizada', applyTo: 'global', customWeights: {} });
expectGradingFail('personalizada con 1 categoría → rechazada', { mode: 'personalizada', applyTo: 'global', customWeights: { A: 100 } });
expectGradingFail('personalizada suma 90 → rechazada', { mode: 'personalizada', applyTo: 'global', customWeights: { A: 40, B: 30, C: 20 } });
expectGradingFail('modo inválido → rechazado', { mode: 'libre', applyTo: 'global', weights: { teoria: 30, practica: 60, apreciativa: 10 } });
expectGradingFail('applyTo inválido → rechazado', { mode: 'tradicional', applyTo: 'todos', weights: { teoria: 30, practica: 60, apreciativa: 10 } });

// ── c) Auditoría en gradingWeightOut ────────────────────────────────────────
console.log('── gradingWeightOut (auditoría aditiva) ──');

const stored = {
  gradingWeight: {
    mode: 'tradicional',
    weights: { teoria: 40, practica: 40, apreciativa: 20 },
    customWeights: {},
    applyTo: 'global',
    updatedAt: { toMillis: () => 1787600000000 },
    updatedBy: 'admin-uid-1',
  },
};
const outAudited = gradingWeightOut(stored);
check('updatedAt Timestamp → millis', outAudited.updatedAt === 1787600000000);
check('updatedBy se expone', outAudited.updatedBy === 'admin-uid-1');

const outLegacy = gradingWeightOut({ gradingWeight: { mode: 'tradicional', weights: { teoria: 30, practica: 60, apreciativa: 10 }, customWeights: {}, applyTo: 'global' } });
check('doc sin auditoría: no rompe (campos ausentes)', !('updatedAt' in outLegacy) && !('updatedBy' in outLegacy));
check('doc sin auditoría: pesos correctos', outLegacy.weights.teoria === 30 && outLegacy.weights.practica === 60);

// ── Resumen ─────────────────────────────────────────────────────────────────
console.log(`\n${pass} pasan · ${fail} fallan`);
if (fail > 0) {
  console.log('Fallidos:', failures.join(' | '));
  process.exit(1);
}
