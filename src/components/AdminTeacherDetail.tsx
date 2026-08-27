/**
 * AdminTeacherDetail.tsx — Modal de detalle del docente (rediseno-panel).
 *
 * Se abre al hacer clic en un docente de "Gestión Pedagógica → Docentes".
 * Shell: capa fija centrada (z-50), panel de 90vh con header + nav (3 pestañas)
 * + main scrollable. Pestañas operativas:
 *  - Resumen: ficha, tarjetas, gráficos por asignatura, evolución y riesgo.
 *  - Asignaturas: TODAS las asignaturas del docente (activas y no activas,
 *    sin filtro de turno/nivel); clic → clases de la asignatura con
 *    asistencia, calificaciones, evaluaciones y alumnos.
 *  - Alumnos: lista única; clic → detalle del alumno con botón "Boletín".
 * Datos: `getTeacherPerformance` (resumen) + `adminGetTeacherData` (alumnos
 * por asignatura, carga diferida al entrar a Asignaturas/Alumnos).
 * Paleta EdiAgil: #F0F7F4/#1A3C40/#FFC107/#D32F2F/#2E7D32.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Loader2,
  AlertTriangle,
  RefreshCw,
  BookOpen,
  GraduationCap,
  Mail,
  UserCheck,
  BarChart3,
  TrendingUp,
  ShieldAlert,
  ArrowLeft,
  FileText,
  Users,
  ClipboardList,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { getTeacherPerformance, adminGetTeacherData } from '../lib/adminApi';
import type {
  TeacherPerformance,
  TeacherPerformanceSubject,
  InstitutionalRiskLevel,
  AdminTeacherDataResponse,
  StudentSearchResult,
} from '../lib/adminApi';
import { AdminBoletin } from './AdminBoletin';

const BRAND_TEXT = '#1A3C40';

export type AdminTeacherTab = 'resumen' | 'asignaturas' | 'alumnos';

interface AdminTeacherDetailProps {
  teacherUid: string;
  onClose: () => void;
  /** Pestaña inicial del modal (el botón "Asignaturas" de la tabla de
   *  docentes abre directamente la pestaña de asignaturas). */
  initialTab?: AdminTeacherTab;
}

const riskBadge = (level: InstitutionalRiskLevel) => {
  if (level === 'high') return 'bg-[#D32F2F] text-white';
  if (level === 'medium') return 'bg-[#FFC107] text-[#1A3C40]';
  return 'bg-[#2E7D32] text-white';
};

const riskLabel = (level: InstitutionalRiskLevel) =>
  level === 'high' ? 'Alto' : level === 'medium' ? 'Medio' : 'Bajo';

interface StudentLite {
  id: string;
  cedula: string;
  firstName: string;
  lastName: string;
  gender: 'M' | 'F' | null;
  subjectId: string;
}

