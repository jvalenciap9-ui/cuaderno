/**
 * classGroups.ts — Aula/Grupo multiasignatura (cliente).
 *
 * Espejo TIPEADO de functions/lib/class-groups.js (lógica pura probada en
 * scripts/test-class-groups.mjs — mantener ambos en sincronía) + operaciones
 * Firestore y hook de resolución canónica.
 *
 * Modelo de extensión (decisión documentada):
 * - Colección `classGroups/{id}`: aula real SOLO para modalidad 'varias'.
 * - `subjects.groupId` opcional vincula la materia al aula.
 * - Participantes (students) y asistencia (attendance) viven UNA sola vez
 *   bajo la ASIGNATURA CANÓNICA del aula (menor createdAt, luego id).
 *   StudentsTab/AttendanceTab resuelven el canonical antes de leer/escribir.
 * - Evaluaciones/calificaciones/notas/módulos/materiales siguen POR MATERIA.
 * - Asignatura sin groupId (o grupo huérfano) = aula virtual de una materia:
 *   comportamiento legacy intacto, sin migración destructiva.
 *
 * Offline-first: la creación usa un ÚNICO writeBatch (grupo + N materias +
 * contador +1). El SDK de Firestore aplica las mutaciones en caché local
 * inmediatamente y las sincroniza al reconectar; reintentos no duplican
 * porque cada documento se crea con su propia referencia dentro del batch
 * original (idempotencia del lado del cliente: nunca relanzar el batch tras
 * un commit resuelto; los fallos transitorios los reintenta el SDK solo).
 */

import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db as firestore } from './firebase';
import { db as dexieDb, type Subject as DexieSubject } from './db';
import type { AulaPlanType, ClassGroupDoc, NivelEducativo, Periodo, SubjectDoc } from '../types/firestore';
import { useAuth } from '../components/AuthProvider';
import { addSubjectCounterOp } from './subjectCounter';
import { handleFirestoreError, OperationType } from './firestoreUtils';

// ── Constantes compartidas con el núcleo puro ──────────────────────────────

export const MIN_MATERIAS_AULA = 2;
export const MAX_MATERIAS_AULA = 20;
/** Margen seguro bajo el límite de 1 MiB por documento de Firestore. */
export const MAX_PLAN_DRAFT_CHARS = 500_000;

export const SUGERENCIAS_MATERIAS: Record<'inicial' | 'primaria', string[]> = {
  inicial: [
    'Español', 'Matemáticas', 'Ciencias Naturales', 'Ciencias Sociales',
    'Inglés', 'Educación Física', 'Arte', 'Informática',
  ],
  primaria: [
    'Español', 'Matemáticas', 'Ciencias Naturales', 'Ciencias Sociales',
    'Inglés', 'Educación Física', 'Arte', 'Informática',
  ],
};

export function normalizeName(s: string): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ');
}

