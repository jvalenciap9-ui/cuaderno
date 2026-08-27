/**
 * institutionalReport.ts — Fase 1 del nuevo boletín institucional.
 *
 * Capa de consultas dinámicas (híbrida) para el boletín académico:
 *  - Admin institucional: delega en las Cloud Functions de admin
 *    (adminSearchStudents / adminGetStudentBoletin) que consolidan a nivel
 *    institución. El cliente NO puede leer datos de otros docentes ni
 *    institutions/* directamente (reglas Firestore).
 *  - Docente: consulta primero su propia data en Dexie (offline-first) y, si
 *    no la tiene y hay conexión, consulta Firestore directo (solo su userId).
 *
 * Los filtros de Fase 1 son: studentId (id del doc o cédula), grado (derivado
 * del nombre de la asignatura, p.ej. "Matemáticas — 1er Año A") y periodo
 * (matutino / vespertino / nocturno, campo periodo del subject).
 */

import { db } from './db';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db as firestore } from './firebase';
import {
  adminSearchStudents,
  adminGetStudentBoletin,
  type AdminGetStudentBoletinResponse,
  type BoletinMembership,
  type BoletinObservation,
  type GradingWeight,
  type StudentMembership,
  type StudentSearchResult,
} from './adminApi';
import {
  tableColumnsForRegla,
  columnKeyFromDate,
  type PlanTableColumn,
  type ReglaPlanBoletin,
} from './planPeriods';
import { weightedBreakdown } from './gradingUtils';

export const PERIODO_LABEL: Record<string, string> = {
  matutino: 'Matutino',
  vespertino: 'Vespertino',
  nocturno: 'Nocturno',
};

// ─── Trimestre (I/II/III) del boletín ─────────────────────────────────────
// El esquema real de EdiAgil NO guarda el trimestre en evaluations/grades/
// attendance: se determina por el MES de la fecha del registro (yyyy-MM-dd).
//   I  → sep, oct, nov | II → dic, ene, feb | III → mar-ago
export const TRIMESTRES = ['I', 'II', 'III'] as const;
export type Trimestre = (typeof TRIMESTRES)[number];

export const TRIMESTRE_LABEL: Record<Trimestre, string> = {
  I: 'I Trimestre',
  II: 'II Trimestre',
  III: 'III Trimestre',
};

