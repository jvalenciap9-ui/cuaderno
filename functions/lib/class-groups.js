/**
 * class-groups.js — Núcleo LÓGICO PURO del Aula/Grupo multiasignatura.
 *
 * Espejo probado de las funciones puras que usa el cliente
 * (src/lib/classGroups.ts). Convención del repo: la lógica pura vive aquí y
 * se valida en scripts/test-class-groups.mjs SIN emulador (igual que
 * risk-calculator, school-config, etc.). Cualquier cambio debe reflejarse en
 * AMBOS archivos.
 *
 * Modelo de extensión (decisión documentada):
 * - Nueva entidad `classGroups/{id}` (userId propietario, nombre, nivel,
 *   grado, sección, periodo, modalidad 'una'|'varias').
 * - `subjects.groupId` opcional vincula una materia a su aula.
 * - Participantes y asistencia diaria se guardan UNA sola vez bajo la
 *   ASIGNATURA CANÓNICA del aula (la de menor clave de orden estable:
 *   createdAt asc, luego id asc). Las UI resuelven el canonical antes de
 *   leer/escribir students/attendance.
 * - Evaluaciones y calificaciones siguen siendo POR MATERIA (aislamiento).
 * - Toda asignatura sin groupId (o cuyo grupo ya no existe) se interpreta
 *   como un Aula/Grupo VIRTUAL de una sola materia: cero migración, cero
 *   reescritura, identificadores intactos.
 */

'use strict';

const MODALIDADES = ['una', 'varias'];

// Sugerencias curriculares NO restrictivas (editables/ampliables por el docente).
const SUGERENCIAS_MATERIAS = {
  inicial: [
    'Español', 'Matemáticas', 'Ciencias Naturales', 'Ciencias Sociales',
    'Inglés', 'Educación Física', 'Arte', 'Informática',
  ],
  primaria: [
    'Español', 'Matemáticas', 'Ciencias Naturales', 'Ciencias Sociales',
    'Inglés', 'Educación Física', 'Arte', 'Informática',
  ],
};

const MIN_MATERIAS_AULA = 2;
const MAX_MATERIAS_AULA = 20;

/** Normaliza un nombre: recorta y colapsa espacios internos. */
function normalizeName(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
}

/** Clave de comparación insensible a mayúsculas/tildes para detectar duplicados. */
function nameKey(s) {
  const n = normalizeName(s).toLowerCase();
  return n.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Valida la lista de materias de un aula multiasignatura.
 * Rechaza vacíos (tras normalizar) y duplicados dentro del aula
 * (insensible a mayúsculas/tildes/espacios). Devuelve la lista normalizada.
 */
function validateMateriaNames(rawNames) {
  if (!Array.isArray(rawNames)) {
    return { ok: false, error: 'La lista de materias no es válida.' };
  }
  const names = rawNames.map(normalizeName);
  const seen = new Set();
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    if (!n) {
      return { ok: false, error: `La materia #${i + 1} no puede quedar vacía.` };
    }
    const key = nameKey(n);
    if (seen.has(key)) {
      return { ok: false, error: `La materia "${n}" está duplicada dentro del aula.` };
    }
    seen.add(key);
  }
  if (names.length < MIN_MATERIAS_AULA) {
    return { ok: false, error: `Un aula multiasignatura necesita al menos ${MIN_MATERIAS_AULA} materias.` };
  }
  if (names.length > MAX_MATERIAS_AULA) {
    return { ok: false, error: `Un aula multiasignatura no puede tener más de ${MAX_MATERIAS_AULA} materias.` };
  }
  return { ok: true, names };
}

/**
 * Valida los datos base de un Aula/Grupo antes de crear el documento.
 * modalidad 'una' NO crea aula real (ruta legacy intacta), así que aquí solo
 * se admite 'varias'.
 */
function validateClassGroupInput(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Datos del aula ausentes.' };
  }
  const name = normalizeName(input.name);
  if (!name || name.length > 200) {
    return { ok: false, error: 'El nombre del aula es obligatorio (máx. 200 caracteres).' };
  }
  if (input.modality !== 'varias') {
    return { ok: false, error: 'Solo se crea un documento de aula para la modalidad "Varias materias".' };
  }
  const strField = (v, max) => (typeof v === 'string' && v.length <= max ? v : '');
  const materias = validateMateriaNames(input.materias || []);
  if (!materias.ok) return materias;
  return {
    ok: true,
    group: {
      name,
      nivelEducativo: strField(input.nivelEducativo, 40),
      grado: strField(input.grado, 60),
      seccion: strField(input.seccion, 60),
      periodo: strField(input.periodo, 40),
      modalidad: 'varias',
    },
    materias: materias.names,
  };
}

