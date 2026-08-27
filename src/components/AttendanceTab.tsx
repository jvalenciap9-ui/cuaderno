import { useState, useMemo, useEffect } from 'react';
import { useCustomCollectionData } from "../lib/firestoreUtils";
import { collection, query, where, addDoc, updateDoc, deleteDoc, doc, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthProvider';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
import { Check, X as XIcon, Clock, ChevronLeft, ChevronRight, Calendar, BarChart3, Info, AlertTriangle, Download, FileSpreadsheet } from 'lucide-react';
import { exportSubjectDataToExcel } from '../lib/exportUtils';
import { exportSubjectToJSON, triggerJSONDownload } from '../lib/jsonSyncUtils';
import { cn } from '../lib/utils';
import { useCanonicalSubjectId } from '../lib/classGroups';
import { 
  startOfWeek, 
  addDays, 
  format, 
  isSameDay, 
  parseISO, 
  subWeeks, 
  addWeeks,
  isToday,
  eachDayOfInterval,
  endOfWeek
} from 'date-fns';
import { es } from 'date-fns/locale';

export function AttendanceTab({ subjectId: rawSubjectId }: { subjectId: string }) {
  // ── Aula/Grupo multiasignatura: asistencia diaria COMPARTIDA ───────────
  // La asistencia pertenece al aula (asignatura canónica) y a una fecha,
  // NO a cada materia: se registra una vez y los porcentajes nunca se
  // multiplican por materia. Para asignaturas independientes el canonical
  // es la misma asignatura → comportamiento legacy idéntico.
  const { canonicalId } = useCanonicalSubjectId(rawSubjectId);
  const subjectId = canonicalId;
  const { user } = useAuth();
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [showWeekends, setShowWeekends] = useState(false);
  const [viewMode, setViewMode] = useState<'week' | 'module' | 'evaluation'>('week');
  const [selectedModuleId, setSelectedModuleId] = useState<string | ''>('');
  const [selectedEvalId, setSelectedEvalId] = useState<string | ''>('');
  const [warningModalOpen, setWarningModalOpen] = useState(false);
  const [pendingAttendance, setPendingAttendance] = useState<{ studentId: string, dateStr: string, currentStatus: string | undefined } | null>(null);
  const [warningMessage, setWarningMessage] = useState<{ title: string, message: string }>({ title: '', message: '' });

  const subjectsQuery = user?.uid ? query(collection(db, 'subjects'), where('userId', '==', user?.uid), limit(500)) : null;
  const [subjects = []] = useCustomCollectionData(subjectsQuery);
  const subject = subjects.find(s => s.id === subjectId);

  const studentsQuery = user?.uid ? query(collection(db, 'students'), where('subjectId', '==', subjectId), where('userId', '==', user?.uid), limit(500)) : null;
  const [students = [], loadingStudents] = useCustomCollectionData(studentsQuery);

  const modulesQuery = user?.uid ? query(collection(db, 'subjectModules'), where('subjectId', '==', subjectId), where('userId', '==', user?.uid), limit(500)) : null;
  const [modules = [], loadingModules] = useCustomCollectionData(modulesQuery);

  const evalsQuery = user?.uid ? query(collection(db, 'evaluations'), where('subjectId', '==', subjectId), where('userId', '==', user?.uid), limit(500)) : null;
  const [evaluations = [], loadingEvals] = useCustomCollectionData(evalsQuery);
  
  const attendanceQuery = user?.uid ? query(collection(db, 'attendance'), where('subjectId', '==', subjectId), where('userId', '==', user?.uid), limit(500)) : null;
  const [allAttendance = [], loadingAttendance] = useCustomCollectionData(attendanceQuery);

  useEffect(() => {
    if (viewMode === 'module' && selectedModuleId === '' && modules.length > 0) {
      setSelectedModuleId(modules[0].id!);
    }
    if (viewMode === 'evaluation' && selectedEvalId === '' && evaluations.length > 0) {
      setSelectedEvalId(evaluations[0].id!);
    }
  }, [viewMode, modules, evaluations, selectedModuleId, selectedEvalId]);

  const displayDays = useMemo(() => {
    let days: Date[] = [];
    
    if (viewMode === 'week') {
      days = eachDayOfInterval({
        start: currentWeekStart,
        end: endOfWeek(currentWeekStart, { weekStartsOn: 1 })
      });
    } else if (viewMode === 'module') {
      const mod = modules.find(m => m.id === selectedModuleId);
      if (mod && mod.startDate && mod.endDate) {
        try {
          days = eachDayOfInterval({
            start: parseISO(mod.startDate),
            end: parseISO(mod.endDate)
          });
        } catch (e) {
          // Invalid dates
        }
      }
    } else if (viewMode === 'evaluation') {
      const ev = evaluations.find(e => e.id === selectedEvalId);
      if (ev && ev.date) {
        try {
          days = [parseISO(ev.date)];
        } catch (e) {
          // Invalid date
        }
      }
    }

    if (!showWeekends) {
      return days.filter(day => {
        const dayOfWeek = day.getDay();
        return dayOfWeek !== 0 && dayOfWeek !== 6;
      });
    }
    
    return days;
  }, [viewMode, currentWeekStart, showWeekends, selectedModuleId, selectedEvalId, modules, evaluations]);

  const visibleDateStrings = useMemo(() => {
    return new Set(displayDays.map(d => format(d, 'yyyy-MM-dd')));
  }, [displayDays]);

  const filteredAttendance = useMemo(() => {
    return allAttendance.filter(a => visibleDateStrings.has(a.date));
  }, [allAttendance, visibleDateStrings]);

  const processAttendanceChange = async (studentId: string, dateStr: string, currentStatus: string | undefined) => {
    if (!user) return;
    const nextStatusMap: Record<string, 'present' | 'absent' | 'late' | undefined> = {
      'present': 'late',
      'late': 'absent',
      'absent': undefined,
      'undefined': 'present'
    };

    const nextStatus = nextStatusMap[currentStatus || 'undefined'];
    const existing = allAttendance.find(a => a.studentId === studentId && a.date === dateStr);

    try {
      if (nextStatus) {
        if (existing) {
          await updateDoc(doc(db, 'attendance', existing.id!), { status: nextStatus });
        } else {
          await addDoc(collection(db, 'attendance'), {
            userId: user.uid,
            subjectId,
            studentId,
            date: dateStr,
            status: nextStatus
          });
        }
      } else if (existing) {
        await deleteDoc(doc(db, 'attendance', existing.id!));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'attendance');
    }
  };

  const handleStatusChange = async (studentId: string, dateStr: string, currentStatus: string | undefined) => {
    if (!user) return;

    let isOutOfRange = false;
    let title = '';
    let message = '';
    const dateToCheck = parseISO(dateStr).getTime();

    if (viewMode === 'module' && selectedModuleId) {
      const mod = modules.find(m => m.id === selectedModuleId);
      if (mod) {
        const modStart = mod.startDate ? parseISO(mod.startDate).getTime() : null;
        let modEnd = mod.endDate ? parseISO(mod.endDate).getTime() : null;
        if (modEnd) modEnd += 86400000 - 1; 

        if ((modStart && dateToCheck < modStart) || (modEnd && dateToCheck > modEnd)) {
          isOutOfRange = true;
          title = 'Fecha fuera del período del módulo';
          message = `La fecha ${format(parseISO(dateStr), 'dd/MM/yyyy')} está fuera del rango configurado para el módulo "${mod.title}" (${mod.startDate ? format(parseISO(mod.startDate), 'dd/MM/yyyy') : 'N/A'} - ${mod.endDate ? format(parseISO(mod.endDate), 'dd/MM/yyyy') : 'N/A'}).`;
        }
      }
    } else {
      if (subject) {
        const subStart = subject.startDate ? parseISO(subject.startDate).getTime() : null;
        let subEnd = subject.endDate ? parseISO(subject.endDate).getTime() : null;
        if (subEnd) subEnd += 86400000 - 1;

        if ((subStart && dateToCheck < subStart) || (subEnd && dateToCheck > subEnd)) {
          isOutOfRange = true;
          title = 'Fecha fuera del período de la asignatura';
          message = `La fecha ${format(parseISO(dateStr), 'dd/MM/yyyy')} está fuera del rango configurado para la asignatura "${subject.name}" (${subject.startDate ? format(parseISO(subject.startDate), 'dd/MM/yyyy') : 'N/A'} - ${subject.endDate ? format(parseISO(subject.endDate), 'dd/MM/yyyy') : 'N/A'}).`;
        }
      }
    }

    if (isOutOfRange) {
      setWarningMessage({ title, message });
      setPendingAttendance({ studentId, dateStr, currentStatus });
      setWarningModalOpen(true);
      return;
    }

    await processAttendanceChange(studentId, dateStr, currentStatus);
  };

  const getGlobalStats = () => {
    if (filteredAttendance.length === 0) return { percentage: 0, total: 0 };
    const presents = filteredAttendance.filter(a => a.status === 'present').length;
    const lates = filteredAttendance.filter(a => a.status === 'late').length;
    const attended = presents + lates;
    const percentage = (attended / filteredAttendance.length) * 100;
    return { percentage: Math.round(percentage), total: filteredAttendance.length };
  };

  const getStudentStats = (studentId: string) => {
    const studentRecords = filteredAttendance.filter(a => a.studentId === studentId);
    if (studentRecords.length === 0) return 0;
    const attended = studentRecords.filter(a => a.status === 'present' || a.status === 'late').length;
    return Math.round((attended / studentRecords.length) * 100);
  };

  const stats = getGlobalStats();
  const isLoading = loadingStudents || loadingModules || loadingEvals || loadingAttendance;

  if (isLoading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white border border-neutral-200 p-8 rounded-[2.5rem] shadow-sm h-32" />
          ))}
        </div>
        <div className="bg-white border border-neutral-200 rounded-[3rem] overflow-hidden shadow-sm h-96" />
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="p-24 text-center text-neutral-400 bg-white border border-neutral-200 rounded-[3rem] shadow-sm">
        <div className="w-24 h-24 bg-neutral-50 rounded-[2rem] flex items-center justify-center mx-auto mb-8 border border-neutral-100">
          <Calendar className="w-12 h-12 text-neutral-200" />
        </div>
        <p className="text-3xl font-black text-neutral-900 tracking-tight">No hay estudiantes registrados</p>
        <p className="text-lg mt-4 font-medium text-neutral-500">Ve a la pestaña de Participantes para importar estudiantes.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Global Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        <div className="bg-white border border-neutral-200 p-8 rounded-[2.5rem] shadow-sm flex items-center gap-6 hover:border-indigo-200 hover:shadow-2xl transition-all duration-500 group">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center border border-indigo-100 group-hover:scale-110 transition-transform duration-500">
            <BarChart3 className="w-8 h-8 text-indigo-600" />
          </div>
          <div>
            <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em] mb-1">Asistencia Global</p>
            <p className="text-4xl font-black text-neutral-900 tracking-tight">{stats.percentage}%</p>
          </div>
        </div>
        
        <div className="bg-white border border-neutral-200 p-8 rounded-[2.5rem] shadow-sm flex items-center gap-6 hover:border-emerald-200 hover:shadow-2xl transition-all duration-500 group">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center border border-emerald-100 group-hover:scale-110 transition-transform duration-500">
            <Check className="w-8 h-8 text-emerald-600" />
          </div>
          <div>
            <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em] mb-1">Total Registros</p>
            <p className="text-4xl font-black text-neutral-900 tracking-tight">{stats.total}</p>
          </div>
        </div>

        <div className="md:col-span-2 bg-white border border-neutral-200 p-8 rounded-[2.5rem] shadow-sm flex flex-col sm:flex-row items-start sm:items-center gap-6 hover:border-neutral-300 hover:shadow-2xl transition-all duration-500">
          <div className="w-16 h-16 rounded-2xl bg-neutral-50 flex items-center justify-center border border-neutral-100 shrink-0">
            <Calendar className="w-8 h-8 text-neutral-400" />
          </div>
          <div className="flex-1 min-w-0 w-full space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <select 
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as 'week' | 'module' | 'evaluation')}
                className="appearance-none bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-xs font-black text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all cursor-pointer uppercase tracking-widest"
              >
                <option value="week">Por Semana</option>
                <option value="module">Por Plan / Módulo</option>
                <option value="evaluation">Por Evaluación</option>
              </select>

              <div className="flex-1">
                {viewMode === 'week' && (
                  <div className="flex items-center justify-between bg-neutral-50 border border-neutral-200 rounded-xl p-1 relative">
                    <button onClick={() => setCurrentWeekStart(subWeeks(currentWeekStart, 1))} className="p-2 hover:bg-white rounded-lg transition-all active:scale-90 text-neutral-400 hover:text-neutral-900 hover:shadow-sm z-10" title="Ver semana anterior">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    
                    <div className="flex items-center justify-center gap-2 group relative cursor-pointer px-4 py-1 rounded-lg hover:bg-neutral-200/50 transition-colors">
                      <input 
                        type="date"
                        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                        value={format(currentWeekStart, 'yyyy-MM-dd')}
                        onChange={(e) => {
                          if (e.target.value) {
                            setCurrentWeekStart(startOfWeek(parseISO(e.target.value), { weekStartsOn: 1 }));
                          }
                        }}
                      />
                      <Calendar className="w-3.5 h-3.5 text-neutral-400 group-hover:text-indigo-600 transition-colors" />
                      <span className="text-xs font-black text-neutral-900 uppercase tracking-widest group-hover:text-indigo-600 transition-colors">
                        {format(currentWeekStart, 'dd MMM', { locale: es })} - {format(endOfWeek(currentWeekStart, { weekStartsOn: 1 }), 'dd MMM', { locale: es })}
                      </span>
                    </div>

                    <button onClick={() => setCurrentWeekStart(addWeeks(currentWeekStart, 1))} className="p-2 hover:bg-white rounded-lg transition-all active:scale-90 text-neutral-400 hover:text-neutral-900 hover:shadow-sm z-10" title="Ver semana siguiente">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
                
                {viewMode === 'module' && (
                  <select 
                    value={selectedModuleId}
                    onChange={(e) => setSelectedModuleId(e.target.value)}
                    className="w-full appearance-none bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-xs font-black text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all cursor-pointer uppercase tracking-widest"
                  >
                    {modules.length === 0 && <option value="">Sin módulos</option>}
                    {modules.map(m => (
                      <option key={m.id} value={m.id}>{m.title}</option>
                    ))}
                  </select>
                )}

                {viewMode === 'evaluation' && (
                  <select 
                    value={selectedEvalId}
                    onChange={(e) => setSelectedEvalId(e.target.value)}
                    className="w-full appearance-none bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-xs font-black text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all cursor-pointer uppercase tracking-widest"
                  >
                    {evaluations.length === 0 && <option value="">Sin evaluaciones</option>}
                    {evaluations.map(e => (
                      <option key={e.id} value={e.id}>{e.title}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between border-t border-neutral-100 pt-4 gap-4">
              <label className="flex items-center gap-3 text-[10px] font-black text-neutral-400 uppercase tracking-widest cursor-pointer hover:text-neutral-900 transition-colors">
                <input 
                  type="checkbox" 
                  checked={showWeekends} 
                  onChange={(e) => setShowWeekends(e.target.checked)}
                  className="w-4 h-4 rounded-lg border-neutral-200 bg-neutral-50 text-indigo-600 focus:ring-indigo-500/20"
                />
                Fines de semana
              </label>
              
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!subject) return;
                    const json = await exportSubjectToJSON(user?.uid || '', subjectId);
                    triggerJSONDownload(json, `clase-${subject.name.replace(/\s+/g, '_')}.json`);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 text-[10px] font-black uppercase tracking-widest transition-all"
                  title="Exportar clase completa en JSON"
                >
                  <Download className="w-3.5 h-3.5" />
                  JSON
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (subject) {
                      exportSubjectDataToExcel(user?.uid || '', user?.displayName || user?.email || null, subjectId);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-widest transition-all"
                  title="Exportar asistencia en Excel"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Excel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Banner explicativo del ciclo de asistencia */}
      <div className="bg-indigo-50/40 border border-indigo-100/60 rounded-[2rem] p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-100/80 flex items-center justify-center text-indigo-600 shrink-0 shadow-inner">
            <Info className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-black text-neutral-900 uppercase tracking-wider">¿Cómo registrar la asistencia?</h4>
            <p className="text-neutral-500 text-xs mt-1 font-medium leading-relaxed">
              Haz clic consecutivamente sobre el casillero de un estudiante para alternar cíclicamente entre los diferentes estados de asistencia.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 bg-white px-5 py-3 rounded-2xl border border-neutral-100 shadow-sm text-xs font-black tracking-wide text-neutral-600">
          <span className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50/60 px-2.5 py-1 rounded-xl border border-emerald-100/50"><Check className="w-4 h-4" /> Presente</span>
          <span className="text-neutral-300">→</span>
          <span className="flex items-center gap-1.5 text-amber-600 bg-amber-50/60 px-2.5 py-1 rounded-xl border border-amber-100/50"><Clock className="w-4 h-4" /> Tarde</span>
          <span className="text-neutral-300">→</span>
          <span className="flex items-center gap-1.5 text-red-600 bg-red-50/60 px-2.5 py-1 rounded-xl border border-red-100/50"><XIcon className="w-4 h-4" /> Ausente</span>
          <span className="text-neutral-300">→</span>
          <span className="text-neutral-400 bg-neutral-50 px-2.5 py-1 rounded-xl border border-neutral-100/50">Sin Registro</span>
        </div>
      </div>

      {displayDays.length === 0 ? (
        <div className="bg-white border border-neutral-200 rounded-[3rem] p-16 text-center shadow-sm">
          <Calendar className="w-12 h-12 text-neutral-200 mx-auto mb-4" />
          <p className="text-xl font-black text-neutral-900">No hay fechas disponibles</p>
          <p className="text-sm text-neutral-500 mt-2 font-medium">
            {viewMode === 'module' ? 'El plan seleccionado no tiene fecha de inicio y fin configuradas.' : 
             viewMode === 'evaluation' ? 'No hay evaluaciones programadas.' : 
             'Ajusta los filtros para ver la asistencia.'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-[3rem] overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-100">
                <tr>
                  <th className="px-10 py-6 font-black uppercase tracking-[0.2em] text-[10px] sticky left-0 bg-neutral-50 z-10 w-80 border-r border-neutral-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">Estudiante</th>
                  {displayDays.map(day => (
                    <th key={day.toISOString()} className={cn(
                      "px-2 py-6 font-black text-center min-w-[100px] transition-colors",
                      isToday(day) ? 'text-indigo-600 bg-indigo-50/50' : 'hover:bg-neutral-100/50'
                    )}>
                      <div className="text-[10px] uppercase tracking-[0.2em] opacity-50 mb-1">{format(day, 'EEE', { locale: es })}</div>
                      <div className="text-lg tracking-tight">{format(day, 'dd')}</div>
                    </th>
                  ))}
                  <th className="px-10 py-6 font-black uppercase tracking-[0.2em] text-[10px] text-center w-40 border-l border-neutral-100">Asistencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {students.map(student => {
                  const studentPercentage = getStudentStats(student.id!);
                  const firstName = student.firstName.trim().split(' ')[0];
                  const lastName = student.lastName.trim().split(' ')[0];
                  
                  return (
                    <tr key={student.id} className="hover:bg-neutral-50/50 transition-all group duration-300">
                      <td className="px-10 py-6 sticky left-0 bg-white group-hover:bg-neutral-50/80 transition-colors z-10 border-r border-neutral-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                        <p className="text-xl font-black text-neutral-900 truncate max-w-[240px] group-hover:text-indigo-600 transition-colors leading-tight">{firstName} {lastName}</p>
                        <p className="text-[10px] text-neutral-400 font-mono font-black mt-1.5 tracking-widest uppercase opacity-60">{student.cedula}</p>
                      </td>
                      {displayDays.map(day => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const record = allAttendance.find(a => a.studentId === student.id && a.date === dateStr);
                        const status = record?.status;

                        return (
                          <td key={dateStr} className={cn(
                            "px-2 py-6 transition-colors",
                            isToday(day) ? 'bg-indigo-50/10' : ''
                          )}>
                            <div className="flex justify-center">
                              <button 
                                onClick={() => handleStatusChange(student.id!, dateStr, status)}
                                className={cn(
                                  "w-12 h-12 rounded-2xl flex items-center justify-center transition-all border-2 active:scale-90 shadow-sm",
                                  status === 'present' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' :
                                  status === 'late' ? 'bg-amber-50 border-amber-200 text-amber-600' :
                                  status === 'absent' ? 'bg-red-50 border-red-200 text-red-600' :
                                  'bg-neutral-50 border-neutral-100 text-neutral-300 hover:border-neutral-300 hover:bg-white hover:text-neutral-400'
                                )}
                                title={status === 'present' ? 'Asistencia: Presente. Haz clic para cambiar a Tardanza.' : status === 'late' ? 'Asistencia: Tardanza. Haz clic para cambiar a Ausente.' : status === 'absent' ? 'Asistencia: Ausente. Haz clic para limpiar registro.' : 'Sin registro. Haz clic para marcar Presente.'}
                              >
                                {status === 'present' && <Check className="w-7 h-7" />}
                                {status === 'late' && <Clock className="w-7 h-7" />}
                                {status === 'absent' && <XIcon className="w-7 h-7" />}
                                {!status && <div className="w-2.5 h-2.5 rounded-full bg-neutral-200 group-hover:bg-neutral-300 transition-colors" />}
                              </button>
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-10 py-6 text-center border-l border-neutral-50">
                        <div className={cn(
                          "text-xs font-black px-4 py-2 rounded-full inline-block border shadow-sm transition-all group-hover:scale-110",
                          studentPercentage >= 80 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                          studentPercentage >= 60 ? 'bg-amber-50 text-amber-600 border-amber-100' :
                          'bg-red-50 text-red-600 border-red-100'
                        )}>
                          {studentPercentage}%
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      <div className="flex flex-wrap items-center gap-10 text-[10px] text-neutral-400 uppercase tracking-[0.2em] font-black px-8">
        <div className="flex items-center gap-4">
          <div className="w-5 h-5 rounded-lg bg-emerald-50 border-2 border-emerald-200" /> Presente
        </div>
        <div className="flex items-center gap-4">
          <div className="w-5 h-5 rounded-lg bg-amber-50 border-2 border-amber-200" /> Atraso
        </div>
        <div className="flex items-center gap-4">
          <div className="w-5 h-5 rounded-lg bg-red-50 border-2 border-red-200" /> Ausente
        </div>
        <div className="ml-auto italic opacity-60">Haz clic en los cuadros para cambiar el estado</div>
      </div>

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
                onClick={() => {
                  setWarningModalOpen(false);
                  setPendingAttendance(null);
                }} 
                className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
              >
                Cancelar
              </button>
              <button 
                onClick={async () => {
                  setWarningModalOpen(false);
                  if (pendingAttendance) {
                    await processAttendanceChange(pendingAttendance.studentId, pendingAttendance.dateStr, pendingAttendance.currentStatus);
                    setPendingAttendance(null);
                  }
                }} 
                className="flex-1 bg-amber-600 hover:bg-amber-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-amber-500/20 active:scale-95"
              >
                Registrar de todas formas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
