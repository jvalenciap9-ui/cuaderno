import { format } from 'date-fns';
import React, { useState } from 'react';
import { X, Settings, Shield, Zap, CreditCard, Bell, Database, Trash2, Download, FileText, BarChart3, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc, limit } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

import { safeJSONParse } from '../lib/utils';
import { STORAGE_KEYS, getStorageItem, setStorageItem } from '../lib/storageKeys';

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'advanced' | 'billing'>('general');
  const [activeSubscription, setActiveSubscription] = useState<'free' | 'pro' | 'school'>(() => {
    return (getStorageItem(STORAGE_KEYS.ACTIVE_SUBSCRIPTION) as 'free' | 'pro' | 'school') || 'free';
  });

  const handleSelectPlan = (plan: 'free' | 'pro' | 'school') => {
    setActiveSubscription(plan);
    setStorageItem(STORAGE_KEYS.ACTIVE_SUBSCRIPTION, plan);
    window.dispatchEvent(new Event('subscription_change'));
  };
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [weights, setWeights] = useState({
    teorica: { name: 'Teórica', value: 30 },
    practica: { name: 'Práctica', value: 60 },
    apreciativa: { name: 'Apreciativa', value: 10 },
    checkpoint: { name: 'Agregar 4ta Nota', value: 0 }
  });
  const [useCheckpoint, setUseCheckpoint] = useState(false);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [isConfirmingClearCalendar, setIsConfirmingClearCalendar] = useState(false);
  const [isConfirmingClearEvaluations, setIsConfirmingClearEvaluations] = useState(false);
  const [importData, setImportData] = useState<any>(null);
  const [gradingScale, setGradingScale] = useState({
    maxScore: 100,
    minPassingScore: 71
  });

  const handleUpdateWeight = (type: keyof typeof weights, field: 'name' | 'value', value: string) => {
    const newWeights = { ...weights };
    if (field === 'value') {
      newWeights[type].value = parseFloat(value) || 0;
    } else {
      newWeights[type].name = value;
    }
    setWeights(newWeights);
    setStorageItem(STORAGE_KEYS.GRADING_WEIGHTS, JSON.stringify(newWeights));
    // Dispatch storage event so other components can update
    window.dispatchEvent(new Event('storage'));
  };

  React.useEffect(() => {
    const saved = getStorageItem(STORAGE_KEYS.GRADING_WEIGHTS);
    if (saved) {
      const parsed = safeJSONParse<any>(saved, null);
      if (parsed) {
        const migratedWeights = { ...weights };
        let needsMigration = false;

        (['teorica', 'practica', 'apreciativa', 'checkpoint'] as const).forEach(key => {
          if (parsed[key] !== undefined) {
            if (typeof parsed[key] === 'number') {
              migratedWeights[key].value = parsed[key];
              needsMigration = true;
            } else if (typeof parsed[key] === 'object' && parsed[key] !== null) {
              migratedWeights[key].value = typeof parsed[key].value === 'number' ? parsed[key].value : (parseFloat(String(parsed[key].value)) || migratedWeights[key].value);
              migratedWeights[key].name = parsed[key].name ?? migratedWeights[key].name;
            }
          }
        });

        setWeights(migratedWeights);
        if (needsMigration) {
          setStorageItem(STORAGE_KEYS.GRADING_WEIGHTS, JSON.stringify(migratedWeights));
        }
      }
    }
    
    const savedCheckpoint = getStorageItem(STORAGE_KEYS.USE_CHECKPOINT);
    if (savedCheckpoint) setUseCheckpoint(safeJSONParse(savedCheckpoint, false));

    const savedScale = getStorageItem(STORAGE_KEYS.GRADING_SCALE);
    if (savedScale) setGradingScale(safeJSONParse(savedScale, { maxScore: 100, minPassingScore: 71 }));
  }, []);

  const toggleCheckpoint = () => {
    const newValue = !useCheckpoint;
    setUseCheckpoint(newValue);
    setStorageItem(STORAGE_KEYS.USE_CHECKPOINT, JSON.stringify(newValue));
    window.dispatchEvent(new Event('storage'));
  };

  const handleUpdateScale = (field: 'maxScore' | 'minPassingScore', value: string) => {
    const newScale = { ...gradingScale, [field]: parseFloat(value) || 0 };
    setGradingScale(newScale);
    setStorageItem(STORAGE_KEYS.GRADING_SCALE, JSON.stringify(newScale));
  };

  const getDocsForUser = async (colName: string) => {
    if (!auth.currentUser) return [];
    const q = query(collection(db, colName), where('userId', '==', auth.currentUser.uid), limit(500));
    const snaps = await getDocs(q);
    return snaps.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  };

  const clearCollection = async (colName: string) => {
    if (!auth.currentUser) return;
    const q = query(collection(db, colName), where('userId', '==', auth.currentUser.uid), limit(500));
    const snaps = await getDocs(q);
    let batch = writeBatch(db);
    let count = 0;
    for (const d of snaps.docs) {
      batch.delete(d.ref);
      count++;
      if (count % 400 === 0) {
        await batch.commit();
        batch = writeBatch(db);
      }
    }
    if (count % 400 !== 0) await batch.commit();
  };

  const triggerAllQueries = async () => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const collectionsToTest = [
      'subjects', 'notes', 'students', 'evaluations', 'grades', 'attendance', 'materials', 'subjectModules', 'calendarEvents'
    ];
    
    // Simulate complex queries to force index generation links in the console
    for (const col of collectionsToTest) {
      try {
        const q1 = query(collection(db, col), where('userId', '==', uid), where('subjectId', '==', 'test-subject-id'), limit(500));
        await getDocs(q1);
      } catch(e) {
        console.warn(`Query over ${col} missed index. Check console for links.`);
      }
      if (col === 'calendarEvents' || col === 'evaluations') {
        try {
          const q2 = query(collection(db, col), where('moduleId', '==', 'test-module-id'), where('userId', '==', uid), limit(500));
          await getDocs(q2);
        } catch(e) {
          console.warn(`Query over ${col} by moduleId missed index.`);
        }
      }
      if (col === 'grades') {
        try {
          const q3 = query(collection(db, col), where('evaluationId', '==', 'test-eval'), where('userId', '==', uid), limit(500));
          await getDocs(q3);
        } catch(e) {
          console.warn(`Query over grades missed index.`);
        }
      }
    }
    alert('Diagnóstico completado. Revisa la consola del navegador. Si hace falta crear algún Índice Compuesto, Firestore habrá impreso allí los enlaces directos correspondientes. ¡Presiónalos todos para solucionarlo de inmediato!');
  };

  const handleExportData = async () => {
    if (!auth.currentUser) return;
    const data = {
      subjects: await getDocsForUser('subjects'),
      notes: await getDocsForUser('notes'),
      students: await getDocsForUser('students'),
      evaluations: await getDocsForUser('evaluations'),
      grades: await getDocsForUser('grades'),
      attendance: await getDocsForUser('attendance'),
      materials: await getDocsForUser('materials'),
      modules: await getDocsForUser('subjectModules'),
      calendarEvents: await getDocsForUser('calendarEvents')
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mi-cuaderno-backup-${format(new Date(), 'yyyy-MM-dd')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = safeJSONParse(event.target?.result as string, null);
        if (!data) throw new Error("Invalid json schema");
        setImportData(data);
      } catch (error) {
        console.error('Error importing data:', error);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const confirmImport = async () => {
    if (!importData || !auth.currentUser) return;
    try {
      const collections = ['subjects', 'notes', 'students', 'evaluations', 'grades', 'attendance', 'materials', 'subjectModules', 'calendarEvents'];
      
      await Promise.all(collections.map(col => clearCollection(col)));

      const importCol = async (dataList: Record<string, unknown>[], colName: string) => {
        if (!dataList || dataList.length === 0) return;
        let batch = writeBatch(db);
        let count = 0;
        for (const item of dataList) {
          const docId = typeof item.id === 'string' ? item.id : undefined;
          const { id, ...dataToSave } = item;
          dataToSave.userId = auth.currentUser!.uid;
          
          const docRef = docId ? doc(db, colName, docId) : doc(collection(db, colName));
          batch.set(docRef, dataToSave);
          count++;
          if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
          }
        }
        if (count % 400 !== 0) await batch.commit();
      };

      if (importData.subjects) await importCol(importData.subjects, 'subjects');
      if (importData.notes) await importCol(importData.notes, 'notes');
      if (importData.students) await importCol(importData.students, 'students');
      if (importData.evaluations) await importCol(importData.evaluations, 'evaluations');
      if (importData.grades) await importCol(importData.grades, 'grades');
      if (importData.attendance) await importCol(importData.attendance, 'attendance');
      if (importData.materials) await importCol(importData.materials, 'materials');
      if (importData.modules) await importCol(importData.modules, 'subjectModules');
      if (importData.calendarEvents) await importCol(importData.calendarEvents, 'calendarEvents');

      window.location.reload();
    } catch (error) {
      console.error('Error importing data:', error);
      handleFirestoreError(error, OperationType.WRITE, 'import');
      setImportData(null);
    }
  };

  const handleExportDetailedSummary = async () => {
    const { utils, writeFile } = await import('xlsx');
    if (!auth.currentUser) return;
    const userId = auth.currentUser.uid;
    const getDocsForUserSubject = async (colName: string, subjectId: string) => {
      const q = query(collection(db, colName), where('userId', '==', userId), where('subjectId', '==', subjectId), limit(500));
      const snaps = await getDocs(q);
      return snaps.docs.map(d => ({ id: d.id, ...d.data() as any }));
    };

    const subjectsQ = query(collection(db, 'subjects'), where('userId', '==', userId), limit(500));
    const subjectsSnap = await getDocs(subjectsQ);
    const subjects = subjectsSnap.docs.map(d => ({ id: d.id, ...d.data() as any }));
    
    const wb = utils.book_new();

    for (const subject of subjects) {
      const subjectId = subject.id;
      const students = await getDocsForUserSubject('students', subjectId);
      const evaluations = await getDocsForUserSubject('evaluations', subjectId);
      const grades = await getDocsForUserSubject('grades', subjectId);
      const attendance = await getDocsForUserSubject('attendance', subjectId);
      const notes = await getDocsForUserSubject('notes', subjectId);
      const modules = await getDocsForUserSubject('subjectModules', subjectId);

      // Summary Sheet
      const summaryData = [
        ['Resumen de Asignatura', subject.name],
        ['Profesor', 'Usuario'],
        ['Fecha de Reporte', new Date().toLocaleDateString()],
        [],
        ['Estadísticas Generales'],
        ['Total Estudiantes', students.length],
        ['Total Evaluaciones', evaluations.length],
        ['Total Apuntes', notes.length],
        ['Total Módulos', modules.length]
      ];
      const wsSummary = utils.aoa_to_sheet(summaryData);
      utils.book_append_sheet(wb, wsSummary, `${subject.name.substring(0, 20)} - Resumen`);

      // Grades Sheet
      const gradesHeader = ['Estudiante', ...evaluations.map(e => e.title), 'Promedio Final'];
      const gradesRows = students.map(s => {
        const studentGrades = evaluations.map(e => {
          const g = grades.find(grade => grade.studentId === s.id && grade.evaluationId === e.id);
          return g ? g.score : 0;
        });
        const avg = studentGrades.length > 0 ? studentGrades.reduce((a, b) => a + b, 0) / studentGrades.length : 0;
        return [`${s.lastName}, ${s.firstName}`, ...studentGrades, avg.toFixed(2)];
      });
      const wsGrades = utils.aoa_to_sheet([gradesHeader, ...gradesRows]);
      utils.book_append_sheet(wb, wsGrades, `${subject.name.substring(0, 20)} - Notas`);
    }

    writeFile(wb, `resumen-detallado-clases-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleClearData = async () => {
    try {
      const collections = ['subjects', 'notes', 'students', 'evaluations', 'grades', 'attendance', 'materials', 'subjectModules', 'calendarEvents'];
      await Promise.all(collections.map(col => clearCollection(col)));
      window.location.reload();
    } catch (error) {
      console.error("Error clearing data:", error);
      handleFirestoreError(error, OperationType.DELETE, 'clear_data');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-neutral-900/40 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="bg-white border border-neutral-200 rounded-[2.5rem] w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col md:flex-row h-[80vh]"
          >
            {/* Sidebar */}
            <div className="w-full md:w-72 bg-neutral-50 border-r border-neutral-200 p-8 flex flex-col">
              <div className="flex items-center gap-4 mb-10">
                <div className="w-10 h-10 bg-neutral-900 rounded-xl flex items-center justify-center text-white">
                  <Settings className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-black text-neutral-900 tracking-tight">Ajustes</h3>
              </div>

              <div className="space-y-2 flex-1">
                {[
                  { id: 'general', label: 'General', icon: Settings },
                  { id: 'advanced', label: 'Avanzado', icon: Zap },
                  { id: 'billing', label: 'Suscripción', icon: CreditCard }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all font-black text-xs uppercase tracking-widest ${
                      activeTab === tab.id 
                        ? "bg-white text-indigo-600 shadow-sm border border-neutral-200" 
                        : "text-neutral-400 hover:text-neutral-600"
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="pt-8 border-t border-neutral-200">
                <div className={`p-5 rounded-3xl border transition-all ${activeSubscription !== 'free' ? 'bg-emerald-50 border-emerald-100' : 'bg-indigo-50 border-indigo-100'}`}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-2 flex items-center gap-2">
                    <Shield className={`w-3 h-3 ${activeSubscription !== 'free' ? 'text-emerald-500' : 'text-indigo-500'}`} />
                    Plan Actual
                  </p>
                  <p className={`text-lg font-black ${activeSubscription !== 'free' ? 'text-emerald-900' : 'text-indigo-900'}`}>
                    {activeSubscription === 'pro' ? 'Premium Pro' : activeSubscription === 'school' ? 'Institucional' : 'Versión Gratis'}
                  </p>
                  <button 
                    onClick={() => setActiveTab('billing')}
                    className={`mt-4 w-full py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
                      activeSubscription !== 'free'
                        ? 'bg-white text-emerald-600 border border-emerald-200 hover:bg-emerald-100' 
                        : 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20 hover:bg-indigo-500'
                    }`}
                  >
                    {activeSubscription !== 'free' ? 'Gestionar Plan' : 'Ver Planes'}
                  </button>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col bg-white overflow-hidden">
              <div className="p-8 border-b border-neutral-100 flex items-center justify-between">
                <h4 className="text-sm font-black text-neutral-400 uppercase tracking-[0.2em]">
                  {activeTab === 'general' && 'Configuración General'}
                  {activeTab === 'advanced' && 'Funciones Avanzadas'}
                  {activeTab === 'billing' && 'Gestión de Suscripción'}
                </h4>
                <button onClick={onClose} className="text-neutral-400 hover:text-neutral-900 transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-10 space-y-10 custom-scrollbar">
                {activeTab === 'general' && (
                  <div className="space-y-8">
                    <section className="space-y-4">
                      <h5 className="text-lg font-black text-neutral-900">Notificaciones</h5>
                      <div className="space-y-4">
                        <label className="flex items-center justify-between p-4 bg-neutral-50 rounded-2xl border border-neutral-100 cursor-pointer hover:bg-white hover:border-indigo-100 transition-all">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-neutral-200 shadow-sm">
                              <Bell className="w-5 h-5 text-neutral-400" />
                            </div>
                            <div>
                              <p className="font-bold text-neutral-900">Recordatorios de clase</p>
                              <p className="text-xs text-neutral-500">Recibe avisos antes de tus clases</p>
                            </div>
                          </div>
                          <input type="checkbox" defaultChecked className="w-5 h-5 rounded-lg border-neutral-300 text-indigo-600 focus:ring-indigo-500" />
                        </label>
                      </div>
                    </section>

                    <section className="space-y-4">
                      <h5 className="text-lg font-black text-neutral-900">Datos y Privacidad</h5>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <button 
                          onClick={handleExportData}
                          className="flex items-center gap-4 p-4 bg-neutral-50 rounded-2xl border border-neutral-100 hover:bg-white hover:border-indigo-100 transition-all text-left group"
                        >
                          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-neutral-200 shadow-sm group-hover:scale-110 transition-transform">
                            <Download className="w-5 h-5 text-indigo-500" />
                          </div>
                          <div>
                            <p className="font-bold text-neutral-900">Exportar JSON</p>
                            <p className="text-[10px] text-neutral-500 uppercase tracking-widest">Backup Completo</p>
                          </div>
                        </button>
                        {importData ? (
                          <div className="flex flex-col gap-3 p-4 bg-emerald-50 rounded-2xl border border-emerald-100 md:col-span-2">
                            <p className="text-sm font-bold text-emerald-900 border-b border-emerald-200/50 pb-2">
                              ¿Sobrescribir datos con backup cargado?
                            </p>
                            <div className="flex items-center gap-3 mt-1">
                              <button 
                                onClick={() => setImportData(null)}
                                className="flex-1 bg-white hover:bg-neutral-50 text-neutral-900 font-bold py-2 rounded-xl text-xs transition-colors border border-neutral-200"
                              >
                                Cancelar
                              </button>
                              <button 
                                onClick={confirmImport}
                                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded-xl text-xs transition-colors shadow-sm"
                              >
                                Importar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-4 p-4 bg-neutral-50 rounded-2xl border border-neutral-100 hover:bg-white hover:border-indigo-100 transition-all text-left group"
                          >
                            <input 
                              type="file" 
                              ref={fileInputRef} 
                              onChange={handleImportData} 
                              accept=".json" 
                              className="hidden" 
                            />
                            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-neutral-200 shadow-sm group-hover:scale-110 transition-transform">
                              <Download className="w-5 h-5 text-emerald-500 rotate-180" />
                            </div>
                            <div>
                              <p className="font-bold text-neutral-900">Importar JSON</p>
                              <p className="text-[10px] text-neutral-500 uppercase tracking-widest">Restaurar Backup</p>
                            </div>
                          </button>
                        )}

                        {isConfirmingClear ? (
                          <div className="flex flex-col gap-3 p-4 bg-red-50 rounded-2xl border border-red-100">
                            <p className="text-sm font-bold text-red-900 border-b border-red-200/50 pb-2">
                              ¿Eliminar TODOS los datos? Esta acción es irreversible.
                            </p>
                            <div className="flex items-center gap-3 mt-1">
                              <button 
                                onClick={() => setIsConfirmingClear(false)}
                                className="flex-1 bg-white hover:bg-neutral-50 text-neutral-900 font-bold py-2 rounded-xl text-xs transition-colors border border-neutral-200"
                              >
                                Cancelar
                              </button>
                              <button 
                                onClick={handleClearData}
                                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded-xl text-xs transition-colors shadow-sm"
                              >
                                Sí, borrar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button 
                            onClick={() => setIsConfirmingClear(true)}
                            className="flex items-center gap-4 p-4 bg-neutral-50 rounded-2xl border border-neutral-100 hover:bg-red-50 hover:border-red-100 transition-all text-left group"
                          >
                            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-neutral-200 shadow-sm group-hover:scale-110 transition-transform">
                              <Trash2 className="w-5 h-5 text-red-500" />
                            </div>
                            <div>
                              <p className="font-bold text-neutral-900">Borrar Todo</p>
                              <p className="text-[10px] text-neutral-500 uppercase tracking-widest">Acción Irreversible</p>
                            </div>
                          </button>
                        )}
                      </div>
                    </section>
                  </div>
                )}

                {activeTab === 'advanced' && (
                  <div className="space-y-10">
                    <section className="space-y-6">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center border border-indigo-100">
                          <BarChart3 className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div>
                          <h5 className="text-lg font-black text-neutral-900">Configuración de Ponderaciones</h5>
                          <p className="text-xs text-neutral-500 font-medium">Define cómo se calcula el promedio final</p>
                        </div>
                      </div>

                      <div className={`grid grid-cols-1 gap-6 ${useCheckpoint ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
                        {([
                          { id: 'teorica', color: 'blue' },
                          { id: 'practica', color: 'emerald' },
                          { id: 'apreciativa', color: 'amber' },
                          ...(useCheckpoint ? [{ id: 'checkpoint', color: 'indigo' }] : [])
                        ] as const).map(type => (
                          <div key={type.id} className="bg-neutral-50 border border-neutral-100 p-6 rounded-3xl space-y-4">
                            <input 
                              type="text"
                              value={weights[type.id as keyof typeof weights].name}
                              onChange={(e) => handleUpdateWeight(type.id as keyof typeof weights, 'name', e.target.value)}
                              className="block w-full bg-transparent text-[10px] font-black text-neutral-400 uppercase tracking-widest outline-none border-b border-transparent focus:border-neutral-200"
                            />
                            <div className="relative">
                              <input 
                                type="number" 
                                step="0.1"
                                value={weights[type.id as keyof typeof weights].value} 
                                onChange={(e) => handleUpdateWeight(type.id as keyof typeof weights, 'value', e.target.value)}
                                className="w-full bg-white border border-neutral-200 rounded-2xl px-4 py-3 font-black text-lg outline-none focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500 transition-all"
                              />
                              <span className="absolute right-4 top-1/2 -translate-y-1/2 font-black text-neutral-300">%</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="p-6 bg-neutral-50 border border-neutral-100 rounded-3xl space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center border border-neutral-200">
                              <FileText className="w-4 h-4 text-indigo-600" />
                            </div>
                            <div>
                              <p className="font-bold text-neutral-900">Opción de Agregar 4ta Nota</p>
                              <p className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold">Habilitar evaluación adicional</p>
                            </div>
                          </div>
                          <button 
                            onClick={toggleCheckpoint}
                            className={`w-12 h-6 rounded-full transition-all relative ${useCheckpoint ? 'bg-indigo-600' : 'bg-neutral-200'}`}
                          >
                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${useCheckpoint ? 'left-7' : 'left-1'}`} />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="p-6 bg-neutral-50 border border-neutral-100 rounded-3xl space-y-4">
                          <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest">Puntuación Máxima</label>
                          <input 
                            type="number" 
                            value={gradingScale.maxScore} 
                            onChange={(e) => handleUpdateScale('maxScore', e.target.value)}
                            className="w-full bg-white border border-neutral-200 rounded-2xl px-4 py-3 font-black text-lg outline-none focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500 transition-all"
                          />
                        </div>
                        <div className="p-6 bg-neutral-50 border border-neutral-100 rounded-3xl space-y-4">
                          <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest">Nota Mínima para Aprobar</label>
                          <input 
                            type="number" 
                            value={gradingScale.minPassingScore} 
                            onChange={(e) => handleUpdateScale('minPassingScore', e.target.value)}
                            className="w-full bg-white border border-neutral-200 rounded-2xl px-4 py-3 font-black text-lg outline-none focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500 transition-all"
                          />
                        </div>
                      </div>

                      <div className="p-6 bg-amber-50 border border-amber-100 rounded-3xl flex items-start gap-4">
                        <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-900/70 font-medium leading-relaxed">
                          Las ponderaciones se suman directamente para el cálculo del promedio final (ej. 30% + 60% + 10% = 100%).
                        </p>
                      </div>
                    </section>

                    <div className="space-y-4 pt-10 border-t border-neutral-100">
                      <h5 className="text-lg font-black text-neutral-900">Configuración de Base de Datos</h5>
                      <div className="p-6 bg-neutral-50 rounded-3xl border border-neutral-100 space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Database className="w-5 h-5 text-neutral-400" />
                            <span className="font-bold text-neutral-700">Estado de Cloud Firestore</span>
                          </div>
                          <span className="px-3 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-black rounded-full border border-emerald-100 uppercase tracking-widest">Conectado</span>
                        </div>
                        <p className="text-xs text-neutral-500 leading-relaxed font-medium">
                          Tus datos se almacenan de forma segura en la nube (Firebase Firestore). Esto permite una sincronización en tiempo real entre múltiples dispositivos. Funciona de manera offline y guarda datos localmente si pierdes internet.
                        </p>
                        {isConfirmingClearCalendar ? (
                          <div className="mt-2 p-4 bg-red-50 rounded-2xl border border-red-100 flex flex-col gap-3">
                            <p className="text-sm font-bold text-red-900 border-b border-red-200/50 pb-2">
                              ¿Eliminar TODOS los eventos generados por IA? (No borra evaluaciones)
                            </p>
                            <div className="flex items-center gap-3">
                              <button 
                                onClick={() => setIsConfirmingClearCalendar(false)}
                                className="flex-1 bg-white hover:bg-neutral-50 text-neutral-900 font-bold py-2 rounded-xl text-xs transition-colors border border-neutral-200"
                              >
                                Cancelar
                              </button>
                              <button 
                                onClick={async () => {
                                  try {
                                    await clearCollection('calendarEvents');
                                    setIsConfirmingClearCalendar(false);
                                  } catch (error) {
                                    console.error(error);
                                  }
                                }}
                                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded-xl text-xs transition-colors shadow-sm"
                              >
                                Sí, borrar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setIsConfirmingClearCalendar(true)}
                            className="mt-2 w-full bg-red-50 hover:bg-red-100 text-red-600 font-bold py-3 px-4 rounded-xl text-sm transition-colors text-left flex items-center gap-2"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                            Limpiar Eventos de Calendario (IA)
                          </button>
                        )}
                        
                        {isConfirmingClearEvaluations ? (
                          <div className="mt-2 p-4 bg-orange-50 rounded-2xl border border-orange-100 flex flex-col gap-3">
                            <p className="text-sm font-bold text-orange-900 border-b border-orange-200/50 pb-2">
                              ¿Eliminar TODAS las Evaluaciones del sistema? Esta acción es irreversible.
                            </p>
                            <div className="flex items-center gap-3">
                              <button 
                                onClick={() => setIsConfirmingClearEvaluations(false)}
                                className="flex-1 bg-white hover:bg-neutral-50 text-neutral-900 font-bold py-2 rounded-xl text-xs transition-colors border border-neutral-200"
                              >
                                Cancelar
                              </button>
                              <button 
                                onClick={async () => {
                                  try {
                                    await clearCollection('evaluations');
                                    setIsConfirmingClearEvaluations(false);
                                  } catch (error) {
                                    console.error(error);
                                  }
                                }}
                                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold py-2 rounded-xl text-xs transition-colors shadow-sm"
                              >
                                Sí, borrar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setIsConfirmingClearEvaluations(true)}
                            className="mt-2 w-full bg-orange-50 hover:bg-orange-100 text-orange-600 font-bold py-3 px-4 rounded-xl text-sm transition-colors text-left flex items-center gap-2"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                            Limpiar Todas las Evaluaciones
                          </button>
                        )}
                        
                        <div className="mt-8 border-t border-neutral-200 pt-8">
                          <h4 className="text-sm font-black text-neutral-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Zap className="w-4 h-4 text-indigo-500" />
                            Diagnóstico de Base de Datos
                          </h4>
                          <p className="text-xs text-neutral-500 mb-4 leading-relaxed">
                            Si notas que desaparecen datos o algunas pantallas fallan (especialmente al usar filtros compuestos), puede que Firebase necesite crear Índices Compuestos. Ejecuta esta herramienta y abre la consola de tu navegador para hacer clic en los enlaces de generación.
                          </p>
                          <button
                            onClick={triggerAllQueries}
                            className="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold py-3 px-4 rounded-xl text-sm transition-colors text-left flex items-center gap-2"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
                            Generar Enlaces de Índices
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'billing' && (
                  <div className="space-y-10">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className={`cursor-pointer p-8 rounded-[2.5rem] border-2 transition-all ${activeSubscription === 'free' ? 'border-indigo-600 bg-indigo-50/50' : 'border-neutral-100 bg-white hover:border-indigo-200 hover:bg-neutral-50'}`} onClick={() => handleSelectPlan('free')}>
                        <h6 className="text-xl font-black text-neutral-900 mb-2">Gratis</h6>
                        <p className="text-4xl font-black text-neutral-900 mb-6">$0<span className="text-sm text-neutral-400">/mes</span></p>
                        <ul className="space-y-3 mb-8">
                          {['Hasta 3 asignaturas', 'Apuntes locales', 'IA básica', 'Soporte comunitario'].map(feat => (
                            <li key={feat} className="flex items-center gap-2 text-xs font-bold text-neutral-500">
                              <CheckCircle className="w-4 h-4 text-indigo-500" />
                              {feat}
                            </li>
                          ))}
                        </ul>
                        {activeSubscription === 'free' && <div className="text-center py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">Plan Actual</div>}
                      </div>

                      <div className={`cursor-pointer p-8 rounded-[2.5rem] border-2 transition-all relative overflow-hidden ${activeSubscription === 'pro' ? 'border-emerald-600 bg-emerald-50/50' : 'border-neutral-100 bg-white hover:border-emerald-200 hover:bg-neutral-50'}`} onClick={() => handleSelectPlan('pro')}>
                        <div className="absolute top-4 right-4 bg-amber-400 text-white px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest shadow-lg">Popular</div>
                        <h6 className="text-xl font-black text-neutral-900 mb-2">Premium Pro</h6>
                        <p className="text-4xl font-black text-neutral-900 mb-6">$4.99<span className="text-sm text-neutral-400">/mes</span></p>
                        <ul className="space-y-3 mb-8">
                          {['Asignaturas ilimitadas', 'IA avanzada ilimitada', 'Sincronización Cloud', 'Soporte prioritario'].map(feat => (
                            <li key={feat} className="flex items-center gap-2 text-xs font-bold text-neutral-500">
                              <CheckCircle className={`w-4 h-4 ${activeSubscription === 'pro' ? 'text-emerald-500' : 'text-neutral-300'}`} />
                              {feat}
                            </li>
                          ))}
                        </ul>
                        {activeSubscription === 'pro' && <div className="text-center py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">Plan Actual</div>}
                      </div>

                      <div className={`cursor-pointer p-8 rounded-[2.5rem] border-2 transition-all relative overflow-hidden ${activeSubscription === 'school' ? 'border-blue-600 bg-blue-50/50' : 'border-neutral-100 bg-white hover:border-blue-200 hover:bg-neutral-50'}`} onClick={() => handleSelectPlan('school')}>
                        <div className="absolute top-4 right-4 bg-blue-600 text-white px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest shadow-lg">Colegios</div>
                        <h6 className="text-xl font-black text-neutral-900 mb-2">Institucional</h6>
                        <p className="text-4xl font-black text-neutral-900 mb-6">$99.99<span className="text-sm text-neutral-400">/año</span></p>
                        <ul className="space-y-3 mb-8">
                          {['30 suscripciones anuales', 'Panel administrativo', 'Sincronización Cloud', 'Soporte 24/7'].map(feat => (
                            <li key={feat} className="flex items-center gap-2 text-xs font-bold text-neutral-500">
                              <CheckCircle className={`w-4 h-4 ${activeSubscription === 'school' ? 'text-blue-500' : 'text-neutral-300'}`} />
                              {feat}
                            </li>
                          ))}
                        </ul>
                        {activeSubscription === 'school' && <div className="text-center py-2 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">Plan Actual</div>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CheckCircle({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
