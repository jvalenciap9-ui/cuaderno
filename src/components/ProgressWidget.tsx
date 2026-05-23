import React, { memo, useMemo } from 'react';
import { useCustomCollectionData } from "../lib/firestoreUtils";
import { collection, query, where, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthProvider';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { safeJSONParse } from '../lib/utils';
import { STORAGE_KEYS, getStorageItem } from '../lib/storageKeys';

export const ProgressWidget = memo(function ProgressWidget() {
  const { user } = useAuth();
  
  const subjectsQuery = user?.uid ? query(collection(db, 'subjects'), where('userId', '==', user?.uid), limit(500)) : null;
  const [subjects = []] = useCustomCollectionData(subjectsQuery);

  const studentsQuery = user?.uid ? query(collection(db, 'students'), where('userId', '==', user?.uid), limit(500)) : null;
  const [students = []] = useCustomCollectionData(studentsQuery);

  const evalsQuery = user?.uid ? query(collection(db, 'evaluations'), where('userId', '==', user?.uid), limit(500)) : null;
  const [evaluations = []] = useCustomCollectionData(evalsQuery);

  const gradesQuery = user?.uid ? query(collection(db, 'grades'), where('userId', '==', user?.uid), limit(500)) : null;
  const [allGrades = []] = useCustomCollectionData(gradesQuery);

  const data = useMemo(() => {
    if (!subjects.length) return [];

    const parseWeights = (data: string | null) => {
      const defaultWeights = { 
        teorica: { name: 'Teórica', value: 30 }, 
        practica: { name: 'Práctica', value: 60 }, 
        apreciativa: { name: 'Apreciativa', value: 10 },
        checkpoint: { name: 'Agregar 4ta Nota', value: 0 }
      };
      if (!data) return defaultWeights;
      try {
        const parsed = safeJSONParse<Record<string, unknown> | null>(data, null);
        if (!parsed) return defaultWeights;
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

    const weights = parseWeights(getStorageItem(STORAGE_KEYS.GRADING_WEIGHTS));
    const useCheckpoint = safeJSONParse(getStorageItem(STORAGE_KEYS.USE_CHECKPOINT), false);

    const savedScale = getStorageItem(STORAGE_KEYS.GRADING_SCALE);
    const gradingScale = safeJSONParse(savedScale, { maxScore: 100, minPassingScore: 71 });

    return subjects.map(subject => {
      const subjectStudents = students.filter(s => s.subjectId === subject.id);
      const subjectEvals = evaluations.filter(e => e.subjectId === subject.id);
      const subjectGrades = allGrades.filter(g => g.subjectId === subject.id);

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
        
        const categories: { id: string; weight: number }[] = [
          { id: 'teorica', weight: weights.teorica.value },
          { id: 'practica', weight: weights.practica.value },
          { id: 'apreciativa', weight: weights.apreciativa.value }
        ];

        if (useCheckpoint) {
          categories.push({ id: 'checkpoint', weight: weights.checkpoint.value });
        }

        let weightedSumTotal = 0;
        let totalWeightUsed = 0;

        categories.forEach(cat => {
          const typeEvals = subjectEvals.filter(e => e.type === cat.id);
          if (typeEvals.length > 0) {
            totalWeightUsed += cat.weight;
            let sumPct = 0;
            typeEvals.forEach(ev => {
              const grade = studentGrades.find(g => g.evaluationId === ev.id);
              const score = grade?.score || 0;
              const max = ev.maxScore || 100;
              sumPct += (score / max);
            });
            const avg = sumPct / typeEvals.length;
            weightedSumTotal += avg * cat.weight;
          }
        });

        const finalGrade = totalWeightUsed > 0 ? (weightedSumTotal / totalWeightUsed) * (gradingScale.maxScore || 100) : 0;
        
        totalSubjectScore += finalGrade;
      });

      const average = Math.round((totalSubjectScore / subjectStudents.length) * 10) / 10;

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
  }, [subjects, students, evaluations, allGrades]);

  if (data.length === 0) return null;

  const CustomTooltip = ({ active, payload, label }: { active?: unknown; payload?: Array<{ value?: number; payload?: { maxScore?: number } }>; label?: unknown }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-neutral-900 text-white p-4 rounded-2xl shadow-xl border border-neutral-800">
          <p className="font-black text-sm mb-1">{label}</p>
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

      <div className="h-[300px] w-full mt-4">
        <ResponsiveContainer width="100%" height="100%">
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
