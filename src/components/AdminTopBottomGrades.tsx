import React, { useMemo } from 'react';
import { Trophy, TrendingDown } from 'lucide-react';
import { calculateStudentGrades } from '../lib/gradeCalculator';
import { settingsFromUserSettings } from '../lib/exportUtils';
import { SubjectChip } from './SubjectChip';
import type { AdminTeacherSummaryResponse } from '../lib/adminApi';

interface AdminTopBottomGradesProps {
  data: AdminTeacherSummaryResponse;
}

export function AdminTopBottomGrades({ data }: AdminTopBottomGradesProps) {
  const settings = useMemo(() => settingsFromUserSettings(data.settings), [data.settings]);

  const ranked = useMemo(() => {
    const rows: {
      student: any;
      subject: any;
      total: number;
      isPassing: boolean;
    }[] = [];

    data.subjects.forEach(sub => {
      (sub.students || []).forEach(student => {
        const studentGrades = (sub.grades || []).filter(g => g.studentId === student.id);
        const grades = calculateStudentGrades(
          student.id,
          studentGrades,
          sub.evaluations || [],
          sub.subjectModules || [],
          settings.useCheckpoint,
          settings.weights,
          settings.gradingScale as any,
          settings.viewMode,
          settings.calculationMode,
        );
        rows.push({
          student,
          subject: sub,
          total: grades.total,
          isPassing: grades.total >= settings.gradingScale.minPassingScore,
        });
      });
    });

    return rows.sort((a, b) => b.total - a.total);
  }, [data.subjects, settings]);

  const top5 = ranked.filter(r => r.total > 0).slice(0, 5);
  const bottom5 = ranked.slice().reverse().filter(r => r.total > 0).slice(0, 5);

  const renderRank = (label: string, icon: React.ReactNode, accent: string, ring: string, rows: typeof top5) => (
    <div className="bg-white border border-neutral-200 rounded-[2rem] overflow-hidden shadow-sm">
      <div className={`flex items-center gap-3 px-6 py-4 border-b border-neutral-100 ${ring}`}>
        <div className={`w-10 h-10 ${accent} rounded-xl flex items-center justify-center`}>{icon}</div>
        <div>
          <p className="text-sm font-black text-neutral-900">{label}</p>
          <p className="text-[10px] uppercase tracking-widest text-neutral-400 font-black">
            De {data.teacher.displayName}
          </p>
        </div>
      </div>
      <div className="divide-y divide-neutral-50">
        {rows.length === 0 && (
          <p className="px-6 py-6 text-sm text-neutral-400 font-medium">Sin datos de calificaciones todavía.</p>
        )}
        {rows.map((r, i) => (
          <div key={`${r.subject.id}-${r.student.id}`} className="flex items-center justify-between gap-3 px-6 py-3.5 hover:bg-neutral-50 transition-colors">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-6 h-6 rounded-lg bg-neutral-100 text-neutral-600 text-xs font-black flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-neutral-800 truncate">
                  {`${r.student.lastName || ''}, ${r.student.firstName || ''}`}
                </p>
                <div className="mt-1">
                  <SubjectChip
                    id={r.subject.id}
                    name={r.subject.name || 'Asignatura'}
                    color={r.subject.color || '#6366f1'}
                  />
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className={`text-lg font-black ${r.isPassing ? 'text-emerald-600' : 'text-red-500'}`}>
                {r.total.toFixed(1)}
              </span>
              <p className="text-[10px] uppercase tracking-widest text-neutral-400 font-black">
                / {settings.gradingScale.maxScore}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {renderRank(
        'Mejores promedios',
        <Trophy className="w-5 h-5 text-amber-500" />,
        'bg-amber-50 border-amber-100',
        'border-amber-100',
        top5,
      )}
      {renderRank(
        'Deben mejorar',
        <TrendingDown className="w-5 h-5 text-red-500" />,
        'bg-red-50 border-red-100',
        'border-red-100',
        bottom5,
      )}
    </div>
  );
}
