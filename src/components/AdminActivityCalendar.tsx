import React, { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Calendar, BookOpen, FileText, X } from 'lucide-react';
import { cn, parseLocalDate } from '../lib/utils';
import type { TeacherSubjectSummary } from '../lib/adminApi';

interface ActivityItem {
  date: string;
  kind: 'evaluation' | 'event' | 'material' | 'note';
  title: string;
  subjectName: string;
  subjectColor: string;
  type?: string;
}

const KIND_META: Record<ActivityItem['kind'], { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  evaluation: {
    label: 'Evaluación',
    icon: <ClipboardList className="w-4 h-4" />,
    color: 'text-purple-600',
    bg: 'bg-purple-50 border-purple-100',
  },
  event: {
    label: 'Evento',
    icon: <Calendar className="w-4 h-4" />,
    color: 'text-blue-600',
    bg: 'bg-blue-50 border-blue-100',
  },
  material: {
    label: 'Material',
    icon: <BookOpen className="w-4 h-4" />,
    color: 'text-amber-600',
    bg: 'bg-amber-50 border-amber-100',
  },
  note: {
    label: 'Apunte',
    icon: <FileText className="w-4 h-4" />,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50 border-emerald-100',
  },
};

interface AdminActivityCalendarProps {
  subjects: TeacherSubjectSummary[];
}

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const DAY_NAMES = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

function toKey(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function AdminActivityCalendar({ subjects }: AdminActivityCalendarProps) {
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(today);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const activitiesByDay = useMemo(() => {
    const map: Record<string, ActivityItem[]> = {};
    subjects.forEach(sub => {
      const subName = sub.name || 'Asignatura';
      const subColor = sub.color || '#6366f1';

      (sub.evaluations || []).forEach(e => {
        if (e.date) {
          const k = toKey(e.date);
          (map[k] = map[k] || []).push({
            date: e.date, kind: 'evaluation', title: e.title || 'Evaluación',
            subjectName: subName, subjectColor: subColor, type: e.type,
          });
        }
      });
      (sub.calendarEvents || []).forEach(e => {
        if (e.date) {
          const k = toKey(e.date);
          (map[k] = map[k] || []).push({
            date: e.date, kind: 'event', title: e.title || 'Evento',
            subjectName: subName, subjectColor: subColor, type: e.type,
          });
        }
      });
      (sub.materials || []).forEach(m => {
        if (m.date) {
          const k = toKey(m.date);
          (map[k] = map[k] || []).push({
            date: m.date, kind: 'material', title: m.title || 'Material',
            subjectName: subName, subjectColor: subColor, type: m.type,
          });
        }
      });
      (sub.notes || []).forEach(n => {
        if (n.date) {
          const k = toKey(n.date);
          (map[k] = map[k] || []).push({
            date: n.date, kind: 'note', title: n.title || 'Apunte',
            subjectName: subName, subjectColor: subColor,
          });
        }
      });
    });
    return map;
  }, [subjects]);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstDay.getDay() + 6) % 7; // lunes = 0

  const prevMonth = () => {
    setViewMonth(new Date(year, month - 1, 1));
    setSelectedDay(null);
  };
  const nextMonth = () => {
    setViewMonth(new Date(year, month + 1, 1));
    setSelectedDay(null);
  };

  const todayKey = toKey(new Date().toISOString());
  const selectedItems = selectedDay ? activitiesByDay[selectedDay] : null;

  const cells: (string | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }

  const selectedLabel = selectedDay ? (() => {
    const d = parseLocalDate(selectedDay);
    return `${d.getDate()} de ${MONTH_NAMES[d.getMonth()]} de ${d.getFullYear()}`;
  })() : null;

  return (
    <div className="bg-white border border-neutral-200 rounded-[2rem] overflow-hidden shadow-sm">
      <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-neutral-100 bg-neutral-50/60">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center border border-indigo-100">
            <CalendarDays className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-lg font-black text-neutral-900">Fechas con actividad</h4>
            <p className="text-xs text-neutral-500 font-medium">Evaluaciones, eventos, materiales y apuntes guardados</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevMonth}
            className="p-2 rounded-xl hover:bg-neutral-200 text-neutral-500 transition-colors"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-black uppercase tracking-widest px-2">
            {MONTH_NAMES[month]} {year}
          </span>
          <button
            type="button"
            onClick={nextMonth}
            className="p-2 rounded-xl hover:bg-neutral-200 text-neutral-500 transition-colors"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="grid grid-cols-7 gap-1 mb-2">
            {DAY_NAMES.map(d => (
              <div key={d} className="text-center text-[10px] font-black uppercase tracking-widest text-neutral-400 py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((key, idx) => {
              if (!key) return <div key={`empty-${idx}`} className="aspect-square" />;
              const dayNum = Number(key.split('-')[2]);
              const activities = activitiesByDay[key];
              const isToday = key === todayKey;
              const isSelected = key === selectedDay;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDay(isSelected ? null : key)}
                  className={cn(
                    "aspect-square rounded-xl flex flex-col items-center justify-center gap-1 text-sm font-bold transition-all border",
                    isSelected
                      ? "bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-500/25"
                      : isToday
                        ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                        : activities
                          ? "bg-neutral-50 text-neutral-800 border-neutral-200 hover:border-indigo-300 hover:bg-indigo-50 cursor-pointer"
                          : "text-neutral-400 border-transparent hover:bg-neutral-100",
                  )}
                >
                  <span>{dayNum}</span>
                  {activities && (
                    <span className={cn("w-1.5 h-1.5 rounded-full", isSelected ? "bg-white" : "bg-indigo-500")} />
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-neutral-100">
            {(Object.keys(KIND_META) as ActivityItem['kind'][]).map(k => (
              <span key={k} className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-neutral-500">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" style={{ backgroundColor: k === 'evaluation' ? '#7c3aed' : k === 'event' ? '#2563eb' : k === 'material' ? '#d97706' : '#059669' }} />
                {KIND_META[k].label}
              </span>
            ))}
          </div>
        </div>

        <div className="bg-neutral-50/70 border border-neutral-100 rounded-2xl p-5 min-h-[220px]">
          {!selectedItems ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-10">
              <CalendarDays className="w-8 h-8 text-neutral-300 mb-3" />
              <p className="text-sm text-neutral-400 font-medium">Selecciona un día con actividad para ver el detalle</p>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-black uppercase tracking-widest text-neutral-700">{selectedLabel}</p>
                <button
                  type="button"
                  onClick={() => setSelectedDay(null)}
                  className="p-1.5 rounded-lg hover:bg-neutral-200 text-neutral-400"
                  aria-label="Cerrar detalle del día"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2 max-h-[320px] overflow-y-auto custom-scrollbar pr-1">
                {selectedItems
                  .slice()
                  .sort((a, b) => a.kind.localeCompare(b.kind))
                  .map((item, i) => {
                    const meta = KIND_META[item.kind];
                    return (
                      <div key={`${item.kind}-${item.title}-${i}`} className={cn("flex items-start gap-3 p-3 rounded-xl border", meta.bg)}>
                        <div className={cn("mt-0.5", meta.color)}>{meta.icon}</div>
                        <div className="min-w-0">
                          <p className={cn("text-[10px] font-black uppercase tracking-widest", meta.color)}>
                            {meta.label}{item.type ? ` · ${item.type}` : ''}
                          </p>
                          <p className="text-sm font-bold text-neutral-800 leading-snug">{item.title}</p>
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-neutral-500 mt-1">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.subjectColor }} />
                            {item.subjectName}
                          </span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
