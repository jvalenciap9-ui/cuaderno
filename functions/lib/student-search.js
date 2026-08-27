// student-search.js — Lógica pura de la búsqueda de estudiantes con detección
// de discrepancias (Módulo 2 del plan del dashboard administrativo). Sin
// dependencias de Firebase: recibe los datos ya cargados de la institución
// (docentes + asignaturas + estudiantes) y el texto de búsqueda, y devuelve
// una lista plana de filas (estudiante × asignatura) con detección de
// inconsistencias. Testeada en scripts/test-search-student.mjs.
//
// La Cloud Function `searchStudent` valida el rol admin, carga los datos vía
// Admin SDK (loadInstitutionData) y delega la construcción de filas aquí.

const DEFAULT_LIMIT = 50;

function normText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Convierte la consulta en tokens normalizados (sin tildes, minúsculas y con
// espacios colapsados). NUNCA se construye un RegExp con la entrada del
// usuario: los tokens se comparan con `String.prototype.includes`.
function queryTokens(q) {
  return normText(q).trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
}

// Una persona coincide cuando TODOS los tokens están presentes como subcadena
// del hay normalizado. Esto hace la búsqueda insensible al ORDEN de las
// palabras ("Rodríguez María" == "María Rodríguez") y a los espacios
// redundantes ("María  Rodríguez"), además de insensible a tildes/mayúsculas.
function hayMatchesTokens(hay, tokens) {
  return tokens.every((t) => hay.includes(t));
}

// Construye las filas planas de la búsqueda + detección de discrepancias.
// `rows` es el resultado de loadInstitutionData:
//   [{ teacher: { uid, displayName, email }, subjects: [...], students: [...] }]
// `query` puede ser nombre (firstName/lastName) o cédula.
// Lanza Error('QUERY_TOO_SHORT') con menos de 2 caracteres.
//
// Discrepancias detectadas por persona (agrupada por cédula, o por
// nombre+apellido si no hay cédula):
//   - Asignado a varios periodos  → membresías en >1 turno distinto.
//   - Misma asignatura en varios periodos → la misma asignatura en >1 turno.
//   - Matrícula duplicada en la misma asignatura → la misma asignatura en 2+
//     membresías (p. ej. dos docentes o dos fichas de estudiante).
// Las filas de personas con alguna discrepancia salen con estado 'inactivo'.
function buildSearchRows(rows, query, opts = {}) {
  const nq = normText(query).trim();
  if (nq.length < 2) throw new Error('QUERY_TOO_SHORT');
  const tokens = queryTokens(query);
  const limit = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : DEFAULT_LIMIT;

  // 1) Consolidar TODAS las membresías de cada persona (por cédula o nombre).
  const byPerson = new Map();
  for (const { teacher, subjects, students } of rows || []) {
    const teacherName = teacher && (teacher.displayName || (teacher.email || '').split('@')[0] || 'Docente');
    const subjectById = new Map((subjects || []).map((s) => [s.id, s]));
    for (const st of students || []) {
      const key = String(st.cedula || '').trim() || `${normText(st.firstName)}|${normText(st.lastName)}`;
      if (!byPerson.has(key)) {
        byPerson.set(key, {
          studentId: st.id,
          cedula: st.cedula || '',
          firstName: st.firstName || '',
          lastName: st.lastName || '',
          memberships: [],
        });
      }
      const person = byPerson.get(key);
      if (person.memberships.some((m) => m.subjectId === st.subjectId && m.teacherUid === teacher.uid)) continue;
      const sub = subjectById.get(st.subjectId);
      person.memberships.push({
        subjectId: st.subjectId,
        subjectName: sub ? sub.name : 'Sin nombre',
        grado: sub ? sub.nivelEducativo || '' : '',
        periodo: sub ? sub.periodo || '' : '',
        teacherUid: teacher.uid,
        teacherName,
      });
    }
  }

  // 2) Coincidencias por firstName, lastName o cédula (insensible a tildes,
  // insensible al orden de palabras y a espacios redundantes: ver
  // queryTokens/hayMatchesTokens).
  const matches = [];
  for (const person of byPerson.values()) {
    const hay = normText([person.firstName, person.lastName, person.cedula].join(' '));
    if (hayMatchesTokens(hay, tokens)) matches.push(person);
  }

  // 3) Detección de discrepancias por persona.
  for (const person of matches) {
    const periodos = new Set(person.memberships.map((m) => m.periodo).filter(Boolean));
    const enVariosPeriodos = periodos.size > 1;

    const subjectPeriodos = new Map(); // norm(subjectName) → Set(periodos)
    const subjectCounts = new Map(); // norm(subjectName) → nº membresías
    for (const m of person.memberships) {
      const k = normText(m.subjectName);
      if (!subjectPeriodos.has(k)) subjectPeriodos.set(k, new Set());
      if (m.periodo) subjectPeriodos.get(k).add(m.periodo);
      subjectCounts.set(k, (subjectCounts.get(k) || 0) + 1);
    }
    const sujetosEnVariosPeriodos = new Set(
      Array.from(subjectPeriodos.entries()).filter(([, ps]) => ps.size > 1).map(([k]) => k)
    );
    const duplicados = new Set(
      Array.from(subjectCounts.entries()).filter(([, c]) => c > 1).map(([k]) => k)
    );

    person._flags = { enVariosPeriodos, sujetosEnVariosPeriodos, duplicados };
  }

  // 4) Filas planas estudiante × asignatura.
  const out = [];
  for (const person of matches) {
    for (const m of person.memberships) {
      const k = normText(m.subjectName);
      const discrepancias = [];
      if (person._flags.enVariosPeriodos) discrepancias.push('Asignado a varios periodos');
      if (person._flags.sujetosEnVariosPeriodos.has(k)) discrepancias.push('Misma asignatura en varios periodos');
      if (person._flags.duplicados.has(k)) discrepancias.push('Matrícula duplicada en la misma asignatura');
      out.push({
        studentId: person.studentId,
        nombreCompleto: `${person.firstName} ${person.lastName}`.trim(),
        cedula: person.cedula,
        asignatura: m.subjectName,
        docente: m.teacherName,
        grado: m.grado,
        periodo: m.periodo,
        estado: discrepancias.length > 0 ? 'inactivo' : 'activo',
        discrepancias,
        subjectId: m.subjectId,
        teacherUid: m.teacherUid,
      });
    }
  }

  const total = out.length;
  return { query: String(query || ''), total, limit, students: out.slice(0, limit) };
}

module.exports = { buildSearchRows, queryTokens, hayMatchesTokens, DEFAULT_LIMIT };
