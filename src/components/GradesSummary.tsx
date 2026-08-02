import React, { memo } from 'react';
import { useCustomCollectionData } from "../lib/firestoreUtils";
import { collection, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthProvider';
import { BarChart3, UserCheck, UserX, Info, Trophy, TrendingDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { SubjectChip } from './SubjectChip';
import { calculateStudentGrades } from '../lib/gradeCalculator';
import { useGradeSettings } from '../contexts/GradeSettingsContext';

interface GradesSummaryProps {
  subjectId?: string;
  onNavigateToSubject?: (id: string) => void;
}

export const GradesSummary = memo(function GradesSummary({ subjectId, onNavigateToSubject }: GradesSummaryProps) {
  const { user } = useAuth();
  
  const subjectsQuery = user?.uid ? query(collection(db, 'subjects'), where('userId', '==', user?.uid), limit(500)) : null;
  const [subjects = []] = useCustomCollectionData(subjectsQuery);
  
  const [selectedSubjectId, setSelectedSubjectId] = React.useState<string | 'all'>(subjectId || 'all');

  // Sync with prop if it changes
  React.useEffect(() => {
    if (subjectId) setSelectedSubjectId(subjectId);
  }, [subjectId]);

  const studentsRef = collection(db, 'students');
  const studentsQuery = user?.uid ? (selectedSubjectId === 'all'
    ? query(studentsRef, where('userId', '==', user?.uid), limit(500))
    : query(studentsRef, where('userId', '==', user?.uid), where('subjectId', '==', selectedSubjectId), limit(500))) : null;
  const [students = []] = useCustomCollectionData(studentsQuery);

  const evaluationsRef = collection(db, 'evaluations');
  const evaluationsQuery = user?.uid ? (selectedSubjectId === 'all'
    ? query(evaluationsRef, where('userId', '==', user?.uid), limit(500))
    : query(evaluationsRef, where('userId', '==', user?.uid), where('subjectId', '==', selectedSubjectId), limit(500))) : null;
  const [evaluations = []] = useCustomCollectionData(evaluationsQuery);

  const gradesRef = collection(db, 'grades');
  const gradesQuery = user?.uid ? (selectedSubjectId === 'all'
    ? query(gradesRef, where('userId', '==', user?.uid), limit(500))
    : query(gradesRef, where('userId', '==', user?.uid), where('subjectId', '==', selectedSubjectId), limit(500))) : null;
  const [allGrades = []] = useCustomCollectionData(gradesQuery);

  const modulesRef = collection(db, 'subjectModules');
  const modulesQuery = user?.uid ? (selectedSubjectId === 'all'
    ? query(modulesRef, where('userId', '==', user?.uid), limit(500))
    : query(modulesRef, where('userId', '==', user?.uid), where('subjectId', '==', selectedSubjectId), limit(500))) : null;
  const [modules = []] = useCustomCollectionData(modulesQuery);

  const { viewMode, calculationMode, weights, gradingScale, useCheckpoint, setViewMode, setCalculationMode } = useGradeSettings();

  const studentGradesList = React.useMemo(() => {
    return students.map(student => {
      const studentGrades = allGrades.filter(g => g.studentId === student.id);

      const grades = calculateStudentGrades(
        student.id,
        studentGrades,
        evaluations,
        modules,
        useCheckpoint,
        weights,
        gradingScale,
        viewMode,
        calculationMode
      );

      return {
        student,
        grades,
        isPassing: grades.total >= gradingScale.minPassingScore,
        subject: subjects.find(s => s.id === student.subjectId)
      };
    }).sort((a, b) => b.grades.total - a.grades.total);
  }, [students, allGrades, evaluations, subjects, weights, useCheckpoint, modules, viewMode, calculationMode, gradingScale]);

  if (students.length === 0 || evaluations.length === 0) return null;

  const isDashboard = !subjectId;
  const passingStudents = isDashboard ? studentGradesList.filter(s => s.isPassing) : [];
  const failingStudents = isDashboard ? studentGradesList.filter(s => !s.isPassing) : [];
  const top5 = passingStudents.slice(0, 5);
  const bottom5 = failingStudents.slice(0, 5);

  return (
    <div className={cn("space-y-8", !subjectId && "mt-0", subjectId && "mt-16 pt-12 border-t border-neutral-200")}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center border border-emerald-100 shadow-sm">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-2xl font-black text-neutral-900">Calificaciones</h3>
            <p className="text-sm text-neutral-500 font-medium">Estado actual de las calificaciones</p>
          </div>
        </div>
      </div>

      <div className="bg-indigo-50 border border-indigo-100 p-6 rounded-[2rem] flex items-start gap-5 shadow-sm">
        <div className="bg-white p-2 rounded-xl border border-indigo-100 shadow-sm shrink-0">
          <Info className="w-5 h-5 text-indigo-500" />
        </div>
        <div className="text-sm text-indigo-900/80 leading-relaxed">
          <p className="font-black text-indigo-900 mb-1 uppercase tracking-widest text-[10px]">Sistema de Calificación</p>
          <p className="font-medium">
            {weights.teorica.name} ({weights.teorica.value}%), 
            {weights.practica.name} ({weights.practica.value}%) y 
            {weights.apreciativa.name} ({weights.apreciativa.value}%)
            {useCheckpoint ? `, y ${weights.checkpoint.name} (${weights.checkpoint.value}%)` : ''}. 
            Mínimo para aprobar: <span className="text-emerald-600 font-black">{gradingScale.minPassingScore} pts</span> (de {gradingScale.maxScore}).
          </p>
        </div>
      </div>

      {!isDashboard && modules.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 bg-white p-4 rounded-3xl border border-neutral-200 shadow-sm">
          <div className="flex items-center gap-2 bg-neutral-100 p-1.5 rounded-2xl w-full sm:w-auto">
            <button
              onClick={() => setViewMode('categories')}
              className={cn(
                "flex-1 sm:flex-none px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                viewMode === 'categories' ? "bg-white text-indigo-600 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
              )}
            >
              Por Tipo (Teoría/Prac)
            </button>
            <button
              onClick={() => setViewMode('modules')}
              className={cn(
                "flex-1 sm:flex-none px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                viewMode === 'modules' ? "bg-white text-indigo-600 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
              )}
            >
              Por Módulos / Períodos
            </button>
          </div>
          
          {viewMode === 'modules' && (
            <div className="flex items-center gap-2 bg-neutral-100 p-1.5 rounded-2xl w-full sm:w-auto ml-auto">
               <button
                onClick={() => setCalculationMode('average')}
                className={cn(
                  "flex-1 sm:flex-none px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  calculationMode === 'average' ? "bg-white text-indigo-600 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
                )}
              >
                Promediar Módulos
              </button>
              <button
                onClick={() => setCalculationMode('sum')}
                className={cn(
                  "flex-1 sm:flex-none px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  calculationMode === 'sum' ? "bg-white text-indigo-600 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
                )}
              >
                Sumar Módulos
              </button>
            </div>
          )}
        </div>
      )}

      {isDashboard ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white border border-neutral-200 rounded-[2.5rem] overflow-hidden shadow-sm hover:shadow-2xl transition-all duration-500 group/card">
            <div className="bg-neutral-50 px-8 py-5 border-b border-neutral-100 flex items-center gap-4">
              <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center border border-amber-100">
                <Trophy className="w-5 h-5 text-amber-500" />
              </div>
              <h4 className="text-[10px] font-black text-neutral-900 uppercase tracking-[0.2em]">Mejores Promedios</h4>
            </div>
            <div className="divide-y divide-neutral-50">
              {top5.map((item, i) => (
                <div key={item.student.id} className="px-8 py-6 flex items-center justify-between hover:bg-neutral-50 transition-all group duration-300">
                  <div className="flex items-center gap-5">
                    <div className="w-10 h-10 rounded-2xl bg-neutral-100 flex items-center justify-center text-xs font-black text-neutral-400 group-hover:bg-amber-100 group-hover:text-amber-600 transition-all duration-300 group-hover:scale-110">{i + 1}</div>
                    <div>
                      <p className="text-lg font-black text-neutral-900 group-hover:text-indigo-600 transition-colors leading-tight">{item.student.lastName}, {item.student.firstName}</p>
                      {item.subject && (
                        <div className="mt-2">
                          <SubjectChip 
                            id={item.subject.id!} 
                            name={item.subject.name} 
                            color={item.subject.color} 
                            onClick={onNavigateToSubject}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-black font-mono text-emerald-600">{item.grades.total.toFixed(1)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {bottom5.length > 0 && (
            <div className="bg-white border border-neutral-200 rounded-[2.5rem] overflow-hidden shadow-sm hover:shadow-2xl transition-all duration-500 group/card">
              <div className="bg-neutral-50 px-8 py-5 border-b border-neutral-100 flex items-center gap-4">
                <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center border border-red-100">
                  <TrendingDown className="w-5 h-5 text-red-500" />
                </div>
                <h4 className="text-[10px] font-black text-neutral-900 uppercase tracking-[0.2em]">Deben Mejorar</h4>
              </div>
              <div className="divide-y divide-neutral-50">
                {bottom5.map((item, i) => (
                  <div key={item.student.id} className="px-8 py-6 flex items-center justify-between hover:bg-neutral-50 transition-all group duration-300">
                    <div className="flex items-center gap-5">
                      <div className="w-10 h-10 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center text-xs font-black group-hover:scale-110 transition-all duration-300">{studentGradesList.length - i}</div>
                      <div>
                        <p className="text-lg font-black text-neutral-900 group-hover:text-red-600 transition-colors leading-tight">{item.student.lastName}, {item.student.firstName}</p>
                        {item.subject && (
                          <div className="mt-2">
                            <SubjectChip 
                              id={item.subject.id!} 
                              name={item.subject.name} 
                              color={item.subject.color} 
                              onClick={onNavigateToSubject}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-black font-mono text-red-600">{item.grades.total.toFixed(1)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-[2.5rem] overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-100">
                <tr>
                  <th className="px-8 py-6 font-black uppercase tracking-[0.2em] text-[10px]">Estudiante</th>
                  
                  {viewMode === 'categories' ? (
                    <>
                      <th className="px-8 py-6 font-black uppercase tracking-[0.2em] text-[10px] text-center">{weights.teorica.name}</th>
                      <th className="px-8 py-6 font-black uppercase tracking-[0.2em] text-[10px] text-center">{weights.practica.name}</th>
                      <th className="px-8 py-6 font-black uppercase tracking-[0.2em] text-[10px] text-center">{weights.apreciativa.name}</th>
                      {useCheckpoint && <th className="px-8 py-6 font-black uppercase tracking-[0.2em] text-[10px] text-center">{weights.checkpoint.name}</th>}
                    </>
                  ) : (
                    modules.map(mod => (
                      <th key={mod.id} className="px-8 py-6 font-black uppercase tracking-[0.2em] text-[10px] text-center">{mod.title}</th>
                    ))
                  )}
                  
                  <th className="px-8 py-6 font-black uppercase tracking-[0.2em] text-[10px] text-center">
                    {viewMode === 'modules' ? (calculationMode === 'sum' ? 'Suma Total' : 'Prom. Final') : 'Nota Final'}
                  </th>
                  <th className="px-8 py-6 font-black uppercase tracking-[0.2em] text-[10px] text-right">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {studentGradesList.map(({ student, grades, isPassing, subject }) => (
                  <tr key={student.id} className="hover:bg-neutral-50 transition-all group duration-300">
                    <td className="px-8 py-6">
                      <p className="text-neutral-900 font-black text-lg group-hover:text-indigo-600 transition-colors leading-tight">{student.lastName}, {student.firstName}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <p className="text-[10px] text-neutral-400 font-mono font-bold tracking-widest">{student.cedula}</p>
                        {isPassing ? (
                          <span className="text-[9px] text-emerald-600 font-black bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 uppercase tracking-widest">Aprobado</span>
                        ) : (
                          <span className="text-[9px] text-red-600 font-black bg-red-50 px-2 py-0.5 rounded border border-red-100 uppercase tracking-widest">Reprobado</span>
                        )}
                        {isDashboard && subject && (
                          <SubjectChip 
                            id={subject.id!} 
                            name={subject.name} 
                            color={subject.color} 
                            onClick={onNavigateToSubject}
                          />
                        )}
                      </div>
                    </td>
                    
                    {viewMode === 'categories' ? (
                      <>
                        <td className="px-8 py-6 text-center text-neutral-500 font-mono font-bold">{grades.teorica.toFixed(1)}</td>
                        <td className="px-8 py-6 text-center text-neutral-500 font-mono font-bold">{grades.practica.toFixed(1)}</td>
                        <td className="px-8 py-6 text-center text-neutral-500 font-mono font-bold">{grades.apreciativa.toFixed(1)}</td>
                        {useCheckpoint && <td className="px-8 py-6 text-center text-neutral-500 font-mono font-bold">{grades.checkpoint?.toFixed(1) || '0.0'}</td>}
                      </>
                    ) : (
                      modules.map(mod => (
                        <td key={mod.id} className="px-8 py-6 text-center text-neutral-500 font-mono font-bold">
                          {grades.byModule[mod.id!]?.toFixed(1) || '0.0'}
                        </td>
                      ))
                    )}
                    
                    <td className="px-8 py-6 text-center">
                      <span className={cn(
                        "text-2xl font-black font-mono",
                        isPassing ? "text-emerald-600" : "text-red-600"
                      )}>
                        {grades.total.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-right">
                      {isPassing ? (
                        <div className="inline-flex items-center gap-2 text-emerald-600 bg-emerald-50 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-100 shadow-sm">
                          <UserCheck className="w-4 h-4" />
                          Aprobado
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-2 text-red-600 bg-red-50 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border border-red-100 shadow-sm">
                          <UserX className="w-4 h-4" />
                          Reprobado
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
});
