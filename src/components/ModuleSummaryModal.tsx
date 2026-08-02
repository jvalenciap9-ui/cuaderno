import React, { useMemo, useState, useEffect } from 'react';
import { X, BookOpen, Users, CheckCircle, XCircle, BarChart3, Clock } from 'lucide-react';
import { collection, query, where, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthProvider';
import { useCustomCollectionData } from '../lib/firestoreUtils';
import { cn, parseLocalDate, safeJSONParse } from '../lib/utils';
import { getStorageItem, STORAGE_KEYS } from '../lib/storageKeys';
import { parseWeights, calculateWeightedAverage, calculateStudentGrades } from '../lib/gradeCalculator';
import { useGradeSettings } from '../contexts/GradeSettingsContext';

interface ModuleSummaryModalProps {
  subjectId: string;
  onClose: () => void;
}

export function ModuleSummaryModal({ subjectId, onClose }: ModuleSummaryModalProps) {
  const { user } = useAuth();
  
  const modulesQuery = user?.uid ? query(collection(db, 'subjectModules'), where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500)) : null;
  const [modules = [], loadingModules] = useCustomCollectionData(modulesQuery);
  
  const evalsQuery = user?.uid ? query(collection(db, 'evaluations'), where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500)) : null;
  const [evaluations = [], loadingEvals] = useCustomCollectionData(evalsQuery);
  
  const gradesQuery = user?.uid ? query(collection(db, 'grades'), where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500)) : null;
  const [allGrades = [], loadingGrades] = useCustomCollectionData(gradesQuery);
  
  const studentsQuery = user?.uid ? query(collection(db, 'students'), where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500)) : null;
  const [students = [], loadingStudents] = useCustomCollectionData(studentsQuery);

  const attendanceQuery = user?.uid ? query(collection(db, 'attendance'), where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500)) : null;
  const [allAttendance = [], loadingAttendance] = useCustomCollectionData(attendanceQuery);

  const isLoading = loadingModules || loadingEvals || loadingGrades || loadingStudents || loadingAttendance;

  const { viewMode, calculationMode } = useGradeSettings();

  const [weights, setWeights] = useState(() => parseWeights(getStorageItem(STORAGE_KEYS.GRADING_WEIGHTS)));
  const [useCheckpoint, setUseCheckpoint] = useState(() => safeJSONParse(getStorageItem(STORAGE_KEYS.USE_CHECKPOINT), false));
  const [gradingScale, setGradingScale] = useState(() => safeJSONParse(getStorageItem(STORAGE_KEYS.GRADING_SCALE), { maxScore: 100, minPassingScore: 71 }));

  useEffect(() => {
    const handleStorage = () => {
      setWeights(parseWeights(getStorageItem(STORAGE_KEYS.GRADING_WEIGHTS)));
      setUseCheckpoint(safeJSONParse(getStorageItem(STORAGE_KEYS.USE_CHECKPOINT), false));
      setGradingScale(safeJSONParse(getStorageItem(STORAGE_KEYS.GRADING_SCALE), { maxScore: 100, minPassingScore: 71 }));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const summaryData = useMemo(() => {
    if (isLoading || modules.length === 0 || students.length === 0) return [];

    const sortedModules = [...modules].sort((a, b) => (a.order || 0) - (b.order || 0));

    return sortedModules.map(mod => {
      // 1. Evaluations for this module
      const modEvals = evaluations.filter(e => e.moduleId === mod.id);
      
      // 2. Attendance for this module
      let modAttendance = [...allAttendance];
      const startTimestamp = mod.startDate ? parseLocalDate(mod.startDate).getTime() : null;
      let endTimestamp = mod.endDate ? parseLocalDate(mod.endDate).getTime() : null;
      if (endTimestamp) endTimestamp += 86400000 - 1;

      if (startTimestamp && endTimestamp) {
        modAttendance = allAttendance.filter(a => {
          const aTime = parseLocalDate(a.date).getTime();
          return aTime >= startTimestamp && aTime <= endTimestamp;
        });
      }

      // Calculate attendance %
      let totalAttRecords = 0;
      let totalPresentsLates = 0;
      modAttendance.forEach(a => {
        totalAttRecords++;
        if (a.status === 'present') totalPresentsLates += 1;
        if (a.status === 'late') totalPresentsLates += 1; 
      });
      const attendedCount = modAttendance.filter(a => a.status === 'present' || a.status === 'late').length;
      
      // Since attendance is per student, we need to average across students or calculate globally
      // The requirement says "Asistencia %", usually this means the group average.
      // Above logic is just checking total attended records across all students
      const attPercentage = modAttendance.length > 0 ? (attendedCount / modAttendance.length) * 100 : 0;

      // 3. Calculate grades per student for this module
      let groupTotalGrade = 0;
      let approvedCount = 0;
      let failedCount = 0;

      students.forEach(student => {
        const studentGrades = allGrades.filter(g => g.studentId === student.id);
        const studentFinal = calculateWeightedAverage(studentGrades, modEvals, weights, gradingScale, useCheckpoint);
        groupTotalGrade += studentFinal;
        if (studentFinal >= gradingScale.minPassingScore) {
          approvedCount++;
        } else {
          failedCount++;
        }
      });

      const avgGroupGrade = students.length > 0 ? groupTotalGrade / students.length : 0;

      return {
        id: mod.id,
        title: mod.title,
        order: mod.order,
        startDate: mod.startDate,
        endDate: mod.endDate,
        evalCount: modEvals.length,
        avgGrade: avgGroupGrade,
        attPercentage,
        approvedCount,
        failedCount
      };
    });
  }, [modules, evaluations, allGrades, students, allAttendance, weights, useCheckpoint, gradingScale, isLoading]);

  const totals = useMemo(() => {
    if (summaryData.length === 0 || students.length === 0) return null;
    let totalEvals = 0;
    summaryData.forEach(d => {
      totalEvals += d.evalCount;
    });

    let groupFinalGradesSum = 0;
    students.forEach(student => {
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
      groupFinalGradesSum += grades.total;
    });
    const avgGrade = groupFinalGradesSum / students.length;

    let sumAtt = 0;
    summaryData.forEach(d => {
      sumAtt += d.attPercentage;
    });

    return {
      avgGrade,
      attPercentage: sumAtt / summaryData.length,
      approvedCount: Math.round(summaryData.reduce((acc, d) => acc + d.approvedCount, 0) / summaryData.length),
      failedCount: Math.round(summaryData.reduce((acc, d) => acc + d.failedCount, 0) / summaryData.length),
      evalCount: totalEvals
    };
  }, [summaryData, students, allGrades, evaluations, modules, useCheckpoint, weights, gradingScale, viewMode, calculationMode]);

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-md">
        <div className="bg-white border border-neutral-200 p-10 rounded-[2.5rem] shadow-2xl animate-pulse flex flex-col items-center">
           <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
           <p className="text-neutral-500 font-bold">Cargando resumen...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-md p-4 sm:p-6">
      <div className="bg-white border border-neutral-200 rounded-[2.5rem] shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-300 overflow-hidden">
        
        {/* Header */}
        <div className="px-8 py-6 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center border border-indigo-100 shadow-sm">
              <BarChart3 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-2xl font-black text-neutral-900 tracking-tight">Resumen Modular</h3>
              <p className="text-sm text-neutral-500 font-medium">Asistencia y calificaciones consolidadas por módulo</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-3 text-neutral-400 hover:text-neutral-900 hover:bg-white rounded-2xl transition-all border border-transparent hover:border-neutral-200 hover:shadow-sm"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-8 overflow-y-auto custom-scrollbar">
          <div className="bg-white border border-neutral-200 rounded-[2rem] overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-neutral-50 text-neutral-500 border-b border-neutral-100">
                  <tr>
                    <th className="px-6 py-5 font-black uppercase tracking-[0.2em] text-[10px]">Módulo / Período</th>
                    <th className="px-6 py-5 font-black uppercase tracking-[0.2em] text-[10px] text-center">Evaluaciones</th>
                    <th className="px-6 py-5 font-black uppercase tracking-[0.2em] text-[10px] text-center">Promedio Grupo</th>
                    <th className="px-6 py-5 font-black uppercase tracking-[0.2em] text-[10px] text-center">Asistencia %</th>
                    <th className="px-6 py-5 font-black uppercase tracking-[0.2em] text-[10px] text-center">Aprobados</th>
                    <th className="px-6 py-5 font-black uppercase tracking-[0.2em] text-[10px] text-center">Reprobados</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50">
                  {summaryData.map(d => (
                    <tr key={d.id} className="hover:bg-neutral-50 transition-colors group">
                      <td className="px-6 py-5">
                        <p className="font-black text-neutral-900 text-base">{d.order}: {d.title}</p>
                        <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mt-1">
                          {d.startDate ? parseLocalDate(d.startDate).toLocaleDateString() : 'N/A'} - {d.endDate ? parseLocalDate(d.endDate).toLocaleDateString() : 'N/A'}
                        </p>
                      </td>
                      <td className="px-6 py-5 text-center">
                        <span className="inline-flex items-center gap-1.5 bg-neutral-100 text-neutral-600 px-3 py-1.5 rounded-lg text-xs font-black">
                          <BookOpen className="w-3.5 h-3.5" />
                          {d.evalCount}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-center">
                        <span className={cn(
                          "text-xl font-black font-mono",
                          d.avgGrade >= gradingScale.minPassingScore ? "text-emerald-600" : "text-red-600"
                        )}>
                          {d.avgGrade.toFixed(1)}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <span className={cn(
                            "text-lg font-black font-mono",
                            d.attPercentage >= 80 ? "text-emerald-600" : d.attPercentage >= 70 ? "text-amber-600" : "text-red-600"
                          )}>
                            {d.attPercentage.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-center">
                        <span className="inline-flex items-center gap-1.5 text-emerald-600 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-lg text-xs font-black shadow-sm">
                          <CheckCircle className="w-3.5 h-3.5" />
                          {d.approvedCount}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-center">
                        <span className="inline-flex items-center gap-1.5 text-red-600 bg-red-50 border border-red-100 px-3 py-1.5 rounded-lg text-xs font-black shadow-sm">
                          <XCircle className="w-3.5 h-3.5" />
                          {d.failedCount}
                        </span>
                      </td>
                    </tr>
                  ))}
                  
                  {/* Totals Row */}
                  {totals && (
                    <tr className="bg-indigo-50/50 border-t-2 border-indigo-100">
                      <td className="px-6 py-6">
                        <p className="font-black text-indigo-900 text-lg uppercase tracking-wider">Promedio Global</p>
                      </td>
                      <td className="px-6 py-6 text-center text-indigo-700 font-black">{totals.evalCount}</td>
                      <td className="px-6 py-6 text-center">
                        <span className={cn(
                          "text-2xl font-black font-mono",
                          totals.avgGrade >= gradingScale.minPassingScore ? "text-emerald-600" : "text-red-600"
                        )}>
                          {totals.avgGrade.toFixed(1)}
                        </span>
                      </td>
                      <td className="px-6 py-6 text-center">
                         <span className={cn(
                          "text-2xl font-black font-mono",
                          totals.attPercentage >= 80 ? "text-emerald-600" : totals.attPercentage >= 70 ? "text-amber-600" : "text-red-600"
                        )}>
                          {totals.attPercentage.toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-6 py-6 text-center text-indigo-700 font-black text-lg">~{totals.approvedCount}</td>
                      <td className="px-6 py-6 text-center text-indigo-700 font-black text-lg">~{totals.failedCount}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
