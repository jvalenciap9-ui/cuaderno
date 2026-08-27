import { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  CalendarX2,
  Users,
  BookOpen,
  Siren,
  GraduationCap,
  UserX,
  CheckCircle2,
  Lightbulb,
} from 'lucide-react';
import {
  adminGetInstitutionAlerts,
  adminGenerateInstitutionInsights,
  type AdminInstitutionAlertsResponse,
  type InstitutionAlert,
  type InstitutionAlertType,
  type AdminGenerateInstitutionInsightsResponse,
} from '../lib/adminApi';
import { cn } from '../lib/utils';
import { NIVEL_LABEL, type TurnoFiltro, type NivelFiltro } from '../lib/dashboardFilters';

interface AdminAlertsProps {
  turno?: TurnoFiltro;
  nivelEducativo?: NivelFiltro;
}

const PERIODO_LABEL: Record<string, string> = {
  matutino: 'Matutino',
  vespertino: 'Vespertino',
  nocturno: 'Nocturno',
};

const TYPE_LABEL: Record<InstitutionAlertType, string> = {
  student_grades: 'Notas del estudiante',
  student_attendance: 'Asistencia del estudiante',
  group_grades: 'Notas del grupo',
  group_attendance: 'Asistencia del grupo',
  teacher_inactive: 'Docente inactivo',
};

const TYPE_ICON: Record<InstitutionAlertType, React.ReactNode> = {
  student_grades: <GraduationCap className="w-5 h-5" />,
  student_attendance: <CalendarX2 className="w-5 h-5" />,
  group_grades: <TrendingDown className="w-5 h-5" />,
  group_attendance: <Users className="w-5 h-5" />,
  teacher_inactive: <UserX className="w-5 h-5" />,
};

const SEVERITY_STYLES = {
  critical: {
    border: 'border-red-200 bg-red-50/60',
    icon: 'bg-red-100 text-red-600 border-red-200',
    badge: 'bg-red-600 text-white',
    dot: 'bg-red-500',
  },
  warning: {
    border: 'border-amber-200 bg-amber-50/60',
    icon: 'bg-amber-100 text-amber-600 border-amber-200',
    badge: 'bg-amber-500 text-white',
    dot: 'bg-amber-500',
  },
};

const formatPct = (v: number | null): string => (v === null ? '—' : `${v}%`);

