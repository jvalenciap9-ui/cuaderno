import React, { useMemo } from 'react';
import { Trophy, TrendingDown } from 'lucide-react';
import { SubjectChip } from './SubjectChip';
import type { AdminTeacherSummaryResponse } from '../lib/adminApi';

interface AdminAttendanceRankingProps {
  data: AdminTeacherSummaryResponse;
}

export function AdminAttendanceRanking({ data }: AdminAttendanceRankingProps) {
  const ranked = useMemo(() => {
    const byStudent = new Map<string, { student: any; subject: any; pct: number; hasAttendance: true }>();

    data.subjects.forEach(sub => {
      (sub.students || []).forEach(student => {
        const recs = (sub.attendance || []).filter((a: any) => a.studentId === student.id);
        if (recs.length === 0) return;
        const attended = recs.filter((a: any) => a.status === 'present' || a.status === 'late').length;
        const pct = Math.round((attended / recs.length) * 100);
        const existing = byStudent.get(student.id);
        if (!existing || pct > existing.pct) {
          byStudent.set(student.id, { student, subject: sub, pct, hasAttendance: true });
        }
      });
    });

    return Array.from(byStudent.values()).sort((a, b) => b.pct - a.pct);
  }, [data.subjects]);

  const top5 = ranked.slice(0, 5);
  const bottom5 = ranked.slice().reverse().filter(r => r.pct >= 0).slice(0, 5);

  const pctColor = (pct: number) => {
    if (pct >= 80) return 'text-emerald-600';
    if (pct >= 70) return 'text-amber-600';
    return 'text-red-500';
  };

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
          <p className="px-6 py-6 text-sm text-neutral-400 font-medium">Sin registros de asistencia todavía.</p>
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
              <span className={`text-lg font-black ${pctColor(r.pct)}`}>
                {r.pct}%
              </span>
              <p className="text-[10px] uppercase tracking-widest text-neutral-400 font-black">
                / 100%
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
        'Mejor asistencia',
        <Trophy className="w-5 h-5 text-amber-500" />,
        'bg-amber-50 border-amber-100',
        'border-amber-100',
        top5,
      )}
      {renderRank(
        'Deben mejorar asistencia',
        <TrendingDown className="w-5 h-5 text-red-500" />,
        'bg-red-50 border-red-100',
        'border-red-100',
        bottom5,
      )}
    </div>
  );
}
