/**
 * institution-alerts.js — Detección de alertas de riesgo institucional.
 *
 * Módulo PURO (sin dependencias de Firebase) para poder probar los umbrales
 * con datos sintéticos (scripts/test-alerts.mjs) y garantizar que no se
 * generan falsos positivos.
 *
 * Alertas por estudiante (consolidado por cédula/nombre en toda la institución):
 *   - Notas: promedio global < umbral con mínimo de evaluaciones calificadas.
 *   - Asistencia: tasa de presencia global < umbral con mínimo de registros.
 * Alertas por grupo (asignatura + docente):
 *   - Notas: promedio del grupo < umbral con mínimo de calificaciones.
 *   - Asistencia: tasa del grupo < umbral con mínimo de registros.
 * Alerta de inactividad: docente con estudiantes asignados sin actividad
 * relevante en los últimos N días (línea base de supervisión).
 */

const THRESHOLDS = {
  // Notas (0-100)
  STUDENT_GRADE_RISK: 60,
  STUDENT_GRADE_CRITICAL: 50,
  STUDENT_MIN_GRADED: 2,
  GROUP_GRADE_RISK: 60,
  GROUP_GRADE_CRITICAL: 50,
  GROUP_MIN_GRADED: 3,
  // Asistencia (% de presencia)
  STUDENT_ATT_RISK: 70,
  STUDENT_ATT_CRITICAL: 55,
  STUDENT_MIN_ATTENDANCE: 3,
  GROUP_ATT_RISK: 75,
  GROUP_ATT_CRITICAL: 60,
  GROUP_MIN_ATTENDANCE: 5,
  // Inactividad docente (días sin lastLoginAt/updatedAt)
  TEACHER_INACTIVE_DAYS: 21,
  // Límite de alertas devueltas por categoría.
  MAX_PER_CATEGORY: 25,
};

function normText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function personKey(st) {
  const cedula = String(st.cedula || '').trim();
  if (cedula) return `ced:${cedula}`;
  return `name:${normText(st.firstName)}|${normText(st.lastName)}`;
}

function pct(part, total) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

/**
 * @param {Array<{teacher, subjects, students, evaluations, grades, attendance}>} rows
 *   Misma forma que loadInstitutionData pero incluyendo evaluations/grades/attendance.
 * @returns {Array} alertas ordenadas (críticas primero).
 */
