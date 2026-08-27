/**
 * adminApi.ts — Cliente para las Cloud Functions de administrador institucional.
 *
 * Estas funciones están protegidas en el backend: solo usuarios con
 * `role === 'admin'` pueden invocarlas. Devuelven resúmenes y datos de los
 * docentes de la MISMA institución del admin (verificación en el servidor).
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import type { TurnoFiltro, NivelFiltro } from './dashboardFilters';
// Módulo 2: tipos del resultado de `searchStudent` (fuente única en firestore.ts).
import type { SearchStudentResponse } from '../types/firestore';
export type { StudentSearchRow, StudentEstado, SearchStudentResponse } from '../types/firestore';
// Modo Demo (VITE_DEMO_MODE=true): cuando está activo, TODAS estas funciones
// devuelven datos mock en memoria sin invocar Cloud Functions. Ver
// src/lib/demoAdminData.ts y .env.demo (npm run dev:demo).
import { IS_DEMO_MODE, getDemoAdminApi } from './demoAdminData';

let _demo: ReturnType<typeof getDemoAdminApi> | null = null;
const getDemo = () => (_demo ??= getDemoAdminApi());

/**
 * Filtros combinados opcionales del dashboard administrativo. Campos vacíos o
 * ausentes equivalen a "sin filtro" (el backend los ignora). Nunca se envían
 * a queries inseguras: el backend los sanitiza con whitelist.
 */
export interface AdminFilterParams {
  turno?: TurnoFiltro;
  nivelEducativo?: NivelFiltro;
}

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
  periodos?: { matutino: number; vespertino: number; nocturno: number };
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
  periodo?: string | null;
  nivelEducativo?: string | null;
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
  schoolConfig: SchoolConfig;
  settings: Record<string, unknown>;
  subjects: TeacherSubjectData[];
}

// ─── Fase 5: Configuración post-login de la institución ──────────────────
export interface SchoolConfig {
  logoUrl: string;
  slogan: string;
  directorName: string;
  address: string;
  phone: string;
  email: string;
  // Módulo 5: color primario de la institución (hex #RRGGBB). Es un accent
  // configurable sobre la base EdiAgil; se propaga a toda la app vía
  // useInstitution (CSS var --institution-primary).
  primaryColor: string;
  onboardingDone: boolean;
}

export const EMPTY_SCHOOL_CONFIG: SchoolConfig = {
  logoUrl: '',
  slogan: '',
  directorName: '',
  address: '',
  phone: '',
  email: '',
  primaryColor: '',
  onboardingDone: false,
};

// ─── Módulo 4: Ponderación global de calificaciones ───────────────────────
// POLÍTICA INSTITUCIONAL: el admin decide cómo se calcula la nota final de
// TODA la institución y es la ÚNICA fuente autoritativa
// (institutions/{id}.gradingWeight); los docentes la consultan en solo
// lectura y NO pueden modificarla (ver gradingUtils.getEffectiveGradingWeight).
// La escritura es SOLO vía Cloud Function (adminSaveGradingWeight); el cliente
// nunca toca institutions/* (reglas deny). La lectura llega en
// adminGetSchoolConfig.gradingWeight; si el campo no existe, el backend
// devuelve el default tradicional (30/60/10).
export type GradingMode = 'tradicional' | 'competencias' | 'personalizada';
// LEGADO (sin efecto desde la política institucional): la institucional aplica
// SIEMPRE a los miembros; se conserva por compatibilidad del esquema.
export type GradingApplyTo = 'global' | 'override';

export interface GradingWeight {
  mode: GradingMode;
  weights: { teoria: number; practica: number; apreciativa: number };
  customWeights: Record<string, number>;
  applyTo: GradingApplyTo;
  updatedAt?: number;
  updatedBy?: string;
  previousWeight?: Omit<GradingWeight, 'updatedBy' | 'previousWeight'> | null;
}

