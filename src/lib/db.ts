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
  startDate?: string;
  endDate?: string;
  plan?: SubjectPlan;
  createdAt?: number;
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

export { db };
