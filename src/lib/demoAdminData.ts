/**
 * demoAdminData.ts — Modo Demo del panel administrativo (VITE_DEMO_MODE=true).
 *
 * Genera un dataset mock determinista (PRNG con semilla) para probar
 * VISUALMENTE todas las vistas del panel admin (dashboard, métricas, alertas,
 * censo, discrepancias, boletín, onboarding) SIN Cloud Functions ni Firestore
 * reales. Ninguna función real cambia: adminApi.ts desvía aquí solo cuando
 * `VITE_DEMO_MODE === 'true'` (ver .env.demo → `vite --mode demo`).
 *
 * Las escrituras de configuración (periodos, planRules, gradingWeight,
 * schoolConfig) mutan un estado en memoria Y se persisten en localStorage
 * (`ediagil_demo_config`) para sobrevivir recargas y sesiones futuras del
 * demo. La lectura inicial prioriza lo persistido (con validación mínima de
 * forma); `resetDemoConfig()` borra la clave y vuelve a los defaults. En
 * builds normales este módulo NUNCA lee ni escribe esa clave.
 */

import type {
  AdminFilterParams,
  AdminTeacherListResponse,
  AdminTeacherDataResponse,
  AdminTeacherSummaryResponse,
  TeacherSummary,
  TeacherSubjectData,
  TeacherSubjectSummary,
  SummaryNote,
  SummaryMaterial,
  AdminSchoolConfigResponse,
  SchoolConfig,
  AdminSaveSchoolConfigInput,
  AdminSaveGradingWeightResponse,
  AdminSavePeriodosResponse,
  AdminSavePlanRulesResponse,
  GradingWeight,
  InstitutionPeriodos,
  PlanRules,
  StudentSearchResult,
  StudentMembership,
  AdminSearchStudentsResponse,
  BoletinEvaluation,
  BoletinMembership,
  BoletinObservation,
  AdminGetStudentBoletinResponse,
  StudentAIInsights,
  AdminGenerateStudentInsightsResponse,
  InstitutionStats,
  SubjectMetric,
  WeeklyActivity,
  TeacherActivity,
  InstitutionAlert,
  AdminInstitutionAlertsResponse,
  AdminGenerateInstitutionInsightsResponse,
  AdminInviteTeacherResponse,
  InstitutionalMetrics,
  InstitutionalRiskStudentRow,
  StudentRiskReport,
  TeacherPerformance,
  TeacherPerformanceParams,
  AdminExportData,
  AdminRestoreBackupResponse,
} from './adminApi';
import type { SearchStudentResponse, StudentSearchRow } from '../types/firestore';
import { calculateStudentRisk, generateRecommendations } from './riskCalculator';

export const IS_DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

export const DEMO_INSTITUTION_ID = 'demo-institution';

const DEMO_CONFIG_STORAGE_KEY = 'ediagil_demo_config';

