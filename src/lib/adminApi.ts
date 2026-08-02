/**
 * adminApi.ts — Cliente para las Cloud Functions de administrador institucional.
 *
 * Estas funciones están protegidas en el backend: solo usuarios con
 * `role === 'admin'` pueden invocarlas. Devuelven resúmenes y datos de los
 * docentes de la MISMA institución del admin (verificación en el servidor).
 */

import { getFunctions, httpsCallable } from 'firebase/functions';

export interface TeacherCounts {
  subjects: number;
  students: number;
  evaluations: number;
  grades: number;
  attendance: number;
}

export interface TeacherSummary {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  plan: 'free' | 'pro' | 'school';
  createdAt: number | null;
  lastActivity: number | null;
  counts: TeacherCounts;
}

export interface AdminTeacherListResponse {
  institutionId: string;
  teachers: TeacherSummary[];
}

export interface TeacherSubjectData {
  id: string;
  name: string;
  color?: string;
  teacher?: string;
  schedule?: string;
  plan?: string;
  createdAt?: number;
  students: any[];
  subjectModules: any[];
  evaluations: any[];
  grades: any[];
  attendance: any[];
  notes: any[];
  materials: any[];
  calendarEvents: any[];
}

export interface AdminTeacherDataResponse {
  teacher: {
    uid: string;
    email: string;
    displayName: string;
    institutionId: string;
    institutionName: string;
  };
  settings: Record<string, unknown>;
  subjects: TeacherSubjectData[];
}

export interface SummaryNote {
  id: string;
  title: string;
  date: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface SummaryMaterial {
  id: string;
  title: string;
  type: string;
  date: string;
  startTime?: string;
  endTime?: string;
  moduleId?: string;
  description?: string;
}

export interface TeacherSubjectSummary {
  id: string;
  name: string;
  color?: string;
  teacher?: string;
  schedule?: string;
  plan?: string;
  createdAt?: number;
  students: any[];
  subjectModules: any[];
  evaluations: any[];
  grades: any[];
  attendance: any[];
  notes: SummaryNote[];
  noteCount: number;
  materials: SummaryMaterial[];
  calendarEvents: any[];
}

export interface AdminTeacherSummaryResponse {
  teacher: {
    uid: string;
    email: string;
    displayName: string;
    institutionId: string;
    institutionName: string;
  };
  settings: Record<string, unknown>;
  subjects: TeacherSubjectSummary[];
}

const callable = <Req, Res>(name: string) => {
  const fn = httpsCallable<Req, Res>(getFunctions(), name);
  return fn;
};

export async function adminListTeachers(): Promise<AdminTeacherListResponse> {
  const fn = callable<{ teacherUid?: never }, AdminTeacherListResponse>('adminListTeachers');
  const res = await fn();
  return res.data;
}

export async function adminGetTeacherData(teacherUid: string): Promise<AdminTeacherDataResponse> {
  const fn = callable<{ teacherUid: string }, AdminTeacherDataResponse>('adminGetTeacherData');
  const res = await fn({ teacherUid });
  return res.data;
}

export async function adminGetTeacherSummary(teacherUid: string): Promise<AdminTeacherSummaryResponse> {
  const fn = callable<{ teacherUid: string }, AdminTeacherSummaryResponse>('adminGetTeacherSummary');
  const res = await fn({ teacherUid });
  return res.data;
}
