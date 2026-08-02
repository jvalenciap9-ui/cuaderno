import React, { memo, useMemo } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { useCustomCollectionData } from '../lib/firestoreUtils';
import { collection, query, where, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthProvider';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar as CalendarIcon, Clock } from 'lucide-react';
import type { CalendarEventDoc } from '../types/firestore';

interface SubjectCalendarProps {
  subjectId: string;
}

const EVENT_COLORS: Record<string, string> = {
  class: '#4f46e5',
  exam: '#dc2626',
  deadline: '#d97706',
  other: '#737373',
};

const EVENT_LABELS: Record<string, string> = {
  class: 'Clase',
  exam: 'Evaluación',
  deadline: 'Entrega',
  other: 'Otro',
};

function matchesDay(dateStr: string, date: Date) {
  try {
    const parts = dateStr.split('T')[0].split('-');
    if (parts.length !== 3) return false;
    const [y, m, d] = parts.map(Number);
    return y === date.getFullYear() && m === date.getMonth() + 1 && d === date.getDate();
  } catch {
    return false;
  }
}

export const SubjectCalendar = memo(function SubjectCalendar({ subjectId }: SubjectCalendarProps) {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = React.useState<Date>(new Date());

  const eventsRef = collection(db, 'calendarEvents');
  const eventsQuery = user?.uid && subjectId
    ? query(eventsRef, where('userId', '==', user.uid), where('subjectId', '==', subjectId), limit(500))
    : null;
  const [events = [], loading] = useCustomCollectionData<CalendarEventDoc>(eventsQuery);

  const dayEvents = useMemo(
    () =>
      [...events]
        .filter((e) => matchesDay(e.date, selectedDate))
        .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')),
    [events, selectedDate],
  );

  const hasEvents = (date: Date) => events.some((e) => matchesDay(e.date, date));

  try {
    if (loading) {
      return (
        <div className="space-y-6 animate-pulse">
          <div className="h-10 bg-neutral-100 rounded-2xl w-48" />
          <div className="h-64 bg-neutral-100 rounded-[2.5rem]" />
        </div>
      );
    }

    if (!events || events.length === 0) {
      return (
        <div className="bg-white border border-neutral-200 rounded-[2.5rem] overflow-hidden shadow-sm">
          <div className="p-8 border-b border-neutral-100 bg-neutral-50 flex items-center justify-between">
            <h3 className="text-2xl font-black text-neutral-900 flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center border border-indigo-100">
                <CalendarIcon className="w-5 h-5 text-indigo-600" />
              </div>
              Calendario
            </h3>
          </div>
          <div className="p-16 text-center">
            <div className="w-16 h-16 bg-neutral-50 border border-neutral-100 rounded-2xl flex items-center justify-center mb-4 mx-auto">
              <CalendarIcon className="w-8 h-8 text-neutral-300" />
            </div>
            <p className="text-neutral-900 font-bold">No hay eventos para esta asignatura.</p>
            <p className="text-neutral-500 text-sm mt-1">Crea eventos de clase, evaluaciones y entregas para verlos aquí.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-white border border-neutral-200 rounded-[2.5rem] overflow-hidden shadow-sm">
        <div className="p-8 border-b border-neutral-100 bg-neutral-50 flex items-center justify-between">
          <h3 className="text-2xl font-black text-neutral-900 flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center border border-indigo-100">
              <CalendarIcon className="w-5 h-5 text-indigo-600" />
            </div>
            Calendario
          </h3>
          <span className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] bg-white px-4 py-1.5 rounded-full border border-neutral-100 shadow-sm">
            {format(selectedDate, 'MMMM yyyy', { locale: es })}
          </span>
        </div>

        <div className="p-8">
          <style>{`
            .react-calendar {
              background: transparent;
              border: none;
              width: 100%;
              font-family: inherit;
              color: #171717;
            }
            .react-calendar__navigation {
              margin-bottom: 1.5rem;
            }
            .react-calendar__navigation button {
              color: #171717;
              min-width: 44px;
              background: none;
              font-size: 14px;
              font-weight: 900;
              text-transform: uppercase;
              letter-spacing: 0.1em;
            }
            .react-calendar__navigation button:enabled:hover,
            .react-calendar__navigation button:enabled:focus {
              background-color: #f5f5f5;
              border-radius: 16px;
            }
            .react-calendar__month-view__weekdays {
              text-transform: uppercase;
              font-weight: 900;
              font-size: 10px;
              color: #a3a3a3;
              letter-spacing: 0.1em;
              padding-bottom: 1.5rem;
            }
            .react-calendar__month-view__weekdays__weekday abbr {
              text-decoration: none;
            }
            .react-calendar__tile {
              padding: 1rem 0.5rem;
              background: none;
              text-align: center;
              border-radius: 18px;
              transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
              position: relative;
              font-weight: 700;
              font-size: 14px;
            }
            .react-calendar__tile:enabled:hover,
            .react-calendar__tile:enabled:focus {
              background-color: #f5f5f5;
              transform: scale(1.1);
              z-index: 10;
              box-shadow: 0 10px 20px -5px rgba(0,0,0,0.05);
            }
            .react-calendar__tile--now {
              background: #f5f3ff !important;
              color: #4f46e5 !important;
              font-weight: 900;
            }
            .react-calendar__tile--active {
              background: #4f46e5 !important;
              color: white !important;
              box-shadow: 0 15px 25px -5px rgba(79, 70, 229, 0.4) !important;
              transform: scale(1.05);
            }
          `}</style>
          <Calendar
            onChange={(val) => setSelectedDate(val as Date)}
            value={selectedDate}
            locale="es-ES"
            tileClassName={({ date }) => (hasEvents(date) ? 'has-event' : null)}
            tileContent={({ date, view }) => {
              if (view !== 'month') return null;
              const dayEvts = events.filter((e) => matchesDay(e.date, date)).slice(0, 3);
              if (dayEvts.length === 0) return null;
              return (
                <div className="flex gap-1 justify-center mt-1 absolute bottom-2 left-0 right-0">
                  {dayEvts.map((ev, idx) => (
                    <div
                      key={idx}
                      className="w-1.5 h-1.5 rounded-full shadow-sm"
                      style={{ backgroundColor: EVENT_COLORS[ev.type] || '#4f46e5' }}
                    />
                  ))}
                </div>
              );
            }}
          />
        </div>

        <div className="p-8 bg-neutral-50/50 border-t border-neutral-100">
          <div className="flex flex-col bg-white rounded-3xl border border-neutral-200 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-neutral-100 bg-white flex flex-col gap-1">
              <h3 className="font-black text-xl text-neutral-900 tracking-tight">Agenda del Día</h3>
              <p className="text-xs font-semibold text-neutral-400 capitalize">
                {format(selectedDate, 'EEEE, d MMMM', { locale: es })}
              </p>
            </div>
            <div className="overflow-y-auto custom-scrollbar p-6 max-h-[420px]">
              {dayEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-10">
                  <div className="w-16 h-16 bg-neutral-50 border border-neutral-100 rounded-2xl flex items-center justify-center mb-4">
                    <Clock className="w-8 h-8 text-neutral-300" />
                  </div>
                  <p className="text-neutral-900 font-bold">Día Libre</p>
                  <p className="text-neutral-500 text-sm mt-1">No hay eventos programados para este día.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {dayEvents.map((ev, idx) => {
                    const type = ev.type;
                    const color = EVENT_COLORS[type] || '#4f46e5';
                    const time = ev.startTime || '';
                    const topic = ev.topic || '';
                    const description = ev.description || '';
                    return (
                      <div
                        key={ev.id || idx}
                        className="relative flex flex-col p-4 bg-white border border-neutral-200 hover:border-neutral-300 rounded-2xl transition-all shadow-sm hover:shadow-md"
                      >
                        <div className="absolute -left-px top-4 bottom-4 w-1 rounded-r opacity-70" style={{ backgroundColor: color }} />
                        <div className="flex flex-col min-w-0 pl-2">
                          <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-1">
                            {EVENT_LABELS[type] || 'Evento'} {time ? `• ${time}` : ''}
                          </span>
                          {topic && (
                            <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-0.5">
                              {topic}
                            </span>
                          )}
                          <span className="font-bold text-neutral-900 leading-tight">{ev.title}</span>
                          {description && (
                            <span className="text-xs text-neutral-500 mt-1 leading-relaxed">{description}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  } catch (err) {
    console.warn('Error rendering SubjectCalendar:', err);
    return (
      <div className="bg-white border border-neutral-200 rounded-[2.5rem] p-12 text-center shadow-sm">
        <p className="text-neutral-900 font-bold">No hay eventos para esta asignatura.</p>
        <p className="text-neutral-500 text-sm mt-1">Ocurrió un problema al cargar el calendario.</p>
      </div>
    );
  }
});