function computeInstitutionAlerts(rows) {
  const alerts = [];
  const teacherNameOf = (t) => t?.displayName || t?.email?.split('@')[0] || 'Docente';

  // ── 1. Consolidar por PERSONA (estudiante) ────────────────────────────────
  const byPerson = new Map(); // key -> { student, memberships: [{teacherUid, subjectId, subjectName, periodo, teacherName, graded, sumPct, attPresent, attLate, attAbsent, attTotal}] }
  const subjectNameCache = new Map(); // key `${teacherUid}|${subjectId}` -> name
  const subjectMeta = new Map(); // key `${teacherUid}|${subjectId}` -> { subjectId, subjectName, teacherUid, teacherName, periodo, graded, sumPct, attPresent, attLate, attAbsent, attTotal }

  for (const row of rows) {
    const teacher = row.teacher;
    const teacherUid = teacher.uid;
    const teacherName = teacherNameOf(teacher);
    const subjectById = new Map((row.subjects || []).map((s) => [s.id, s]));
    const evalById = new Map((row.evaluations || []).map((e) => [e.id, e]));

    for (const st of row.students || []) {
      const key = personKey(st);
      if (!byPerson.has(key)) {
        byPerson.set(key, { student: st, memberships: [] });
      }
      const person = byPerson.get(key);

      const sub = subjectById.get(st.subjectId);
      const subKey = `${teacherUid}|${st.subjectId}`;
      subjectNameCache.set(subKey, sub ? sub.name : 'Sin nombre');
      if (!subjectMeta.has(subKey)) {
        subjectMeta.set(subKey, {
          subjectId: st.subjectId,
          subjectName: sub ? sub.name : 'Sin nombre',
          teacherUid,
          teacherName,
          periodo: sub ? sub.periodo || null : null,
          graded: 0,
          sumPct: 0,
          attPresent: 0,
          attLate: 0,
          attAbsent: 0,
          attTotal: 0,
        });
      }

      const mem = {
        teacherUid,
        teacherName,
        subjectId: st.subjectId,
        subjectName: sub ? sub.name : 'Sin nombre',
        periodo: sub ? sub.periodo || null : null,
        graded: 0,
        sumPct: 0,
        attPresent: 0,
        attLate: 0,
        attAbsent: 0,
        attTotal: 0,
      };

      for (const g of row.grades || []) {
        if (g.subjectId !== st.subjectId || g.studentId !== st.id) continue;
        const ev = evalById.get(g.evaluationId);
        const maxScore = Number(ev && ev.maxScore);
        const score = Number(g.score);
        if (!Number.isFinite(maxScore) || maxScore <= 0 || !Number.isFinite(score)) continue;
        const p = (score / maxScore) * 100;
        mem.graded += 1;
        mem.sumPct += p;
        const sm = subjectMeta.get(subKey);
        sm.graded += 1;
        sm.sumPct += p;
      }

      for (const a of row.attendance || []) {
        if (a.subjectId !== st.subjectId || a.studentId !== st.id) continue;
        const status = a.status === 'late' ? 'late' : a.status === 'absent' ? 'absent' : 'present';
        mem[`att${status[0].toUpperCase()}${status.slice(1)}`] += 1;
        mem.attTotal += 1;
        const sm = subjectMeta.get(subKey);
        sm[`att${status[0].toUpperCase()}${status.slice(1)}`] += 1;
        sm.attTotal += 1;
      }

      person.memberships.push(mem);
    }
  }

  const now = Date.now();
  const inactiveDays = THRESHOLDS.TEACHER_INACTIVE_DAYS * 24 * 60 * 60 * 1000;
  const teacherSeen = new Set();
  for (const row of rows) {
    const t = row.teacher;
    if (teacherSeen.has(t.uid)) continue;
    teacherSeen.add(t.uid);
    const hasStudents = (row.students || []).length > 0;
    const lastActivity = Number(t.lastLoginAt) || Number(t.updatedAt) || 0;
    if (hasStudents && lastActivity > 0 && now - lastActivity > inactiveDays) {
      alerts.push({
        id: `teacher_inactive|${t.uid}`,
        type: 'teacher_inactive',
        severity: 'warning',
        subjectId: null,
        subjectName: null,
        teacherUid: t.uid,
        teacherName: teacherNameOf(t),
        periodo: null,
        studentId: null,
        studentName: null,
        cedula: null,
        gradedCount: null,
        avgPct: null,
        attendanceTotal: null,
        attendancePct: null,
        lastActivity,
        message: `El docente ${teacherNameOf(t)} no registra actividad en más de ${THRESHOLDS.TEACHER_INACTIVE_DAYS} días y tiene estudiantes asignados.`,
      });
    }
  }

  // ── 2. Alertas por estudiante ─────────────────────────────────────────────
  for (const person of byPerson.values()) {
    const st = person.student;
    const graded = person.memberships.reduce((a, m) => a + m.graded, 0);
    const sumPct = person.memberships.reduce((a, m) => a + m.sumPct, 0);
    const attTotal = person.memberships.reduce((a, m) => a + m.attTotal, 0);
    const attPresent = person.memberships.reduce((a, m) => a + m.attPresent, 0);
    const attLate = person.memberships.reduce((a, m) => a + m.attLate, 0);

    const avgPct = graded > 0 ? round1(sumPct / graded) : null;
    if (avgPct !== null && graded >= THRESHOLDS.STUDENT_MIN_GRADED && avgPct < THRESHOLDS.STUDENT_GRADE_RISK) {
      const lowSubjects = person.memberships
        .filter((m) => m.graded > 0 && round1(m.sumPct / m.graded) < THRESHOLDS.STUDENT_GRADE_RISK)
        .map((m) => m.subjectName);
      alerts.push({
        id: `student_grades|${st.id}`,
        type: 'student_grades',
        severity: avgPct < THRESHOLDS.STUDENT_GRADE_CRITICAL ? 'critical' : 'warning',
        subjectId: null,
        subjectName: null,
        teacherUid: null,
        teacherName: null,
        periodo: null,
        studentId: st.id,
        studentName: `${st.firstName} ${st.lastName}`,
        cedula: st.cedula || null,
        gradedCount: graded,
        avgPct,
        attendanceTotal: attTotal,
        attendancePct: pct(attPresent + attLate, attTotal),
        lastActivity: null,
        message: `El estudiante ${st.firstName} ${st.lastName} tiene un promedio de ${avgPct}% en ${lowSubjects.slice(0, 3).join(', ') || 'sus asignaturas'} (${graded} notas registradas).`,
      });
    }

    const attPct = pct(attPresent + attLate, attTotal);
    if (attPct !== null && attTotal >= THRESHOLDS.STUDENT_MIN_ATTENDANCE && attPct < THRESHOLDS.STUDENT_ATT_RISK) {
      alerts.push({
        id: `student_attendance|${st.id}`,
        type: 'student_attendance',
        severity: attPct < THRESHOLDS.STUDENT_ATT_CRITICAL ? 'critical' : 'warning',
        subjectId: null,
        subjectName: null,
        teacherUid: null,
        teacherName: null,
        periodo: null,
        studentId: st.id,
        studentName: `${st.firstName} ${st.lastName}`,
        cedula: st.cedula || null,
        gradedCount: graded,
        avgPct,
        attendanceTotal: attTotal,
        attendancePct: attPct,
        lastActivity: null,
        message: `El estudiante ${st.firstName} ${st.lastName} tiene una asistencia del ${attPct}% (${attTotal} registros en total).`,
      });
    }
  }

  // ── 3. Alertas por grupo (asignatura + docente) ──────────────────────────
  for (const sm of subjectMeta.values()) {
    const avgPct = sm.graded > 0 ? round1(sm.sumPct / sm.graded) : null;
    if (avgPct !== null && sm.graded >= THRESHOLDS.GROUP_MIN_GRADED && avgPct < THRESHOLDS.GROUP_GRADE_RISK) {
      alerts.push({
        id: `group_grades|${sm.teacherUid}|${sm.subjectId}`,
        type: 'group_grades',
        severity: avgPct < THRESHOLDS.GROUP_GRADE_CRITICAL ? 'critical' : 'warning',
        subjectId: sm.subjectId,
        subjectName: sm.subjectName,
        teacherUid: sm.teacherUid,
        teacherName: sm.teacherName,
        periodo: sm.periodo,
        studentId: null,
        studentName: null,
        cedula: null,
        gradedCount: sm.graded,
        avgPct,
        attendanceTotal: sm.attTotal,
        attendancePct: pct(sm.attPresent + sm.attLate, sm.attTotal),
        lastActivity: null,
        message: `El grupo de ${sm.subjectName} (${sm.teacherName}${sm.periodo ? `, ${sm.periodo}` : ''}) tiene un promedio de ${avgPct}% con ${sm.graded} calificaciones registradas.`,
      });
    }

    const attPct = pct(sm.attPresent + sm.attLate, sm.attTotal);
    if (attPct !== null && sm.attTotal >= THRESHOLDS.GROUP_MIN_ATTENDANCE && attPct < THRESHOLDS.GROUP_ATT_RISK) {
      alerts.push({
        id: `group_attendance|${sm.teacherUid}|${sm.subjectId}`,
        type: 'group_attendance',
        severity: attPct < THRESHOLDS.GROUP_ATT_CRITICAL ? 'critical' : 'warning',
        subjectId: sm.subjectId,
        subjectName: sm.subjectName,
        teacherUid: sm.teacherUid,
        teacherName: sm.teacherName,
        periodo: sm.periodo,
        studentId: null,
        studentName: null,
        cedula: null,
        gradedCount: sm.graded,
        avgPct,
        attendanceTotal: sm.attTotal,
        attendancePct: attPct,
        lastActivity: null,
        message: `El grupo de ${sm.subjectName} (${sm.teacherName}${sm.periodo ? `, ${sm.periodo}` : ''}) tiene una asistencia del ${attPct}% (${sm.attTotal} registros).`,
      });
    }
  }

  // ── 4. Ordenar: críticas primero, luego por valor más bajo ───────────────
  const severityRank = { critical: 0, warning: 1 };
  const metricValue = (a) =>
    a.avgPct !== null && a.avgPct !== undefined
      ? a.avgPct
      : a.attendancePct !== null && a.attendancePct !== undefined
        ? a.attendancePct
        : 100;

  const categoryOrder = (a, b) => {
    if (severityRank[a.severity] !== severityRank[b.severity]) {
      return severityRank[a.severity] - severityRank[b.severity];
    }
    return metricValue(a) - metricValue(b);
  };

  const countByType = new Map();
  const sorted = alerts.sort(categoryOrder);
  const capped = [];
  for (const al of sorted) {
    const c = countByType.get(al.type) || 0;
    if (c >= THRESHOLDS.MAX_PER_CATEGORY) continue;
    countByType.set(al.type, c + 1);
    capped.push(al);
  }
  return capped;
}

module.exports = { computeInstitutionAlerts, THRESHOLDS, personKey, pct, round1 };