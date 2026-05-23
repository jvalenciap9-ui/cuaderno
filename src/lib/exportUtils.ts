import { format } from 'date-fns';
import { collection, query, where, getDocs, doc, getDoc, limit } from 'firebase/firestore';
import { db } from './firebase';
import { safeJSONParse } from './utils';
import { STORAGE_KEYS, getStorageItem } from './storageKeys';

// Helper function to calculate grades
const parseWeights = (data: string | null) => {
  const defaultWeights = { 
    teorica: { name: 'Teórica', value: 30 }, 
    practica: { name: 'Práctica', value: 60 }, 
    apreciativa: { name: 'Apreciativa', value: 10 },
    checkpoint: { name: 'Agregar 4ta Nota', value: 0 }
  };
  if (!data) return defaultWeights;
  try {
    const parsed = safeJSONParse<Record<string, unknown> | null>(data, null);
    if (!parsed) return defaultWeights;
    const output = { ...defaultWeights };
    (['teorica', 'practica', 'apreciativa', 'checkpoint'] as const).forEach(key => {
      const val = parsed[key];
      if (val !== undefined) {
        if (typeof val === 'number') {
          output[key].value = val;
        } else if (typeof val === 'object' && val !== null) {
          const w = val as { value?: number; name?: string };
          output[key].value = typeof w.value === 'number' ? w.value : (parseFloat(String(w.value)) || output[key].value);
          output[key].name = w.name ?? output[key].name;
        }
      }
    });
    return output;
  } catch (e) {
    return defaultWeights;
  }
};

