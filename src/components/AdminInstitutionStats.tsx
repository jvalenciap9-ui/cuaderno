import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Users,
  TrendingUp,
  CalendarDays,
  Sparkles,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Activity,
  CheckCircle2,
  GraduationCap,
} from 'lucide-react';
import { adminGetInstitutionStats, type InstitutionStats } from '../lib/adminApi';
import type { TurnoFiltro, NivelFiltro } from '../lib/dashboardFilters';

interface AdminInstitutionStatsProps {
  turno?: TurnoFiltro;
  nivelEducativo?: NivelFiltro;
}

const formatDate = (ts: number | null): string => {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatPct = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return '—';
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
};

const planLabel = (plan: string): string => {
  if (plan === 'school') return 'Institucional';
  if (plan === 'pro') return 'Premium Pro';
  return 'Gratis';
};

const PLAN_COLORS: Record<string, string> = {
  free: '#a3a3a3',
  pro: '#3b82f6',
  school: '#4f46e5',
};

const ATTENDANCE_COLORS = {
  passed: '#10b981',
  late: '#f59e0b',
  absent: '#ef4444',
};

const gradeColor = (avg: number): string => (avg >= 71 ? '#10b981' : avg >= 60 ? '#f59e0b' : '#ef4444');

const DashCard = ({
  title,
  subtitle,
  icon,
  iconClass,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  iconClass: string;
  children: React.ReactNode;
}) => (
  <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 md:p-8 shadow-sm">
    <div className="flex items-center gap-4 mb-6">
      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center border ${iconClass}`}>{icon}</div>
      <div>
        <h3 className="text-base font-black text-neutral-900 tracking-tight">{title}</h3>
        <p className="text-xs text-neutral-500 font-medium mt-0.5">{subtitle}</p>
      </div>
    </div>
    {children}
  </div>
);

const DarkTooltip = ({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string; color?: string }>;
}) => (
  <div className="bg-neutral-900 text-white p-4 rounded-2xl shadow-xl border border-neutral-800 min-w-[170px]">
    <p className="font-black text-sm mb-2">{title}</p>
    <div className="space-y-1">
      {rows.map((r) => (
        <p key={r.label} className="text-xs font-semibold flex items-center justify-between gap-6">
          <span className="flex items-center gap-2 text-neutral-400">
            {r.color && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />}
            {r.label}
          </span>
          <span className="text-white font-bold">{r.value}</span>
        </p>
      ))}
    </div>
  </div>
);

const EmptyNote = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm text-neutral-400 font-medium py-10 text-center">{children}</p>
);

export function AdminInstitutionStats({ turno = '', nivelEducativo = '' }: AdminInstitutionStatsProps) {
  const [stats, setStats] = useState<InstitutionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminGetInstitutionStats({ turno, nivelEducativo });
      setStats(res);
    } catch (err: any) {
      console.error('adminGetInstitutionStats error:', err);
      setError(err?.message || 'No se pudieron cargar las métricas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turno, nivelEducativo]);

  const planData = useMemo(() => {
    if (!stats) return [];
    return (['free', 'pro', 'school'] as const)
      .map((k) => ({ name: planLabel(k), value: stats.byPlan[k], color: PLAN_COLORS[k] }))
      .filter((p) => p.value > 0);
  }, [stats]);
  const planTotal = planData.reduce((acc, p) => acc + p.value, 0);

  const activityData = useMemo(
    () =>
      (stats?.weeklyActivity || []).map((w) => ({
        ...w,
        label: `${w.week.slice(8, 10)}/${w.week.slice(5, 7)}`,
      })),
    [stats],
  );

  const gradeData = useMemo(
    () =>
      (stats?.subjectStats || [])
        .filter((s) => s.avgPct !== null)
        .slice()
        .sort((a, b) => (b.avgPct ?? 0) - (a.avgPct ?? 0))
        .slice(0, 10)
        .map((s, i) => ({
          name: `${s.subjectName} · ${s.teacherName}`,
          avgPct: s.avgPct as number,
          students: s.students,
          teacherName: s.teacherName,
          idx: i,
        })),
    [stats],
  );

  const attendanceData = useMemo(
    () =>
      (stats?.subjectStats || [])
        .filter((s) => s.attendanceTotal > 0)
        .slice()
        .sort((a, b) => b.attendanceTotal - a.attendanceTotal)
        .slice(0, 10)
        .map((s) => ({
          name: `${s.subjectName} · ${s.teacherName}`,
          Presentes: s.attendancePresent,
          Atrasos: s.attendanceLate,
          Ausencias: s.attendanceAbsent,
          rate: s.attendanceRate,
        })),
    [stats],
  );

  if (loading) {
    return (
      <div className="bg-white border border-neutral-200 rounded-[2rem] shadow-sm">
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
          <p className="text-sm font-bold text-neutral-500">Calculando métricas institucionales...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-neutral-200 rounded-[2rem] p-12 text-center shadow-sm">
        <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-6" />
        <p className="text-lg font-black text-neutral-900 mb-2">Error al cargar las métricas</p>
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

  if (!stats) return null;

  if (stats.totals.teachers === 0) {
    return (
      <div className="bg-white border border-neutral-200 rounded-[2rem] p-12 text-center shadow-sm">
        <Activity className="w-12 h-12 text-neutral-200 mx-auto mb-6" />
        <p className="text-lg font-black text-neutral-900 mb-2">Aún no hay métricas</p>
        <p className="text-sm text-neutral-500 font-medium">
          {turno || nivelEducativo
            ? 'Ninguna asignatura de tu institución coincide con los filtros activos. Ajusta el turno o el nivel educativo.'
            : 'Cuando los docentes de tu institución registren actividad, aquí aparecerán las estadísticas globales.'}
        </p>
      </div>
    );
  }

  const attendance = stats.attendance;
  const rateBadge =
    attendance.passRate >= 80
      ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
      : attendance.passRate >= 70
        ? 'bg-amber-50 text-amber-600 border-amber-100'
        : 'bg-red-50 text-red-600 border-red-100';
  const rateLabel = attendance.passRate >= 80 ? 'Aprobado' : attendance.passRate >= 70 ? 'Advertencia' : 'Bajo';

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-xs text-neutral-400 font-semibold">
          Actualizado{' '}
          {new Date(stats.generatedAt).toLocaleString('es-ES', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {(turno || nivelEducativo) ? ' · métricas filtradas por turno/nivel' : ''}
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-600 px-4 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">Asistencia promedio</p>
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          </div>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <p className="text-4xl font-black text-neutral-900 leading-none">{formatPct(attendance.passRate)}</p>
            <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border ${rateBadge}`}>
              {rateLabel}
            </span>
          </div>
          <p className="text-xs text-neutral-400 font-medium mt-2">
            {attendance.present} presentes · {attendance.late} atrasos · {attendance.absent} ausencias
          </p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">Promedio de notas</p>
            <TrendingUp className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-4xl font-black text-neutral-900 leading-none mt-2">{formatPct(stats.grades.avgPct)}</p>
          <p className="text-xs text-neutral-400 font-medium mt-2">
            {stats.grades.count} notas registradas (escala 0-100)
          </p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">Sesiones de clase</p>
            <CalendarDays className="w-5 h-5 text-indigo-500" />
          </div>
          <p className="text-4xl font-black text-neutral-900 leading-none mt-2">{stats.totals.sessions}</p>
          <p className="text-xs text-neutral-400 font-medium mt-2">{stats.totals.attendanceCount} marcaciones</p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">Uso IA del mes</p>
            <Sparkles className="w-5 h-5 text-purple-500" />
          </div>
          <p className="text-4xl font-black text-neutral-900 leading-none mt-2">{stats.aiUsage.callsThisMonth}</p>
          <p className="text-xs text-neutral-400 font-medium mt-2">
            {stats.aiUsage.teachersWithUsage} de {stats.totals.teachers} docentes con uso
          </p>
        </div>
      </div>

      {/* Planes + Actividad semanal */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DashCard
          title="Composición de planes"
          subtitle={`${stats.totals.teachers} docentes en la institución`}
          icon={<GraduationCap className="w-5 h-5 text-indigo-600" />}
          iconClass="bg-indigo-50 border-indigo-100 text-indigo-600"
        >
          {planTotal === 0 ? (
            <EmptyNote>Sin docentes con plan registrado.</EmptyNote>
          ) : (
            <div className="relative h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={planData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={58}
                    outerRadius={82}
                    paddingAngle={3}
                    strokeWidth={2}
                    stroke="#fff"
                  >
                    {planData.map((p) => (
                      <Cell key={p.name} fill={p.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) =>
                      active && payload?.length ? (
                        <DarkTooltip title={String(payload[0].name)} rows={[{ label: 'Docentes', value: String(payload[0].value) }]} />
                      ) : null
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-3xl font-black text-neutral-900 leading-none">{stats.totals.teachers}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mt-1">Docentes</p>
              </div>
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-4">
            {planData.map((p) => (
              <span key={p.name} className="flex items-center gap-2 text-xs font-bold text-neutral-600">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                {p.name} <span className="text-neutral-400">({p.value})</span>
              </span>
            ))}
          </div>
        </DashCard>

        <DashCard
          title="Actividad por semana"
          subtitle="Sesiones y evaluaciones · últimas 8 semanas"
          icon={<Activity className="w-5 h-5 text-emerald-600" />}
          iconClass="bg-emerald-50 border-emerald-100 text-emerald-600"
        >
          <div style={{ height: 240, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradSessions" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradEvals" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f5" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#a3a3a3', fontSize: 11, fontWeight: 600 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#a3a3a3', fontSize: 11, fontWeight: 600 }} allowDecimals={false} />
                <Tooltip
                  cursor={{ stroke: '#e5e5e5' }}
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <DarkTooltip
                        title={`Semana ${String(label)}`}
                        rows={[
                          { label: 'Sesiones', value: String(payload[0].value), color: '#6366f1' },
                          { label: 'Evaluaciones', value: String(payload[1]?.value ?? 0), color: '#a855f7' },
                        ]}
                      />
                    ) : null
                  }
                />
                <Area type="monotone" dataKey="sessions" name="Sesiones" stroke="#6366f1" strokeWidth={2.5} fill="url(#gradSessions)" dot={false} />
                <Area type="monotone" dataKey="evaluations" name="Evaluaciones" stroke="#a855f7" strokeWidth={2.5} fill="url(#gradEvals)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="text-center text-[10px] font-black uppercase tracking-widest text-neutral-300 mt-2">
            Notas · Materiales · Eventos incluidos en el conteo semanal
          </p>
        </DashCard>
      </div>

      {/* Rendimiento y asistencia por asignatura */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DashCard
          title="Rendimiento por asignatura"
          subtitle="Promedio normalizado (0-100) · top 10"
          icon={<TrendingUp className="w-5 h-5 text-blue-600" />}
          iconClass="bg-blue-50 border-blue-100 text-blue-600"
        >
          {gradeData.length === 0 ? (
            <EmptyNote>Aún no hay notas registradas.</EmptyNote>
          ) : (
            <div style={{ height: 280, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={gradeData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f5f5f5" />
                  <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#a3a3a3', fontSize: 11, fontWeight: 600 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={150}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#525252', fontSize: 11, fontWeight: 700 }}
                    tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
                  />
                  <Tooltip
                    cursor={{ fill: '#f5f5f5' }}
                    content={({ active, payload }) =>
                      active && payload?.length ? (
                        <DarkTooltip
                          title={String(payload[0].payload.name)}
                          rows={[
                            { label: 'Nota promedio', value: formatPct(payload[0].value as number), color: '#3b82f6' },
                            { label: 'Estudiantes', value: String(payload[0].payload.students), color: '#6366f1' },
                          ]}
                        />
                      ) : null
                    }
                  />
                  <Bar dataKey="avgPct" radius={[0, 6, 6, 0]} barSize={14}>
                    {gradeData.map((g) => (
                      <Cell key={g.idx} fill={gradeColor(g.avgPct)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </DashCard>

        <DashCard
          title="Asistencia por asignatura"
          subtitle="Presentes, atrasos y ausencias · top 10"
          icon={<CalendarDays className="w-5 h-5 text-emerald-600" />}
          iconClass="bg-emerald-50 border-emerald-100 text-emerald-600"
        >
          {attendanceData.length === 0 ? (
            <EmptyNote>Aún no hay asistencia registrada.</EmptyNote>
          ) : (
            <div style={{ height: 280, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={attendanceData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f5f5f5" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#a3a3a3', fontSize: 11, fontWeight: 600 }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={150}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#525252', fontSize: 11, fontWeight: 700 }}
                    tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
                  />
                  <Tooltip
                    cursor={{ fill: '#f5f5f5' }}
                    content={({ active, payload }) =>
                      active && payload?.length ? (
                        <DarkTooltip
                          title={String(payload[0].payload.name)}
                          rows={[
                            { label: 'Presentes', value: String(payload[0].value), color: ATTENDANCE_COLORS.passed },
                            { label: 'Atrasos', value: String(payload[1]?.value ?? 0), color: ATTENDANCE_COLORS.late },
                            { label: 'Ausencias', value: String(payload[2]?.value ?? 0), color: ATTENDANCE_COLORS.absent },
                            { label: 'Tasa presente', value: formatPct(payload[0].payload.rate), color: '#ffffff' },
                          ]}
                        />
                      ) : null
                    }
                  />
                  <Bar dataKey="Presentes" stackId="att" fill={ATTENDANCE_COLORS.passed} radius={[0, 0, 0, 0]} barSize={16} />
                  <Bar dataKey="Atrasos" stackId="att" fill={ATTENDANCE_COLORS.late} barSize={16} />
                  <Bar dataKey="Ausencias" stackId="att" fill={ATTENDANCE_COLORS.absent} radius={[0, 6, 6, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-4">
            <span className="flex items-center gap-2 text-xs font-bold text-neutral-600">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Presentes
            </span>
            <span className="flex items-center gap-2 text-xs font-bold text-neutral-600">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Atrasos
            </span>
            <span className="flex items-center gap-2 text-xs font-bold text-neutral-600">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Ausencias
            </span>
          </div>
        </DashCard>
      </div>

      {/* Docentes por actividad */}
      <div className="bg-white border border-neutral-200 rounded-[2rem] shadow-sm overflow-hidden">
        <div className="flex items-center gap-4 px-6 md:px-8 pt-6">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center border bg-blue-50 border-blue-100 text-blue-600">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-black text-neutral-900 tracking-tight">Docentes por actividad</h3>
            <p className="text-xs text-neutral-500 font-medium mt-0.5">Última conexión y volumen de trabajo</p>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-100">
                <th className="px-8 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">Docente</th>
                <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">Plan</th>
                <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-center">Asig.</th>
                <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-center">Estud.</th>
                <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-center">Notas</th>
                <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-center">IA mes</th>
                <th className="px-8 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-right">Actividad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {stats.teachers.slice(0, 8).map((t) => (
                <tr key={t.uid} className="hover:bg-neutral-50/60 transition-colors">
                  <td className="px-8 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 font-black text-sm shrink-0">
                        {t.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-black text-sm text-neutral-900 truncate">{t.displayName}</p>
                        <p className="text-xs text-neutral-400 font-medium truncate">{formatDate(t.lastActivity)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="text-[10px] font-black uppercase tracking-widest bg-neutral-100 text-neutral-600 px-3 py-1.5 rounded-full">
                      {planLabel(t.plan)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center font-bold text-neutral-700">{t.subjects}</td>
                  <td className="px-4 py-4 text-center font-bold text-neutral-700">{t.students}</td>
                  <td className="px-4 py-4 text-center font-bold text-neutral-700">{t.gradesCount}</td>
                  <td className="px-4 py-4 text-center">
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-full ${
                        t.aiCallsThisMonth > 0 ? 'bg-purple-50 text-purple-600' : 'bg-neutral-100 text-neutral-400'
                      }`}
                    >
                      <Sparkles className="w-3 h-3" />
                      {t.aiCallsThisMonth}
                    </span>
                  </td>
                  <td className="px-8 py-4 text-right">
                    <span
                      className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full ${
                        t.active7d ? 'bg-emerald-50 text-emerald-600' : t.active30d ? 'bg-amber-50 text-amber-600' : 'bg-neutral-100 text-neutral-400'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${t.active7d ? 'bg-emerald-500' : t.active30d ? 'bg-amber-500' : 'bg-neutral-300'}`}
                      />
                      {t.active7d ? 'Hoy / 7d' : t.active30d ? 'Últimos 30d' : 'Inactivo'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}