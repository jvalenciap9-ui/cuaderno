import React from 'react';
import { Users, GraduationCap, Activity, ClipboardList } from 'lucide-react';
import { Loader2 } from 'lucide-react';

interface AdminSummaryCardsProps {
  loading: boolean;
  teacherCount: number;
  studentCount: number;
  attendance: number | null;
  grades: number | null;
}

/**
 * AdminSummaryCards — 4 tarjetas KPI del panel administrativo.
 *
 * Máximo 4 métricas, sin duplicar información (Docentes, Alumnos, Asistencia
 * global y Promedio general). El resto de métricas vive en sus acordeones
 * (riesgo, alertas, gráficos). Paleta institucional EdiAgil.
 */
export function AdminSummaryCards({
  loading,
  teacherCount,
  studentCount,
  attendance,
  grades,
}: AdminSummaryCardsProps) {
  const kpis = [
    {
      label: 'Docentes',
      value: teacherCount,
      suffix: '',
      description: 'Docentes activos en la institución',
      icon: Users,
      iconCls: 'bg-blue-50 border-blue-100 text-blue-600',
    },
    {
      label: 'Alumnos',
      value: studentCount,
      suffix: '',
      description: 'Estudiantes registrados',
      icon: GraduationCap,
      iconCls: 'bg-emerald-50 border-emerald-100 text-emerald-600',
    },
    {
      label: 'Asistencia global',
      value: attendance,
      suffix: '%',
      description: 'Promedio institucional',
      icon: Activity,
      iconCls: 'bg-amber-50 border-amber-100 text-amber-600',
    },
    {
      label: 'Promedio general',
      value: grades,
      suffix: '%',
      description: 'Notas de todas las asignaturas',
      icon: ClipboardList,
      iconCls: 'bg-purple-50 border-purple-100 text-purple-600',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        return (
          <div key={kpi.label} className="bg-white border border-neutral-200 rounded-[1.5rem] p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">{kpi.label}</p>
                <p className="text-3xl font-black text-neutral-900 leading-none mt-2">
                  {loading ? (
                    <Loader2 className="w-6 h-6 text-neutral-300 animate-spin" />
                  ) : kpi.value === null ? (
                    '—'
                  ) : (
                    `${kpi.value}${kpi.suffix}`
                  )}
                </p>
                <p className="text-xs text-neutral-400 font-medium mt-1.5">{kpi.description}</p>
              </div>
              <div className={`w-10 h-10 rounded-2xl border flex items-center justify-center shrink-0 ${kpi.iconCls}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}