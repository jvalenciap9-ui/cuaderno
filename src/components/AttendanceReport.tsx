import { format } from 'date-fns';
import React, { memo, useState, useMemo } from 'react';
import { useCustomCollectionData } from "../lib/firestoreUtils";
import { collection, query, where, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthProvider';
import { 
  CheckCircle2, 
  ChevronDown, 
  CalendarDays, 
  CalendarRange, 
  FolderOpen, 
  Users, 
  User, 
  BarChart3,
  TrendingUp
} from 'lucide-react';
import type { AttendanceDoc } from '../types/firestore';
import { cn } from '../lib/utils';

interface AttendanceReportProps {
  subjectId?: string | 'all';
}

export const AttendanceReport = memo(function AttendanceReport({ subjectId = 'all' }: AttendanceReportProps) {
  const { user } = useAuth();
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | 'all'>(subjectId);
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [reportType, setReportType] = useState<'day' | 'week' | 'module'>('day');

  // Sync with prop
  React.useEffect(() => {
    setSelectedSubjectId(subjectId);
  }, [subjectId]);

  const subjectsQuery = user?.uid ? query(collection(db, 'subjects'), where('userId', '==', user?.uid), limit(500)) : null;
  const [subjects = [], loadingSubjects] = useCustomCollectionData(subjectsQuery);

  const attendanceRef = collection(db, 'attendance');
  const allAttendanceQuery = user?.uid ? (selectedSubjectId === 'all' 
    ? query(attendanceRef, where('userId', '==', user?.uid), limit(500))
    : query(attendanceRef, where('userId', '==', user?.uid), where('subjectId', '==', selectedSubjectId), limit(500))) : null;
  const [attendance = [], loadingAttendance] = useCustomCollectionData(allAttendanceQuery);

  const studentsRef = collection(db, 'students');
  const allStudentsQuery = user?.uid ? (selectedSubjectId === 'all'
    ? query(studentsRef, where('userId', '==', user?.uid), limit(500))
    : query(studentsRef, where('userId', '==', user?.uid), where('subjectId', '==', selectedSubjectId), limit(500))) : null;
  const [students = [], loadingStudents] = useCustomCollectionData(allStudentsQuery);

  const modulesRef = collection(db, 'subjectModules');
  const allModulesQuery = user?.uid ? (selectedSubjectId === 'all'
    ? query(modulesRef, where('userId', '==', user?.uid), limit(500))
    : query(modulesRef, where('userId', '==', user?.uid), where('subjectId', '==', selectedSubjectId), limit(500))) : null;
  const [modules = [], loadingModules] = useCustomCollectionData(allModulesQuery);

  const [selectedModuleId, setSelectedModuleId] = useState<string | 'all'>('all');

  const stats = useMemo(() => {
    const maleStudents = students.filter(s => s.gender === 'M');
    const femaleStudents = students.filter(s => s.gender === 'F');
    const maleIds = new Set(maleStudents.map(s => s.id));
    const femaleIds = new Set(femaleStudents.map(s => s.id));

    const getStatsForSet = (records: AttendanceDoc[]) => {
      const total = records.length;
      const present = records.filter(a => a.status === 'present').length;
      const rate = total ? Math.round((present / total) * 100) : 0;
      
      const maleAttendance = records.filter(a => maleIds.has(a.studentId));
      const malePresent = maleAttendance.filter(a => a.status === 'present').length;
      const maleRate = maleAttendance.length ? Math.round((malePresent / maleAttendance.length) * 100) : 0;

      const femaleAttendance = records.filter(a => femaleIds.has(a.studentId));
      const femalePresent = femaleAttendance.filter(a => femaleIds.has(a.studentId) && a.status === 'present').length;
      const femaleRate = femaleAttendance.length ? Math.round((femalePresent / femaleAttendance.length) * 100) : 0;

      return { 
        rate, 
        total, 
        malePresent, 
        maleTotal: maleAttendance.length, 
        maleRate,
        femalePresent, 
        femaleTotal: femaleAttendance.length,
        femaleRate
      };
    };

    // Daily
    const todayAttendance = attendance.filter(a => a.date === selectedDate);
    const daily = getStatsForSet(todayAttendance);

    // Weekly
    const selectedDateObj = new Date(selectedDate);
    const oneWeekAgo = new Date(selectedDateObj);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const weeklyAttendance = attendance.filter(a => new Date(a.date) >= oneWeekAgo && new Date(a.date) <= selectedDateObj);
    const weekly = getStatsForSet(weeklyAttendance);

    // Module
    const moduleAttendance = selectedModuleId === 'all' 
      ? attendance 
      : attendance.filter(a => a.moduleId === selectedModuleId);
    const moduleStats = getStatsForSet(moduleAttendance);

    return { day: daily, week: weekly, module: moduleStats };
  }, [attendance, students, selectedDate, selectedModuleId]);

  const currentStats = stats[reportType] || { 
    rate: 0, 
    total: 0, 
    malePresent: 0, 
    maleTotal: 0, 
    maleRate: 0, 
    femalePresent: 0, 
    femaleTotal: 0, 
    femaleRate: 0 
  };

  const isLoading = loadingSubjects || loadingAttendance || loadingStudents || loadingModules;

  if (isLoading) {
    return (
      <div className="bg-white border border-neutral-200 rounded-[2rem] overflow-hidden shadow-sm animate-pulse">
        <div className="bg-neutral-50 px-[26px] py-5 border-b border-neutral-100">
          <div className="h-10 bg-neutral-100 rounded-2xl w-48 mb-5" />
          <div className="h-12 bg-neutral-100 rounded-2xl w-full" />
        </div>
        <div className="p-6 space-y-5">
          <div className="h-24 bg-neutral-100 rounded-3xl" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-40 bg-neutral-100 rounded-3xl" />
            <div className="h-40 bg-neutral-100 rounded-3xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-neutral-200 rounded-[2rem] overflow-hidden shadow-sm hover:shadow-xl transition-all duration-500 group/card">
      <div className="bg-neutral-50 px-[26px] py-5 border-b border-neutral-100 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center border border-indigo-100">
              <BarChart3 className="w-5 h-5 text-indigo-600" />
            </div>
            <h4 className="text-[10px] font-black text-neutral-900 uppercase tracking-[0.2em]">Informe de Asistencia</h4>
          </div>
          <div className="relative group min-w-[120px]">
             <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as 'day' | 'week' | 'module')}
              className="w-full appearance-none bg-white border border-neutral-200 rounded-xl px-4 py-2.5 pr-10 text-[10px] font-black uppercase tracking-widest text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all cursor-pointer shadow-sm"
            >
              <option value="day">Día</option>
              <option value="week">Semana</option>
              <option value="module">Módulo</option>
            </select>
            <ChevronDown className="w-4 h-4 text-neutral-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none group-hover:text-indigo-500 transition-colors" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="relative group">
            <select
              value={selectedSubjectId}
              onChange={(e) => {
                setSelectedSubjectId(e.target.value === 'all' ? 'all' : e.target.value);
                setSelectedModuleId('all');
              }}
              className="w-full appearance-none bg-white border border-neutral-200 rounded-2xl px-4 py-2.5 pr-10 text-xs font-bold text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all cursor-pointer shadow-sm"
            >
              <option value="all">Todas las Asignaturas</option>
              {subjects.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-neutral-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none group-hover:text-indigo-500 transition-colors" />
          </div>

          <div className="relative group">
            <select
              value={selectedModuleId}
              onChange={(e) => setSelectedModuleId(e.target.value === 'all' ? 'all' : e.target.value)}
              className="w-full appearance-none bg-white border border-neutral-200 rounded-2xl px-4 py-2.5 pr-10 text-xs font-bold text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={selectedSubjectId === 'all'}
            >
              <option value="all">Todos los Módulos</option>
              {modules.map(m => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-neutral-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none group-hover:text-indigo-500 transition-colors" />
          </div>
        </div>
        
        {reportType === 'day' && (
          <div className="relative">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full bg-white border border-neutral-200 rounded-2xl px-4 py-2.5 text-xs font-bold text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all shadow-sm cursor-pointer"
            />
          </div>
        )}
      </div>

      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between p-5 bg-neutral-50 rounded-3xl border border-neutral-100 relative overflow-hidden group shadow-sm hover:bg-white hover:border-indigo-100 transition-all duration-500">
          <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
            <TrendingUp className="w-16 h-16 text-indigo-600" />
          </div>
          <div className="flex items-center gap-5">
            <div className="bg-indigo-50 p-4 rounded-2xl text-indigo-600 shadow-inner border border-indigo-100/50">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em]">Asistencia Total</p>
              <p className="text-3xl font-black text-neutral-900">{currentStats.rate}%</p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs font-black text-neutral-400 bg-white px-3 py-1 rounded-full border border-neutral-100">{currentStats.total} registros</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-5 bg-neutral-50 rounded-3xl border border-neutral-100 flex flex-col items-center text-center shadow-sm group/stat hover:bg-white hover:border-blue-100 transition-all duration-500">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-inner border border-blue-100/50 group-hover/stat:scale-110 group-hover/stat:rotate-3 transition-all">
              <User className="w-6 h-6" />
            </div>
            <p className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-2">Masculinos</p>
            <p className="text-xl font-black text-neutral-900">{currentStats.malePresent} / {currentStats.maleTotal}</p>
            <div className="mt-2 px-3 py-1 bg-blue-50 rounded-full text-[10px] text-blue-600 font-black border border-blue-100">
              {currentStats.maleRate}%
            </div>
          </div>

          <div className="p-5 bg-neutral-50 rounded-3xl border border-neutral-100 flex flex-col items-center text-center shadow-sm group/stat hover:bg-white hover:border-pink-100 transition-all duration-500">
            <div className="w-12 h-12 bg-pink-50 text-pink-600 rounded-2xl flex items-center justify-center mb-4 shadow-inner border border-pink-100/50 group-hover/stat:scale-110 group-hover/stat:-rotate-3 transition-all">
              <User className="w-6 h-6" />
            </div>
            <p className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-2">Femeninos</p>
            <p className="text-xl font-black text-neutral-900">{currentStats.femalePresent} / {currentStats.femaleTotal}</p>
            <div className="mt-2 px-3 py-1 bg-pink-50 rounded-full text-[10px] text-pink-600 font-black border border-pink-100">
              {currentStats.femaleRate}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
