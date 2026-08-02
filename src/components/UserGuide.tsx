import { useState } from 'react';
import { X, BookOpen, Users, BarChart3, CalendarCheck, FolderOpen, Settings, Download, Sparkles, ChevronRight, ChevronDown, HelpCircle, LayoutDashboard, CalendarDays, HardDriveUpload } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface UserGuideProps {
  isOpen: boolean;
  onClose: () => void;
  onStartTour: () => void;
}

const sections = [
  {
    id: 'subjects',
    icon: BookOpen,
    color: 'indigo',
    title: 'Asignaturas',
    badge: 'Inicio',
    summary: 'Crea y gestiona tus asignaturas desde el panel lateral.',
    steps: [
      { icon: '➕', text: 'Haz clic en "Nueva Asignatura" en la parte inferior del panel izquierdo.' },
      { icon: '🎨', text: 'Asigna un nombre, color, docente y horario. Elige el tipo de plan (mensual, trimestral, etc.).' },
      { icon: '✏️', text: 'Edita o elimina cualquier asignatura usando los botones que aparecen al abrirla.' },
      { icon: '📌', text: 'El plan gratuito permite hasta 2 asignaturas por año. Actualiza para crear hasta 999.' },
    ],
  },
  {
    id: 'dashboard',
    icon: LayoutDashboard,
    color: 'indigo',
    title: 'Dashboard',
    badge: 'Inicio',
    summary: 'Vista general con progreso, calendario y acceso rápido.',
    steps: [
      { icon: '🏠', text: 'Al iniciar sesión verás el Dashboard con un resumen de todas tus asignaturas.' },
      { icon: '📊', text: 'El widget de progreso muestra el avance global de calificaciones y asistencia.' },
      { icon: '📅', text: 'El calendario integrado te permite ver eventos, clases y fechas importantes de un vistazo.' },
      { icon: '⚡', text: 'Usa los botones de acceso rápido para crear asignaturas, abrir configuración o iniciar el tour.' },
    ],
  },
  {
    id: 'modules',
    icon: FolderOpen,
    color: 'violet',
    title: 'Módulos y Apuntes',
    badge: 'Organización',
    summary: 'Estructura el contenido en unidades, temas o semanas.',
    steps: [
      { icon: '📦', text: 'Dentro de una asignatura, ve a la pestaña "Módulos y Materiales".' },
      { icon: '➕', text: 'Crea módulos principales (ej. Trimestre 1) y sub-módulos (ej. Unidad 1).' },
      { icon: '📝', text: 'Agrega apuntes dentro de cada módulo con texto enriquecido y adjuntos.' },
      { icon: '✨', text: 'Usa la "IA Mágica" en cada apunte para extraer automáticamente evaluaciones, eventos y más.' },
      { icon: '⚡', text: 'Presiona "Generar formato" para crear automáticamente los módulos según el plan de la asignatura.' },
    ],
  },
  {
    id: 'students',
    icon: Users,
    color: 'emerald',
    title: 'Participantes',
    badge: 'Estudiantes',
    summary: 'Gestiona la lista de estudiantes de cada asignatura.',
    steps: [
      { icon: '👤', text: 'Ve a la pestaña "Participantes" dentro de tu asignatura.' },
      { icon: '✋', text: 'Haz clic en "Nuevo" para agregar estudiantes manualmente con cédula, nombres y género.' },
      { icon: '📊', text: 'Haz clic en "Importar" para cargar una lista desde un archivo Excel (.xlsx/.xls) o CSV.' },
      { icon: '🤖', text: 'También puedes importar desde un PDF — la IA extrae automáticamente los nombres.' },
      { icon: '✏️', text: 'Edita el género de cada estudiante directamente en la tabla con un clic.' },
    ],
  },
  {
    id: 'attendance',
    icon: CalendarCheck,
    color: 'sky',
    title: 'Asistencia',
    badge: 'Registro',
    summary: 'Registra y consulta la asistencia sesión a sesión.',
    steps: [
      { icon: '📋', text: 'Abre la pestaña "Asistencia" en tu asignatura.' },
      { icon: '📅', text: 'Crea una nueva sesión seleccionando la fecha y el módulo correspondiente.' },
      { icon: '✅', text: 'Marca a cada estudiante como Presente (P), Ausente (A) o Tardanza (T).' },
      { icon: '📈', text: 'El sistema calcula automáticamente el porcentaje de asistencia de cada estudiante.' },
      { icon: '🔍', text: 'Consulta el historial completo de asistencia y descarga reportes en Excel.' },
    ],
  },
  {
    id: 'grades',
    icon: BarChart3,
    color: 'rose',
    title: 'Calificaciones',
    badge: 'Notas',
    summary: 'Crea evaluaciones, ingresa notas y calcula promedios automáticamente.',
    steps: [
      { icon: '📊', text: 'Ve a la pestaña "Calificaciones" de tu asignatura.' },
      { icon: '➕', text: 'Crea evaluaciones indicando título, tipo (Teórica/Práctica/Apreciativa), nota máxima y fecha.' },
      { icon: '✏️', text: 'Haz clic en una evaluación para ingresar las notas de cada estudiante.' },
      { icon: '🧮', text: 'El promedio final se calcula automáticamente con las ponderaciones configuradas.' },
    ],
  },
  {
    id: 'calendar',
    icon: CalendarDays,
    color: 'sky',
    title: 'Calendario',
    badge: 'Eventos',
    summary: 'Gestiona eventos, feriados y fechas importantes.',
    steps: [
      { icon: '📅', text: 'El Calendario está disponible en el Dashboard y dentro de cada asignatura.' },
      { icon: '➕', text: 'Agrega eventos como feriados, reuniones o fechas de exámenes.' },
      { icon: '🔁', text: 'Los eventos extraídos por la IA desde tus apuntes aparecen automáticamente aquí.' },
    ],
  },
  {
    id: 'settings',
    icon: Settings,
    color: 'amber',
    title: 'Configuración',
    badge: 'Ajustes',
    summary: 'Personaliza ponderaciones, escala de calificación y plan de suscripción.',
    steps: [
      { icon: '⚙️', text: 'Haz clic en "Configuración" en la parte inferior del panel lateral.' },
      { icon: '⚖️', text: 'Ajusta los porcentajes de cada tipo de evaluación (Teórica, Práctica, Apreciativa).' },
      { icon: '📏', text: 'Configura la escala de calificación (ej. sobre 20, sobre 10, sobre 5).' },
      { icon: '💎', text: 'Gestiona tu plan (Gratis, Pro o Escolar) para desbloquear funciones avanzadas.' },
      { icon: '💾', text: 'Respaldar todos tus datos en un archivo JSON desde "Exportar Datos". Puedes restaurarlos después.' },
      { icon: '📋', text: 'Usa "Diagnosticar Índices" si algo no carga correctamente para verificar la base de datos.' },
    ],
  },
];

