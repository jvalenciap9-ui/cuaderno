/**
 * test-grading-weight.mjs — Módulo 4: validación de la ponderación global de
 * calificaciones. Verifica que la sanitización:
 *   a) Acepta los tres modos con sus defaults (tradicional 30/60/10,
 *      competencias Saber/Hacer/Ser, personalizada con customWeights).
 *   b) Rechaza porcentajes que no suman 100, modos inválidos, applyTo
 *      inválido y customWeights vacías o con más de 12 categorías.
 *   c) Serializa gradingWeight para el cliente siempre con valores seguros y
 *      devuelve el default tradicional si el documento no existe (compat.
 *      hacia atrás).
 *
 * Uso: node scripts/test-grading-weight.mjs   (no requiere emulador)
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sanitizeGradingWeightInput, gradingWeightOut, DEFAULT_GRADING_WEIGHT } = require('../functions/lib/grading-weight.js');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name} ${extra}`); }
}

function checkThrows(name, fn, expectedMessage) {
  try {
    fn();
    fail++; failures.push(name); console.log(`  ❌ ${name} (no lanzó excepción)`);
  } catch (err) {
    if (err && err.message === expectedMessage) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; failures.push(name); console.log(`  ❌ ${name} (error distinto: ${err && err.message})`); }
  }
}

console.log('── default ──');
check('default es tradicional 30/60/10 global',
  DEFAULT_GRADING_WEIGHT.mode === 'tradicional'
  && DEFAULT_GRADING_WEIGHT.weights.teoria === 30
  && DEFAULT_GRADING_WEIGHT.weights.practica === 60
  && DEFAULT_GRADING_WEIGHT.weights.apreciativa === 10
  && DEFAULT_GRADING_WEIGHT.applyTo === 'global');

console.log('── sanitizeGradingWeightInput ──');

const trad = sanitizeGradingWeightInput({ mode: 'tradicional', applyTo: 'global', weights: { teoria: 30, practica: 60, apreciativa: 10 } });
check('tradicional 30/60/10 se conserva',
  trad.mode === 'tradicional' && trad.weights.teoria === 30 && trad.weights.practica === 60 && trad.weights.apreciativa === 10);

const comp = sanitizeGradingWeightInput({ mode: 'competencias', applyTo: 'override', weights: { teoria: 30, practica: 40, apreciativa: 30 } });
check('competencias Saber/Hacer/Ser 30/40/30 se conserva',
  comp.mode === 'competencias' && comp.applyTo === 'override' && comp.weights.teoria === 30 && comp.weights.practica === 40 && comp.weights.apreciativa === 30);

const pers = sanitizeGradingWeightInput({ mode: 'personalizada', applyTo: 'global', customWeights: { 'Saber': 40, 'Hacer': 40, 'Ser': 20 } });
check('personalizada con customWeights se conserva',
  pers.mode === 'personalizada' && pers.customWeights.Saber === 40 && pers.customWeights.Hacer === 40 && pers.customWeights.Ser === 20);

checkThrows('suma != 100 en tradicional lanza GRADING_SUM_INVALID',
  () => sanitizeGradingWeightInput({ mode: 'tradicional', applyTo: 'global', weights: { teoria: 50, practica: 60, apreciativa: 10 } }),
  'GRADING_SUM_INVALID');
checkThrows('peso > 100 lanza GRADING_SUM_INVALID',
  () => sanitizeGradingWeightInput({ mode: 'tradicional', applyTo: 'global', weights: { teoria: 120, practica: -20, apreciativa: 0 } }),
  'GRADING_SUM_INVALID');
checkThrows('modo inválido lanza GRADING_MODE_INVALID',
  () => sanitizeGradingWeightInput({ mode: 'hibrido', applyTo: 'global', weights: { teoria: 30, practica: 60, apreciativa: 10 } }),
  'GRADING_MODE_INVALID');
checkThrows('applyTo inválido lanza GRADING_APPLY_TO_INVALID',
  () => sanitizeGradingWeightInput({ mode: 'tradicional', applyTo: 'parcial', weights: { teoria: 30, practica: 60, apreciativa: 10 } }),
  'GRADING_APPLY_TO_INVALID');
checkThrows('personalizada con 1 sola categoría lanza GRADING_CUSTOM_TOO_FEW',
  () => sanitizeGradingWeightInput({ mode: 'personalizada', applyTo: 'global', customWeights: { 'Única': 100 } }),
  'GRADING_CUSTOM_TOO_FEW');
checkThrows('personalizada con suma != 100 lanza GRADING_SUM_INVALID',
  () => sanitizeGradingWeightInput({ mode: 'personalizada', applyTo: 'global', customWeights: { 'A': 40, 'B': 40, 'C': 10 } }),
  'GRADING_SUM_INVALID');
checkThrows('personalizada con >12 categorías lanza GRADING_CUSTOM_TOO_MANY',
  () => sanitizeGradingWeightInput({
    mode: 'personalizada', applyTo: 'global',
    customWeights: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`C${i}`, i === 0 ? 12 : 12])),
  }),
  'GRADING_CUSTOM_TOO_MANY');

checkThrows('peso con tipo no numérico lanza GRADING_SUM_INVALID',
  () => sanitizeGradingWeightInput({ mode: 'tradicional', applyTo: 'global', weights: { teoria: '30', practica: 60, apreciativa: 10 } }),
  'GRADING_SUM_INVALID');

console.log('── gradingWeightOut (compatibilidad hacia atrás) ──');

check('doc inexistente serializa default tradicional',
  (() => { const o = gradingWeightOut(undefined); return o.mode === 'tradicional' && o.weights.teoria === 30 && o.weights.practica === 60 && o.weights.apreciativa === 10 && o.applyTo === 'global' && Object.keys(o.customWeights).length === 0; })());
check('doc sin gradingWeight serializa default',
  (() => { const o = gradingWeightOut({ schoolConfig: {} }); return o.mode === 'tradicional' && o.weights.teoria === 30; })());
check('gradingWeight parcial con pesos inválidos cae al default',
  (() => { const o = gradingWeightOut({ gradingWeight: { mode: 'tradicional', weights: { teoria: 10, practica: 10 } } }); return o.weights.teoria === 30 && o.weights.practica === 60; })());
check('conserva mode/applyTo válidos',
  (() => { const o = gradingWeightOut({ gradingWeight: { mode: 'competencias', applyTo: 'override', weights: { teoria: 30, practica: 40, apreciativa: 30 } } }); return o.mode === 'competencias' && o.applyTo === 'override' && o.weights.practica === 40; })());
check('conserva customWeights válidos',
  (() => { const o = gradingWeightOut({ gradingWeight: { mode: 'personalizada', applyTo: 'global', customWeights: { 'A': 50, 'B': 50 } } }); return o.mode === 'personalizada' && o.customWeights.A === 50 && o.customWeights.B === 50; })());

console.log('\n──────────────────────────────');
console.log(`Resultado: ${pass} ✅ / ${fail} ❌`);
if (fail > 0) {
  console.log('Fallos:', failures.join(', '));
  process.exit(1);
}
