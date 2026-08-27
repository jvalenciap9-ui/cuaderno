/**
 * test-periodos-plan.mjs — Módulo 1: validación de periodos de clase y reglas
 * del plan. Verifica que la sanitización:
 *   a) Normaliza los tres periodos (activo booleano y horarios HH:MM).
 *   b) Rechaza reglas del plan fuera de la whitelist (PLAN_RULE_INVALID).
 *   c) Serializa periodos/planRules para el cliente siempre con valores
 *      seguros y devuelve los defaults si el documento no existe (compat.
 *      hacia atrás).
 *
 * Uso: node scripts/test-periodos-plan.mjs   (no requiere emulador)
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  PERIODOS,
  REGLAS,
  DEFAULT_PERIODOS,
  DEFAULT_PLAN_RULES,
  sanitizePeriodosInput,
  periodosOut,
  sanitizePlanRulesInput,
  planRulesOut,
} = require('../functions/lib/periodos-plan.js');

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

console.log('── defaults ──');
check('PERIODOS son matutino/vespertino/nocturno',
  PERIODOS.length === 3 && PERIODOS.includes('matutino') && PERIODOS.includes('vespertino') && PERIODOS.includes('nocturno'));
check('REGLAS son las 5 del plan',
  REGLAS.length === 5 && REGLAS.includes('semanal') && REGLAS.includes('mensual') && REGLAS.includes('trimestral') && REGLAS.includes('cuatrimestral') && REGLAS.includes('anual'));
check('default periodos: matutino 07:00-12:00 activo',
  DEFAULT_PERIODOS.matutino.activo === true && DEFAULT_PERIODOS.matutino.horarioInicio === '07:00' && DEFAULT_PERIODOS.matutino.horarioFin === '12:00');
check('default periodos: vespertino 13:00-18:00 activo',
  DEFAULT_PERIODOS.vespertino.activo === true && DEFAULT_PERIODOS.vespertino.horarioInicio === '13:00' && DEFAULT_PERIODOS.vespertino.horarioFin === '18:00');
check('default periodos: nocturno 18:00-22:00 activo',
  DEFAULT_PERIODOS.nocturno.activo === true && DEFAULT_PERIODOS.nocturno.horarioInicio === '18:00' && DEFAULT_PERIODOS.nocturno.horarioFin === '22:00');
check('default planRules: trimestral sin recomendación',
  DEFAULT_PLAN_RULES.reglaSeleccionada === 'trimestral' && DEFAULT_PLAN_RULES.recomendarADocentes === false);

console.log('── sanitizePeriodosInput ──');

const full = sanitizePeriodosInput({
  matutino: { activo: true, horarioInicio: '7:00', horarioFin: '12:00' },
  vespertino: { activo: true, horarioInicio: '13:00', horarioFin: '18:00' },
  nocturno: { activo: false, horarioInicio: '18:00', horarioFin: '22:00' },
});
check('entrada completa se conserva (hora sin cero se rellena)',
  full.matutino.activo === true && full.matutino.horarioInicio === '07:00' && full.matutino.horarioFin === '12:00');
check('vespertino activo se conserva',
  full.vespertino.activo === true && full.vespertino.horarioInicio === '13:00' && full.vespertino.horarioFin === '18:00');
check('nocturno desactivado se conserva',
  full.nocturno.activo === false && full.nocturno.horarioInicio === '18:00');

const empty = sanitizePeriodosInput(undefined);
check('entrada vacía devuelve los tres periodos inactivos con horarios vacíos',
  empty.matutino.activo === false && empty.matutino.horarioInicio === '' && empty.matutino.horarioFin === ''
  && empty.vespertino.activo === false && empty.nocturno.activo === false);

const coerced = sanitizePeriodosInput({ matutino: { activo: 'true', horarioInicio: '07:00', horarioFin: '12:00' } });
check('activo no booleano se coacciona a false',
  coerced.matutino.activo === false);
check('solo define un periodo: los demás quedan inactivos',
  sanitizePeriodosInput({ matutino: { activo: true } }).vespertino.activo === false);

check('hora inválida se normaliza a vacío',
  sanitizePeriodosInput({ matutino: { horarioInicio: '25:99', horarioFin: 'abc' } }).matutino.horarioInicio === ''
  && sanitizePeriodosInput({ matutino: { horarioInicio: '25:99', horarioFin: 'abc' } }).matutino.horarioFin === '');
check('hora con minutos de un dígito se rellena',
  sanitizePeriodosInput({ matutino: { horarioInicio: '9:5', horarioFin: '12:0' } }).matutino.horarioInicio === '09:05'
  && sanitizePeriodosInput({ matutino: { horarioInicio: '9:5', horarioFin: '12:0' } }).matutino.horarioFin === '12:00');

console.log('── periodosOut (compatibilidad hacia atrás) ──');

const outUndef = periodosOut(undefined);
check('doc inexistente serializa defaults activos',
  outUndef.matutino.activo === true && outUndef.matutino.horarioInicio === '07:00'
  && outUndef.vespertino.activo === true && outUndef.nocturno.activo === true);
const outEmpty = periodosOut({ schoolConfig: {} });
check('doc sin periodos serializa defaults',
  outEmpty.matutino.activo === true && outEmpty.matutino.horarioInicio === '07:00');
const outPartial = periodosOut({ periodos: { matutino: { activo: true, horarioInicio: '7:00', horarioFin: '12:00' } } });
check('periodos parciales: lo definido se normaliza, lo demás inactivo',
  outPartial.matutino.activo === true && outPartial.matutino.horarioInicio === '07:00'
  && outPartial.vespertino.activo === false && outPartial.nocturno.activo === false);
check('periodos corrupto cae a defaults',
  periodosOut({ periodos: 'corrupto' }).matutino.activo === true);

console.log('── sanitizePlanRulesInput ──');

for (const r of REGLAS) {
  const out = sanitizePlanRulesInput({ reglaSeleccionada: r, recomendarADocentes: true });
  check(`regla ${r} se acepta y conserva la recomendación`,
    out.reglaSeleccionada === r && out.recomendarADocentes === true);
}
check('recomendarADocentes ausente queda false',
  sanitizePlanRulesInput({ reglaSeleccionada: 'mensual' }).recomendarADocentes === false);
checkThrows('regla inválida lanza PLAN_RULE_INVALID',
  () => sanitizePlanRulesInput({ reglaSeleccionada: 'bimestral' }), 'PLAN_RULE_INVALID');
checkThrows('regla ausente lanza PLAN_RULE_INVALID',
  () => sanitizePlanRulesInput({}), 'PLAN_RULE_INVALID');
checkThrows('entrada vacía lanza PLAN_RULE_INVALID',
  () => sanitizePlanRulesInput(undefined), 'PLAN_RULE_INVALID');

console.log('── planRulesOut (compatibilidad hacia atrás) ──');

const prUndef = planRulesOut(undefined);
check('doc inexistente serializa default trimestral',
  prUndef.reglaSeleccionada === 'trimestral' && prUndef.recomendarADocentes === false);
check('regla inválida cae al default',
  planRulesOut({ planRules: { reglaSeleccionada: 'bimestral' } }).reglaSeleccionada === 'trimestral');
check('conserva regla válida y recomendación activa',
  (() => { const o = planRulesOut({ planRules: { reglaSeleccionada: 'cuatrimestral', recomendarADocentes: true } }); return o.reglaSeleccionada === 'cuatrimestral' && o.recomendarADocentes === true; })());
check('planRules corrupto cae al default',
  planRulesOut({ planRules: 'corrupto' }).reglaSeleccionada === 'trimestral');

console.log('\n──────────────────────────────');
console.log(`Resultado: ${pass} ✅ / ${fail} ❌`);
if (fail > 0) {
  console.log('Fallos:', failures.join(', '));
  process.exit(1);
}