/**
 * Orden estable de materias dentro de un aula: createdAt asc, luego id asc.
 * Nunca depende del orden del array recibido.
 */
function siblingSortKey(s) {
  const created = typeof s.createdAt === 'number' ? s.createdAt : Number.MAX_SAFE_INTEGER;
  return `${String(created).padStart(15, '0')}:${String(s.id == null ? '' : s.id)}`;
}

/**
 * Devuelve las materias hermanas de un aula (mismo groupId), orden estable.
 */
function siblingsOf(subjects, groupId) {
  if (!groupId) return [];
  return subjects
    .filter((s) => s && s.groupId === groupId)
    .slice()
    .sort((a, b) => (siblingSortKey(a) < siblingSortKey(b) ? -1 : 1));
}

/**
 * Resuelve la ASIGNATURA CANÓNICA que contiene participantes/asistencia
 * compartidos del aula al que pertenece `subjectId`. Si `subjectId` es una
 * asignatura independiente (sin grupo o con grupo huérfano), devuelve ella
 * misma. Idempotente y determinista.
 */
function resolveCanonicalSubject(subjects, subjectId) {
  const self = subjects.find((s) => s && String(s.id) === String(subjectId));
  if (!self) return null;
  if (!self.groupId) return self;
  const sibs = siblingsOf(subjects, self.groupId);
  if (sibs.length === 0) return self; // grupo huérfano → comportamiento legacy
  return sibs[0];
}

/** Id canónico para students/attendance del aula de `subjectId`. */
function resolveCanonicalSubjectId(subjects, subjectId) {
  const canon = resolveCanonicalSubject(subjects, subjectId);
  return canon ? String(canon.id) : null;
}

/**
 * Normalización/migración VIRTUAL: interpreta una asignatura como Aula/Grupo
 * de UNA materia sin tocar datos ni identificadores. Idempotente: aplicar dos
 * veces produce el mismo resultado. NO fusiona asignaturas aunque tengan
 * estudiantes similares.
 */
function toVirtualGroup(subject) {
  if (!subject || subject.id == null) return null;
  const members = subject.groupId ? siblingsOf([subject], subject.groupId) : [];
  return {
    virtual: true,
    id: subject.groupId || `virtual:${subject.id}`,
    name: subject.name,
    modalidad: 'una',
    memberIds: members.length > 0 ? members.map((m) => String(m.id)) : [String(subject.id)],
  };
}

/**
 * Unidades que consume el plan (límite Gratis = 2 unidades/año):
 * cada asignatura INDEPENDIENTE cuenta 1; cada aula multiasignatura cuenta 1
 * SIN importar cuántas materias internas tenga (no consumen cuota).
 * Asignaturas huérfanas (groupId apunta a un grupo inexistente) cuentan como
 * independientes para no regalar cuota.
 */
function planUnits(subjects, groups) {
  const knownGroups = new Set(
    (Array.isArray(groups) ? groups : [])
      .map((g) => String(g && g.id))
      .filter(Boolean),
  );
  let standalone = 0;
  let groupMembers = 0;
  for (const s of Array.isArray(subjects) ? subjects : []) {
    if (!s) continue;
    if (s.groupId && knownGroups.has(String(s.groupId))) {
      groupMembers++;
    } else {
      standalone++;
    }
  }
  const groupCount = knownGroups.size;
  return { standaloneSubjects: standalone, groups: groupCount, internalMaterias: groupMembers, units: standalone + groupCount };
}

const PLAN_UNIT_LIMITS = { free: 2, pro: 999, school: 999 };

/**
 * ¿Puede el docente crear un NUEVO AULA multiasignatura?
 * Free: máx 2 unidades Y máx 1 aula en total.
 */
function canCreateClassGroup(plan, subjects, groups) {
  const max = PLAN_UNIT_LIMITS[plan] != null ? PLAN_UNIT_LIMITS[plan] : 2;
  const u = planUnits(subjects, groups);
  if (plan === 'free' && u.groups >= 1) {
    return { allowed: false, reason: 'El plan Gratuito permite un único Aula/Grupo multiasignatura. Mejora a Premium para crear más.' };
  }
  if (u.units + 1 > max) {
    return { allowed: false, reason: `Has alcanzado tu límite de ${max} (asignaturas y/o aulas). Mejora tu plan para ampliarlo.` };
  }
  return { allowed: true };
}

