import React, { memo, useState } from 'react';
import { useCustomCollectionData } from "../lib/firestoreUtils";
import { collection, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthProvider';
import { 
  BookOpen, 
  CheckCircle2, 
  GraduationCap, 
  Clock, 
  Users, 
  ClipboardList, 
  FileText,
  PlusCircle,
  UserPlus,
  CheckSquare,
  ChevronRight,
  CalendarDays,
  CalendarRange,
  Settings
} from 'lucide-react';

import type { SubjectDoc, NoteDoc, EvaluationDoc } from '../types/firestore';
const CalendarSection = React.lazy(() => import('./CalendarSection').then(module => ({ default: module.CalendarSection })));
import { GradesSummary } from './GradesSummary';
import { AttendanceReport } from './AttendanceReport';
import { SubjectChip } from './SubjectChip';
const ProgressWidget = React.lazy(() => import('./ProgressWidget').then(module => ({ default: module.ProgressWidget })));

interface ActivityItem {
  id: string | number;
  type: 'subject' | 'note' | 'student' | 'evaluation' | 'attendance';
  title: string;
  subtitle: string;
  date: number | string;
  moduleName: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  subjectId?: string;
  subject?: SubjectDoc;
}

interface DashboardProps {
  onNavigateToSubject: (id: string, tab?: string) => void;
  onNewSubject: () => void;
  onOpenSettings?: () => void;
}

export const Dashboard = memo(function Dashboard({ onNavigateToSubject, onNewSubject, onOpenSettings }: DashboardProps) {
  const { user } = useAuth();
  const [selectedGlobalSubjectId, setSelectedGlobalSubjectId] = useState<string | 'all'>('all');
  
  const subjectsRef = collection(db, 'subjects');
  const subjectsQuery = user?.uid ? query(subjectsRef, where('userId', '==', user?.uid), limit(500)) : null;
  const [subjects = [], loadingSubjects] = useCustomCollectionData(subjectsQuery);

  const notesRef = collection(db, 'notes');
  const notesQuery = user?.uid ? (selectedGlobalSubjectId === 'all' 
    ? query(notesRef, where('userId', '==', user?.uid), limit(500))
    : query(notesRef, where('userId', '==', user?.uid), where('subjectId', '==', selectedGlobalSubjectId), limit(500))) : null;
  const [notes = [], loadingNotes] = useCustomCollectionData(notesQuery);

  const studentsRef = collection(db, 'students');
  const studentsQuery = user?.uid ? (selectedGlobalSubjectId === 'all'
    ? query(studentsRef, where('userId', '==', user?.uid), limit(500))
    : query(studentsRef, where('userId', '==', user?.uid), where('subjectId', '==', selectedGlobalSubjectId), limit(500))) : null;
  const [students = [], loadingStudents] = useCustomCollectionData(studentsQuery);

  const evaluationsRef = collection(db, 'evaluations');
  const evaluationsQuery = user?.uid ? (selectedGlobalSubjectId === 'all'
    ? query(evaluationsRef, where('userId', '==', user?.uid), limit(500))
    : query(evaluationsRef, where('userId', '==', user?.uid), where('subjectId', '==', selectedGlobalSubjectId), limit(500))) : null;
  const [evaluations = [], loadingEvals] = useCustomCollectionData(evaluationsQuery);

  const attendancesRef = collection(db, 'attendance');
  const attendancesQuery = user?.uid ? (selectedGlobalSubjectId === 'all'
    ? query(attendancesRef, where('userId', '==', user?.uid), limit(500))
    : query(attendancesRef, where('userId', '==', user?.uid), where('subjectId', '==', selectedGlobalSubjectId), limit(500))) : null;
  const [attendances = [], loadingAttds] = useCustomCollectionData(attendancesQuery);

  const isLoading = loadingSubjects || loadingNotes || loadingStudents || loadingEvals || loadingAttds;

  if (isLoading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-neutral-100 rounded-2xl animate-pulse" />
            <div>
              <div className="h-6 bg-neutral-100 rounded w-48 animate-pulse mb-2" />
              <div className="h-4 bg-neutral-100 rounded w-64 animate-pulse" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white p-6 rounded-[2rem] border border-neutral-100 shadow-sm h-32 animate-pulse">
              <div className="w-10 h-10 bg-neutral-100 rounded-xl mb-4" />
              <div className="h-6 bg-neutral-100 rounded w-24 mb-2" />
              <div className="h-4 bg-neutral-100 rounded w-32" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-12">
           <div className="h-96 bg-white rounded-[3rem] border border-neutral-100 animate-pulse" />
           <div className="h-96 bg-white rounded-[3rem] border border-neutral-100 animate-pulse" />
        </div>
      </div>
    );
  }
  
  // Calculate stats
  const totalSubjects = selectedGlobalSubjectId === 'all' ? subjects.length : 1;
  const totalEvaluations = evaluations.length;

  // Build activity feed
  const activities: ActivityItem[] = [
    ...(selectedGlobalSubjectId === 'all' ? subjects.slice(-3) : subjects.filter((s: SubjectDoc) => s.id === selectedGlobalSubjectId)).map((s: SubjectDoc) => ({
      id: `sub-${s.id}`,
      type: 'subject' as const,
      title: s.name,
      subtitle: `Asignatura gestionada por ${s.teacher}`,
      date: Date.now(),
      moduleName: 'Asignaturas',
      icon: BookOpen,
      color: 'text-indigo-400',
      subjectId: s.id,
      subject: s
    })),
    ...notes.slice(-5).map((n: NoteDoc) => ({
      id: `note-${n.id}`,
      type: 'note' as const,
      title: n.title,
      subtitle: `Apunte`,
      date: n.createdAt,
      moduleName: 'Apuntes',
      icon: FileText,
      color: 'text-amber-400',
      subjectId: n.subjectId,
      subject: subjects.find((s: SubjectDoc) => s.id === n.subjectId)
    })),
    ...evaluations.slice(-3).map((e: EvaluationDoc) => ({
      id: `eval-${e.id}`,
      type: 'evaluation' as const,
      title: e.title,
      subtitle: `Evaluación programada para el ${e.date}`,
      date: Date.now() - 2000,
      moduleName: 'Calificaciones',
      icon: ClipboardList,
      color: 'text-purple-400',
      subjectId: e.subjectId,
      subject: subjects.find((s: SubjectDoc) => s.id === e.subjectId)
    }))
  ].sort((a, b) => {
    const dateA = typeof a.date === 'number' ? a.date : 0;
    const dateB = typeof b.date === 'number' ? b.date : 0;
    return dateB - dateA;
  });

  const modules = [
    { name: 'Asignaturas', icon: BookOpen, color: 'text-indigo-400', tab: 'modules' },
    { name: 'Calificaciones', icon: ClipboardList, color: 'text-purple-400', tab: 'grades' },
    { name: 'Apuntes', icon: FileText, color: 'text-amber-400', tab: 'notes' }
  ];

  return (
    <div 
      className="p-8 md:p-12 max-w-7xl mx-auto w-full space-y-12"
      style={{ marginLeft: '40.6px', marginRight: '112px', marginBottom: '0px', marginTop: '-16px', paddingBottom: '48px' }}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4">
            <img src="/logo.png" alt="Logo" className="w-[90px] h-[90px] object-contain bg-white rounded-xl shadow-sm p-1" onError={(e) => {
              e.currentTarget.style.display = 'none';
            }} />
            <div>
              <h2 className="text-4xl font-black text-neutral-900 tracking-tight">Dashboard</h2>
              <p className="text-neutral-500 mt-2 font-medium">Resumen de actividad de todas tus asignaciones</p>
            </div>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          <div className="relative group min-w-[240px]">
            <select
              aria-label="Seleccionar asignatura"
              value={selectedGlobalSubjectId}
              onChange={(e) => setSelectedGlobalSubjectId(e.target.value === 'all' ? 'all' : e.target.value)}
              className="w-full appearance-none bg-white border border-neutral-200 rounded-2xl px-5 py-3 pr-12 text-xs font-black text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all cursor-pointer shadow-sm uppercase tracking-widest"
            >
              <option value="all">Todas las Asignaturas</option>
              {subjects.map((s: SubjectDoc) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400 group-hover:text-indigo-500 transition-colors">
              <ChevronRight className="w-5 h-5 rotate-90" />
            </div>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="bg-white border border-neutral-200 p-8 rounded-[2.5rem] shadow-sm hover:shadow-2xl hover:-translate-y-1 transition-all duration-500 group">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-[1.5rem] flex items-center justify-center border border-indigo-100 group-hover:scale-110 transition-transform duration-500">
              <BookOpen className="w-8 h-8" />
            </div>
            <div>
              <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">Asignaturas</p>
              <p className="text-4xl font-black text-neutral-900 leading-none mt-1">{totalSubjects}</p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-neutral-200 p-8 rounded-[2.5rem] shadow-sm hover:shadow-2xl hover:-translate-y-1 transition-all duration-500 group">
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 bg-purple-50 text-purple-600 rounded-[1.5rem] flex items-center justify-center border border-purple-100 group-hover:scale-110 transition-transform duration-500">
              <ClipboardList className="w-8 h-8" />
            </div>
            <div>
              <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">Evaluaciones</p>
              <p className="text-4xl font-black text-neutral-900 leading-none mt-1">{totalEvaluations}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full">
        <CalendarSection subjectId={selectedGlobalSubjectId} />
      </div>

      {selectedGlobalSubjectId === 'all' && (
        <div className="w-full">
          <ProgressWidget />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="lg:col-span-2 space-y-10">
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-black text-neutral-900 flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center border border-indigo-100">
                <Clock className="w-5 h-5 text-indigo-600" />
              </div>
              Actividad Reciente
            </h3>
          </div>
          
          <div className="space-y-8">
            {modules.map(module => {
              const moduleActivities = activities.filter(a => a.moduleName === module.name);
              if (moduleActivities.length === 0) return null;

              return (
                <div key={module.name} className="bg-white border border-neutral-200 rounded-[2.5rem] overflow-hidden shadow-sm hover:shadow-xl transition-all duration-500">
                  <div className="bg-neutral-50 px-8 py-4 border-b border-neutral-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <module.icon className={`w-5 h-5 ${module.color.replace('400', '600')}`} />
                      <span className="text-[10px] font-black text-neutral-500 uppercase tracking-[0.2em]">{module.name}</span>
                    </div>
                    <span className="text-[10px] font-black bg-white text-neutral-400 px-3 py-1 rounded-full border border-neutral-100">Últimos movimientos</span>
                  </div>
                  <div className="divide-y divide-neutral-50">
                    {moduleActivities.map((activity: ActivityItem) => (
                      <div 
                        key={activity.id} 
                        onClick={() => activity.subjectId && onNavigateToSubject(activity.subjectId, module.tab)}
                        className="px-8 py-6 flex items-center gap-6 hover:bg-neutral-50 transition-all cursor-pointer group"
                      >
                        <div className={`w-12 h-12 rounded-2xl bg-white flex items-center justify-center border border-neutral-100 ${activity.color.replace('400', '600')} group-hover:scale-110 group-hover:shadow-lg transition-all duration-300`}>
                          <activity.icon className="w-6 h-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-neutral-900 font-black text-lg truncate group-hover:text-indigo-600 transition-colors leading-tight">{activity.title}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <p className="text-sm text-neutral-500 truncate font-medium">{activity.subtitle}</p>
                            {activity.subject && activity.type !== 'subject' && (
                              <SubjectChip 
                                id={activity.subject.id!} 
                                name={activity.subject.name} 
                                color={activity.subject.color} 
                              />
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-[10px] text-neutral-400 font-black uppercase tracking-widest hidden sm:block bg-neutral-50 px-3 py-1 rounded-full border border-neutral-100">
                            {typeof activity.date === 'number' ? new Date(activity.date).toLocaleDateString() : activity.date}
                          </div>
                          <ChevronRight className="w-5 h-5 text-neutral-300 group-hover:text-indigo-600 group-hover:translate-x-2 transition-all duration-300" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            
            {activities.length === 0 && (
              <div className="p-24 text-center text-neutral-400 bg-white border border-neutral-200 rounded-[3rem] shadow-sm">
                <div className="w-24 h-24 bg-neutral-50 rounded-[2rem] flex items-center justify-center mx-auto mb-8 border border-neutral-100">
                  <Clock className="w-12 h-12 text-neutral-200" />
                </div>
                <p className="text-2xl font-black text-neutral-900">No hay actividad registrada</p>
                <p className="text-sm text-neutral-500 mt-3 font-medium max-w-xs mx-auto">Tus acciones recientes aparecerán aquí organizadas por módulo.</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-10">
          <h3 className="text-2xl font-black text-neutral-900 flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center border border-emerald-100">
              <ClipboardList className="w-5 h-5 text-emerald-600" />
            </div>
            Reportes
          </h3>
          <div className="grid grid-cols-1 gap-8">
            <AttendanceReport subjectId={selectedGlobalSubjectId} />
          </div>
        </div>
      </div>

      <GradesSummary 
        subjectId={selectedGlobalSubjectId === 'all' ? undefined : selectedGlobalSubjectId} 
        onNavigateToSubject={onNavigateToSubject}
      />
    </div>
  );
});