const colorMap: Record<string, { bg: string; border: string; text: string; badge: string; icon: string }> = {
  indigo: { bg: 'bg-indigo-50', border: 'border-indigo-100', text: 'text-indigo-600', badge: 'bg-indigo-100 text-indigo-700', icon: 'bg-indigo-100' },
  violet: { bg: 'bg-violet-50', border: 'border-violet-100', text: 'text-violet-600', badge: 'bg-violet-100 text-violet-700', icon: 'bg-violet-100' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-700', icon: 'bg-emerald-100' },
  sky: { bg: 'bg-sky-50', border: 'border-sky-100', text: 'text-sky-600', badge: 'bg-sky-100 text-sky-700', icon: 'bg-sky-100' },
  rose: { bg: 'bg-rose-50', border: 'border-rose-100', text: 'text-rose-600', badge: 'bg-rose-100 text-rose-700', icon: 'bg-rose-100' },
  amber: { bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-600', badge: 'bg-amber-100 text-amber-700', icon: 'bg-amber-100' },
};

export function UserGuide({ isOpen, onClose, onStartTour }: UserGuideProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = (id: string) => setExpanded(prev => prev === id ? null : id);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-neutral-900/50 backdrop-blur-md z-[90]"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, x: '100%' }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: '100%' }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-white z-[91] flex flex-col shadow-2xl shadow-indigo-500/10 border-l border-neutral-200"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-8 border-b border-neutral-100">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/30">
                  <HelpCircle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-neutral-900 tracking-tight">Guía de Uso</h2>
                  <p className="text-sm text-neutral-400 font-medium">EdiAgil · Cuaderno Digital</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-3 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 rounded-2xl transition-all active:scale-90"
                aria-label="Cerrar guía"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Tour CTA */}
            <div className="px-8 py-6 border-b border-neutral-100 bg-gradient-to-r from-indigo-50 to-violet-50">
              <div className="flex items-center justify-between gap-6">
                <div className="flex-1 min-w-0">
                  <p className="font-black text-neutral-900 text-base leading-tight">¿Primera vez?</p>
                  <p className="text-sm text-neutral-500 font-medium mt-1">Inicia el tour interactivo para conocer todas las funciones.</p>
                </div>
                <button
                  onClick={() => { onClose(); onStartTour(); }}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-xl shadow-indigo-500/25 active:scale-95 shrink-0"
                >
                  <Sparkles className="w-4 h-4" />
                  Iniciar Tour
                </button>
              </div>
            </div>

            {/* Sections */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3" style={{ scrollbarWidth: 'thin' }}>
              {sections.map((section) => {
                const Icon = section.icon;
                const colors = colorMap[section.color];
                const isExpanded = expanded === section.id;

                return (
                  <div
                    key={section.id}
                    className={`border rounded-3xl overflow-hidden transition-all duration-300 ${isExpanded ? `${colors.border} shadow-md` : 'border-neutral-200'}`}
                  >
                    <button
                      onClick={() => toggle(section.id)}
                      className={`w-full flex items-center gap-5 p-6 text-left transition-all hover:bg-neutral-50 ${isExpanded ? colors.bg : 'bg-white'}`}
                    >
                      <div className={`w-11 h-11 ${colors.icon} ${colors.text} rounded-2xl flex items-center justify-center shrink-0`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-black text-neutral-900 text-base">{section.title}</span>
                          <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-widest ${colors.badge}`}>
                            {section.badge}
                          </span>
                        </div>
                        <p className="text-sm text-neutral-500 font-medium leading-snug">{section.summary}</p>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className={`w-5 h-5 shrink-0 ${colors.text}`} />
                      ) : (
                        <ChevronRight className="w-5 h-5 shrink-0 text-neutral-300" />
                      )}
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25, ease: 'easeOut' }}
                          className="overflow-hidden"
                        >
                          <div className={`px-6 pb-6 pt-2 space-y-3 ${colors.bg}`}>
                            {section.steps.map((step, i) => (
                              <div key={i} className="flex items-start gap-4 bg-white/70 rounded-2xl px-5 py-4 border border-white">
                                <span className="text-lg shrink-0 mt-0.5">{step.icon}</span>
                                <p className="text-sm text-neutral-700 font-medium leading-relaxed">{step.text}</p>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}

              {/* Export tip */}
              <div className="border border-emerald-200 rounded-3xl overflow-hidden bg-emerald-50 p-6 mt-2">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center shrink-0">
                    <Download className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-black text-neutral-900 text-base mb-1">Exportar y Respaldar</p>
                    <p className="text-sm text-neutral-600 font-medium leading-relaxed">
                      Desde la pestaña de Calificaciones puedes exportar todo el reporte a Excel. También puedes respaldar todos tus datos desde la Configuración en formato JSON, que puedes volver a cargar para editar una clase ya cerrada.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-neutral-100 bg-neutral-50">
              <p className="text-xs text-center text-neutral-400 font-medium">
                EdiAgil · Cuaderno Digital para Docentes
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
