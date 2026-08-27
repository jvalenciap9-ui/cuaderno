// grading-policy.js — Matriz de prioridad de la ponderación académica
// (política institucional). Fuente probada en scripts/test-grading-policy.mjs;
// espejo TS en src/lib/gradingUtils.ts (getEffectiveGradingWeight).
//
// REGLA FUNDAMENTAL: solamente el administrador institucional configura o
// modifica las ponderaciones. La fuente autoritativa es
// institutions/{id}.gradingWeight; el campo `applyTo` ('global'|'override')
// se conserva en el esquema por compatibilidad pero YA NO tiene efecto en la
// resolución: para cualquier miembro de la institución la ponderación
// institucional SIEMPRE gana sobre la personal del docente.
//
//   docente institucional        → weight = institucional, canEdit = false
//   admin institucional          → weight = institucional, canEdit = true
//   docente individual (Premium) → weight = personal,     canEdit = true
//   sin institución              → weight = personal,     canEdit = true
//
// Si un miembro institucional no tiene ponderación institucional legible
// (campo ausente o corrupto), weight = null y el consumidor aplica sus
// defaults; la personal del docente queda IGNORADA (no borrada).

function resolveEffectiveGradingWeight(ctx, individual, institutional) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  if (c.isInstitutionalMember === true) {
    return {
      weight: institutional && typeof institutional === 'object' ? institutional : null,
      canEdit: c.isAdmin === true,
      source: 'institutional',
    };
  }
  return {
    weight: individual && typeof individual === 'object' ? individual : null,
    canEdit: true,
    source: 'personal',
  };
}

module.exports = { resolveEffectiveGradingWeight };
