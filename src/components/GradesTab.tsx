import { format } from 'date-fns';
import React, { useState, useRef } from 'react';
import { useCustomCollectionData } from "../lib/firestoreUtils";
import { collection, query, where, addDoc, updateDoc, deleteDoc, doc, writeBatch, getDocs, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthProvider';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
import { Plus, Trash2, ChevronLeft, BarChart3, UserCheck, UserX, Info, Edit3, Download, ChevronRight, ChevronDown, Wand2, X } from 'lucide-react';
import type { EvaluationDoc, SubjectModuleDoc } from '../types/firestore';
import { safeJSONParse, cn } from '../lib/utils';
import { GradesSummary } from './GradesSummary';
import { STORAGE_KEYS, getStorageItem } from '../lib/storageKeys';
import { executeBatchChunked, createSetOp } from '../lib/batchUtils';

import { exportSubjectDataToExcel } from '../lib/exportUtils';
import { extractTextFromFile } from '../lib/fileParser';
import { ai } from '../lib/gemini';

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
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [aiAlertMessage, setAiAlertMessage] = useState<string | null>(null);

  // Optimización: Debounce para evitar sobrecargar Firestore
  const [localScores, setLocalScores] = useState<Record<string, string>>({});
  const pendingWrites = useRef<Record<string, NodeJS.Timeout>>({});

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
    const groups: { module: SubjectModuleDoc | null, evals: EvaluationDoc[] }[] = [];
    
    modules.forEach(mod => {
      const start = mod.startDate ? new Date(mod.startDate).getTime() : null;
      let end = mod.endDate ? new Date(mod.endDate).getTime() : null;
      if (end) {
        // expand the end date to the end of the day
        end = end + 86400000 - 1; 
      }
      
      const modEvals = evaluations.filter(ev => {
        if (ev.moduleId === mod.id) return true;
        if (ev.moduleId) return false; // Belongs to a different module
        if (!ev.date) return false;
        
        const evDate = new Date(ev.date).getTime();
        if (start && end) {
          return evDate >= start && evDate <= end;
        }
        return false;
      });
      groups.push({ module: mod, evals: modEvals });
    });

    const assignedIds = new Set(groups.flatMap(g => g.evals.map(e => e.id)));
    const unassignedEvals = evaluations.filter(ev => !assignedIds.has(ev.id));

    if (unassignedEvals.length > 0) {
      groups.push({ module: null, evals: unassignedEvals });
    }

    return groups;
  }, [evaluations, modules]);

  const toggleModule = (id: string) => {
    setExpandedModules(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleAddEval = async (e: React.FormEvent) => {
    e.preventDefault();
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
      setEvalModuleId('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'evaluations');
    }
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
    if (!selectedEvalId || !user) {
      console.warn("No evaluation selected when changing score");
      return;
    }

    // 1. Actualización visual instantánea
    setLocalScores(prev => ({ ...prev, [studentId]: scoreStr }));

    // 2. Cancelar el guardado anterior si se sigue escribiendo
    if (pendingWrites.current[studentId]) {
      clearTimeout(pendingWrites.current[studentId]);
    }

    // 3. Programar el guardado real en Firestore tras 1.5s (Debounce)
    pendingWrites.current[studentId] = setTimeout(async () => {
      let scoreStrNormalized = scoreStr.trim().replace(',', '.');
      let score = Number(scoreStrNormalized);
      if (isNaN(score)) return;

      const evaluation = (evaluations || []).find(e => e.id === selectedEvalId);
      const max = evaluation?.maxScore || 100;
      
      if (score > max) score = max;
      if (score < 0) score = 0;

      try {
        const existing = await getDocs(query(collection(db, 'grades'), where('userId', '==', user.uid), where('evaluationId', '==', selectedEvalId), where('studentId', '==', studentId), limit(500)));

        if (!existing.empty) {
          await updateDoc(doc(db, 'grades', existing.docs[0].id), { 
            score,
            subjectId
          });
        } else {
          await addDoc(collection(db, 'grades'), {
            userId: user.uid,
            subjectId,
            evaluationId: selectedEvalId,
            studentId,
            score
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'grades');
      }
    }, 1500);
  };

  const parseWeights = (data: string | null) => {
    const defaultWeights = { 
      teorica: { name: 'Teórica', value: 30 }, 
      practica: { name: 'Práctica', value: 60 }, 
      apreciativa: { name: 'Apreciativa', value: 10 },
      checkpoint: { name: 'Agregar 4ta Nota', value: 0 }
    };
    if (!data) return defaultWeights;
    try {
      const parsed: Record<string, unknown> = JSON.parse(data);
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

  const [weights, setWeights] = useState(() => parseWeights(getStorageItem(STORAGE_KEYS.GRADING_WEIGHTS)));
  
  React.useEffect(() => {
    const handleStorage = () => {
      setWeights(parseWeights(getStorageItem(STORAGE_KEYS.GRADING_WEIGHTS)));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const calculateFinalGrade = (studentId: string) => {
    const studentGrades = allGrades.filter(g => g.studentId === studentId);
    
    const savedScale = getStorageItem(STORAGE_KEYS.GRADING_SCALE);
    const gradingScale = safeJSONParse(savedScale, { maxScore: 100 });

    const useCheckpoint = safeJSONParse(getStorageItem(STORAGE_KEYS.USE_CHECKPOINT), false);

    const categories: { id: string; weight: number }[] = [
      { id: 'teorica', weight: weights.teorica.value },
      { id: 'practica', weight: weights.practica.value },
      { id: 'apreciativa', weight: weights.apreciativa.value }
    ];

    if (useCheckpoint) {
      categories.push({ id: 'checkpoint', weight: weights.checkpoint.value });
    }

    let weightedSum = 0;
    const details: Record<string, number> = { teorica: 0, practica: 0, apreciativa: 0, checkpoint: 0 };

    categories.forEach(cat => {
      const typeEvals = evaluations.filter(e => e.type === cat.id);
      if (typeEvals.length > 0) {
        let sumPct = 0;
        typeEvals.forEach(ev => {
          const grade = studentGrades.find(g => g.evaluationId === ev.id);
          const score = grade?.score || 0;
          const max = ev.maxScore || 100;
          sumPct += (score / max);
        });
        const avg = sumPct / typeEvals.length;
        const contribution = avg * cat.weight;
        weightedSum += contribution;
        // Return the average scaled to 100% for the specific category UI
        details[cat.id as keyof typeof details] = avg * 100;
      }
    });

    const finalGrade = (weightedSum / 100) * (gradingScale.maxScore || 100);
    
    return {
      total: Math.round(finalGrade * 10) / 10,
      teorica: Math.round(details.teorica * 10) / 10,
      practica: Math.round(details.practica * 10) / 10,
      apreciativa: Math.round(details.apreciativa * 10) / 10,
      checkpoint: Math.round(details.checkpoint * 10) / 10
    };
  };

  const handleAIUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedEvalId) return;

    setIsProcessingAI(true);
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const result = event.target?.result as string;
        let contents: any[] = [];

        if (file.type.startsWith('image/')) {
          const base64Data = result.split(',')[1];
          contents = [
            {
              inlineData: {
                data: base64Data,
                mimeType: file.type
              }
            },
            `Analiza esta imagen con calificaciones. Busca la nota (número) para cada uno de los siguientes estudiantes en esta evaluación. \nDevuelve SOLO un JSON con la estructura {"grades": [{"studentId": <id>, "score": <nota_encontrada>}]}. \nSi no encuentras la nota o no estás seguro, omite a ese estudiante.\nImportante: Las notas pueden tener comas o puntos decimales, extrae el número con punto decimal.\nEstudiantes:\n` + 
            students.map(s => `ID: ${s.id} - Nombre: ${s.firstName} ${s.lastName} - Cédula: ${s.cedula}`).join('\n')
          ];
        } else {
          const text = await extractTextFromFile(result, file.type);
          contents = [
            `Analiza el siguiente texto extraído de un documento de notas. Busca la nota (número) para cada uno de los siguientes estudiantes en esta evaluación. \nDevuelve SOLO un JSON con la estructura {"grades": [{"studentId": <id>, "score": <nota_encontrada>}]}. \nSi no encuentras la nota o no estás seguro, omite a ese estudiante.\nImportante: Las notas pueden tener comas o puntos decimales, extrae el número con punto decimal.\nEstudiantes:\n` + 
            students.map(s => `ID: ${s.id} - Nombre: ${s.firstName} ${s.lastName} - Cédula: ${s.cedula}`).join('\n') + `\n\nDocumento:\n${text}`
          ];
        }

        const aiResponse = await ai({
          model: 'gemini-2.5-flash',
          contents,
          config: { 
            temperature: 0.1,
            responseMimeType: "application/json"
          }
        });

        if (!aiResponse.text) throw new Error("No response");
        const jsonMatch = aiResponse.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found");

        const parsed = JSON.parse(jsonMatch[0]);
        const newGrades = parsed.grades;
        
        let count = 0;
        for (const g of newGrades) {
          if (g.studentId && typeof g.score === 'number' || typeof g.score === 'string') {
            const exists = students.find(s => String(s.id) === String(g.studentId));
            if (exists) {
              await handleScoreChange(exists.id!, String(g.score));
              count++;
            }
          }
        }
        
        setAiAlertMessage(`¡Magia completada! Se identificaron y cargaron ${count} calificaciones correctamente.`);
        
      } catch (error) {
        console.error(error);
        setAiAlertMessage('Error procesando el documento mediante IA. Asegúrate de que las notas sean legibles, contenga los nombres de los estudiantes, y revisa que tu API Key de Gemini esté configurada (o usa los límites gratuitos).');
      } finally {
        setIsProcessingAI(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.readAsDataURL(file);
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
              <button
                onClick={() => exportSubjectDataToExcel(user!.uid, user!.displayName || user!.email!, subjectId)}
                className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 px-6 py-4 rounded-2xl text-sm font-black transition-all border border-emerald-200 uppercase tracking-widest active:scale-95 shadow-sm ml-auto"
                title="Exportar Reporte a Excel"
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
              onChange={e => setEvalType(e.target.value)}
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
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="flex-1 sm:flex-none px-12 py-4 text-xs font-black bg-indigo-600 text-white rounded-2xl hover:bg-indigo-500 transition-all shadow-xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest">
                    {editingEvalId ? 'Actualizar Evaluación' : 'Guardar Evaluación'}
                  </button>
                </div>
              </div>
            </div>
        </form>
      )}

      {aiAlertMessage && (
        <div className="fixed inset-0 bg-neutral-900/40 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-neutral-200 rounded-[2.5rem] p-10 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-8 mx-auto">
              <Wand2 className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-black text-neutral-900 mb-4 text-center tracking-tight">Magia IA</h3>
            <p className="text-neutral-500 mb-10 text-center font-medium leading-relaxed">{aiAlertMessage}</p>
            <button onClick={() => setAiAlertMessage(null)} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-4 rounded-2xl font-black transition-all shadow-xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest text-xs">
              Aceptar
            </button>
          </div>
        </div>
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
              >
                <ChevronLeft className="w-8 h-8" />
              </button>
              <div className="flex-1 min-w-0">
                <h3 className="text-3xl font-black text-neutral-900 tracking-tight truncate">{evaluation.title}</h3>
                <div className="flex items-center gap-4 mt-2">
                  <span className="text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-lg border bg-indigo-50 text-indigo-600 border-indigo-100">{evaluation.type}</span>
                  <p className="text-sm text-neutral-400 font-black uppercase tracking-widest">
                    {new Date(evaluation.date).toLocaleDateString()} • {evaluation.maxScore || 100} PTS
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input 
                  type="file" 
                  accept="image/*, .pdf, .csv, .xlsx, .xls" 
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={handleAIUpload}
                  disabled={isProcessingAI}
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessingAI}
                  className="flex items-center gap-2 bg-gradient-to-r from-pink-500 to-indigo-600 hover:from-pink-400 hover:to-indigo-500 text-white px-5 py-4 rounded-2xl text-[11px] font-black transition-all shadow-lg shadow-indigo-500/20 active:scale-95 uppercase tracking-widest shrink-0"
                  title="Adjuntar y extraer notas con IA mágica"
                >
                  <Wand2 className={cn("w-5 h-5", isProcessingAI && "animate-spin")} />
                  <span className="hidden lg:inline">{isProcessingAI ? "Procesando..." : "IA Mágica"}</span>
                </button>
                <button 
                  onClick={() => handleEditEval(evaluation)}
                  className="flex items-center gap-2 bg-white border border-neutral-200 hover:border-indigo-500 text-indigo-600 px-5 py-4 rounded-2xl text-[11px] font-black transition-all shadow-sm active:scale-95 uppercase tracking-widest shrink-0 bg-transparent"
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
                    className="px-6 py-3 bg-amber-50 text-amber-600 rounded-xl font-black text-xs uppercase tracking-widest border border-amber-100 hover:bg-amber-100 transition-all"
                  >
                    + Agregar Nota Apreciativa
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {groupedEvaluations.map((group, index) => {
                  const groupId = group.module ? `module-${group.module.id}` : 'unassigned';
                  const isExpanded = expandedModules[groupId];
                  
                  if (!group.module && group.evals.length === 0) return null;

                  return (
                    <div key={groupId} className="bg-white border text-sm border-neutral-200 rounded-[2rem] overflow-hidden shadow-sm">
                      <button 
                        onClick={() => toggleModule(groupId)}
                        className="w-full flex items-center justify-between px-8 py-6 hover:bg-neutral-50 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center font-black",
                            group.module ? "bg-indigo-50 text-indigo-600" : "bg-neutral-100 text-neutral-500"
                          )}>
                            {group.module ? group.module.order : '#'}
                          </div>
                          <div className="text-left">
                            <h4 className="text-lg font-black text-neutral-900">
                              {group.module ? group.module.title : 'Otras Evaluaciones'}
                            </h4>
                            {group.module && (group.module.startDate || group.module.endDate) && (
                              <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest mt-1">
                                {group.module.startDate ? new Date(group.module.startDate).toLocaleDateString() : '...'} - {group.module.endDate ? new Date(group.module.endDate).toLocaleDateString() : '...'}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400 bg-neutral-100 px-3 py-1.5 rounded-lg">
                            {group.evals.length} eval{group.evals.length !== 1 ? 's' : ''}
                          </span>
                          {isExpanded ? <ChevronDown className="w-5 h-5 text-neutral-400" /> : <ChevronRight className="w-5 h-5 text-neutral-400" />}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-neutral-100 bg-neutral-50/30 overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-neutral-50/50 text-neutral-500 border-b border-neutral-100">
                              <tr>
                                <th className="px-8 py-4 font-black uppercase tracking-[0.2em] text-[10px]">Evaluación</th>
                                <th className="px-8 py-4 font-black uppercase tracking-[0.2em] text-[10px] text-center">Tipo</th>
                                <th className="px-8 py-4 font-black uppercase tracking-[0.2em] text-[10px]">Fecha</th>
                                <th className="px-8 py-4 font-black uppercase tracking-[0.2em] text-[10px] text-center">Nota Máx.</th>
                                <th className="px-8 py-4 font-black uppercase tracking-[0.2em] text-[10px] text-right">Acciones</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-50">
                              {group.evals.map(evaluation => (
                                <tr key={evaluation.id} className="hover:bg-white transition-all cursor-pointer group duration-300" onClick={() => setSelectedEvalId(evaluation.id!)}>
                                  <td className="px-8 py-4">
                                    <p className="text-base font-black text-neutral-900 group-hover:text-indigo-600 transition-colors leading-tight">{evaluation.title}</p>
                                    <p className="text-[10px] text-neutral-400 font-black uppercase tracking-widest mt-1 opacity-60">ID: {evaluation.id}</p>
                                  </td>
                                  <td className="px-8 py-4 text-center">
                                    <span className={cn(
                                      "text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-lg border shadow-sm transition-all group-hover:scale-105 inline-block",
                                      evaluation.type === 'teorica' ? "bg-blue-50 text-blue-600 border-blue-100" : 
                                      evaluation.type === 'practica' ? "bg-emerald-50 text-emerald-600 border-emerald-100" : 
                                      "bg-amber-50 text-amber-600 border-amber-100"
                                    )}>
                                      {evaluation.type}
                                    </span>
                                  </td>
                                  <td className="px-8 py-4">
                                    <div className="flex items-center gap-2 text-neutral-500 font-bold uppercase tracking-widest text-[10px]">
                                      {new Date(evaluation.date).toLocaleDateString()}
                                    </div>
                                  </td>
                                  <td className="px-8 py-4 text-center text-neutral-900 font-black">{evaluation.maxScore || 100}</td>
                                  <td className="px-8 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-2 group-hover:translate-x-0">
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setIsAddingEval(true);
                                          handleEditEval(evaluation);
                                        }} 
                                        className="text-neutral-400 hover:text-indigo-600 p-2 rounded-xl hover:bg-indigo-50 transition-all active:scale-90"
                                        title="Editar evaluación"
                                      >
                                        <Edit3 className="w-4 h-4" />
                                      </button>
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteEval(evaluation.id!);
                                        }} 
                                        className="text-neutral-400 hover:text-red-600 p-2 rounded-xl hover:bg-red-50 transition-all active:scale-90"
                                        title="Eliminar evaluación"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
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
              <button onClick={() => setEvalToDelete(null)} className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95">Cancelar</button>
              <button onClick={confirmDeleteEval} className="flex-1 bg-red-600 hover:bg-red-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-red-500/20 active:scale-95">Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
