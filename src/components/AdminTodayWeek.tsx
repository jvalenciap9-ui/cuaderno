import React from 'react';
import { CalendarDays, TrendingUp, CalendarRange, ShieldAlert, ClipboardList, Loader2 } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

interface AdminTodayWeekProps {
  loading: boolean;
  /** Asistencia global (%). */
  attendanceToday: number | null;
  /** Asignaturas activas (proxy de clases programadas). */
  classesToday: number;
  /** Alertas activas. */
  alertsToday: number;
  /** Serie de asistencia (últimos 7 puntos para el sparkline). */
  attendanceTrend: { date: string; value: number }[];
  /** Promedio general de calificaciones (%). */
  weeklyAverage: number | null;
  /** Estudiantes en riesgo (medio + alto). */
  atRiskWeek: number;
}

/**
 * AdminTodayWeek — Resumen "Hoy" y "Esta semana" del panel administrativo.
 *
 * Dos tarjetas con la información más relevante del momento: la primera muestra
 * el estado del día (asistencia, clases/actividades y alertas) y la segunda la
 * tendencia semanal con sparkline, promedio de calificaciones y estudiantes en
 * riesgo. Respeta los filtros globales porque recibe las métricas ya filtradas.
 */
export function AdminTodayWeek({
  loading,
  attendanceToday,
  classesToday,
  alertsToday,
  attendanceTrend,
  weeklyAverage,
  atRiskWeek,
}: AdminTodayWeekProps) {
  const trendData = attendanceTrend.length > 0
    ? attendanceTrend
    : [{ date: 'Sin datos', value: 0 }];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Tarjeta Hoy */}
      <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-9 h-9 rounded-xl bg-[#FFC107]/15 border border-[#FFC107]/30 flex items-center justify-center">
            <CalendarDays className="w-4.5 h-4.5 text-[#1A3C40]" />
          </div>
          <div>
            <h3 className="text-sm font-black text-[#1A3C40] tracking-tight">Hoy</h3>
            <p className="text-[11px] text-neutral-500 font-medium">Estado actual de la institución</p>
          </div>
        </div>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10">
            <Loader2 className="w-8 h-8 text-[#1A3C40] animate-spin mb-3" />
            <p className="text-xs font-bold text-neutral-500">Cargando resumen del día...</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-[#F0F7F4] border border-[#1A3C40]/10 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/60">Asistencia</p>
              <p className="text-2xl font-black text-[#1A3C40] leading-none mt-2">
                {attendanceToday === null ? '—' : `${attendanceToday}%`}
              </p>
              <p className="text-[11px] text-neutral-500 font-medium mt-1.5">Global del día</p>
            </div>
            <div className="rounded-2xl bg-[#F0F7F4] border border-[#1A3C40]/10 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/60">Clases</p>
              <p className="text-2xl font-black text-[#1A3C40] leading-none mt-2">{classesToday}</p>
              <p className="text-[11px] text-neutral-500 font-medium mt-1.5">Asignaturas activas</p>
            </div>
            <div className="rounded-2xl bg-[#F0F7F4] border border-[#1A3C40]/10 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/60">Alertas</p>
              <p className="text-2xl font-black text-[#D32F2F] leading-none mt-2">{alertsToday}</p>
              <p className="text-[11px] text-neutral-500 font-medium mt-1.5">Activas hoy</p>
            </div>
          </div>
        )}
      </div>

      {/* Tarjeta Esta semana */}
      <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-9 h-9 rounded-xl bg-[#2E7D32]/10 border border-[#2E7D32]/30 flex items-center justify-center">
            <TrendingUp className="w-4.5 h-4.5 text-[#2E7D32]" />
          </div>
          <div>
            <h3 className="text-sm font-black text-[#1A3C40] tracking-tight">Esta semana</h3>
            <p className="text-[11px] text-neutral-500 font-medium">Tendencia de los últimos 7 periodos</p>
          </div>
        </div>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10">
            <Loader2 className="w-8 h-8 text-[#2E7D32] animate-spin mb-3" />
            <p className="text-xs font-bold text-neutral-500">Cargando tendencia semanal...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-neutral-50 border border-neutral-100 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-neutral-400 mb-2 flex items-center gap-1.5">
                <CalendarRange className="w-3.5 h-3.5" />
                Tendencia de asistencia
              </p>
              <div className="h-20">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="date" tick={{ fill: '#9CA3AF', fontSize: 9, fontWeight: 600 }} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} hide />
                    <Tooltip
                      contentStyle={{ borderRadius: '0.75rem', border: '1px solid #E5E7EB', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontWeight: 700, fontSize: 12 }}
                      formatter={(v: number) => [`${v}%`, 'Asistencia']}
                    />
                    <Line type="monotone" dataKey="value" stroke="#2E7D32" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 5, strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-2xl bg-neutral-50 border border-neutral-100 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-neutral-400 flex items-center gap-1.5">
                  <ClipboardList className="w-3.5 h-3.5" />
                  Promedio de calificaciones
                </p>
                <p className="text-2xl font-black text-[#1A3C40] leading-none mt-1.5">
                  {weeklyAverage === null ? '—' : `${weeklyAverage}%`}
                </p>
              </div>
              <div className="rounded-2xl bg-neutral-50 border border-neutral-100 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-neutral-400 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Estudiantes en riesgo
                </p>
                <p className="text-2xl font-black text-[#1A3C40] leading-none mt-1.5">{atRiskWeek}</p>
                <p className="text-[11px] text-neutral-500 font-medium mt-1">Nivel medio + alto</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}