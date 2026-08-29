import { format } from 'date-fns';
import React, { useState, useEffect } from 'react';
import { useCustomCollectionData } from "../lib/firestoreUtils";
import { collection, query, where, addDoc, updateDoc, doc, writeBatch, getDocs, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthProvider';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
import { Plus, Trash2, ChevronLeft, BarChart3, UserCheck, UserX, Info, Edit3, Download, ChevronRight, ChevronDown, AlertTriangle, MessageSquare } from 'lucide-react';
import { safeJSONParse, cn, parseLocalDate } from '../lib/utils';
import { GradesSummary } from './GradesSummary';
import { STORAGE_KEYS, getStorageItem } from '../lib/storageKeys';
import { parseWeights, calculateStudentGrades, formatDisplayGrade, type ViewMode, type CalculationMode } from '../lib/gradeCalculator';
import { useGradeSettings } from '../contexts/GradeSettingsContext';
import { weightedBreakdown } from '../lib/gradingUtils';
import { executeBatchChunked, createSetOp } from '../lib/batchUtils';

import { ModuleSummaryModal } from './ModuleSummaryModal';
import { exportSubjectDataToExcel } from '../lib/exportUtils';
import type { SubjectModuleDoc, EvaluationDoc, SubjectDoc } from '../types/firestore';
// Boletín v2: observaciones del boletín (consejero general + por asignatura).
import { useInstitution } from '../hooks/useInstitution';
import { currentPeriodKey } from '../lib/planPeriods';
import { loadObservationsForSubject, saveObservation } from '../lib/observations';
import { showToast } from '../hooks/useToast';
import { usePlan } from '../hooks/usePlan';
// Aula/Grupo multiasignatura: participantes compartidos + selector de materia.
import { useCanonicalSubjectId } from '../lib/classGroups';
import { MateriaSelector } from './MateriaSelector';

interface GradesTabProps {
  subjectId: string;
  /** Materias hermanas del aula (≥2 activa el selector de materia). */
  aulaMaterias?: SubjectDoc[];
  /** Solicita a App cambiar de materia dentro del mismo aula. */
  onSelectMateria?: (materiaId: string) => void;
}

export function GradesTab({ subjectId, aulaMaterias, onSelectMateria }: GradesTabProps) {
  const { user } = useAuth();
  const { isPro, isAdmin } = usePlan();
  const { gradingScale, weights, viewMode, calculationMode, useCheckpoint } = useGradeSettings();
  const [isAddingEval, setIsAddingEval] = useState(false);
  const [editingEvalId, setEditingEvalId] = useState<string | null>(null);
  const [evalTitle, setEvalTitle] = useState('');
  const [evalMaxScore, setEvalMaxScore] = useState('100');
  const [evalType, setEvalType] = useState<'teorica' | 'practica' | 'apreciativa'>('teorica');
  const [evalDate, setEvalDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [evalModuleId, setEvalModuleId] = useState<string | ''>('');
  
  const [selectedEvalId, setSelectedEvalId] = useState<string | null>(null);
  const [evalToDelete, setEvalToDelete] = useState<string | null>(null);
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});
  const [warningModalOpen, setWarningModalOpen] = useState(false);
  const [warningMessage, setWarningMessage] = useState<{ title: string, message: string }>({ title: '', message: '' });
  const [showModuleSummary, setShowModuleSummary] = useState(false);
  
  const [localScores, setLocalScores] = useState<Record<string, string>>({});
  const [savingGrades, setSavingGrades] = useState(false);
  const [consolidatedScores, setConsolidatedScores] = useState<Record<string, Record<string, string>>>({});
  const [pendingEdits, setPendingEdits] = useState<Record<string, { studentId: string; evaluationId: string; subjectId: string; scoreStr: string; maxScore: number }>>({});

  // Resetear estados al cambiar de materia activa para prevenir fugas de id de evaluación
  useEffect(() => {
    setSelectedEvalId(null);
    setLocalScores({});
    setConsolidatedScores({});
    setPendingEdits({});
  }, [subjectId]);

  // ── Aula/Grupo: los ESTUDIANTES y MÓDULOS GLOBALES viven en la asignatura canónica del aula
  // (lista compartida); evaluaciones y calificaciones siguen siendo de ESTA materia.
  const { canonicalId: sharedStudentListId } = useCanonicalSubjectId(subjectId);

  const studentsQuery = user?.uid ? query(collection(db, 'students'), where('userId', '==', user?.uid), where('subjectId', '==', sharedStudentListId), limit(500)) : null;
  const [students = []] = useCustomCollectionData(studentsQuery);

  const evaluationsQuery = user?.uid ? query(collection(db, 'evaluations'), where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500)) : null;
  const [evaluations = []] = useCustomCollectionData(evaluationsQuery);

  const gradesQuery = user?.uid ? query(collection(db, 'grades'), where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500)) : null;
  const [allGrades = []] = useCustomCollectionData(gradesQuery);

  const modulesQuery = user?.uid ? query(collection(db, 'subjectModules'), where('userId', '==', user?.uid), where('subjectId', '==', sharedStudentListId), limit(500)) : null;
  const [modules = []] = useCustomCollectionData(modulesQuery);

  const selectedEvalGradesQuery = selectedEvalId && user?.uid ? query(collection(db, 'grades'), where('userId', '==', user?.uid), where('evaluationId', '==', selectedEvalId), limit(500)) : null;
  const [grades = []] = useCustomCollectionData(selectedEvalGradesQuery);

  // ── Observaciones del boletín (boletín v2) ───────────────────────────────
  // Cada estudiante puede tener una observación GENERAL (docente consejero,
  // subjectId '') y una de ESTA asignatura. Cualquier docente puede escribir
  // la general (decisión documentada: EdiAgil no tiene campo "consejero").
  const { planRules } = useInstitution();
  const obsPeriod = currentPeriodKey(planRules.reglaSeleccionada);
  const [openObsStudentId, setOpenObsStudentId] = useState<string | null>(null);
  const [obsDrafts, setObsDrafts] = useState<Record<string, { general: string; subject: string }>>({});
  const [savingObs, setSavingObs] = useState(false);

  // Carga las observaciones existentes del docente para esta asignatura.
  useEffect(() => {
    let cancelled = false;
    if (!user?.uid || students.length === 0) return;
    loadObservationsForSubject(user.uid, subjectId, students.map((s) => s.id!)).then((byKey) => {
      if (cancelled) return;
      const drafts: Record<string, { general: string; subject: string }> = {};
      for (const st of students) {
        drafts[st.id!] = {
          general: byKey[`${st.id}|general|${obsPeriod}`] || '',
          subject: byKey[`${st.id}|${subjectId}|${obsPeriod}`] || '',
        };
      }
      setObsDrafts(drafts);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, subjectId, students.length, obsPeriod]);

  const handleSaveObservations = async (studentId: string) => {
    if (!user?.uid) return;
    const draft = obsDrafts[studentId];
    if (!draft || (!draft.general.trim() && !draft.subject.trim())) {
      showToast('info', 'Escribe al menos una observación para guardar.');
      return;
    }
    setSavingObs(true);
    try {
      let allOk = true;
      if (draft.general.trim()) {
        const r = await saveObservation({
          userId: user.uid,
          studentId,
          subjectId: '',
          period: obsPeriod,
          text: draft.general.trim(),
        });
        if (!r.firestoreOk) allOk = false;
      }
      if (draft.subject.trim()) {
        const r = await saveObservation({
          userId: user.uid,
          studentId,
          subjectId,
          period: obsPeriod,
          text: draft.subject.trim(),
        });
        if (!r.firestoreOk) allOk = false;
      }
      if (allOk) {
        showToast('success', 'Observación(es) guardada(s). Aparecerán en el boletín del periodo actual.');
        setOpenObsStudentId(null);
      } else {
        showToast('warning', 'Sin conexión: la observación se guardó en este dispositivo y se sincronizará después.');
      }
    } catch (err) {
      showToast('error', 'No se pudieron guardar las observaciones.');
    } finally {
      setSavingObs(false);
    }
  };

  const groupedEvaluations = React.useMemo(() => {
    const parents = modules.filter(m => !m.parentId);
    const children = modules.filter(m => m.parentId);

    const getEvalsForMod = (mod: SubjectModuleDoc) => {
      const start = mod.startDate ? parseLocalDate(mod.startDate).getTime() : null;
      let end = mod.endDate ? parseLocalDate(mod.endDate).getTime() : null;
      if (end) {
        end = end + 86400000 - 1; 
      }
      
      return evaluations.filter(ev => {
        if (ev.moduleId === mod.id) return true;
        if (ev.moduleId) return false; // Belongs to a different module
        if (!ev.date) return false;
        
        const evDate = parseLocalDate(ev.date).getTime();
        if (start && end) {
          return evDate >= start && evDate <= end;
        }
        return false;
      });
    };

    const assignedEvalIds = new Set<string>();

    const parentGroups = parents.map(pm => {
      const cms = children.filter(c => c.parentId === pm.id);
      const subModules = cms.map(cm => {
        const evs = getEvalsForMod(cm);
        evs.forEach(e => assignedEvalIds.add(e.id!));
        return { module: cm, evals: evs };
      });
      const parentEvals = getEvalsForMod(pm).filter(e => !assignedEvalIds.has(e.id!));
      parentEvals.forEach(e => assignedEvalIds.add(e.id!));

      return {
        parentModule: pm,
        parentEvals,
        subModules
      };
    });

    const unassignedEvals = evaluations.filter(ev => !assignedEvalIds.has(ev.id!));
    const groups = [...parentGroups];

    if (unassignedEvals.length > 0) {
      groups.push({
        parentModule: null,
        parentEvals: unassignedEvals,
        subModules: []
      });
    }

    return groups;
  }, [evaluations, modules]);

  useEffect(() => {
    if (groupedEvaluations.length > 0) {
      const tourSubjectId = localStorage.getItem('tour_subject_id');
      if (tourSubjectId === subjectId) {
        const firstGroupId = groupedEvaluations[0].parentModule
          ? `module-${groupedEvaluations[0].parentModule.id}`
          : 'unassigned';
        setExpandedModules(prev => {
          if (prev[firstGroupId]) return prev;
          return { ...prev, [firstGroupId]: true };
        });
      }
    }
  }, [groupedEvaluations, subjectId]);

  const toggleModule = (id: string) => {
    setExpandedModules(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const processAddEval = async () => {
    if (!evalTitle || !evalMaxScore || !user) return;

    try {
      if (editingEvalId) {
        await updateDoc(doc(db, 'evaluations', editingEvalId), {
          title: evalTitle,
          date: evalDate,
          type: evalType,
          maxScore: Number(evalMaxScore),
          moduleId: evalModuleId ? evalModuleId : null,
          subjectId
        });
      } else {
        const docRef = await addDoc(collection(db, 'evaluations'), {
          userId: user.uid,
          subjectId,
          title: evalTitle,
          maxScore: Number(evalMaxScore),
          date: evalDate,
          type: evalType,
          moduleId: evalModuleId ? evalModuleId : null
        });
        
        if (evalType === 'apreciativa') {
          // Inicializar en cero para todos los estudiantes (BATCH OPTIMIZADO)
          const operations = students.map(s =>
            createSetOp(doc(collection(db, 'grades')), {
              userId: user.uid,
              subjectId,
              evaluationId: docRef.id,
              studentId: s.id,
              score: 0
            })
          );
          await executeBatchChunked(db, operations);
        }
      }
      setIsAddingEval(false);
      setEditingEvalId(null);
      setEvalTitle('');
      setEvalMaxScore('100');
      setEvalType('teorica');
      setEvalDate(format(new Date(), 'yyyy-MM-dd'));
      setEvalModuleId('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'evaluations');
    }
  };

  const handleAddEval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evalTitle || !evalMaxScore || !user) return;

    if (evalModuleId) {
      const mod = modules.find(m => m.id === evalModuleId);
      if (mod) {
        const modStart = mod.startDate ? parseLocalDate(mod.startDate).getTime() : null;
        let modEnd = mod.endDate ? parseLocalDate(mod.endDate).getTime() : null;
        if (modEnd) modEnd += 86400000 - 1;
        const dateToCheck = parseLocalDate(evalDate).getTime();

        if ((modStart && dateToCheck < modStart) || (modEnd && dateToCheck > modEnd)) {
          setWarningMessage({
            title: 'Fecha fuera del período del módulo',
            message: `La fecha seleccionada (${parseLocalDate(evalDate).toLocaleDateString()}) está fuera del rango configurado para el módulo "${mod.title}" (${mod.startDate ? parseLocalDate(mod.startDate).toLocaleDateString() : 'N/A'} - ${mod.endDate ? parseLocalDate(mod.endDate).toLocaleDateString() : 'N/A'}).`
          });
          setWarningModalOpen(true);
          return;
        }
      }
    }

    await processAddEval();
  };

  const handleEditEval = (evaluation: EvaluationDoc) => {
    setEditingEvalId(evaluation.id!);
    setEvalTitle(evaluation.title);
    setEvalType(evaluation.type);
    setEvalDate(evaluation.date);
    setEvalMaxScore(String(evaluation.maxScore || 100));
    setEvalModuleId(evaluation.moduleId || '');
    setIsAddingEval(true);
  };

  const handleDeleteEval = (id: string) => {
    setEvalToDelete(id);
  };

  const confirmDeleteEval = async () => {
    if (!evalToDelete || !user) return;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'evaluations', evalToDelete));
      
      const evalGradesSnapshot = await getDocs(query(collection(db, 'grades'), where('userId', '==', user.uid), where('evaluationId', '==', evalToDelete), limit(500)));
      evalGradesSnapshot.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      
      if (selectedEvalId === evalToDelete) setSelectedEvalId(null);
      setEvalToDelete(null);
    } catch (error) {
       handleFirestoreError(error, OperationType.DELETE, 'evaluations');
    }
  };

  const handleScoreChange = (studentId: string, scoreStr: string) => {
    if (!selectedEvalId || !user) return;
    const evaluation = (evaluations || []).find(e => e.id === selectedEvalId);
    const max = evaluation?.maxScore || 100;
    const key = `${subjectId}::${selectedEvalId}::${studentId}`;
    setLocalScores(prev => ({ ...prev, [studentId]: scoreStr }));
    setPendingEdits(prev => {
      const next = { ...prev };
      if (!scoreStr.trim()) delete next[key];
      else next[key] = { studentId, evaluationId: selectedEvalId, subjectId, scoreStr, maxScore: max };
      return next;
    });
  };

  const handleGroupScoreChange = (groupId: string, studentId: string, evaluationId: string, scoreStr: string) => {
    if (!user) return;
    const ev = (evaluations || []).find(e => e.id === evaluationId);
    const max = ev?.maxScore || 100;
    const targetSubId = ev?.subjectId || subjectId;
    const key = `${targetSubId}::${evaluationId}::${studentId}`;
    setConsolidatedScores(prev => ({
      ...prev,
      [groupId]: { ...(prev[groupId] || {}), [`${studentId}::${evaluationId}`]: scoreStr }
    }));
    setPendingEdits(prev => {
      const next = { ...prev };
      if (!scoreStr.trim()) delete next[key];
      else next[key] = { studentId, evaluationId, subjectId: targetSubId, scoreStr, maxScore: max };
      return next;
    });
  };

  const pendingGradesCount = Object.keys(pendingEdits).length;
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);

  /** Guarda TODO lo pendiente de forma atómica y explícita. */
  const flushPendingScores = async (): Promise<boolean> => {
    const entries = Object.values(pendingEdits);
    if (entries.length === 0 || !user) {
      setLocalScores({});
      setConsolidatedScores({});
      setPendingEdits({});
      return true;
    }
    setSavingGrades(true);
    try {
      const batch = writeBatch(db);
      let opsCount = 0;

      for (const edit of entries) {
        const normalized = edit.scoreStr.trim().replace(',', '.');
        let score = Number(normalized);
        if (isNaN(score)) continue;
        if (score > edit.maxScore) score = edit.maxScore;
        if (score < 0) score = 0;

        // Asegurar que subjectId coincida con la materia propietaria de la evaluación
        const targetEval = (evaluations || []).find(e => e.id === edit.evaluationId);
        const targetSubjectId = targetEval?.subjectId || edit.subjectId || subjectId;

        const existing = (grades || []).find(
          g => g.studentId === edit.studentId && g.evaluationId === edit.evaluationId
        ) || (allGrades || []).find(
          g => g.studentId === edit.studentId && g.evaluationId === edit.evaluationId
        );

        if (existing) {
          batch.update(doc(db, 'grades', existing.id!), { score, subjectId: targetSubjectId });
        } else {
          batch.set(doc(collection(db, 'grades')), {
            userId: user.uid,
            subjectId: targetSubjectId,
            evaluationId: edit.evaluationId,
            studentId: edit.studentId,
            score,
          });
        }
        opsCount++;
      }

      if (opsCount > 0) {
        await batch.commit();
      }
      setPendingEdits({});
      setLocalScores({});
      setConsolidatedScores({});
      return true;
    } catch (err: any) {
      console.error('Error al guardar calificaciones:', err);
      showToast('error', 'No se pudieron guardar las calificaciones. Tus cambios se conservaron para reintentar.');
      return false;
    } finally {
      setSavingGrades(false);
    }
  };

  const handleSaveGrades = async () => {
    await flushPendingScores();
  };

  const handleMateriaSwitchRequest = (materiaId: string) => {
    if (String(materiaId) === String(subjectId)) return;
    if ((pendingGradesCount > 0 || savingGrades) && onSelectMateria) {
      setPendingSwitchId(String(materiaId));
      return;
    }
    onSelectMateria?.(materiaId);
  };

  const saveAndSwitch = async () => {
    const ok = await flushPendingScores();
    if (ok && pendingSwitchId && onSelectMateria) {
      onSelectMateria(pendingSwitchId);
    }
    setPendingSwitchId(null);
  };

  const discardAndSwitch = () => {
    setPendingEdits({});
    setLocalScores({});
    setConsolidatedScores({});
    if (pendingSwitchId && onSelectMateria) {
      onSelectMateria(pendingSwitchId);
    }
    setPendingSwitchId(null);
  };

  const calculateFinalGrade = (studentId: string) => {
    const studentGrades = allGrades.filter(g => g.studentId === studentId);
    
    const savedScale = getStorageItem(STORAGE_KEYS.GRADING_SCALE);
    const gradingScale = safeJSONParse(savedScale, { maxScore: 100, minPassingScore: 71 });

    const useCheckpoint = safeJSONParse(getStorageItem(STORAGE_KEYS.USE_CHECKPOINT), false);

    return calculateStudentGrades(
      studentId,
      studentGrades,
      evaluations,
      modules,
      useCheckpoint,
      weights,
      gradingScale,
      viewMode,
      calculationMode
    );
  };



  if (students.length === 0) {
    return (
      <div className="p-24 text-center text-neutral-400 bg-white border border-neutral-200 rounded-[3rem] shadow-sm">
        <div className="w-24 h-24 bg-neutral-50 rounded-[2rem] flex items-center justify-center mx-auto mb-8 border border-neutral-100">
          <BarChart3 className="w-12 h-12 text-neutral-200" />
        </div>
        <p className="text-3xl font-black text-neutral-900 tracking-tight">No hay estudiantes registrados</p>
        <p className="text-lg mt-4 font-medium text-neutral-500">Ve a la pestaña de Participantes para importar estudiantes.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Selector de materia del Aula/Grupo (solo aulas reales ≥2 materias) */}
      {aulaMaterias && aulaMaterias.length >= 2 && onSelectMateria && (
        <MateriaSelector
          currentSubject={{ id: subjectId } as SubjectDoc}
          materias={aulaMaterias}
          onSwitch={handleMateriaSwitchRequest}
          hint="Evaluaciones propias · Participantes compartidos"
          includeGeneral={true}
        />
      )}
      {pendingSwitchId && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <p className="text-sm font-bold text-neutral-800">
              Tienes {pendingGradesCount} nota{pendingGradesCount === 1 ? '' : 's'} sin guardar en esta materia.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={saveAndSwitch}
              disabled={savingGrades}
              title="Guardar las notas pendientes y cambiar de materia"
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
            >
              {savingGrades ? 'Guardando...' : 'Guardar y cambiar'}
            </button>
            <button
              type="button"
              onClick={discardAndSwitch}
              title="Descartar los cambios sin guardar y cambiar de materia"
              className="bg-white border border-red-200 hover:bg-red-50 text-red-600 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
            >
              Descartar y cambiar
            </button>
            <button
              type="button"
              onClick={() => setPendingSwitchId(null)}
              title="Quedarme en esta materia"
              className="text-neutral-400 hover:text-neutral-900 px-3 py-2.5 text-[10px] font-black uppercase tracking-widest transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div>
          <h3 className="text-2xl font-black text-neutral-900 tracking-tight">Evaluaciones</h3>
          <p className="text-sm text-neutral-500 font-medium mt-1">Gestiona las notas y exámenes de la asignatura</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <select 
            value={selectedEvalId || ''} 
            onChange={(e) => setSelectedEvalId(e.target.value ? e.target.value : null)}
            className="appearance-none bg-white border border-neutral-200 hover:border-indigo-500 rounded-2xl px-6 py-4 text-sm font-black text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all cursor-pointer shadow-sm uppercase tracking-widest min-w-[250px]"
          >
            <option value="">Todas las Evaluaciones</option>
            {evaluations.map(e => (
              <option key={e.id} value={e.id}>{e.title}</option>
            ))}
          </select>
          
          {!selectedEvalId && (
            <>
              {modules.length >= 2 && (
                <button
                  onClick={() => setShowModuleSummary(true)}
                  className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-700 px-6 py-4 rounded-2xl text-sm font-black transition-all border border-indigo-200 uppercase tracking-widest active:scale-95 shadow-sm ml-auto"
                  title="Ver resumen modular"
                >
                  <BarChart3 className="w-5 h-5" />
                  <span className="hidden sm:inline">Resumen</span>
                </button>
              )}

              <button
                id="exporta-tu-informe-de-clases-en-excel-y-editalo-para-tus-entregas"
                onClick={() => {
                  if (!isPro && !isAdmin) {
                    showToast('warning', '¡Actualiza a Premium Pro para exportar tus calificaciones a Excel!');
                    return;
                  }
                  exportSubjectDataToExcel(user!.uid, user!.displayName || user!.email!, subjectId);
                }}
                className={cn("inline-flex items-center gap-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 px-6 py-4 rounded-2xl text-sm font-black transition-all border border-emerald-200 uppercase tracking-widest active:scale-95 shadow-sm", modules.length < 2 ? "ml-auto" : "")}
                title="exporta tu informe de clases en excel y editalo para tus entregas"
              >
                <Download className="w-5 h-5" />
                Exportar Excel
              </button>

              {!evaluations.some(e => e.type === 'apreciativa') && (
                <button
                  onClick={async () => {
                    if (!user) return;
                    try {
                      const newEvalRef = await addDoc(collection(db, 'evaluations'), {
                        userId: user.uid,
                        subjectId,
                        title: 'Nota Apreciativa',
                        maxScore: 100,
                        date: new Date().toISOString().split('T')[0],
                        type: 'apreciativa',
                        moduleId: null
                      });
                      
                      // BATCH OPTIMIZADO: Una sola operación para todos los estudiantes
                      const operations = students.map(s =>
                        createSetOp(doc(collection(db, 'grades')), {
                          userId: user.uid,
                          subjectId,
                          evaluationId: newEvalRef.id,
                          studentId: s.id,
                          score: 0
                        })
                      );
                      await executeBatchChunked(db, operations);
                    } catch (error) {
                      handleFirestoreError(error, OperationType.WRITE, 'evaluations/grades');
                    }
                  }}
                  className="flex items-center gap-3 bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-600 px-6 py-4 rounded-2xl text-sm font-black transition-all shadow-sm active:scale-95 uppercase tracking-widest"
                  title="Agregar columna de nota apreciativa"
                >
                  <Plus className="w-5 h-5" />
                  <span className="hidden sm:inline">Nota Apreciativa</span>
                </button>
              )}
              <button
                onClick={() => setIsAddingEval(!isAddingEval)}
                className="flex items-center gap-3 bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-2xl text-sm font-black transition-all shadow-xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest"
                title="Registrar una nueva evaluación en esta asignatura"
              >
                <Plus className="w-5 h-5" />
                <span className="hidden sm:inline">Nueva Eval.</span>
              </button>
            </>
          )}
        </div>
      </div>

      {isAddingEval && !selectedEvalId && (
        <form onSubmit={handleAddEval} className="bg-white border border-neutral-200 p-10 rounded-[3rem] space-y-8 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-500">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div className="lg:col-span-3">
            <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-4 px-1">Título de Evaluación</label>
            <input required type="text" value={evalTitle} onChange={e => setEvalTitle(e.target.value)} className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-6 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold text-lg placeholder:text-neutral-300" placeholder="Ej. Examen Parcial" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-4 px-1">Nota Máxima</label>
            <input 
              required 
              type="number" 
              value={evalMaxScore} 
              onChange={e => setEvalMaxScore(e.target.value)} 
              className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-6 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold text-lg" 
              placeholder="100" 
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-4 px-1">Tipo de Evaluación</label>
            <select 
              value={evalType} 
              onChange={e => setEvalType(e.target.value as 'teorica' | 'practica' | 'apreciativa')}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-6 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold cursor-pointer text-lg"
            >
              <option value="teorica">{weights.teorica.name} ({weights.teorica.value}%)</option>
              <option value="practica">{weights.practica.name} ({weights.practica.value}%)</option>
              <option value="apreciativa">{weights.apreciativa.name} ({weights.apreciativa.value}%)</option>
              {safeJSONParse(getStorageItem(STORAGE_KEYS.USE_CHECKPOINT), false) && (
                <option value="checkpoint">{weights.checkpoint.name} ({weights.checkpoint.value}%)</option>
              )}
            </select>
            {evalType === 'apreciativa' && (
              <p className="mt-2 text-[10px] font-black text-indigo-600 uppercase tracking-widest px-1">
                * A discreción del docente según participación y desempeño.
              </p>
            )}
          </div>
          <div>
            <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-4 px-1">Plan / Módulo</label>
            <select 
              value={evalModuleId} 
              onChange={e => setEvalModuleId(e.target.value)}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-6 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold cursor-pointer text-lg"
            >
              <option value="">Automático por fecha</option>
              {modules.map(mod => (
                <option key={mod.id} value={mod.id}>{mod.order}: {mod.title}</option>
              ))}
            </select>
          </div>
        </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-8 pt-8 border-t border-neutral-100">
              <div className="w-full sm:w-80">
                <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-4 px-1">Fecha de Aplicación</label>
                <input required type="date" value={evalDate} onChange={e => setEvalDate(e.target.value)} className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-6 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold text-lg" />
              </div>
              <div className="flex flex-col sm:flex-row items-center gap-8">
                <div className="bg-neutral-50 px-6 py-3 rounded-2xl border border-neutral-100">
                  <span className="text-[10px] text-neutral-400 font-black uppercase tracking-widest">Nota Máxima: {evalMaxScore} PTS</span>
                </div>
                <div className="flex gap-4 w-full sm:w-auto">
                  <button 
                    type="button" 
                    onClick={() => {
                      setIsAddingEval(false);
                      setEditingEvalId(null);
                      setEvalTitle('');
                    }} 
                    className="flex-1 sm:flex-none px-8 py-4 text-xs font-black text-neutral-400 hover:text-neutral-900 transition-colors uppercase tracking-widest"
                    title="Cancelar el registro de la evaluación"
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="flex-1 sm:flex-none px-12 py-4 text-xs font-black bg-indigo-600 text-white rounded-2xl hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest" title="Guardar los detalles de la evaluación">
                    {editingEvalId ? 'Actualizar Evaluación' : 'Guardar Evaluación'}
                  </button>
                </div>
              </div>
            </div>
        </form>
      )}



      {selectedEvalId ? (() => {
        const evaluation = (evaluations || []).find(e => e.id === selectedEvalId);
        if (!evaluation) return null;

        return (
          <div className="space-y-8 animate-in fade-in duration-300">
            <div className="flex flex-col sm:flex-row sm:items-center gap-6 bg-white border border-neutral-200 p-6 rounded-[2.5rem] shadow-sm">
              <button 
                onClick={() => setSelectedEvalId(null)}
                className="p-4 text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-2xl transition-all active:scale-95 border border-neutral-200 bg-white shadow-sm shrink-0"
                title="Volver a la lista de evaluaciones"
              >
                <ChevronLeft className="w-8 h-8" />
              </button>
              <div className="flex-1 min-w-0">
                <h3 className="text-3xl font-black text-neutral-900 tracking-tight truncate">{evaluation.title}</h3>
                <div className="flex items-center gap-4 mt-2">
                  <span className="text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-lg border bg-indigo-50 text-indigo-600 border-indigo-100">{evaluation.type}</span>
                  <p className="text-sm text-neutral-400 font-black uppercase tracking-widest">
                    {parseLocalDate(evaluation.date).toLocaleDateString()} • {evaluation.maxScore || 100} PTS
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
              {Object.keys(localScores).length > 0 && (
                <button 
                  onClick={handleSaveGrades}
                  disabled={savingGrades}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-4 rounded-2xl text-[11px] font-black transition-all shadow-lg shadow-emerald-500/20 active:scale-95 uppercase tracking-widest shrink-0"
                  title="Guardar las calificaciones modificadas en la base de datos"
                >
                  {savingGrades ? "Guardando..." : `Guardar (${Object.keys(localScores).length})`}
                </button>
              )}
              <button 
                onClick={() => {
                  setSelectedEvalId(null);
                  handleEditEval(evaluation);
                }}
                className="flex items-center gap-2 bg-white border border-neutral-200 hover:border-indigo-500 text-indigo-600 px-5 py-4 rounded-2xl text-[11px] font-black transition-all shadow-sm active:scale-95 uppercase tracking-widest shrink-0 bg-transparent"
                title="Editar la configuración de esta evaluación"
              >
                <Edit3 className="w-5 h-5" />
                <span className="hidden lg:inline">Editar</span>
              </button>
              </div>
            </div>

            <div className="bg-white border border-neutral-200 rounded-[2.5rem] overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-100">
                    <tr>
                      <th className="px-8 py-6 font-black uppercase tracking-[0.2em] text-[10px]">Estudiante</th>
                      <th className="px-8 py-6 font-black uppercase tracking-[0.2em] text-[10px] w-64 text-center">Calificación</th>
                      <th className="px-8 py-6 font-black uppercase tracking-[0.2em] text-[10px] w-40 text-center">Boletín</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-50">
                    {students.map(student => {
                      const grade = (grades || []).find(g => g.studentId === student.id);
                      const isObsOpen = openObsStudentId === student.id;
                      const draft = obsDrafts[student.id] || { general: '', subject: '' };
                      const scoreValStr = localScores[student.id] ?? (grade?.score !== undefined ? String(grade.score) : '');
                      const numericScore = scoreValStr !== '' ? Number(scoreValStr) : undefined;
                      const fmt = formatDisplayGrade(numericScore, evaluation.maxScore, gradingScale);

                      return (
                        <React.Fragment key={student.id}>
                        <tr className="hover:bg-neutral-50/50 transition-all group duration-300">
                          <td className="px-8 py-6">
                            <p className="text-xl font-black text-neutral-900 group-hover:text-indigo-600 transition-colors leading-tight">{student.lastName}, {student.firstName}</p>
                            <p className="text-[10px] text-neutral-400 font-mono font-black mt-1.5 tracking-widest uppercase opacity-60">{student.cedula}</p>
                          </td>
                          <td className="px-8 py-6">
                            <div className="flex items-center justify-center gap-4">
                              <div className="relative group/input">
                                <input 
                                  type="number" 
                                  step="0.1"
                                  min="0"
                                  max={evaluation.maxScore || 100}
                                  value={localScores[student.id] ?? grade?.score ?? (evaluation.type === 'apreciativa' ? 0 : '')}
                                  onChange={(e) => {
                                    handleScoreChange(student.id!, e.target.value);
                                  }}
                                  className={cn(
                                    "w-32 bg-neutral-50 border rounded-2xl px-5 py-4 outline-none focus:ring-4 transition-all font-black text-lg text-center",
                                    typeof numericScore === 'number' && !fmt.isPassing 
                                      ? "border-red-200 text-red-600 focus:border-red-500 focus:ring-red-500/5" 
                                      : "border-neutral-200 text-neutral-900 focus:border-indigo-500 focus:ring-indigo-500/5"
                                  )} 
                                />
                              </div>
                              <span className="text-neutral-300 font-black text-lg">/ {evaluation.maxScore || 100}</span>
                              <span className={cn(
                                "text-[10px] font-black px-3 py-1.5 rounded-lg border uppercase tracking-widest shadow-sm",
                                typeof numericScore === 'number' && fmt.isPassing
                                  ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                                  : typeof numericScore === 'number'
                                    ? "bg-red-50 text-red-600 border-red-100"
                                    : "bg-neutral-50 text-neutral-400 border-neutral-100"
                              )}>
                                {fmt.displayValue}{gradingScale.type === 'porcentaje' ? '%' : ''}
                              </span>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <button
                              type="button"
                              onClick={() => setOpenObsStudentId(isObsOpen ? null : student.id!)}
                              aria-label={`Observaciones del boletín de ${student.firstName} ${student.lastName}`}
                              title="Observaciones del boletín"
                              className={cn(
                                "inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all active:scale-95 border",
                                (draft.general || draft.subject)
                                  ? "bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100"
                                  : "bg-neutral-50 text-neutral-500 border-neutral-200 hover:bg-neutral-100"
                              )}
                            >
                              <MessageSquare className="w-4 h-4" />
                              {draft.general || draft.subject ? 'Editar' : 'Observ.'}
                            </button>
                          </td>
                        </tr>
                        {isObsOpen && (
                          <tr className="bg-amber-50/40">
                            <td colSpan={3} className="px-8 py-5">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-[10px] font-black uppercase tracking-widest text-neutral-500 mb-2">
                                    Observación general del boletín (consejero)
                                  </label>
                                  <textarea
                                    rows={2}
                                    value={draft.general}
                                    onChange={(e) =>
                                      setObsDrafts((prev) => ({
                                        ...prev,
                                        [student.id!]: { ...(prev[student.id!] || { subject: '' }), general: e.target.value },
                                      }))
                                    }
                                    placeholder="Aparece como observación general en el boletín del estudiante..."
                                    className="w-full bg-white border border-neutral-200 rounded-2xl px-4 py-3 text-sm font-medium text-neutral-900 outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/5 resize-none"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] font-black uppercase tracking-widest text-neutral-500 mb-2">
                                    Observación de esta asignatura
                                  </label>
                                  <textarea
                                    rows={2}
                                    value={draft.subject}
                                    onChange={(e) =>
                                      setObsDrafts((prev) => ({
                                        ...prev,
                                        [student.id!]: { ...(prev[student.id!] || { general: '' }), subject: e.target.value },
                                      }))
                                    }
                                    placeholder="Se muestra junto a la asignatura en el boletín..."
                                    className="w-full bg-white border border-neutral-200 rounded-2xl px-4 py-3 text-sm font-medium text-neutral-900 outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/5 resize-none"
                                  />
                                </div>
                              </div>
                              <div className="flex justify-end gap-2 mt-4">
                                <button
                                  type="button"
                                  onClick={() => setOpenObsStudentId(null)}
                                  className="px-5 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-widest text-neutral-500 hover:text-neutral-900 transition-colors"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveObservations(student.id!)}
                                  disabled={savingObs}
                                  className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all active:scale-95"
                                >
                                  {savingObs ? 'Guardando...' : 'Guardar en el boletín'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })() : (
        <div className="space-y-8 animate-in fade-in duration-300">
          <div className="bg-white border border-neutral-200 rounded-[2.5rem] overflow-hidden shadow-sm">
            {evaluations.length === 0 ? (
              <div className="p-32 text-center text-neutral-400">
                <div className="w-24 h-24 bg-neutral-50 rounded-[2rem] flex items-center justify-center mx-auto mb-8 border border-neutral-100">
                  <BarChart3 className="w-12 h-12 text-neutral-200" />
                </div>
                <p className="text-3xl font-black text-neutral-900 tracking-tight">No hay evaluaciones registradas</p>
                <p className="text-lg mt-4 font-medium text-neutral-500">Crea una nueva evaluación para comenzar a calificar.</p>
                <div className="mt-8 flex justify-center gap-4">
                  <button 
                    onClick={() => {
                      setEvalTitle('Nota Apreciativa');
                      setEvalType('apreciativa');
                      setIsAddingEval(true);
                    }}
                    title="Crear una evaluación de tipo apreciativa automáticamente"
                    className="px-6 py-3 bg-amber-50 text-amber-600 rounded-xl font-black text-xs uppercase tracking-widest border border-amber-100 hover:bg-amber-100 transition-all"
                  >
                    + Agregar Nota Apreciativa
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {groupedEvaluations.map((group, index) => {
                  const groupId = group.parentModule ? `module-${group.parentModule.id}` : 'unassigned';
                  const isExpanded = expandedModules[groupId];
                  
                  const totalEvalsCount = group.parentEvals.length + group.subModules.reduce((acc, s) => acc + s.evals.length, 0);
                  if (!group.parentModule && totalEvalsCount === 0) return null;

                  return (
                    <div key={groupId} className="bg-white border text-sm border-neutral-200 rounded-[2rem] overflow-hidden shadow-sm">
                      <button 
                        onClick={() => toggleModule(groupId)}
                        className="w-full flex items-center justify-between px-8 py-6 hover:bg-neutral-50 transition-colors"
                        title={isExpanded ? "Contraer grupo de evaluaciones" : "Expandir grupo de evaluaciones"}
                      >
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center font-black",
                            group.parentModule ? "bg-indigo-50 text-indigo-600" : "bg-neutral-100 text-neutral-500"
                          )}>
                            {group.parentModule ? group.parentModule.order : '#'}
                          </div>
                          <div className="text-left">
                            <h4 className="text-lg font-black text-neutral-900">
                              {group.parentModule ? group.parentModule.title : 'Evaluaciones'}
                            </h4>
                            {group.parentModule && (group.parentModule.startDate || group.parentModule.endDate) && (
                              <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest mt-1">
                                {group.parentModule.startDate ? parseLocalDate(group.parentModule.startDate).toLocaleDateString() : '...'} - {group.parentModule.endDate ? parseLocalDate(group.parentModule.endDate).toLocaleDateString() : '...'}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400 bg-neutral-100 px-3 py-1.5 rounded-lg">
                            {totalEvalsCount} eval{totalEvalsCount !== 1 ? 's' : ''}
                          </span>
                          {isExpanded ? <ChevronDown className="w-5 h-5 text-neutral-400" /> : <ChevronRight className="w-5 h-5 text-neutral-400" />}
                        </div>
                      </button>

                      {isExpanded && (() => {
                        const allGroupEvals = [
                          ...group.parentEvals,
                          ...group.subModules.flatMap(s => s.evals)
                        ];
                        if (allGroupEvals.length === 0) return null;

                        const groupScores = consolidatedScores[groupId] || {};
                        const hasChanges = Object.keys(groupScores).length > 0;

                        const handleSaveGroupGrades = async () => {
                          await flushPendingScores();
                        };

                        return (
                          <div className="border-t border-neutral-100 bg-neutral-50/30 p-6 space-y-4">
                            {hasChanges && (
                              <div className="flex justify-end">
                                <button onClick={handleSaveGroupGrades} disabled={savingGrades}
                                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-3 rounded-2xl text-[11px] font-black transition-all shadow-lg shadow-emerald-500/20 active:scale-95 uppercase tracking-widest">
                                  {savingGrades ? 'Guardando...' : `Guardar (${Object.keys(groupScores).length})`}
                                </button>
                              </div>
                            )}
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-sm">
                                <thead>
                                  <tr className="bg-white border-b-2 border-neutral-200">
                                    <th className="px-4 py-3 font-black uppercase tracking-[0.2em] text-[10px] text-neutral-500 whitespace-nowrap sticky left-0 bg-white z-10 min-w-[200px]">Estudiante</th>
                                    {allGroupEvals.map(ev => (
                                      <th key={ev.id} className="px-3 py-3 text-center min-w-[100px]">
                                        <div className="text-[10px] font-black uppercase tracking-widest text-neutral-500">{ev.title}</div>
                                        <div className="text-[8px] text-neutral-400 mt-1">
                                          <span className={cn("px-1.5 py-0.5 rounded", 
                                            ev.type === 'teorica' ? "text-blue-500" : ev.type === 'practica' ? "text-emerald-500" : "text-amber-500")}>
                                            {ev.type} / {ev.maxScore || 100}
                                          </span>
                                        </div>
                                      </th>
                                    ))}
                                    <th className="px-4 py-3 text-center font-black uppercase tracking-[0.2em] text-[10px] text-indigo-600 min-w-[80px]">Promedio</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100">
                                  {students.map(student => {
                                    const studentGrades = allGrades.filter(g => g.studentId === student.id);
                                    const evalInputs = allGroupEvals.map(ev => {
                                      const scoreKey = `${student.id}::${ev.id}`;
                                      const overrideVal = groupScores[scoreKey];
                                      const existing = studentGrades.find(g => g.evaluationId === ev.id);
                                      const score = overrideVal !== undefined && overrideVal !== '' ? Number(overrideVal) : existing?.score;
                                      return { type: ev.type, scorePct: typeof score === 'number' ? (score / (ev.maxScore || 100)) * 100 : null };
                                    });
                                    const breakdown = weightedBreakdown(evalInputs, { weights: { teoria: weights.teorica.value, practica: weights.practica.value, apreciativa: weights.apreciativa.value } } as any);
                                    const rawAvg = breakdown.final !== null ? (breakdown.final / 100) * (gradingScale.maxScore || 100) : null;
                                    const fmtAvg = formatDisplayGrade(rawAvg, gradingScale.maxScore || 100, gradingScale);

                                    return (
                                      <tr key={student.id} className="hover:bg-white/80 transition-all group">
                                        <td className="px-4 py-3 sticky left-0 bg-neutral-50/30 z-[5]">
                                          <p className="text-sm font-black text-neutral-900">{student.lastName}, {student.firstName}</p>
                                          <p className="text-[9px] text-neutral-400 font-mono font-black tracking-widest">{student.cedula}</p>
                                        </td>
                                        {allGroupEvals.map(ev => {
                                          const scoreKey = `${student.id}::${ev.id}`;
                                          const overrideVal = groupScores[scoreKey];
                                          const existing = studentGrades.find(g => g.evaluationId === ev.id);
                                          const displayVal = overrideVal ?? existing?.score ?? '';
                                          const numVal = overrideVal !== undefined && overrideVal !== '' ? Number(overrideVal) : existing?.score;
                                          const fmtCell = formatDisplayGrade(numVal, ev.maxScore, gradingScale);

                                          return (
                                            <td key={ev.id} className="px-3 py-3 text-center">
                                              <input type="number" step="0.1" min="0" max={ev.maxScore || 100}
                                                value={displayVal}
                                                onChange={e => handleGroupScoreChange(groupId, student.id!, ev.id!, e.target.value)}
                                                className={cn("w-20 bg-white border rounded-xl px-3 py-2 text-center font-black text-sm outline-none focus:ring-4 transition-all",
                                                  typeof numVal === 'number' && !fmtCell.isPassing
                                                    ? "border-red-200 text-red-600 focus:border-red-500 focus:ring-red-500/5"
                                                    : "border-neutral-200 text-neutral-900 focus:border-indigo-500 focus:ring-indigo-500/5")} />
                                            </td>
                                          );
                                        })}
                                        <td className="px-4 py-3 text-center">
                                          <span className={cn("text-sm font-black px-3 py-1 rounded-lg",
                                            fmtAvg.isPassing ? "text-emerald-600 bg-emerald-50" : "text-red-600 bg-red-50")}>
                                            {fmtAvg.displayValue}{gradingScale.type === 'porcentaje' ? '%' : ''}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            {group.subModules.length > 0 && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-4 border-t border-neutral-200">
                                {group.subModules.map(sub => (
                                  <div key={sub.module.id} className="bg-white border border-neutral-200 p-4 rounded-2xl">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Módulo {sub.module.order}: {sub.module.title}</p>
                                    <p className="text-xs text-neutral-400 mt-1">{sub.evals.length} evaluación(es)</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <GradesSummary subjectId={subjectId} />
        </div>
      )}

      {evalToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-md">
          <div className="bg-white border border-neutral-200 p-10 rounded-[2.5rem] shadow-2xl max-w-sm w-full mx-4 animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mb-8 mx-auto">
              <Trash2 className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-black text-neutral-900 mb-4 text-center tracking-tight">Eliminar Evaluación</h3>
            <p className="text-neutral-500 mb-10 text-center font-medium leading-relaxed">¿Estás seguro de que deseas eliminar esta evaluación y todas sus calificaciones? Esta acción no se puede deshacer.</p>
            <div className="flex gap-4">
              <button onClick={() => setEvalToDelete(null)} title="Cancelar y mantener la evaluación" className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95">Cancelar</button>
              <button onClick={confirmDeleteEval} title="Eliminar permanentemente la evaluación" className="flex-1 bg-red-600 hover:bg-red-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-red-500/20 active:scale-95">Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {warningModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-md">
          <div className="bg-white border border-neutral-200 p-10 rounded-[2.5rem] shadow-2xl max-w-md w-full mx-4 animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mb-8 mx-auto">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-black text-neutral-900 mb-4 text-center tracking-tight">{warningMessage.title}</h3>
            <p className="text-neutral-500 mb-10 text-center font-medium leading-relaxed">{warningMessage.message}</p>
            <div className="flex gap-4">
              <button 
                onClick={() => setWarningModalOpen(false)} 
                className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
              >
                Cancelar
              </button>
              <button 
                onClick={async () => {
                  setWarningModalOpen(false);
                  await processAddEval();
                }} 
                className="flex-1 bg-amber-600 hover:bg-amber-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-amber-500/20 active:scale-95"
              >
                Guardar de todas formas
              </button>
            </div>
          </div>
        </div>
      )}

      {showModuleSummary && (
        <ModuleSummaryModal subjectId={subjectId} onClose={() => setShowModuleSummary(false)} />
      )}
    </div>
  );
}
