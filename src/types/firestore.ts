// ── Firestore Document Types ──

export interface FirestoreDoc {
  id: string;
}

export type Periodo = 'matutino' | 'vespertino' | 'nocturno' | '';
export type AulaPlanType = 'semanal' | 'mensual' | 'trimestral' | 'cuatrimestral' | 'anual';

// Nivel educativo de una asignatura (campo opcional usado por los filtros del
// dashboard administrativo). Los valores son una whitelist compartida con el
// backend (functions/index.js → NIVELES_VALIDOS).
export type NivelEducativo = 'inicial' | 'primaria' | 'secundaria' | 'universidad';

export interface SubjectDoc extends FirestoreDoc {
  userId: string;
  name: string;
  color: string;
  teacher: string;
  schedule: string;
  periodo?: Periodo | null;
  nivelEducativo?: NivelEducativo | null;
  startDate?: string;
  endDate?: string;
  plan?: 'semanal' | 'mensual' | 'trimestral' | 'cuatrimestral' | 'anual_8' | 'anual_10' | 'otro';
  createdAt?: number;
  /**
   * Aula/Grupo multiasignatura: id del documento `classGroups/{id}` al que
   * pertenece esta materia. AUSENTE = asignatura independiente, que se
   * interpreta como un aula VIRTUAL de una sola materia (compatibilidad
   * total con datos antiguos; sin groupId nunca se migra ni reescribe).
   */
  groupId?: string;
}

/**
 * Aula/Grupo multiasignatura (`classGroups/{id}`).
 * Contenedor de varias materias que COMPARTEN una lista de participantes y
 * una asistencia diaria única. Solo se crea el documento para la modalidad
 * 'varias'; la modalidad 'una' NO genera documento (ruta legacy intacta:
 * toda asignatura sin grupo es un aula virtual de una materia).
 * Participantes/asistencia residen en la ASIGNATURA CANÓNICA del aula
 * (menor createdAt, luego id) — ver src/lib/classGroups.ts.
 */
export interface ClassGroupDoc extends FirestoreDoc {
  userId: string;
  name: string;
  modalidad: 'una' | 'varias';
  nivelEducativo?: NivelEducativo | '';
  grado?: string;
  seccion?: string;
  periodo?: Periodo | '';
  /** Versión de esquema del aula (1 = inicial). Para futuras migraciones. */
  schemaVersion?: number;
  planDraft?: string;
  planType?: AulaPlanType;
  planStatus?: 'idle' | 'draft_saved' | 'distributed';
  originalPlan?: {
    content: string;
    fileName?: string;
    fileType?: string;
    loadedAt: number;
    version: number;
    format?: string;
    periodo?: string;
    dates?: string;
    scope?: string;
  };
  lastPlanRunId?: string;
  unclassifiedItems?: Array<{ title: string; content?: string }>;
  createdAt: number;
  updatedAt: number;
}

