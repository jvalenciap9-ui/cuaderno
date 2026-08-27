import { db } from './firebase';
import { collection, query, where, getDocs, doc, getDoc, orderBy, startAfter, writeBatch } from 'firebase/firestore';
import { executeBatchChunked, createSetOp, createDeleteOp } from './batchUtils';
import { getSubjectCount, getSubjectsCreatedThisYear, addSubjectCounterOp } from './subjectCounter';
import { MIN_MATERIAS_AULA, MAX_MATERIAS_AULA } from './classGroups';

export interface SubjectBackupData {
  version: string;
  exportedAt: number;
  subject: {
    name: string;
    color: string;
    teacher: string;
    schedule: string;
    periodo?: string | null;
    nivelEducativo?: string | null;
    plan?: string;
    startDate?: string;
    endDate?: string;
  };
  modules: any[];
  students: any[];
  evaluations: any[];
  grades: any[];
  attendance: any[];
  notes: any[];
  materials: any[];
  calendarEvents: any[];
}

/**
 * Valida si un objeto JSON tiene el formato correcto de respaldo de EdiAgil.
 */
export function isValidBackup(data: any): data is SubjectBackupData {
  return (
    data &&
    typeof data === 'object' &&
    typeof data.version === 'string' &&
    data.subject &&
    typeof data.subject.name === 'string' &&
    Array.isArray(data.modules) &&
    Array.isArray(data.students) &&
    Array.isArray(data.evaluations) &&
    Array.isArray(data.grades) &&
    Array.isArray(data.attendance) &&
    Array.isArray(data.notes) &&
    Array.isArray(data.materials) &&
    Array.isArray(data.calendarEvents)
  );
}

async function getAllDocsForSubject(colName: string, subjectId: string, userId: string) {
  const allDocs: any[] = [];
  let lastDoc: any = null;
  for (;;) {
    let q = query(collection(db, colName), where('subjectId', '==', subjectId), where('userId', '==', userId), orderBy('__name__', 'asc'));
    if (lastDoc) q = query(q, startAfter(lastDoc));
    const snap = await getDocs(q);
    if (snap.docs.length === 0) break;
    allDocs.push(...snap.docs.map(d => ({ id: d.id, ...d.data() })));
    lastDoc = snap.docs[snap.docs.length - 1];
  }
  return allDocs;
}

/**
 * Exporta el 100% de los datos de una asignatura en formato JSON.
 */
export async function exportSubjectToJSON(userId: string, subjectId: string): Promise<SubjectBackupData> {
  const subjectRef = doc(db, 'subjects', subjectId);
  const subjectSnap = await getDoc(subjectRef);

  if (!subjectSnap.exists()) {
    throw new Error('Asignatura no encontrada');
  }

  const subjectData = subjectSnap.data();

  // Sub-colecciones asociadas a exportar
  const collectionsToExport = [
    'subjectModules',
    'students',
    'evaluations',
    'grades',
    'attendance',
    'notes',
    'materials',
    'calendarEvents'
  ];

  const fetchedData: Record<string, any[]> = {};

  for (const collName of collectionsToExport) {
    fetchedData[collName] = await getAllDocsForSubject(collName, subjectId, userId);
  }

  return {
    version: '1.0',
    exportedAt: Date.now(),
    subject: {
      name: subjectData.name || '',
      color: subjectData.color || '#4f46e5',
      teacher: subjectData.teacher || '',
      schedule: subjectData.schedule || '',
      periodo: subjectData.periodo || null,
      nivelEducativo: subjectData.nivelEducativo || null,
      plan: subjectData.plan,
      startDate: subjectData.startDate,
      endDate: subjectData.endDate,
    },
    modules: fetchedData['subjectModules'] || [],
    students: fetchedData['students'] || [],
    evaluations: fetchedData['evaluations'] || [],
    grades: fetchedData['grades'] || [],
    attendance: fetchedData['attendance'] || [],
    notes: fetchedData['notes'] || [],
    materials: fetchedData['materials'] || [],
    calendarEvents: fetchedData['calendarEvents'] || [],
  };
}

