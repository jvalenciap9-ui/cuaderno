import { memo, useMemo } from 'react';
import { useCustomCollectionData } from "../lib/firestoreUtils";
import { collection, query, where, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthProvider';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { safeJSONParse } from '../lib/utils';
import { STORAGE_KEYS, getStorageItem } from '../lib/storageKeys';
import { parseWeights, calculateStudentGrades } from '../lib/gradeCalculator';
import { useGradeSettings } from '../contexts/GradeSettingsContext';

export const ProgressWidget = memo(function ProgressWidget() {
  const { user } = useAuth();
  const { viewMode, calculationMode } = useGradeSettings();
  
  const subjectsQuery = user?.uid ? query(collection(db, 'subjects'), where('userId', '==', user?.uid), limit(500)) : null;
  const [subjects = []] = useCustomCollectionData(subjectsQuery);

  const studentsQuery = user?.uid ? query(collection(db, 'students'), where('userId', '==', user?.uid), limit(500)) : null;
  const [students = []] = useCustomCollectionData(studentsQuery);

  const evalsQuery = user?.uid ? query(collection(db, 'evaluations'), where('userId', '==', user?.uid), limit(500)) : null;
  const [evaluations = []] = useCustomCollectionData(evalsQuery);

  const gradesQuery = user?.uid ? query(collection(db, 'grades'), where('userId', '==', user?.uid), limit(500)) : null;
  const [allGrades = []] = useCustomCollectionData(gradesQuery);

  const modulesQuery = user?.uid ? query(collection(db, 'subjectModules'), where('userId', '==', user?.uid), limit(500)) : null;
  const [allModules = []] = useCustomCollectionData(modulesQuery);

  const data = useMemo(() => {
    if (!subjects.length) return [];

    const weights = parseWeights(getStorageItem(STORAGE_KEYS.GRADING_WEIGHTS));
    const useCheckpoint = safeJSONParse(getStorageItem(STORAGE_KEYS.USE_CHECKPOINT), false);

    const savedScale = getStorageItem(STORAGE_KEYS.GRADING_SCALE);
    const gradingScale = safeJSONParse(savedScale, { maxScore: 100, minPassingScore: 71 });

    return subjects.map(subject => {
      const subjectStudents = students.filter(s => s.subjectId === subject.id);
      const subjectEvals = evaluations.filter(e => e.subjectId === subject.id);
      const subjectGrades = allGrades.filter(g => g.subjectId === subject.id);
      const subjectModules = allModules.filter(m => m.subjectId === subject.id);

      if (subjectStudents.length === 0 || subjectEvals.length === 0) {
        return {
          name: subject.name,
          color: subject.color,
          average: 0,
          fill: '#e5e5e5' // neutral color for empty
        };
      }

      let totalSubjectScore = 0;

      subjectStudents.forEach(student => {
        const studentGrades = subjectGrades.filter(g => g.studentId === student.id);
        const grades = calculateStudentGrades(
          student.id,
          studentGrades,
          subjectEvals,
          subjectModules,
          useCheckpoint,
          weights,
          gradingScale,
          viewMode,
          calculationMode
        );
        totalSubjectScore += grades.total;
      });

      const average = totalSubjectScore / subjectStudents.length;

      // Extract hex color from tailwind class
      const colorMap: Record<string, string> = {
        'red': '#ef4444',
        'orange': '#f97316',
        'amber': '#f59e0b',
        'green': '#22c55e',
        'emerald': '#10b981',
        'teal': '#14b8a6',
        'cyan': '#06b6d4',
        'blue': '#3b82f6',
        'indigo': '#6366f1',
        'violet': '#8b5cf6',
        'purple': '#a855f7',
        'fuchsia': '#d946ef',
        'pink': '#ec4899',
        'rose': '#f43f5e',
      };

      let fill = '#6366f1'; // default indigo
      for (const [key, hex] of Object.entries(colorMap)) {
        if (subject.color.includes(key)) {
          fill = hex;
          break;
        }
      }

      return {
        name: subject.name,
        average: Math.round(average * 10) / 10,
        fill,
        maxScore: gradingScale.maxScore
      };
    });
  }, [subjects, students, evaluations, allGrades, allModules, viewMode, calculationMode]);

  if (data.length === 0) return null;

  const CustomTooltip = ({ active, payload, label }: { active?: unknown; payload?: Array<{ value?: number; payload?: { maxScore?: number } }>; label?: unknown }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-neutral-900 text-white p-4 rounded-2xl shadow-xl border border-neutral-800">
          <p className="font-black text-sm mb-1">{String(label)}</p>
          <p className="text-emerald-400 font-bold text-lg">
            Promedio: {payload[0].value} <span className="text-neutral-400 text-xs font-medium">/ {payload[0].payload?.maxScore}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white border border-neutral-200 p-8 rounded-[2.5rem] shadow-sm hover:shadow-xl transition-all duration-500">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center border border-emerald-100">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-black text-neutral-900 tracking-tight">Progreso General</h3>
            <p className="text-sm text-neutral-500 font-medium mt-1">Media de calificaciones por asignatura</p>
          </div>
        </div>
      </div>

      <div className="w-full mt-4" style={{ height: '300px', minWidth: 0 }}>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f5" />
            <XAxis 
              dataKey="name" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: '#a3a3a3', fontSize: 12, fontWeight: 600 }}
              dy={10}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: '#a3a3a3', fontSize: 12, fontWeight: 600 }}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f5f5f5', radius: 8 }} />
            <Bar 
              dataKey="average" 
              radius={[6, 6, 6, 6]}
              barSize={40}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