export function computeAulaDisplayName(grado: string, seccion: string, customName?: string): string {
  const custom = normalizeName(customName || '');
  let g = normalizeName(grado);
  let s = normalizeName(seccion);

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

export function nameKey(s: string): string {
  const n = normalizeName(s).toLowerCase();
  return n.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Convierte los formatos legacy de asignatura al formato global del aula. */
export function toAulaPlanType(plan?: SubjectDoc['plan'] | AulaPlanType | string | null): AulaPlanType {
  if (plan === 'mensual' || plan === 'trimestral' || plan === 'cuatrimestral') return plan;
  if (plan === 'anual' || plan === 'anual_8' || plan === 'anual_10') return 'anual';
  return 'semanal';
}

export interface MateriaNamesResult {
  ok: boolean;
  error?: string;
  names?: string[];
}

export function validateMateriaNames(rawNames: string[]): MateriaNamesResult {
  if (!Array.isArray(rawNames)) return { ok: false, error: 'La lista de materias no es válida.' };
  const names = rawNames.map(normalizeName);
  const seen = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    if (!n) return { ok: false, error: `La materia #${i + 1} no puede quedar vacía.` };
    const key = nameKey(n);
    if (seen.has(key)) return { ok: false, error: `La materia "${n}" está duplicada dentro del aula.` };
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

// ── Resolución canónica (espejo del núcleo puro) ───────────────────────────

function siblingSortKey(s: Pick<SubjectDoc, 'id' | 'createdAt'>): string {
  const created = typeof s.createdAt === 'number' ? s.createdAt : Number.MAX_SAFE_INTEGER;
  return `${String(created).padStart(15, '0')}:${String(s.id ?? '')}`;
}

export function siblingsOf(subjects: SubjectDoc[], groupId: string | null | undefined): SubjectDoc[] {
  if (!groupId) return [];
  return subjects
    .filter((s) => s && s.groupId === groupId)
    .slice()
    .sort((a, b) => (siblingSortKey(a) < siblingSortKey(b) ? -1 : 1));
}

export function resolveCanonicalSubject(subjects: SubjectDoc[], subjectId: string): SubjectDoc | null {
  const self = subjects.find((s) => s && String(s.id) === String(subjectId));
  if (!self) return null;
  if (!self.groupId) return self;
  const sibs = siblingsOf(subjects, self.groupId);
  if (sibs.length === 0) return self; // grupo huérfano → legacy
  return sibs[0];
}

export function resolveCanonicalSubjectId(subjects: SubjectDoc[], subjectId: string): string | null {
  const canon = resolveCanonicalSubject(subjects, subjectId);
  return canon ? String(canon.id) : null;
}

/** Grupo real (no virtual) al que pertenece una materia, si existe. */
export function groupOf(groups: ClassGroupDoc[], groupId: string | null | undefined): ClassGroupDoc | null {
  if (!groupId) return null;
  return groups.find((g) => g.id === groupId) ?? null;
}

/**
 * Hook: resuelve el subjectId canónico (participantes/asistencia) para una
 * asignatura, consultando subjects del usuario. Para asignaturas
 * independientes devuelve el mismo id (cero cambios de comportamiento).
 */
export function useCanonicalSubjectId(subjectId: string): { canonicalId: string; isSharedAula: boolean } {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState<SubjectDoc[]>([]);

  useEffect(() => {
    if (!user?.uid || IS_DEMO_MODE_SKIP()) {
      setSubjects([]);
      return;
    }
    const q = query(collection(firestore, 'subjects'), where('userId', '==', user.uid), limit(500));
    // onSnapshot directo: funciona offline leyendo la caché persistente.
    const unsub = onSnapshot(
      q,
      (snap) => setSubjects(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SubjectDoc)),
      () => setSubjects([]),
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const canon = resolveCanonicalSubject(subjects, subjectId);
  const canonicalId = canon ? String(canon.id) : subjectId;
  return { canonicalId, isSharedAula: canonicalId !== String(subjectId) };
}

// Evita importar demoAdminData (lazy) solo por una constante: el modo demo no
// consulta Firestore real desde las vistas de docente (subjectsQuery es null),
// así que basta un guard barato sobre la env var.
function IS_DEMO_MODE_SKIP(): boolean {
  try {
    return import.meta.env.VITE_DEMO_MODE === 'true';
  } catch {
    return false;
  }
}

// ── Unidades de plan (límites) ─────────────────────────────────────────────

const PLAN_UNIT_LIMITS: Record<string, number> = { free: 2, pro: 999, school: 999 };

export interface PlanUnits {
  standaloneSubjects: number;
  groups: number;
  internalMaterias: number;
  units: number;
}

export function planUnits(subjects: SubjectDoc[], groups: ClassGroupDoc[]): PlanUnits {
  const known = new Set((groups ?? []).map((g) => String(g.id)).filter(Boolean));
  let standalone = 0;
  let internal = 0;
  for (const s of subjects ?? []) {
    if (!s) continue;
    if (s.groupId && known.has(String(s.groupId))) internal++;
    else standalone++;
  }
  const groupCount = known.size;
  return { standaloneSubjects: standalone, groups: groupCount, internalMaterias: internal, units: standalone + groupCount };
}

export interface PlanDecision { allowed: boolean; reason?: string }

export function canCreateClassGroup(plan: string, subjects: SubjectDoc[], groups: ClassGroupDoc[]): PlanDecision {
  if (plan === 'free') {
    return {
      allowed: false,
      reason: 'Aula Multiasignatura es una función exclusiva de Premium Pro. Actualiza tu plan para organizarte por aulas.',
    };
  }
  const max = PLAN_UNIT_LIMITS[plan] ?? 2;
  const u = planUnits(subjects, groups);
  if (u.units + 1 > max) {
    return { allowed: false, reason: `Has alcanzado tu límite de ${max} (asignaturas y/o aulas). Mejora tu plan para ampliarlo.` };
  }
  return { allowed: true };
}

export function canCreateStandaloneSubject(plan: string, subjects: SubjectDoc[], groups: ClassGroupDoc[]): PlanDecision {
  const max = PLAN_UNIT_LIMITS[plan] ?? 2;
  const u = planUnits(subjects, groups);
  if (u.units + 1 > max) {
    return { allowed: false, reason: `Has alcanzado tu límite de ${max} (asignaturas y/o aulas). Mejora tu plan para ampliarlo.` };
  }
  return { allowed: true };
}

// ─── Paleta de colores oficial de EdiAgil para ciclar entre materias ───────
export const MATERIA_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
  '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
];

export interface CreateClassGroupInput {
  name: string;
  nivelEducativo?: NivelEducativo | '';
  grado?: string;
  seccion?: string;
  periodo?: Periodo | '';
  planAcademico?: SubjectDoc['plan'];
  teacher?: string;
  schedule?: string;
  materias: string[];
}

/**
 * Creación ATÓMICA del aula + sus materias + contador (+1 unidad):
 * un único writeBatch en Firestore. Si falla una pieza, NO queda aula
 * parcial (atomicidad server-side). Offline: las mutaciones quedan en la
 * caché local y se sincronizan solas al reconectar.
 */
export async function createClassGroupWithMaterias(
  uid: string,
  input: CreateClassGroupInput,
): Promise<{ groupId: string; firstMateriaId: string }> {
  const validation = validateMateriaNames(input.materias);
  if (!validation.ok || !validation.names) {
    throw new Error(validation.error || 'Materias inválidas.');
  }

  const groupRef = doc(collection(firestore, 'classGroups'));
  const batch = writeBatch(firestore);

  batch.set(groupRef, {
    userId: uid,
    name: normalizeName(input.name),
    nivelEducativo: input.nivelEducativo || '',
    grado: normalizeName(input.grado || ''),
    seccion: normalizeName(input.seccion || ''),
    periodo: input.periodo || '',
    planType: toAulaPlanType(input.planAcademico),
    modalidad: 'varias',
    schemaVersion: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const now = Date.now();
  let firstMateriaId = '';
  validation.names.forEach((nombre, idx) => {
    const ref = doc(collection(firestore, 'subjects'));
    if (idx === 0) firstMateriaId = ref.id;
    const materia: Record<string, unknown> = {
      userId: uid,
      groupId: groupRef.id,
      name: nombre,
      color: MATERIA_COLORS[idx % MATERIA_COLORS.length],
      teacher: normalizeName(input.teacher || ''),
      schedule: normalizeName(input.schedule || ''),
      periodo: input.periodo || null,
      nivelEducativo: input.nivelEducativo || null,
      startDate: '',
      endDate: '',
      plan: input.planAcademico || 'otro',
      createdAt: now + idx, // orden estable intra-aula (canonical = idx 0)
    };
    batch.set(ref, materia);
  });

  // El aula consume UNA unidad del plan, sin importar cuántas materias tenga.
  await addSubjectCounterOp(batch, uid, +1);
  await batch.commit();

  // Espejo Dexie best-effort (lecturas offline de libs que usan la caché local).
  try {
    await dexieDb.classGroups.add({
      firestoreId: groupRef.id,
      userId: uid,
      name: normalizeName(input.name),
      nivelEducativo: input.nivelEducativo || '',
      grado: normalizeName(input.grado || ''),
      seccion: normalizeName(input.seccion || ''),
      periodo: input.periodo || '',
      planType: toAulaPlanType(input.planAcademico),
      modalidad: 'varias',
      schemaVersion: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  } catch {
    // La fuente de verdad es Firestore; el espejo local es prescindible.
  }

  return { groupId: groupRef.id, firstMateriaId };
}

export interface SubjectDeletionPlan {
  found: boolean;
  isGrouped?: boolean;
  lastMember?: boolean;
  deleteGroup?: boolean;
  /** Si la borrada era la canónica: mover students/attendance a este id. */
  reassignTo?: string | null;
  counterDelta: number;
}

/**
 * Plan de eliminación de una asignatura (espejo del núcleo puro).
 * El CLIENTE ejecuta: borrar materia; si reassignTo → actualizar
 * students/attendance al nuevo canonical; si deleteGroup → borrar doc del
 * aula + counter -1; si independiente → counter -1.
 */
export function planSubjectDeletion(subjects: SubjectDoc[], groups: ClassGroupDoc[], subjectId: string): SubjectDeletionPlan {
  const self = subjects.find((s) => s && String(s.id) === String(subjectId));
  if (!self) return { found: false, counterDelta: 0 };
  if (!self.groupId) return { found: true, isGrouped: false, deleteGroup: false, reassignTo: null, counterDelta: -1 };
  const known = (groups ?? []).some((g) => g.id === self.groupId);
  if (!known) return { found: true, isGrouped: false, deleteGroup: false, reassignTo: null, counterDelta: -1 };
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

/** Lectura puntual de grupos del usuario (para flujos no-reactivos). */
export async function fetchClassGroups(uid: string): Promise<ClassGroupDoc[]> {
  const snap = await getDocs(query(collection(firestore, 'classGroups'), where('userId', '==', uid), limit(200)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ClassGroupDoc);
}

/** Clave de localStorage para recordar la última materia usada POR AULA. */
export function lastMateriaStorageKey(groupId: string | null | undefined): string {
  const safe = String(groupId ?? '').replace(/[^a-zA-Z0-9_:-]/g, '');
  return `ediagil_aula_ultima_materia_${safe}`;
}

export interface ValidatedAIDistribution {
  ok: boolean;
  validModules: Array<{ subjectId: string; title: string; description?: string; startDate?: string; endDate?: string; order?: number }>;
  validEvaluations: Array<{ subjectId: string; title: string; maxScore: number; date: string; type: 'teorica' | 'practica' | 'apreciativa'; isDraft?: boolean }>;
  unclassified: Array<{ title: string; content?: string }>;
  summary: {
    matchedSubjects: string[];
    assignedModulesCount: number;
    assignedEvalsCount: number;
    unclassifiedCount: number;
  };
}

function semanticKey(value: unknown): string {
  return nameKey(String(value || '')).replace(/[^a-z0-9ñ]+/g, ' ').trim();
}

function uniqueSubjectMention(
  value: unknown,
  subjects: Array<{ id: string; key: string }>,
  exact = false,
): string | null {
  const text = semanticKey(value);
  if (!text) return null;
  const padded = ` ${text} `;
  const matches = subjects.filter((subject) => exact
    ? text === subject.key
    : padded.includes(` ${subject.key} `));
  return matches.length === 1 ? matches[0].id : null;
}

/**
 * Resuelve la materia por significado, no por el orden entregado por la IA.
 * Un subjectName/título explícito puede corregir un ID válido pero semánticamente
 * equivocado (p. ej. la IA devuelve el ID de Español para "Matemáticas").
 */
function resolveDistributedSubjectId(
  item: Record<string, any>,
  validMap: Map<string, string>,
  semanticSubjects: Array<{ id: string; key: string }>,
): string {
  const rawId = item.subjectId ? String(item.subjectId) : '';
  const explicit = item.subjectName ?? item.materia ?? item.subject;
  const explicitId = uniqueSubjectMention(explicit, semanticSubjects, true);
  if (explicitId) return explicitId;
  const titleId = uniqueSubjectMention(item.title, semanticSubjects);
  if (titleId) return titleId;
  if (rawId && validMap.has(rawId)) return rawId;
  return uniqueSubjectMention(item.description ?? item.content, semanticSubjects) || '';
}

const WEEKDAY_INDEX: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

function validIsoDate(value: unknown): string {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? '' : date;
}

function expectedWeekday(value: unknown): number | null {
  const key = semanticKey(value);
  for (const [name, index] of Object.entries(WEEKDAY_INDEX)) {
    if (` ${key} `.includes(` ${name} `)) return index;
  }
  return null;
}

function dateMatchesWeekday(date: string, weekday: unknown): boolean {
  const expected = expectedWeekday(weekday);
  if (!date || expected === null) return true;
  return new Date(`${date}T00:00:00Z`).getUTCDay() === expected;
}

export function validateAIDistribution(
  rawModules: any[],
  rawEvaluations: any[],
  rawUnclassified: any[],
  validSubjects: Array<{ id: string; name: string }>,
  defaultMaxScore = 100,
): ValidatedAIDistribution {
  const validMap = new Map<string, string>();
  (Array.isArray(validSubjects) ? validSubjects : []).forEach((s) => {
    if (s && s.id) validMap.set(String(s.id), String(s.name || s.id));
  });

  const semanticSubjects = Array.from(validMap.entries()).map(([id, name]) => ({
    id,
    key: semanticKey(name),
  })).filter((subject) => subject.key.length > 0);

  const validModules: Array<{ subjectId: string; title: string; description?: string; startDate?: string; endDate?: string; order?: number }> = [];
  const validEvaluations: Array<{ subjectId: string; title: string; maxScore: number; date: string; type: 'teorica' | 'practica' | 'apreciativa'; isDraft?: boolean }> = [];
  const unclassified = Array.isArray(rawUnclassified) ? [...rawUnclassified] : [];
  const matchedSubjects = new Set<string>();

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
      matchedSubjects.add(validMap.get(subId)!);
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
      matchedSubjects.add(validMap.get(subId)!);
      const configuredMaxScore = Number(defaultMaxScore) > 0 ? Number(defaultMaxScore) : 100;
      const rawMaxScore = Number(e.maxScore);
      const hasValidRawMaxScore = Number.isFinite(rawMaxScore) && rawMaxScore > 0;
      // Si la institución usa una escala distinta de 100 (por ejemplo 1–5
      // en Panamá), la evaluación generada debe respetar esa escala aunque
      // la IA intente devolver el valor genérico 100.
      const maxScore = configuredMaxScore !== 100
        ? configuredMaxScore
        : (hasValidRawMaxScore ? rawMaxScore : configuredMaxScore);
      const date = validIsoDate(e.date);
      const weekday = e.weekday || e.dayOfWeek || e.dia;
      const weekdayMismatch = !!date && !dateMatchesWeekday(date, weekday);
      const rawType = e.type;
      const type: 'teorica' | 'practica' | 'apreciativa' = ['teorica', 'practica', 'apreciativa'].includes(rawType) ? rawType : 'teorica';
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

export interface DistributedModuleWrite {
  userId: string;
  /** Propietario de la estructura global: materia canónica del aula. */
  subjectId: string;
  /** Materia real a la que la IA asignó el contenido. */
  assignedSubjectId: string;
  classGroupId: string;
  scope: 'subject';
  title: string;
  description: string;
  startDate?: string;
  endDate?: string;
  order: number;
  planRunId: string;
  createdAt: number;
}

/**
 * Construye la escritura final de un módulo distribuido por IA sin perder la
 * materia destino. Este contrato evita que todos los contenidos terminen en
 * la primera materia/canónica (habitualmente Español).
 */
export function buildDistributedModuleWrite(
  item: { subjectId: string; title: string; description?: string; startDate?: string; endDate?: string; order?: number },
  context: { userId: string; canonicalSubjectId: string; classGroupId: string; planRunId: string; createdAt: number },
): DistributedModuleWrite {
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

/**
 * En alcance General se muestran todos los módulos del aula. En alcance de
 * materia se muestran la estructura global y únicamente el contenido que la
 * IA asignó a la materia activa.
 */
export function filterModulesForMateria<T extends { assignedSubjectId?: string | null }>(
  modules: T[],
  subjectId: string,
  scope: 'general' | 'subject' = 'subject',
): T[] {
  if (scope === 'general') return [...(modules || [])];
  return (modules || []).filter((module) =>
    !module.assignedSubjectId || String(module.assignedSubjectId) === String(subjectId)
  );
}

/** Identificador estable para que reintentar el mismo plan no duplique datos. */
export function distributionDocId(
  kind: 'module' | 'evaluation',
  planRunId: string,
  subjectId: string,
  title: string,
  discriminator = '',
): string {
  const input = [kind, planRunId, subjectId, nameKey(title), String(discriminator)].join('|');
  const hash = (value: string, seed: number) => {
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

export function buildPlanRunId(groupId: string, version: number): string {
  const safeGroupId = String(groupId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const safeVersion = Number.isFinite(version) && version > 0 ? Math.floor(version) : 1;
  return `plan_${safeGroupId || 'aula'}_v${safeVersion}`;
}

export function buildOriginalPlanData(
  content: string,
  fileName?: string,
  fileType?: string,
  planType?: string,
  previousVersion?: number
) {
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

/** Reexport tipo Dexie para uso interno de jsonSyncUtils. */
export type { DexieSubject };
