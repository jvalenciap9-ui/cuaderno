// periodos-plan.js — Lógica pura de periodos de clase y reglas del plan
// (Módulo 1 del plan del dashboard administrativo). Sin dependencias de
// Firebase: sanitiza la entrada de adminSavePeriodos/adminSavePlanRules y
// serializa los valores guardados para el cliente. Testeada en
// scripts/test-periodos-plan.mjs.
//
// Los documentos institutions/{id}.periodos y institutions/{id}.planRules NO
// se escriben desde el cliente (reglas deny): solo adminSavePeriodos y
// adminSavePlanRules los persisten. La lectura se expone vía
// adminGetSchoolConfig → periodosOut/planRulesOut y, para todos los miembros,
// vía useInstitution (onSnapshot directo del documento).

const PERIODOS = ['matutino', 'vespertino', 'nocturno'];
const REGLAS = ['semanal', 'mensual', 'trimestral', 'cuatrimestral', 'anual'];

// Valores predeterminados según el plan: matutino 07:00–12:00, vespertino
// 13:00–18:00, nocturno 18:00–22:00. Los tres arrancan activos para no cambiar
// el comportamiento de los docentes hasta que el admin los configure.
const DEFAULT_PERIODOS = {
  matutino: { activo: true, horarioInicio: '07:00', horarioFin: '12:00' },
  vespertino: { activo: true, horarioInicio: '13:00', horarioFin: '18:00' },
  nocturno: { activo: true, horarioInicio: '18:00', horarioFin: '22:00' },
};

const DEFAULT_PLAN_RULES = {
  reglaSeleccionada: 'trimestral',
  recomendarADocentes: false,
};

// Normaliza una hora a HH:MM (rellena con cero a la izquierda). Devuelve ''
// si está vacía o no es una hora de 24h válida (0-23:0-59).
function normalizeTime(v) {
  if (typeof v !== 'string') return '';
  const m = v.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function sanitizeEntry(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  return {
    activo: e.activo === true,
    horarioInicio: normalizeTime(e.horarioInicio),
    horarioFin: normalizeTime(e.horarioFin),
  };
}

// Sanitiza la entrada de adminSavePeriodos. Siempre devuelve los tres periodos
// con la estructura completa; normaliza horarios y coacciona `activo` a
// booleano. No lanza excepciones: el formulario del cliente ya acota las
// entradas (checkboxes y inputs type="time").
function sanitizePeriodosInput(data) {
  const out = {};
  for (const p of PERIODOS) {
    out[p] = sanitizeEntry(data && data[p]);
  }
  return out;
}

// Serializa periodos para el cliente con valores saneados. Compatibilidad
// hacia atrás: si el campo no existe o está corrupto, devuelve los defaults
// (los tres periodos activos con sus horarios). Si el documento existe pero
// solo define algunos periodos, los no definidos se serializan inactivos.
function periodosOut(inst) {
  const p = inst && inst.periodos && typeof inst.periodos === 'object' ? inst.periodos : null;
  if (!p) return { ...DEFAULT_PERIODOS, matutino: { ...DEFAULT_PERIODOS.matutino }, vespertino: { ...DEFAULT_PERIODOS.vespertino }, nocturno: { ...DEFAULT_PERIODOS.nocturno } };
  const out = {};
  for (const k of PERIODOS) {
    out[k] = sanitizeEntry(p[k]);
  }
  return out;
}

// Sanitiza la entrada de adminSavePlanRules. Lanza Error('PLAN_RULE_INVALID')
// si la regla seleccionada no está en la whitelist.
function sanitizePlanRulesInput(data) {
  const reglaSeleccionada = data && data.reglaSeleccionada;
  if (!REGLAS.includes(reglaSeleccionada)) throw new Error('PLAN_RULE_INVALID');
  return {
    reglaSeleccionada,
    recomendarADocentes: !!(data && data.recomendarADocentes),
  };
}

// Serializa planRules para el cliente. Compatibilidad hacia atrás: documento
// ausente o corrupto → default trimestral con recomendación desactivada.
function planRulesOut(inst) {
  const pr = inst && inst.planRules && typeof inst.planRules === 'object' ? inst.planRules : {};
  const reglaSeleccionada = REGLAS.includes(pr.reglaSeleccionada)
    ? pr.reglaSeleccionada
    : DEFAULT_PLAN_RULES.reglaSeleccionada;
  return {
    reglaSeleccionada,
    recomendarADocentes: pr.recomendarADocentes === true,
  };
}

module.exports = {
  PERIODOS,
  REGLAS,
  DEFAULT_PERIODOS,
  DEFAULT_PLAN_RULES,
  sanitizePeriodosInput,
  periodosOut,
  sanitizePlanRulesInput,
  planRulesOut,
};