/**
 * ¿Puede el docente crear una asignatura INDEPENDIENTE (modalidad una materia)?
 * Free: unidades actuales + 1 ≤ límite (un aula existente ya ocupa 1 unidad).
 */
function canCreateStandaloneSubject(plan, subjects, groups) {
  const max = PLAN_UNIT_LIMITS[plan] != null ? PLAN_UNIT_LIMITS[plan] : 2;
  const u = planUnits(subjects, groups);
  if (u.units + 1 > max) {
    return { allowed: false, reason: `Has alcanzado tu límite de ${max} (asignaturas y/o aulas). Mejora tu plan para ampliarlo.` };
  }
  return { allowed: true };
}

/**
 * Aislamiento de calificaciones: solo las notas cuya subjectId coincida con
 * la materia visible deben mostrarse (las queries de Firestore ya filtran por
 * subjectId; este filtro en memoria es la segunda barrera y la pieza testeable).
 */
function filterGradesByMateria(allGrades, materiaId) {
  const target = String(materiaId);
  return (Array.isArray(allGrades) ? allGrades : []).filter(
    (g) => g && String(g.subjectId) === target,
  );
}

/** Igual para evaluaciones. */
function filterEvaluationsByMateria(allEvals, materiaId) {
  const target = String(materiaId);
  return (Array.isArray(allEvals) ? allEvals : []).filter(
    (e) => e && String(e.subjectId) === target,
  );
}

/**
 * Al ELIMINAR una materia de un aula decide qué más hay que limpiar:
 * - {deleteGroup:false, reassignTo:null}: materia intermedia → solo borrarla.
 * - última materia → borrar también el doc del aula y liberar 1 unidad
 *   (counter -1 lo hace el cliente).
 * Si era la canónica y quedan hermanas → reassignTo = nuevo canonical
 * (el cliente MUEVE students/attendance a ese id: cero pérdida de historial).
 */
function planSubjectDeletion(subjects, groups, subjectId) {
  const self = subjects.find((s) => s && String(s.id) === String(subjectId));
  if (!self) return { found: false };
  if (!self.groupId) {
    return { found: true, isGrouped: false, deleteGroup: false, reassignTo: null, counterDelta: -1 };
  }
  const known = (groups || []).some((g) => g && String(g.id) === String(self.groupId));
  if (!known) {
    // Grupo huérfano: tratar como independiente.
    return { found: true, isGrouped: false, deleteGroup: false, reassignTo: null, counterDelta: -1 };
  }
  const rest = siblingsOf(subjects, self.groupId).filter((s) => String(s.id) !== String(self.id));
  if (rest.length === 0) {
    return { found: true, isGrouped: true, lastMember: true, deleteGroup: true, reassignTo: null, counterDelta: -1 };
  }
  const canonWasSelf = resolveCanonicalSubjectId(subjects, self.id) === String(self.id);
  return {
    found: true,
    isGrouped: true,
    lastMember: false,
    deleteGroup: false,
    reassignTo: canonWasSelf ? String(rest[0].id) : null,
    counterDelta: 0,
  };
}

/**
 * Recordatorio de última materia usada POR AULA (clave de localStorage).
 */
function lastMateriaStorageKey(groupId) {
  const safe = String(groupId == null ? '' : groupId).replace(/[^a-zA-Z0-9_:-]/g, '');
  return `ediagil_aula_ultima_materia_${safe}`;
}

module.exports = {
  MODALIDADES,
  SUGERENCIAS_MATERIAS,
  MIN_MATERIAS_AULA,
  MAX_MATERIAS_AULA,
  normalizeName,
  nameKey,
  validateMateriaNames,
  validateClassGroupInput,
  siblingSortKey,
  siblingsOf,
  resolveCanonicalSubject,
  resolveCanonicalSubjectId,
  toVirtualGroup,
  planUnits,
  PLAN_UNIT_LIMITS,
  canCreateClassGroup,
  canCreateStandaloneSubject,
  filterGradesByMateria,
  filterEvaluationsByMateria,
  planSubjectDeletion,
  lastMateriaStorageKey,
};
