import Dexie, { type EntityTable } from "dexie";

export type SubjectPlan =
  | "semanal"
  | "mensual"
  | "trimestral"
  | "cuatrimestral"
  | "anual_8"
  | "anual_10"
  | "otro";

export interface Subject {
  id?: number;
  name: string;
  color: string;
  teacher: string;
  schedule: string;
  periodo?: string | null;
  nivelEducativo?: string | null;
  startDate?: string;
  endDate?: string;
  plan?: SubjectPlan;
  createdAt?: number;
  /** Aula/Grupo multiasignatura (id Firestore `classGroups/{id}`). Ausente = independiente. */
  groupId?: string;
}

/**
 * Espejo Dexie (caché offline) de la colección Firestore `classGroups`.
 * La fuente de verdad es Firestore; este espejo alimenta lecturas locales.
 * `firestoreId` es el id del documento remoto (el `id` local es de Dexie).
 */
export interface ClassGroup {
  id?: number;
  firestoreId: string;
  userId: string;
  name: string;
  modalidad: 'una' | 'varias';
  nivelEducativo?: string;
  grado?: string;
  seccion?: string;
  periodo?: string;
  planType?: 'semanal' | 'mensual' | 'trimestral' | 'cuatrimestral' | 'anual';
  schemaVersion?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Attachment {
  name: string;
  type: string;
  data: string;
}

export interface Note {
  id?: number;
  subjectId: number;
  moduleId?: number;
  title: string;
  content: string;
  date: string;
  startTime?: string;
  endTime?: string;
  attachment?: Attachment;
  createdAt: number;
  updatedAt: number;
}

export interface Student {
  id?: number;
  subjectId: number;
  cedula: string;
  firstName: string;
  lastName: string;
  gender?: "M" | "F";
}

export interface Evaluation {
  id?: number;
  subjectId: number;
  moduleId?: number;
  title: string;
  maxScore: number;
  date: string;
  type: "teorica" | "practica" | "apreciativa";
}

export interface Grade {
  id?: number;
  subjectId: number;
  evaluationId: number;
  studentId: number;
  score: number;
}

export interface Attendance {
  id?: number;
  subjectId: number;
  moduleId?: number;
  studentId: number;
  date: string;
  status: "present" | "absent" | "late";
}

export interface CalendarEvent {
  id?: number;
  subjectId: number;
  moduleId?: number;
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  type: "class" | "exam" | "deadline" | "other";
}

export interface Material {
  id?: number;
  subjectId: number;
  moduleId?: number;
  title: string;
  type: "book" | "link" | "video" | "document" | "other";
  description?: string;
  observations?: string;
  date: string;
  startTime?: string;
  endTime?: string;
  attachment?: Attachment;
}

export interface SubjectModule {
  id?: number;
  subjectId: number;
  parentId?: number;
  title: string;
  description?: string;
  order: number;
  createdAt: number;
  startDate?: string;
  endDate?: string;
}

export interface ExtractedEvent {
  id?: number;
  title: string;
  description?: string;
  startDate: Date; // fecha + hora
  endDate?: Date;
  type: "event" | "quiz" | "homework" | "resource";
  courseId: number; // asignatura / curso
  color: string; // se asignará según el curso
  sourceDocId?: number; // referencia al documento del que proviene
  resources?: string;
  durationMinutes?: number;
}

export interface UploadedDocument {
  id?: number;
  name: string;
  fileType: string; // 'xlsx', 'pdf', 'docx'
  rawText: string; // texto extraído (para IA)
  processedAt: Date;
}

/**
 * Observación del boletín (offline-first). Espejo de la colección Firestore
 * `observations` (escritura solo del autor; lectura de la institución).
 * `subjectId === ''` = observación GENERAL del docente consejero; con valor =
 * observación del docente para ESA asignatura.
 */
export interface Observation {
  id?: number;
  /** Docente autor (users/{uid}). */
  userId: string;
  /** Id del documento student al que pertenece. */
  studentId: string;
  /** Id de la asignatura; '' = general (docente consejero). */
  subjectId: string;
  /** Clave del periodo activo ('I'|'II'|'III', 'C1'|'C2', 'anual', ...). */
  period: string;
  text: string;
  updatedAt: number;
}

const db = new Dexie("ClassNotebookDB") as Dexie & {
  subjects: EntityTable<Subject, "id">;
  notes: EntityTable<Note, "id">;
  students: EntityTable<Student, "id">;
  evaluations: EntityTable<Evaluation, "id">;
  grades: EntityTable<Grade, "id">;
  attendance: EntityTable<Attendance, "id">;
  calendarEvents: EntityTable<CalendarEvent, "id">;
  materials: EntityTable<Material, "id">;
  subjectModules: EntityTable<SubjectModule, "id">;
  extractedEvents: EntityTable<ExtractedEvent, "id">;
  uploadedDocs: EntityTable<UploadedDocument, "id">;
  observations: EntityTable<Observation, "id">;
  classGroups: EntityTable<ClassGroup, "id">;
};

// Schema declaration
db.version(13).stores({
  subjects: "++id, name",
  notes: "++id, subjectId, moduleId, date, createdAt",
  students: "++id, subjectId, cedula",
  evaluations: "++id, subjectId, moduleId, date, type",
  grades: "++id, subjectId, evaluationId, studentId",
  attendance: "++id, subjectId, moduleId, studentId, date",
  calendarEvents: "++id, subjectId, moduleId, date",
  materials: "++id, subjectId, moduleId, date",
  subjectModules: "++id, subjectId, order",
  extractedEvents: "++id, courseId, title, sourceDocId, startDate",
  uploadedDocs: "++id, name",
});
// v14: observaciones del boletín (offline-first, espejo de la colección
// Firestore `observations`).
db.version(14).stores({
  observations: "++id, userId, studentId, subjectId, period",
});
// v15: Aula/Grupo multiasignatura (espejo local de `classGroups`). Migración
// ADITIVA e idempotente: solo añade una tabla nueva; NO toca subjects ni
// ningún dato existente (subjects.groupId es opcional y no requiere índice:
// las materias de un aula se resuelven en memoria sobre ≤500 docs).
db.version(15).stores({
  classGroups: "++id, firestoreId, userId",
});

export { db };
