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
import type { ClassGroupDoc, NivelEducativo, Periodo, SubjectDoc } from '../types/firestore';
import { useAuth } from '../components/AuthProvider';
import { addSubjectCounterOp } from './subjectCounter';
import { handleFirestoreError, OperationType } from './firestoreUtils';

// ── Constantes compartidas con el núcleo puro ──────────────────────────────

export const MIN_MATERIAS_AULA = 2;
export const MAX_MATERIAS_AULA = 20;

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
  validModules: Array<{ subjectId: string; title: string; description?: string; order?: number }>;
  validEvaluations: Array<{ subjectId: string; title: string; maxScore: number; date: string; type: 'teorica' | 'practica' | 'apreciativa'; isDraft?: boolean }>;
  unclassified: Array<{ title: string; content?: string }>;
  summary: {
    matchedSubjects: string[];
    assignedModulesCount: number;
    assignedEvalsCount: number;
    unclassifiedCount: number;
  };
}

export function validateAIDistribution(
  rawModules: any[],
  rawEvaluations: any[],
  rawUnclassified: any[],
  validSubjects: Array<{ id: string; name: string }>
): ValidatedAIDistribution {
  const validMap = new Map<string, string>();
  (Array.isArray(validSubjects) ? validSubjects : []).forEach((s) => {
    if (s && s.id) validMap.set(String(s.id), String(s.name || s.id));
  });

  const validModules: Array<{ subjectId: string; title: string; description?: string; order?: number }> = [];
  const validEvaluations: Array<{ subjectId: string; title: string; maxScore: number; date: string; type: 'teorica' | 'practica' | 'apreciativa'; isDraft?: boolean }> = [];
  const unclassified = Array.isArray(rawUnclassified) ? [...rawUnclassified] : [];
  const matchedSubjects = new Set<string>();

  (Array.isArray(rawModules) ? rawModules : []).forEach((m, idx) => {
    if (!m || typeof m !== 'object') return;
    const subId = m.subjectId ? String(m.subjectId) : '';
    const title = normalizeName(m.title || '');
    if (subId && validMap.has(subId) && title) {
      matchedSubjects.add(validMap.get(subId)!);
      validModules.push({
        subjectId: subId,
        title,
        description: String(m.description || '').trim(),
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
    const subId = e.subjectId ? String(e.subjectId) : '';
    let title = normalizeName(e.title || '');
    if (!title) return;

    if (subId && validMap.has(subId)) {
      matchedSubjects.add(validMap.get(subId)!);
      const maxScore = typeof e.maxScore === 'number' && e.maxScore > 0 ? e.maxScore : Number(e.maxScore) || 100;
      const date = typeof e.date === 'string' && e.date.trim() ? e.date.trim() : '';
      const rawType = e.type;
      const type: 'teorica' | 'practica' | 'apreciativa' = ['teorica', 'practica', 'apreciativa'].includes(rawType) ? rawType : 'teorica';
      const isDraft = !date || maxScore <= 0;

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
