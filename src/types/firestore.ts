// ── Firestore Document Types ──

export interface FirestoreDoc {
  id: string;
}

export interface SubjectDoc extends FirestoreDoc {
  userId: string;
  name: string;
  color: string;
  teacher: string;
  schedule: string;
  startDate?: string;
  endDate?: string;
  plan?: 'semanal' | 'mensual' | 'trimestral' | 'cuatrimestral' | 'anual_8' | 'anual_10' | 'otro';
  createdAt?: number;
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
  attachment?: AttachmentDoc;
}

export interface SubjectModuleDoc extends FirestoreDoc {
  userId: string;
  subjectId: string;
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
