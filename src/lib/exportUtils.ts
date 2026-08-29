import { format } from 'date-fns';
import { collection, query, where, getDocs, doc, getDoc, orderBy, startAfter } from 'firebase/firestore';
import { db } from './firebase';
import { safeJSONParse, parseLocalDate } from './utils';
import { STORAGE_KEYS, getStorageItem } from './storageKeys';
import { parseWeights, calculateStudentGrades, calculateWeightedAverage, DEFAULT_WEIGHTS, DEFAULT_SCALE, type ViewMode, type CalculationMode, type GradingWeights, type GradingScale } from './gradeCalculator';
import type { AdminTeacherDataResponse, AdminTeacherSummaryResponse } from './adminApi';
// html2canvas-pro (fork con soporte de oklch/oklab, usado por Tailwind 4):
// html2canvas 1.4.1 no parsea `oklch(...)` y el export a PDF fallaba.
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import { filterModulesForMateria, resolveCanonicalSubjectId } from './classGroups';

interface SubjectExportData {
  students: any[];
  subjectModules: any[];
  evaluations: any[];
  grades: any[];
  attendance: any[];
}

interface ExportSettings {
  weights: GradingWeights;
  gradingScale: GradingScale;
  useCheckpoint: boolean;
  viewMode: ViewMode;
  calculationMode: CalculationMode;
}

function settingsFromStorage(): ExportSettings {
  return {
    weights: parseWeights(getStorageItem(STORAGE_KEYS.GRADING_WEIGHTS)),
    gradingScale: safeJSONParse(getStorageItem(STORAGE_KEYS.GRADING_SCALE), { ...DEFAULT_SCALE }),
    useCheckpoint: safeJSONParse(getStorageItem(STORAGE_KEYS.USE_CHECKPOINT), false),
    viewMode: (getStorageItem(STORAGE_KEYS.GRADING_VIEW_MODE) as ViewMode) || 'categories',
    calculationMode: (getStorageItem(STORAGE_KEYS.GRADING_CALCULATION_MODE) as CalculationMode) || 'average',
  };
}

// Convierte el doc `userSettings/{uid}` del docente (persistido por
// GradeSettingsContext) al formato interno de exportación.
export function settingsFromUserSettings(settings?: Record<string, unknown>): ExportSettings {
  const s = settings || {};
  const weights = s.weights ? (typeof s.weights === 'string' ? parseWeights(s.weights) : { ...DEFAULT_WEIGHTS, ...(s.weights as GradingWeights) }) : DEFAULT_WEIGHTS;
  const gradingScale = s.gradingScale ? (typeof s.gradingScale === 'string' ? safeJSONParse(s.gradingScale, { ...DEFAULT_SCALE }) : { ...DEFAULT_SCALE, ...(s.gradingScale as GradingScale) }) : { ...DEFAULT_SCALE };
  return {
    weights,
    gradingScale,
    useCheckpoint: typeof s.useCheckpoint === 'boolean' ? s.useCheckpoint : false,
    viewMode: (s.gradingViewMode as ViewMode) || 'categories',
    calculationMode: (s.gradingCalculationMode as CalculationMode) || 'average',
  };
}

async function getAllDocsForUserSubject(colName: string, userId: string, subjectId: string) {
  const allDocs: any[] = [];
  let lastDoc: any = null;
  for (;;) {
    let q = query(collection(db, colName), where('userId', '==', userId), where('subjectId', '==', subjectId), orderBy('__name__', 'asc'));
    if (lastDoc) q = query(q, startAfter(lastDoc));
    const snaps = await getDocs(q);
    if (snaps.docs.length === 0) break;
    allDocs.push(...snaps.docs.map(d => ({ id: d.id, ...d.data() })));
    lastDoc = snaps.docs[snaps.docs.length - 1];
  }
  return allDocs;
}

/**
 * Construye las hojas de un sujeto dentro del workbook dado.
 * Compatible con el export original del docente para que el admin obtenga
 * exactamente el mismo reporte.
 */
