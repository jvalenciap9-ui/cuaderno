import React, { memo } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { useCustomCollectionData } from "../lib/firestoreUtils";
import { collection, query, where, deleteDoc, doc, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthProvider';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
import { format, isSameDay, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar as CalendarIcon, Clock, MapPin, GraduationCap, FolderOpen, ClipboardList, Paperclip, FileText, Sparkles, Trash2, StopCircle } from 'lucide-react';
import { cn } from '../lib/utils';

export const CalendarSection = memo(function CalendarSection({ subjectId }: { subjectId?: string | 'all' }) {
  const { user } = useAuth();
  
  const subjectsQuery = user?.uid ? query(collection(db, 'subjects'), where('userId', '==', user?.uid), limit(500)) : null;
  const [subjects = [], loadingSubjects] = useCustomCollectionData(subjectsQuery);

  const eventsRef = collection(db, 'calendarEvents');
  const eventsQuery = user?.uid ? (subjectId && subjectId !== 'all' 
    ? query(eventsRef, where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500))
    : query(eventsRef, where('userId', '==', user?.uid), limit(500))) : null;
  const [events = [], loadingEvents] = useCustomCollectionData(eventsQuery);

  const modulesRef = collection(db, 'subjectModules');
  const modulesQuery = user?.uid ? (subjectId && subjectId !== 'all'
    ? query(modulesRef, where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500))
    : query(modulesRef, where('userId', '==', user?.uid), limit(500))) : null;
  const [modules = [], loadingMods] = useCustomCollectionData(modulesQuery);

  const evalsRef = collection(db, 'evaluations');
  const evalsQuery = user?.uid ? (subjectId && subjectId !== 'all'
    ? query(evalsRef, where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500))
    : query(evalsRef, where('userId', '==', user?.uid), limit(500))) : null;
  const [evaluations = [], loadingEvals] = useCustomCollectionData(evalsQuery);

  const materialsRef = collection(db, 'materials');
  const materialsQuery = user?.uid ? (subjectId && subjectId !== 'all'
    ? query(materialsRef, where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500))
    : query(materialsRef, where('userId', '==', user?.uid), limit(500))) : null;
  const [materials = [], loadingMats] = useCustomCollectionData(materialsQuery);

  const notesRef = collection(db, 'notes');
  const notesQuery = user?.uid ? (subjectId && subjectId !== 'all'
    ? query(notesRef, where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500))
    : query(notesRef, where('userId', '==', user?.uid), limit(500))) : null;
  const [notes = [], loadingNotes] = useCustomCollectionData(notesQuery);

  const [selectedDate, setSelectedDate] = React.useState<Date>(new Date());
  const [confirmingEventId, setConfirmingEventId] = React.useState<string | null>(null);

  const allEvents = [
    ...events.filter(e => subjects.some(s => s.id === e.subjectId)).map(e => ({ ...e, id: `event-${e.id}`, eventType: 'calendar' as const })),
    ...notes.filter(n => subjects.some(s => s.id === n.subjectId)).map(n => ({
      id: `note-${n.id}`,
      subjectId: n.subjectId,
      title: `${n.title}`,
      date: n.date,
      type: 'other' as const,
      eventType: 'note' as const,
      observations: n.content,
      startTime: n.startTime,
      endTime: n.endTime
    })),
    ...evaluations.filter(ev => subjects.some(s => s.id === ev.subjectId)).map(ev => ({ 
      id: `eval-${ev.id}`, 
      subjectId: ev.subjectId, 
      title: `Evaluación: ${ev.title}`, 
      date: ev.date, 
      type: 'exam' as const,
      eventType: 'evaluation' as const
    })),
    ...materials.filter(m => m.date && subjects.some(s => s.id === m.subjectId)).map(m => ({
      id: `mat-${m.id}`,
      subjectId: m.subjectId,
      title: `Material: ${m.title}`,
      date: m.date,
      type: 'other' as const,
      eventType: 'material' as const,
      startTime: m.startTime,
      endTime: m.endTime,
      observations: m.observations
    })),
    ...subjects.flatMap(s => {
      const res = [];
      if (s.startDate) res.push({ id: `sub-start-${s.id}`, subjectId: s.id, title: `Inicio de Asignatura: ${s.name}`, date: s.startDate, type: 'other' as const, eventType: 'subject_start' as const });
      if (s.endDate) res.push({ id: `sub-end-${s.id}`, subjectId: s.id, title: `Fin de Asignatura: ${s.name}`, date: s.endDate, type: 'other' as const, eventType: 'subject_end' as const });
      return res;
    }),
    ...modules.flatMap(m => {
      const res = [];
      if (m.startDate) res.push({ id: `mod-start-${m.id}`, subjectId: m.subjectId, title: `Inicio de Módulo: ${m.title}`, date: m.startDate, type: 'other' as const, eventType: 'module_start' as const });
      if (m.endDate) res.push({ id: `mod-end-${m.id}`, subjectId: m.subjectId, title: `Fin de Módulo: ${m.title}`, date: m.endDate, type: 'other' as const, eventType: 'module_end' as const });
      return res;
    })
  ];

  const isLoading = loadingSubjects || loadingEvents || loadingMods || loadingEvals || loadingMats || loadingNotes;

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 bg-neutral-100 rounded-2xl w-48" />
        <div className="h-64 bg-neutral-100 rounded-[2.5rem]" />
      </div>
    );
  }

  const dayEvents = allEvents.filter(event => {
    try {
      const parts = event.date.split('T')[0].split('-');
      if (parts.length === 3) {
        const [y, m, d] = parts.map(Number);
        return y === selectedDate.getFullYear() &&
               m === selectedDate.getMonth() + 1 &&
               d === selectedDate.getDate();
      }
      return false;
    } catch {
      return false;
    }
  });

  return (
    <div className="bg-white border border-neutral-200 rounded-[2.5rem] overflow-hidden shadow-sm hover:shadow-2xl transition-all duration-500 group/calendar">
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
      
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <div className="p-8 border-r border-neutral-100 bg-white">
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
            tileClassName={({ date }) => {
              const dayEvents = allEvents.filter(e => {
                try {
                  const parts = e.date.split('T')[0].split('-');
                  if (parts.length === 3) {
                    const [y, m, d] = parts.map(Number);
                    return y === date.getFullYear() &&
                           m === date.getMonth() + 1 &&
                           d === date.getDate();
                  }
                  return false;
                } catch {
                  return false;
                }
              });
              return dayEvents.length > 0 ? 'has-event' : null;
            }}
            tileContent={({ date, view }) => {
              if (view === 'month') {
                const dayEvents = allEvents.filter(e => {
                  try {
                    const parts = e.date.split('T')[0].split('-');
                    if (parts.length === 3) {
                      const [y, m, d] = parts.map(Number);
                      return y === date.getFullYear() &&
                             m === date.getMonth() + 1 &&
                             d === date.getDate();
                    }
                    return false;
                  } catch {
                    return false;
                  }
                });
                
                if (dayEvents.length > 0) {
                  // Get unique colors for the day's events
                  const eventColors = Array.from(new Set(dayEvents.map(e => {
                    if (e.eventType === 'extracted') return (e).color;
                    const subject = subjects.find(s => s.id === e.subjectId);
                    return subject?.color || '#4f46e5';
                  }))).slice(0, 3); // Max 3 dots per day to fit
                  
                  return (
                    <div className="flex gap-1 justify-center mt-1 absolute bottom-2 left-0 right-0">
                      {eventColors.map((color, idx) => (
                        <div key={idx} className="w-1.5 h-1.5 rounded-full shadow-sm" style={{ backgroundColor: color }} />
                      ))}
                    </div>
                  );
                }
              }
              return null;
            }}
          />
        </div>

        <div className="p-8 bg-neutral-50/50 flex flex-col h-[450px]">
          <div className="flex-1 flex flex-col bg-white rounded-3xl border border-neutral-200 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-neutral-100 bg-white sticky top-0 z-10 flex flex-col gap-1">
              <h3 className="font-black text-xl text-neutral-900 tracking-tight">Agenda del Día</h3>
              <p className="text-xs font-semibold text-neutral-400 capitalize">{format(selectedDate, 'EEEE, d MMMM', { locale: es })}</p>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
              {dayEvents.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 bg-neutral-50 border border-neutral-100 rounded-2xl flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-neutral-300" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
                  </div>
                  <p className="text-neutral-900 font-bold">Día Libre</p>
                  <p className="text-neutral-500 text-sm mt-1">No hay eventos programados para hoy.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {dayEvents.map((ev, idx) => {
                    const subject = (subjects || []).find(s => s.id === ev.subjectId);
                    const color = (ev).color || subject?.color || '#3b82f6';
                    const time = (ev).startTime || '';
                    const typeLabels: Record<string, string> = {
                      calendar: 'Calendario',
                      module_start: 'Inicio Módulo',
                      module_end: 'Fin Módulo',
                      subject_start: 'Inicio Asignatura',
                      subject_end: 'Fin Asignatura',
                      extracted: 'AI Mágica'
                    };
                    const typeLabel = typeLabels[ev.eventType] || 'Evento';
                    
                    return (
                      <div 
                        key={ev.id || idx} 
                        className="group relative flex flex-col p-4 bg-white border border-neutral-200 hover:border-neutral-300 rounded-2xl transition-all shadow-sm hover:shadow-md"
                      >
                        {/* Indicador de Color */}
                        <div 
                          className="absolute -left-px top-4 bottom-4 w-1 rounded-r opacity-70"
                          style={{ backgroundColor: color }}
                        />
                        
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex flex-col min-w-0 flex-1 pl-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-1">
                              {typeLabel} {time ? `• ${time}` : ''}
                            </span>
                            <span className="font-bold text-neutral-900 leading-tight">
                              {ev.title}
                            </span>
                          </div>
                          
                          {(['calendar', 'extracted', 'evaluation', 'material', 'note'].includes(ev.eventType)) && (
                            confirmingEventId === ev.id ? (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setConfirmingEventId(null)}
                                  className="text-[10px] font-bold text-neutral-500 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 px-3 py-1.5 rounded-lg transition-colors"
                                >
                                  Cancelar
                                </button>
                                <button
                                  onClick={async () => {
                                    const actualId = (ev.id as string).split('-').slice(1).join('-');
                                    if (ev.eventType === 'calendar') {
                                      await deleteDoc(doc(db, 'calendarEvents', actualId));
                                    } else if (ev.eventType === 'extracted') {
                                      // kept for backwards compat
                                    } else if (ev.eventType === 'evaluation') {
                                      await deleteDoc(doc(db, 'evaluations', actualId));
                                    } else if (ev.eventType === 'material') {
                                      await deleteDoc(doc(db, 'materials', actualId));
                                    } else if (ev.eventType === 'note') {
                                      await deleteDoc(doc(db, 'notes', actualId));
                                    }
                                    setConfirmingEventId(null);
                                  }}
                                  className="text-[10px] font-bold text-white hover:bg-red-700 bg-red-600 px-3 py-1.5 rounded-lg transition-colors"
                                >
                                  Borrar
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmingEventId(ev.id)}
                                className="p-2 text-red-400 opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all shrink-0"
                                title="Eliminar evento"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                              </button>
                            )
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
    </div>
  );
});

function BookMarked({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
      <path d="M8 7h6" />
      <path d="M8 11h8" />
    </svg>
  );
}