export const DEFAULT_GRADING_WEIGHT: GradingWeight = {
  mode: 'tradicional',
  weights: { teoria: 30, practica: 60, apreciativa: 10 },
  customWeights: {},
  applyTo: 'global',
};

// ─── Módulo 1: Periodos de clase y reglas del plan ────────────────────────
// El admin define qué turnos operan en la institución y la regla de
// planificación. La escritura es SOLO vía Cloud Functions (adminSavePeriodos /
// adminSavePlanRules); el cliente nunca toca institutions/* (reglas deny). La
// lectura llega en adminGetSchoolConfig.periodos / .planRules; si el campo no
// existe, el backend devuelve los defaults (los tres turnos activos con sus
// horarios; regla trimestral sin recomendación).
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

export const PERIODO_LABEL: Record<PeriodoKey, string> = {
  matutino: 'Matutino',
  vespertino: 'Vespertino',
  nocturno: 'Nocturno',
};

export const REGLA_PLAN_LABEL: Record<ReglaPlan, string> = {
  semanal: 'Plan Semanal',
  mensual: 'Plan Mensual',
  trimestral: 'Plan Trimestral',
  cuatrimestral: 'Plan Cuatrimestral',
  anual: 'Plan Anual',
};

export const REGLA_PLAN_OPTIONS: { id: ReglaPlan; title: string; desc: string }[] = [
  { id: 'semanal', title: 'Semanal', desc: 'Planificación semana a semana' },
  { id: 'mensual', title: 'Mensual', desc: 'Ritmo mes a mes' },
  { id: 'trimestral', title: 'Trimestral', desc: '3 cortes en el año escolar' },
  { id: 'cuatrimestral', title: 'Cuatrimestral', desc: '2 semestres de corte' },
  { id: 'anual', title: 'Anual', desc: 'Un solo plan de todo el año' },
];

export const DEFAULT_PERIODOS: InstitutionPeriodos = {
  matutino: { activo: true, horarioInicio: '07:00', horarioFin: '12:00' },
  vespertino: { activo: true, horarioInicio: '13:00', horarioFin: '18:00' },
  nocturno: { activo: true, horarioInicio: '18:00', horarioFin: '22:00' },
};

export const DEFAULT_PLAN_RULES: PlanRules = {
  reglaSeleccionada: 'trimestral',
  recomendarADocentes: false,
};

export interface AdminSchoolConfigResponse {
  institutionId: string;
  institutionName: string;
  schoolConfig: SchoolConfig;
  gradingWeight?: GradingWeight;
  periodos?: InstitutionPeriodos;
  planRules?: PlanRules;
}

export interface AdminSavePeriodosResponse {
  institutionId: string;
  periodos: InstitutionPeriodos;
}

export async function adminSavePeriodos(input: InstitutionPeriodos): Promise<AdminSavePeriodosResponse> {
  if (IS_DEMO_MODE) return getDemo().adminSavePeriodos(input);
  const fn = callable<InstitutionPeriodos, AdminSavePeriodosResponse>('adminSavePeriodos');
  const res = await fn(input);
  return res.data;
}

export interface AdminSavePlanRulesResponse {
  institutionId: string;
  planRules: PlanRules;
}

export async function adminSavePlanRules(input: PlanRules): Promise<AdminSavePlanRulesResponse> {
  if (IS_DEMO_MODE) return getDemo().adminSavePlanRules(input);
  const fn = callable<PlanRules, AdminSavePlanRulesResponse>('adminSavePlanRules');
  const res = await fn(input);
  return res.data;
}

export interface AdminSaveGradingWeightResponse {
  institutionId: string;
  gradingWeight: GradingWeight;
}

export async function adminSaveGradingWeight(
  input: GradingWeight,
): Promise<AdminSaveGradingWeightResponse> {
  if (IS_DEMO_MODE) return getDemo().adminSaveGradingWeight(input);
  const fn = callable<GradingWeight, AdminSaveGradingWeightResponse>('adminSaveGradingWeight');
  const res = await fn(input);
  return res.data;
}

