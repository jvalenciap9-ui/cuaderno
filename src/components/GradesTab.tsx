import { format } from 'date-fns';
import React, { useState, useEffect } from 'react';
import { useCustomCollectionData } from "../lib/firestoreUtils";
import { collection, query, where, addDoc, updateDoc, doc, writeBatch, getDocs, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthProvider';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
import { Plus, Trash2, ChevronLeft, BarChart3, UserCheck, UserX, Info, Edit3, Download, ChevronRight, ChevronDown, AlertTriangle } from 'lucide-react';
import { safeJSONParse, cn, parseLocalDate } from '../lib/utils';
import { GradesSummary } from './GradesSummary';
import { STORAGE_KEYS, getStorageItem } from '../lib/storageKeys';
import { parseWeights, calculateStudentGrades, type ViewMode, type CalculationMode } from '../lib/gradeCalculator';
import { executeBatchChunked, createSetOp } from '../lib/batchUtils';

import { ModuleSummaryModal } from './ModuleSummaryModal';
import { exportSubjectDataToExcel } from '../lib/exportUtils';
import type { SubjectModuleDoc, EvaluationDoc } from '../types/firestore';

export function GradesTab({ subjectId }: { subjectId: string }) {
  const { user } = useAuth();
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

  const studentsQuery = user?.uid ? query(collection(db, 'students'), where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500)) : null;
  const [students = []] = useCustomCollectionData(studentsQuery);

  const evaluationsQuery = user?.uid ? query(collection(db, 'evaluations'), where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500)) : null;
  const [evaluations = []] = useCustomCollectionData(evaluationsQuery);

  const gradesQuery = user?.uid ? query(collection(db, 'grades'), where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500)) : null;
  const [allGrades = []] = useCustomCollectionData(gradesQuery);

  const modulesQuery = user?.uid ? query(collection(db, 'subjectModules'), where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500)) : null;
  const [modules = []] = useCustomCollectionData(modulesQuery);

  const selectedEvalGradesQuery = selectedEvalId && user?.uid ? query(collection(db, 'grades'), where('userId', '==', user?.uid), where('evaluationId', '==', selectedEvalId), limit(500)) : null;
  const [grades = []] = useCustomCollectionData(selectedEvalGradesQuery);

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
    setLocalScores(prev => ({ ...prev, [studentId]: scoreStr }));
  };

  const handleSaveGrades = async () => {
    if (!selectedEvalId || !user) return;
    setSavingGrades(true);
    try {
      const evaluation = (evaluations || []).find(e => e.id === selectedEvalId);
      if (!evaluation) return;
      const max = evaluation.maxScore || 100;

      const batch = writeBatch(db);
      let opsCount = 0;

      for (const [studentId, scoreStr] of Object.entries(localScores)) {
        const normalized = scoreStr.trim().replace(',', '.');
        let score = Number(normalized);
        if (isNaN(score)) continue;
        if (score > max) score = max;
        if (score < 0) score = 0;

        const existingGrade = (grades || []).find(g => g.studentId === studentId);

        if (existingGrade) {
          batch.update(doc(db, 'grades', existingGrade.id!), { score, subjectId });
        } else {
          batch.set(doc(collection(db, 'grades')), {
            userId: user.uid,
            subjectId,
            evaluationId: selectedEvalId,
            studentId,
            score
          });
        }
        opsCount++;
      }

      if (opsCount > 0) {
        await batch.commit();
      }
      setLocalScores({});
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'grades');
    } finally {
      setSavingGrades(false);
    }
  };

  const [weights, setWeights] = useState(() => parseWeights(getStorageItem(STORAGE_KEYS.GRADING_WEIGHTS)));
  const [viewMode, setViewMode] = useState<ViewMode>(() => (getStorageItem(STORAGE_KEYS.GRADING_VIEW_MODE) as ViewMode) || 'categories');
  const [calculationMode, setCalculationMode] = useState<CalculationMode>(() => (getStorageItem(STORAGE_KEYS.GRADING_CALCULATION_MODE) as CalculationMode) || 'average');
  
  React.useEffect(() => {
    const handleStorage = () => {
      setWeights(parseWeights(getStorageItem(STORAGE_KEYS.GRADING_WEIGHTS)));
      setViewMode((getStorageItem(STORAGE_KEYS.GRADING_VIEW_MODE) as ViewMode) || 'categories');
      setCalculationMode((getStorageItem(STORAGE_KEYS.GRADING_CALCULATION_MODE) as CalculationMode) || 'average');
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

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
                onClick={() => exportSubjectDataToExcel(user!.uid, user!.displayName || user!.email!, subjectId)}
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
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-50">
                    {students.map(student => {
                      const grade = (grades || []).find(g => g.studentId === student.id);
                      return (
                        <tr key={student.id} className="hover:bg-neutral-50/50 transition-all group duration-300">
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
                                    grade && (grade.score / (evaluation.maxScore || 100) * 100) < 71 
                                      ? "border-red-200 text-red-600 focus:border-red-500 focus:ring-red-500/5" 
                                      : "border-neutral-200 text-neutral-900 focus:border-indigo-500 focus:ring-indigo-500/5"
                                  )} 
                                />
                              </div>
                              <span className="text-neutral-300 font-black text-lg">/ {evaluation.maxScore || 100}</span>
                              <span className={cn(
                                "text-[10px] font-black px-3 py-1.5 rounded-lg border uppercase tracking-widest shadow-sm",
                                (grade?.score || 0) / (evaluation.maxScore || 100) * 100 >= 71
                                  ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                                  : "bg-red-50 text-red-600 border-red-100"
                              )}>
                                {((grade?.score || 0) / (evaluation.maxScore || 100) * 100).toFixed(0)}%
                              </span>
                            </div>
                          </td>
                        </tr>
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
                              {group.parentModule ? group.parentModule.title : 'Otras Evaluaciones'}
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

                        const handleGroupScoreChange = (studentId: string, evaluationId: string, value: string) => {
                          setConsolidatedScores(prev => ({
                            ...prev,
                            [groupId]: { ...(prev[groupId] || {}), [`${studentId}::${evaluationId}`]: value }
                          }));
                        };

                        const handleSaveGroupGrades = async () => {
                          if (!user) return;
                          setSavingGrades(true);
                          try {
                            const batch = writeBatch(db);
                            let opsCount = 0;
                            for (const [key, scoreStr] of Object.entries(groupScores)) {
                              const [studentId, evaluationId] = key.split('::');
                              const ev = allGroupEvals.find(e => e.id === evaluationId);
                              if (!ev) continue;
                              const max = ev.maxScore || 100;
                              const normalized = scoreStr.trim().replace(',', '.');
                              let score = Number(normalized);
                              if (isNaN(score)) continue;
                              if (score > max) score = max;
                              if (score < 0) score = 0;

                              const existing = allGrades.find(g => g.studentId === studentId && g.evaluationId === evaluationId);
                              if (existing) {
                                batch.update(doc(db, 'grades', existing.id!), { score, subjectId });
                              } else {
                                batch.set(doc(collection(db, 'grades')), {
                                  userId: user.uid, subjectId, evaluationId, studentId, score
                                });
                              }
                              opsCount++;
                            }
                            if (opsCount > 0) await batch.commit();
                            setConsolidatedScores(prev => ({ ...prev, [groupId]: {} }));
                          } finally { setSavingGrades(false); }
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
                                    let sumPct = 0; let count = 0;
                                    const finalPct = allGroupEvals.reduce((acc, ev) => {
                                      const grade = studentGrades.find(g => g.evaluationId === ev.id);
                                      const score = grade?.score;
                                      if (typeof score === 'number') { acc += score / (ev.maxScore || 100); count++; }
                                      return acc;
                                    }, 0);
                                    const avg = count > 0 ? ((finalPct / count) * 100).toFixed(1) : '-';
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
                                          return (
                                            <td key={ev.id} className="px-3 py-3 text-center">
                                              <input type="number" step="0.1" min="0" max={ev.maxScore || 100}
                                                value={displayVal}
                                                onChange={e => handleGroupScoreChange(student.id!, ev.id!, e.target.value)}
                                                className={cn("w-20 bg-white border rounded-xl px-3 py-2 text-center font-black text-sm outline-none focus:ring-4 transition-all",
                                                  existing && (existing.score / (ev.maxScore || 100)) < 0.71
                                                    ? "border-red-200 text-red-600 focus:border-red-500 focus:ring-red-500/5"
                                                    : "border-neutral-200 text-neutral-900 focus:border-indigo-500 focus:ring-indigo-500/5")} />
                                            </td>
                                          );
                                        })}
                                        <td className="px-4 py-3 text-center">
                                          <span className={cn("text-sm font-black px-3 py-1 rounded-lg",
                                            Number(avg) >= 71 ? "text-emerald-600 bg-emerald-50" : "text-red-600 bg-red-50")}>{avg}</span>
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
