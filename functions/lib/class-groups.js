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
const MAX_PLAN_DRAFT_CHARS = 500_000;

/** Normaliza un nombre: recorta y colapsa espacios internos. */
function normalizeName(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
}

function computeAulaDisplayName(grado, seccion, customName) {
  const custom = normalizeName(customName || '');
  let g = normalizeName(grado || '');
  let s = normalizeName(seccion || '');

  if (g && s && g.toLowerCase() === s.toLowerCase()) {
    s = '';
  }

  let baseGradeSection = '';
  if (g && s) {
    if (s.toLowerCase().startsWith(g.toLowerCase())) {
      baseGradeSection = s;
    } else if (g.toLowerCase().endsWith(s.toLowerCase())) {
      baseGradeSection = g;
    } else {
      baseGradeSection = `${g} ${s}`;
    }
  } else {
    baseGradeSection = g || (s ? `Sección ${s}` : '');
  }

  if (custom) {
    if (!baseGradeSection) return custom;
    if (custom.toLowerCase() === baseGradeSection.toLowerCase()) return custom;
    if (custom.toLowerCase().includes(baseGradeSection.toLowerCase())) return custom;
    return `${custom} · ${baseGradeSection}`;
  }

  return baseGradeSection;
}

/** Clave de comparación insensible a mayúsculas/tildes para detectar duplicados. */
function nameKey(s) {
  const n = normalizeName(s).toLowerCase();
  return n.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function toAulaPlanType(plan) {
  if (plan === 'mensual' || plan === 'trimestral' || plan === 'cuatrimestral') return plan;
  if (plan === 'anual' || plan === 'anual_8' || plan === 'anual_10') return 'anual';
  return 'semanal';
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
  if (plan === 'free') {
    return {
      allowed: false,
      reason: 'Aula Multiasignatura es una función exclusiva de Premium Pro. Actualiza tu plan para crear aulas multiasignatura.',
    };
  }
  const max = PLAN_UNIT_LIMITS[plan] != null ? PLAN_UNIT_LIMITS[plan] : 2;
  const u = planUnits(subjects, groups);
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

/**
 * Valida y distribuye el plan de Magia IA asignando ítems únicamente a los
 * subjectIds autorizados del aula. Cualquier ítem con un subjectId desconocido o
 * ausente se mueve a `unclassified` ("Pendiente de clasificar"). NUNCA se
 * asigna automáticamente a Español u otra materia por defecto.
 */
function semanticKey(value) {
  return nameKey(String(value || '')).replace(/[^a-z0-9ñ]+/g, ' ').trim();
}

function uniqueSubjectMention(value, subjects, exact = false) {
  const text = semanticKey(value);
  if (!text) return null;
  const padded = ` ${text} `;
  const matches = subjects.filter((subject) => exact
    ? text === subject.key
    : padded.includes(` ${subject.key} `));
  return matches.length === 1 ? matches[0].id : null;
}

function resolveDistributedSubjectId(item, validMap, semanticSubjects) {
  const rawId = item.subjectId ? String(item.subjectId) : '';
  const explicit = item.subjectName != null ? item.subjectName : (item.materia != null ? item.materia : item.subject);
  const explicitId = uniqueSubjectMention(explicit, semanticSubjects, true);
  if (explicitId) return explicitId;
  const titleId = uniqueSubjectMention(item.title, semanticSubjects);
  if (titleId) return titleId;
  if (rawId && validMap.has(rawId)) return rawId;
  return uniqueSubjectMention(item.description != null ? item.description : item.content, semanticSubjects) || '';
}

const WEEKDAY_INDEX = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

function validIsoDate(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? '' : date;
}

function expectedWeekday(value) {
  const key = semanticKey(value);
  for (const [name, index] of Object.entries(WEEKDAY_INDEX)) {
    if (` ${key} `.includes(` ${name} `)) return index;
  }
  return null;
}

function dateMatchesWeekday(date, weekday) {
  const expected = expectedWeekday(weekday);
  if (!date || expected === null) return true;
  return new Date(`${date}T00:00:00Z`).getUTCDay() === expected;
}

function validateAIDistribution(rawModules, rawEvaluations, rawUnclassified, validSubjects, defaultMaxScore = 100) {
  const validMap = new Map();
  (Array.isArray(validSubjects) ? validSubjects : []).forEach((s) => {
    if (s && s.id) validMap.set(String(s.id), String(s.name || s.id));
  });

  const semanticSubjects = Array.from(validMap.entries()).map(([id, name]) => ({
    id,
    key: semanticKey(name),
  })).filter((subject) => subject.key.length > 0);

  const validModules = [];
  const validEvaluations = [];
  const unclassified = Array.isArray(rawUnclassified) ? [...rawUnclassified] : [];
  const matchedSubjects = new Set();

  (Array.isArray(rawModules) ? rawModules : []).forEach((m, idx) => {
    if (!m || typeof m !== 'object') return;
    const subId = resolveDistributedSubjectId(m, validMap, semanticSubjects);
    const title = normalizeName(m.title || '');
    if (subId && validMap.has(subId) && title) {
      let startDate = validIsoDate(m.startDate || m.date);
      let endDate = validIsoDate(m.endDate) || startDate;
      const weekday = m.weekday || m.dayOfWeek || m.dia;
      if (startDate && !dateMatchesWeekday(startDate, weekday)) {
        unclassified.push({
          title: `Revisar fecha: ${title}`,
          content: `La fecha ${startDate} no coincide con el día indicado (${String(weekday)}).`,
        });
        startDate = '';
        endDate = '';
      }
      if (startDate && endDate && endDate < startDate) {
        unclassified.push({
          title: `Revisar rango: ${title}`,
          content: `La fecha final ${endDate} es anterior a ${startDate}.`,
        });
        endDate = startDate;
      }
      matchedSubjects.add(validMap.get(subId));
      validModules.push({
        subjectId: subId,
        title,
        description: String(m.description || '').trim(),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        order: typeof m.order === 'number' && m.order > 0 ? m.order : idx + 1,
      });
    } else if (title) {
      unclassified.push({
        title,
        content: String(m.description || 'Módulo sin materia asignada').trim(),
      });
    }
  });

  (Array.isArray(rawEvaluations) ? rawEvaluations : []).forEach((e) => {
    if (!e || typeof e !== 'object') return;
    const subId = resolveDistributedSubjectId(e, validMap, semanticSubjects);
    let title = normalizeName(e.title || '');
    if (!title) return;

    if (subId && validMap.has(subId)) {
      matchedSubjects.add(validMap.get(subId));
      const configuredMaxScore = Number(defaultMaxScore) > 0 ? Number(defaultMaxScore) : 100;
      const rawMaxScore = Number(e.maxScore);
      const hasValidRawMaxScore = Number.isFinite(rawMaxScore) && rawMaxScore > 0;
      const maxScore = configuredMaxScore !== 100
        ? configuredMaxScore
        : (hasValidRawMaxScore ? rawMaxScore : configuredMaxScore);
      const date = validIsoDate(e.date);
      const weekday = e.weekday || e.dayOfWeek || e.dia;
      const weekdayMismatch = !!date && !dateMatchesWeekday(date, weekday);
      const type = ['teorica', 'practica', 'apreciativa'].includes(e.type) ? e.type : 'teorica';
      const isDraft = !date || !hasValidRawMaxScore || weekdayMismatch;

      if (weekdayMismatch) {
        unclassified.push({
          title: `Revisar fecha: ${title}`,
          content: `La fecha ${date} no coincide con el día indicado (${String(weekday)}).`,
        });
      }

      if (isDraft && !title.toLowerCase().includes('borrador')) {
        title = `${title} (Borrador pendiente de revisión)`;
      }

      validEvaluations.push({
        subjectId: subId,
        title,
        maxScore,
        date: date || new Date().toISOString().split('T')[0],
        type,
        isDraft,
      });
    } else {
      unclassified.push({
        title,
        content: `Evaluación sin materia válida asignada por la IA`,
      });
    }
  });

  return {
    ok: true,
    validModules,
    validEvaluations,
    unclassified,
    summary: {
      matchedSubjects: Array.from(matchedSubjects),
      assignedModulesCount: validModules.length,
      assignedEvalsCount: validEvaluations.length,
      unclassifiedCount: unclassified.length,
    },
  };
}

function buildDistributedModuleWrite(item, context) {
  return {
    userId: context.userId,
    subjectId: context.canonicalSubjectId,
    assignedSubjectId: String(item.subjectId),
    classGroupId: context.classGroupId,
    scope: 'subject',
    title: normalizeName(item.title),
    description: String(item.description || '').trim(),
    ...(item.startDate ? { startDate: item.startDate } : {}),
    ...(item.endDate ? { endDate: item.endDate } : {}),
    order: typeof item.order === 'number' && item.order > 0 ? item.order : 1,
    planRunId: context.planRunId,
    createdAt: context.createdAt,
  };
}

function filterModulesForMateria(modules, subjectId, scope = 'subject') {
  if (scope === 'general') return [...(modules || [])];
  return (modules || []).filter((module) =>
    !module.assignedSubjectId || String(module.assignedSubjectId) === String(subjectId)
  );
}

function distributionDocId(kind, planRunId, subjectId, title, discriminator = '') {
  const input = [kind, planRunId, subjectId, nameKey(title), String(discriminator)].join('|');
  const hash = (value, seed) => {
    let h = seed >>> 0;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  const prefix = kind === 'module' ? 'ai_mod' : 'ai_eval';
  return `${prefix}_${hash(input, 2166136261)}${hash(input, 2246822519)}`;
}

function buildPlanRunId(groupId, version) {
  const safeGroupId = String(groupId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const safeVersion = Number.isFinite(version) && version > 0 ? Math.floor(version) : 1;
  return `plan_${safeGroupId || 'aula'}_v${safeVersion}`;
}

/**
 * Prepara el objeto `originalPlan` para ser guardado con ámbito `classGroupId`.
 */
function buildOriginalPlanData(content, fileName, fileType, planType, previousVersion) {
  const normContent = String(content || '').trim();
  const v = typeof previousVersion === 'number' && previousVersion > 0 ? previousVersion + 1 : 1;
  return {
    content: normContent,
    fileName: normalizeName(fileName || 'Plan de Aula'),
    fileType: String(fileType || 'text/plain'),
    loadedAt: Date.now(),
    version: v,
    format: String(planType || 'semanal'),
    scope: 'classGroup',
  };
}

module.exports = {
  MODALIDADES,
  SUGERENCIAS_MATERIAS,
  MIN_MATERIAS_AULA,
  MAX_MATERIAS_AULA,
  MAX_PLAN_DRAFT_CHARS,
  normalizeName,
  computeAulaDisplayName,
  nameKey,
  toAulaPlanType,
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
  validateAIDistribution,
  buildDistributedModuleWrite,
  filterModulesForMateria,
  distributionDocId,
  buildPlanRunId,
  buildOriginalPlanData,
};