function buildSubjectWorkbook(
  utils: any,
  wb: any,
  sub: any,
  data: SubjectExportData,
  settings: ExportSettings,
  userName: string | null,
  sheetPrefix = '',
) {
  const { weights, gradingScale, useCheckpoint, viewMode, calculationMode } = settings;

  const sheetName = (name: string) => {
    const full = sheetPrefix ? `${sheetPrefix}-${name}` : name;
    return full.length > 31 ? full.substring(0, 31) : full;
  };

  const students = [...data.students];
  const sortedStudents = students.sort((a, b) => (a.lastName || '').localeCompare(b.lastName || ''));

  const subjectModules = [...data.subjectModules];
  subjectModules.sort((a, b) => (a.order || 0) - (b.order || 0));

  const evaluations = [...data.evaluations];
  evaluations.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const allGrades = [...data.grades];
  const attendanceSessions = [...data.attendance];
  attendanceSessions.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const calculateFinalGrade = (studentId: string, evalsSubset: typeof evaluations) => {
    const studentGrades = allGrades.filter(g => g.studentId === studentId);
    const val = calculateWeightedAverage(studentGrades, evalsSubset, weights, gradingScale as any, useCheckpoint);
    return Math.round(val * 10) / 10;
  };

  const buildSheetHeaders = (sheetTitle: string, mod?: any) => {
    const dateStr = new Date().toLocaleDateString('es-ES');
    const timeStr = new Date().toLocaleTimeString('es-ES');
    const dayStr = new Date().toLocaleDateString('es-ES', { weekday: 'long' });
    const headers = [
      ['Reporte', sheetTitle],
      ['Asignatura', sub.name || sub.title || 'Asignatura']
    ];
    if (mod && mod.title) {
      headers.push(['Plan / Módulo', mod.title]);
      const start = mod.startDate ? parseLocalDate(mod.startDate).toLocaleDateString() : 'N/A';
      const end = mod.endDate ? parseLocalDate(mod.endDate).toLocaleDateString() : 'N/A';
      headers.push(['Período del Módulo', `${start} - ${end}`]);
    }
    headers.push(['Profesor', sub.teacher || userName || 'Profesor Asignado']);
    headers.push(['Fecha', `${dayStr}, ${dateStr} a las ${timeStr}`]);
    headers.push([]);
    return headers;
  };

  const parentModules = subjectModules.filter(m => !m.parentId);
  const childModules = subjectModules.filter(m => m.parentId);

  if (parentModules.length >= 2) {
    const summaryHeaders = buildSheetHeaders('Resumen General por Módulo');

    const finalHeader = viewMode === 'modules' ? (calculationMode === 'sum' ? 'Suma Total' : 'Prom. Final') : 'Nota Final';
    const summaryTableHeader = ['Estudiante'];
    parentModules.forEach(mod => summaryTableHeader.push(`Promedio M${mod.order}`));
    summaryTableHeader.push(finalHeader);
    summaryTableHeader.push('');
    parentModules.forEach(mod => summaryTableHeader.push(`Asist. M${mod.order}`));
    summaryTableHeader.push('Asistencia Final');

    const summaryRows = sortedStudents.map(student => {
      const row = [`${student.lastName || ''}, ${student.firstName || ''}`];
      const moduleAverages: number[] = [];
      const moduleAttPercentages: number[] = [];
      let totalPresent = 0;
      let totalSessions = 0;

      const studentGradesAll = allGrades.filter(g => g.studentId === student.id);
      const gradesResult = calculateStudentGrades(
        student.id,
        studentGradesAll,
        evaluations,
        subjectModules,
        useCheckpoint,
        weights,
        gradingScale as any,
        viewMode,
        calculationMode
      );

      parentModules.forEach(mod => {
        const modGradeRaw = gradesResult.byModule[mod.id!];
        const grade = modGradeRaw !== undefined ? Math.round(modGradeRaw * 10) / 10 : 0;
        moduleAverages.push(grade);

        const startTimestamp = mod.startDate ? parseLocalDate(mod.startDate).getTime() : null;
        let endTimestamp = mod.endDate ? parseLocalDate(mod.endDate).getTime() : null;
        if (endTimestamp) endTimestamp += 86400000 - 1;

        let modAttendance = attendanceSessions;
        if (startTimestamp && endTimestamp) {
          modAttendance = attendanceSessions.filter(a => {
            const aTime = parseLocalDate(a.date).getTime();
            return aTime >= startTimestamp && aTime <= endTimestamp;
          });
        }

        const studentAttendance = modAttendance.filter(a => a.studentId === student.id);
        let studentPresentCount = 0;
        studentAttendance.forEach(a => {
          if (a.status === 'present' || a.status === 'late' || a.status === 'justified') {
            studentPresentCount++;
          }
        });
        const modAttPercentage = studentAttendance.length > 0 ? (studentPresentCount / studentAttendance.length) * 100 : 100;

        totalPresent += studentPresentCount;
        totalSessions += studentAttendance.length;
        moduleAttPercentages.push(modAttPercentage);
      });

      const finalAvg = gradesResult.total;
      const finalAtt = totalSessions > 0 ? (totalPresent / totalSessions) * 100 : 100;

      row.push(...moduleAverages.map(a => a.toFixed(1)));
      row.push(finalAvg.toFixed(1));
      row.push('');
      row.push(...moduleAttPercentages.map(a => a.toFixed(0) + '%'));
      row.push(finalAtt.toFixed(0) + '%');
      return row;
    });

    const colsConf = [{ wch: 30 }];
    parentModules.forEach(() => colsConf.push({ wch: 15 }));
    colsConf.push({ wch: 18 });
    colsConf.push({ wch: 4 });
    parentModules.forEach(() => colsConf.push({ wch: 15 }));
    colsConf.push({ wch: 18 });

    const wsSummary = utils.aoa_to_sheet([...summaryHeaders, summaryTableHeader, ...summaryRows]);
    wsSummary['!cols'] = colsConf;
    utils.book_append_sheet(wb, wsSummary, sheetName('Resumen'));
  }

  const parentModulesToExport = parentModules.length > 0
    ? [...parentModules, { id: null, title: 'Generales / Sin Asignar', order: 999, startDate: null, endDate: null }]
    : [{ id: null, title: 'General', order: 0, startDate: null, endDate: null }];

  for (const mod of parentModulesToExport) {
    const childIds = mod.id ? childModules.filter(c => c.parentId === mod.id).map(c => c.id) : [];
    let modEvals = evaluations.filter(e => {
      if (mod.id === null) {
        const allAssignedIds = new Set(subjectModules.map(m => m.id));
        return !e.moduleId || !allAssignedIds.has(e.moduleId);
      }
      return e.moduleId === mod.id || childIds.includes(e.moduleId);
    });

    modEvals = modEvals.filter(e => allGrades.some(g => g.evaluationId === e.id && typeof g.score === 'number'));

    let modAttendance = [...attendanceSessions];
    if (mod.id !== null) {
      const startTimestamp = mod.startDate ? parseLocalDate(mod.startDate).getTime() : null;
      let endTimestamp = mod.endDate ? parseLocalDate(mod.endDate).getTime() : null;
      if (endTimestamp) endTimestamp += 86400000 - 1;

      modAttendance = attendanceSessions.filter(a => {
        const aTime = parseLocalDate(a.date).getTime();
        if (startTimestamp && endTimestamp) return aTime >= startTimestamp && aTime <= endTimestamp;
        return false;
      });
    } else if (parentModules.length > 0) {
      modAttendance = attendanceSessions.filter(a => {
        const aTime = parseLocalDate(a.date).getTime();
        for (const sm of parentModules) {
          const ms = sm.startDate ? parseLocalDate(sm.startDate).getTime() : null;
          let me = sm.endDate ? parseLocalDate(sm.endDate).getTime() : null;
          if (me) me += 86400000 - 1;
          if (ms && me && aTime >= ms && aTime <= me) return false;
        }
        return true;
      });
    }

    if (parentModules.length > 0 && modEvals.length === 0 && modAttendance.length === 0 && mod.id === null) {
      continue;
    }

    const prefix = parentModules.length > 0 ? (mod.id === null ? 'Gen' : `M${mod.order}`) : '';

    if (modEvals.length > 0 || mod.id === null) {
      const gradesHeaderRows = buildSheetHeaders('Calificaciones', mod);
      const evaluationTitles = modEvals.map(e => {
        const subMod = childModules.find(cm => cm.id === e.moduleId);
        const subTitle = subMod ? ` [${subMod.title}]` : '';
        return `${e.title}${subTitle} (${e.maxScore || 100} pts)`;
      });
      const gradesTableHeader = ['Estudiante', 'Cédula', ...evaluationTitles, 'Promedio'];
      const gradesTableRows = sortedStudents.map(s => {
        const studentGrades = modEvals.map(e => {
          const g = allGrades.find(grade => grade.studentId === s.id && grade.evaluationId === e.id);
          return (g && typeof g.score === 'number') ? g.score : '-';
        });
        const final = calculateFinalGrade(s.id, modEvals);
        return [`${s.lastName || ''}, ${s.firstName || ''}`, s.cedula, ...studentGrades, final];
      });

      let gradesSheetName = prefix ? `${prefix}-Cal` : 'Calificaciones';
      if (gradesSheetName.length > 31) gradesSheetName = gradesSheetName.substring(0, 31);

      const wsGrades = utils.aoa_to_sheet([...gradesHeaderRows, gradesTableHeader, ...gradesTableRows]);
      wsGrades['!cols'] = [
        { wch: 30 }, { wch: 20 }, ...modEvals.map(() => ({ wch: 20 })), { wch: 15 }
      ];
      utils.book_append_sheet(wb, wsGrades, sheetName(gradesSheetName));
    }

    if (modAttendance.length > 0 || mod.id === null) {
      const attendanceHeaderRows = buildSheetHeaders('Asistencia', mod);
      let uniqueDates = Array.from(new Set(modAttendance.map(s => s.date))).sort();

      uniqueDates = uniqueDates.filter(dateStr => {
        const day = parseLocalDate(dateStr).getDay();
        return day !== 0 && day !== 6;
      });

      const sessionDateStrings = uniqueDates.map(d => {
        const [year, month, day] = d.split('-');
        return `${day}/${month}/${year}`;
      });

      const attTableHeader = ['Estudiante', 'Cédula', ...sessionDateStrings, '% Asistencia', 'Estado'];

      const attTableRows = sortedStudents.map(s => {
        let presentCount = 0;
        const sessionStatus = uniqueDates.map(dateStr => {
          const record = modAttendance.find(r => r.studentId === s.id && r.date === dateStr);
          if (record?.status === 'present') { presentCount++; return 'P'; }
          else if (record?.status === 'late') { presentCount += 0.5; return 'T'; }
          else if (record?.status === 'absent') { return 'A'; }
          return '-';
        });

        let attPercentage = 0;
        if (uniqueDates.length > 0) attPercentage = Math.round((presentCount / uniqueDates.length) * 100);

        let statusText = 'Aprobado';
        if (attPercentage < 80) statusText = 'Advertencia';
        if (attPercentage < 70) statusText = 'Reprobado';

        return [`${s.lastName || ''}, ${s.firstName || ''}`, s.cedula, ...sessionStatus, `${attPercentage}%`, statusText];
      });

      let attSheetName = prefix ? `${prefix}-Asi` : 'Asistencia';
      if (attSheetName.length > 31) attSheetName = attSheetName.substring(0, 31);

      const presentRow = ['Total Presentes', ''];
      const lateRow = ['Total Tardanzas', ''];
      const absentRow = ['Total Ausentes', ''];

      uniqueDates.forEach(dateStr => {
        const recordsForDate = modAttendance.filter(a => a.date === dateStr);
        presentRow.push(recordsForDate.filter(a => a.status === 'present').length.toString());
        lateRow.push(recordsForDate.filter(a => a.status === 'late').length.toString());
        absentRow.push(recordsForDate.filter(a => a.status === 'absent').length.toString());
      });

      presentRow.push('', ''); lateRow.push('', ''); absentRow.push('', '');

      const wsAttendance = utils.aoa_to_sheet([...attendanceHeaderRows, attTableHeader, ...attTableRows, [], presentRow, lateRow, absentRow]);
      wsAttendance['!cols'] = [
        { wch: 30 }, { wch: 20 }, ...uniqueDates.map(() => ({ wch: 10 })), { wch: 15 }, { wch: 15 }
      ];
      utils.book_append_sheet(wb, wsAttendance, sheetName(attSheetName));
    }
  }
}

