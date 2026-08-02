import { useCallback, useMemo } from 'react';
import { Joyride as JoyrideComponent, STATUS, type Controls, type EventData } from 'react-joyride';

interface GuidedTourProps {
  run: boolean;
  onClose: () => void;
  setCurrentView: (view: 'dashboard' | 'subject') => void;
  setActiveTab: (tab: "planning" | "grades" | "attendance" | "students" | "modules") => void;
  isAuthenticated: boolean;
  firstSubjectId: string | null;
  onSelectSubject: (id: string) => void;
}

const MIN_STEP_MS = 6000;

const darkStyles = {
  options: {
    zIndex: 10000,
    arrowColor: '#1e293b',
    backgroundColor: '#1e293b',
    primaryColor: '#818cf8',
    textColor: '#f1f5f9',
    width: 420,
  },
  tooltipContainer: {
    textAlign: 'left' as const,
  },
  buttonPrimary: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 700,
    padding: '10px 22px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: '#ffffff',
  },
  buttonBack: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: 600,
    marginRight: 12,
  },
  buttonSkip: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: 500,
  },
  tooltip: {
    borderRadius: 20,
    padding: '24px 28px',
    boxShadow: '0 25px 70px rgba(0,0,0,0.4), 0 10px 30px rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.08)',
    backgroundColor: '#0f172a',
  },
  tooltipContent: {
    padding: '14px 0 8px',
    fontSize: 14,
    lineHeight: 1.7,
    color: '#cbd5e1',
  },
  tooltipTitle: {
    fontSize: 17,
    fontWeight: 800,
    color: '#f8fafc',
    marginBottom: 4,
  },

};

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export function GuidedTour({
  run,
  onClose,
  setCurrentView,
  setActiveTab,
  isAuthenticated,
  firstSubjectId,
  onSelectSubject,
}: GuidedTourProps) {
  const steps = useMemo(() => {
    if (!isAuthenticated) {
      return [
        {
          target: 'body' as const,
          content: 'Ingresa con tu correo electrónico para crear tu cuenta o iniciar sesión en EdiAgil.',
          placement: 'center' as const,
          title: '🔐 Iniciar Sesión',
          skipBeacon: true,
          before: async () => { await wait(MIN_STEP_MS); },
        },
      ];
    }

    return [
      {
        target: '#new-subject-btn' as const,
        content: 'Crea una nueva asignatura desde el panel lateral. Puedes agregar nombre, docente, horario y color personalizado.',
        placement: 'right' as const,
        title: '📚 Nueva Asignatura',
        skipBeacon: true,
        before: async () => { await wait(MIN_STEP_MS); },
      },
      {
        target: '#tab-modules' as const,
        content: 'Cada asignatura tiene 4 secciones. Esta es la de Módulos y Materiales, donde organizarás el contenido en unidades o temas.',
        placement: 'bottom' as const,
        title: '📦 Módulos y Materiales',
        skipBeacon: true,
        before: async () => {
          if (firstSubjectId) onSelectSubject(firstSubjectId);
          setCurrentView('subject');
          setActiveTab('modules');
          await wait(MIN_STEP_MS);
        },
      },
      {
        target: '#materials-section' as const,
        content: 'Agrega módulos o secciones para estructurar tu materia por unidades, temas o semanas. Usa el botón "Nueva Sección / Módulo" para empezar.',
        placement: 'top' as const,
        title: '➕ Nuevo Módulo',
        skipBeacon: true,
        targetWaitTimeout: 5000,
        before: async () => { await wait(MIN_STEP_MS); },
      },
      {
        target: '#add-note-btn' as const,
        content: 'Desde aquí puedes ingresar tu plan semanal. La IA Magic lo analiza y la información aparecerá en el Dashboard y Calificaciones.',
        placement: 'top' as const,
        title: '📝 Ingresar Apuntes',
        skipBeacon: true,
        targetWaitTimeout: 5000,
        before: async () => {
          await wait(MIN_STEP_MS);
        },
      },
      {
        target: '#tab-students' as const,
        content: 'Aquí gestionas los participantes de tu clase. Puedes agregarlos manualmente o importarlos desde un archivo Excel o PDF.',
        placement: 'bottom' as const,
        title: '👥 Participantes',
        skipBeacon: true,
        before: async () => {
          setActiveTab('students');
          await wait(MIN_STEP_MS);
        },
      },
      {
        target: '#add-manual-btn' as const,
        content: 'Agrega estudiantes uno por uno ingresando su cédula, nombres y género. Ideal para listas pequeñas.',
        placement: 'top' as const,
        title: '➕ Agregar Manualmente',
        skipBeacon: true,
        targetWaitTimeout: 4000,
        before: async () => { await wait(MIN_STEP_MS); },
      },
      {
        target: '#import-file-btn' as const,
        content: 'Importa múltiples estudiantes desde un archivo Excel (.xlsx, .xls), CSV o incluso un PDF. La IA puede extraer la lista automáticamente.',
        placement: 'top' as const,
        title: '📄 Importar Archivo',
        skipBeacon: true,
        before: async () => { await wait(MIN_STEP_MS); },
      },
      {
        target: '#tab-attendance' as const,
        content: 'Registra la asistencia de tus estudiantes semana a semana con un solo clic. Puedes ver el historial completo por sesión.',
        placement: 'bottom' as const,
        title: '📋 Asistencia',
        skipBeacon: true,
        before: async () => {
          setActiveTab('attendance');
          await wait(MIN_STEP_MS);
        },
      },
      {
        target: '#attendance-section' as const,
        content: 'Marca presentes, ausentes o tardanzas. El sistema calcula automáticamente el porcentaje de asistencia de cada estudiante.',
        placement: 'top' as const,
        title: '✅ Registrar Asistencia',
        skipBeacon: true,
        targetWaitTimeout: 4000,
        before: async () => { await wait(MIN_STEP_MS); },
      },
      {
        target: '#tab-grades' as const,
        content: 'Gestiona las calificaciones con ponderaciones personalizadas por tipo de evaluación: Teórica, Práctica y Apreciativa.',
        placement: 'bottom' as const,
        title: '📊 Calificaciones',
        skipBeacon: true,
        before: async () => {
          setActiveTab('grades');
          await wait(MIN_STEP_MS);
        },
      },
      {
        target: '#grades-section' as const,
        content: 'Crea evaluaciones, ingresa notas por estudiante y visualiza el promedio final. Puedes configurar los porcentajes desde la Configuración.',
        placement: 'top' as const,
        title: '📈 Tabla de Calificaciones',
        skipBeacon: true,
        targetWaitTimeout: 5000,
        before: async () => { await wait(MIN_STEP_MS); },
      },
      {
        target: '#exporta-tu-informe-de-clases-en-excel-y-editalo-para-tus-entregas' as const,
        content: 'Exporta el reporte completo a Excel con un solo clic. Incluye calificaciones finales, asistencia y datos de cada estudiante.',
        placement: 'left' as const,
        title: '📤 Exportar a Excel',
        skipBeacon: true,
        targetWaitTimeout: 4000,
        before: async () => {
          setActiveTab('grades');
          await wait(400);
          await wait(MIN_STEP_MS);
        },
      },
      {
        target: '#weightings-btn' as const,
        content: 'Accede a la Configuración para personalizar las ponderaciones de las evaluaciones, la escala de calificación, y más.',
        placement: 'right' as const,
        title: '⚙️ Configuración',
        skipBeacon: true,
        before: async () => { await wait(MIN_STEP_MS); },
      },
      {
        target: '#tour-help-btn' as const,
        content: '¡Has completado el recorrido! Siempre puedes volver aquí para relanzar la guía o consultar la ayuda rápida.',
        placement: 'left' as const,
        title: '🎯 ¡Listo para empezar!',
        skipBeacon: true,
        before: async () => { await wait(MIN_STEP_MS); },
      },
    ];
  }, [isAuthenticated, setCurrentView, setActiveTab, firstSubjectId, onSelectSubject]);

  const handleEvent = useCallback(
    (_data: EventData, _controls: Controls) => {
      if (
        _data.status === STATUS.FINISHED ||
        _data.status === STATUS.SKIPPED
      ) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <JoyrideComponent
      continuous
      onEvent={handleEvent}
      options={{
        spotlightRadius: 14,
        showProgress: true,
      }}
      run={run}
      scrollToFirstStep
      steps={steps}
      styles={darkStyles}
      locale={{
        back: 'Atrás',
        close: 'Cerrar',
        last: '🎉 Finalizar',
        next: 'Siguiente →',
        skip: 'Saltar tour',
        open: 'Abrir',
      }}
    />
  );
}