export interface NoteDoc extends FirestoreDoc {
  userId: string;
  subjectId: string;
  moduleId?: string;
  title: string;
  content: string;
  date: string;
  startTime?: string;
  endTime?: string;
  attachment?: AttachmentDoc;
  /** Apunte original del que Magia IA derivó este registro. */
  sourceNoteId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AttachmentDoc {
  name: string;
  type: string;
  data: string | null;
}

export interface StudentDoc extends FirestoreDoc {
  userId: string;
  subjectId: string;
  cedula: string;
  firstName: string;
  lastName: string;
  gender?: 'M' | 'F';
}

export interface EvaluationDoc extends FirestoreDoc {
  userId: string;
  subjectId: string;
  moduleId?: string;
  title: string;
  maxScore: number;
  date: string;
  type: 'teorica' | 'practica' | 'apreciativa';
  isDraft?: boolean;
  planRunId?: string;
  sourceNoteId?: string;
  createdAt?: number;
}

export interface GradeDoc extends FirestoreDoc {
  userId: string;
  subjectId: string;
  evaluationId: string;
  studentId: string;
  score: number;
}

export interface AttendanceDoc extends FirestoreDoc {
  userId: string;
  subjectId: string;
  moduleId?: string;
  studentId: string;
  date: string;
  status: 'present' | 'absent' | 'late';
}

export interface CalendarEventDoc extends FirestoreDoc {
  userId: string;
  subjectId: string;
  moduleId?: string;
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  type: 'class' | 'exam' | 'deadline' | 'other';
  topic?: string;
  description?: string;
  order?: number;
  sourceNoteId?: string;
}

export interface MaterialDoc extends FirestoreDoc {
  userId: string;
  subjectId: string;
  moduleId?: string;
  title: string;
  type: 'book' | 'link' | 'video' | 'document' | 'other';
  description?: string;
  observations?: string;
  date: string;
  startTime?: string;
  endTime?: string;
  attachment?: AttachmentDoc;
}

export interface SubjectModuleDoc extends FirestoreDoc {
  userId: string;
  /** Materia canónica que conserva la estructura compartida del aula. */
  subjectId: string;
  /** Materia real del contenido distribuido; ausente = estructura global. */
  assignedSubjectId?: string | null;
  classGroupId?: string;
  scope?: 'classGroup' | 'subject';
  planRunId?: string;
  sourceNoteId?: string;
  parentId?: string;
  title: string;
  description?: string;
  order: number;
  createdAt: number;
  startDate?: string;
  endDate?: string;
}

export interface UserProfileDoc extends FirestoreDoc {
  plan: 'free' | 'pro' | 'school';
  email: string;
  displayName?: string;
  photoURL?: string;
  createdAt: number;
  aiCallsThisMonth: number;
  aiCallsResetAt?: number;
}

// ── Tipos para boletín institucional (vista consolidada admin) ──
export interface Student {
  id: string;
  fullName: string;
  academicYear: string;
  documentId: string;
  grade: string;
  section: string;
  counselor: string;
}

export interface Grade {
  subjectId: string;
  subjectName: string;
  term1: string | number;
  term2: string | number;
  term3: string | number;
  finalGrade: number;
}

export interface HabitRecord {
  I: string;
  II: string;
  III: string;
}

export interface Attendance {
  A1: number;
  T1: number;
  A2: number;
  T2: number;
  A3: number;
  T3: number;
  habits: Record<string, HabitRecord>;
}

export interface SchoolConfig {
  schoolName: string;
  logoUrl: string;
}

// ── Configuración institucional (Módulo 5: nombre, logo y color primario) ──
// Espejo del documento institutions/{id} que leen TODOS los miembros de la
// institución (docentes y admin) vía reglas (read si eres miembro, ver
// firestore.rules). La personalización se escribe SOLO desde las Cloud
// Functions adminSaveSchoolConfig (name en la raíz; logoUrl/primaryColor
// dentro de schoolConfig) — nunca desde el cliente (reglas deny).
export interface InstitutionDoc extends FirestoreDoc {
  name?: string;
  schoolConfig?: {
    logoUrl?: string;
    primaryColor?: string;
    slogan?: string;
    directorName?: string;
    address?: string;
    phone?: string;
    email?: string;
    onboardingDone?: boolean;
  };
  gradingWeight?: GradingWeight;
  periodos?: InstitutionPeriodos;
  planRules?: PlanRules;
}

// ── Periodos de clase y reglas del plan (Módulo 1 del plan admin) ──
// Turnos operativos de la institución y la regla de planificación
// institucional. Se guardan en institutions/{id} y el cliente admin NO puede
// escribirlos (reglas deny): todo pasa por las Cloud Functions
// `adminSavePeriodos` y `adminSavePlanRules`. La lectura llega en
// `adminGetSchoolConfig` y, para TODOS los miembros, vía `useInstitution`
// (onSnapshot directo del documento, permitido por reglas).
export type ReglaPlan = 'semanal' | 'mensual' | 'trimestral' | 'cuatrimestral' | 'anual';

export type PeriodoKey = 'matutino' | 'vespertino' | 'nocturno';

export interface PeriodoHorario {
  activo: boolean;
  horarioInicio: string;
  horarioFin: string;
}

export interface InstitutionPeriodos {
  matutino: PeriodoHorario;
  vespertino: PeriodoHorario;
  nocturno: PeriodoHorario;
}

export interface PlanRules {
  reglaSeleccionada: ReglaPlan;
  recomendarADocentes: boolean;
}

// ── Búsqueda de estudiantes con detección de discrepancias (Módulo 2) ──
// Resultado de la Cloud Function `searchStudent`: lista PLANA de filas
// (estudiante × asignatura) en toda la institución, con los campos del
// boletín consolidado. `estado` marca 'inactivo' las filas de personas con
// discrepancias detectadas (asignadas a varios periodos, misma asignatura en
// varios periodos o matrícula duplicada); `discrepancias` detalla los motivos.
export type StudentEstado = 'activo' | 'inactivo';

export interface StudentSearchRow {
  studentId: string;
  nombreCompleto: string;
  cedula: string;
  asignatura: string;
  docente: string;
  // No existe campo "grado" en el esquema: se mapea al nivel educativo de la
  // asignatura (subjects.nivelEducativo: inicial|primaria|secundaria|universidad).
  grado: string;
  periodo: string;
  estado: StudentEstado;
  discrepancias: string[];
  subjectId: string;
  teacherUid: string;
}

export interface SearchStudentResponse {
  query: string;
  total: number;
  limit: number;
  students: StudentSearchRow[];
}

// ── Ponderación global de calificaciones (Módulo 4 del plan admin) ──
// Modo de cálculo de la nota final configurado por el administrador en el
// documento institutions/{id}. POLÍTICA INSTITUCIONAL: es la fuente
// autoritativa y única; los docentes la consultan (solo lectura) y NO pueden
// modificarla. El cliente admin NO puede escribirlo (reglas deny): todo pasa
// por la Cloud Function `adminSaveGradingWeight`. La lectura se expone en
// `adminGetSchoolConfig` (gradingWeight) y para todos los miembros vía
// useInstitution. Compatibilidad hacia atrás: si el campo no existe, el
// backend devuelve el default tradicional.
export type GradingMode = 'tradicional' | 'competencias' | 'personalizada';
// LEGADO (sin efecto desde la política institucional): la institucional aplica
// SIEMPRE a los miembros; el campo se conserva en el esquema por compatibilidad.
export type GradingApplyTo = 'global' | 'override';

export interface GradingWeight {
  mode: GradingMode;
  // tradicional/competencias: los tres tipos de evaluación que ya usa el
  // sistema (evaluations.type). 'competencias' reinterpreta las etiquetas
  // como Saber/Hacer/Ser sobre los mismos tres campos.
  weights?: { teoria: number; practica: number; apreciativa: number };
  // personalizada: porcentajes por categoría definidos por el admin
  // (sliders dinámicos). Las claves son nombres legibles de categoría.
  customWeights?: Record<string, number>;
  applyTo: GradingApplyTo;
  updatedAt?: number;
  // Auditoría ligera del último cambio (aditivo): quién guardó (uid interno,
  // la UI muestra "Administrador") y snapshot del valor previo. Sin historial.
  updatedBy?: string;
  previousWeight?: Omit<GradingWeight, 'updatedBy' | 'previousWeight'> | null;
}