export async function exportSubjectDataToExcel(userId: string, userName: string | null, subjectId: string, scope?: string) {
  const { utils, writeFile } = await import('xlsx');
  const subjectDoc = await getDoc(doc(db, 'subjects', subjectId));
  if (!subjectDoc.exists()) return;
  const subject = { id: subjectDoc.id, ...subjectDoc.data() } as any;

  if (subject.groupId && scope === 'general') {
    return exportClassGroupDataToExcel(userId, userName, subject.groupId);
  }

  let sharedSubjectId = subjectId;
  let sharedModules: any[] | null = null;
  if (subject.groupId) {
    const siblingSnap = await getDocs(
      query(collection(db, 'subjects'), where('userId', '==', userId), where('groupId', '==', subject.groupId))
    );
    const siblings = siblingSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
    sharedSubjectId = resolveCanonicalSubjectId(siblings, subjectId) || subjectId;
    sharedModules = await getAllDocsForUserSubject('subjectModules', userId, sharedSubjectId);
  }

  const data: SubjectExportData = {
    students: await getAllDocsForUserSubject('students', userId, sharedSubjectId),
    subjectModules: sharedModules
      ? filterModulesForMateria(sharedModules, subjectId, 'subject')
      : await getAllDocsForUserSubject('subjectModules', userId, subjectId),
    evaluations: await getAllDocsForUserSubject('evaluations', userId, subjectId),
    grades: await getAllDocsForUserSubject('grades', userId, subjectId),
    attendance: await getAllDocsForUserSubject('attendance', userId, sharedSubjectId),
  };

  const wb = utils.book_new();
  const settings = settingsFromStorage();
  buildSubjectWorkbook(utils, wb, subject, data, settings, userName);

  const filename = `reporte-${subject.name ? subject.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'asignatura'}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  writeFile(wb, filename);
}

/**
 * Exporta el reporte completo del Aula Multiasignatura (Alcance: General).
 * Genera la hoja "Resumen General", hojas por cada materia con su nombre real,
 * y la hoja "Asistencia General" sin atribuir falsamente a una sola materia.
 */
export async function exportClassGroupDataToExcel(userId: string, userName: string | null, groupId: string) {
  const { utils, writeFile } = await import('xlsx');
  const groupSnap = await getDoc(doc(db, 'classGroups', groupId));
  const groupData = groupSnap.exists() ? ({ id: groupSnap.id, ...groupSnap.data() } as any) : null;

  const subjectsSnap = await getDocs(
    query(collection(db, 'subjects'), where('userId', '==', userId), where('groupId', '==', groupId))
  );
  const subjects = subjectsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
  if (subjects.length === 0) return;

  // Canonical subject for shared students & attendance
  const canonSubjectId = resolveCanonicalSubjectId(subjects, String(subjects[0].id)) || String(subjects[0].id);

  const sharedStudents = await getAllDocsForUserSubject('students', userId, canonSubjectId);
  const sharedAttendance = await getAllDocsForUserSubject('attendance', userId, canonSubjectId);
  const sharedModules = await getAllDocsForUserSubject('subjectModules', userId, canonSubjectId);

  const settings = settingsFromStorage();
  const wb = utils.book_new();

  // 1. Hoja "Resumen General"
  const groupTitle = groupData
    ? (groupData.name || 'Aula')
    : 'Aula Multiasignatura';

  const dateStr = new Date().toLocaleDateString('es-ES');
  const summaryHeaders = [
    ['Reporte', 'Resumen General del Aula'],
    ['Aula', groupTitle],
    ['Alcance', 'General · Todas las materias'],
    ['Profesor', userName || 'Profesor Asignado'],
    ['Fecha', dateStr],
    []
  ];

  const summaryTableHeader = ['Estudiante', 'Cédula', ...subjects.map(s => s.name), 'Promedio General', 'Asistencia Global'];

  const perSubjectData: Record<string, SubjectExportData> = {};
  for (const sub of subjects) {
    perSubjectData[sub.id] = {
      students: sharedStudents,
      subjectModules: filterModulesForMateria(sharedModules, sub.id, 'subject'),
      evaluations: await getAllDocsForUserSubject('evaluations', userId, sub.id),
      grades: await getAllDocsForUserSubject('grades', userId, sub.id),
      attendance: sharedAttendance,
    };
  }

  const sortedStudents = [...sharedStudents].sort((a, b) => (a.lastName || '').localeCompare(b.lastName || ''));

  const summaryRows = sortedStudents.map(st => {
    const row: any[] = [`${st.lastName || ''}, ${st.firstName || ''}`, st.cedula || ''];
    let studentSum = 0;
    let validSubjectCount = 0;

    for (const sub of subjects) {
      const subData = perSubjectData[sub.id];
      const stGrades = subData.grades.filter(g => g.studentId === st.id);
      const val = calculateWeightedAverage(stGrades, subData.evaluations, settings.weights, settings.gradingScale as any, settings.useCheckpoint);
      if (stGrades.length > 0) {
        studentSum += val;
        validSubjectCount++;
      }
      row.push(val > 0 ? val.toFixed(1) : '—');
    }

    const globalAvg = validSubjectCount > 0 ? (studentSum / validSubjectCount) : 0;
    row.push(globalAvg > 0 ? globalAvg.toFixed(1) : '—');

    const stAttendance = sharedAttendance.filter(a => a.studentId === st.id);
    let presentCount = 0;
    stAttendance.forEach(a => {
      if (a.status === 'present' || a.status === 'late' || a.status === 'justified') presentCount++;
    });
    const attPct = stAttendance.length > 0 ? (presentCount / stAttendance.length) * 100 : 100;
    row.push(attPct.toFixed(0) + '%');

    return row;
  });

  const wsSummary = utils.aoa_to_sheet([...summaryHeaders, summaryTableHeader, ...summaryRows]);
  wsSummary['!cols'] = [{ wch: 30 }, { wch: 15 }, ...subjects.map(() => ({ wch: 18 })), { wch: 20 }, { wch: 18 }];
  utils.book_append_sheet(wb, wsSummary, 'Resumen General');

  // 2. Hoja de asistencia realmente global (una sesión por aula y fecha).
  const attendanceDates = Array.from(new Set(sharedAttendance.map((item: any) => String(item.date || '')).filter(Boolean))).sort();
  const attendanceRows = sortedStudents.map(student => {
    const records = sharedAttendance.filter((item: any) => item.studentId === student.id);
    const byDate = new Map(records.map((item: any) => [String(item.date), item.status]));
    const statuses = attendanceDates.map(date => {
      const status = byDate.get(date);
      if (status === 'present') return 'P';
      if (status === 'late') return 'T';
      if (status === 'absent') return 'A';
      if (status === 'justified') return 'J';
      return '—';
    });
    const present = records.filter((item: any) => ['present', 'late', 'justified'].includes(item.status)).length;
    const pct = records.length > 0 ? (present / records.length) * 100 : 100;
    return [`${student.lastName || ''}, ${student.firstName || ''}`, student.cedula || '', ...statuses, `${pct.toFixed(0)}%`];
  });
  const attendanceSheet = utils.aoa_to_sheet([
    ['Reporte', 'Asistencia General'],
    ['Aula', groupTitle],
    ['Alcance', 'General · Todas las materias'],
    ['Profesor', userName || 'Profesor Asignado'],
    ['Fecha', dateStr],
    [],
    ['Estudiante', 'Cédula', ...attendanceDates, '% Asistencia'],
    ...attendanceRows,
  ]);
  attendanceSheet['!cols'] = [{ wch: 30 }, { wch: 15 }, ...attendanceDates.map(() => ({ wch: 12 })), { wch: 16 }];
  utils.book_append_sheet(wb, attendanceSheet, 'Asistencia General');

  // 3. Una hoja por cada materia
  const usedPrefixes = new Set<string>();
  for (const sub of subjects) {
    let prefix = sub.name ? sub.name.replace(/[^a-z0-9]/gi, '_').substring(0, 20) : 'materia';
    let candidate = prefix;
    for (let i = 2; usedPrefixes.has(candidate); i++) {
      candidate = `${prefix}_${i}`.substring(0, 20);
    }
    usedPrefixes.add(candidate);

    buildSubjectWorkbook(utils, wb, sub, perSubjectData[sub.id], settings, userName, candidate);
  }

  const filename = `reporte-general-aula-${groupTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  writeFile(wb, filename);
}

/**
 * Exporta a Excel el reporte completo de un docente (todas sus asignaturas)
 * usando los datos que devuelve `adminGetTeacherData`. Produce el MISMO
 * reporte que el docente genera desde su cuaderno.
 *
 * `filenameSuffix` (opcional) refleja los filtros activos del dashboard en el
 * nombre del archivo (p.ej. "matutino_secundaria").
 */
export async function exportTeacherDataToExcel(teacherData: AdminTeacherDataResponse, filenameSuffix?: string) {
  const { utils, writeFile } = await import('xlsx');
  const wb = utils.book_new();
  const settings = settingsFromUserSettings(teacherData.settings);

  // Hoja institucional con el encabezado personalizado (Fase 5): se agrega
  // solo si la institución configuró algún dato de identidad/contacto.
  const cfg = teacherData.schoolConfig;
  const instRows: any[][] = [];
  if (cfg && (cfg.slogan || cfg.directorName || cfg.address || cfg.phone || cfg.email)) {
    instRows.push([teacherData.teacher.institutionName || 'Institución']);
    if (cfg.slogan) instRows.push([cfg.slogan]);
    if (cfg.directorName) instRows.push(['Director/a', cfg.directorName]);
    if (cfg.address) instRows.push(['Dirección', cfg.address]);
    if (cfg.phone) instRows.push(['Teléfono', cfg.phone]);
    if (cfg.email) instRows.push(['Correo', cfg.email]);
    instRows.push([]);
    instRows.push(['Reporte institucional generado con EdiAgil', 'Fecha', format(new Date(), 'dd/MM/yyyy')]);
    const wsInst = utils.aoa_to_sheet(instRows);
    wsInst['!cols'] = [{ wch: 40 }, { wch: 60 }];
    utils.book_append_sheet(wb, wsInst, 'Institución');
  }

  // Prefijos de hoja únicos: dos asignaturas pueden tener nombres que
  // colisionan al truncarse (p. ej. "Matemáticas — 1er Año A/B" → mismo
  // prefix de 20 chars), lo que hacía fallar book_append_sheet.
  const usedPrefixes = new Set<string>();
  const uniquePrefix = (name: string) => {
    let prefix = name ? name.replace(/[^a-z0-9]/gi, '_').substring(0, 20) : 'asignatura';
    let candidate = prefix;
    for (let i = 2; usedPrefixes.has(candidate); i++) {
      candidate = `${prefix}_${i}`.substring(0, 20);
    }
    usedPrefixes.add(candidate);
    return candidate;
  };

  for (const sub of teacherData.subjects) {
    const subject = {
      id: sub.id,
      name: sub.name,
      color: sub.color,
      teacher: sub.teacher,
      schedule: sub.schedule,
      periodo: sub.periodo || null,
      nivelEducativo: sub.nivelEducativo || null,
      plan: sub.plan,
    };
    const prefix = uniquePrefix(sub.name || '');
    buildSubjectWorkbook(utils, wb, subject, {
      students: sub.students || [],
      subjectModules: sub.subjectModules || [],
      evaluations: sub.evaluations || [],
      grades: sub.grades || [],
      attendance: sub.attendance || [],
    }, settings, teacherData.teacher.displayName, prefix);
  }

  const safeName = (teacherData.teacher.displayName || 'docente').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const safeSuffix = filenameSuffix && filenameSuffix.trim()
    ? `-${filenameSuffix.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`
    : '';
  const filename = `reporte-docente-${safeName}${safeSuffix}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  writeFile(wb, filename);
}

/**
 * Exporta a Excel el reporte de UNA asignatura de un docente, usando el
 * payload de `adminGetTeacherSummary`. Produce el MISMO reporte que el
 * docente genera para esa asignatura desde su cuaderno.
 */
export async function exportTeacherSubjectToExcel(
  teacherData: AdminTeacherDataResponse | AdminTeacherSummaryResponse,
  subjectId: string,
) {
  const { utils, writeFile } = await import('xlsx');
  const sub = teacherData.subjects.find(s => s.id === subjectId);
  if (!sub) return;

  const settings = settingsFromUserSettings(teacherData.settings);
  const wb = utils.book_new();

  const subject = {
    id: sub.id,
    name: sub.name,
    color: sub.color,
    teacher: sub.teacher,
    schedule: sub.schedule,
    periodo: sub.periodo || null,
    plan: sub.plan,
  };
  const prefix = sub.name ? sub.name.replace(/[^a-z0-9]/gi, '_').substring(0, 20) : 'asignatura';
  buildSubjectWorkbook(utils, wb, subject, {
    students: sub.students || [],
    subjectModules: sub.subjectModules || [],
    evaluations: sub.evaluations || [],
    grades: sub.grades || [],
    attendance: sub.attendance || [],
  }, settings, teacherData.teacher.displayName, prefix);

  const safeName = (sub.name || 'asignatura').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const filename = `reporte-${safeName}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  writeFile(wb, filename);
}

export async function exportInstitutionalReport(elementId: string, filename: string): Promise<void> {
  const element = document.getElementById(elementId);
  if (!element) throw new Error(`Elemento ${elementId} no encontrado`);
  // Mismo resultado visual que html2pdf.js por defecto: margen 10 mm, A4
  // vertical, JPEG 0.98, escala 2. html2canvas-pro soporta oklch (Tailwind 4).
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
  });
  const imgData = canvas.toDataURL('image/jpeg', 0.98);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const imgWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const usable = pageHeight - margin * 2;
  let position = margin;
  pdf.addImage(imgData, 'JPEG', margin, position, imgWidth, imgHeight);
  let heightLeft = imgHeight - usable;
  while (heightLeft > 0) {
    position = margin - (imgHeight - heightLeft);
    pdf.addPage();
    pdf.addImage(imgData, 'JPEG', margin, position, imgWidth, imgHeight);
    heightLeft -= usable;
  }
  pdf.save(filename);
}