export function trimestreFromDate(date?: string | null): Trimestre | null {
  const m = String(date || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = parseInt(m[2], 10);
  if (month >= 9 && month <= 11) return 'I';
  if (month === 12 || month <= 2) return 'II';
  return 'III';
}

/** true cuando no hay trimestre pedido (todos) o la fecha cae en él. */
export function matchesTrimestre(date?: string | null, trimestre?: Trimestre | null): boolean {
  if (!trimestre) return true;
  return trimestreFromDate(date) === trimestre;
}

export interface DerivedGrado {
  grado: string | null;
  seccion: string | null;
}

export interface InstitutionalMembership extends BoletinMembership {
  grado: string | null;
  seccion: string | null;
}

export interface InstitutionalReportFilters {
  /** Id del documento student (admin / Firestore) o id local / cédula (docente). */
  studentId: string;
  grado?: string;
  periodo?: string;
  /** Trimestre del boletín (I/II/III). null/ausente = todos los periodos. */
  trimestre?: Trimestre | null;
  /**
   * Clave de periodo genérica del boletín (boletín v2, plan-adaptive):
   * 'I'|'II'|'III', 'C1'|'C2', 'anual' o clave semanal/mensual derivada.
   * Para la ruta admin se traduce a lo que acepta el backend
   * (ver planPeriods.backendPeriodParam). Tiene prioridad sobre `trimestre`.
   */
  period?: string | null;
  /** schoolId / institutionId del usuario logueado (nombre y logo de la institución). */
  schoolId?: string;
}

export interface InstitutionalReportData {
  source: 'admin' | 'local' | 'firestore';
  student: {
    studentId: string;
    cedula: string;
    firstName: string;
    lastName: string;
    gender: 'M' | 'F' | null;
  };
  institutionName: string;
  schoolConfig: {
    logoUrl: string;
    slogan: string;
    directorName: string;
    address: string;
    phone: string;
    email: string;
    primaryColor?: string;
  } | null;
  schoolId: string | null;
  filters: { grado: string | null; periodo: string | null; trimestre: Trimestre | null };
  memberships: InstitutionalMembership[];
  /** Observaciones del estudiante (boletín v2): generales del consejero
   *  (subjectId '') y por asignatura. Campo aditivo, puede estar vacío. */
  observations: BoletinObservation[];
}

export interface ReportContext {
  uid: string | null;
  isAdmin: boolean;
  institutionName?: string;
  schoolId?: string;
}

export interface InstitutionalStudentSearchFilters {
  q: string;
  grado?: string;
  periodo?: string;
}

export interface InstitutionalSearchResult {
  students: StudentSearchResult[];
  total: number;
  source: 'admin' | 'local' | 'firestore';
}

// ─── Normalización de texto (espejo del backend) ──────────────────────────
function normText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// ─── Derivación de grado desde el nombre de asignatura ────────────────────
// Formato típico: "Matemáticas — 1er Año A", "Ciencias Naturales - 2do B".
// Se toma la parte tras el separador y se extrae el ordinal + opcional sección.
const GRADO_RE = /(\d{1,2})\s*(?:er|do|to|ro|°|º)?\.?\s*(año|grado|curso)?\.?\s*([a-zA-Z])?\b/i;

export function deriveGradoSeccion(subjectName: string): DerivedGrado {
  if (!subjectName) return { grado: null, seccion: null };
  const parts = subjectName.split(/\s*(?:—|–|-)\s*/).map((p) => p.trim()).filter(Boolean);
  const target = parts.length > 1 ? parts[parts.length - 1] : subjectName;
  const m = target.match(GRADO_RE);
  if (!m) return { grado: null, seccion: null };
  const n = parseInt(m[1], 10);
  const word = (m[2] || 'año').replace(/^./, (c) => c.toUpperCase());
  const ordinal = n === 1 ? '1er' : n === 2 ? '2do' : n === 3 ? '3er' : `${n}to`;
  const seccion = m[3] ? m[3].toUpperCase() : null;
  return { grado: `${ordinal} ${word}`, seccion };
}

/**
 * Etiqueta de "Grupo" del boletín, adaptable a cualquier institución, armada
 * con los campos REALES disponibles en la membresía (grado/sección derivados
 * del nombre de asignatura + turno de la asignatura). Formato genérico:
 *   · solo grado numérico + sección → compacto "6C"
 *   · grado + sección → "1er Año - Aula A"
 *   · + turno → "... - Vespertino"
 * El esquema NO tiene campos carrera/programa/aula (ver AGENTS.md): si se
 * agregaran a la data en el futuro, se incluirían antes del grado.
 */
export function buildGrupoLabel(memberships: InstitutionalMembership[]): string {
  if (!memberships || memberships.length === 0) return '—';
  const score = (m: InstitutionalMembership) =>
    (m.grado ? 1 : 0) + (m.seccion ? 1 : 0) + (m.periodo ? 1 : 0);
  const m = [...memberships].sort((a, b) => score(b) - score(a))[0];
  const grado = m.grado || null;
  const seccion = m.seccion || null;
  const turno = m.periodo ? PERIODO_LABEL[m.periodo] : null;
  const numGrado = grado ? String(grado).match(/\d+/)?.[0] || null : null;
  // Compacto cuando es solo grado numérico + sección (p.ej. "6C").
  if (numGrado && seccion && !turno) return `${numGrado}${seccion}`;
  const parts: string[] = [];
  if (grado) parts.push(seccion ? `${grado} - Aula ${seccion}` : grado);
  else if (seccion) parts.push(`Aula ${seccion}`);
  if (turno) parts.push(turno);
  return parts.length ? parts.join(' - ') : '—';
}

export function normalizeGradoInput(grado?: string | null): { n: number | null; seccion: string | null } {
  if (!grado) return { n: null, seccion: null };
  const nMatch = grado.match(/(\d{1,2})/);
  const secMatch = grado.match(/[a-zA-Z]/);
  return {
    n: nMatch ? parseInt(nMatch[1], 10) : null,
    seccion: secMatch ? secMatch[0].toUpperCase() : null,
  };
}

export function matchesGrado(subjectName: string, grado?: string | null): boolean {
  if (!grado || !grado.trim()) return true;
  const want = normalizeGradoInput(grado);
  if (want.n === null) return true;
  const have = deriveGradoSeccion(subjectName);
  const haveN = have.grado ? parseInt(have.grado, 10) : NaN;
  if (want.seccion) return haveN === want.n && (have.seccion || '') === want.seccion;
  return haveN === want.n;
}

export function matchesPeriodo(periodo: string | null | undefined, periodoInput?: string | null): boolean {
  if (!periodoInput || !periodoInput.trim()) return true;
  return (periodo || '') === periodoInput.trim();
}

// ─── Búsqueda de estudiantes ──────────────────────────────────────────────
export async function searchInstitutionalStudents(
  filters: InstitutionalStudentSearchFilters,
  ctx: ReportContext,
): Promise<InstitutionalSearchResult> {
  const q = filters.q.trim();
  if (q.length < 2) return { students: [], total: 0, source: 'local' };

  if (ctx.isAdmin) {
    const res = await adminSearchStudents(q);
    const students = res.students.filter((s) =>
      s.memberships.some(
        (m) => matchesGrado(m.subjectName, filters.grado) && matchesPeriodo(m.periodo, filters.periodo),
      ),
    );
    return { students, total: students.length, source: 'admin' };
  }

  if (!ctx.uid) return { students: [], total: 0, source: 'local' };

  const local = await searchLocalStudents(filters, q);
  if (local.students.length > 0 || !navigator.onLine) return local;

  return searchFirestoreStudents(filters, q, ctx.uid);
}

async function searchLocalStudents(
  filters: InstitutionalStudentSearchFilters,
  q: string,
): Promise<InstitutionalSearchResult> {
  const [subjects, students] = await Promise.all([db.subjects.toArray(), db.students.toArray()]);
  const subjectById = new Map(subjects.map((s) => [s.id ?? 0, s]));
  const nq = normText(q);

  const byPerson = new Map<string, StudentSearchResult>();
  for (const st of students) {
    const key = String(st.cedula || '').trim() || `${normText(st.firstName)}|${normText(st.lastName)}`;
    let person = byPerson.get(key);
    if (!person) {
      person = {
        studentId: String(st.id),
        cedula: st.cedula || '',
        firstName: st.firstName,
        lastName: st.lastName,
        gender: st.gender || null,
        memberships: [],
      };
      byPerson.set(key, person);
    }
    const sub = subjectById.get(st.subjectId ?? 0);
    if (!sub) continue;
    const membership: StudentMembership = {
      studentDocId: String(st.id),
      subjectId: String(st.subjectId),
      subjectName: sub.name || 'Sin nombre',
      periodo: sub.periodo || null,
      teacherUid: '',
      teacherName: sub.teacher || 'Docente',
    };
    const already = person.memberships.some((m) => m.subjectId === membership.subjectId);
    if (already) continue;
    if (!matchesGrado(sub.name, filters.grado) || !matchesPeriodo(sub.periodo, filters.periodo)) continue;
    person.memberships.push(membership);
  }

  const studentsOut = Array.from(byPerson.values()).filter((p) => {
    const hay = normText(
      [p.firstName, p.lastName, p.cedula, ...p.memberships.flatMap((m) => [m.subjectName, m.periodo || ''])].join(' '),
    );
    return hay.includes(nq);
  });
  return { students: studentsOut, total: studentsOut.length, source: 'local' };
}

async function searchFirestoreStudents(
  filters: InstitutionalStudentSearchFilters,
  q: string,
  uid: string,
): Promise<InstitutionalSearchResult> {
  const [subjectsSnap, studentsSnap] = await Promise.all([
    getDocs(query(collection(firestore, 'subjects'), where('userId', '==', uid))),
    getDocs(query(collection(firestore, 'students'), where('userId', '==', uid))),
  ]);
  const subjectById = new Map(subjectsSnap.docs.map((d) => [d.id, d.data()]));
  const nq = normText(q);

  const byPerson = new Map<string, StudentSearchResult>();
  for (const doc of studentsSnap.docs) {
    const st = doc.data();
    const key = String(st.cedula || '').trim() || `${normText(st.firstName)}|${normText(st.lastName)}`;
    let person = byPerson.get(key);
    if (!person) {
      person = {
        studentId: doc.id,
        cedula: st.cedula || '',
        firstName: st.firstName,
        lastName: st.lastName,
        gender: st.gender || null,
        memberships: [],
      };
      byPerson.set(key, person);
    }
    const sub = subjectById.get(st.subjectId);
    if (!sub) continue;
    if (!matchesGrado(sub.name || '', filters.grado) || !matchesPeriodo(sub.periodo, filters.periodo)) continue;
    const membership: StudentMembership = {
      studentDocId: doc.id,
      subjectId: String(st.subjectId),
      subjectName: sub.name || 'Sin nombre',
      periodo: sub.periodo || null,
      teacherUid: uid,
      teacherName: sub.teacher || 'Docente',
    };
    const already = person.memberships.some((m) => m.subjectId === membership.subjectId);
    if (!already) person.memberships.push(membership);
  }

  const studentsOut = Array.from(byPerson.values()).filter((p) => {
    const hay = normText(
      [p.firstName, p.lastName, p.cedula, ...p.memberships.flatMap((m) => [m.subjectName, m.periodo || ''])].join(' '),
    );
    return hay.includes(nq);
  });
  return { students: studentsOut, total: studentsOut.length, source: 'firestore' };
}

// ─── Reporte académico de un estudiante ───────────────────────────────────
export async function loadInstitutionalReport(
  filters: InstitutionalReportFilters,
  ctx: ReportContext,
): Promise<InstitutionalReportData> {
  if (ctx.isAdmin) return loadAdminReport(filters);
  if (!ctx.uid) throw new Error('Debes iniciar sesión para generar el reporte.');

  const local = await loadLocalReport(filters, ctx);
  if (local) return local;

  if (navigator.onLine) return loadFirestoreReport(filters, ctx);

  throw new Error('Sin conexión y el alumno no está en los datos locales.');
}

async function loadAdminReport(filters: InstitutionalReportFilters): Promise<InstitutionalReportData> {
  // El trimestre se resuelve en el backend (adminGetStudentBoletin) porque la
  // asistencia consolidada que devuelve la Cloud Function no trae fechas.
  // Boletín v2: para reglas ≠ trimestral el cliente envía la clave traducida
  // (C1/C2/anual) o null (semanal/mensual); ver planPeriods.backendPeriodParam.
  const backendPeriod = filters.period ?? filters.trimestre ?? null;
  const res: AdminGetStudentBoletinResponse = await adminGetStudentBoletin(filters.studentId, backendPeriod);
  return {
    source: 'admin',
    student: res.student,
    institutionName: res.institutionName,
    schoolConfig: res.schoolConfig
      ? {
          logoUrl: res.schoolConfig.logoUrl || '',
          slogan: res.schoolConfig.slogan || '',
          directorName: res.schoolConfig.directorName || '',
          address: res.schoolConfig.address || '',
          phone: res.schoolConfig.phone || '',
          email: res.schoolConfig.email || '',
          primaryColor: res.schoolConfig.primaryColor || '',
        }
      : null,
    schoolId: filters.schoolId || null,
    filters: { grado: filters.grado || null, periodo: filters.periodo || null, trimestre: filters.trimestre || null },
    memberships: dedupeMemberships(
      res.memberships
        .filter((m) => matchesGrado(m.subjectName, filters.grado) && matchesPeriodo(m.periodo, filters.periodo))
        .map(enrichMembership),
    ),
    observations: res.observations || [],
  };
}

async function loadLocalReport(
  filters: InstitutionalReportFilters,
  ctx: ReportContext,
): Promise<InstitutionalReportData | null> {
  const subjects = await db.subjects.toArray();
  const students = await db.students.toArray();

  const byId = students.find((s) => String(s.id) === filters.studentId);
  const byCedula = students.find((s) => s.cedula && s.cedula.trim() === filters.studentId.trim());
  const person = byId || byCedula;
  if (!person) return null;

  const personKey = String(person.cedula || '').trim() || `${normText(person.firstName)}|${normText(person.lastName)}`;
  const allMemberships = students.filter((s) => {
    const k = String(s.cedula || '').trim() || `${normText(s.firstName)}|${normText(s.lastName)}`;
    return k === personKey;
  });

  const memberships: InstitutionalMembership[] = [];
  for (const st of allMemberships) {
    const sub = subjects.find((x) => x.id === st.subjectId);
    if (!sub) continue;
    if (!matchesGrado(sub.name || '', filters.grado) || !matchesPeriodo(sub.periodo, filters.periodo)) continue;
    const [evalsAll, grades, attendanceAll] = await Promise.all([
      db.evaluations.where('subjectId').equals(st.subjectId ?? 0).toArray(),
      db.grades.where('subjectId').equals(st.subjectId ?? 0).toArray(),
      db.attendance.where('subjectId').equals(st.subjectId ?? 0).toArray(),
    ]);
    // Trimestre: las notas se filtran vía su evaluación (por fecha) y la
    // asistencia por la fecha del registro. En "todos" (null) no filtra.
    const evals = evalsAll.filter((ev) => matchesTrimestre(ev.date, filters.trimestre));
    const attendance = attendanceAll.filter((a) => matchesTrimestre(a.date, filters.trimestre));
    const stats = computeMembershipStats(evals, grades, attendance, st.id ?? 0);
    memberships.push({
      subjectId: String(st.subjectId),
      subjectName: sub.name || 'Sin nombre',
      periodo: sub.periodo || null,
      teacherUid: '',
      teacherName: sub.teacher || 'Docente',
      ...stats,
      ...deriveGradoSeccion(sub.name || ''),
    });
  }
  memberships.sort((a, b) => String(a.periodo || '').localeCompare(String(b.periodo || ''), 'es'));

  return {
    source: 'local',
    student: {
      studentId: String(person.id),
      cedula: person.cedula || '',
      firstName: person.firstName,
      lastName: person.lastName,
      gender: person.gender || null,
    },
    institutionName: ctx.institutionName || '',
    schoolConfig: null,
    schoolId: ctx.schoolId || null,
    filters: { grado: filters.grado || null, periodo: filters.periodo || null, trimestre: filters.trimestre || null },
    memberships,
    observations: [],
  };
}

async function loadFirestoreReport(
  filters: InstitutionalReportFilters,
  ctx: ReportContext,
): Promise<InstitutionalReportData> {
  const uid = ctx.uid!;
  const subjectsSnap = await getDocs(query(collection(firestore, 'subjects'), where('userId', '==', uid)));
  const studentsSnap = await getDocs(query(collection(firestore, 'students'), where('userId', '==', uid)));

  const personDoc = studentsSnap.docs.find(
    (d) => d.id === filters.studentId || (d.data().cedula && d.data().cedula.trim() === filters.studentId.trim()),
  );
  if (!personDoc) throw new Error('El alumno no existe en tus datos.');

  const person = personDoc.data();
  const personKey = String(person.cedula || '').trim() || `${normText(person.firstName)}|${normText(person.lastName)}`;
  const allDocs = studentsSnap.docs.filter((d) => {
    const k = String(d.data().cedula || '').trim() || `${normText(d.data().firstName)}|${normText(d.data().lastName)}`;
    return k === personKey;
  });

  const subjectById = new Map(subjectsSnap.docs.map((d) => [d.id, d.data()]));
  const memberships: InstitutionalMembership[] = [];

  for (const doc of allDocs) {
    const st = doc.data();
    const sub = subjectById.get(st.subjectId);
    if (!sub) continue;
    if (!matchesGrado(sub.name || '', filters.grado) || !matchesPeriodo(sub.periodo, filters.periodo)) continue;
    const [evalsSnap, gradesSnap, attSnap] = await Promise.all([
      getDocs(query(collection(firestore, 'evaluations'), where('userId', '==', uid), where('subjectId', '==', st.subjectId))),
      getDocs(query(collection(firestore, 'grades'), where('userId', '==', uid), where('subjectId', '==', st.subjectId))),
      getDocs(query(collection(firestore, 'attendance'), where('userId', '==', uid), where('subjectId', '==', st.subjectId))),
    ]);
    // Trimestre: las evaluaciones se filtran por su fecha y la asistencia por
    // la fecha del registro (las notas se filtran a través de su evaluación).
    const evals = evalsSnap.docs
      .map((d) => {
        const x = d.data() as { title?: string; type?: string; maxScore?: number; date?: string | null };
        return { id: d.id, title: x.title, type: x.type, maxScore: x.maxScore, date: x.date ?? null };
      })
      .filter((ev) => matchesTrimestre(ev.date, filters.trimestre));
    const grades = gradesSnap.docs.map((d) => {
      const x = d.data() as { evaluationId?: string; score?: number };
      return { evaluationId: x.evaluationId, score: x.score };
    });
    const attendance = attSnap.docs
      .filter((d) => matchesTrimestre((d.data() as { date?: string | null }).date ?? null, filters.trimestre))
      .map((d) => {
        const x = d.data() as { studentId?: string; status?: string; date?: string | null };
        return { studentId: x.studentId, status: x.status, date: x.date ?? null };
      });
    const stats = computeMembershipStats(evals, grades, attendance, doc.id);
    memberships.push({
      subjectId: String(st.subjectId),
      subjectName: sub.name || 'Sin nombre',
      periodo: sub.periodo || null,
      teacherUid: uid,
      teacherName: sub.teacher || 'Docente',
      ...stats,
      ...deriveGradoSeccion(sub.name || ''),
    });
  }
  memberships.sort((a, b) => String(a.periodo || '').localeCompare(String(b.periodo || ''), 'es'));

  return {
    source: 'firestore',
    student: {
      studentId: personDoc.id,
      cedula: person.cedula || '',
      firstName: person.firstName,
      lastName: person.lastName,
      gender: person.gender || null,
    },
    institutionName: ctx.institutionName || '',
    schoolConfig: null,
    schoolId: ctx.schoolId || null,
    filters: { grado: filters.grado || null, periodo: filters.periodo || null, trimestre: filters.trimestre || null },
    memberships,
    observations: [],
  };
}

// ─── Cálculo de estadísticas (espejo exacto de loadStudentBoletin) ────────
function computeMembershipStats(
  evals: Array<{ id?: string | number; title?: string; type?: string; maxScore?: number; date?: string | null }>,
  grades: Array<{ evaluationId?: string | number; score?: number }>,
  attendance: Array<{ studentId?: string | number; status?: string; date?: string | null }>,
  studentId: string | number,
) {
  const gradeByEval = new Map(grades.map((g) => [g.evaluationId, g]));

  let sumPct = 0;
  let countPct = 0;
  const evaluations = evals.map((ev) => {
    const grade = gradeByEval.get(ev.id);
    const maxScore = Number(ev.maxScore);
    const score = grade ? Number(grade.score) : null;
    const scorePct =
      grade && Number.isFinite(score) && maxScore > 0 ? Math.round(((score || 0) / maxScore) * 1000) / 10 : null;
    if (scorePct !== null) {
      sumPct += scorePct;
      countPct += 1;
    }
    return {
      evaluationId: String(ev.id),
      title: ev.title || 'Evaluación',
      type: ev.type || 'teorica',
      maxScore,
      date: ev.date || null,
      score,
      scorePct,
    };
  });

  const subRecords = attendance.filter((a) => a.studentId === studentId);
  const subAttendance = subRecords.map((a) => a.status);
  const attendanceOut = {
    present: subAttendance.filter((s) => s === 'present').length,
    late: subAttendance.filter((s) => s === 'late').length,
    absent: subAttendance.filter((s) => s === 'absent').length,
    total: subAttendance.length,
    pct:
      subAttendance.length > 0
        ? Math.round((subAttendance.filter((s) => s !== 'absent').length / subAttendance.length) * 1000) / 10
        : null,
  };

  return {
    evaluations,
    avgPct: countPct > 0 ? Math.round((sumPct / countPct) * 10) / 10 : null,
    attendance: attendanceOut,
    // Registros con fecha para desglosar la asistencia por sub-periodo del plan.
    attendanceRecords: subRecords.map((a) => ({
      date: a.date || '',
      status: a.status || '',
    })),
  };
}

function enrichMembership(m: BoletinMembership): InstitutionalMembership {
  return { ...m, ...deriveGradoSeccion(m.subjectName) };
}

/**
 * Deduplica membresías idénticas (mismo subjectName + docente + turno). Ocurre
 * cuando un seed o importación duplicó el mismo subject de un docente; se
 * conserva la membresía con más datos (más evaluaciones).
 */
function dedupeMemberships(ms: InstitutionalMembership[]): InstitutionalMembership[] {
  const key = (m: InstitutionalMembership) =>
    `${m.subjectName}|${m.teacherName}|${m.periodo || ''}`.toLowerCase();
  const seen = new Map<string, InstitutionalMembership>();
  for (const m of ms) {
    const k = key(m);
    const existing = seen.get(k);
    if (!existing || m.evaluations.length > existing.evaluations.length) {
      seen.set(k, m);
    }
  }
  return Array.from(seen.values()).sort(
    (a, b) => String(a.periodo || '').localeCompare(String(b.periodo || ''), 'es'),
  );
}

// ─── Tabla del boletín adaptada al plan (calificaciones + asistencia) ──────
// Deriva las columnas del plan (I/II/III, C1-C4, A1-A4, S1.., M1..) y, por
// cada asignatura, la nota de cada sub-periodo, la NOTA final y la asistencia
// (presentes/tardanzas/ausencias) por sub-periodo, calculadas en el cliente a
// partir de las fechas de evaluaciones y registros de asistencia.
export interface PlanTableRow {
  subjectName: string;
  grades: Record<string, number | null>; // por column.key
  final: number | null;
  attendance: Record<string, { present: number; late: number; absent: number }>;
}

export interface PlanTable {
  columns: PlanTableColumn[];
  rows: PlanTableRow[];
  /** Totales (vertical y horizontal) de las calificaciones mostradas:
   *  - `byColumn`: promedio de cada columna de periodo entre las asignaturas.
   *  - `overall`: promedio final (fila "PROMEDIO FINAL"). */
  totals: { byColumn: Record<string, number | null>; overall: number | null };
}

/**
 * Construye la tabla del boletín adaptada al plan y a la selección de periodos
 * del docente:
 *  - `selectedKeys`: sub-conjunto de columnas del plan a mostrar (vacío/ausente
 *    = todas). Las consultas (calificaciones y asistencia) se filtran por estos
 *    periodos, NO en Cloud Functions (regla: no tocar el backend).
 *  - `gradingWeight`: ponderación efectiva aplicada (política institucional:
 *    la institucional para miembros; ver gradingUtils.getEffectiveGradingWeight)
 *    usada para la nota de cada sub-periodo = suma ponderada de categorías
 *    (teórica/práctica/apreciativa) vía gradingUtils.weightedBreakdown.
 */
export function computePlanTable(
  regla: ReglaPlanBoletin,
  memberships: InstitutionalMembership[],
  opts?: { selectedKeys?: string[]; gradingWeight?: GradingWeight },
): PlanTable {
  const allColumns = tableColumnsForRegla(regla, memberships);
  const columns = opts?.selectedKeys?.length
    ? allColumns.filter((c) => opts.selectedKeys!.includes(c.key))
    : allColumns;
  const rows: PlanTableRow[] = memberships.map((m) => {
    const grades: PlanTableRow['grades'] = {};
    const attendance: PlanTableRow['attendance'] = {};
    // Evaluaciones agrupadas por columna (todas las del plan) para el mapeo
    // por fecha; solo se calculan las columnas seleccionadas.
    const evalByColumn: Record<string, Array<{ type?: string | null; scorePct?: number | null }>> = {};
    for (const c of allColumns) evalByColumn[c.key] = [];
    for (const ev of m.evaluations) {
      const k = columnKeyFromDate(regla, ev.date, allColumns);
      if (k && k in evalByColumn) evalByColumn[k].push(ev);
    }
    for (const c of columns) {
      grades[c.key] = null;
      attendance[c.key] = { present: 0, late: 0, absent: 0 };
    }
    for (const rec of m.attendanceRecords || []) {
      const k = columnKeyFromDate(regla, rec.date, allColumns);
      if (!k || !(k in attendance)) continue;
      const st = rec.status;
      if (st === 'present') attendance[k].present += 1;
      else if (st === 'late') attendance[k].late += 1;
      else if (st === 'absent') attendance[k].absent += 1;
    }
    for (const c of columns) {
      grades[c.key] = weightedBreakdown(evalByColumn[c.key], opts?.gradingWeight).final;
    }
    const scored = columns.map((c) => grades[c.key]).filter((v): v is number => v !== null);
    const final = scored.length > 0
      ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10
      : m.avgPct;
    return { subjectName: m.subjectName, grades, final, attendance };
  });

  // Resumen vertical (por columna) + horizontal (PROMEDIO FINAL).
  const byColumn: Record<string, number | null> = {};
  for (const c of columns) {
    const vals = rows.map((r) => r.grades[c.key]).filter((v): v is number => v !== null);
    byColumn[c.key] = vals.length > 0
      ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
      : null;
  }
  const finals = rows.map((r) => r.final).filter((v): v is number => v !== null);
  const overall = finals.length > 0
    ? Math.round((finals.reduce((a, b) => a + b, 0) / finals.length) * 10) / 10
    : null;

  return { columns, rows, totals: { byColumn, overall } };
}
