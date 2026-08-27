/**
 * test-search-student.mjs — Módulo 2: validación de la búsqueda de estudiantes
 * con detección de discrepancias. Verifica buildSearchRows (lógica pura de la
 * Cloud Function searchStudent) con datos sintéticos:
 *   Caso 1: buscar por nombre "María" → todas sus asignaturas.
 *   Caso 2: buscar por cédula "123456" → el estudiante exacto y sus asignaturas.
 *   Caso 3: estudiante con asignaturas en dos periodos → filas marcadas
 *           'inactivo' (discrepancia detectable).
 *   Caso 4: admin sin permisos → lo garantiza assertAdmin en la Cloud Function
 *           (misma guardia que el resto de funciones admin, probada en
 *           scripts/test-stats-admin.mjs con "docente → permission-denied").
 *           Aquí se valida el guard de entrada: QUERY_TOO_SHORT.
 *   Caso 5: token matching — nombre y apellido en cualquier orden
 *           ("maria rodriguez" == "rodriguez maria"), espacios redundantes
 *           ("maría   rodríguez"), solo apellido, cédula parcial y
 *           accent/case-insensitivity (espejo de adminSearchStudents).
 *
 * Uso: node scripts/test-search-student.mjs   (no requiere emulador)
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildSearchRows, DEFAULT_LIMIT } = require('../functions/lib/student-search.js');

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

// ── Fábricas de datos sintéticos ──
const sub = (id, name, periodo = '', nivel = '') => ({ id, name, periodo, nivelEducativo: nivel });
const stu = (id, cedula, firstName, lastName, subjectId) => ({ id, cedula, firstName, lastName, subjectId });
const t = (uid, displayName, subjects, students) => ({
  teacher: { uid, displayName, email: `${uid}@institucion.edu.ve` },
  subjects,
  students,
});

const PERIODO_M = 'matutino';
const PERIODO_V = 'vespertino';
const NIVEL_S = 'secundaria';
const NIVEL_P = 'primaria';

// Docente A: Matemáticas (matutino, secundaria) y Biología (matutino, primaria)
const teacherA = t('ta', 'Prof. García', [
  sub('s1', 'Matemáticas', PERIODO_M, NIVEL_S),
  sub('s2', 'Biología', PERIODO_M, NIVEL_P),
], [
  stu('st1', 'V-111', 'María', 'López', 's1'),
  stu('st2', 'V-111', 'María', 'López', 's2'),
  stu('st3', 'V-222', 'Juan', 'Pérez', 's1'),
]);

// Docente B: Física (matutino) y Química (vespertino)
const teacherB = t('tb', 'Prof. Mendoza', [
  sub('s3', 'Física', PERIODO_M, NIVEL_S),
  sub('s4', 'Química', PERIODO_V, NIVEL_S),
], [
  stu('st4', 'V-333', 'Ana', 'Torres', 's3'),
  stu('st5', 'V-333', 'Ana', 'Torres', 's4'),
  stu('st6', 'V-444', 'Diego', 'Rojas', 's3'),
  stu('st7', 'V-123456', 'Carla', 'Núñez', 's4'),
]);

const rows = [teacherA, teacherB];

console.log(`── defaults (límite ${DEFAULT_LIMIT}) ──`);
check('límite por defecto es 50', DEFAULT_LIMIT === 50);

console.log('── Caso 1: buscar por nombre ──');
const r1 = buildSearchRows(rows, 'María');
check('solo devuelve estudiantes con "María" en nombre/apellido', r1.students.every(r => r.nombreCompleto.startsWith('María')));
check('María aparece en sus 2 asignaturas', r1.students.length === 2);
check('campos del boletín presentes', (() => {
  const row = r1.students[0];
  return row.studentId === 'st1' && row.nombreCompleto === 'María López' && row.cedula === 'V-111'
    && row.asignatura === 'Matemáticas' && row.docente === 'Prof. García'
    && row.grado === NIVEL_S && row.periodo === PERIODO_M;
})());
check('María (2 asignaturas en el mismo turno) sin discrepancias → activo',
  r1.students.every(r => r.estado === 'activo' && r.discrepancias.length === 0));
check('Juan (Matemáticas) no aparece al buscar "María"',
  r1.students.every(r => r.nombreCompleto !== 'Juan Pérez'));

console.log('── Caso 2: buscar por cédula ──');
const r2 = buildSearchRows(rows, '123456');
check('devuelve solo a Carla Núñez (cédula exacta)',
  r2.students.length === 1 && r2.students[0].nombreCompleto === 'Carla Núñez' && r2.students[0].cedula === 'V-123456');
check('incluye su asignatura, docente y estado activo',
  r2.students[0].asignatura === 'Química' && r2.students[0].docente === 'Prof. Mendoza' && r2.students[0].estado === 'activo');
const r2b = buildSearchRows(rows, 'V-333');
check('búsqueda parcial de cédula con prefijo también matchea',
  r2b.students.length === 2 && r2b.students.every(r => r.nombreCompleto === 'Ana Torres'));

console.log('── Caso 3: estudiante con asignaturas en dos periodos ──');
const r3 = buildSearchRows(rows, 'Ana');
check('Ana aparece en sus 2 asignaturas (Física matutino + Química vespertino)',
  r3.students.length === 2);
check('sus filas se marcan "inactivo" por discrepancia',
  r3.students.every(r => r.estado === 'inactivo'));
check('la razón de discrepancia está presente',
  r3.students.every(r => r.discrepancias.includes('Asignado a varios periodos')));

const teacherC = t('tc', 'Prof. Ríos', [
  sub('s5', 'Historia', PERIODO_M, NIVEL_S),
  sub('s6', 'Historia', PERIODO_V, NIVEL_S),
], [
  stu('st8', 'V-555', 'Luis', 'Bravo', 's5'),
  stu('st9', 'V-555', 'Luis', 'Bravo', 's6'),
]);
const r3b = buildSearchRows([...rows, teacherC], 'Luis');
check('misma asignatura en dos periodos → discrepancia "Misma asignatura en varios periodos"',
  r3b.students.every(r => r.discrepancias.includes('Misma asignatura en varios periodos') && r.estado === 'inactivo'));
check('también detecta que está asignado a varios periodos',
  r3b.students.every(r => r.discrepancias.includes('Asignado a varios periodos')));

// Matrícula duplicada: misma persona con dos fichas en la misma asignatura/turno.
const teacherD = t('td', 'Prof. Silva', [sub('s7', 'Inglés', PERIODO_M, NIVEL_P)], [
  stu('st10', 'V-666', 'Sofía', 'Ramos', 's7'),
]);
const teacherE = t('te', 'Prof. Campos', [sub('s8', 'Inglés', PERIODO_M, NIVEL_P)], [
  stu('st11', 'V-666', 'Sofía', 'Ramos', 's8'),
]);
const r3c = buildSearchRows([...rows, teacherC, teacherD, teacherE], 'Sofía');
check('matrícula duplicada de la misma asignatura → discrepancia detectada',
  r3c.students.length === 2 && r3c.students.every(r => r.discrepancias.includes('Matrícula duplicada en la misma asignatura') && r.estado === 'inactivo'));

console.log('── Robustez ──');
check('búsqueda insensible a tildes ("maria" encuentra "María")',
  buildSearchRows(rows, 'maria').students.length === 2);
check('nombre y apellido juntos ("ana torres") matchean',
  buildSearchRows(rows, 'ana torres').students.length === 2);
check('sin coincidencias devuelve lista vacía',
  buildSearchRows(rows, 'zzz').students.length === 0 && buildSearchRows(rows, 'zzz').total === 0);

console.log('── Caso 5: token matching (nombre y apellido, orden y espacios) ──');
// Docente F: solo se usa en los casos nuevos para no alterar los resultados de
// los casos 1-3 (María Rodríguez / Carlos Rodríguez comparten apellido).
const teacherF = t('tf', 'Prof. Vega', [
  sub('s9', 'Historia', PERIODO_M, NIVEL_S),
], [
  stu('st12', 'V-777', 'María', 'Rodríguez', 's9'),
  stu('st13', 'V-888', 'Carlos', 'Rodríguez', 's9'),
]);
const rowsF = [...rows, teacherF];

const r5a = buildSearchRows(rowsF, 'maria rodriguez');
check('"maria rodriguez" (orden natural) encuentra a María Rodríguez',
  r5a.students.length === 1 && r5a.students[0].nombreCompleto === 'María Rodríguez' && r5a.students[0].cedula === 'V-777');

const r5b = buildSearchRows(rowsF, 'rodriguez maria');
check('"rodriguez maria" (orden invertido) también encuentra a María Rodríguez',
  r5b.students.length === 1 && r5b.students[0].nombreCompleto === 'María Rodríguez');

const r5c = buildSearchRows(rowsF, 'maría   rodríguez');
check('"maría   rodríguez" (espacios dobles) matchea',
  r5c.students.length === 1 && r5c.students[0].nombreCompleto === 'María Rodríguez');

const r5d = buildSearchRows(rowsF, 'rodriguez');
check('solo apellido ("rodriguez") devuelve TODOS los de ese apellido',
  r5d.students.length === 2 && r5d.students.every((r) => r.nombreCompleto.endsWith('Rodríguez')));

const r5e = buildSearchRows(rowsF, 'V-777');
check('subcadena de cédula ("V-777") sigue funcionando',
  r5e.students.length === 1 && r5e.students[0].cedula === 'V-777');

check('accent-insensitive con apellido tildado ("maria rodriguez" == "María Rodríguez")',
  buildSearchRows(rowsF, 'maria rodriguez').students[0]?.nombreCompleto === 'María Rodríguez'
  && buildSearchRows(rowsF, 'MARIA RODRÍGUEZ').students[0]?.nombreCompleto === 'María Rodríguez');

const many = [t('tm', 'Prof. Masivo',
  Array.from({ length: 1 }, (_, i) => sub(`m${i}`, `Materia ${i}`, PERIODO_M, NIVEL_S)),
  Array.from({ length: 60 }, (_, i) => stu(`ms${i}`, `C-${i}`, `Alumno${i}`, 'Apellido', 'm0'))
)];
const rLimit = buildSearchRows(many, 'Alumno');
check('respeta el límite de 50 resultados',
  rLimit.students.length === 50 && rLimit.total === 60 && rLimit.limit === 50);
check('límite personalizado se respeta',
  buildSearchRows(many, 'Alumno', { limit: 10 }).students.length === 10);

checkThrows('consulta de 1 carácter lanza QUERY_TOO_SHORT',
  () => buildSearchRows(rows, 'a'), 'QUERY_TOO_SHORT');
checkThrows('consulta vacía lanza QUERY_TOO_SHORT',
  () => buildSearchRows(rows, ''), 'QUERY_TOO_SHORT');
checkThrows('consulta de solo espacios lanza QUERY_TOO_SHORT',
  () => buildSearchRows(rows, '   '), 'QUERY_TOO_SHORT');

check('estudiante normal (un solo turno, sin duplicados) queda "activo"',
  buildSearchRows(rows, 'Diego').students.every(r => r.estado === 'activo'));

console.log('\n──────────────────────────────');
console.log(`Resultado: ${pass} ✅ / ${fail} ❌`);
if (fail > 0) {
  console.log('Fallos:', failures.join(', '));
  process.exit(1);
}