export function AdminAlerts({ turno = '', nivelEducativo = '' }: AdminAlertsProps) {
  const [data, setData] = useState<AdminInstitutionAlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'critical' | InstitutionAlertType>('all');

  const [insights, setInsights] = useState<AdminGenerateInstitutionInsightsResponse | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [insightsError, setInsightsError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminGetInstitutionAlerts({ turno, nivelEducativo });
      setData(res);
    } catch (err: any) {
      console.error('adminGetInstitutionAlerts error:', err);
      setError(err?.message || 'No se pudieron cargar las alertas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turno, nivelEducativo]);

  const generateInsights = async () => {
    setLoadingInsights(true);
    setInsightsError('');
    setInsights(null);
    try {
      const res = await adminGenerateInstitutionInsights({ turno, nivelEducativo });
      setInsights(res);
    } catch (err: any) {
      console.error('adminGenerateInstitutionInsights error:', err);
      setInsightsError(err?.message || 'No se pudo generar el análisis institucional.');
    } finally {
      setLoadingInsights(false);
    }
  };

  const filteredAlerts = useMemo(() => {
    const alerts = data?.alerts || [];
    if (filter === 'all') return alerts;
    if (filter === 'critical') return alerts.filter((a) => a.severity === 'critical');
    return alerts.filter((a) => a.type === filter);
  }, [data, filter]);

  const filterCounts = useMemo(() => {
    const alerts = data?.alerts || [];
    const byType: Record<string, number> = {};
    for (const a of alerts) byType[a.type] = (byType[a.type] || 0) + 1;
    return { total: alerts.length, critical: alerts.filter((a) => a.severity === 'critical').length, byType };
  }, [data]);

  if (loading) {
    return (
      <div className="bg-white border border-neutral-200 rounded-[2rem] shadow-sm">
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
          <p className="text-sm font-bold text-neutral-500">Analizando riesgos institucionales...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-neutral-200 rounded-[2rem] p-12 text-center shadow-sm">
        <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-6" />
        <p className="text-lg font-black text-neutral-900 mb-2">Error al cargar las alertas</p>
        <p className="text-sm text-neutral-500 font-medium">{error}</p>
        <button
          onClick={load}
          className="mt-6 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95"
        >
          <RefreshCw className="w-4 h-4" />
          Reintentar
        </button>
      </div>
    );
  }

  const summary = data?.summary;
  const noData = (data?.alerts?.length || 0) === 0 && (data?.summary?.total || 0) === 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center border border-red-100">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-black text-neutral-900 tracking-tight">Alertas de riesgo</h3>
            <p className="text-xs text-neutral-500 font-medium mt-0.5">
              {data?.institutionName ? `Institución: ${data.institutionName}` : 'Caídas críticas en notas y asistencia'}
            </p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-600 px-4 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {noData ? (
        <div className="bg-white border border-neutral-200 rounded-[2rem] p-12 text-center shadow-sm">
          <CheckCircle2 className="w-12 h-12 text-emerald-300 mx-auto mb-6" />
          <p className="text-lg font-black text-neutral-900 mb-2">Sin alertas de riesgo</p>
          <p className="text-sm text-neutral-500 font-medium">
            {turno || nivelEducativo
              ? 'No hay alertas dentro del turno y nivel educativo seleccionados.'
              : 'Cuando un estudiante o grupo presente caídas críticas en asistencia o calificaciones, aparecerá aquí.'}
          </p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">Alertas totales</p>
                <Siren className="w-5 h-5 text-red-500" />
              </div>
              <p className="text-4xl font-black text-neutral-900 leading-none mt-2">{summary?.total ?? 0}</p>
              <p className="text-xs text-neutral-400 font-medium mt-2">Notas, asistencia e inactividad</p>
            </div>
            <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">Críticas</p>
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <p className="text-4xl font-black text-neutral-900 leading-none mt-2">{summary?.critical ?? 0}</p>
              <p className="text-xs text-neutral-400 font-medium mt-2">Requieren atención inmediata</p>
            </div>
            <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">Estudiantes en riesgo</p>
                <GraduationCap className="w-5 h-5 text-amber-500" />
              </div>
              <p className="text-4xl font-black text-neutral-900 leading-none mt-2">{summary?.studentsAtRisk ?? 0}</p>
              <p className="text-xs text-neutral-400 font-medium mt-2">Consolidados por cédula</p>
            </div>
            <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">Grupos en riesgo</p>
                <BookOpen className="w-5 h-5 text-indigo-500" />
              </div>
              <p className="text-4xl font-black text-neutral-900 leading-none mt-2">{summary?.groupsAtRisk ?? 0}</p>
              <p className="text-xs text-neutral-400 font-medium mt-2">Asignatura + docente</p>
            </div>
          </div>

          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setFilter('all')}
              className={cn(
                'px-4 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 border',
                filter === 'all'
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'bg-white text-neutral-500 border-neutral-200 hover:bg-neutral-50'
              )}
            >
              Todas ({filterCounts.total})
            </button>
            <button
              onClick={() => setFilter('critical')}
              className={cn(
                'px-4 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 border',
                filter === 'critical'
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-white text-red-500 border-red-200 hover:bg-red-50'
              )}
            >
              Críticas ({filterCounts.critical})
            </button>
            {(Object.keys(TYPE_LABEL) as InstitutionAlertType[]).map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={cn(
                  'px-4 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 border',
                  filter === t
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-neutral-500 border-neutral-200 hover:bg-neutral-50'
                )}
              >
                {TYPE_LABEL[t]} ({filterCounts.byType[t] || 0})
              </button>
            ))}
          </div>

          {/* Listado de alertas */}
          {filteredAlerts.length === 0 ? (
            <div className="bg-white border border-neutral-200 rounded-[2rem] p-10 text-center shadow-sm">
              <CheckCircle2 className="w-10 h-10 text-emerald-300 mx-auto mb-4" />
              <p className="text-sm font-black text-neutral-700">Sin resultados para este filtro</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAlerts.map((a: InstitutionAlert) => {
                const s = SEVERITY_STYLES[a.severity];
                return (
                  <div key={a.id} className={cn('bg-white border rounded-[2rem] p-6 shadow-sm', s.border)}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div className={cn('w-11 h-11 rounded-2xl flex items-center justify-center border shrink-0', s.icon)}>
                          {TYPE_ICON[a.type]}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn('text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full', s.badge)}>
                              {a.severity === 'critical' ? 'Crítica' : 'Advertencia'}
                            </span>
                            <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400">
                              {TYPE_LABEL[a.type]}
                            </span>
                          </div>
                          <p className="text-sm font-bold text-neutral-900 mt-2">
                            {a.studentName ? (
                              <>
                                {a.studentName}
                                {a.cedula ? <span className="text-neutral-400 font-medium"> · Cédula: {a.cedula}</span> : null}
                              </>
                            ) : a.subjectName ? (
                              <>
                                {a.subjectName}
                                <span className="text-neutral-400 font-medium"> · {a.teacherName}</span>
                              </>
                            ) : (
                              'Supervisión'
                            )}
                          </p>
                          <p className="text-sm text-neutral-500 font-medium mt-1">{a.message}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {a.avgPct !== null && (
                          <span className={cn('text-[10px] font-black uppercase tracking-widest px-3.5 py-1.5 rounded-full border', a.avgPct < 60 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-amber-50 text-amber-600 border-amber-100')}>
                            Notas: {formatPct(a.avgPct)}
                          </span>
                        )}
                        {a.attendancePct !== null && (
                          <span className={cn('text-[10px] font-black uppercase tracking-widest px-3.5 py-1.5 rounded-full border', a.attendancePct < 70 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-amber-50 text-amber-600 border-amber-100')}>
                            Asistencia: {formatPct(a.attendancePct)}
                          </span>
                        )}
                        {a.periodo ? (
                          <span className="text-[10px] font-black uppercase tracking-widest bg-neutral-100 text-neutral-500 px-3.5 py-1.5 rounded-full">
                            {PERIODO_LABEL[a.periodo] || a.periodo}
                          </span>
                        ) : null}
                        {a.nivelEducativo ? (
                          <span className="text-[10px] font-black uppercase tracking-widest bg-neutral-100 text-neutral-500 px-3.5 py-1.5 rounded-full">
                            {NIVEL_LABEL[a.nivelEducativo] || a.nivelEducativo}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Inteligencia institucional con IA */}
      <div className="bg-white border border-neutral-200 rounded-[2rem] shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 px-8 pt-7 pb-5 border-b border-neutral-100">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-base font-black text-neutral-900 tracking-tight">Inteligencia institucional</h4>
              <p className="text-xs text-neutral-400 font-medium mt-0.5">
                Detección de patrones de rendimiento con Gemini — a nivel directivo, sin microgestionar docentes
              </p>
            </div>
          </div>
          <button
            onClick={generateInsights}
            disabled={loadingInsights}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95"
          >
            {loadingInsights ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loadingInsights ? 'Analizando...' : insights ? 'Regenerar análisis' : 'Analizar institución'}
          </button>
        </div>

        <div className="px-8 py-6">
          {insightsError && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-2xl px-5 py-4">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-black text-red-700">No se pudo generar el análisis</p>
                <p className="text-sm text-red-500 font-medium mt-0.5">{insightsError}</p>
              </div>
            </div>
          )}

          {!insights && !loadingInsights && !insightsError && (
            <p className="text-sm text-neutral-400 font-medium">
              Genera un análisis de patrones institucionales: tendencias de notas, problemas sistémicos de asistencia,
              asignaturas consistentemente débiles y recomendaciones accionables para la dirección.
            </p>
          )}

          {loadingInsights && (
            <div className="flex items-center gap-4 py-4">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
              <div>
                <p className="text-sm font-black text-neutral-900">Consultando a Gemini...</p>
                <p className="text-xs text-neutral-400 font-medium mt-0.5">Analizando datos agregados de la institución y sus alertas de riesgo.</p>
              </div>
            </div>
          )}

          {insights && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest bg-neutral-100 text-neutral-500 px-3.5 py-1.5 rounded-full">
                  {insights.stats.teachersWithData} docentes con datos
                </span>
                <span className="text-[10px] font-black uppercase tracking-widest bg-neutral-100 text-neutral-500 px-3.5 py-1.5 rounded-full">
                  Promedio general: {formatPct(insights.stats.avgPct)}
                </span>
                <span className="text-[10px] font-black uppercase tracking-widest bg-neutral-100 text-neutral-500 px-3.5 py-1.5 rounded-full">
                  Asistencia: {formatPct(insights.stats.attendancePct)}
                </span>
                <span className="text-[10px] font-black uppercase tracking-widest bg-neutral-100 text-neutral-500 px-3.5 py-1.5 rounded-full">
                  {insights.stats.alertsCount} alertas consideradas
                </span>
              </div>

              {insights.insights.resumen && (
                <div className="bg-indigo-50/70 border border-indigo-100 rounded-2xl p-5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600 mb-2">Resumen ejecutivo</p>
                  <p className="text-sm font-medium text-neutral-700 leading-relaxed">{insights.insights.resumen}</p>
                </div>
              )}

              {insights.insights.patrones.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingDown className="w-4 h-4 text-amber-500" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Patrones detectados</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {insights.insights.patrones.map((p, i) => (
                      <div key={i} className="rounded-2xl bg-amber-50/60 border border-amber-100 px-5 py-4">
                        <p className="text-sm font-black text-neutral-900">{p.titulo}</p>
                        <p className="text-sm text-neutral-500 font-medium mt-1">{p.detalle}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {insights.insights.recomendaciones.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb className="w-4 h-4 text-indigo-500" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Recomendaciones de dirección</span>
                  </div>
                  <ul className="space-y-2">
                    {insights.insights.recomendaciones.map((r, i) => (
                      <li key={i} className="flex items-start gap-3 rounded-2xl bg-indigo-50/70 border border-indigo-100 px-5 py-4">
                        <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-sm font-medium text-neutral-700">{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}