/**
 * StudentDetailView.tsx — Sprint 2 Métricas: detalle del estudiante y
 * recomendaciones automáticas. Modal que abre al hacer clic en una fila de la
 * tabla "Estudiantes en riesgo" del dashboard. Los datos provienen de la Cloud
 * Function `getStudentRiskReport` (o del mock en modo demo). Paleta EdiAgil:
 * #F0F7F4/#1A3C40/#FFC107/#D32F2F/#2E7D32.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Loader2,
  AlertTriangle,
  GraduationCap,
  BookOpen,
  UserRound,
  CheckCircle2,
  Lightbulb,
  RefreshCw,
} from 'lucide-react';
import { getStudentRiskReport } from '../lib/adminApi';
import type { StudentRiskReport } from '../lib/adminApi';

const BRAND_BG = '#F0F7F4';
const BRAND_TEXT = '#1A3C40';

interface StudentDetailViewProps {
  studentId: string;
  onClose: () => void;
}

const riskBadge = (level: StudentRiskReport['riskLevel']) => {
  if (level === 'high') return 'bg-[#D32F2F] text-white';
  if (level === 'medium') return 'bg-[#FFC107] text-[#1A3C40]';
  return 'bg-[#2E7D32] text-white';
};

const riskLabel = (level: StudentRiskReport['riskLevel']) =>
  level === 'high' ? 'Alto' : level === 'medium' ? 'Medio' : 'Bajo';

export function StudentDetailView({ studentId, onClose }: StudentDetailViewProps) {
  const [report, setReport] = useState<StudentRiskReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Cerrar con Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Carga el reporte del estudiante (id o cédula).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setReport(null);
    getStudentRiskReport(studentId)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((err: any) => {
        console.error('getStudentRiskReport error:', err);
        if (!cancelled) setError(err?.message || 'No se pudo cargar el detalle del estudiante.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, reloadTick]);

  const grupo =
    report && (report.student.grado || report.student.seccion)
      ? `${report.student.grado || ''}${report.student.seccion ? ` - Aula ${report.student.seccion}` : ''}`
      : '—';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
      <div className="absolute inset-0 bg-[#1A3C40]/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-detail-title"
        tabIndex={-1}
        className="relative w-full max-w-3xl max-h-[92vh] rounded-[2rem] shadow-2xl overflow-hidden outline-none flex flex-col"
        style={{ background: BRAND_BG }}
      >
        {/* Encabezado */}
        <div className="px-6 md:px-8 pt-6 pb-5 shrink-0 flex items-center gap-4" style={{ background: BRAND_TEXT }}>
          <div className="w-11 h-11 rounded-2xl bg-[#FFC107] text-[#1A3C40] flex items-center justify-center shadow-lg shrink-0">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 id="student-detail-title" className="text-lg font-black text-white tracking-tight truncate">
              Detalle del estudiante
            </h3>
            <p className="text-xs text-white/60 font-medium mt-0.5 truncate">
              {report ? `${report.student.firstName} ${report.student.lastName}` : 'Cargando...'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
            title="Cerrar"
            className="ml-auto shrink-0 w-10 h-10 rounded-2xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-[#FFC107]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido */}
        <div className="p-6 md:p-8 overflow-y-auto flex-1 custom-scrollbar">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-10 h-10 animate-spin mb-4" style={{ color: BRAND_TEXT }} />
              <p className="text-sm font-bold text-[#1A3C40]/70">Cargando reporte del estudiante...</p>
            </div>
          )}

          {!loading && error && (
            <div className="bg-white border border-[#D32F2F]/30 rounded-[2rem] p-10 text-center">
              <AlertTriangle className="w-12 h-12 text-[#D32F2F] mx-auto mb-6" />
              <p className="text-lg font-black text-[#1A3C40] mb-2">Error al cargar el detalle</p>
              <p className="text-sm text-[#1A3C40]/60 font-medium">{error}</p>
              <button
                type="button"
                onClick={() => setReloadTick((t) => t + 1)}
                className="mt-6 inline-flex items-center gap-2 text-white px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95"
                style={{ background: BRAND_TEXT }}
              >
                <RefreshCw className="w-4 h-4" />
                Reintentar
              </button>
            </div>
          )}

          {!loading && report && (
            <div className="space-y-6">
              {/* Ficha del estudiante */}
              <div className="bg-white border border-[#1A3C40]/10 rounded-[2rem] p-6 flex flex-wrap items-center gap-5">
                <div className="w-16 h-16 rounded-full bg-[#F0F7F4] border border-[#1A3C40]/10 flex items-center justify-center text-[#1A3C40] font-black text-2xl shrink-0">
                  {(report.student.firstName || '?').charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-black text-[#1A3C40] tracking-tight">
                    {report.student.firstName} {report.student.lastName}
                  </p>
                  <p className="text-sm text-[#1A3C40]/55 font-medium mt-0.5">
                    {report.student.cedula ? `Cédula: ${report.student.cedula}` : 'Sin cédula'}
                    {report.student.correo ? ` · ${report.student.correo}` : ''}
                  </p>
                  <p className="text-xs text-[#1A3C40]/45 font-medium mt-0.5">
                    Grupo: {grupo} · {report.subjects.length} asignatura{report.subjects.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="ml-auto flex flex-col items-end gap-2">
                  <span className={`inline-flex items-center px-3.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${riskBadge(report.riskLevel)}`}>
                    Riesgo {riskLabel(report.riskLevel)}
                  </span>
                  <p className="text-sm font-black text-[#1A3C40]">
                    Promedio general: {report.promedioGeneral === null ? '—' : `${report.promedioGeneral}%`}
                  </p>
                </div>
              </div>

              {/* Tabla de asignaturas */}
              <div className="bg-white border border-[#1A3C40]/10 rounded-[2rem] overflow-hidden">
                <div className="flex items-center gap-2 px-6 pt-5 pb-3">
                  <BookOpen className="w-4 h-4 text-[#1A3C40]/50" />
                  <h4 className="text-sm font-black text-[#1A3C40] tracking-tight">Asignaturas</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-[#F0F7F4] border-y border-[#1A3C40]/10">
                        <th className="px-6 py-2.5 text-[10px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50">Asignatura</th>
                        <th className="px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50">Docente</th>
                        <th className="px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-center">Asistencia</th>
                        <th className="px-6 py-2.5 text-[10px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-center">Nota</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1A3C40]/5">
                      {report.subjects.map((s) => (
                        <tr key={`${s.subjectId}-${s.teacherName}`} className="hover:bg-[#F0F7F4]/60 transition-colors">
                          <td className="px-6 py-3 font-black text-sm text-[#1A3C40]">{s.subjectName}</td>
                          <td className="px-4 py-3 text-xs font-bold text-[#1A3C40]/60">{s.teacherName}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center justify-center min-w-[2.5rem] px-2 py-1 rounded-lg text-xs font-black ${
                              s.attendance === null ? 'text-[#1A3C40]/30' : s.attendance < 70 ? 'bg-[#D32F2F]/10 text-[#D32F2F]' : s.attendance < 80 ? 'bg-[#FFC107]/20 text-[#1A3C40]' : 'bg-[#2E7D32]/10 text-[#2E7D32]'
                            }`}>
                              {s.attendance === null ? '—' : `${s.attendance}%`}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-center">
                            <span className={`inline-flex items-center justify-center min-w-[2.5rem] px-2 py-1 rounded-lg text-xs font-black ${
                              s.finalGrade === null ? 'text-[#1A3C40]/30' : s.finalGrade < 60 ? 'bg-[#D32F2F]/10 text-[#D32F2F]' : 'bg-[#2E7D32]/10 text-[#2E7D32]'
                            }`}>
                              {s.finalGrade === null ? '—' : `${s.finalGrade}%`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Factores de riesgo */}
              <div className="bg-white border border-[#1A3C40]/10 rounded-[2rem] p-6">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-[#D32F2F]" />
                  <h4 className="text-sm font-black text-[#1A3C40] tracking-tight">Factores de riesgo</h4>
                </div>
                {report.reasons.length === 0 ? (
                  <p className="text-sm font-medium text-[#2E7D32] flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Sin factores de riesgo detectados.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {report.reasons.map((r, i) => (
                      <li key={i} className="flex items-start gap-2.5 rounded-xl bg-[#D32F2F]/5 border border-[#D32F2F]/15 px-4 py-2.5">
                        <UserRound className="w-4 h-4 text-[#D32F2F] shrink-0 mt-0.5" />
                        <span className="text-sm font-bold text-[#1A3C40]/80">{r}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Recomendaciones */}
              <div className="bg-white border border-[#1A3C40]/10 rounded-[2rem] p-6">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb className="w-4 h-4 text-[#FFC107]" />
                  <h4 className="text-sm font-black text-[#1A3C40] tracking-tight">Recomendaciones</h4>
                </div>
                <ul className="space-y-2">
                  {report.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2.5 rounded-xl bg-[#FFC107]/10 border border-[#FFC107]/30 px-4 py-2.5">
                      <span className="w-5 h-5 rounded-full bg-[#1A3C40] text-white text-[10px] font-black flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>
                      <span className="text-sm font-bold text-[#1A3C40]/80">{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Acciones */}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-2 bg-white border border-[#1A3C40]/15 hover:bg-[#F0F7F4] text-[#1A3C40] px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-colors focus:outline-none focus:ring-2 focus:ring-[#FFC107]/50"
                >
                  Cerrar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