export function AdminTeacherDetail({ teacherUid, onClose, initialTab = 'resumen' }: AdminTeacherDetailProps) {
  const [perf, setPerf] = useState<TeacherPerformance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  // Datos completos (asignaturas con alumnos/evaluaciones/asistencia).
  const [full, setFull] = useState<AdminTeacherDataResponse | null>(null);
  const [fullLoading, setFullLoading] = useState(false);
  const [fullError, setFullError] = useState('');
  // Pestaña activa y navegación interna.
  const [tab, setTab] = useState<AdminTeacherTab>(initialTab);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [focusSection, setFocusSection] = useState<string | null>(null);
  const [detailStudentId, setDetailStudentId] = useState<string | null>(null);
  // Boletín del alumno (modal encima).
  const [boletinStudent, setBoletinStudent] = useState<StudentSearchResult | null>(null);

  // Cerrar con Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Al abrir una asignatura con una sección objetivo (Asistencia,
  // Calificaciones, Evaluaciones o Alumnos), desplaza el detalle hasta esa
  // sección y la resalta brevemente.
  useEffect(() => {
    if (!focusSection || !selectedSubjectId) return;
    const id = `sec-${focusSection}`;
    const raf = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const t = setTimeout(() => setFocusSection(null), 1800);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [focusSection, selectedSubjectId]);

  // Carga el desempeño del docente (resumen). Sin filtros de turno/nivel:
  // incluye TODAS las asignaturas del docente (activas y no activas).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setPerf(null);
    getTeacherPerformance({ teacherId: teacherUid })
      .then((data) => {
        if (!cancelled) setPerf(data);
      })
      .catch((err: any) => {
        console.error('getTeacherPerformance error:', err);
        if (!cancelled) setError(err?.message || 'No se pudo cargar el desempeño del docente.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teacherUid, reloadTick]);

  // Carga diferida de los datos completos (asignaturas, alumnos, evaluaciones,
  // asistencia y calificaciones) al entrar en Asignaturas o Alumnos.
  const needsFull = tab === 'asignaturas' || tab === 'alumnos';
  useEffect(() => {
    if (!needsFull || full) return;
    let cancelled = false;
    setFullLoading(true);
    setFullError('');
    adminGetTeacherData(teacherUid)
      .then((data) => {
        if (!cancelled) setFull(data);
      })
      .catch((err: any) => {
        console.error('adminGetTeacherData error:', err);
        if (!cancelled) setFullError(err?.message || 'No se pudieron cargar las asignaturas del docente.');
      })
      .finally(() => {
        if (!cancelled) setFullLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsFull, teacherUid, reloadTick]);

  // Todos los alumnos únicos del docente (desde los datos completos).
  const allStudents = useMemo(() => {
    if (!full) return [] as StudentLite[];
    const map = new Map<string, StudentLite>();
    for (const sub of full.subjects) {
      for (const s of sub.students || []) {
        if (!s || !s.id) continue;
        if (!map.has(s.id)) {
          map.set(s.id, {
            id: s.id,
            cedula: s.cedula || '',
            firstName: s.firstName || 'Sin nombre',
            lastName: s.lastName || '',
            gender: s.gender || null,
            subjectId: sub.id,
          });
        }
      }
    }
    return Array.from(map.values());
  }, [full]);

  // Asignatura seleccionada (detalle con clases).
  const selectedSubject = useMemo(() => {
    if (!full || !selectedSubjectId) return null;
    const sub = full.subjects.find((x) => x.id === selectedSubjectId);
    const meta = perf?.subjects.find((x) => x.subjectId === selectedSubjectId);
    if (!sub) return null;
    return { sub, meta };
  }, [perf, full, selectedSubjectId]);

  // Alumno seleccionado (detalle con boletín).
  const detailStudent = useMemo(
    () => allStudents.find((s) => s.id === detailStudentId) || null,
    [allStudents, detailStudentId],
  );

  // Estado de la asignatura dentro del periodo lectivo. El esquema NO tiene
  // campo "activa": una asignatura se considera ACTIVA si tiene alumnos
  // matriculados (clase que se está impartiendo) e INACTIVA si no tiene
  // matrícula (clase vacía, sin uso).
  const subjectStatus = (sub: any): 'activa' | 'inactiva' =>
    (sub.students || []).some((s: any) => s && s.id) ? 'activa' : 'inactiva';

  const statusBadge = (status: 'activa' | 'inactiva') =>
    status === 'activa'
      ? 'bg-[#2E7D32]/10 border border-[#2E7D32]/30 text-[#2E7D32]'
      : 'bg-neutral-100 border border-neutral-200 text-neutral-500';

  // Asistencia % de un alumno en una asignatura (desde los registros).
  const attPct = (sub: any, studentId: string): number | null => {
    const recs = (sub?.attendance || []).filter((a: any) => a.studentId === studentId);
    if (recs.length === 0) return null;
    const present = recs.filter((r: any) => r.status === 'present').length;
    return Math.round((present / recs.length) * 100);
  };

  // Desglose P/T/A de un alumno en una asignatura (para la tabla de asistencia).
  const attBreakdown = (sub: any, studentId: string) => {
    const recs = (sub?.attendance || []).filter((a: any) => a.studentId === studentId);
    const present = recs.filter((r: any) => r.status === 'present').length;
    const late = recs.filter((r: any) => r.status === 'late' || r.status === 'tardy').length;
    const absent = recs.filter((r: any) => r.status === 'absent').length;
    return {
      total: recs.length,
      present,
      late,
      absent,
      pct: recs.length > 0 ? Math.round((present / recs.length) * 100) : null,
    };
  };

  // Nota % de un alumno en una asignatura (desde las calificaciones).
  const gradePct = (sub: any, studentId: string): number | null => {
    const gs = (sub?.grades || []).filter((g: any) => g.studentId === studentId);
    if (gs.length === 0) return null;
    const vals = gs
      .map((g: any) =>
        g.scorePct != null
          ? g.scorePct
          : g.maxScore
            ? (g.score / g.maxScore) * 100
            : null,
      )
      .filter((v: any) => v !== null);
    return vals.length ? Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length) : null;
  };

  // Nota % de UN alumno en UNA evaluación concreta (tabla de calificaciones).
  const gradeForEval = (sub: any, studentId: string, evaluationId: string): number | null => {
    const g = (sub?.grades || []).find(
      (x: any) => x.studentId === studentId && x.evaluationId === evaluationId,
    );
    if (!g) return null;
    return g.scorePct != null ? g.scorePct : g.maxScore ? (g.score / g.maxScore) * 100 : null;
  };

  // Abre el boletín del alumno construyendo el StudentSearchResult a partir de
  // las membresías reales del docente (asignaturas a las que pertenece).
  const openBoletin = (student: StudentLite) => {
    const memberships = (full?.subjects || [])
      .filter((sub) => (sub.students || []).some((s: any) => s?.id === student.id))
      .map((sub) => ({
        studentDocId: student.id,
        subjectId: sub.id,
        subjectName: sub.name,
        periodo: sub.periodo ?? null,
        nivelEducativo: sub.nivelEducativo ?? null,
        teacherUid,
        teacherName: perf?.teacher.displayName || '',
      }));
    setBoletinStudent({
      studentId: student.id,
      cedula: student.cedula,
      firstName: student.firstName,
      lastName: student.lastName,
      gender: student.gender,
      memberships,
    });
  };

  // Datos para los gráficos (pestaña Resumen).
  const subjectChartData = useMemo(
    () =>
      (perf?.subjects || []).map((s) => ({
        name: s.subjectName,
        Asistencia: s.promedioAsistencia,
        Calificaciones: s.promedioCalificaciones,
      })),
    [perf],
  );

  const promedioAsistencia = useMemo(() => {
    const subs = perf?.subjects || [];
    const vals = subs.map((s) => s.promedioAsistencia).filter((v): v is number => v !== null);
    return vals.length > 0 ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  }, [perf]);

  const stats = useMemo(() => {
    const t = perf?.teacher;
    return [
      { label: 'Asignaturas', value: t ? t.subjectsCount : 0, icon: <BookOpen className="w-5 h-5" />, accent: '#FFC107' },
      { label: 'Alumnos', value: t ? t.totalStudents : 0, icon: <GraduationCap className="w-5 h-5" />, accent: '#2E7D32' },
      { label: 'Promedio general', value: t?.promedioGeneral === null ? '—' : `${t?.promedioGeneral ?? '—'}%`, icon: <BarChart3 className="w-5 h-5" />, accent: '#1A3C40' },
      { label: 'Promedio asistencia', value: promedioAsistencia === null ? '—' : `${promedioAsistencia}%`, icon: <UserCheck className="w-5 h-5" />, accent: '#D32F2F' },
    ];
  }, [perf, promedioAsistencia]);

  const chartTooltipStyle = {
    backgroundColor: '#ffffff',
    border: '1px solid #1A3C40',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 700,
  };

  const tabBtnCls = (active: boolean) =>
    `flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 ${
      active
        ? 'bg-[#1A3C40] text-white shadow-lg shadow-[#1A3C40]/20'
        : 'text-[#1A3C40]/60 hover:bg-[#F0F7F4]'
    }`;

  // ─── Pestaña Resumen ──────────────────────────────────────────────────────
  const renderResumen = () => (
    <div className="space-y-6">
      {/* Ficha del docente */}
      <div className="bg-white border border-[#1A3C40]/10 rounded-[2rem] p-6 flex flex-wrap items-center gap-5">
        <div className="w-16 h-16 rounded-full bg-[#F0F7F4] border border-[#1A3C40]/10 flex items-center justify-center text-[#1A3C40] font-black text-2xl shrink-0">
          {(perf!.teacher.displayName || '?').charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xl font-black text-[#1A3C40] tracking-tight">{perf!.teacher.displayName}</p>
          <p className="flex items-center gap-1.5 text-sm text-[#1A3C40]/55 font-medium mt-1">
            <Mail className="w-3.5 h-3.5" />
            {perf!.teacher.email || '—'}
          </p>
          <p className="text-xs text-[#1A3C40]/45 font-medium mt-0.5">{perf!.teacher.institutionName}</p>
        </div>
      </div>

      {/* Tarjetas de resumen */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-white border border-[#1A3C40]/10 rounded-[1.5rem] p-5 shadow-sm">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white mb-3" style={{ background: s.accent }}>
              {s.icon}
            </div>
            <p className="text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50">{s.label}</p>
            <p className="text-2xl font-black text-[#1A3C40] leading-none mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Gráfico por asignatura (altura por aspect ratio, sin altos fijos) */}
      {subjectChartData.length > 0 && (
        <div className="bg-white border border-[#1A3C40]/10 rounded-[2rem] p-6">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-[#1A3C40]/50" />
            <h4 className="text-sm font-black text-[#1A3C40] tracking-tight">Asistencia y calificaciones por asignatura</h4>
          </div>
          <div className="aspect-[16/9] md:aspect-[16/7] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={subjectChartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1A3C40/10" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fontWeight: 700, fill: '#1A3C40/60' }} interval={0} angle={-12} textAnchor="end" height={50} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#1A3C40/50' }} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                <Bar dataKey="Asistencia" fill="#2E7D32" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Calificaciones" fill="#FFC107" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Evolución por trimestre (sin altos fijos) */}
      {perf!.evolution && perf!.evolution.length > 0 && (
        <div className="bg-white border border-[#1A3C40]/10 rounded-[2rem] p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-[#1A3C40]/50" />
            <h4 className="text-sm font-black text-[#1A3C40] tracking-tight">Evolución por periodo (I / II / III)</h4>
          </div>
          <div className="aspect-[16/9] md:aspect-[16/6] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={perf!.evolution} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1A3C40/10" />
                <XAxis dataKey="periodo" tick={{ fontSize: 11, fontWeight: 700, fill: '#1A3C40/70' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#1A3C40/50' }} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                <Line type="monotone" dataKey="attendance" name="Asistencia" stroke="#2E7D32" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="grades" name="Calificaciones" stroke="#1A3C40" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Estudiantes en riesgo del docente */}
      <div className="bg-white border border-[#1A3C40]/10 rounded-[2rem] overflow-hidden">
        <div className="flex items-center gap-2 px-6 pt-5 pb-3">
          <ShieldAlert className="w-4 h-4 text-[#D32F2F]" />
          <h4 className="text-sm font-black text-[#1A3C40] tracking-tight">Estudiantes en riesgo</h4>
          <span className="ml-auto text-[11px] font-black uppercase tracking-widest bg-[#F0F7F4] border border-[#1A3C40]/10 text-[#1A3C40]/60 px-3 py-1 rounded-full">
            {perf!.atRiskStudents.length} fila{perf!.atRiskStudents.length === 1 ? '' : 's'}
          </span>
        </div>
        {perf!.atRiskStudents.length === 0 ? (
          <p className="px-6 pb-6 text-sm font-medium text-[#2E7D32] flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-[#2E7D32]" />
            Sin estudiantes en riesgo en las asignaturas de este docente.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-[#F0F7F4] border-y border-[#1A3C40]/10">
                  <th className="px-6 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50">Estudiante</th>
                  <th className="px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50">Asignatura</th>
                  <th className="px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-center">Asistencia</th>
                  <th className="px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-center">Nota</th>
                  <th className="px-6 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-right">Riesgo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1A3C40]/5">
                {perf!.atRiskStudents.map((r, i) => (
                  <tr key={`${r.studentId}-${r.subjectName}-${i}`} className="hover:bg-[#F0F7F4]/60 transition-colors">
                    <td className="px-6 py-3">
                      <p className="font-black text-sm text-[#1A3C40]">{r.studentName}</p>
                      {r.cedula ? <p className="text-xs text-[#1A3C40]/45 font-medium">{r.cedula}</p> : null}
                    </td>
                    <td className="px-4 py-3 text-xs font-bold text-[#1A3C40]/60">{r.subjectName}</td>
                    <td className="px-4 py-3 text-center text-sm font-black text-[#1A3C40]">
                      {r.asistencia === null ? '—' : `${r.asistencia}%`}
                    </td>
                    <td className="px-4 py-3 text-center text-sm font-black text-[#1A3C40]">
                      {r.nota === null ? '—' : `${r.nota}%`}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-widest ${riskBadge(r.nivelRiesgo)}`}>
                        {riskLabel(r.nivelRiesgo)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const renderFullError = (retry: () => void) => (
    <div className="bg-white border border-[#D32F2F]/30 rounded-[2rem] p-10 text-center">
      <AlertTriangle className="w-12 h-12 text-[#D32F2F] mx-auto mb-6" />
      <p className="text-lg font-black text-[#1A3C40] mb-2">Error al cargar los datos</p>
      <p className="text-sm text-[#1A3C40]/60 font-medium">{fullError}</p>
      <button
        type="button"
        onClick={retry}
        className="mt-6 inline-flex items-center gap-2 text-white px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95"
        style={{ background: BRAND_TEXT }}
      >
        <RefreshCw className="w-4 h-4" />
        Reintentar
      </button>
    </div>
  );

  // ─── Pestaña Asignaturas ──────────────────────────────────────────────────
  const renderAsignaturas = () => {
    if (fullLoading) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin mb-4" style={{ color: BRAND_TEXT }} />
          <p className="text-sm font-bold text-[#1A3C40]/70">Cargando asignaturas y clases del docente...</p>
        </div>
      );
    }
    if (fullError) return renderFullError(() => setReloadTick((t) => t + 1));
    if (!full) return null;

    // Vista de detalle de una asignatura: estadísticas de la clase,
    // evaluaciones, asistencia y alumnos (todo con botones funcionales).
    if (selectedSubject) {
      const { sub, meta } = selectedSubject;
      const students = (sub.students || []).filter((s: any) => s && s.id);
      const evals = sub.evaluations || [];
      const attRecs = sub.attendance || [];
      const presentCount = attRecs.filter((r: any) => r.status === 'present').length;
      const tardyCount = attRecs.filter((r: any) => r.status === 'late' || r.status === 'tardy').length;
      const absentCount = attRecs.filter((r: any) => r.status === 'absent').length;
      const attAvg = attRecs.length > 0 ? Math.round((presentCount / attRecs.length) * 100) : null;
      const allGrades = (sub.grades || []).map((g: any) =>
        g.scorePct != null ? g.scorePct : g.maxScore ? (g.score / g.maxScore) * 100 : null,
      ).filter((v: any) => v !== null);
      const gradeAvg = allGrades.length > 0 ? Math.round(allGrades.reduce((a: number, b: number) => a + b, 0) / allGrades.length) : null;
      const evalAvg = (evaluationId: string): number | null => {
        const gs = (sub.grades || []).filter((g: any) => g.evaluationId === evaluationId);
        const vals = gs
          .map((g: any) => (g.scorePct != null ? g.scorePct : g.maxScore ? (g.score / g.maxScore) * 100 : null))
          .filter((v: any) => v !== null);
        return vals.length ? Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length) : null;
      };
      // Sección resaltada temporalmente (mientras focusSection no se limpie).
      const sectionCls = (key: string) =>
        `bg-white border rounded-[2rem] overflow-hidden transition-all ${
          focusSection === key ? 'border-[#FFC107] ring-4 ring-[#FFC107]/30' : 'border-[#1A3C40]/10'
        }`;

      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => { setSelectedSubjectId(null); setDetailStudentId(null); setFocusSection(null); }}
            className="inline-flex items-center gap-2 text-sm font-black text-[#1A3C40]/70 hover:text-[#1A3C40] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver a las asignaturas
          </button>

          {/* Cabecera de la asignatura */}
          <div className="bg-white border border-[#1A3C40]/10 rounded-[2rem] p-6">
            <div className="flex flex-wrap items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-[#FFC107] text-[#1A3C40] flex items-center justify-center shrink-0">
                <BookOpen className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-black text-[#1A3C40] tracking-tight truncate">{sub.name}</p>
                <p className="text-xs text-[#1A3C40]/50 font-medium mt-0.5">
                  {meta ? `${meta.numEstudiantes} alumnos` : `${students.length} alumnos`}
                  {sub.periodo ? ` · Turno ${sub.periodo}` : ''}
                  {sub.nivelEducativo ? ` · ${sub.nivelEducativo}` : ''}
                </p>
              </div>
              <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-black uppercase tracking-widest ${statusBadge(subjectStatus(sub))}`}>
                {subjectStatus(sub) === 'activa' ? 'Activa' : 'Inactiva'}
              </span>
            </div>
            {/* Estadísticas de la clase */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
              <div className="rounded-2xl bg-[#F0F7F4] border border-[#1A3C40]/10 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/60">Alumnos</p>
                <p className="text-2xl font-black text-[#1A3C40] leading-none mt-1.5">{students.length}</p>
              </div>
              <div className="rounded-2xl bg-[#F0F7F4] border border-[#1A3C40]/10 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/60">Asistencia</p>
                <p className="text-2xl font-black text-[#2E7D32] leading-none mt-1.5">
                  {attAvg === null ? '—' : `${attAvg}%`}
                </p>
                <p className="text-[11px] text-[#1A3C40]/45 font-medium mt-1">
                  {presentCount} P · {tardyCount} T · {absentCount} A
                </p>
              </div>
              <div className="rounded-2xl bg-[#F0F7F4] border border-[#1A3C40]/10 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/60">Nota promedio</p>
                <p className="text-2xl font-black text-[#1A3C40] leading-none mt-1.5">
                  {gradeAvg === null ? '—' : `${gradeAvg}%`}
                </p>
              </div>
              <div className="rounded-2xl bg-[#F0F7F4] border border-[#1A3C40]/10 p-4">
                <p className="text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/60">Evaluaciones</p>
                <p className="text-2xl font-black text-[#1A3C40] leading-none mt-1.5">{evals.length}</p>
              </div>
            </div>
            {/* Navegación directa a las secciones de estado */}
            <div className="flex flex-wrap gap-2 mt-5">
              {([
                { key: 'asistencia', label: 'Asistencia', icon: UserCheck },
                { key: 'calificaciones', label: 'Calificaciones', icon: BarChart3 },
                { key: 'evaluaciones', label: 'Evaluaciones', icon: ClipboardList },
                { key: 'alumnos', label: 'Alumnos', icon: Users },
              ] as const).map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setFocusSection(s.key)}
                  className="inline-flex items-center gap-1.5 bg-[#F0F7F4] hover:bg-[#1A3C40] hover:text-white border border-[#1A3C40]/15 text-[#1A3C40] px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all active:scale-95"
                >
                  <s.icon className="w-3.5 h-3.5" />
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Asistencia por alumno */}
          <div id="sec-asistencia" className={sectionCls('asistencia')}>
            <div className="flex items-center gap-2 px-6 pt-5 pb-3">
              <UserCheck className="w-4 h-4 text-[#1A3C40]/50" />
              <h4 className="text-sm font-black text-[#1A3C40] tracking-tight">Asistencia por alumno</h4>
              <span className="ml-auto text-[11px] font-black uppercase tracking-widest bg-[#F0F7F4] border border-[#1A3C40]/10 text-[#1A3C40]/60 px-3 py-1 rounded-full">
                {attAvg === null ? 'Sin registros' : `Promedio ${attAvg}%`}
              </span>
            </div>
            {attRecs.length === 0 ? (
              <p className="px-6 pb-6 text-sm font-medium text-[#1A3C40]/50">Esta asignatura no tiene registros de asistencia.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-[#F0F7F4] border-y border-[#1A3C40]/10">
                      <th className="px-6 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50">Estudiante</th>
                      <th className="px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-center">Presentes</th>
                      <th className="px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-center">Tardanzas</th>
                      <th className="px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-center">Ausencias</th>
                      <th className="px-6 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-right">% Asistencia</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1A3C40]/5">
                    {students.map((s: any) => {
                      const b = attBreakdown(sub, s.id);
                      return (
                        <tr key={s.id} className="hover:bg-[#F0F7F4]/60 transition-colors">
                          <td className="px-6 py-3">
                            <p className="font-black text-sm text-[#1A3C40]">{s.lastName ? `${s.lastName}, ${s.firstName}` : s.firstName || '—'}</p>
                          </td>
                          <td className="px-4 py-3 text-center text-sm font-black text-[#2E7D32]">{b.present}</td>
                          <td className="px-4 py-3 text-center text-sm font-black text-[#FFC107]">{b.late}</td>
                          <td className="px-4 py-3 text-center text-sm font-black text-[#D32F2F]">{b.absent}</td>
                          <td className="px-6 py-3 text-right">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-widest ${b.pct === null ? 'bg-[#F0F7F4] text-[#1A3C40]/50' : b.pct! < 70 ? 'bg-[#D32F2F]/10 text-[#D32F2F]' : b.pct! < 80 ? 'bg-[#FFC107]/20 text-[#1A3C40]' : 'bg-[#2E7D32]/10 text-[#2E7D32]'}`}>
                              {b.pct === null ? '—' : `${b.pct}%`}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Calificaciones por alumno */}
          <div id="sec-calificaciones" className={sectionCls('calificaciones')}>
            <div className="flex items-center gap-2 px-6 pt-5 pb-3">
              <BarChart3 className="w-4 h-4 text-[#1A3C40]/50" />
              <h4 className="text-sm font-black text-[#1A3C40] tracking-tight">Calificaciones por alumno</h4>
              <span className="ml-auto text-[11px] font-black uppercase tracking-widest bg-[#F0F7F4] border border-[#1A3C40]/10 text-[#1A3C40]/60 px-3 py-1 rounded-full">
                {gradeAvg === null ? 'Sin notas' : `Promedio ${gradeAvg}%`}
              </span>
            </div>
            {evals.length === 0 ? (
              <p className="px-6 pb-6 text-sm font-medium text-[#1A3C40]/50">Esta asignatura no tiene evaluaciones para calificar.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-[#F0F7F4] border-y border-[#1A3C40]/10">
                      <th className="px-6 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50">Estudiante</th>
                      {evals.map((ev: any) => (
                        <th key={ev.id} className="px-3 py-2.5 text-center min-w-[72px]">
                          <p className="text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50">{ev.title || 'Evaluación'}</p>
                          <p className="text-[9px] font-bold text-[#1A3C40]/35 mt-0.5">{ev.maxScore ?? ''} pts</p>
                        </th>
                      ))}
                      <th className="px-6 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-right">Promedio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1A3C40]/5">
                    {students.map((s: any) => {
                      const avg = gradePct(sub, s.id);
                      return (
                        <tr key={s.id} className="hover:bg-[#F0F7F4]/60 transition-colors">
                          <td className="px-6 py-3">
                            <p className="font-black text-sm text-[#1A3C40]">{s.lastName ? `${s.lastName}, ${s.firstName}` : s.firstName || '—'}</p>
                          </td>
                          {evals.map((ev: any) => {
                            const v = gradeForEval(sub, s.id, ev.id);
                            return (
                              <td key={ev.id} className="px-3 py-3 text-center">
                                <span className={`inline-flex items-center justify-center min-w-[2.4rem] px-2 py-1 rounded-lg text-[11px] font-black ${v === null ? 'bg-[#F0F7F4] text-[#1A3C40]/40' : v! < 60 ? 'bg-[#D32F2F]/10 text-[#D32F2F]' : 'bg-[#2E7D32]/10 text-[#2E7D32]'}`}>
                                  {v === null ? '—' : `${v}%`}
                                </span>
                              </td>
                            );
                          })}
                          <td className="px-6 py-3 text-right text-sm font-black text-[#1A3C40]">
                            {avg === null ? '—' : `${avg}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Evaluaciones de la asignatura */}
          <div id="sec-evaluaciones" className={sectionCls('evaluaciones')}>
            <div className="flex items-center gap-2 px-6 pt-5 pb-3">
              <ClipboardList className="w-4 h-4 text-[#1A3C40]/50" />
              <h4 className="text-sm font-black text-[#1A3C40] tracking-tight">Evaluaciones</h4>
              <span className="ml-auto text-[11px] font-black uppercase tracking-widest bg-[#F0F7F4] border border-[#1A3C40]/10 text-[#1A3C40]/60 px-3 py-1 rounded-full">
                {evals.length} evaluación{evals.length === 1 ? '' : 'es'}
              </span>
            </div>
            {evals.length === 0 ? (
              <p className="px-6 pb-6 text-sm font-medium text-[#1A3C40]/50">Esta asignatura no tiene evaluaciones registradas.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-[#F0F7F4] border-y border-[#1A3C40]/10">
                      <th className="px-6 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50">Evaluación</th>
                      <th className="px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50">Tipo</th>
                      <th className="px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-center">Fecha</th>
                      <th className="px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-center">Máx.</th>
                      <th className="px-6 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-right">Promedio grupo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1A3C40]/5">
                    {evals.map((ev: any) => (
                      <tr key={ev.id} className="hover:bg-[#F0F7F4]/60 transition-colors">
                        <td className="px-6 py-3">
                          <p className="font-black text-sm text-[#1A3C40]">{ev.title || 'Evaluación'}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[11px] font-black uppercase tracking-widest bg-[#FFC107]/20 border border-[#FFC107]/40 text-[#1A3C40] px-2.5 py-1 rounded-full">
                            {ev.type || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-xs font-bold text-[#1A3C40]/60">
                          {ev.date ? new Date(ev.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : '—'}
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-bold text-[#1A3C40]/60">{ev.maxScore ?? '—'}</td>
                        <td className="px-6 py-3 text-right">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-widest ${evalAvg(ev.id) === null ? 'bg-[#F0F7F4] text-[#1A3C40]/50' : evalAvg(ev.id)! < 60 ? 'bg-[#D32F2F]/10 text-[#D32F2F]' : 'bg-[#2E7D32]/10 text-[#2E7D32]'}`}>
                            {evalAvg(ev.id) === null ? 'Sin notas' : `${evalAvg(ev.id)}%`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Alumnos de la asignatura */}
          <div id="sec-alumnos" className={sectionCls('alumnos')}>
            <div className="flex items-center gap-2 px-6 pt-5 pb-3">
              <Users className="w-4 h-4 text-[#1A3C40]/50" />
              <h4 className="text-sm font-black text-[#1A3C40] tracking-tight">Alumnos de la asignatura</h4>
              <span className="ml-auto text-[11px] font-black uppercase tracking-widest bg-[#F0F7F4] border border-[#1A3C40]/10 text-[#1A3C40]/60 px-3 py-1 rounded-full">
                {students.length}
              </span>
            </div>
            {students.length === 0 ? (
              <p className="px-6 pb-6 text-sm font-medium text-[#1A3C40]/50">Esta asignatura no tiene alumnos registrados.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-[#F0F7F4] border-y border-[#1A3C40]/10">
                      <th className="px-6 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50">Estudiante</th>
                      <th className="px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-center">Asistencia</th>
                      <th className="px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-center">Nota</th>
                      <th className="px-6 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1A3C40]/5">
                    {students.map((s: any) => (
                      <tr key={s.id} className="hover:bg-[#F0F7F4]/60 transition-colors">
                        <td className="px-6 py-3">
                          <p className="font-black text-sm text-[#1A3C40]">{s.lastName ? `${s.lastName}, ${s.firstName}` : s.firstName || '—'}</p>
                          {s.cedula ? <p className="text-xs text-[#1A3C40]/45 font-medium">{s.cedula}</p> : null}
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-black text-[#1A3C40]">
                          {attPct(sub, s.id) === null ? '—' : `${attPct(sub, s.id)}%`}
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-black text-[#1A3C40]">
                          {gradePct(sub, s.id) === null ? '—' : `${gradePct(sub, s.id)}%`}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setTab('alumnos');
                              setDetailStudentId(s.id);
                            }}
                            className="inline-flex items-center gap-1.5 bg-[#1A3C40] hover:bg-[#2E7D32] text-white px-3.5 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-colors"
                          >
                            <Users className="w-3.5 h-3.5" />
                            Ver alumno
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Lista de TODAS las asignaturas del docente (activas e inactivas, sin
    // filtros de turno/nivel). Cada tarjeta tiene botones de estado que abren
    // la clase directamente en la sección correspondiente (asistencia,
    // calificaciones, evaluaciones o alumnos).
    const active = full.subjects.filter((s) => subjectStatus(s) === 'activa');
    const inactive = full.subjects.filter((s) => subjectStatus(s) === 'inactiva');

    const renderSubjectCard = (sub: any) => {
      const meta = perf?.subjects.find((x) => x.subjectId === sub.id);
      const status = subjectStatus(sub);
      const statusLabel = status === 'activa' ? 'Activa' : 'Inactiva';
      const openSection = (section: string) => {
        setSelectedSubjectId(sub.id);
        setFocusSection(section);
      };
      return (
        <div
          key={sub.id}
          className={`bg-white border rounded-[1.5rem] p-5 shadow-sm transition-all hover:shadow-md ${
            status === 'activa' ? 'border-[#1A3C40]/10 hover:border-[#1A3C40]/30' : 'border-neutral-200 opacity-90'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${status === 'activa' ? 'bg-[#F0F7F4] border-[#1A3C40]/10 text-[#1A3C40]' : 'bg-neutral-100 border-neutral-200 text-neutral-400'}`}>
              <BookOpen className="w-4.5 h-4.5" />
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-widest ${statusBadge(status)}`}>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${status === 'activa' ? 'bg-[#2E7D32]' : 'bg-neutral-400'}`} />
                {statusLabel}
              </span>
              {sub.periodo ? (
                <span className="text-[11px] font-black uppercase tracking-widest bg-[#FFC107]/20 border border-[#FFC107]/40 text-[#1A3C40] px-2.5 py-1 rounded-full">
                  {sub.periodo}
                </span>
              ) : null}
              {sub.nivelEducativo ? (
                <span className="text-[11px] font-black uppercase tracking-widest bg-[#2E7D32]/10 border border-[#2E7D32]/30 text-[#2E7D32] px-2.5 py-1 rounded-full">
                  {sub.nivelEducativo}
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => openSection('')}
            title={`Vista general de ${sub.name}`}
            className="w-full text-left mt-3"
          >
            <p className="font-black text-sm text-[#1A3C40] leading-snug">{sub.name}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#2E7D32]/10 border border-[#2E7D32]/30 text-[#2E7D32] text-[11px] font-black px-2.5 py-1">
                {(sub.students || []).filter((s: any) => s && s.id).length} alumnos
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#1A3C40]/5 border border-[#1A3C40]/15 text-[#1A3C40] text-[11px] font-black px-2.5 py-1">
                Nota {meta && meta.promedioCalificaciones !== null ? `${meta.promedioCalificaciones}%` : '—'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#1A3C40]/5 border border-[#1A3C40]/15 text-[#1A3C40] text-[11px] font-black px-2.5 py-1">
                Asist. {meta && meta.promedioAsistencia !== null ? `${meta.promedioAsistencia}%` : '—'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#D32F2F]/10 border border-[#D32F2F]/30 text-[#D32F2F] text-[11px] font-black px-2.5 py-1">
                {(sub.evaluations || []).length} evaluaciones
              </span>
            </div>
          </button>
          {/* Botones de estado de la asignatura: abren la clase en la sección */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
            {([
              { key: 'asistencia', label: 'Asistencia', icon: UserCheck },
              { key: 'calificaciones', label: 'Calificaciones', icon: BarChart3 },
              { key: 'evaluaciones', label: 'Evaluaciones', icon: ClipboardList },
              { key: 'alumnos', label: 'Alumnos', icon: Users },
            ] as const).map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => openSection(s.key)}
                title={`Ver ${s.label} de ${sub.name}`}
                className="inline-flex items-center justify-center gap-1.5 bg-[#F0F7F4] hover:bg-[#1A3C40] hover:text-white border border-[#1A3C40]/15 text-[#1A3C40] px-2 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all active:scale-95"
              >
                <s.icon className="w-3.5 h-3.5" />
                {s.label}
              </button>
            ))}
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-6">
        {full.subjects.length === 0 ? (
          <p className="text-sm font-medium text-[#1A3C40]/50">
            Este docente no tiene asignaturas asignadas.
          </p>
        ) : (
          <>
            <p className="text-xs font-bold text-[#1A3C40]/60 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#2E7D32]/10 border border-[#2E7D32]/30 text-[#2E7D32] text-[11px] font-black px-3 py-1">
                {active.length} activas
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-500 text-[11px] font-black px-3 py-1">
                {inactive.length} inactivas
              </span>
              <span className="ml-1">en el periodo lectivo actual</span>
            </p>

            {active.length > 0 && (
              <>
                <h4 className="text-sm font-black text-[#1A3C40] tracking-tight flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#2E7D32]" />
                  Asignaturas activas
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {active.map((sub) => renderSubjectCard(sub))}
                </div>
              </>
            )}

            {inactive.length > 0 && (
              <>
                <h4 className="text-sm font-black text-[#1A3C40]/60 tracking-tight flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-neutral-400" />
                  Asignaturas inactivas
                  <span className="text-[11px] font-bold text-[#1A3C40]/45 normal-case tracking-normal">
                    (sin alumnos matriculados en el periodo lectivo)
                  </span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {inactive.map((sub) => renderSubjectCard(sub))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    );
  };

  // ─── Pestaña Alumnos ──────────────────────────────────────────────────────
  const renderAlumnos = () => {
    if (fullLoading) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin mb-4" style={{ color: BRAND_TEXT }} />
          <p className="text-sm font-bold text-[#1A3C40]/70">Cargando alumnos del docente...</p>
        </div>
      );
    }
    if (fullError) return renderFullError(() => setReloadTick((t) => t + 1));
    if (!full) return null;

    // Detalle del alumno (datos, asignaturas y botón Boletín).
    if (detailStudent) {
      const memberships = (full.subjects || [])
        .filter((sub) => (sub.students || []).some((s: any) => s?.id === detailStudent.id))
        .map((sub) => ({ sub, meta: perf?.subjects.find((x) => x.subjectId === sub.id) }));
      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setDetailStudentId(null)}
            className="inline-flex items-center gap-2 text-sm font-black text-[#1A3C40]/70 hover:text-[#1A3C40] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver a los alumnos
          </button>
          <div className="bg-white border border-[#1A3C40]/10 rounded-[2rem] p-6">
            <div className="flex flex-wrap items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-[#F0F7F4] border border-[#1A3C40]/10 flex items-center justify-center text-[#1A3C40] font-black text-xl shrink-0">
                {(detailStudent.firstName || '?').charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-black text-[#1A3C40] tracking-tight">
                  {detailStudent.lastName ? `${detailStudent.lastName}, ${detailStudent.firstName}` : detailStudent.firstName}
                </p>
                <p className="text-xs text-[#1A3C40]/50 font-medium mt-0.5">
                  {detailStudent.cedula ? `Cédula: ${detailStudent.cedula}` : 'Sin cédula'}
                  {detailStudent.gender === 'M' ? ' · Masculino' : detailStudent.gender === 'F' ? ' · Femenino' : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openBoletin(detailStudent)}
                className="inline-flex items-center gap-2 bg-[#1A3C40] hover:bg-[#2E7D32] text-white px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-[#1A3C40]/20"
              >
                <FileText className="w-4 h-4" />
                Ver boletín
              </button>
            </div>

            <h4 className="text-sm font-black text-[#1A3C40] tracking-tight mt-6 mb-3">Asignaturas cursadas con este docente</h4>
            {memberships.length === 0 ? (
              <p className="text-sm font-medium text-[#1A3C40]/50">Sin asignaturas registradas.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-[#F0F7F4] border-y border-[#1A3C40]/10">
                      <th className="px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50">Asignatura</th>
                      <th className="px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-center">Asistencia</th>
                      <th className="px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-center">Nota</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1A3C40]/5">
                    {memberships.map(({ sub, meta }) => (
                      <tr key={sub.id} className="hover:bg-[#F0F7F4]/60 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-black text-sm text-[#1A3C40]">{sub.name}</p>
                          <p className="text-xs text-[#1A3C40]/45 font-medium">
                            {sub.periodo ? `Turno ${sub.periodo}` : ''}
                            {meta && meta.promedioCalificaciones !== null ? ` · Promedio de la asignatura ${meta.promedioCalificaciones}%` : ''}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-black text-[#1A3C40]">
                          {attPct(sub, detailStudent.id) === null ? '—' : `${attPct(sub, detailStudent.id)}%`}
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-black text-[#1A3C40]">
                          {gradePct(sub, detailStudent.id) === null ? '—' : `${gradePct(sub, detailStudent.id)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Lista de alumnos del docente.
    return (
      <div className="bg-white border border-[#1A3C40]/10 rounded-[2rem] overflow-hidden">
        {allStudents.length === 0 ? (
          <p className="p-10 text-center text-sm font-medium text-[#1A3C40]/50">
            Este docente no tiene alumnos registrados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-[#F0F7F4] border-y border-[#1A3C40]/10">
                  <th className="px-6 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50">Alumno</th>
                  <th className="px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-center">Cédula</th>
                  <th className="px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-center">Asignaturas</th>
                  <th className="px-6 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1A3C40]/5">
                {allStudents.map((s) => {
                  const subCount = (full.subjects || []).filter((sub) =>
                    (sub.students || []).some((x: any) => x?.id === s.id),
                  ).length;
                  return (
                    <tr key={s.id} className="hover:bg-[#F0F7F4]/60 transition-colors">
                      <td className="px-6 py-3">
                        <p className="font-black text-sm text-[#1A3C40]">
                          {s.lastName ? `${s.lastName}, ${s.firstName}` : s.firstName}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-center text-xs font-bold text-[#1A3C40]/60">{s.cedula || '—'}</td>
                      <td className="px-4 py-3 text-center text-sm font-black text-[#1A3C40]">{subCount}</td>
                      <td className="px-6 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setDetailStudentId(s.id)}
                          className="inline-flex items-center gap-1.5 bg-[#1A3C40] hover:bg-[#2E7D32] text-white px-3.5 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-colors"
                        >
                          <Users className="w-3.5 h-3.5" />
                          Ver detalle
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  // ─── Shell del modal: capa fija centrada, 90vh desktop / casi pantalla
  // completa en móvil, header + nav + main. Se renderiza con createPortal a
  // document.body porque el modal vive DENTRO del acordeón "Gestión Pedagógica"
  // (AdminAccordion aplica transform al contenido), y un `transform` en un
  // ancestro rompe `position: fixed` (el modal quedaría recortado al tamaño
  // del acordeón y las pestañas no mostrarían datos). El portal lo saca de
  // ese contexto y lo ancla al viewport real.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 md:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="teacher-detail-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[90vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none"
      >
        {/* Header */}
        <header className="shrink-0 flex items-center gap-4 px-6 py-4" style={{ background: BRAND_TEXT }}>
          <div className="w-11 h-11 rounded-2xl bg-[#FFC107] text-[#1A3C40] flex items-center justify-center shadow-lg shrink-0">
            <UserCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 id="teacher-detail-title" className="text-lg font-black text-white tracking-tight truncate">
              {detailStudent ? 'Detalle del alumno' : selectedSubject ? 'Clases de la asignatura' : 'Detalle del docente'}
            </h3>
            <p className="text-xs text-white/60 font-medium mt-0.5 truncate">
              {perf ? perf.teacher.displayName : 'Cargando...'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle del docente"
            title="Cerrar"
            className="ml-auto shrink-0 w-10 h-10 rounded-2xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-[#FFC107]"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Nav: tres pestañas funcionales */}
        {!loading && !error && perf && (
          <nav className="shrink-0 px-6 pt-4 pb-0 border-b border-[#1A3C40]/10 bg-white">
            <div className="flex flex-wrap items-center gap-1 pb-4">
              <button
                type="button"
                onClick={() => setTab('resumen')}
                aria-pressed={tab === 'resumen'}
                className={tabBtnCls(tab === 'resumen')}
              >
                <BarChart3 className="w-4 h-4" />
                Resumen
              </button>
              <button
                type="button"
                onClick={() => setTab('asignaturas')}
                aria-pressed={tab === 'asignaturas'}
                className={tabBtnCls(tab === 'asignaturas')}
              >
                <BookOpen className="w-4 h-4" />
                Asignaturas
              </button>
              <button
                type="button"
                onClick={() => setTab('alumnos')}
                aria-pressed={tab === 'alumnos'}
                className={tabBtnCls(tab === 'alumnos')}
              >
                <GraduationCap className="w-4 h-4" />
                Alumnos
              </button>
            </div>
          </nav>
        )}

        {/* Main scrollable */}
        <main className="flex-1 overflow-y-auto p-6 bg-[#F0F7F4] custom-scrollbar">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-10 h-10 animate-spin mb-4" style={{ color: BRAND_TEXT }} />
              <p className="text-sm font-bold text-[#1A3C40]/70">Cargando desempeño del docente...</p>
            </div>
          )}

          {!loading && error && (
            <div className="bg-white border border-[#D32F2F]/30 rounded-[2rem] p-10 text-center">
              <AlertTriangle className="w-12 h-12 text-[#D32F2F] mx-auto mb-6" />
              <p className="text-lg font-black text-[#1A3C40] mb-2">Error al cargar el desempeño</p>
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

          {!loading && perf && tab === 'resumen' && renderResumen()}
          {!loading && perf && tab === 'asignaturas' && renderAsignaturas()}
          {!loading && perf && tab === 'alumnos' && renderAlumnos()}

          {!loading && perf && tab === 'resumen' && (
            <div className="flex justify-end mt-6">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-2 bg-white border border-[#1A3C40]/15 hover:bg-[#F0F7F4] text-[#1A3C40] px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-colors focus:outline-none focus:ring-2 focus:ring-[#FFC107]/50"
              >
                Cerrar
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Boletín del alumno (modal encima del detalle del docente). */}
      {boletinStudent && (
        <AdminBoletin student={boletinStudent} onClose={() => setBoletinStudent(null)} />
      )}
    </div>,
    document.body,
  );
}