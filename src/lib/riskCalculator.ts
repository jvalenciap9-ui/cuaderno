/**
 * riskCalculator.ts — Lógica pura de riesgo estudiantil (Sprint 1 Métricas
 * Institucionales). Espejo en TypeScript de functions/lib/risk-calculator.js
 * (que es la fuente probada en scripts/test-risk-calculator.mjs y usada por la
 * Cloud Function `getInstitutionalMetrics`). El frontend la usa en el modo demo
 * para generar las métricas mock.
 *
 * Umbrales:
 *   asistencia < 80%  → medio | < 70% → alto
 *   nota < 60% en 1 materia → medio | en 2+ → alto
 *   combinación de asistencia y notas en riesgo → alto
 */

export type RiskLevel = 'low' | 'medium' | 'high';

export interface StudentRisk {
  level: RiskLevel;
  reasons: string[];
}

export const RISK_THRESHOLDS = { attendanceMedium: 80, attendanceHigh: 70, gradeFail: 60 } as const;

export function calculateStudentRisk(
  attendancePct: number | null | undefined,
  gradePcts: Array<number | null | undefined> | null | undefined,
): StudentRisk {
  const att =
    typeof attendancePct === 'number' && Number.isFinite(attendancePct) ? attendancePct : null;
  const grades = Array.isArray(gradePcts) ? gradePcts : [];
  const fails = grades.filter(
    (g): g is number => typeof g === 'number' && Number.isFinite(g) && g < RISK_THRESHOLDS.gradeFail,
  );

  const attendanceHigh = att !== null && att < RISK_THRESHOLDS.attendanceHigh;
  const attendanceMedium =
    att !== null && att >= RISK_THRESHOLDS.attendanceHigh && att < RISK_THRESHOLDS.attendanceMedium;
  const hasAttendanceIssue = attendanceMedium || attendanceHigh;

  const gradesHigh = fails.length >= 2;
  const gradesMedium = fails.length === 1;
  const hasGradesIssue = gradesMedium || gradesHigh;

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const reasons: string[] = [];
  if (attendanceHigh) reasons.push(`Asistencia baja (${round1(att)}%)`);
  else if (attendanceMedium) reasons.push(`Asistencia en riesgo (${round1(att)}%)`);
  if (gradesHigh) reasons.push(`${fails.length} materias por debajo de ${RISK_THRESHOLDS.gradeFail}%`);
  else if (gradesMedium) reasons.push(`1 materia por debajo de ${RISK_THRESHOLDS.gradeFail}%`);
  if (hasAttendanceIssue && hasGradesIssue) reasons.push('Combinación de asistencia y notas en riesgo');

  let level: RiskLevel = 'low';
  if (attendanceHigh || gradesHigh) level = 'high';
  else if (hasAttendanceIssue && hasGradesIssue) level = 'high';
  else if (hasAttendanceIssue || hasGradesIssue) level = 'medium';

  return { level, reasons };
}

/**
 * Genera recomendaciones automáticas (Sprint 2) a partir del nivel de riesgo,
 * la asistencia global (%) y el nº de materias con nota < 60%. Espejo de
 * functions/lib/risk-calculator.js (fuente probada).
 */
export function generateRecommendations(
  riskLevel: RiskLevel,
  attendancePct: number | null | undefined,
  failingSubjects: number,
): string[] {
  const recs: string[] = [];
  const att = typeof attendancePct === 'number' && Number.isFinite(attendancePct) ? attendancePct : null;
  const fails = Number.isFinite(failingSubjects) ? failingSubjects : 0;

  if (att !== null && att < RISK_THRESHOLDS.attendanceMedium) {
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
