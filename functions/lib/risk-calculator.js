// risk-calculator.js — Lógica pura de riesgo estudiantil (Sprint 1 Métricas
// Institucionales). Sin dependencias de Firebase: calcula el nivel de riesgo de
// un estudiante a partir de su asistencia (%) y sus notas (%) por materia.
// Espejo en TypeScript: src/lib/riskCalculator.ts (usado por el modo demo y el
// frontend). Testeada en scripts/test-risk-calculator.mjs.
//
// Umbrales:
//   asistencia < 80%  → riesgo medio
//   asistencia < 70%  → riesgo alto
//   nota < 60% en 1 materia → medio
//   nota < 60% en 2+ materias → alto
//   combinación de ambos (asistencia Y notas en riesgo) → alto

const THRESHOLDS = { attendanceMedium: 80, attendanceHigh: 70, gradeFail: 60 };

function calculateStudentRisk(attendancePct, gradePcts) {
  const att = typeof attendancePct === 'number' && Number.isFinite(attendancePct) ? attendancePct : null;
  const grades = Array.isArray(gradePcts) ? gradePcts : [];
  const fails = grades.filter(
    (g) => typeof g === 'number' && Number.isFinite(g) && g < THRESHOLDS.gradeFail,
  );

  const attendanceHigh = att !== null && att < THRESHOLDS.attendanceHigh;
  const attendanceMedium = att !== null && att >= THRESHOLDS.attendanceHigh && att < THRESHOLDS.attendanceMedium;
  const hasAttendanceIssue = attendanceMedium || attendanceHigh;

  const gradesHigh = fails.length >= 2;
  const gradesMedium = fails.length === 1;
  const hasGradesIssue = gradesMedium || gradesHigh;

  const round1 = (n) => Math.round(n * 10) / 10;
  const reasons = [];
  if (attendanceHigh) reasons.push(`Asistencia baja (${round1(att)}%)`);
  else if (attendanceMedium) reasons.push(`Asistencia en riesgo (${round1(att)}%)`);
  if (gradesHigh) reasons.push(`${fails.length} materias por debajo de ${THRESHOLDS.gradeFail}%`);
  else if (gradesMedium) reasons.push(`1 materia por debajo de ${THRESHOLDS.gradeFail}%`);
  if (hasAttendanceIssue && hasGradesIssue) reasons.push('Combinación de asistencia y notas en riesgo');

  let level = 'low';
  if (attendanceHigh || gradesHigh) level = 'high';
  else if (hasAttendanceIssue && hasGradesIssue) level = 'high';
  else if (hasAttendanceIssue || hasGradesIssue) level = 'medium';

  return { level, reasons };
}

// Genera recomendaciones automáticas a partir del nivel de riesgo del
// estudiante, su asistencia global (%) y el nº de materias con nota < 60%.
function generateRecommendations(riskLevel, attendancePct, failingSubjects) {
  const recs = [];
  const att = typeof attendancePct === 'number' && Number.isFinite(attendancePct) ? attendancePct : null;
  const fails = typeof failingSubjects === 'number' && Number.isFinite(failingSubjects) ? failingSubjects : 0;

  if (att !== null && att < THRESHOLDS.attendanceMedium) {
    recs.push('Contactar al acudiente para informar sobre la inasistencia del estudiante.');
    recs.push('Programar una reunión con la familia y el docente consejero.');
  }
  if (fails > 0) {
    recs.push(`Programar refuerzo académico en ${fails} materia${fails === 1 ? '' : 's'} con promedio inferior a 60%.`);
    recs.push('Asignar tutorías personalizadas en las materias con menor rendimiento.');
  }
  if (riskLevel === 'high') {
    recs.push('Priorizar la atención del caso por el equipo institucional (seguimiento semanal).');
  }
  if (riskLevel === 'low') {
    recs.push('Mantener el seguimiento positivo y reconocer el buen desempeño del estudiante.');
  }
  if (recs.length === 0) {
    recs.push('Continuar con el monitoreo regular del rendimiento y la asistencia.');
  }
  return recs;
}

module.exports = { calculateStudentRisk, generateRecommendations, THRESHOLDS };
