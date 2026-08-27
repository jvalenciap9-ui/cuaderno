import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthProvider';
import { usePlan } from '../hooks/usePlan';
import {
  adminListTeachers,
  adminGetTeacherData,
  adminGetSchoolConfig,
  adminGetInstitutionStats,
  adminInviteTeacher,
  getInstitutionalMetrics,
  adminGetInstitutionAlerts,
  type TeacherSummary,
  type SchoolConfig,
  type GradingWeight,
  type InstitutionPeriodos,
  type PlanRules,
  type InstitutionalMetrics,
  type InstitutionalRiskStudentRow,
  type AdminInstitutionAlertsResponse,
  type SubjectMetric,
  EMPTY_SCHOOL_CONFIG,
  DEFAULT_GRADING_WEIGHT,
  DEFAULT_PERIODOS,
  DEFAULT_PLAN_RULES,
} from '../lib/adminApi';
import { exportTeacherDataToExcel, exportInstitutionalReport } from '../lib/exportUtils';
import { showToast } from '../hooks/useToast';
import { AdminTeacherDetail } from './AdminTeacherDetail';
import type { AdminTeacherTab } from './AdminTeacherDetail';
import { AdminInstitutionStats } from './AdminInstitutionStats';
import { AdminStudents } from './AdminStudents';
import { AdminAlerts } from './AdminAlerts';
import { AdminOnboarding } from './AdminOnboarding';
import { AdminStudentSearch } from './AdminStudentSearch';
import { StudentDetailView } from './StudentDetailView';
import { AdminInformeReport } from './AdminInstitutionalReport';
import { useAdminFilters } from '../contexts/AdminFiltersContext';
import { AdminSummaryCards } from './AdminSummaryCards';
import { AdminTodayWeek } from './AdminTodayWeek';
import { AdminAccordion } from './AdminAccordion';
import { TURNO_LABEL, NIVEL_LABEL } from '../lib/dashboardFilters';
import {
  Users,
  GraduationCap,
  FileSpreadsheet,
  FileText,
  Search,
  FileSearch,
  Loader2,
  RefreshCw,
  ShieldCheck,
  EyeOff,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  UserPlus,
  Send,
  Download,
  BarChart3,
  BookOpen,
  Filter as FilterIcon,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

const formatActivity = (ts: number | null): string => {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
};

const planLabel = (plan: TeacherSummary['plan']): string => {
  if (plan === 'school') return 'Institucional';
  if (plan === 'pro') return 'Premium Pro';
  return 'Gratis';
};

/**
 * AdminDashboard — Panel administrativo rediseñado (rediseno-panel.md).
 *
 * Estructura: cabecera (institución + actualizar + Mi institución) → Resumen
 * Hoy/Esta semana → 4 tarjetas KPI → Acordeón Gestión Pedagógica → Acordeón
 * Estudiantes en Riesgo → Acordeón Métricas Institucionales. Los filtros
 * globales viven en el sidebar (AdminFiltersContext) y afectan TODAS las
 * secciones; cada acordeón carga sus datos solo al expandirse (lazy).
 * Se conserva toda la funcionalidad previa: boletín, búsqueda, configuración,
 * periodos, reglas, onboarding e invitación de docentes.
 */
export function AdminDashboard() {
  const { user } = useAuth();
  const { profile, isAdmin } = usePlan();
  const [teachers, setTeachers] = useState<TeacherSummary[]>([]);
  const [institutionName, setInstitutionName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  // Filtros combinados: viven en AdminFiltersContext (los controla el sidebar).
  const { turno, nivelEducativo } = useAdminFilters();
  const [exportingUid, setExportingUid] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string>('');
  // Pestaña con la que abre el detalle del docente: el botón "Asignaturas"
  // abre directo la pestaña de asignaturas (activas e inactivas); el resto
  // de accesos abren en "Resumen".
  const [detailTab, setDetailTab] = useState<AdminTeacherTab>('resumen');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [schoolConfig, setSchoolConfig] = useState<SchoolConfig>(EMPTY_SCHOOL_CONFIG);
  const [gradingWeight, setGradingWeight] = useState<GradingWeight>(DEFAULT_GRADING_WEIGHT);
  const [periodos, setPeriodos] = useState<InstitutionPeriodos>(DEFAULT_PERIODOS);
  const [planRules, setPlanRules] = useState<PlanRules>(DEFAULT_PLAN_RULES);
  const [institutionId, setInstitutionId] = useState('');
  const [configLoading, setConfigLoading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  // Métricas globales + riesgo estudiantil (respetan filtros).
  const [metrics, setMetrics] = useState<InstitutionalMetrics | null>(null);
  const [alertsTotal, setAlertsTotal] = useState(0);
  // Respuesta completa de alertas (el informe PDF usa el detalle, el KPI usa alertsTotal).
  const [alertsData, setAlertsData] = useState<AdminInstitutionAlertsResponse | null>(null);
  // Informe Institucional PDF: generación en curso + ranking opcional de asignaturas
  // (enriquecido al exportar reutilizando el loader adminGetInstitutionStats).
  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportStats, setReportStats] = useState<SubjectMetric[] | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  // Sprint 2: estudiante seleccionado en la tabla de riesgo (abre el detalle).
  const [riskDetailStudent, setRiskDetailStudent] = useState<string | null>(null);
  // Acordeones: apertura controlada (onboarding puede navegar a una sección).
  const [pedOpen, setPedOpen] = useState(true);
  const [riskOpen, setRiskOpen] = useState(false);
  const [metOpen, setMetOpen] = useState(false);
  const [pedSection, setPedSection] = useState<'teachers' | 'students'>('teachers');
  const [metSection, setMetSection] = useState<'alerts' | 'discrepancias' | 'graficos'>('graficos');

  const handleInvite = async () => {
    const email = inviteEmail.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('error', 'Escribe un correo electrónico válido.');
      return;
    }
    setInviting(true);
    try {
      const res = await adminInviteTeacher(email);
      showToast('success', res.message || 'Docente invitado correctamente.');
      setInviteEmail('');
      setInviteOpen(false);
      await loadTeachers();
    } catch (err: any) {
      console.error('adminInviteTeacher error:', err);
      showToast('error', err?.message || 'No se pudo invitar al docente.');
    } finally {
      setInviting(false);
    }
  };

  const loadSchoolConfig = async (silent = false) => {
    if (!silent) setConfigLoading(true);
    try {
      const res = await adminGetSchoolConfig();
      setSchoolConfig(res.schoolConfig);
      if (res.gradingWeight) setGradingWeight(res.gradingWeight);
      if (res.periodos) setPeriodos(res.periodos);
      if (res.planRules) setPlanRules(res.planRules);
      setInstitutionId(res.institutionId);
      if (res.institutionName) setInstitutionName(res.institutionName);
      // Primer ingreso: abrir el onboarding post-login automáticamente.
      if (!res.schoolConfig.onboardingDone) setShowOnboarding(true);
    } catch (err: any) {
      console.error('adminGetSchoolConfig error:', err);
    } finally {
      setConfigLoading(false);
    }
  };

  const handleOnboardingSaved = async () => {
    setShowOnboarding(false);
    // Refresca en silencio TODA la configuración de la institución (schoolConfig,
    // gradingWeight, periodos y planRules) para que el dashboard refleje los
    // cambios de los módulos 4, 1 y 5 sin recargar la página.
    await loadSchoolConfig(true);
  };

  const loadTeachers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminListTeachers({ turno, nivelEducativo });
      setTeachers(res.teachers);
      setInstitutionName(profile?.institutionName || res.institutionId);
      if (selectedUid && !res.teachers.some(t => t.uid === selectedUid)) {
        setSelectedUid('');
      }
    } catch (err: any) {
      console.error('adminListTeachers error:', err);
      setError(err?.message || 'No se pudieron cargar los docentes.');
    } finally {
      setLoading(false);
    }
  };

  // Sprint 1 Métricas: KPIs globales + alertas activas, recargados con los
  // filtros combinados del sidebar (turno + nivel educativo).
  const loadMetrics = async () => {
    if (!user || !isAdmin) return;
    setMetricsLoading(true);
    try {
      const [m, alerts] = await Promise.all([
        getInstitutionalMetrics({ turno, nivelEducativo }),
        adminGetInstitutionAlerts({ turno, nivelEducativo }),
      ]);
      setMetrics(m);
      setAlertsData(alerts);
      setAlertsTotal(alerts.summary?.total ?? 0);
    } catch (err: any) {
      console.error('getInstitutionalMetrics error:', err);
      setMetrics(null);
      setAlertsData(null);
      setAlertsTotal(0);
    } finally {
      setMetricsLoading(false);
    }
  };

  const handleRefresh = async () => {
    await Promise.all([loadTeachers(), loadMetrics(), loadSchoolConfig(true)]);
    showToast('success', 'Panel actualizado con los filtros activos.');
  };

  useEffect(() => {
    if (!user || !isAdmin) return;
    loadTeachers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin, turno, nivelEducativo]);

  useEffect(() => {
    if (!user || !isAdmin) return;
    loadSchoolConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin]);

  useEffect(() => {
    if (!user || !isAdmin) return;
    loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin, turno, nivelEducativo]);

  // Tarjetas KPI derivadas de las métricas (Sprint 1).
  const kpi = useMemo(() => {
    const atRisk = metrics
      ? metrics.riskSummary.medium + metrics.riskSummary.high
      : 0;
    return {
      attendance: metrics?.attendance.global ?? null,
      grades: metrics?.grades.global ?? null,
      atRisk,
      alerts: alertsTotal,
    };
  }, [metrics, alertsTotal]);

  // Últimos 7 puntos de la tendencia de asistencia (sparkline "Esta semana").
  const trendLast7 = useMemo(
    () => (metrics?.trends?.attendance ?? []).slice(-7),
    [metrics],
  );

  // Color de la insignia de riesgo (paleta EdiAgil).
  const riskBadge = (level: InstitutionalRiskStudentRow['nivelRiesgo']) => {
    if (level === 'high') return 'bg-[#D32F2F] text-white';
    if (level === 'medium') return 'bg-[#FFC107] text-[#1A3C40]';
    return 'bg-[#2E7D32] text-white';
  };

  const handleExport = async (teacher: TeacherSummary) => {
    setExportingUid(teacher.uid);
    try {
      showToast('info', `Generando reporte de ${teacher.displayName}...`);
      const data = await adminGetTeacherData(teacher.uid, { turno, nivelEducativo });
      // El sufijo del archivo refleja los filtros activos (ej. matutino_secundaria).
      const suffix = [turno, nivelEducativo].filter(Boolean).join('_') || undefined;
      await exportTeacherDataToExcel(data, suffix);
      showToast('success', `Reporte de ${teacher.displayName} exportado.`);
    } catch (err: any) {
      console.error('adminGetTeacherData error:', err);
      showToast('error', err?.message || 'No se pudo exportar el reporte del docente.');
    } finally {
      setExportingUid(null);
    }
  };

  // Exportar la lista de estudiantes en riesgo a CSV (abre en Excel) con campos enriquecidos.
  const handleExportRisk = () => {
    if (!metrics || metrics.atRiskStudents.length === 0) return;
    const header = [
      'Estudiante',
      'Cédula',
      'Asignatura',
      'Docente',
      'Grado',
      'Sección',
      'Turno',
      'Nivel Educativo',
      'Asistencia (%)',
      'Nota (%)',
      'Nivel Riesgo',
      'Razones',
    ];
    const rows = metrics.atRiskStudents.map(r => [
      r.studentName,
      r.cedula ?? '',
      r.asignatura,
      r.docente,
      (r as any).grado || '—',
      (r as any).seccion || '—',
      r.periodo || '—',
      r.nivelEducativo || '—',
      r.asistencia === null ? '' : String(r.asistencia.toFixed(1)),
      r.nota === null ? '' : String(r.nota.toFixed(1)),
      r.nivelRiesgo === 'high' ? 'Alto' : r.nivelRiesgo === 'medium' ? 'Medio' : 'Bajo',
      r.razones?.join('; ') || '—',
    ]);
    const csv = [header, ...rows]
      .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const suffix = [turno, nivelEducativo].filter(Boolean).join('_') || 'todos';
    a.href = url;
    a.download = `estudiantes-en-riesgo_${suffix}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('success', 'Lista de estudiantes en riesgo exportada con campos enriquecidos.');
  };

  // Informe Institucional PDF: usa SOLO datos ya cargados en el panel (con los
  // filtros activos). El ranking de asignaturas se enriquece reutilizando el
  // loader existente adminGetInstitutionStats; si falla, la sección del PDF
  // degrada a promedio global + distribución sin romper la descarga.
  const handleExportInforme = async () => {
    if (!metrics) return;
    setReportGenerating(true);
    showToast('info', 'Generando informe PDF...');
    try {
      try {
        const stats = await adminGetInstitutionStats({ turno, nivelEducativo });
        setReportStats(stats.subjectStats || []);
      } catch {
        setReportStats(null);
      }
      // Deja pintar el contenedor off-screen con el ranking antes de capturarlo.
      await new Promise((r) => setTimeout(r, 150));
      // Misma sanitización que el respaldo institucional (SettingsModal).
      const safeInst =
        (institutionName || 'Institucion')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-zA-Z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'Institucion';
      const fecha = new Date().toISOString().slice(0, 10);
      await exportInstitutionalReport('admin-informe-report', `Informe-Institucional-${safeInst}-${fecha}.pdf`);
      showToast('success', 'Informe descargado correctamente.');
    } catch (err: any) {
      console.error('exportInstitutionalReport error:', err);
      showToast('error', err?.message || 'No se pudo generar el informe PDF.');
    } finally {
      setReportGenerating(false);
    }
  };

  // La lista ya viene filtrada por turno/nivel desde el backend; aquí solo se
  // aplica la búsqueda local por nombre/email.
  const filtered = teachers.filter(t => {
    const q = search.trim().toLowerCase();
    if (q && !(
      (t.displayName || '').toLowerCase().includes(q) ||
      (t.email || '').toLowerCase().includes(q)
    )) return false;
    return true;
  });

  const resumenTotals = teachers.reduce(
    (acc, t) => ({
      subjects: acc.subjects + (t.counts?.subjects || 0),
      students: acc.students + (t.counts?.students || 0),
      evaluations: acc.evaluations + (t.counts?.evaluations || 0),
    }),
    { subjects: 0, students: 0, evaluations: 0 },
  );

  const activeFilters = [turno, nivelEducativo].filter(Boolean) as string[];
  const filterLabel = (f: string) => TURNO_LABEL[f] || NIVEL_LABEL[f] || f;

  const handleOnboardingNavigate = (section: string) => {
    setShowOnboarding(false);
    if (section === 'teachers' || section === 'students') {
      setPedOpen(true);
      setPedSection(section);
    } else {
      setMetOpen(true);
      setMetSection(section === 'alerts' ? 'alerts' : section === 'boletin' ? 'discrepancias' : 'graficos');
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-8 md:p-12 max-w-5xl mx-auto w-full">
        <div className="bg-amber-50 border border-amber-200 rounded-[2rem] p-10 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-6" />
          <h2 className="text-2xl font-black text-neutral-900 mb-3">Acceso restringido</h2>
          <p className="text-neutral-500 font-medium">El panel institucional solo está disponible para administradores.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 md:p-12 max-w-7xl mx-auto w-full space-y-6">
      {/* ─── Cabecera ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-[#1A3C40] rounded-[1.25rem] flex items-center justify-center border border-[#1A3C40]/20 shadow-lg shadow-[#1A3C40]/20">
            <img
              src={schoolConfig.logoUrl || '/logo.webp'}
              alt="Logo institucional"
              className="app-logo w-8 h-8 object-contain"
              style={{ filter: 'none', backgroundColor: 'transparent' }}
            />
          </div>
          <div>
            <h2 className="text-4xl font-black text-[#1A3C40] tracking-tight">Panel Administrativo</h2>
            <p className="text-neutral-500 mt-1 font-medium">
              {institutionName ? `Institución: ${institutionName}` : 'Gestión institucional'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-white border border-neutral-200 rounded-2xl px-4 py-2.5 shadow-sm">
            <ShieldCheck className="w-4 h-4 text-[#2E7D32]" />
            <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Acceso de solo lectura</span>
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading || metricsLoading}
            title="Actualizar todo el panel"
            className="flex items-center gap-2 bg-[#1A3C40] hover:bg-[#2E7D32] disabled:opacity-50 text-white px-4 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95"
          >
            <RefreshCw className={`w-4 h-4 ${loading || metricsLoading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          <button
            onClick={handleExportInforme}
            disabled={reportGenerating || loading || metricsLoading || !metrics}
            title="Descargar el informe institucional en PDF"
            className="flex items-center gap-2 bg-[#1A3C40] hover:bg-[#2E7D32] disabled:opacity-50 text-white px-4 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-[#1A3C40]/20"
          >
            {reportGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4 text-[#FFC107]" />}
            Exportar Informe PDF
          </button>
          <button
            onClick={() => setShowOnboarding(true)}
            disabled={configLoading}
            title="Configurar institución (logo, ponderación, periodos, reglas)"
            className="flex items-center gap-2 bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-600 px-4 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            Mi institución
          </button>
        </div>
      </div>

      {/* Filtros activos (los controles viven en el sidebar, aquí el resumen) */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-neutral-500">
            <FilterIcon className="w-3.5 h-3.5" />
            Filtros activos:
          </span>
          {activeFilters.map(f => (
            <span key={f} className="inline-flex items-center gap-1 rounded-full bg-[#FFC107]/20 border border-[#FFC107]/50 text-[#1A3C40] text-[10px] font-black px-2.5 py-1">
              {filterLabel(f)}
            </span>
          ))}
        </div>
      )}

      {/* Banner de solo lectura */}
      <div className="flex items-center gap-2 bg-[#F0F7F4] border border-[#1A3C40]/10 rounded-2xl px-5 py-4 text-[#1A3C40] text-sm font-medium">
        <EyeOff className="w-5 h-5 shrink-0" />
        El administrador solo puede consultar y exportar datos. Está prohibido modificar asistencias y calificaciones de los docentes.
      </div>

      {/* ─── Resumen Hoy / Esta semana (NUEVO) ───────────────────────────── */}
      <AdminTodayWeek
        loading={metricsLoading}
        attendanceToday={kpi.attendance}
        classesToday={resumenTotals.subjects}
        alertsToday={kpi.alerts}
        attendanceTrend={trendLast7}
        weeklyAverage={kpi.grades}
        atRiskWeek={kpi.atRisk}
      />

      {/* ─── Métricas Clave (4 tarjetas, sin duplicar) ──────────────────── */}
      <AdminSummaryCards
        loading={metricsLoading}
        teacherCount={teachers.length}
        studentCount={resumenTotals.students}
        attendance={kpi.attendance}
        grades={kpi.grades}
      />

      {/* ─── Acordeón: Gestión Pedagógica ───────────────────────────────── */}
      <AdminAccordion
        title="Gestión Pedagógica"
        icon={<Users className="w-5 h-5" />}
        open={pedOpen}
        onOpenChange={setPedOpen}
        badge={teachers.length}
      >
        <div className="flex flex-wrap items-center gap-1 bg-white border border-[#1A3C40]/10 rounded-2xl p-1.5 shadow-sm w-fit mb-6">
          <button
            onClick={() => setPedSection('teachers')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
              pedSection === 'teachers'
                ? 'bg-[#1A3C40] text-white shadow-lg shadow-[#1A3C40]/20'
                : 'text-neutral-500 hover:bg-neutral-50'
            }`}
          >
            <Users className="w-4 h-4" />
            Docentes
          </button>
          <button
            onClick={() => setPedSection('students')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
              pedSection === 'students'
                ? 'bg-[#1A3C40] text-white shadow-lg shadow-[#1A3C40]/20'
                : 'text-neutral-500 hover:bg-neutral-50'
            }`}
          >
            <GraduationCap className="w-4 h-4" />
            Estudiantes
          </button>
        </div>

        {pedSection === 'students' ? (
          <AdminStudents turno={turno} nivelEducativo={nivelEducativo} />
        ) : selectedUid ? (
          <div className="space-y-4">
            <AdminTeacherDetail
              teacherUid={selectedUid}
              initialTab={detailTab}
              onClose={() => { setSelectedUid(''); setDetailTab('resumen'); }}
            />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Selección y búsqueda de docentes */}
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative md:w-80 shrink-0">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-[#1A3C40]" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Docentes activos</span>
                  <span className="bg-[#F0F7F4] text-[#1A3C40] text-[10px] font-black px-2.5 py-1 rounded-full">{teachers.length}</span>
                  <button
                    onClick={() => setInviteOpen(!inviteOpen)}
                    className="ml-auto inline-flex items-center gap-1.5 bg-[#1A3C40] hover:bg-[#2E7D32] text-white px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
                    title="Agregar un docente de tu institución"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    Invitar
                  </button>
                </div>
                {inviteOpen && (
                  <div className="mb-3 bg-white border border-neutral-200 rounded-2xl p-3 shadow-sm">
                    <p className="text-[11px] font-bold text-neutral-600 mb-2">
                      El docente debe tener una cuenta en EdiAgil (o crearla con este correo). Pasa a plan
                      institucional al instante, sin costo por su cuenta.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleInvite(); }}
                        placeholder="correo@docente.edu.ve"
                        className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl border border-neutral-200 text-sm font-bold text-neutral-900 outline-none focus:border-[#1A3C40] focus:ring-4 focus:ring-[#FFC107]/20 transition-all"
                      />
                      <button
                        onClick={handleInvite}
                        disabled={inviting}
                        className="inline-flex items-center gap-1.5 bg-[#1A3C40] hover:bg-[#2E7D32] disabled:opacity-50 text-white px-3.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
                      >
                        {inviting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        {inviting ? 'Enviando...' : 'Enviar'}
                      </button>
                    </div>
                  </div>
                )}
                <select
                  value={selectedUid}
                  onChange={(e) => setSelectedUid(e.target.value)}
                  disabled={loading}
                  className="appearance-none w-full bg-white border border-neutral-200 rounded-2xl pl-4 pr-12 py-3.5 text-sm font-bold text-neutral-900 outline-none focus:border-[#1A3C40] focus:ring-4 focus:ring-[#FFC107]/20 transition-all disabled:opacity-50 cursor-pointer"
                  aria-label="Seleccionar docente"
                >
                  <option value="">Selecciona un docente...</option>
                  {teachers.map(t => (
                    <option key={t.uid} value={t.uid}>{t.displayName} — {t.email}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400 pointer-events-none" />
              </div>
              {/* Buscador centrado horizontalmente (mx-auto) y con la lupa
                  alineada verticalmente al texto del input. */}
              <div className="relative flex-1 max-w-md mx-auto flex items-center">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar docente por nombre o email..."
                  className="w-full bg-white border border-neutral-200 rounded-2xl pl-12 pr-4 py-3.5 text-sm font-medium text-neutral-900 outline-none focus:border-[#1A3C40] focus:ring-4 focus:ring-[#FFC107]/20 transition-all"
                />
              </div>
            </div>

            {/* Tabla de docentes */}
            <div className="bg-white border border-neutral-200 rounded-[2rem] shadow-sm overflow-hidden">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-24">
                  <Loader2 className="w-10 h-10 text-[#1A3C40] animate-spin mb-4" />
                  <p className="text-sm font-bold text-neutral-500">Cargando docentes...</p>
                </div>
              ) : error ? (
                <div className="p-12 text-center">
                  <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-6" />
                  <p className="text-lg font-black text-neutral-900 mb-2">Error al cargar</p>
                  <p className="text-sm text-neutral-500 font-medium">{error}</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-12 text-center">
                  <Users className="w-12 h-12 text-neutral-200 mx-auto mb-6" />
                  <p className="text-lg font-black text-neutral-900 mb-2">
                    {search || turno || nivelEducativo ? 'Sin resultados' : 'No hay docentes aún'}
                  </p>
                  <p className="text-sm text-neutral-500 font-medium">
                    {search || turno || nivelEducativo
                      ? 'Prueba con otro nombre, email, turno o nivel educativo.'
                      : 'Los docentes de tu institución aparecerán aquí cuando activen sus cuentas.'}
                  </p>
                </div>
              ) : (
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-neutral-50 border-b border-neutral-100">
                      <th className="px-8 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">Docente</th>
                      <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">Plan</th>
                      <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-center">Asignaturas</th>
                      <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-center">Estud.</th>
                      <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-center">Eval.</th>
                      <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-center">Asist.</th>
                      <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">Incorporación</th>
                      <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">Última actividad</th>
                      <th className="px-8 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-right">Excel</th>
                      <th className="px-8 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-right">Detalle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-50">
                    {filtered.map(teacher => (
                      <tr
                        key={teacher.uid}
                        onClick={() => { setDetailTab('resumen'); setSelectedUid(teacher.uid); }}
                        className="hover:bg-neutral-50/60 transition-colors cursor-pointer"
                        title={`Entrar en el grupo de asignaturas de ${teacher.displayName}`}
                      >
                        <td className="px-8 py-5">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-[#F0F7F4] border border-[#1A3C40]/10 flex items-center justify-center text-[#1A3C40] font-black text-sm shrink-0">
                              {(teacher.displayName || '?').charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-black text-sm text-neutral-900 truncate">{teacher.displayName}</p>
                              <p className="text-xs text-neutral-400 font-medium truncate">{teacher.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-5">
                          <span className="text-[10px] font-black uppercase tracking-widest bg-neutral-100 text-neutral-600 px-3 py-1.5 rounded-full">
                            {planLabel(teacher.plan)}
                          </span>
                        </td>
                        <td className="px-4 py-5 text-center">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDetailTab('asignaturas'); setSelectedUid(teacher.uid); }}
                            title={`Ver asignaturas (activas e inactivas) de ${teacher.displayName}`}
                            className="inline-flex items-center gap-2 bg-[#1A3C40] hover:bg-[#2E7D32] text-white px-3.5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all active:scale-95 shadow-sm shadow-[#1A3C40]/20"
                          >
                            <BookOpen className="w-4 h-4" />
                            <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-[#FFC107] text-[#1A3C40] text-[10px] font-black">
                              {teacher.counts?.subjects ?? 0}
                            </span>
                            Asig.
                          </button>
                        </td>
                        <td className="px-4 py-5 text-center font-bold text-neutral-700">{teacher.counts?.students ?? 0}</td>
                        <td className="px-4 py-5 text-center font-bold text-neutral-700">{teacher.counts?.evaluations ?? 0}</td>
                        <td className="px-4 py-5 text-center font-bold text-neutral-700">{teacher.counts?.attendance ?? 0}</td>
                        <td className="px-4 py-5">
                          <span className="text-xs font-bold text-neutral-500">{formatActivity(teacher.createdAt as any)}</span>
                        </td>
                        <td className="px-4 py-5">
                          <span className="text-xs font-bold text-neutral-500">{formatActivity(teacher.lastActivity as any)}</span>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleExport(teacher); }}
                            disabled={exportingUid === teacher.uid}
                            title={`Exportar reporte Excel de ${teacher.displayName}`}
                            className="inline-flex items-center gap-2 bg-[#1A3C40] hover:bg-[#2E7D32] disabled:opacity-50 text-white px-4 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-[#1A3C40]/20"
                          >
                            {exportingUid === teacher.uid ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <FileSpreadsheet className="w-4 h-4" />
                            )}
                            {exportingUid === teacher.uid ? 'Exportando...' : 'Exportar'}
                          </button>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <button
                            onClick={(e) => { e.stopPropagation(); setDetailTab('resumen'); setSelectedUid(teacher.uid); }}
                            title={`Ver detalle de ${teacher.displayName}`}
                            className="inline-flex items-center gap-1 bg-white border border-neutral-200 hover:border-[#1A3C40]/40 hover:text-[#1A3C40] text-neutral-500 px-4 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
                          >
                            Ver
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </AdminAccordion>

      {/* ─── Acordeón: Estudiantes en Riesgo ─────────────────────────────── */}
      <AdminAccordion
        title="Estudiantes en Riesgo"
        icon={<ShieldAlert className="w-5 h-5" />}
        open={riskOpen}
        onOpenChange={setRiskOpen}
        badge={metrics && !metricsLoading ? kpi.atRisk : undefined}
      >
        <div className="bg-white border border-neutral-200 rounded-[2rem] shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 md:px-8 pt-6 pb-4">
            <div>
              <h3 className="text-base font-black text-neutral-900 tracking-tight">Estudiantes en riesgo</h3>
              <p className="text-xs text-neutral-500 font-medium mt-0.5">
                Alumnos con asistencia o notas en riesgo (nivel medio/alto) — clic en una fila para ver detalle y recomendaciones
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest bg-neutral-100 text-neutral-600 px-3 py-1.5 rounded-full">
                {metrics?.atRiskStudents.length ?? 0} fila{metrics?.atRiskStudents.length === 1 ? '' : 's'}
              </span>
              <button
                onClick={handleExportRisk}
                disabled={!metrics || metrics.atRiskStudents.length === 0}
                title="Exportar lista de estudiantes en riesgo (Excel/CSV)"
                className="inline-flex items-center gap-2 bg-[#1A3C40] hover:bg-[#2E7D32] disabled:opacity-50 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
              >
                <Download className="w-4 h-4" />
                Exportar
              </button>
            </div>
          </div>
          {metricsLoading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-10 h-10 text-[#1A3C40] animate-spin mb-4" />
              <p className="text-sm font-bold text-neutral-500">Cargando estudiantes en riesgo...</p>
            </div>
          ) : !metrics || metrics.atRiskStudents.length === 0 ? (
            <div className="p-12 text-center">
              <ShieldAlert className="w-12 h-12 text-[#2E7D32]/30 mx-auto mb-6" />
              <p className="text-lg font-black text-neutral-900 mb-2">Sin estudiantes en riesgo</p>
              <p className="text-sm text-neutral-500 font-medium">
                Con los filtros activos no hay alumnos con asistencia o notas en riesgo.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-neutral-50 border-y border-neutral-100">
                    <th className="px-6 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">Estudiante</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">Asignatura</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">Docente</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-center">Asistencia</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-center">Nota</th>
                    <th className="px-6 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-right">Riesgo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50">
                  {metrics.atRiskStudents.map((r, i) => (
                    <tr
                      key={`${r.studentId}-${r.asignatura}-${i}`}
                      onClick={() => setRiskDetailStudent(r.studentId)}
                      className="hover:bg-neutral-50/60 transition-colors cursor-pointer"
                      title={`Ver detalle y recomendaciones de ${r.studentName}`}
                    >
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-red-50 border border-red-100 flex items-center justify-center text-red-600 font-black text-xs shrink-0">
                            {r.studentName.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-black text-sm text-neutral-900 truncate">{r.studentName}</p>
                            {r.cedula ? <p className="text-xs text-neutral-400 font-medium">{r.cedula}</p> : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-sm font-bold text-neutral-700">{r.asignatura}</td>
                      <td className="px-4 py-3.5 text-sm font-bold text-neutral-500">{r.docente}</td>
                      <td className="px-4 py-3.5 text-center text-sm font-black text-neutral-700">
                        {r.asistencia === null ? '—' : `${r.asistencia}%`}
                      </td>
                      <td className="px-4 py-3.5 text-center text-sm font-black text-neutral-700">
                        {r.nota === null ? '—' : `${r.nota}%`}
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${riskBadge(r.nivelRiesgo)}`}>
                          {r.nivelRiesgo === 'high' ? 'Alto' : r.nivelRiesgo === 'medium' ? 'Medio' : 'Bajo'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </AdminAccordion>

      {/* ─── Acordeón: Métricas Institucionales ──────────────────────────── */}
      <AdminAccordion
        title="Métricas Institucionales"
        icon={<BarChart3 className="w-5 h-5" />}
        open={metOpen}
        onOpenChange={setMetOpen}
        badge={kpi.alerts > 0 ? kpi.alerts : undefined}
      >
        <div className="flex flex-wrap items-center gap-1 bg-white border border-[#1A3C40]/10 rounded-2xl p-1.5 shadow-sm w-fit mb-6">
          <button
            onClick={() => setMetSection('alerts')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
              metSection === 'alerts'
                ? 'bg-red-600 text-white shadow-lg shadow-red-500/20'
                : 'text-neutral-500 hover:bg-neutral-50'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            Alertas de riesgo
          </button>
          <button
            onClick={() => setMetSection('discrepancias')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
              metSection === 'discrepancias'
                ? 'bg-[#1A3C40] text-white shadow-lg shadow-[#1A3C40]/20'
                : 'text-neutral-500 hover:bg-neutral-50'
            }`}
          >
            <FileSearch className="w-4 h-4" />
            Discrepancias
          </button>
          <button
            onClick={() => setMetSection('graficos')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
              metSection === 'graficos'
                ? 'bg-[#1A3C40] text-white shadow-lg shadow-[#1A3C40]/20'
                : 'text-neutral-500 hover:bg-neutral-50'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Gráficos
          </button>
        </div>

        {metSection === 'alerts' ? (
          <AdminAlerts turno={turno} nivelEducativo={nivelEducativo} />
        ) : metSection === 'discrepancias' ? (
          <AdminStudentSearch />
        ) : (
          <div className="space-y-6">
            {/* Tendencias y Distribución (Sprint 4) */}
            {!metricsLoading && metrics && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm lg:col-span-2">
                  <h3 className="text-base font-black text-neutral-900 tracking-tight mb-6">Tendencias (Asistencia y Notas)</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={metrics.trends?.attendance.map((t, i) => ({ date: t.date, Asistencia: t.value, Nota: metrics.trends?.grades[i]?.value || 0 })) || []}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                        <XAxis dataKey="date" tick={{ fill: '#9CA3AF', fontSize: 12, fontWeight: 600 }} tickLine={false} axisLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fill: '#9CA3AF', fontSize: 12, fontWeight: 600 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                        <Tooltip contentStyle={{ borderRadius: '1rem', border: '1px solid #E5E7EB', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontWeight: 700 }} />
                        <Legend wrapperStyle={{ fontSize: '12px', fontWeight: 600 }} />
                        <Line type="monotone" dataKey="Asistencia" stroke="#1A3C40" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6, strokeWidth: 0 }} />
                        <Line type="monotone" dataKey="Nota" stroke="#2E7D32" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6, strokeWidth: 0 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm">
                  <h3 className="text-base font-black text-neutral-900 tracking-tight mb-6">Distribución por Turno</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={Object.entries(metrics.distribution?.byTurno || {}).map(([name, value]) => ({ name, value }))}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                        <XAxis dataKey="name" tick={{ fill: '#9CA3AF', fontSize: 12, fontWeight: 600 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fill: '#9CA3AF', fontSize: 12, fontWeight: 600 }} tickLine={false} axisLine={false} />
                        <Tooltip cursor={{ fill: '#F3F4F6' }} contentStyle={{ borderRadius: '1rem', border: '1px solid #E5E7EB', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontWeight: 700 }} />
                        <Bar dataKey="value" fill="#FFC107" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
            {/* Estadísticas institucionales (Sprint 3) */}
            <AdminInstitutionStats turno={turno} nivelEducativo={nivelEducativo} />
          </div>
        )}
      </AdminAccordion>

      {/* Informe Institucional PDF: contenedor A4 off-screen que captura
          exportInstitutionalReport (html2canvas no lee display:none). */}
      <div aria-hidden="true" style={{ position: 'fixed', left: '-10000px', top: 0 }}>
        <AdminInformeReport
          metrics={metrics}
          alerts={alertsData}
          teachers={teachers}
          totals={resumenTotals}
          schoolConfig={schoolConfig}
          institutionName={institutionName}
          turno={turno}
          nivelEducativo={nivelEducativo}
          statsSubjects={reportStats}
        />
      </div>

      {/* Onboarding institucional (post-login y botón "Mi institución") */}
      <AdminOnboarding
        open={showOnboarding}
        initialName={institutionName || ''}
        initialConfig={schoolConfig}
        initialGradingWeight={gradingWeight}
        initialPeriodos={periodos}
        initialPlanRules={planRules}
        institutionId={institutionId}
        onClose={() => setShowOnboarding(false)}
        onNavigate={handleOnboardingNavigate}
        onSaved={handleOnboardingSaved}
      />

      {/* Sprint 2: detalle del estudiante en riesgo (modal con recomendaciones) */}
      {riskDetailStudent && (
        <StudentDetailView studentId={riskDetailStudent} onClose={() => setRiskDetailStudent(null)} />
      )}
    </div>
  );
}