export interface AdminSaveSchoolConfigInput {
  name?: string;
  logoUrl?: string;
  slogan?: string;
  directorName?: string;
  address?: string;
  phone?: string;
  email?: string;
  primaryColor?: string;
}

export async function adminGetSchoolConfig(): Promise<AdminSchoolConfigResponse> {
  if (IS_DEMO_MODE) return getDemo().adminGetSchoolConfig();
  const fn = callable<Record<string, never>, AdminSchoolConfigResponse>('adminGetSchoolConfig');
  const res = await fn({});
  return res.data;
}

export async function adminSaveSchoolConfig(
  input: AdminSaveSchoolConfigInput,
): Promise<AdminSchoolConfigResponse> {
  if (IS_DEMO_MODE) return getDemo().adminSaveSchoolConfig(input);
  const fn = callable<AdminSaveSchoolConfigInput, AdminSchoolConfigResponse>('adminSaveSchoolConfig');
  const res = await fn(input);
  return res.data;
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
  periodo?: string | null;
  nivelEducativo?: string | null;
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

export async function adminListTeachers(filters?: AdminFilterParams): Promise<AdminTeacherListResponse> {
  if (IS_DEMO_MODE) return getDemo().adminListTeachers(filters);
  const fn = callable<AdminFilterParams, AdminTeacherListResponse>('adminListTeachers');
  const res = await fn(filters ?? {});
  return res.data;
}

export async function adminGetTeacherData(
  teacherUid: string,
  filters?: AdminFilterParams,
): Promise<AdminTeacherDataResponse> {
  if (IS_DEMO_MODE) return getDemo().adminGetTeacherData(teacherUid, filters);
  const fn = callable<{ teacherUid: string } & AdminFilterParams, AdminTeacherDataResponse>('adminGetTeacherData');
  const res = await fn({ teacherUid, ...filters });
  return res.data;
}

export async function adminGetTeacherSummary(
  teacherUid: string,
  filters?: AdminFilterParams,
): Promise<AdminTeacherSummaryResponse> {
  if (IS_DEMO_MODE) return getDemo().adminGetTeacherSummary(teacherUid, filters);
  const fn = callable<{ teacherUid: string } & AdminFilterParams, AdminTeacherSummaryResponse>('adminGetTeacherSummary');
  const res = await fn({ teacherUid, ...filters });
  return res.data;
}

export interface AdminInviteTeacherResponse {
  success: boolean;
  message: string;
  uid: string;
  institutionId: string;
}

export async function adminInviteTeacher(email: string): Promise<AdminInviteTeacherResponse> {
  if (IS_DEMO_MODE) return getDemo().adminInviteTeacher(email);
  const fn = callable<{ email: string }, AdminInviteTeacherResponse>('adminInviteTeacher');
  const res = await fn({ email });
  return res.data;
}

// ─── Búsqueda de estudiantes de la institución ──
export interface StudentMembership {
  studentDocId: string;
  subjectId: string;
  subjectName: string;
  periodo: string | null;
  nivelEducativo?: string | null;
  teacherUid: string;
  teacherName: string;
}

export interface StudentSearchResult {
  studentId: string;
  cedula: string;
  firstName: string;
  lastName: string;
  gender: 'M' | 'F' | null;
  memberships: StudentMembership[];
}

export interface AdminSearchStudentsResponse {
  students: StudentSearchResult[];
  total: number;
}

export async function adminSearchStudents(
  q: string,
  filters?: AdminFilterParams,
): Promise<AdminSearchStudentsResponse> {
  if (IS_DEMO_MODE) return getDemo().adminSearchStudents(q, filters);
  const fn = callable<{ q: string } & AdminFilterParams, AdminSearchStudentsResponse>('adminSearchStudents');
  const res = await fn({ q, ...filters });
  return res.data;
}

// ─── Búsqueda de discrepancias (Módulo 2) ──
// Búsqueda centralizada por nombre o cédula que devuelve filas planas
// (estudiante × asignatura) en TODA la institución (ignora los filtros del
// panel), marcando las filas de personas con discrepancias como 'inactivo'.
// Solo administradores; el backend valida el rol y acota a su institución.
export async function searchStudent(query: string): Promise<SearchStudentResponse> {
  if (IS_DEMO_MODE) return getDemo().searchStudent(query);
  const fn = callable<{ query: string }, SearchStudentResponse>('searchStudent');
  const res = await fn({ query });
  return res.data;
}

// ─── Boletín académico de un estudiante ──
export interface BoletinEvaluation {
  evaluationId: string;
  title: string;
  type: 'teorica' | 'practica' | 'apreciativa' | string;
  maxScore: number;
  date: string | null;
  score: number | null;
  scorePct: number | null;
}

export interface AttendanceRecord {
  date: string;
  status: 'present' | 'late' | 'absent' | string;
}

export interface BoletinMembership {
  subjectId: string;
  subjectName: string;
  periodo: string | null;
  teacherUid: string;
  teacherName: string;
  evaluations: BoletinEvaluation[];
  avgPct: number | null;
  attendance: {
    present: number;
    late: number;
    absent: number;
    total: number;
    pct: number | null;
  };
  /** Campo ADITIVO (boletín v2): registros de asistencia con fecha, para que
   *  el cliente compute la asistencia por sub-periodo del plan (A1/T1/...).
   *  Ausente en respuestas viejas = sin desglose (solo el agregado). */
  attendanceRecords?: AttendanceRecord[];
}

/**
 * Observación del boletín (Módulo boletín v2). La escriben los docentes desde
 * su vista de notas (src/components/GradesTab.tsx) y la consolidan en el
 * boletín del admin:
 *  - `subjectId === ''` → observación GENERAL del docente consejero.
 *  - `subjectId` con valor → observación del docente para ESA asignatura.
 *  - `period` es la clave del periodo activo de la institución ('I'|'II'|'III',
 *    'C1'|'C2', 'anual', o clave semanal/mensual derivada).
 */
export interface BoletinObservation {
  id: string;
  authorUid: string;
  authorName: string;
  subjectId: string;
  subjectName: string;
  period: string;
  text: string;
  updatedAt?: number | null;
}

export interface AdminGetStudentBoletinResponse {
  student: {
    studentId: string;
    cedula: string;
    firstName: string;
    lastName: string;
    gender: 'M' | 'F' | null;
  };
  institutionName: string;
  schoolConfig?: SchoolConfig;
  memberships: BoletinMembership[];
  /** Campo ADITIVO (boletín v2): observaciones del estudiante en la
   *  institución. Ausente en respuestas viejas = sin observaciones. */
  observations?: BoletinObservation[];
}

/**
 * Obtiene el boletín académico consolidado de un estudiante.
 * `periodo` (trimestre 'I' | 'II' | 'III') es opcional: cuando se pasa, el
 * backend filtra evaluaciones y asistencia por la fecha del registro.
 * Ausente/null = todos los periodos.
 */
export async function adminGetStudentBoletin(
  studentId: string,
  periodo?: string | null,
): Promise<AdminGetStudentBoletinResponse> {
  if (IS_DEMO_MODE) return getDemo().adminGetStudentBoletin(studentId, periodo);
  const fn = callable<{ studentId: string; periodo?: string | null }, AdminGetStudentBoletinResponse>(
    'adminGetStudentBoletin',
  );
  const res = await fn({ studentId, periodo: periodo || null });
  return res.data;
}

// ─── AI Insights: retroalimentación pedagógica bajo demanda ──
export interface StudentAIInsights {
  resumen: string;
  fortalezas: string[];
  areasDeMejora: string[];
  recomendaciones: string[];
}

export interface AdminGenerateStudentInsightsResponse {
  student: {
    studentId: string;
    cedula: string;
    firstName: string;
    lastName: string;
    gender: 'M' | 'F' | null;
  };
  institutionName: string;
  schoolConfig?: SchoolConfig;
  insights: StudentAIInsights;
}

export async function adminGenerateStudentInsights(studentId: string): Promise<AdminGenerateStudentInsightsResponse> {
  if (IS_DEMO_MODE) return getDemo().adminGenerateStudentInsights(studentId);
  const fn = callable<{ studentId: string }, AdminGenerateStudentInsightsResponse>('adminGenerateStudentInsights');
  const res = await fn({ studentId });
  return res.data;
}

export interface SubjectMetric {
  subjectId: string;
  subjectName: string;
  teacherName: string;
  periodo?: string | null;
  nivelEducativo?: string | null;
  students: number;
  evaluations: number;
  evaluationsWithGrades: number;
  evaluationsWithoutGrades: number;
  attendanceTotal: number;
  attendancePresent: number;
  attendanceLate: number;
  attendanceAbsent: number;
  attendanceRate: number;
  avgPct: number | null;
}

export interface WeeklyActivity {
  week: string;
  sessions: number;
  evaluations: number;
  notes: number;
  materials: number;
  events: number;
}

export interface TeacherActivity {
  uid: string;
  displayName: string;
  plan: 'free' | 'pro' | 'school';
  lastActivity: number | null;
  active7d: boolean;
  active30d: boolean;
  aiCallsThisMonth: number;
  subjects: number;
  students: number;
  evaluations: number;
  attendanceCount: number;
  gradesCount: number;
}

export interface InstitutionStats {
  generatedAt: number;
  institutionId: string;
  totals: {
    teachers: number;
    subjects: number;
    students: number;
    evaluations: number;
    gradesCount: number;
    attendanceCount: number;
    sessions: number;
  };
  byPlan: { free: number; pro: number; school: number };
  attendance: { present: number; late: number; absent: number; total: number; passRate: number };
  grades: { count: number; avgPct: number | null };
  subjectStats: SubjectMetric[];
  weeklyActivity: WeeklyActivity[];
  teachers: TeacherActivity[];
  aiUsage: { callsThisMonth: number; teachersWithUsage: number };
}

export async function adminGetInstitutionStats(filters?: AdminFilterParams): Promise<InstitutionStats> {
  if (IS_DEMO_MODE) return getDemo().adminGetInstitutionStats(filters);
  const fn = callable<AdminFilterParams, InstitutionStats>('adminGetInstitutionStats');
  const res = await fn(filters ?? {});
  return res.data;
}

// ─── Alertas de riesgo institucional ──
export type InstitutionAlertType = 'student_grades' | 'student_attendance' | 'group_grades' | 'group_attendance' | 'teacher_inactive';

export interface InstitutionAlert {
  id: string;
  type: InstitutionAlertType;
  severity: 'critical' | 'warning';
  subjectId: string | null;
  subjectName: string | null;
  teacherUid: string | null;
  teacherName: string | null;
  periodo: string | null;
  nivelEducativo?: string | null;
  studentId: string | null;
  studentName: string | null;
  cedula: string | null;
  gradedCount: number | null;
  avgPct: number | null;
  attendanceTotal: number | null;
  attendancePct: number | null;
  lastActivity: number | null;
  message: string;
}

export interface AdminInstitutionAlertsResponse {
  generatedAt: number;
  institutionId: string;
  institutionName: string;
  summary: {
    total: number;
    critical: number;
    warning: number;
    studentsAtRisk: number;
    groupsAtRisk: number;
  };
  alerts: InstitutionAlert[];
}

export async function adminGetInstitutionAlerts(filters?: AdminFilterParams): Promise<AdminInstitutionAlertsResponse> {
  if (IS_DEMO_MODE) return getDemo().adminGetInstitutionAlerts(filters);
  const fn = callable<AdminFilterParams, AdminInstitutionAlertsResponse>('adminGetInstitutionAlerts');
  const res = await fn(filters ?? {});
  return res.data;
}

// ─── Inteligencia Institucional (Gemini AI) ──
export interface InstitutionAIPattern {
  titulo: string;
  detalle: string;
}

export interface InstitutionAIInsights {
  resumen: string;
  patrones: InstitutionAIPattern[];
  recomendaciones: string[];
}

export interface AdminGenerateInstitutionInsightsResponse {
  institutionName: string;
  stats: {
    teachersWithData: number;
    gradesCount: number;
    avgPct: number | null;
    attendancePct: number | null;
    alertsCount: number;
  };
  insights: InstitutionAIInsights;
}

export async function adminGenerateInstitutionInsights(
  filters?: AdminFilterParams,
): Promise<AdminGenerateInstitutionInsightsResponse> {
  if (IS_DEMO_MODE) return getDemo().adminGenerateInstitutionInsights(filters);
  const fn = callable<AdminFilterParams, AdminGenerateInstitutionInsightsResponse>('adminGenerateInstitutionInsights');
  const res = await fn(filters ?? {});
  return res.data;
}

// ─── Sprint 1 Métricas: KPIs globales + riesgo estudiantil ────────────────
export type InstitutionalRiskLevel = 'low' | 'medium' | 'high';

export interface InstitutionalRiskStudentRow {
  studentId: string;
  cedula: string | null;
  studentName: string;
  asignatura: string;
  docente: string;
  periodo: string | null;
  nivelEducativo: string | null;
  /** % de asistencias del estudiante en esa asignatura (0-100). */
  asistencia: number | null;
  /** Promedio normalizado (0-100) del estudiante en esa asignatura. */
  nota: number | null;
  nivelRiesgo: InstitutionalRiskLevel;
  razones: string[];
}

export interface InstitutionalMetrics {
  generatedAt: number;
  institutionId: string;
  attendance: {
    global: number | null;
    byTurno: { matutino: number | null; vespertino: number | null; nocturno: number | null };
    /** Claves = nivelEducativo de la asignatura (+ 'sin-nivel'). */
    byGrado: Record<string, number | null>;
  };
  grades: { global: number | null };
  riskSummary: { low: number; medium: number; high: number };
  atRiskStudents: InstitutionalRiskStudentRow[];
  trends?: {
    attendance: { date: string; value: number }[];
    grades: { date: string; value: number }[];
  };
  distribution?: {
    byTurno: Record<string, number>;
    byGrado: Record<string, number>;
  };
  retention?: {
    estimatedRate: number | null;
    totalActive: number;
    totalPrevious: number | null;
  };
}

export async function getInstitutionalMetrics(filters?: AdminFilterParams): Promise<InstitutionalMetrics> {
  if (IS_DEMO_MODE) return getDemo().getInstitutionalMetrics(filters);
  const fn = callable<AdminFilterParams, InstitutionalMetrics>('getInstitutionalMetrics');
  const res = await fn(filters ?? {});
  return res.data;
}

// ─── Sprint 2: Detalle del estudiante + recomendaciones ───────────────────
export interface StudentRiskSubject {
  subjectId: string;
  subjectName: string;
  teacherName: string;
  periodo: string | null;
  nivelEducativo?: string | null;
  attendance: number | null;
  finalGrade: number | null;
  grado: string | null;
  seccion: string | null;
}

export interface StudentRiskReport {
  student: {
    studentId: string;
    cedula: string;
    firstName: string;
    lastName: string;
    grado: string | null;
    seccion: string | null;
    /** El esquema no tiene correo del estudiante → null. */
    correo: string | null;
  };
  subjects: StudentRiskSubject[];
  promedioGeneral: number | null;
  riskLevel: InstitutionalRiskLevel;
  reasons: string[];
  recommendations: string[];
}

export async function getStudentRiskReport(studentId: string): Promise<StudentRiskReport> {
  if (IS_DEMO_MODE) return getDemo().getStudentRiskReport(studentId);
  const fn = callable<{ studentId: string }, StudentRiskReport>('getStudentRiskReport');
  const res = await fn({ studentId });
  return res.data;
}

// ─── Sprint 3: Desempeño por docente ──────────────────────────────────────
export interface TeacherPerformanceSubject {
  subjectId: string;
  subjectName: string;
  periodo: string | null;
  nivelEducativo?: string | null;
  promedioCalificaciones: number | null;
  promedioAsistencia: number | null;
  numEstudiantes: number;
}

export interface TeacherPerformanceRiskStudent {
  studentId: string;
  cedula: string;
  studentName: string;
  subjectName: string;
  asistencia: number | null;
  nota: number | null;
  nivelRiesgo: InstitutionalRiskLevel;
  razones: string[];
}

export interface TeacherPerformanceEvolution {
  periodo: string;
  attendance: number | null;
  grades: number | null;
}

export interface TeacherPerformance {
  teacher: {
    uid: string;
    email: string;
    displayName: string;
    institutionId: string;
    institutionName: string;
    subjectsCount: number;
    totalStudents: number;
    promedioGeneral: number | null;
  };
  subjects: TeacherPerformanceSubject[];
  atRiskStudents: TeacherPerformanceRiskStudent[];
  /** Evolución por trimestre (I/II/III): asistencia y calificaciones. */
  evolution: TeacherPerformanceEvolution[];
}

export interface TeacherPerformanceParams {
  teacherId: string;
  /** Turno (matutino/vespertino/nocturno) — opcional, sanitizado en backend. */
  periodo?: string;
  /** Nivel educativo (inicial/primaria/secundaria/universidad) — opcional. */
  grado?: string;
}

export async function getTeacherPerformance(input: TeacherPerformanceParams): Promise<TeacherPerformance> {
  if (IS_DEMO_MODE) return getDemo().getTeacherPerformance(input);
  const fn = callable<TeacherPerformanceParams, TeacherPerformance>('getTeacherPerformance');
  const res = await fn(input);
  return res.data;
}

// ─── Exportación JSON Institucional Completa ──────────────────────────────
export interface AdminExportOptions {
  includeMetrics?: boolean;
  includeAlerts?: boolean;
  includeTeachers?: boolean;
  includeStudents?: boolean;
  includeDiscrepancies?: boolean;
  includeStats?: boolean;
  includeInsights?: boolean;
  filters?: AdminFilterParams;
}

// Metadata en la raíz del respaldo (aditiva, convive con los campos legacy
// version/exportedAt/institutionId...). Identifica el archivo como respaldo
// institucional completo y permite al importador validar tipo/versión.
export interface AdminExportMeta {
  schemaVersion: string;
  type: 'institution-full-backup';
  generatedBy: string;
  appVersion: string;
  exportedAt: string;
  institutionId: string;
  institutionName: string;
}

const EDIAGIL_APP_VERSION = '1.0';

export interface AdminExportData {
  version: string;
  exportedAt: string;
  institutionId: string;
  institutionName: string;
  filters: AdminFilterParams;
  // Configuración institucional incluida para que el respaldo sea restaurable
  // (única parte fiable del payload analítico para una restauración).
  schoolConfig?: SchoolConfig;
  gradingWeight?: GradingWeight;
  periodos?: InstitutionPeriodos;
  planRules?: PlanRules;
  metrics?: InstitutionalMetrics;
  alerts?: AdminInstitutionAlertsResponse;
  teachers?: AdminTeacherListResponse;
  teacherDetails?: Record<string, AdminTeacherDataResponse>;
  students?: AdminSearchStudentsResponse;
  discrepancies?: SearchStudentResponse;
  stats?: InstitutionStats;
  insights?: AdminGenerateInstitutionInsightsResponse;
  export?: AdminExportMeta;
}

export async function exportAdminDataToJSON(
  options: AdminExportOptions = {}
): Promise<AdminExportData> {
  const {
    includeMetrics = true,
    includeAlerts = true,
    includeTeachers = true,
    includeStudents = true,
    includeDiscrepancies = true,
    includeStats = true,
    includeInsights = false,
    filters,
  } = options;

  const exportedAtIso = new Date().toISOString();

  const [metrics, alerts, teachers, students, discrepancies, stats, insights] = await Promise.all([
    includeMetrics ? getInstitutionalMetrics(filters).catch(() => null) : Promise.resolve(null),
    includeAlerts ? adminGetInstitutionAlerts(filters).catch(() => null) : Promise.resolve(null),
    includeTeachers ? adminListTeachers(filters).catch(() => null) : Promise.resolve(null),
    includeStudents ? adminSearchStudents('', filters).catch(() => null) : Promise.resolve(null),
    includeDiscrepancies ? searchStudent('').catch(() => null) : Promise.resolve(null),
    includeStats ? adminGetInstitutionStats(filters).catch(() => null) : Promise.resolve(null),
    includeInsights ? adminGenerateInstitutionInsights(filters).catch(() => null) : Promise.resolve(null),
  ]);

  let teacherDetails: Record<string, AdminTeacherDataResponse> = {};
  if (includeTeachers && teachers?.teachers) {
    const detailPromises = teachers.teachers.map(t => adminGetTeacherData(t.uid, filters).catch(() => null));
    const details = await Promise.all(detailPromises);
    teacherDetails = Object.fromEntries(
      teachers.teachers
        .map((t, i) => [t.uid, details[i]])
        .filter((entry): entry is [string, AdminTeacherDataResponse] => entry[1] !== null)
    );
  }

  const adminConfig = await adminGetSchoolConfig().catch(() => ({
    institutionId: 'unknown',
    institutionName: 'Institución',
    schoolConfig: EMPTY_SCHOOL_CONFIG,
    gradingWeight: DEFAULT_GRADING_WEIGHT,
    periodos: DEFAULT_PERIODOS,
    planRules: DEFAULT_PLAN_RULES,
  }));

  return {
    version: '1.0',
    exportedAt: exportedAtIso,
    institutionId: adminConfig.institutionId,
    institutionName: adminConfig.institutionName,
    filters: filters || {},
    schoolConfig: adminConfig.schoolConfig,
    gradingWeight: adminConfig.gradingWeight,
    periodos: adminConfig.periodos,
    planRules: adminConfig.planRules,
    metrics: metrics || undefined,
    alerts: alerts || undefined,
    teachers: teachers || undefined,
    teacherDetails: Object.keys(teacherDetails).length ? teacherDetails : undefined,
    students: students || undefined,
    discrepancies: discrepancies || undefined,
    stats: stats || undefined,
    insights: insights || undefined,
    export: {
      schemaVersion: '1.0',
      type: 'institution-full-backup',
      generatedBy: 'EdiAgil',
      appVersion: EDIAGIL_APP_VERSION,
      exportedAt: exportedAtIso,
      institutionId: adminConfig.institutionId,
      institutionName: adminConfig.institutionName,
    },
  };
}

export function triggerAdminJSONDownload(data: AdminExportData, filename?: string) {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `ediagil-admin-export-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ─── Respaldo institucional: restauración (operación extraordinaria) ──────
// El backend revalida TODO (assertAdmin + validateInstitutionBackup +
// coincidencia de institución) y devuelve un resumen de qué restauró y qué
// omitió. Ver functions/lib/backup-validate.js y exports.adminRestoreInstitutionBackup.
export interface AdminRestoreBackupResponse {
  institutionId: string;
  institutionName?: string;
  restored: Record<string, number>;
  skipped: string[];
  warnings: string[];
  schoolConfig?: SchoolConfig;
  gradingWeight?: GradingWeight;
  periodos?: InstitutionPeriodos;
  planRules?: PlanRules;
}

export async function adminRestoreInstitutionBackup(
  payload: AdminExportData,
): Promise<AdminRestoreBackupResponse> {
  if (IS_DEMO_MODE) return getDemo().adminRestoreInstitutionBackup(payload);
  const fn = callable<AdminExportData, AdminRestoreBackupResponse>('adminRestoreInstitutionBackup');
  const res = await fn(payload);
  return res.data;
}
