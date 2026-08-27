import { collection, query, where, getDocs, doc, getDoc, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import type { Student, Grade, Attendance, SchoolConfig } from '../types/firestore';

export async function fetchStudentData(studentId: string): Promise<Student> {
  const studentDoc = await getDoc(doc(db, 'students', studentId));
  if (!studentDoc.exists()) throw new Error('Estudiante no encontrado');
  const data = studentDoc.data() as any;
  return {
    id: studentDoc.id,
    fullName: `${data.firstName || ''} ${data.lastName || ''}`.trim(),
    academicYear: data.academicYear || new Date().getFullYear().toString(),
    documentId: data.cedula || data.documentId || '',
    grade: data.grade || data.grado || '',
    section: data.section || data.seccion || '',
    counselor: data.counselor || data.consejero || '',
  };
}

export async function fetchGrades(studentId: string, period: 'I' | 'II' | 'III'): Promise<Grade[]> {
  const gradesCol = collection(db, 'grades');
  const q = query(gradesCol, where('studentId', '==', studentId), where('period', '==', period));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => {
    const data = doc.data() as any;
    return {
      subjectId: data.subjectId,
      subjectName: data.subjectName || data.name || 'Sin nombre',
      term1: data.term1 ?? data.trimestre1 ?? data.periodo1 ?? '-',
      term2: data.term2 ?? data.trimestre2 ?? data.periodo2 ?? '-',
      term3: data.term3 ?? data.trimestre3 ?? data.periodo3 ?? '-',
      finalGrade: data.finalGrade ?? data.notaFinal ?? 0,
    };
  });
}

export async function fetchAttendance(studentId: string, period: 'I' | 'II' | 'III'): Promise<Attendance> {
  const attendanceCol = collection(db, 'attendance');
  const q = query(attendanceCol, where('studentId', '==', studentId), where('period', '==', period));
  const snapshot = await getDocs(q);
  const records = snapshot.docs.map((doc) => doc.data() as any);

  const habits: Record<string, { I: string; II: string; III: string }> = {};
  const habitNames = [
    'RESPONSABILIDAD',
    'PUNTUALIDAD',
    'HONRADEZ',
    'CONCIENCIA CÍVICA',
    'ORGANIZACIÓN DEL TRABAJO',
    'AUTOD. Y CONF. EN SÍ MISMO',
    'INICIATIVA',
    'COOPERACIÓN',
    'RESPETO A LA PROPIEDAD AJENA',
    'MODALES',
    'ORDEN Y ASEO',
    'EMPLEO DEL TIEMPO LIBRE',
  ];

  for (const habit of habitNames) {
    const habitRecords = records.filter((r) => r.habit === habit);
    habits[habit] = {
      I: habitRecords.find((r) => r.trimester === 'I')?.value || 'S',
      II: habitRecords.find((r) => r.trimester === 'II')?.value || 'S',
      III: habitRecords.find((r) => r.trimester === 'III')?.value || 'S',
    };
  }

  const A1 = records.find((r) => r.code === 'A1')?.count || 0;
  const T1 = records.find((r) => r.code === 'T1')?.count || 0;
  const A2 = records.find((r) => r.code === 'A2')?.count || 0;
  const T2 = records.find((r) => r.code === 'T2')?.count || 0;
  const A3 = records.find((r) => r.code === 'A3')?.count || 0;
  const T3 = records.find((r) => r.code === 'T3')?.count || 0;

  return { A1, T1, A2, T2, A3, T3, habits };
}

export async function fetchSchoolConfig(schoolId: string): Promise<SchoolConfig> {
  const configDoc = await getDoc(doc(db, 'institutions', schoolId));
  if (!configDoc.exists()) return { schoolName: '', logoUrl: '' };
  const data = configDoc.data() as any;
  return {
    schoolName: data.name || data.schoolName || '',
    logoUrl: data.logoUrl || data.logo || '',
  };
}