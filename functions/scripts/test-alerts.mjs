/**
 * test-alerts.mjs — Fase 4: validación de la detección de alertas de riesgo
 * institucional con datos sintéticos. Verifica que:
 *   a) Las alertas SÍ se disparan cuando hay caídas críticas reales.
 *   b) NO se generan falsos positivos (datos saludables, muestras mínimas
 *      no alcanzadas, docentes activos).
 *
 * Uso: node scripts/test-alerts.mjs   (no requiere emulador)
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { computeInstitutionAlerts, THRESHOLDS } = require('../functions/lib/institution-alerts.js');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name} ${extra}`); }
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

// ── Helpers para construir datos sintéticos ────────────────────────────────
const uids = { t1: 'teacher-1', t2: 'teacher-2' };

function subject(id, name, periodo) {
  return { id, name, periodo: periodo || null, userId: 'x' };
}

function student(id, firstName, lastName, subjectId, cedula) {
  return { id, firstName, lastName, subjectId, cedula: cedula || '', userId: 'x' };
}

function evaluation(id, subjectId, maxScore) {
  return { id, subjectId, maxScore, userId: 'x' };
}

function grade(studentId, subjectId, evaluationId, score) {
  return { studentId, subjectId, evaluationId, score, userId: 'x' };
}

function attendance(studentId, subjectId, date, status) {
  return { studentId, subjectId, date, status, userId: 'x' };
}

function teacherRow(uid, displayName, opts = {}) {
  return {
    teacher: { uid, displayName, email: `${uid}@test.local`, lastLoginAt: opts.lastLoginAt ?? NOW },
    subjects: opts.subjects || [],
    students: opts.students || [],
    evaluations: opts.evaluations || [],
    grades: opts.grades || [],
    attendance: opts.attendance || [],
  };
}

const countByType = (alerts, type) => alerts.filter((a) => a.type === type).length;

console.log('\n── Fase 4: Alertas de riesgo institucional ──\n');

// ── 1. Datos totalmente saludables → sin alertas (cero falsos positivos) ──
{
  const rows = [
    teacherRow('t1', 'Docente Uno', {
      subjects: [subject('math', 'Matemáticas', 'matutino')],
      students: [student('s1', 'Ana', 'Gómez', 'math', '123')],
      evaluations: [evaluation('e1', 'math', 100), evaluation('e2', 'math', 100), evaluation('e3', 'math', 100)],
      grades: [
        grade('s1', 'math', 'e1', 90), grade('s1', 'math', 'e2', 85), grade('s1', 'math', 'e3', 95),
      ],
      attendance: [
        attendance('s1', 'math', '2026-08-01', 'present'),
        attendance('s1', 'math', '2026-08-03', 'present'),
        attendance('s1', 'math', '2026-08-05', 'present'),
        attendance('s1', 'math', '2026-08-07', 'present'),
      ],
    }),
  ];
  const alerts = computeInstitutionAlerts(rows);
  check('Estudiante saludable (90/85/95, 100% asistencia) → 0 alertas', alerts.length === 0, JSON.stringify(alerts));
}

// ── 2. Estudiante con promedio < 60 pero solo 1 nota → NO alerta ──────────
{
  const rows = [
    teacherRow('t1', 'Docente Uno', {
      subjects: [subject('math', 'Matemáticas', 'matutino')],
      students: [student('s1', 'Ana', 'Gómez', 'math', '123')],
      evaluations: [evaluation('e1', 'math', 100)],
      grades: [grade('s1', 'math', 'e1', 40)],
    }),
  ];
  const alerts = computeInstitutionAlerts(rows);
  check(
    `1 sola nota baja (40%) → sin alerta (mínimo ${THRESHOLDS.STUDENT_MIN_GRADED} notas)`,
    countByType(alerts, 'student_grades') === 0,
    JSON.stringify(alerts)
  );
}

// ── 3. Estudiante con 3 notas bajas → alerta student_grades (warning) ─────
{
  const rows = [
    teacherRow('t1', 'Docente Uno', {
      subjects: [subject('math', 'Matemáticas', 'matutino')],
      students: [student('s1', 'Ana', 'Gómez', 'math', '123')],
      evaluations: [evaluation('e1', 'math', 100), evaluation('e2', 'math', 100), evaluation('e3', 'math', 100)],
      grades: [
        grade('s1', 'math', 'e1', 55), grade('s1', 'math', 'e2', 50), grade('s1', 'math', 'e3', 60),
      ],
    }),
  ];
  const alerts = computeInstitutionAlerts(rows);
  const g = alerts.find((a) => a.type === 'student_grades');
  check('3 notas ~55% → alerta student_grades', !!g, JSON.stringify(alerts));
  check('severidad warning (> 50)', g?.severity === 'warning', g?.severity);
  check('avgPct ≈ 55', g?.avgPct === 55, g?.avgPct);
  check(`estudiante identificado (${THRESHOLDS.STUDENT_MIN_GRADED}+ notas)`, g?.studentId === 's1', g?.studentId);
}

// ── 4. Estudiante con promedio < 50 → alerta crítica ──────────────────────
{
  const rows = [
    teacherRow('t1', 'Docente Uno', {
      subjects: [subject('math', 'Matemáticas', 'matutino')],
      students: [student('s1', 'Ana', 'Gómez', 'math', '123')],
      evaluations: [evaluation('e1', 'math', 100), evaluation('e2', 'math', 100)],
      grades: [grade('s1', 'math', 'e1', 30), grade('s1', 'math', 'e2', 45)],
    }),
  ];
  const alerts = computeInstitutionAlerts(rows);
  const g = alerts.find((a) => a.type === 'student_grades');
  check('Promedio 37.5% → severidad critical', g?.severity === 'critical', g?.severity);
}

// ── 5. Asistencia: pocos registros (2) → sin alerta; baja con 3+ → alerta ──
{
  const rowsFew = [
    teacherRow('t1', 'Docente Uno', {
      subjects: [subject('math', 'Matemáticas', 'matutino')],
      students: [student('s1', 'Ana', 'Gómez', 'math', '123')],
      attendance: [attendance('s1', 'math', '2026-08-01', 'present'), attendance('s1', 'math', '2026-08-03', 'absent')],
    }),
  ];
  const few = computeInstitutionAlerts(rowsFew);
  check(
    `2 registros (1 ausencia) → sin alerta de asistencia (mínimo ${THRESHOLDS.STUDENT_MIN_ATTENDANCE})`,
    countByType(few, 'student_attendance') === 0,
    JSON.stringify(few)
  );

  const rowsMany = [
    teacherRow('t1', 'Docente Uno', {
      subjects: [subject('math', 'Matemáticas', 'matutino')],
      students: [student('s1', 'Ana', 'Gómez', 'math', '123')],
      attendance: [
        attendance('s1', 'math', '2026-08-01', 'present'),
        attendance('s1', 'math', '2026-08-03', 'absent'),
        attendance('s1', 'math', '2026-08-05', 'absent'),
      ],
    }),
  ];
  const many = computeInstitutionAlerts(rowsMany);
  const a = many.find((al) => al.type === 'student_attendance');
  check('3 registros, 33% presencia → alerta student_attendance', !!a, JSON.stringify(many));
  check('severidad critical (< 55%)', a?.severity === 'critical', a?.severity);
  check('attendancePct ≈ 33.3', a?.attendancePct === 33.3, a?.attendancePct);
}

// ── 6. Consolidación por cédula: alumno en 2 docentes se agrega ───────────
{
  const ana = student('s1', 'Ana', 'Gómez', 'math', '123');
  const rows = [
    teacherRow('t1', 'Docente Uno', {
      subjects: [subject('math', 'Matemáticas', 'matutino')],
      students: [ana],
      evaluations: [evaluation('e1', 'math', 100), evaluation('e2', 'math', 100)],
      grades: [grade('s1', 'math', 'e1', 40), grade('s1', 'math', 'e2', 50)],
    }),
    teacherRow('t2', 'Docente Dos', {
      subjects: [subject('sci', 'Ciencias', 'vespertino')],
      students: [student('sX', 'Ana', 'Gómez', 'sci', '123')], // misma cédula → misma persona
      evaluations: [evaluation('e3', 'sci', 100), evaluation('e4', 'sci', 100)],
      grades: [grade('sX', 'sci', 'e3', 100), grade('sX', 'sci', 'e4', 90)],
    }),
  ];
  const alerts = computeInstitutionAlerts(rows);
  const g = alerts.find((al) => al.type === 'student_grades');
  // Promedio global: (40+50+100+90)/4 = 70 → NO debería alertar por notas
  check('Promedio consolidado 70% → sin alerta de notas', !g, JSON.stringify(alerts));
  const personKeys = alerts.map((al) => al.studentId);
  check('No se duplican alertas por cédula', personKeys.length === new Set(personKeys).size);
}

// ── 7. Alertas por grupo (asignatura+docente) ─────────────────────────────
{
  const rows = [
    teacherRow('t1', 'Docente Uno', {
      subjects: [subject('math', 'Matemáticas', 'matutino')],
      students: [
        student('s1', 'Ana', 'Gómez', 'math', '1'),
        student('s2', 'Luis', 'Perez', 'math', '2'),
        student('s3', 'Maria', 'Lopez', 'math', '3'),
      ],
      evaluations: [evaluation('e1', 'math', 100)],
      grades: [grade('s1', 'math', 'e1', 40), grade('s2', 'math', 'e1', 45), grade('s3', 'math', 'e1', 50)],
    }),
  ];
  const alerts = computeInstitutionAlerts(rows);
  const g = alerts.find((al) => al.type === 'group_grades');
  check('Grupo Matemáticas 45% (3 notas) → alerta group_grades', !!g, JSON.stringify(alerts));
  check('avgPct = 45 y severity critical', g?.avgPct === 45 && g?.severity === 'critical');
  check('asignatura y docente correctos', g?.subjectName === 'Matemáticas' && g?.teacherName === 'Docente Uno');
}

// ── 8. Grupo con datos saludables → sin alertas de grupo ──────────────────
{
  const rows = [
    teacherRow('t1', 'Docente Uno', {
      subjects: [subject('math', 'Matemáticas', 'matutino')],
      students: [student('s1', 'Ana', 'Gómez', 'math', '1'), student('s2', 'Luis', 'Perez', 'math', '2')],
      evaluations: [evaluation('e1', 'math', 100)],
      grades: [grade('s1', 'math', 'e1', 90), grade('s2', 'math', 'e1', 88)],
      attendance: [
        attendance('s1', 'math', '2026-08-01', 'present'),
        attendance('s2', 'math', '2026-08-01', 'late'),
        attendance('s1', 'math', '2026-08-03', 'present'),
        attendance('s2', 'math', '2026-08-03', 'present'),
        attendance('s1', 'math', '2026-08-05', 'present'),
        attendance('s2', 'math', '2026-08-05', 'present'),
      ],
    }),
  ];
  const alerts = computeInstitutionAlerts(rows);
  check('Grupo saludable (89% notas, 91.7% asistencia) → 0 alertas', alerts.length === 0, JSON.stringify(alerts));
}

// ── 9. Docente activo → sin alerta de inactividad ─────────────────────────
{
  const rows = [
    teacherRow('t1', 'Docente Uno', {
      lastLoginAt: NOW - 2 * DAY,
      subjects: [subject('math', 'Matemáticas', 'matutino')],
      students: [student('s1', 'Ana', 'Gómez', 'math', '123')],
    }),
  ];
  const alerts = computeInstitutionAlerts(rows);
  check('Docente con login de hace 2 días → sin alerta de inactividad', countByType(alerts, 'teacher_inactive') === 0, JSON.stringify(alerts));
}

// ── 10. Docente inactivo (> 21 días) con estudiantes → alerta ─────────────
{
  const rows = [
    teacherRow('t1', 'Docente Uno', {
      lastLoginAt: NOW - 40 * DAY,
      subjects: [subject('math', 'Matemáticas', 'matutino')],
      students: [student('s1', 'Ana', 'Gómez', 'math', '123')],
    }),
  ];
  const alerts = computeInstitutionAlerts(rows);
  const t = alerts.find((al) => al.type === 'teacher_inactive');
  check('Docente inactivo 40 días con estudiantes → alerta teacher_inactive', !!t, JSON.stringify(alerts));
}

// ── 11. Docente inactivo SIN estudiantes → sin alerta ─────────────────────
{
  const rows = [
    teacherRow('t1', 'Docente Uno', {
      lastLoginAt: NOW - 40 * DAY,
      subjects: [subject('math', 'Matemáticas', 'matutino')],
      students: [],
    }),
  ];
  const alerts = computeInstitutionAlerts(rows);
  check('Docente inactivo sin estudiantes → sin alerta', countByType(alerts, 'teacher_inactive') === 0, JSON.stringify(alerts));
}

// ── 12. Límite por categoría (MAX_PER_CATEGORY) ───────────────────────────
{
  const students = [];
  const grades = [];
  for (let i = 0; i < 40; i++) {
    students.push(student(`s${i}`, `Alumno${i}`, 'Test', 'math', String(i)));
    grades.push(grade(`s${i}`, 'math', 'e1', 40), grade(`s${i}`, 'math', 'e2', 45));
  }
  const rows = [
    teacherRow('t1', 'Docente Uno', {
      subjects: [subject('math', 'Matemáticas', 'matutino')],
      students,
      evaluations: [evaluation('e1', 'math', 100), evaluation('e2', 'math', 100)],
      grades,
    }),
  ];
  const alerts = computeInstitutionAlerts(rows);
  check(
    `40 estudiantes en riesgo → max ${THRESHOLDS.MAX_PER_CATEGORY} por categoría`,
    countByType(alerts, 'student_grades') <= THRESHOLDS.MAX_PER_CATEGORY,
    `obtenidas ${countByType(alerts, 'student_grades')}`
  );
}

// ── Resumen ───────────────────────────────────────────────────────────────
console.log(`\n── Resultado: ${pass} ✅  ${fail} ❌ ──\n`);
if (fail > 0) {
  console.error('Fallos:', failures);
  process.exit(1);
}
console.log('Fase 4: validación de alertas con datos sintéticos OK (sin falsos positivos).');