export async function exportSubjectDataToExcel(userId: string, userName: string | null, subjectId: string) {
  const { utils, writeFile } = await import('xlsx');
  const subjectDoc = await getDoc(doc(db, 'subjects', subjectId));
  if (!subjectDoc.exists()) return;
  const subject = { id: subjectDoc.id, ...subjectDoc.data() } as any;

  const validSubjects = [subject];
  const wb = utils.book_new();

  const weights = parseWeights(getStorageItem(STORAGE_KEYS.GRADING_WEIGHTS));
  const savedScale = getStorageItem(STORAGE_KEYS.GRADING_SCALE);
  const gradingScale = safeJSONParse(savedScale, { maxScore: 100 });
  const useCheckpoint = safeJSONParse(getStorageItem(STORAGE_KEYS.USE_CHECKPOINT), false);

  for (const sub of validSubjects) {
     const sId = sub.id;
     
     const studentsSnap = await getDocs(query(collection(db, 'students'), where('userId', '==', userId), where('subjectId', '==', sId), limit(500)));
     const students = studentsSnap.docs.map(d => ({id: d.id, ...d.data()})) as any[];
     const sortedStudents = students.sort((a, b) => (a.lastName || '').localeCompare(b.lastName || ''));

     const modulesSnap = await getDocs(query(collection(db, 'subjectModules'), where('userId', '==', userId), where('subjectId', '==', sId), limit(500)));
     const subjectModules = modulesSnap.docs.map(d => ({id: d.id, ...d.data()})) as any[];
     subjectModules.sort((a, b) => (a.order || 0) - (b.order || 0));

     const evalsSnap = await getDocs(query(collection(db, 'evaluations'), where('userId', '==', userId), where('subjectId', '==', sId), limit(500)));
     let evaluations = evalsSnap.docs.map(d => ({id: d.id, ...d.data()})) as any[];
     evaluations.sort((a,b) => (a.date || '').localeCompare(b.date || ''));

     const gradesSnap = await getDocs(query(collection(db, 'grades'), where('userId', '==', userId), where('subjectId', '==', sId), limit(500)));
     const allGrades = gradesSnap.docs.map(d => ({id: d.id, ...d.data()})) as any[];

     const attendanceSnap = await getDocs(query(collection(db, 'attendance'), where('userId', '==', userId), where('subjectId', '==', sId), limit(500)));
     let attendanceSessions = attendanceSnap.docs.map(d => ({id: d.id, ...d.data()})) as any[];
     attendanceSessions.sort((a,b) => (a.date || '').localeCompare(b.date || ''));

     const buildSheetHeaders = (sheetTitle: string, moduleTitle?: string) => {
        const dateStr = new Date().toLocaleDateString('es-ES');
        const timeStr = new Date().toLocaleTimeString('es-ES');
        const dayStr = new Date().toLocaleDateString('es-ES', { weekday: 'long' });
        return [
          ['Reporte', sheetTitle],
          ['Asignatura', sub.name || sub.title || 'Asignatura'],
          ...(moduleTitle ? [['Plan / Módulo', moduleTitle]] : []),
          ['Profesor', sub.teacher || userName || 'Profesor Asignado'], 
          ['Fecha', `${dayStr}, ${dateStr} a las ${timeStr}`],
          []
        ];
      };

    const modulesToExport = subjectModules.length > 0 
      ? [...subjectModules, { id: null, title: 'Generales / Sin Asignar', order: 999, startDate: null, endDate: null }]
      : [{ id: null, title: 'General', order: 0, startDate: null, endDate: null }];

    const calculateFinalGrade = (studentId: string, evalsSubset: typeof evaluations) => {
      const studentGrades = allGrades.filter(g => g.studentId === studentId);
      
      const categories: { id: string; weight: number }[] = [
        { id: 'teorica', weight: weights.teorica.value },
        { id: 'practica', weight: weights.practica.value },
        { id: 'apreciativa', weight: weights.apreciativa.value }
      ];
      
      if (useCheckpoint) {
        categories.push({ id: 'checkpoint', weight: weights.checkpoint.value });
      }

      let weightedSum = 0;
      let totalWeightUsed = 0;
      categories.forEach(cat => {
        const typeEvals = evalsSubset.filter(e => e.type === cat.id);
        if (typeEvals.length > 0) {
          totalWeightUsed += cat.weight;
          let sumPct = 0;
          typeEvals.forEach(ev => {
            const grade = studentGrades.find(g => g.evaluationId === ev.id);
            const score = grade?.score || 0;
            const max = ev.maxScore || 100;
            sumPct += (score / max);
          });
          const avg = sumPct / typeEvals.length;
          weightedSum += avg * cat.weight;
        }
      });

      const finalGrade = totalWeightUsed > 0 ? (weightedSum / totalWeightUsed) * (gradingScale.maxScore || 100) : 0;
      return Math.round(finalGrade * 10) / 10;
    };

    for (const mod of modulesToExport) {
      let modEvals = evaluations.filter(e => e.moduleId === mod.id);
      if (mod.id === null && subjectModules.length > 0) {
        const assignedIds = new Set(subjectModules.map(m => m.id));
        modEvals = evaluations.filter(e => !e.moduleId || !assignedIds.has(e.moduleId));
      }

      modEvals = modEvals.filter(e => allGrades.some(g => g.evaluationId === e.id && typeof g.score === 'number'));

      let modAttendance = [...attendanceSessions];
      if (mod.id !== null) {
        const startTimestamp = mod.startDate ? new Date(mod.startDate).getTime() : null;
        let endTimestamp = mod.endDate ? new Date(mod.endDate).getTime() : null;
        if (endTimestamp) endTimestamp += 86400000 - 1; 

        modAttendance = attendanceSessions.filter(a => {
          const aTime = new Date(a.date).getTime();
          if (startTimestamp && endTimestamp) return aTime >= startTimestamp && aTime <= endTimestamp;
          return false;
        });
      } else if (subjectModules.length > 0) {
         modAttendance = attendanceSessions.filter(a => {
           const aTime = new Date(a.date).getTime();
           for (const sm of subjectModules!) {
             const ms = sm.startDate ? new Date(sm.startDate).getTime() : null;
             let me = sm.endDate ? new Date(sm.endDate).getTime() : null;
             if (me) me += 86400000 - 1;
             if (ms && me && aTime >= ms && aTime <= me) return false;
           }
           return true;
         });
      }

      if (subjectModules.length > 0 && modEvals.length === 0 && modAttendance.length === 0 && mod.id === null) {
        continue;
      }

      const prefix = subjectModules.length > 0 ? (mod.id === null ? 'Gen' : `M${mod.order}`) : '';

      if (modEvals.length > 0 || mod.id === null) {
        const gradesHeaderRows = buildSheetHeaders('Calificaciones', mod.title);
        const evaluationTitles = modEvals.map(e => `${e.title} (${e.maxScore || 100} pts)`);
        const gradesTableHeader = ['Estudiante', 'Cédula', ...evaluationTitles, 'Promedio'];
        const gradesTableRows = sortedStudents.map(s => {
          const studentGrades = modEvals.map(e => {
            const g = allGrades.find(grade => grade.studentId === s.id && grade.evaluationId === e.id);
            return g ? g.score : 0;
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
        utils.book_append_sheet(wb, wsGrades, gradesSheetName);
      }

      if (modAttendance.length > 0 || mod.id === null) {
        const attendanceHeaderRows = buildSheetHeaders('Asistencia', mod.title);
        let uniqueDates = Array.from(new Set(modAttendance.map(s => s.date))).sort();
        
        uniqueDates = uniqueDates.filter(dateStr => {
          const dateObj = new Date(dateStr);
          const day = new Date(dateObj.getTime() + dateObj.getTimezoneOffset() * 60000).getDay();
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
        utils.book_append_sheet(wb, wsAttendance, attSheetName);
      }
    }
  }

  const filename = `reporte-${subject.name ? subject.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'asignatura'}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  writeFile(wb, filename);
}
