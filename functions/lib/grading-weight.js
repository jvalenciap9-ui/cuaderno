// grading-weight.js — Lógica pura de la ponderación global de calificaciones
// (Módulo 4 del plan del dashboard administrativo). Sin dependencias de
// Firebase: sanitiza y valida la entrada de adminSaveGradingWeight y serializa
// el valor guardado para el cliente. Testeada en scripts/test-grading-weight.mjs.
//
// El documento institutions/{id}.gradingWeight NO se escribe desde el cliente
// (reglas deny): solo adminSaveGradingWeight lo persiste. La lectura se expone
// vía adminGetSchoolConfig → gradingWeightOut(inst). Si el campo no existe,
// gradingWeightOut devuelve el default tradicional (30/60/10).

const GRADING_MODES = ['tradicional', 'competencias', 'personalizada'];
const APPLY_TO = ['global', 'override'];

const DEFAULT_GRADING_WEIGHT = {
  mode: 'tradicional',
  weights: { teoria: 30, practica: 60, apreciativa: 10 },
  customWeights: {},
  applyTo: 'global',
};

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// Valida los tres pesos del modo tradicional/competencias: números 0-100 y
// suma 100 (tolerancia de redondeo de 0.01).
function isWeightsValid(weights) {
  if (!weights || typeof weights !== 'object') return false;
  const keys = ['teoria', 'practica', 'apreciativa'];
  for (const k of keys) {
    if (typeof weights[k] !== 'number' || !Number.isFinite(weights[k]) || weights[k] < 0 || weights[k] > 100) return false;
  }
  return Math.abs(weights.teoria + weights.practica + weights.apreciativa - 100) < 0.01;
}

// Sanitiza y valida la entrada de adminSaveGradingWeight.
// Lanza Error con códigos GRADING_* para que la Cloud Function los traduzca.
function sanitizeGradingWeightInput(data) {
  const mode = data && data.mode;
  const applyTo = data && data.applyTo;
  if (!GRADING_MODES.includes(mode)) throw new Error('GRADING_MODE_INVALID');
  if (!APPLY_TO.includes(applyTo)) throw new Error('GRADING_APPLY_TO_INVALID');

  const out = { mode, applyTo };

  if (mode === 'personalizada') {
    const raw = data.customWeights && typeof data.customWeights === 'object' ? data.customWeights : {};
    const entries = Object.entries(raw).filter(([k, v]) =>
      typeof k === 'string' && k.trim().length > 0 && k.trim().length <= 60 &&
      typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
    );
    if (entries.length < 2) throw new Error('GRADING_CUSTOM_TOO_FEW');
    if (entries.length > 12) throw new Error('GRADING_CUSTOM_TOO_MANY');
    const total = entries.reduce((acc, [, v]) => acc + v, 0);
    if (Math.abs(total - 100) > 0.01) throw new Error('GRADING_SUM_INVALID');
    const customWeights = {};
    entries.forEach(([k, v]) => { customWeights[k.trim()] = v; });
    out.customWeights = customWeights;
  } else {
    const weights = data.weights && typeof data.weights === 'object' ? data.weights : {};
    if (!isWeightsValid(weights)) throw new Error('GRADING_SUM_INVALID');
    out.weights = {
      teoria: num(weights.teoria),
      practica: num(weights.practica),
      apreciativa: num(weights.apreciativa),
    };
  }
  return out;
}

// Serializa con valores saneados para el cliente. Compatibilidad hacia atrás:
// documento ausente o corrupto → default tradicional (30/60/10), applyTo
// global, customWeights vacío. Auditoría ligera (aditiva): updatedAt se
// normaliza a millis (Timestamp de Firestore o number) y updatedBy se pasa
// tal cual si existe; previousWeight NO se expone (permanece solo en el doc).
function gradingWeightOut(inst) {
  const gw = (inst && inst.gradingWeight) || {};
  const mode = GRADING_MODES.includes(gw.mode) ? gw.mode : DEFAULT_GRADING_WEIGHT.mode;
  const applyTo = APPLY_TO.includes(gw.applyTo) ? gw.applyTo : DEFAULT_GRADING_WEIGHT.applyTo;
  const weights = isWeightsValid(gw.weights) ? {
    teoria: num(gw.weights.teoria),
    practica: num(gw.weights.practica),
    apreciativa: num(gw.weights.apreciativa),
  } : { ...DEFAULT_GRADING_WEIGHT.weights };
  const customWeights = gw.customWeights && typeof gw.customWeights === 'object'
    ? Object.fromEntries(
        Object.entries(gw.customWeights).filter(([k, v]) =>
          typeof k === 'string' && k.trim().length > 0 && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
        )
      )
    : {};
  const out = { mode, weights, customWeights, applyTo };
  const ts = gw.updatedAt;
  if (ts && typeof ts.toMillis === 'function') out.updatedAt = ts.toMillis();
  else if (typeof ts === 'number' && Number.isFinite(ts)) out.updatedAt = ts;
  if (typeof gw.updatedBy === 'string' && gw.updatedBy) out.updatedBy = gw.updatedBy;
  return out;
}

module.exports = { sanitizeGradingWeightInput, gradingWeightOut, DEFAULT_GRADING_WEIGHT };