// ── PRNG determinista ──────────────────────────────────────────────────────
function mulberry32(seed: number) {
  let t = seed;
  return function () {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rand: () => number, arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const randInt = (rand: () => number, min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

const isoDate = (ts: number) => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const normText = (s: string) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Búsqueda por tokens — espejo EXACTO de functions/lib/student-search.js y
// functions/index.js: normaliza la consulta (sin tildes, espacios colapsados)
// y exige que TODOS los tokens estén presentes como subcadena del hay.
// Insensible al orden ("Rodríguez María") y a espacios redundantes; NUNCA se
// construye un RegExp con la entrada del usuario.
const queryTokens = (q: string) =>
  normText(q).trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
const hayMatchesTokens = (hay: string, tokens: string[]) =>
  tokens.every((t) => hay.includes(t));

// ── Datos nominales ────────────────────────────────────────────────────────
const FIRST_M = ['Alejandro','Andrés','Carlos','Diego','Emilio','Fabián','Gabriel','Héctor','Ignacio','Javier','Luis','Marcos','Nicolás','Oscar','Pedro','Rafael','Santiago','Víctor','Samuel','Jorge','Eduardo','Francisco','Ricardo','Daniel','Miguel','Álvaro','Bruno','Cristian','David','Tomás'];
const FIRST_F = ['Ana','Bella','Camila','Daniela','Elena','Fernanda','Gabriela','Helena','Isabella','Julia','Karina','Lucía','María','Natalia','Olivia','Paula','Renata','Sofía','Valentina','Ximena','Andrea','Beatriz','Carolina','Diana','Estefanía','Gloria','Inés','Josefina','Laura','Mónica'];
const LAST = ['Álvarez','Blanco','Castillo','Cordero','Díaz','Escobar','Fernández','Gómez','Herrera','Iglesias','Jiménez','López','Mendoza','Núñez','Ortega','Pérez','Quintero','Ramírez','Salazar','Torres','Urdaneta','Vargas','Zambrano','Acosta','Benítez','Campos','Delgado','Estrada','Fuentes','Guerrero','Hernández','Lara','Molina','Navarro','Osorio','Rojas','Silva','Trujillo'];

const SUBJECT_NAMES = [
  'Matemáticas','Lengua y Literatura','Ciencias Naturales','Historia','Geografía','Inglés',
  'Educación Física','Química','Física','Biología','Arte y Cultura','Filosofía','Computación',
  'Ciencias Sociales','Contabilidad',
] as const;

const SUBJECT_COLORS = ['#ef4444','#f97316','#f59e0b','#84cc16','#22c55e','#06b6d4','#3b82f6','#6366f1','#a855f7','#ec4899'];
const PERIODOS = ['matutino', 'vespertino', 'nocturno'] as const;
const NIVELES = ['inicial', 'primaria', 'secundaria', 'universidad'] as const;
const SCHEDULES = ['Lunes y Miércoles 08:00','Martes y Jueves 10:00','Lunes, Miércoles y Viernes 07:00','Martes y Jueves 14:00','Lunes y Viernes 16:00','Miércoles y Viernes 18:00','Sábados 09:00'];
const EVAL_TITLES = ['Evaluación parcial','Prueba escrita','Trabajo práctico','Exposición','Prueba corta','Proyecto trimestral'];
const EVAL_TYPES = ['teorica','practica','apreciativa'] as const;

// ── Estructuras internas del dataset ───────────────────────────────────────
interface DemoTeacher { uid: string; displayName: string; email: string; plan: 'free' | 'pro' | 'school'; createdAt: number; lastActivity: number; }
interface DemoSubject { id: string; userId: string; name: string; color: string; teacher: string; schedule: string; periodo: string | null; nivelEducativo: string | null; plan: string; createdAt: number; }
interface DemoStudent { id: string; userId: string; subjectId: string; cedula: string; firstName: string; lastName: string; gender: 'M' | 'F'; }
interface DemoEvaluation { id: string; userId: string; subjectId: string; title: string; maxScore: number; date: string; type: string; }
interface DemoGrade { id: string; userId: string; subjectId: string; evaluationId: string; studentId: string; score: number; }
interface DemoAttendance { id: string; userId: string; subjectId: string; studentId: string; date: string; status: 'present' | 'absent' | 'late'; }
interface DemoObservation { id: string; userId: string; studentId: string; subjectId: string; period: string; text: string; updatedAt: number; }

interface DemoConfig {
  institutionId: string;
  name: string;
  schoolConfig: SchoolConfig;
  gradingWeight: GradingWeight;
  periodos: InstitutionPeriodos;
  planRules: PlanRules;
}

interface DemoDataset {
  teachers: DemoTeacher[];
  subjects: DemoSubject[];
  students: DemoStudent[];
  evaluations: DemoEvaluation[];
  grades: DemoGrade[];
  attendance: DemoAttendance[];
  observations: DemoObservation[];
}

// ── Generación del dataset ─────────────────────────────────────────────────
function generateDataset(): DemoDataset {
  const rand = mulberry32(20260814);
  const now = Date.now();
  const DAY = 86400000;

  const teachers: DemoTeacher[] = [];
  for (let i = 1; i <= 32; i++) {
    const first = pick(rand, i % 2 === 0 ? FIRST_F : FIRST_M);
    const last = pick(rand, LAST);
    const plan = i === 5 ? 'free' : i === 12 || i === 21 ? 'pro' : 'school';
    teachers.push({
      uid: `t${String(i).padStart(2, '0')}`,
      displayName: `${first} ${last}`,
      email: `${normText(first).replace(/\s/g, '')}.${normText(last)}@colegioaurora.edu.ve`,
      plan,
      createdAt: now - randInt(rand, 40, 400) * DAY,
      lastActivity: now - randInt(rand, 0, 45) * DAY,
    });
  }

  const subjects: DemoSubject[] = [];
  const nameIdx: Record<string, number> = {};
  let subSeq = 0;
  teachers.forEach((t, ti) => {
    const n = 1 + Math.floor(rand() * 3); // 1-3 asignaturas
    const used = new Set<string>();
    for (let k = 0; k < n; k++) {
      // Rota los 15 nombres para garantizar cobertura de todas las asignaturas.
      const name = SUBJECT_NAMES[(ti * 2 + k + subSeq) % SUBJECT_NAMES.length];
      subSeq++;
      if (used.has(name)) continue;
      used.add(name);
      nameIdx[name] = (nameIdx[name] || 0) + 1;
      const r = rand();
      const periodo = r < 0.5 ? 'matutino' : r < 0.8 ? 'vespertino' : 'nocturno';
      const rn = rand();
      const nivel = rn < 0.5 ? 'secundaria' : rn < 0.75 ? 'primaria' : rn < 0.9 ? 'universidad' : 'inicial';
      subjects.push({
        id: `sub${subjects.length + 1}`,
        userId: t.uid,
        name,
        color: pick(rand, SUBJECT_COLORS),
        teacher: t.displayName,
        schedule: pick(rand, SCHEDULES),
        periodo,
        nivelEducativo: nivel,
        plan: 'trimestral',
        createdAt: t.createdAt + randInt(rand, 1, 60) * DAY,
      });
    }
  });

  const students: DemoStudent[] = [];
  const evaluations: DemoEvaluation[] = [];
  const grades: DemoGrade[] = [];
  const attendance: DemoAttendance[] = [];
  let stuSeq = 0;

  const ensureSubject = (name: string, periodo: string, nivel: string, teacherIdx: number): DemoSubject => {
    const existing = subjects.find((s) => s.name === name && s.periodo === periodo && s.userId === teachers[teacherIdx].uid);
    if (existing) return existing;
    const t = teachers[teacherIdx];
    const created: DemoSubject = {
      id: `sub${subjects.length + 1}`,
      userId: t.uid,
      name,
      color: pick(rand, SUBJECT_COLORS),
      teacher: t.displayName,
      schedule: pick(rand, SCHEDULES),
      periodo,
      nivelEducativo: nivel,
      plan: 'trimestral',
      createdAt: now - randInt(rand, 30, 120) * DAY,
    };
    subjects.push(created);
    return created;
  };

  const addStudentMembership = (
    cedula: string, first: string, last: string, gender: 'M' | 'F', subjectId: string,
  ) => {
    stuSeq++;
    students.push({ id: `stu${stuSeq}`, userId: subjects.find((s) => s.id === subjectId)!.userId, subjectId, cedula, firstName: first, lastName: last, gender });
  };

  const addAcademicData = (subjectId: string) => {
    const subject = subjects.find((s) => s.id === subjectId)!;
    const subStudents = students.filter((s) => s.subjectId === subjectId);
    const evals: DemoEvaluation[] = [];
    for (let e = 0; e < 4; e++) {
      evals.push({
        id: `ev${evaluations.length + 1}`,
        userId: subject.userId,
        subjectId,
        title: EVAL_TITLES[randInt(rand, 0, EVAL_TITLES.length - 1)],
        maxScore: 100,
        date: isoDate(now - randInt(rand, 30, 330) * DAY),
        type: EVAL_TYPES[e % 3],
      });
      evaluations.push(evals[evals.length - 1]);
    }
    for (const st of subStudents) {
      for (const ev of evals) {
        grades.push({
          id: `gr${grades.length + 1}`,
          userId: subject.userId,
          subjectId,
          evaluationId: ev.id,
          studentId: st.id,
          score: randInt(rand, 30, 100),
        });
      }
      const records = 8 + randInt(rand, 0, 5);
      for (let a = 0; a < records; a++) {
        const r = rand();
        attendance.push({
          id: `at${attendance.length + 1}`,
          userId: subject.userId,
          subjectId,
          studentId: st.id,
          date: isoDate(now - randInt(rand, 0, 300) * DAY),
        status: r < 0.8 ? 'present' : r < 0.92 ? 'late' : 'absent',
        });
      }
    }
  };

  // Añade notas + asistencia a UN estudiante concreto dentro de una asignatura
  // que YA tiene evaluaciones (reuso de asignatura existente). Así el
  // "Estudiante Demo" aparece con calificaciones en el boletín sin duplicar
  // evaluaciones (addAcademicData no debe volver a ejecutarse en ese caso).
  const ensureStudentAcademicData = (cedula: string, subjectId: string) => {
    const subject = subjects.find((s) => s.id === subjectId)!;
    const st = students.find((s) => s.subjectId === subjectId && s.cedula === cedula);
    if (!st) return;
    const evals = evaluations.filter((e) => e.subjectId === subjectId);
    for (const ev of evals) {
      if (!grades.some((g) => g.evaluationId === ev.id && g.studentId === st.id)) {
        grades.push({
          id: `gr${grades.length + 1}`,
          userId: subject.userId,
          subjectId,
          evaluationId: ev.id,
          studentId: st.id,
          score: randInt(rand, 30, 100),
        });
      }
    }
    const records = 8 + randInt(rand, 0, 5);
    for (let a = 0; a < records; a++) {
      const r = rand();
      attendance.push({
        id: `at${attendance.length + 1}`,
        userId: subject.userId,
        subjectId,
        studentId: st.id,
        date: isoDate(now - randInt(rand, 0, 300) * DAY),
        status: r < 0.8 ? 'present' : r < 0.92 ? 'late' : 'absent',
      });
    }
  };

  // 1) Estudiantes normales: 3-7 por asignatura (total de personas > 100).
  subjects.forEach((sub) => {
    const k = randInt(rand, 3, 7);
    for (let s = 0; s < k; s++) {
      const isF = rand() < 0.5;
      addStudentMembership(
        `V-${20000000 + stuSeq * 7}`,
        pick(rand, isF ? FIRST_F : FIRST_M),
        pick(rand, LAST),
        isF ? 'F' : 'M',
        sub.id,
      );
    }
    addAcademicData(sub.id);
  });

  // 2) Personas "especiales" con discrepancias a propósito (cédulas fijas).
  const maria = ensureSubject('Matemáticas', 'matutino', 'secundaria', 0);
  addStudentMembership('V-11111111', 'María', 'Rodríguez', 'F', maria.id);
  const quimicaV = ensureSubject('Química', 'vespertino', 'secundaria', 1);
  addStudentMembership('V-11111111', 'María', 'Rodríguez', 'F', quimicaV.id);
  addAcademicData(maria.id);
  addAcademicData(quimicaV.id);

  const fisicaM = ensureSubject('Física', 'matutino', 'secundaria', 2);
  addStudentMembership('V-22222222', 'Luis', 'Pérez', 'M', fisicaM.id);
  const fisicaV = ensureSubject('Física', 'vespertino', 'secundaria', 3);
  addStudentMembership('V-22222222', 'Luis', 'Pérez', 'M', fisicaV.id);
  addAcademicData(fisicaM.id);
  addAcademicData(fisicaV.id);

  const inglesA = ensureSubject('Inglés', 'matutino', 'primaria', 4);
  addStudentMembership('V-33333333', 'Sofía', 'Gómez', 'F', inglesA.id);
  const inglesB = ensureSubject('Inglés', 'matutino', 'primaria', 5);
  addStudentMembership('V-33333333', 'Sofía', 'Gómez', 'F', inglesB.id);
  addAcademicData(inglesA.id);
  addAcademicData(inglesB.id);

  // 3) Docente multi-grado: "Prof. MultiGrado" (t33) con 4 secciones de la
  // misma asignatura. El esquema NO tiene campos "grado"/"sección": el grado y
  // la sección se representan en el NOMBRE de la asignatura ("Ciencias
  // Naturales 5A") con nivel 'primaria' (decisión documentada en AGENTS.md).
  teachers.push({
    uid: 't33',
    displayName: 'Prof. MultiGrado',
    email: 'prof.multigrado@colegioaurora.edu.ve',
    plan: 'school',
    createdAt: now - randInt(rand, 40, 400) * DAY,
    lastActivity: now - randInt(rand, 0, 45) * DAY,
  });
  const MULTIGRADO_SCHEDULES = [
    'Lunes y Miércoles 07:30',
    'Martes y Jueves 08:30',
    'Lunes, Miércoles y Viernes 09:30',
    'Martes y Viernes 10:30',
  ];
  for (let s = 0; s < 4; s++) {
    const name = `Ciencias Naturales 5${String.fromCharCode(65 + s)}`; // 5A, 5B, 5C, 5D
    const subj: DemoSubject = {
      id: `sub${subjects.length + 1}`,
      userId: 't33',
      name,
      color: pick(rand, SUBJECT_COLORS),
      teacher: 'Prof. MultiGrado',
      schedule: MULTIGRADO_SCHEDULES[s],
      periodo: 'matutino',
      nivelEducativo: 'primaria',
      plan: 'trimestral',
      createdAt: now - randInt(rand, 30, 120) * DAY,
    };
    subjects.push(subj);
    const k = randInt(rand, 3, 6); // 3-6 estudiantes por sección
    for (let st = 0; st < k; st++) {
      const isF = rand() < 0.5;
      addStudentMembership(
        `V-${20000000 + stuSeq * 7}`,
        pick(rand, isF ? FIRST_F : FIRST_M),
        pick(rand, LAST),
        isF ? 'F' : 'M',
        subj.id,
      );
    }
    addAcademicData(subj.id);
  }

  // 3b) Asignaturas INACTIVAS (sin alumnos matriculados) para el docente t01
  // (Santiago López): el detalle del docente las muestra en el grupo
  // "Asignaturas inactivas" dentro del periodo lectivo actual.
  const t01 = teachers[0];
  subjects.push({
    id: `sub${subjects.length + 1}`,
    userId: t01.uid,
    name: 'Dibujo Técnico',
    color: pick(rand, SUBJECT_COLORS),
    teacher: t01.displayName,
    schedule: 'Viernes 14:00',
    periodo: 'vespertino',
    nivelEducativo: 'secundaria',
    plan: 'trimestral',
    createdAt: now - 200 * DAY,
  });
  subjects.push({
    id: `sub${subjects.length + 1}`,
    userId: t01.uid,
    name: 'Educación Física',
    color: pick(rand, SUBJECT_COLORS),
    teacher: t01.displayName,
    schedule: 'Miércoles 10:00',
    periodo: 'matutino',
    nivelEducativo: 'primaria',
    plan: 'trimestral',
    createdAt: now - 150 * DAY,
  });

  // 4) "Estudiante Demo" (V-44444444): caso multi-docente LIMPIO (sin
  // discrepancias — los casos de detección ya están cubiertos arriba).
  // Pertenece a TRES asignaturas de TRES docentes distintos, todas en matutino:
  //   - Matemáticas (Santiago López, t01)  → reutiliza la creada en el paso 2.
  //   - Ciencias Naturales 5A (Prof. MultiGrado, t33) → sección del paso 3.
  //   - Historia (Carlos Fuentes, t09) → reutiliza/asegura la matutina.
  const demoMat = ensureSubject('Matemáticas', 'matutino', 'secundaria', 0);
  addStudentMembership('V-44444444', 'Estudiante', 'Demo', 'M', demoMat.id);
  const demoHist = ensureSubject('Historia', 'matutino', 'secundaria', 8);
  addStudentMembership('V-44444444', 'Estudiante', 'Demo', 'M', demoHist.id);
  const demoCN = ensureSubject('Ciencias Naturales 5A', 'matutino', 'primaria', 32);
  addStudentMembership('V-44444444', 'Estudiante', 'Demo', 'M', demoCN.id);
  // Si ensureSubject creó la asignatura nueva (sin evaluaciones), genera su
  // data académica ahora (el Estudiante Demo ya está inscrito en ella).
  // Las reutilizadas ya tienen evaluaciones: no se duplican.
  if (!evaluations.some((e) => e.subjectId === demoMat.id)) addAcademicData(demoMat.id);
  if (!evaluations.some((e) => e.subjectId === demoHist.id)) addAcademicData(demoHist.id);
  if (!evaluations.some((e) => e.subjectId === demoCN.id)) addAcademicData(demoCN.id);
  // Notas + asistencia del Estudiante Demo en cada asignatura (sin duplicar
  // las generadas por addAcademicData).
  ensureStudentAcademicData('V-44444444', demoMat.id);
  ensureStudentAcademicData('V-44444444', demoHist.id);
  ensureStudentAcademicData('V-44444444', demoCN.id);

  // 5) "Estudiante Integral": caso de CARGA (≈15 asignaturas en matutino) para
  // verificar que el boletín comprime a UNA página A4 sin romper el layout.
  const integralSubjects = subjects.filter((s) => s.periodo === 'matutino').slice(0, 15);
  for (const sub of integralSubjects) {
    addStudentMembership('V-55555555', 'Estudiante', 'Integral', 'M', sub.id);
    ensureStudentAcademicData('V-55555555', sub.id);
  }

  // Observaciones del boletín (boletín v2): el "Estudiante Demo" tiene una
  // observación GENERAL del docente consejero (subjectId '') y una por
  // asignatura en Matemáticas (t01) y Ciencias Naturales 5A (t33), todas en
  // el periodo 'III' (trimestral, mar-ago — la fecha demo es agosto 2026).
  const observations: DemoObservation[] = [];
  const demoObs = (
    userId: string, subjectId: string, text: string, offsetDays: number,
  ) => {
    const studentId = students.find(
      (s) => s.cedula === 'V-44444444' && (subjectId ? s.subjectId === subjectId : s.subjectId === demoMat.id),
    )?.id;
    if (!studentId) return;
    observations.push({
      id: `obs${observations.length + 1}`,
      userId,
      studentId,
      subjectId,
      period: 'III',
      text,
      updatedAt: now - offsetDays * DAY,
    });
  };
  demoObs('t01', '', 'Estudiante participativo y comprometido con sus responsabilidades académicas. Se recomienda reforzar la organización del tiempo de estudio.', 6);
  demoObs('t01', demoMat.id, 'Destaca en razonamiento lógico. Debe practicar más los problemas de aplicación.', 5);
  demoObs('t33', demoCN.id, 'Muy buena actitud en laboratorio. Entrega sus proyectos a tiempo.', 4);

  return { teachers, subjects, students, evaluations, grades, attendance, observations };
}

function buildInitialConfig(): DemoConfig {
  return {
    institutionId: DEMO_INSTITUTION_ID,
    name: 'Colegio Aurora Demo',
    schoolConfig: {
      logoUrl: '',
      slogan: 'Mentes que inspiran',
      directorName: 'Directora Elena Vargas',
      address: 'Av. 5 de Julio, Centro',
      phone: '0412-1234567',
      email: 'contacto@colegioaurora.edu.ve',
      primaryColor: '#1A3C40',
      onboardingDone: true,
    },
    gradingWeight: {
      mode: 'tradicional',
      weights: { teoria: 30, practica: 60, apreciativa: 10 },
      customWeights: {},
      applyTo: 'global',
    },
    periodos: {
      matutino: { activo: true, horarioInicio: '07:00', horarioFin: '12:00' },
      vespertino: { activo: true, horarioInicio: '13:00', horarioFin: '18:00' },
      nocturno: { activo: true, horarioInicio: '18:00', horarioFin: '22:00' },
    },
    planRules: { reglaSeleccionada: 'trimestral', recomendarADocentes: true },
  };
}

// Estado mutable, generado de forma perezosa: en producción (VITE_DEMO_MODE
// ausente) este módulo nunca genera el dataset ni reserva memoria. El dataset
// se genera una vez por sesión; la configuración se edita desde el onboarding
// y se PERSISTE en localStorage solo en modo demo (loadPersistedConfig y
// persistConfig son no-op si IS_DEMO_MODE es false, aunque el módulo ya es
// lazy: estas funciones solo se invocan vía los mocks de adminApi).
let _dataset: DemoDataset | null = null;
function getDataset(): DemoDataset {
  if (!_dataset) _dataset = generateDataset();
  return _dataset;
}

function loadPersistedConfig(): DemoConfig | null {
  if (!IS_DEMO_MODE) return null;
  try {
    const raw = localStorage.getItem(DEMO_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DemoConfig> | null;
    // Validación mínima de forma: deben existir la institución demo y las 4
    // secciones editables; el contenido profundo lo toleran los consumidores.
    if (
      !!parsed &&
      parsed.institutionId === DEMO_INSTITUTION_ID &&
      !!parsed.schoolConfig && typeof parsed.schoolConfig === 'object' &&
      !!parsed.gradingWeight && typeof parsed.gradingWeight === 'object' &&
      !!parsed.periodos && typeof parsed.periodos === 'object' &&
      !!parsed.planRules && typeof parsed.planRules === 'object'
    ) {
      return parsed as DemoConfig;
    }
  } catch {
    // JSON corrupto o storage bloqueado: se reconstruyen los defaults
  }
  return null;
}

function persistConfig(config: DemoConfig) {
  if (!IS_DEMO_MODE) return;
  try {
    localStorage.setItem(DEMO_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // cuota llena / modo privado: la sesión continúa solo en memoria
  }
}

let _config: DemoConfig | null = null;
function getConfig(): DemoConfig {
  if (!_config) _config = loadPersistedConfig() ?? buildInitialConfig();
  return _config;
}

// Borra la config persistida del demo y resetea la memoria: la próxima lectura
// reconstruye los defaults (usado por "Restaurar valores de demostración").
export function resetDemoConfig() {
  if (!IS_DEMO_MODE) return;
  try {
    localStorage.removeItem(DEMO_CONFIG_STORAGE_KEY);
  } catch {
    // storage bloqueado: el reset en memoria igual aplica para esta sesión
  }
  _config = null;
}

let _teacherById: Map<string, DemoTeacher> | null = null;
function getTeacherById() {
  if (!_teacherById) _teacherById = new Map(getDataset().teachers.map((t) => [t.uid, t]));
  return _teacherById;
}

let _subjectById: Map<string, DemoSubject> | null = null;
function getSubjectById() {
  if (!_subjectById) _subjectById = new Map(getDataset().subjects.map((s) => [s.id, s]));
  return _subjectById;
}

// ── Perfil de usuario demo (para usePlan / AuthProvider) ───────────────────
export const DEMO_PROFILE = {
  plan: 'school' as const,
  email: 'admin.demo@ediagil.com',
  displayName: 'Directora Demo',
  photoURL: null,
  createdAt: Date.now(),
  aiCallsThisMonth: 3,
  aiCallsResetAt: Date.now(),
  role: 'admin' as const,
  institutionId: DEMO_INSTITUTION_ID,
  institutionName: 'Colegio Aurora Demo',
  lastLoginAt: Date.now(),
  paymentProvider: 'lemonsqueezy',
  expiresAt: Date.now() + 365 * 86400000,
};

export function getDemoUser() {
  return {
    uid: 'demo-admin',
    email: DEMO_PROFILE.email,
    displayName: DEMO_PROFILE.displayName,
    photoURL: null,
    getIdToken: async () => 'demo-token',
  } as unknown as import('firebase/auth').User;
}

// Configuración institucional para useInstitution (nombre, logo, color,
// ponderación, periodos y reglas del plan) — refleja los cambios en memoria
// del onboarding.
export function getDemoInstitutionConfig() {
  const c = getConfig();
  return {
    name: c.name,
    logoUrl: c.schoolConfig.logoUrl,
    primaryColor: c.schoolConfig.primaryColor,
    gradingWeight: c.gradingWeight,
    periodos: c.periodos,
    planRules: c.planRules,
  };
}

// ── Helpers de filtrado y agregación ───────────────────────────────────────
const subjectMatchesFilters = (sub: DemoSubject | undefined, turno: AdminFilterParams['turno'], nivel: AdminFilterParams['nivelEducativo']) => {
  if (!sub) return false;
  if (turno && sub.periodo !== turno) return false;
  if (nivel && sub.nivelEducativo !== nivel) return false;
  return true;
};

const subjectStudents = (subjectId: string) => getDataset().students.filter((s) => s.subjectId === subjectId);
const subjectEvaluations = (subjectId: string) => getDataset().evaluations.filter((e) => e.subjectId === subjectId);
const subjectGrades = (subjectId: string) => getDataset().grades.filter((g) => g.subjectId === subjectId);
const subjectAttendance = (subjectId: string) => getDataset().attendance.filter((a) => a.subjectId === subjectId);

function teacherSummaryFor(t: DemoTeacher, filters?: AdminFilterParams): TeacherSummary {
  const subs = getDataset().subjects.filter((s) => s.userId === t.uid).filter((s) => subjectMatchesFilters(s, filters?.turno, filters?.nivelEducativo));
  const students = subs.flatMap((s) => subjectStudents(s.id));
  const evaluations = subs.flatMap((s) => subjectEvaluations(s.id));
  const grades = subs.flatMap((s) => subjectGrades(s.id));
  const attendance = subs.flatMap((s) => subjectAttendance(s.id));
  const periodos = { matutino: 0, vespertino: 0, nocturno: 0 };
  subs.forEach((s) => { if (s.periodo && s.periodo in periodos) periodos[s.periodo as keyof typeof periodos]++; });
  return {
    uid: t.uid,
    email: t.email,
    displayName: t.displayName,
    photoURL: null,
    plan: t.plan,
    createdAt: t.createdAt,
    lastActivity: t.lastActivity,
    periodos,
    counts: {
      subjects: subs.length,
      students: students.length,
      evaluations: evaluations.length,
      grades: grades.length,
      attendance: attendance.length,
    },
  };
}

function subjectSummary(sub: DemoSubject): TeacherSubjectSummary {
  const notes: SummaryNote[] = [
    { id: `${sub.id}-n1`, title: 'Plan de clase', date: isoDate(sub.createdAt), createdAt: sub.createdAt },
    { id: `${sub.id}-n2`, title: 'Registro de avance', date: isoDate(sub.createdAt + 15 * 86400000), createdAt: sub.createdAt + 15 * 86400000 },
  ];
  const materials: SummaryMaterial[] = [
    { id: `${sub.id}-m1`, title: 'Guía de estudio', type: 'document', date: isoDate(sub.createdAt + 5 * 86400000) },
  ];
  return {
    id: sub.id,
    name: sub.name,
    color: sub.color,
    teacher: sub.teacher,
    schedule: sub.schedule,
    periodo: sub.periodo,
    nivelEducativo: sub.nivelEducativo,
    plan: sub.plan,
    createdAt: sub.createdAt,
    students: subjectStudents(sub.id),
    subjectModules: [],
    evaluations: subjectEvaluations(sub.id),
    grades: subjectGrades(sub.id),
    attendance: subjectAttendance(sub.id),
    notes,
    noteCount: notes.length,
    materials,
    calendarEvents: [],
  };
}

function subjectData(sub: DemoSubject): TeacherSubjectData {
  return {
    id: sub.id,
    name: sub.name,
    color: sub.color,
    teacher: sub.teacher,
    schedule: sub.schedule,
    periodo: sub.periodo,
    nivelEducativo: sub.nivelEducativo,
    plan: sub.plan,
    createdAt: sub.createdAt,
    students: subjectStudents(sub.id),
    subjectModules: [],
    evaluations: subjectEvaluations(sub.id),
    grades: subjectGrades(sub.id),
    attendance: subjectAttendance(sub.id),
    notes: subjectSummary(sub).notes,
    materials: subjectSummary(sub).materials,
    calendarEvents: [],
  };
}

// Agrupa personas por cédula (o nombre+apellido si no hay cédula).
interface DemoPerson {
  studentId: string;
  cedula: string;
  firstName: string;
  lastName: string;
  gender: 'M' | 'F' | null;
  memberships: StudentMembership[];
}

function groupPersons(): Map<string, DemoPerson> {
  const byPerson = new Map<string, DemoPerson>();
  for (const st of getDataset().students) {
    const key = String(st.cedula || '').trim() || `${normText(st.firstName)}|${normText(st.lastName)}`;
    let person = byPerson.get(key);
    if (!person) {
      person = { studentId: st.id, cedula: st.cedula, firstName: st.firstName, lastName: st.lastName, gender: st.gender, memberships: [] };
      byPerson.set(key, person);
    }
    const sub = getSubjectById().get(st.subjectId);
    const t = sub ? getTeacherById().get(sub.userId) : undefined;
    if (person.memberships.some((m) => m.subjectId === st.subjectId && m.teacherUid === (sub?.userId || ''))) continue;
    person.memberships.push({
      studentDocId: st.id,
      subjectId: st.subjectId,
      subjectName: sub ? sub.name : 'Sin nombre',
      periodo: sub ? sub.periodo || null : null,
      nivelEducativo: sub ? sub.nivelEducativo || null : null,
      teacherUid: sub ? sub.userId : '',
      teacherName: t ? t.displayName : 'Docente',
    });
  }
  return byPerson;
}

// ── API mock ───────────────────────────────────────────────────────────────
// Deriva grado/sección desde el nombre de asignatura (espejo local para evitar
// importar institutionalReport.ts y generar una dependencia circular con
// adminApi.ts; misma lógica que el frontend deriveGradoSeccion).
const GRADO_RE = /(\d{1,2})\s*(?:er|do|to|ro|°|º)?\.?\s*(año|grado|curso)?\.?\s*([a-zA-Z])?\b/i;
function deriveGradoSeccion(subjectName: string): { grado: string | null; seccion: string | null } {
  if (!subjectName) return { grado: null, seccion: null };
  const parts = subjectName.split(/\s*(?:—|–|-)\s*/).map((p) => p.trim()).filter(Boolean);
  const target = parts.length > 1 ? parts[parts.length - 1] : subjectName;
  const m = target.match(GRADO_RE);
  if (!m) return { grado: null, seccion: null };
  const n = parseInt(m[1], 10);
  const word = (m[2] || 'año').replace(/^./, (c) => c.toUpperCase());
  const ordinal = n === 1 ? '1er' : n === 2 ? '2do' : n === 3 ? '3er' : `${n}to`;
  return { grado: `${ordinal} ${word}`, seccion: m[3] ? m[3].toUpperCase() : null };
}

export function getDemoAdminApi() {
  const api: {
    adminListTeachers(filters?: AdminFilterParams): Promise<AdminTeacherListResponse>;
    adminGetTeacherData(uid: string, filters?: AdminFilterParams): Promise<AdminTeacherDataResponse>;
    adminGetTeacherSummary(uid: string, filters?: AdminFilterParams): Promise<AdminTeacherSummaryResponse>;
    adminGetSchoolConfig(): Promise<AdminSchoolConfigResponse>;
    adminSaveSchoolConfig(input: AdminSaveSchoolConfigInput): Promise<AdminSchoolConfigResponse>;
    adminSaveGradingWeight(input: GradingWeight): Promise<AdminSaveGradingWeightResponse>;
    adminSavePeriodos(input: InstitutionPeriodos): Promise<AdminSavePeriodosResponse>;
    adminSavePlanRules(input: PlanRules): Promise<AdminSavePlanRulesResponse>;
    adminSearchStudents(q: string, filters?: AdminFilterParams): Promise<AdminSearchStudentsResponse>;
    searchStudent(query: string): Promise<SearchStudentResponse>;
    adminGetStudentBoletin(studentId: string, periodo?: string | null): Promise<AdminGetStudentBoletinResponse>;
    adminGenerateStudentInsights(studentId: string): Promise<AdminGenerateStudentInsightsResponse>;
    adminGetInstitutionStats(filters?: AdminFilterParams): Promise<InstitutionStats>;
    adminGetInstitutionAlerts(filters?: AdminFilterParams): Promise<AdminInstitutionAlertsResponse>;
    adminGenerateInstitutionInsights(filters?: AdminFilterParams): Promise<AdminGenerateInstitutionInsightsResponse>;
    adminInviteTeacher(email: string): Promise<AdminInviteTeacherResponse>;
    getInstitutionalMetrics(filters?: AdminFilterParams): Promise<InstitutionalMetrics>;
    getStudentRiskReport(studentId: string): Promise<StudentRiskReport>;
    getTeacherPerformance(input: TeacherPerformanceParams): Promise<TeacherPerformance>;
    adminRestoreInstitutionBackup(payload: AdminExportData): Promise<AdminRestoreBackupResponse>;
  } = {
    async adminListTeachers(filters) {
      const teachers = getDataset().teachers
        .map((t) => teacherSummaryFor(t, filters))
        .filter((t) => (filters?.turno || filters?.nivelEducativo) ? t.counts.subjects > 0 : true);
      return { institutionId: DEMO_INSTITUTION_ID, teachers };
    },

    async adminGetTeacherData(uid, filters) {
      const t = getTeacherById().get(uid);
      const teacher = {
        uid,
        email: t?.email || '',
        displayName: t?.displayName || 'Docente',
        institutionId: DEMO_INSTITUTION_ID,
        institutionName: getConfig().name,
      };
      const subjects = getDataset().subjects.filter((s) => s.userId === uid).filter((s) => subjectMatchesFilters(s, filters?.turno, filters?.nivelEducativo)).map(subjectData);
      return { teacher, schoolConfig: getConfig().schoolConfig, settings: {}, subjects };
    },

    async adminGetTeacherSummary(uid, filters) {
      const t = getTeacherById().get(uid);
      const teacher = {
        uid,
        email: t?.email || '',
        displayName: t?.displayName || 'Docente',
        institutionId: DEMO_INSTITUTION_ID,
        institutionName: getConfig().name,
      };
      const subjects = getDataset().subjects.filter((s) => s.userId === uid).filter((s) => subjectMatchesFilters(s, filters?.turno, filters?.nivelEducativo)).map(subjectSummary);
      return { teacher, settings: {}, subjects };
    },

    async adminGetSchoolConfig() {
      return {
        institutionId: DEMO_INSTITUTION_ID,
        institutionName: getConfig().name,
        schoolConfig: getConfig().schoolConfig,
        gradingWeight: getConfig().gradingWeight,
        periodos: getConfig().periodos,
        planRules: getConfig().planRules,
      };
    },

    async adminSaveSchoolConfig(input) {
      getConfig().name = input.name?.trim() || getConfig().name;
      getConfig().schoolConfig = {
        ...getConfig().schoolConfig,
        logoUrl: input.logoUrl ?? getConfig().schoolConfig.logoUrl,
        slogan: input.slogan ?? getConfig().schoolConfig.slogan,
        directorName: input.directorName ?? getConfig().schoolConfig.directorName,
        address: input.address ?? getConfig().schoolConfig.address,
        phone: input.phone ?? getConfig().schoolConfig.phone,
        email: input.email ?? getConfig().schoolConfig.email,
        primaryColor: input.primaryColor ?? getConfig().schoolConfig.primaryColor,
        onboardingDone: true,
      };
      persistConfig(getConfig());
      return {
        institutionId: DEMO_INSTITUTION_ID,
        institutionName: getConfig().name,
        schoolConfig: getConfig().schoolConfig,
        gradingWeight: getConfig().gradingWeight,
        periodos: getConfig().periodos,
        planRules: getConfig().planRules,
      };
    },

    async adminSaveGradingWeight(input) {
      // Auditoría ligera espejo del backend: snapshot previo + quién guardó.
      const prev = getConfig().gradingWeight;
      if (prev && typeof prev === 'object') {
        const { updatedAt: _u, updatedBy: _b, previousWeight: _p, ...snapshot } = prev;
        getConfig().gradingWeight = { ...input, updatedAt: Date.now(), updatedBy: 'demo-admin', previousWeight: snapshot };
      } else {
        getConfig().gradingWeight = { ...input, updatedAt: Date.now(), updatedBy: 'demo-admin' };
      }
      persistConfig(getConfig());
      return { institutionId: DEMO_INSTITUTION_ID, gradingWeight: getConfig().gradingWeight };
    },

    async adminSavePeriodos(input) {
      getConfig().periodos = input;
      persistConfig(getConfig());
      return { institutionId: DEMO_INSTITUTION_ID, periodos: getConfig().periodos };
    },

    async adminSavePlanRules(input) {
      getConfig().planRules = input;
      persistConfig(getConfig());
      return { institutionId: DEMO_INSTITUTION_ID, planRules: getConfig().planRules };
    },

    // DECISIÓN DE DISEÑO (idéntica al backend): el respaldo es un export
    // ANALÍTICO; solo la config institucional es fiable para restaurar.
    // teacherDetails son agregados calculados (pueden venir incompletos por
    // fetches fallidos o filtros) y NO se restauran → skipped + warnings.
    async adminRestoreInstitutionBackup(payload) {
      const c = getConfig();
      const restored: Record<string, number> = {};
      const warnings: string[] = [];
      const skipped: string[] = [];
      if (typeof payload.institutionName === 'string' && payload.institutionName.trim()) {
        c.name = payload.institutionName.trim();
        restored.name = 1;
      }
      if (payload.schoolConfig && typeof payload.schoolConfig === 'object') {
        c.schoolConfig = { ...c.schoolConfig, ...payload.schoolConfig, onboardingDone: true };
        restored.schoolConfig = 1;
      }
      if (payload.gradingWeight && typeof payload.gradingWeight === 'object') {
        // Espejo del backend: una ponderación inválida (no suma 100 o datos
        // corruptos) se OMITE con aviso exacto y la restauración continúa.
        const gw = payload.gradingWeight as { mode?: unknown; weights?: unknown; customWeights?: unknown };
        let valid = false;
        if (gw.mode === 'tradicional' || gw.mode === 'competencias') {
          const w = gw.weights as { teoria?: unknown; practica?: unknown; apreciativa?: unknown } | undefined;
          valid = !!w
            && typeof w.teoria === 'number' && Number.isFinite(w.teoria) && w.teoria >= 0 && w.teoria <= 100
            && typeof w.practica === 'number' && Number.isFinite(w.practica) && w.practica >= 0 && w.practica <= 100
            && typeof w.apreciativa === 'number' && Number.isFinite(w.apreciativa) && w.apreciativa >= 0 && w.apreciativa <= 100
            && Math.abs(w.teoria + w.practica + w.apreciativa - 100) < 0.01;
        } else if (gw.mode === 'personalizada' && gw.customWeights && typeof gw.customWeights === 'object') {
          const vals = Object.entries(gw.customWeights as Record<string, unknown>)
            .filter(([k, v]) => typeof k === 'string' && k.trim() && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100);
          valid = vals.length >= 2
            && Math.abs(vals.reduce((acc, [, v]) => acc + (v as number), 0) - 100) < 0.01;
        }
        if (valid) {
          c.gradingWeight = { ...(payload.gradingWeight as DemoConfig['gradingWeight']) };
          restored.gradingWeight = 1;
        } else {
          warnings.push('La ponderación académica del respaldo es inválida y fue omitida.');
          skipped.push('gradingWeight');
        }
      } else {
        skipped.push('gradingWeight');
      }
      if (payload.periodos && typeof payload.periodos === 'object') {
        c.periodos = { ...payload.periodos };
        restored.periodos = 1;
      }
      if (payload.planRules && typeof payload.planRules === 'object') {
        c.planRules = { ...payload.planRules };
        restored.planRules = 1;
      }
      persistConfig(c);
      skipped.push('metrics', 'alerts', 'teachers', 'teacherDetails', 'students', 'discrepancies', 'stats', 'insights');
      if (skipped.length && Object.keys(restored).length === 0) {
        warnings.push('El respaldo no contenía configuración restaurable.');
      }
      return {
        institutionId: DEMO_INSTITUTION_ID,
        institutionName: c.name,
        restored,
        skipped,
        warnings,
        schoolConfig: c.schoolConfig,
        gradingWeight: c.gradingWeight,
        periodos: c.periodos,
        planRules: c.planRules,
      };
    },

    async adminSearchStudents(q, filters) {
      const nq = normText(q.trim());
      if (nq.length < 2) throw new Error('Escribe al menos 2 caracteres para buscar.');
      const tokens = queryTokens(q);
      const byPerson = groupPersons();
      const students: StudentSearchResult[] = [];
      for (const person of byPerson.values()) {
        const memberships = person.memberships.filter((m) => {
          const sub = getSubjectById().get(m.subjectId);
          return subjectMatchesFilters(sub, filters?.turno, filters?.nivelEducativo);
        });
        if (filters?.turno || filters?.nivelEducativo) {
          if (memberships.length === 0) continue;
        }
        const hay = normText([person.firstName, person.lastName, person.cedula, ...memberships.flatMap((m) => [m.subjectName, m.periodo || ''])].join(' '));
        if (hayMatchesTokens(hay, tokens)) students.push({ ...person, memberships });
      }
      const total = students.length;
      if (students.length > 50) students.length = 50;
      return { students, total };
    },

    async searchStudent(query) {
      const nq = normText(query.trim());
      if (nq.length < 2) throw new Error('Escribe al menos 2 caracteres para buscar.');
      const tokens = queryTokens(query);
      const limit = 50;
      const byPerson = groupPersons();
      const matches = [];
      for (const person of byPerson.values()) {
        const hay = normText([person.firstName, person.lastName, person.cedula].join(' '));
        if (hayMatchesTokens(hay, tokens)) matches.push(person);
      }
      const rows: StudentSearchRow[] = [];
      for (const person of matches) {
        const periodos = new Set(person.memberships.map((m) => m.periodo).filter(Boolean));
        const subjectPeriodos = new Map<string, Set<string>>();
        const subjectCounts = new Map<string, number>();
        for (const m of person.memberships) {
          const k = normText(m.subjectName);
          if (!subjectPeriodos.has(k)) subjectPeriodos.set(k, new Set());
          if (m.periodo) subjectPeriodos.get(k).add(m.periodo);
          subjectCounts.set(k, (subjectCounts.get(k) || 0) + 1);
        }
        const enVarios = periodos.size > 1;
        const sujetosEnVarios = new Set(Array.from(subjectPeriodos.entries()).filter(([, ps]) => ps.size > 1).map(([k]) => k));
        const duplicados = new Set(Array.from(subjectCounts.entries()).filter(([, c]) => c > 1).map(([k]) => k));
        for (const m of person.memberships) {
          const k = normText(m.subjectName);
          const discrepancias: string[] = [];
          if (enVarios) discrepancias.push('Asignado a varios periodos');
          if (sujetosEnVarios.has(k)) discrepancias.push('Misma asignatura en varios periodos');
          if (duplicados.has(k)) discrepancias.push('Matrícula duplicada en la misma asignatura');
          rows.push({
            studentId: person.studentId,
            nombreCompleto: `${person.firstName} ${person.lastName}`.trim(),
            cedula: person.cedula,
            asignatura: m.subjectName,
            docente: m.teacherName,
            grado: (getSubjectById().get(m.subjectId)?.nivelEducativo) || '',
            periodo: m.periodo || '',
            estado: discrepancias.length > 0 ? 'inactivo' : 'activo',
            discrepancias,
            subjectId: m.subjectId,
            teacherUid: m.teacherUid,
          });
        }
      }
      const total = rows.length;
      return { query, total, limit, students: rows.slice(0, limit) };
    },

    async adminGetStudentBoletin(studentId, periodo) {
      const person = Array.from(groupPersons().values()).find((p) =>
        p.memberships.some((m) => m.studentDocId === studentId),
      );
      if (!person) {
        return { student: { studentId, cedula: '', firstName: 'Estudiante', lastName: 'Demo', gender: null }, institutionName: getConfig().name, schoolConfig: getConfig().schoolConfig, memberships: [] };
      }
      const inPeriodo = (date: string | null | undefined): boolean => {
        if (!periodo || periodo === 'anual') return true;
        const m = String(date || '').slice(0, 10).match(/^(\d{4})-(\d{2})/);
        if (!m) return false;
        const mes = parseInt(m[2], 10);
        if (periodo === 'I') return mes >= 9 && mes <= 11;
        if (periodo === 'II') return mes === 12 || mes <= 2;
        if (periodo === 'C1') return mes >= 9 || mes <= 2;
        if (periodo === 'C2') return mes >= 3 && mes <= 8;
        return true;
      };
      const memberships: BoletinMembership[] = person.memberships.map((m) => {
        const sub = getSubjectById().get(m.subjectId);
        const evals = subjectEvaluations(m.subjectId).filter((e) => inPeriodo(e.date));
        const att = subjectAttendance(m.subjectId).filter((a) => a.studentId === m.studentDocId && inPeriodo(a.date));
        const evaluations: BoletinEvaluation[] = evals.map((e) => {
          const g = getDataset().grades.find((x) => x.evaluationId === e.id && x.studentId === m.studentDocId);
          return {
            evaluationId: e.id,
            title: e.title,
            type: e.type,
            maxScore: e.maxScore,
            date: e.date,
            score: g ? g.score : null,
            scorePct: g ? Math.round((g.score / e.maxScore) * 1000) / 10 : null,
          };
        });
        const withScore = evaluations.filter((e) => e.scorePct != null);
        const avgPct = withScore.length > 0
          ? Math.round((withScore.reduce((acc, e) => acc + (e.scorePct as number), 0) / withScore.length) * 10) / 10
          : null;
        const present = att.filter((a) => a.status === 'present').length;
        const late = att.filter((a) => a.status === 'late').length;
        const absent = att.filter((a) => a.status === 'absent').length;
        const total = att.length;
        return {
          subjectId: m.subjectId,
          subjectName: m.subjectName,
          periodo: m.periodo,
          teacherUid: m.teacherUid,
          teacherName: m.teacherName,
          evaluations,
          avgPct,
          attendance: { present, late, absent, total, pct: total > 0 ? Math.round((present / total) * 1000) / 10 : null },
          attendanceRecords: att.map((a) => ({ date: a.date, status: a.status })),
        };
      });
      // Observaciones del boletín (espejo del backend): TODAS las de los
      // student docs de la persona, enriquecidas con autor y asignatura.
      const studentDocIds = new Set(person.memberships.map((m) => m.studentDocId));
      const subjectNameById = new Map(memberships.map((m) => [m.subjectId, m.subjectName]));
      const teacherNameById = new Map(person.memberships.map((m) => [m.teacherUid, m.teacherName]));
      const observations: BoletinObservation[] = getDataset().observations
        .filter((o) => studentDocIds.has(o.studentId))
        .map((o) => ({
          id: o.id,
          authorUid: o.userId,
          authorName: teacherNameById.get(o.userId) || 'Docente',
          subjectId: o.subjectId,
          subjectName: (o.subjectId && subjectNameById.get(o.subjectId)) || '',
          period: o.period,
          text: o.text,
          updatedAt: o.updatedAt,
        }))
        .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
      return {
        student: { studentId: person.studentId, cedula: person.cedula, firstName: person.firstName, lastName: person.lastName, gender: person.gender },
        institutionName: getConfig().name,
        schoolConfig: getConfig().schoolConfig,
        memberships,
        observations,
      };
    },

    async adminGenerateStudentInsights(studentId) {
      const boletin = await api.adminGetStudentBoletin(studentId);
      const scored = boletin.memberships.flatMap((m) => m.evaluations.filter((e) => e.scorePct != null));
      const avg = scored.length > 0 ? scored.reduce((a, e) => a + (e.scorePct as number), 0) / scored.length : 0;
      const insights: StudentAIInsights = {
        resumen: avg >= 75
          ? `Rendimiento sólido en ${boletin.memberships.length} asignatura(s): promedio ${Math.round(avg)}%.`
          : avg >= 60
            ? `Rendimiento aceptable con margen de mejora: promedio ${Math.round(avg)}%.`
            : `Rendimiento bajo: promedio ${Math.round(avg)}%. Se recomienda acompañamiento pedagógico.`,
        fortalezas: avg >= 75 ? ['Consistencia en evaluaciones teóricas', 'Participación activa en clase'] : ['Asistencia regular', 'Entrega de trabajos'],
        areasDeMejora: avg < 70 ? ['Reforzar contenidos con menor dominio', 'Manejo del tiempo en evaluaciones'] : ['Profundizar en temas avanzados'],
        recomendaciones: [
          'Realizar repasos guiados con ejercicios prácticos',
          'Revisar junto al docente los resultados de cada evaluación',
          'Establecer una rutina de estudio semanal',
        ],
      };
      return {
        student: boletin.student,
        institutionName: getConfig().name,
        schoolConfig: getConfig().schoolConfig,
        insights,
      };
    },

    async adminGetInstitutionStats(filters) {
      const subs = getDataset().subjects.filter((s) => subjectMatchesFilters(s, filters?.turno, filters?.nivelEducativo));
      const teachers = getDataset().teachers.filter((t) => subs.some((s) => s.userId === t.uid));
      const students = subs.flatMap((s) => subjectStudents(s.id));
      const evals = subs.flatMap((s) => subjectEvaluations(s.id));
      const grades = subs.flatMap((s) => subjectGrades(s.id));
      const att = subs.flatMap((s) => subjectAttendance(s.id));

      const byPlan = { free: 0, pro: 0, school: 0 };
      teachers.forEach((t) => { byPlan[t.plan]++; });

      const present = att.filter((a) => a.status === 'present').length;
      const late = att.filter((a) => a.status === 'late').length;
      const absent = att.filter((a) => a.status === 'absent').length;
      const attTotal = att.length;

      const scorePcts = grades.map((g) => { const e = getDataset().evaluations.find((x) => x.id === g.evaluationId); return e && e.maxScore > 0 ? (g.score / e.maxScore) * 100 : 0; });
      const avgPct = scorePcts.length > 0 ? Math.round((scorePcts.reduce((a, b) => a + b, 0) / scorePcts.length) * 10) / 10 : null;

      const subjectStats: SubjectMetric[] = subs.map((s) => {
        const sGrades = subjectGrades(s.id);
        const sAtt = subjectAttendance(s.id);
        const pcts = sGrades.map((g) => { const e = getDataset().evaluations.find((x) => x.id === g.evaluationId); return e && e.maxScore > 0 ? (g.score / e.maxScore) * 100 : 0; });
        const presentCount = sAtt.filter((a) => a.status === 'present').length;
        const lateCount = sAtt.filter((a) => a.status === 'late').length;
        const absentCount = sAtt.filter((a) => a.status === 'absent').length;
        const t = getTeacherById().get(s.userId);
        return {
          subjectId: s.id,
          subjectName: s.name,
          teacherName: t?.displayName || s.teacher,
          periodo: s.periodo,
          nivelEducativo: s.nivelEducativo,
          students: subjectStudents(s.id).length,
          evaluations: subjectEvaluations(s.id).length,
          evaluationsWithGrades: new Set(sGrades.map((g) => g.evaluationId)).size,
          evaluationsWithoutGrades: subjectEvaluations(s.id).length - new Set(sGrades.map((g) => g.evaluationId)).size,
          attendanceTotal: sAtt.length,
          attendancePresent: presentCount,
          attendanceLate: lateCount,
          attendanceAbsent: absentCount,
          attendanceRate: sAtt.length > 0 ? Math.round((presentCount / sAtt.length) * 1000) / 10 : 0,
          avgPct: pcts.length > 0 ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : null,
        };
      });

      const now = Date.now();
      const weekStart = (offset: number) => { const d = new Date(now - offset * 7 * 86400000); d.setHours(0, 0, 0, 0); return d.getTime(); };
      const weeklyActivity: WeeklyActivity[] = [];
      for (let w = 7; w >= 0; w--) {
        const from = weekStart(w + 1);
        const to = weekStart(w);
        const inRange = (ts: string) => { const d = new Date(ts + 'T12:00:00').getTime(); return d >= from && d < to + 86400000; };
        const sessions = new Set(att.filter((a) => inRange(a.date)).map((a) => `${a.subjectId}|${a.date}`)).size;
        weeklyActivity.push({
          week: `Semana ${8 - w}`,
          sessions,
          evaluations: evals.filter((e) => inRange(e.date)).length,
          notes: Math.floor(1 + randInt(Math.random, 0, 3)),
          materials: Math.floor(randInt(Math.random, 0, 2)),
          events: Math.floor(randInt(Math.random, 0, 2)),
        });
      }

      const teacherActivity: TeacherActivity[] = teachers.map((t) => ({
        uid: t.uid,
        displayName: t.displayName,
        plan: t.plan,
        lastActivity: t.lastActivity,
        active7d: now - t.lastActivity < 7 * 86400000,
        active30d: now - t.lastActivity < 30 * 86400000,
        aiCallsThisMonth: randInt(Math.random, 0, 6),
        subjects: subs.filter((s) => s.userId === t.uid).length,
        students: subs.filter((s) => s.userId === t.uid).flatMap((s) => subjectStudents(s.id)).length,
        evaluations: subs.filter((s) => s.userId === t.uid).flatMap((s) => subjectEvaluations(s.id)).length,
        attendanceCount: subs.filter((s) => s.userId === t.uid).flatMap((s) => subjectAttendance(s.id)).length,
        gradesCount: subs.filter((s) => s.userId === t.uid).flatMap((s) => subjectGrades(s.id)).length,
      }));

      return {
        generatedAt: now,
        institutionId: DEMO_INSTITUTION_ID,
        totals: {
          teachers: teachers.length,
          subjects: subs.length,
          students: students.length,
          evaluations: evals.length,
          gradesCount: grades.length,
          attendanceCount: att.length,
          sessions: new Set(att.map((a) => `${a.subjectId}|${a.date}`)).size,
        },
        byPlan,
        attendance: { present, late, absent, total: attTotal, passRate: attTotal > 0 ? Math.round((present / attTotal) * 1000) / 10 : 0 },
        grades: { count: grades.length, avgPct },
        subjectStats,
        weeklyActivity,
        teachers: teacherActivity,
        aiUsage: { callsThisMonth: teacherActivity.reduce((a, t) => a + t.aiCallsThisMonth, 0), teachersWithUsage: teacherActivity.filter((t) => t.aiCallsThisMonth > 0).length },
      };
    },

    async adminGetInstitutionAlerts(filters) {
      const subs = getDataset().subjects.filter((s) => subjectMatchesFilters(s, filters?.turno, filters?.nivelEducativo));
      const alerts: InstitutionAlert[] = [];
      let alertIdx = 0;
      const push = (a: Omit<InstitutionAlert, 'id'>) => { alerts.push({ ...a, id: `alert-${alertIdx++}` }); };

      // Alertas de grupo (notas bajas).
      for (const s of subs) {
        const sGrades = subjectGrades(s.id);
        const pcts = sGrades.map((g) => { const e = getDataset().evaluations.find((x) => x.id === g.evaluationId); return e && e.maxScore > 0 ? (g.score / e.maxScore) * 100 : 0; });
        if (pcts.length >= 3) {
          const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
          if (avg < 60) {
            const t = getTeacherById().get(s.userId);
            push({
              type: 'group_grades',
              severity: avg < 50 ? 'critical' : 'warning',
              subjectId: s.id,
              subjectName: s.name,
              teacherUid: s.userId,
              teacherName: t?.displayName || s.teacher,
              periodo: s.periodo,
              nivelEducativo: s.nivelEducativo,
              studentId: null,
              studentName: null,
              cedula: null,
              gradedCount: pcts.length,
              avgPct: Math.round(avg * 10) / 10,
              attendanceTotal: null,
              attendancePct: null,
              lastActivity: null,
              message: `Promedio del grupo ${Math.round(avg)}% en ${s.name}.`,
            });
          }
        }
      }

      // Alertas por estudiante (notas y asistencia) + docentes inactivos.
      const byPerson = groupPersons();
      let personAlerts = 0;
      for (const person of byPerson.values()) {
        if (personAlerts >= 20) break;
        const scored: { pct: number }[] = [];
        let attTotal = 0;
        let attPresent = 0;
        for (const m of person.memberships) {
          if (!subs.some((s) => s.id === m.subjectId)) continue;
          for (const g of getDataset().grades.filter((x) => x.subjectId === m.subjectId && x.studentId === m.studentDocId)) {
            const e = getDataset().evaluations.find((x) => x.id === g.evaluationId);
            if (e && e.maxScore > 0) scored.push({ pct: (g.score / e.maxScore) * 100 });
          }
          const att = getDataset().attendance.filter((a) => a.subjectId === m.subjectId && a.studentId === m.studentDocId);
          attTotal += att.length;
          attPresent += att.filter((a) => a.status === 'present').length;
        }
        if (scored.length >= 2) {
          const avg = scored.reduce((a, b) => a + b.pct, 0) / scored.length;
          if (avg < 60) {
            personAlerts++;
            push({
              type: 'student_grades',
              severity: avg < 50 ? 'critical' : 'warning',
              subjectId: null,
              subjectName: null,
              teacherUid: null,
              teacherName: null,
              periodo: null,
              studentId: person.studentId,
              studentName: `${person.firstName} ${person.lastName}`,
              cedula: person.cedula,
              gradedCount: scored.length,
              avgPct: Math.round(avg * 10) / 10,
              attendanceTotal: null,
              attendancePct: null,
              lastActivity: null,
              message: `Promedio ${Math.round(avg)}% en ${scored.length} evaluaciones.`,
            });
          }
        }
        if (attTotal >= 3) {
          const pct = Math.round((attPresent / attTotal) * 1000) / 10;
          if (pct < 55) {
            personAlerts++;
            push({
              type: 'student_attendance',
              severity: pct < 40 ? 'critical' : 'warning',
              subjectId: null,
              subjectName: null,
              teacherUid: null,
              teacherName: null,
              periodo: null,
              studentId: person.studentId,
              studentName: `${person.firstName} ${person.lastName}`,
              cedula: person.cedula,
              gradedCount: null,
              avgPct: null,
              attendanceTotal: attTotal,
              attendancePct: pct,
              lastActivity: null,
              message: `Asistencia ${pct}% en ${attTotal} registros.`,
            });
          }
        }
      }

      const now = Date.now();
      for (const t of getDataset().teachers) {
        if (now - t.lastActivity > 30 * 86400000 && subs.some((s) => s.userId === t.uid)) {
          push({
            type: 'teacher_inactive',
            severity: 'warning',
            subjectId: null,
            subjectName: null,
            teacherUid: t.uid,
            teacherName: t.displayName,
            periodo: null,
            studentId: null,
            studentName: null,
            cedula: null,
            gradedCount: null,
            avgPct: null,
            attendanceTotal: null,
            attendancePct: null,
            lastActivity: t.lastActivity,
            message: 'Sin actividad registrada en los últimos 30 días.',
          });
        }
      }

      const studentsAtRisk = new Set(alerts.filter((a) => a.type === 'student_grades' || a.type === 'student_attendance').map((a) => a.studentName)).size;
      const groupsAtRisk = alerts.filter((a) => a.type === 'group_grades' || a.type === 'group_attendance').length;
      return {
        generatedAt: now,
        institutionId: DEMO_INSTITUTION_ID,
        institutionName: getConfig().name,
        summary: {
          total: alerts.length,
          critical: alerts.filter((a) => a.severity === 'critical').length,
          warning: alerts.filter((a) => a.severity === 'warning').length,
          studentsAtRisk,
          groupsAtRisk,
        },
        alerts: alerts.slice(0, 40),
      };
    },

    async adminGenerateInstitutionInsights(filters) {
      const stats = await api.adminGetInstitutionStats(filters);
      const alerts = await api.adminGetInstitutionAlerts(filters);
      return {
        institutionName: getConfig().name,
        stats: {
          teachersWithData: stats.totals.teachers,
          gradesCount: stats.totals.gradesCount,
          avgPct: stats.grades.avgPct,
          attendancePct: stats.attendance.passRate,
          alertsCount: alerts.summary.total,
        },
        insights: {
          resumen: `La institución mantiene ${stats.totals.teachers} docentes activos, ${stats.totals.students} estudiantes y ${stats.totals.subjects} asignaturas. El promedio general es ${stats.grades.avgPct ?? '—'}% con ${stats.attendance.passRate}% de asistencia.`,
          patrones: [
            { titulo: 'Carga docente', detalle: `${stats.totals.subjects} asignaturas distribuidas entre ${stats.totals.teachers} docentes.` },
            { titulo: 'Seguimiento de notas', detalle: `${stats.totals.gradesCount} calificaciones registradas con ${alerts.summary.total} alertas activas.` },
            { titulo: 'Asistencia general', detalle: `Presentes ${stats.attendance.present}, tardanzas ${stats.attendance.late}, ausencias ${stats.attendance.absent}.` },
          ],
          recomendaciones: [
            'Revisar los grupos con promedio inferior a 60%',
            'Programar tutorías para los estudiantes con alertas de notas',
            'Reforzar el registro de asistencia en los turnos con menor actividad',
          ],
        },
      };
    },

    async adminInviteTeacher(email) {
      return { success: true, message: 'Docente invitado correctamente (modo demo).', uid: 'demo-invitado', institutionId: DEMO_INSTITUTION_ID };
    },

    // ── Sprint 1 Métricas: KPIs globales + riesgo (espejo del backend) ──
    async getInstitutionalMetrics(filters) {
      const d = getDataset();
      const subs = d.subjects.filter((s) => subjectMatchesFilters(s, filters?.turno, filters?.nivelEducativo));
      const subIds = new Set(subs.map((s) => s.id));
      const students = d.students.filter((s) => subIds.has(s.subjectId));
      const evals = d.evaluations.filter((e) => subIds.has(e.subjectId));
      const grades = d.grades.filter((g) => subIds.has(g.subjectId));
      const att = d.attendance.filter((a) => subIds.has(a.subjectId));

      const subMeta = new Map(subs.map((s) => [s.id, s]));
      const attByTurno = { matutino: { present: 0, total: 0 }, vespertino: { present: 0, total: 0 }, nocturno: { present: 0, total: 0 } };
      const attByGrado = new Map<string, { present: number; total: number }>();
      const attGlobal = { present: 0, total: 0 };
      for (const a of att) {
        const meta = subMeta.get(a.subjectId);
        const isPresent = a.status === 'present';
        attGlobal.total += 1;
        if (isPresent) attGlobal.present += 1;
        const turnoKey = meta?.periodo && attByTurno[meta.periodo as keyof typeof attByTurno] ? meta.periodo as keyof typeof attByTurno : null;
        if (turnoKey) {
          attByTurno[turnoKey].total += 1;
          if (isPresent) attByTurno[turnoKey].present += 1;
        }
        const gKey = meta?.nivelEducativo || 'sin-nivel';
        if (!attByGrado.has(gKey)) attByGrado.set(gKey, { present: 0, total: 0 });
        attByGrado.get(gKey)!.total += 1;
        if (isPresent) attByGrado.get(gKey)!.present += 1;
      }
      const pctOf = (present: number, total: number) => (total > 0 ? Math.round((present / total) * 1000) / 10 : null);

      const maxByEval = new Map(evals.map((e) => [e.id, e.maxScore]));
      let gradeSum = 0;
      let gradeCount = 0;
      for (const g of grades) {
        const max = maxByEval.get(g.evaluationId);
        if (max && max > 0 && Number.isFinite(g.score)) {
          gradeSum += (g.score / max) * 100;
          gradeCount += 1;
        }
      }

      const byPerson = new Map<string, { studentId: string; cedula: string; firstName: string; lastName: string; memberships: typeof students }>();
      for (const s of students) {
        const key = String(s.cedula || '').trim() || `${normText(s.firstName)}|${normText(s.lastName)}`;
        if (!byPerson.has(key)) {
          byPerson.set(key, { studentId: s.id, cedula: s.cedula, firstName: s.firstName, lastName: s.lastName, memberships: [] });
        }
        byPerson.get(key)!.memberships.push(s);
      }
      const riskOrder = { low: 0, medium: 1, high: 2 } as const;
      const riskSummary = { low: 0, medium: 0, high: 0 };
      const atRiskStudents: InstitutionalRiskStudentRow[] = [];
      for (const person of byPerson.values()) {
        let worst: keyof typeof riskOrder = 'low';
        for (const st of person.memberships) {
          const meta = subMeta.get(st.subjectId);
          const pcts = grades
            .filter((g) => g.subjectId === st.subjectId && g.studentId === st.id)
            .map((g) => {
              const max = maxByEval.get(g.evaluationId);
              return max && max > 0 ? (g.score / max) * 100 : null;
            })
            .filter((v): v is number => v !== null);
          const gradePct = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
          const attRecords = att.filter((a) => a.subjectId === st.subjectId && a.studentId === st.id);
          const attPct = attRecords.length > 0
            ? (attRecords.filter((a) => a.status === 'present').length / attRecords.length) * 100
            : null;
          const risk = calculateStudentRisk(attPct, gradePct !== null ? [gradePct] : []);
          if (riskOrder[risk.level] > riskOrder[worst]) worst = risk.level;
          if (risk.level !== 'low') {
            atRiskStudents.push({
              studentId: person.studentId,
              cedula: person.cedula,
              studentName: `${person.firstName} ${person.lastName}`.trim(),
              asignatura: meta?.name || 'Sin nombre',
              docente: meta ? getTeacherById().get(meta.userId)?.displayName || meta.teacher : 'Docente',
              periodo: meta?.periodo || null,
              nivelEducativo: meta?.nivelEducativo || null,
              asistencia: attPct !== null ? Math.round(attPct * 10) / 10 : null,
              nota: gradePct !== null ? Math.round(gradePct * 10) / 10 : null,
              nivelRiesgo: risk.level,
              razones: risk.reasons,
            });
          }
        }
        riskSummary[worst] += 1;
      }
      atRiskStudents.sort((a, b) => riskOrder[b.nivelRiesgo] - riskOrder[a.nivelRiesgo] || a.studentName.localeCompare(b.studentName, 'es'));
      if (atRiskStudents.length > 50) atRiskStudents.length = 50;

      const byGradoOut: Record<string, number | null> = {};
      for (const [k, v] of attByGrado.entries()) byGradoOut[k] = pctOf(v.present, v.total);

      const mockTrends = {
        attendance: [
          { date: '2025-06', value: 85 },
          { date: '2025-07', value: 87 },
          { date: '2025-08', value: 86 },
          { date: '2025-09', value: 89 },
          { date: '2025-10', value: 92 },
          { date: '2025-11', value: 91 },
        ],
        grades: [
          { date: '2025-06', value: 70 },
          { date: '2025-07', value: 72 },
          { date: '2025-08', value: 74 },
          { date: '2025-09', value: 78 },
          { date: '2025-10', value: 80 },
          { date: '2025-11', value: 82 },
        ],
      };

      const mockDistribution = {
        byTurno: { matutino: 120, vespertino: 80, nocturno: 45 },
        byGrado: { '1er año': 50, '2do año': 60, '3er año': 75, '4to año': 40, '5to año': 20 },
      };

      const mockRetention = {
        estimatedRate: 94,
        totalActive: 245,
        totalPrevious: 260,
      };

      const metrics: InstitutionalMetrics = {
        generatedAt: Date.now(),
        institutionId: DEMO_INSTITUTION_ID,
        attendance: {
          global: pctOf(attGlobal.present, attGlobal.total),
          byTurno: {
            matutino: pctOf(attByTurno.matutino.present, attByTurno.matutino.total),
            vespertino: pctOf(attByTurno.vespertino.present, attByTurno.vespertino.total),
            nocturno: pctOf(attByTurno.nocturno.present, attByTurno.nocturno.total),
          },
          byGrado: byGradoOut,
        },
        grades: { global: gradeCount > 0 ? Math.round((gradeSum / gradeCount) * 10) / 10 : null },
        riskSummary,
        atRiskStudents,
        trends: mockTrends,
        distribution: mockDistribution,
        retention: mockRetention,
      };
      return metrics;
    },

    // ── Sprint 2: detalle del estudiante + recomendaciones (espejo del backend) ──
    async getStudentRiskReport(studentId) {
      const d = getDataset();
      const personDoc = d.students.find((s) => String(s.id) === studentId || (s.cedula && String(s.cedula).trim() === studentId));
      if (!personDoc) {
        return {
          student: { studentId, cedula: '', firstName: 'Estudiante', lastName: 'No encontrado', grado: null, seccion: null, correo: null },
          subjects: [],
          promedioGeneral: null,
          riskLevel: 'low' as const,
          reasons: [],
          recommendations: [],
        };
      }
      const personKey = String(personDoc.cedula || '').trim() || `${normText(personDoc.firstName)}|${normText(personDoc.lastName)}`;
      const memberships = d.students.filter((s) => {
        const k = String(s.cedula || '').trim() || `${normText(s.firstName)}|${normText(s.lastName)}`;
        return k === personKey;
      });

      const riskOrder = { low: 0, medium: 1, high: 2 } as const;
      const subjects: StudentRiskReport['subjects'] = [];
      let worst: keyof typeof riskOrder = 'low';
      const reasons: string[] = [];
      let attPresent = 0;
      let attTotal = 0;
      let sumGrade = 0;
      let countGrade = 0;
      let fails = 0;

      for (const st of memberships) {
        const meta = getSubjectById().get(st.subjectId);
        const evals = subjectEvaluations(st.subjectId);
        const grades = getDataset().grades.filter((g) => g.subjectId === st.subjectId && g.studentId === st.id);
        const att = getDataset().attendance.filter((a) => a.subjectId === st.subjectId && a.studentId === st.id);
        const maxByEval = new Map(evals.map((e) => [e.id, e.maxScore]));
        const pcts = grades
          .map((g) => {
            const max = maxByEval.get(g.evaluationId);
            return max && max > 0 ? (g.score / max) * 100 : null;
          })
          .filter((v): v is number => v !== null);
        const gradePct = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
        const attPct = att.length > 0 ? (att.filter((a) => a.status === 'present').length / att.length) * 100 : null;

        const risk = calculateStudentRisk(attPct, gradePct !== null ? [gradePct] : []);
        if (riskOrder[risk.level] > riskOrder[worst]) worst = risk.level;
        for (const reason of risk.reasons) {
          if (!reasons.includes(reason)) reasons.push(reason);
        }
        if (gradePct !== null) {
          sumGrade += gradePct;
          countGrade += 1;
          if (gradePct < 60) fails += 1;
        }
        attPresent += att.filter((a) => a.status === 'present').length;
        attTotal += att.length;

        const gs = deriveGradoSeccion(meta?.name || '');
        subjects.push({
          subjectId: st.subjectId,
          subjectName: meta?.name || 'Sin nombre',
          teacherName: meta ? getTeacherById().get(meta.userId)?.displayName || meta.teacher : 'Docente',
          periodo: meta?.periodo || null,
          nivelEducativo: meta?.nivelEducativo || null,
          attendance: attPct !== null ? Math.round(attPct * 10) / 10 : null,
          finalGrade: gradePct !== null ? Math.round(gradePct * 10) / 10 : null,
          grado: gs.grado,
          seccion: gs.seccion,
        });
      }

      const overallAtt = attTotal > 0 ? (attPresent / attTotal) * 100 : null;
      const promedioGeneral = countGrade > 0 ? Math.round((sumGrade / countGrade) * 10) / 10 : null;
      const gs = subjects.find((s) => s.grado) || { grado: null, seccion: null };

      return {
        student: {
          studentId: personDoc.id,
          cedula: personDoc.cedula || '',
          firstName: personDoc.firstName,
          lastName: personDoc.lastName,
          grado: gs.grado,
          seccion: gs.seccion,
          correo: null,
        },
        subjects,
        promedioGeneral,
        riskLevel: worst,
        reasons,
        recommendations: generateRecommendations(worst, overallAtt, fails),
      };
    },

    // ── Sprint 3: desempeño por docente (espejo del backend) ──
    async getTeacherPerformance(input) {
      const d = getDataset();
      const t = getTeacherById().get(input.teacherId);
      if (!t) {
        throw new Error('El docente no existe en la institución.');
      }
      const periodo = input.periodo || null;
      const grado = input.grado || null;
      const subs = d.subjects
        .filter((s) => s.userId === t.uid)
        .filter((s) => (!periodo || s.periodo === periodo) && (!grado || s.nivelEducativo === grado));
      const subIds = new Set(subs.map((s) => s.id));
      const students = d.students.filter((s) => subIds.has(s.subjectId));
      const evals = d.evaluations.filter((e) => subIds.has(e.subjectId));
      const grades = d.grades.filter((g) => subIds.has(g.subjectId));
      const att = d.attendance.filter((a) => subIds.has(a.subjectId));

      const maxByEval = new Map(evals.map((e) => [e.id, e.maxScore]));
      const subjects: TeacherPerformance['subjects'] = [];
      let sumGrade = 0;
      let countGrade = 0;
      for (const sub of subs) {
        const subGrades = grades.filter((g) => g.subjectId === sub.id);
        const subAtt = att.filter((a) => a.subjectId === sub.id);
        let gradeSum = 0;
        let gradeCount = 0;
        for (const g of subGrades) {
          const max = maxByEval.get(g.evaluationId);
          if (max && max > 0) { gradeSum += (g.score / max) * 100; gradeCount += 1; }
        }
        const present = subAtt.filter((a) => a.status === 'present').length;
        sumGrade += gradeSum;
        countGrade += gradeCount;
        subjects.push({
          subjectId: sub.id,
          subjectName: sub.name,
          periodo: sub.periodo || null,
          nivelEducativo: sub.nivelEducativo || null,
          promedioCalificaciones: gradeCount > 0 ? Math.round((gradeSum / gradeCount) * 10) / 10 : null,
          promedioAsistencia: subAtt.length > 0 ? Math.round((present / subAtt.length) * 1000) / 10 : null,
          numEstudiantes: students.filter((s) => s.subjectId === sub.id).length,
        });
      }

      const byPerson = new Map<string, { studentId: string; cedula: string; firstName: string; lastName: string; memberships: typeof students }>();
      for (const s of students) {
        const key = String(s.cedula || '').trim() || `${normText(s.firstName)}|${normText(s.lastName)}`;
        if (!byPerson.has(key)) {
          byPerson.set(key, { studentId: s.id, cedula: s.cedula, firstName: s.firstName, lastName: s.lastName, memberships: [] });
        }
        byPerson.get(key)!.memberships.push(s);
      }
      const riskOrder = { low: 0, medium: 1, high: 2 } as const;
      const atRiskStudents: TeacherPerformance['atRiskStudents'] = [];
      for (const person of byPerson.values()) {
        for (const st of person.memberships) {
          const sub = subs.find((x) => x.id === st.subjectId);
          const pcts = grades
            .filter((g) => g.subjectId === st.subjectId && g.studentId === st.id)
            .map((g) => {
              const max = maxByEval.get(g.evaluationId);
              return max && max > 0 ? (g.score / max) * 100 : null;
            })
            .filter((v): v is number => v !== null);
          const gradePct = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
          const stAtt = att.filter((a) => a.subjectId === st.subjectId && a.studentId === st.id);
          const attPct = stAtt.length > 0 ? (stAtt.filter((a) => a.status === 'present').length / stAtt.length) * 100 : null;
          const risk = calculateStudentRisk(attPct, gradePct !== null ? [gradePct] : []);
          if (risk.level !== 'low') {
            atRiskStudents.push({
              studentId: person.studentId,
              cedula: person.cedula,
              studentName: `${person.firstName} ${person.lastName}`.trim(),
              subjectName: sub?.name || 'Sin nombre',
              asistencia: attPct !== null ? Math.round(attPct * 10) / 10 : null,
              nota: gradePct !== null ? Math.round(gradePct * 10) / 10 : null,
              nivelRiesgo: risk.level,
              razones: risk.reasons,
            });
          }
        }
      }
      atRiskStudents.sort((a, b) => riskOrder[b.nivelRiesgo] - riskOrder[a.nivelRiesgo] || a.studentName.localeCompare(b.studentName, 'es'));
      if (atRiskStudents.length > 50) atRiskStudents.length = 50;

      // Evolución por trimestre (I/II/III) según el mes del registro.
      const trimesterOf = (date: string | null | undefined): string | null => {
        const m = String(date || '').slice(0, 10).match(/^(\d{4})-(\d{2})/);
        if (!m) return null;
        const mo = parseInt(m[2], 10);
        if (mo >= 9 && mo <= 11) return 'I';
        if (mo === 12 || mo <= 2) return 'II';
        return 'III';
      };
      const evolution: TeacherPerformance['evolution'] = ['I', 'II', 'III'].map((periodoKey) => {
        const pEvalIds = new Set(evals.filter((e) => trimesterOf(e.date) === periodoKey).map((e) => e.id));
        let gradeSum = 0;
        let gradeCount = 0;
        for (const g of grades) {
          const max = maxByEval.get(g.evaluationId);
          if (pEvalIds.has(g.evaluationId) && max && max > 0) { gradeSum += (g.score / max) * 100; gradeCount += 1; }
        }
        const pAtt = att.filter((a) => trimesterOf(a.date) === periodoKey);
        const pPresent = pAtt.filter((a) => a.status === 'present').length;
        return {
          periodo: periodoKey,
          attendance: pAtt.length > 0 ? Math.round((pPresent / pAtt.length) * 1000) / 10 : null,
          grades: gradeCount > 0 ? Math.round((gradeSum / gradeCount) * 10) / 10 : null,
        };
      });

      const performance: TeacherPerformance = {
        teacher: {
          uid: t.uid,
          email: t.email,
          displayName: t.displayName,
          institutionId: DEMO_INSTITUTION_ID,
          institutionName: getConfig().name,
          subjectsCount: subs.length,
          totalStudents: students.length,
          promedioGeneral: countGrade > 0 ? Math.round((sumGrade / countGrade) * 10) / 10 : null,
        },
        subjects,
        atRiskStudents,
        evolution,
      };
      return performance;
    },
  };
  return api;
}