/**
 * Descarga los datos exportados como un archivo JSON.
 */
export function triggerJSONDownload(backup: SubjectBackupData, subjectName: string) {
  const jsonString = JSON.stringify(backup, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const safeName = subjectName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  link.download = `ediagil-asignatura-${safeName}-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Importa los datos de una asignatura desde un JSON restaurando las relaciones mediante mapeo de IDs.
 */
export async function importSubjectFromJSON(
  userId: string,
  backup: SubjectBackupData,
  mode: 'create' | 'overwrite',
  targetSubjectId?: string
): Promise<string> {
  let subjectId = targetSubjectId;
  const batchOps: any[] = [];

  if (mode === 'create') {
    // Generar un nuevo ID de asignatura
    const newSubjectRef = doc(collection(db, 'subjects'));
    subjectId = newSubjectRef.id;

    batchOps.push(createSetOp(newSubjectRef, {
      ...backup.subject,
      userId,
      createdAt: Date.now()
    }));
  } else {
    if (!subjectId) {
      throw new Error('ID de asignatura de destino no especificado para sobrescribir');
    }

    // Actualizar datos de la asignatura existente
    const existingSubjectRef = doc(db, 'subjects', subjectId);
    batchOps.push(createSetOp(existingSubjectRef, {
      ...backup.subject,
      userId
    }));

    // Eliminar sub-colecciones existentes para esta asignatura y usuario
    const subCollections = [
      'subjectModules',
      'students',
      'evaluations',
      'grades',
      'attendance',
      'notes',
      'materials',
      'calendarEvents'
    ];

    for (const collName of subCollections) {
      const existing = await getAllDocsForSubject(collName, subjectId, userId);
      existing.forEach(docSnap => {
        batchOps.push(createDeleteOp(doc(db, collName, docSnap.id)));
      });
    }
  }

  if (mode === 'create') {
    // La regla de seguridad exige incrementar el contador +1 en el mismo batch
    const currentCount = await getSubjectCount(userId);
    const { createdThisYear, yearKey } = await getSubjectsCreatedThisYear(userId);
    const year = String(new Date().getFullYear());
    let nextYearKey = yearKey || year;
    let nextCreatedThisYear = createdThisYear;
    if (nextYearKey === year) {
      nextCreatedThisYear = createdThisYear + 1;
    } else {
      nextCreatedThisYear = 1;
      nextYearKey = year;
    }
    batchOps.push(createSetOp(doc(db, 'userCounters', userId), {
      subjectCount: currentCount + 1,
      createdThisYear: nextCreatedThisYear,
      yearKey: nextYearKey,
      updatedAt: Date.now(),
    }));
  }

  // Mapeos para convertir IDs antiguos a nuevos IDs autogenerados por Firestore
  const moduleMap: Record<string, string> = {};
  const studentMap: Record<string, string> = {};
  const evaluationMap: Record<string, string> = {};

  // 1. Mapear y escribir módulos
  backup.modules.forEach(oldMod => {
    if (oldMod.id) {
      const newRef = doc(collection(db, 'subjectModules'));
      moduleMap[oldMod.id] = newRef.id;
    }
  });

  backup.modules.forEach(oldMod => {
    if (oldMod.id) {
      const newId = moduleMap[oldMod.id];
      const newRef = doc(db, 'subjectModules', newId);

      const newParentId = oldMod.parentId ? moduleMap[oldMod.parentId] : null;

      const moduleData: any = {
        userId,
        subjectId,
        title: oldMod.title || '',
        description: oldMod.description || '',
        order: typeof oldMod.order === 'number' ? oldMod.order : 0,
        createdAt: oldMod.createdAt || Date.now(),
      };

      if (newParentId) moduleData.parentId = newParentId;
      if (oldMod.startDate) moduleData.startDate = oldMod.startDate;
      if (oldMod.endDate) moduleData.endDate = oldMod.endDate;

      batchOps.push(createSetOp(newRef, moduleData));
    }
  });

  // 2. Mapear y escribir estudiantes (participantes)
  backup.students.forEach(oldStudent => {
    if (oldStudent.id) {
      const newRef = doc(collection(db, 'students'));
      studentMap[oldStudent.id] = newRef.id;
    }
  });

  backup.students.forEach(oldStudent => {
    if (oldStudent.id) {
      const newId = studentMap[oldStudent.id];
      const newRef = doc(db, 'students', newId);

      const studentData: any = {
        userId,
        subjectId,
        cedula: oldStudent.cedula || '',
        firstName: oldStudent.firstName || '',
        lastName: oldStudent.lastName || '',
      };

      if (oldStudent.gender) studentData.gender = oldStudent.gender;

      batchOps.push(createSetOp(newRef, studentData));
    }
  });

  // 3. Mapear y escribir evaluaciones
  backup.evaluations.forEach(oldEval => {
    if (oldEval.id) {
      const newRef = doc(collection(db, 'evaluations'));
      evaluationMap[oldEval.id] = newRef.id;
    }
  });

  backup.evaluations.forEach(oldEval => {
    if (oldEval.id) {
      const newId = evaluationMap[oldEval.id];
      const newRef = doc(db, 'evaluations', newId);

      const newModuleId = oldEval.moduleId ? moduleMap[oldEval.moduleId] : null;

      const evalData: any = {
        userId,
        subjectId,
        title: oldEval.title || '',
        maxScore: typeof oldEval.maxScore === 'number' ? oldEval.maxScore : 100,
        date: oldEval.date || new Date().toISOString().split('T')[0],
        type: oldEval.type || 'teorica',
      };

      if (newModuleId) evalData.moduleId = newModuleId;

      batchOps.push(createSetOp(newRef, evalData));
    }
  });

  // 4. Escribir calificaciones (Grades)
  backup.grades.forEach(oldGrade => {
    const newStudentId = oldGrade.studentId ? studentMap[oldGrade.studentId] : null;
    const newEvaluationId = oldGrade.evaluationId ? evaluationMap[oldGrade.evaluationId] : null;

    if (newStudentId && newEvaluationId) {
      const newRef = doc(collection(db, 'grades'));

      const gradeData: any = {
        userId,
        subjectId,
        studentId: newStudentId,
        evaluationId: newEvaluationId,
        score: typeof oldGrade.score === 'number' ? oldGrade.score : 0,
      };

      batchOps.push(createSetOp(newRef, gradeData));
    }
  });

  // 5. Escribir asistencia (Attendance)
  backup.attendance.forEach(oldAtt => {
    const newStudentId = oldAtt.studentId ? studentMap[oldAtt.studentId] : null;

    if (newStudentId) {
      const newRef = doc(collection(db, 'attendance'));

      const attData: any = {
        userId,
        subjectId,
        studentId: newStudentId,
        date: oldAtt.date || new Date().toISOString().split('T')[0],
        status: oldAtt.status || 'present',
      };

      batchOps.push(createSetOp(newRef, attData));
    }
  });

  // 6. Escribir apuntes (Notes)
  backup.notes.forEach(oldNote => {
    const newRef = doc(collection(db, 'notes'));
    const newModuleId = oldNote.moduleId ? moduleMap[oldNote.moduleId] : null;

    const noteData: any = {
      userId,
      subjectId,
      title: oldNote.title || '',
      content: oldNote.content || '',
      date: oldNote.date || new Date().toISOString().split('T')[0],
      createdAt: oldNote.createdAt || Date.now(),
      updatedAt: oldNote.updatedAt || Date.now(),
    };

    if (newModuleId) noteData.moduleId = newModuleId;
    if (oldNote.startTime) noteData.startTime = oldNote.startTime;
    if (oldNote.endTime) noteData.endTime = oldNote.endTime;
    if (oldNote.attachment) noteData.attachment = oldNote.attachment;

    batchOps.push(createSetOp(newRef, noteData));
  });

  // 7. Escribir materiales (Materials)
  backup.materials.forEach(oldMat => {
    const newRef = doc(collection(db, 'materials'));
    const newModuleId = oldMat.moduleId ? moduleMap[oldMat.moduleId] : null;

    const matData: any = {
      userId,
      subjectId,
      title: oldMat.title || '',
      type: oldMat.type || 'other',
      date: oldMat.date || new Date().toISOString().split('T')[0],
    };

    if (newModuleId) matData.moduleId = newModuleId;
    if (oldMat.description) matData.description = oldMat.description;
    if (oldMat.observations) matData.observations = oldMat.observations;
    if (oldMat.attachment) matData.attachment = oldMat.attachment;

    batchOps.push(createSetOp(newRef, matData));
  });

  // 8. Escribir eventos del calendario (CalendarEvents)
  backup.calendarEvents.forEach(oldEvent => {
    const newRef = doc(collection(db, 'calendarEvents'));
    const newModuleId = oldEvent.moduleId ? moduleMap[oldEvent.moduleId] : null;

    const eventData: any = {
      userId,
      subjectId,
      title: oldEvent.title || '',
      date: oldEvent.date || new Date().toISOString().split('T')[0],
      type: oldEvent.type || 'other',
    };

    if (newModuleId) eventData.moduleId = newModuleId;
    if (oldEvent.startTime) eventData.startTime = oldEvent.startTime;
    if (oldEvent.endTime) eventData.endTime = oldEvent.endTime;
    if (oldEvent.topic) eventData.topic = oldEvent.topic;
    if (oldEvent.description) eventData.description = oldEvent.description;
    if (oldEvent.order) eventData.order = oldEvent.order;

    batchOps.push(createSetOp(newRef, eventData));
  });

  // Ejecutar operaciones en chunks
  await executeBatchChunked(db, batchOps);

  return subjectId!;
}

// ═══════════════════════════════════════════════════════════════════════════
// Aula/Grupo multiasignatura — respaldo v1.1
//
// Estructura nueva (version '1.1'): el aula completa en un archivo.
// - `classGroup`: metadatos del aula.
// - `materias[]`: UNA entrada POR materia con sus datos académicos PROPIOS
//   (subject meta, módulos, evaluaciones, calificaciones, apuntes,
//   materiales, eventos). NUNCA incluye estudiantes ni asistencia.
// - `students`/`attendance`: la lista COMPARTIDA una sola vez (la que vive
//   en la asignatura canónica del aula).
//
// Compatibilidad: isValidBackup sigue aceptando v1.0 (asignatura suelta) sin
// cambios; los respaldos antiguos se importan exactamente igual que antes.
// La restauración usa COMMITS POR FASES (aula+materias → participantes/
// asistencia → evaluaciones → notas/materiales/eventos/calificaciones)
// porque las reglas de seguridad evalúan `get()` contra el estado previo al
// batch: cada fase encuentra sus documentos padre ya confirmados.
// ═══════════════════════════════════════════════════════════════════════════

export interface MateriaBackupData {
  subject: SubjectBackupData['subject'];
  modules: any[];
  evaluations: any[];
  grades: any[];
  notes: any[];
  materials: any[];
  calendarEvents: any[];
}

export interface ClassGroupBackupData {
  version: '1.1';
  exportedAt: number;
  classGroup: {
    name: string;
    modalidad: 'varias';
    nivelEducativo?: string;
    grado?: string;
    seccion?: string;
    periodo?: string;
  };
  materias: MateriaBackupData[];
  students: any[];
  attendance: any[];
}

/** Valida un respaldo de AULA (v1.1). Los de asignatura (v1.0) siguen usan isValidBackup. */
export function isValidGroupBackup(data: any): data is ClassGroupBackupData {
  return (
    data &&
    typeof data === 'object' &&
    data.version === '1.1' &&
    data.classGroup &&
    typeof data.classGroup.name === 'string' &&
    data.classGroup.modalidad === 'varias' &&
    Array.isArray(data.materias) &&
    data.materias.length >= MIN_MATERIAS_AULA &&
    data.materias.length <= MAX_MATERIAS_AULA &&
    data.materias.every(
      (m: any) =>
        m &&
        m.subject &&
        typeof m.subject.name === 'string' &&
        Array.isArray(m.modules) &&
        Array.isArray(m.evaluations) &&
        Array.isArray(m.grades) &&
        Array.isArray(m.notes) &&
        Array.isArray(m.materials) &&
        Array.isArray(m.calendarEvents),
    ) &&
    Array.isArray(data.students) &&
    Array.isArray(data.attendance)
  );
}

/**
 * Exporta el AULA COMPLETA: metadatos + materias con lo suyo + lista
 * compartida de participantes y asistencia diaria (una sola vez).
 */
export async function exportClassGroupToJSON(
  userId: string,
  groupId: string,
  groupName: string,
  materias: { id: string; name: string }[],
): Promise<ClassGroupBackupData> {
  // La lista compartida vive bajo la canónica (menor createdAt → la primera
  // del orden estable; las materias llegan ya ordenadas desde classGroups).
  const canonicalId = materias[0]?.id;

  const sharedStudents = canonicalId ? await getAllDocsForSubject('students', canonicalId, userId) : [];
  const sharedAttendance = canonicalId ? await getAllDocsForSubject('attendance', canonicalId, userId) : [];

  const materiasBackup: MateriaBackupData[] = [];
  for (const m of materias) {
    const snap = await getDoc(doc(db, 'subjects', m.id));
    if (!snap.exists()) continue;
    const s = snap.data();
    materiasBackup.push({
      subject: {
        name: s.name || '',
        color: s.color || '#4f46e5',
        teacher: s.teacher || '',
        schedule: s.schedule || '',
        periodo: s.periodo || null,
        nivelEducativo: s.nivelEducativo || null,
        plan: s.plan,
        startDate: s.startDate,
        endDate: s.endDate,
      },
      modules: await getAllDocsForSubject('subjectModules', m.id, userId),
      evaluations: await getAllDocsForSubject('evaluations', m.id, userId),
      grades: await getAllDocsForSubject('grades', m.id, userId),
      notes: await getAllDocsForSubject('notes', m.id, userId),
      materials: await getAllDocsForSubject('materials', m.id, userId),
      calendarEvents: await getAllDocsForSubject('calendarEvents', m.id, userId),
    });
  }

  return {
    version: '1.1',
    exportedAt: Date.now(),
    classGroup: { name: groupName, modalidad: 'varias' },
    materias: materiasBackup,
    students: sharedStudents,
    attendance: sharedAttendance,
  };
}

export function triggerGroupJSONDownload(backup: ClassGroupBackupData, groupName: string) {
  const jsonString = JSON.stringify(backup, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const safeName = groupName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  link.download = `ediagil-aula-${safeName}-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Restaura un aula completa desde un respaldo v1.1 SIN duplicados:
 * nuevos ids para todo, relaciones remapeadas (módulos/evaluaciones/
 * estudiantes), estudiantes+asistencia bajo la PRIMERA materia (canónica)
 * y calificaciones vinculadas a SU materia (regla: hermanas del mismo aula).
 * El aula consume UNA unidad del contador (+1), no una por materia.
 */
export async function importClassGroupFromJSON(userId: string, backup: ClassGroupBackupData): Promise<{ groupId: string; firstMateriaId: string }> {
  if (!isValidGroupBackup(backup)) {
    const materiasArr = (backup as any)?.materias;
    if (Array.isArray(materiasArr) && materiasArr.length > MAX_MATERIAS_AULA) {
      throw new Error(`Un aula multiasignatura no puede tener más de ${MAX_MATERIAS_AULA} materias.`);
    }
    throw new Error('Respaldo de aula inválido.');
  }

  const now = Date.now();

  // ── FASE 1: aula + materias + contador ──────────────────────────────────
  const groupRef = doc(collection(db, 'classGroups'));
  const firstBatch = writeBatch(db);
  firstBatch.set(groupRef, {
    userId,
    name: String(backup.classGroup.name || 'Aula').slice(0, 200),
    nivelEducativo: backup.classGroup.nivelEducativo || '',
    grado: backup.classGroup.grado || '',
    seccion: backup.classGroup.seccion || '',
    periodo: backup.classGroup.periodo || '',
    modalidad: 'varias',
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  });

  const materiaIds: string[] = [];
  backup.materias.forEach((m, idx) => {
    const ref = doc(collection(db, 'subjects'));
    materiaIds.push(ref.id);
    firstBatch.set(ref, {
      userId,
      groupId: groupRef.id,
      name: m.subject.name || `Materia ${idx + 1}`,
      color: m.subject.color || '#4f46e5',
      teacher: m.subject.teacher || '',
      schedule: m.subject.schedule || '',
      periodo: m.subject.periodo ?? null,
      nivelEducativo: m.subject.nivelEducativo ?? null,
      startDate: m.subject.startDate || '',
      endDate: m.subject.endDate || '',
      plan: m.subject.plan || 'otro',
      createdAt: now + idx, // canónica = primera
    });
  });

  // El aula consume UNA unidad (las materias internas no consumen cuota).
  await addSubjectCounterOp(firstBatch, userId, +1);
  await firstBatch.commit();
  const firstMateriaId = materiaIds[0];

  // ── FASE 2: participantes compartidos + asistencia diaria (canónica) ────
  const studentMap: Record<string, string> = {};
  const phase2Ops: any[] = [];
  backup.students.forEach((oldStudent) => {
    if (!oldStudent?.id) return;
    const newRef = doc(collection(db, 'students'));
    studentMap[oldStudent.id] = newRef.id;
    const studentData: any = {
      userId,
      subjectId: firstMateriaId,
      cedula: oldStudent.cedula || '',
      firstName: oldStudent.firstName || '',
      lastName: oldStudent.lastName || '',
    };
    if (oldStudent.gender) studentData.gender = oldStudent.gender;
    phase2Ops.push(createSetOp(newRef, studentData));
  });
  backup.attendance.forEach((oldAtt) => {
    const newStudentId = oldAtt?.studentId ? studentMap[oldAtt.studentId] : null;
    if (!newStudentId) return;
    phase2Ops.push(createSetOp(doc(collection(db, 'attendance')), {
      userId,
      subjectId: firstMateriaId,
      studentId: newStudentId,
      date: oldAtt.date || new Date().toISOString().split('T')[0],
      status: oldAtt.status || 'present',
    }));
  });
  await executeBatchChunked(db, phase2Ops);

  // ── FASE 3: datos académicos POR MATERIA (módulos, evaluaciones, apuntes,
  //    materiales y eventos) con remapeo de ids dentro de cada materia.
  const gradePhaseOps: any[] = [];

  for (let idx = 0; idx < backup.materias.length; idx++) {
    const m = backup.materias[idx];
    const materiaId = materiaIds[idx];

    const moduleMap: Record<string, string> = {};
    const moduleOps: any[] = [];
    m.modules.forEach((oldMod) => {
      if (!oldMod?.id) return;
      const newRef = doc(collection(db, 'subjectModules'));
      moduleMap[oldMod.id] = newRef.id;
      const moduleData: any = {
        userId,
        subjectId: materiaId,
        title: oldMod.title || '',
        description: oldMod.description || '',
        order: typeof oldMod.order === 'number' ? oldMod.order : 0,
        createdAt: oldMod.createdAt || now,
      };
      const newParentId = oldMod.parentId ? moduleMap[oldMod.parentId] : null;
      if (newParentId) moduleData.parentId = newParentId;
      if (oldMod.startDate) moduleData.startDate = oldMod.startDate;
      if (oldMod.endDate) moduleData.endDate = oldMod.endDate;
      moduleOps.push(createSetOp(newRef, moduleData));
    });

    const evaluationMap: Record<string, string> = {};
    m.evaluations.forEach((oldEval) => {
      if (!oldEval?.id) return;
      const newRef = doc(collection(db, 'evaluations'));
      evaluationMap[oldEval.id] = newRef.id;
    });
    const evalOps: any[] = [];
    m.evaluations.forEach((oldEval) => {
      if (!oldEval?.id) return;
      const evalData: any = {
        userId,
        subjectId: materiaId,
        title: oldEval.title || '',
        maxScore: typeof oldEval.maxScore === 'number' ? oldEval.maxScore : 100,
        date: oldEval.date || new Date().toISOString().split('T')[0],
        type: oldEval.type || 'teorica',
      };
      const newModuleId = oldEval.moduleId ? moduleMap[oldEval.moduleId] : null;
      if (newModuleId) evalData.moduleId = newModuleId;
      evalOps.push(createSetOp(doc(db, 'evaluations', evaluationMap[oldEval.id]), evalData));
    });

    const noteOps: any[] = [];
    m.notes.forEach((oldNote) => {
      const noteData: any = {
        userId,
        subjectId: materiaId,
        title: oldNote.title || '',
        content: oldNote.content || '',
        date: oldNote.date || new Date().toISOString().split('T')[0],
        createdAt: oldNote.createdAt || now,
        updatedAt: oldNote.updatedAt || now,
      };
      const newModuleId = oldNote.moduleId ? moduleMap[oldNote.moduleId] : null;
      if (newModuleId) noteData.moduleId = newModuleId;
      if (oldNote.startTime) noteData.startTime = oldNote.startTime;
      if (oldNote.endTime) noteData.endTime = oldNote.endTime;
      if (oldNote.attachment) noteData.attachment = oldNote.attachment;
      noteOps.push(createSetOp(doc(collection(db, 'notes')), noteData));
    });

    const materialOps: any[] = [];
    m.materials.forEach((oldMat) => {
      const matData: any = {
        userId,
        subjectId: materiaId,
        title: oldMat.title || '',
        type: oldMat.type || 'other',
        date: oldMat.date || new Date().toISOString().split('T')[0],
      };
      const newModuleId = oldMat.moduleId ? moduleMap[oldMat.moduleId] : null;
      if (newModuleId) matData.moduleId = newModuleId;
      if (oldMat.description) matData.description = oldMat.description;
      if (oldMat.observations) matData.observations = oldMat.observations;
      if (oldMat.attachment) matData.attachment = oldMat.attachment;
      materialOps.push(createSetOp(doc(collection(db, 'materials')), matData));
    });

    const eventOps: any[] = [];
    m.calendarEvents.forEach((oldEvent) => {
      const eventData: any = {
        userId,
        subjectId: materiaId,
        title: oldEvent.title || '',
        date: oldEvent.date || new Date().toISOString().split('T')[0],
        type: oldEvent.type || 'other',
      };
      const newModuleId = oldEvent.moduleId ? moduleMap[oldEvent.moduleId] : null;
      if (newModuleId) eventData.moduleId = newModuleId;
      if (oldEvent.startTime) eventData.startTime = oldEvent.startTime;
      if (oldEvent.endTime) eventData.endTime = oldEvent.endTime;
      if (oldEvent.topic) eventData.topic = oldEvent.topic;
      if (oldEvent.description) eventData.description = oldEvent.description;
      if (oldEvent.order) eventData.order = oldEvent.order;
      eventOps.push(createSetOp(doc(collection(db, 'calendarEvents')), eventData));
    });

    await executeBatchChunked(db, [...moduleOps, ...evalOps, ...noteOps, ...materialOps, ...eventOps]);

    // Las CALIFICACIONES van a la última fase: necesitan evaluaciones Y
    // estudiantes ya confirmados para pasar las reglas (get() pre-batch).
    m.grades.forEach((oldGrade) => {
      const newStudentId = oldGrade?.studentId ? studentMap[oldGrade.studentId] : null;
      const newEvaluationId = oldGrade?.evaluationId ? evaluationMap[oldGrade.evaluationId] : null;
      if (!newStudentId || !newEvaluationId) return;
      gradePhaseOps.push(createSetOp(doc(collection(db, 'grades')), {
        userId,
        subjectId: materiaId, // nota vinculada a SU materia (hermana del aula)
        studentId: newStudentId,
        evaluationId: newEvaluationId,
        score: typeof oldGrade.score === 'number' ? oldGrade.score : 0,
      }));
    });
  }

  // ── FASE 4: calificaciones ────────────────────────────────────────────────
  await executeBatchChunked(db, gradePhaseOps);

  return { groupId: groupRef.id, firstMateriaId };
}
