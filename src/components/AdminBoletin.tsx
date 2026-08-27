import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  FileText,
  Loader2,
  AlertTriangle,
  BookOpen,
  GraduationCap,
  RefreshCw,
  ChevronDown,
  Check,
} from 'lucide-react';
import {
  loadInstitutionalReport,
  computePlanTable,
  buildGrupoLabel,
  type InstitutionalReportData,
} from '../lib/institutionalReport';
import { exportInstitutionalReport } from '../lib/exportUtils';
import { useAuth } from './AuthProvider';
import { useInstitution } from '../hooks/useInstitution';
import { showToast } from '../hooks/useToast';
import type { StudentSearchResult } from '../lib/adminApi';
import { REGLA_PLAN_LABEL, DEFAULT_GRADING_WEIGHT, type GradingWeight } from '../lib/adminApi';
import { adminGetSchoolConfig } from '../lib/adminApi';
// Boletín v2: periodos adaptados al plan de la institución + rango dinámico
// del año lectivo a partir de los periodos seleccionados.
import {
  schoolYearLabel,
  tableColumnsForRegla,
  periodDateRange,
  formatDateDMY,
  schoolYearStartYear,
  type ReglaPlanBoletin,
  REGLA_PLAN_DEFAULT,
} from '../lib/planPeriods';

interface AdminBoletinProps {
  student: StudentSearchResult;
  onClose: () => void;
}

/** Hábitos y actitudes estándar (misma lista que el boletín heredado). */
const HABITOS = [
  'RESPONSABILIDAD',
  'PUNTUALIDAD',
  'HONRADEZ',
  'CONCIENCIA CÍVICA',
  'ORGANIZACIÓN DEL TRABAJO',
  'AUTOD. Y CONF. EN SÍ MISMO',
  'INICIATIVA',
  'COOPERACIÓN',
  'RESPETO A LA PROPIEDAD AJENA',
  'MODALES',
  'ORDEN Y ASEO',
  'EMPLEO DEL TIEMPO LIBRE',
];

export function AdminBoletin({ student, onClose }: AdminBoletinProps) {
  const { user } = useAuth();
  const { logoUrl: institutionLogo, planRules } = useInstitution();
  const regla: ReglaPlanBoletin = planRules?.reglaSeleccionada || REGLA_PLAN_DEFAULT;

  const [report, setReport] = useState<InstitutionalReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  // Ponderación institucional (teórica/práctica/apreciativa) para la nota de
  // cada sub-periodo. Se lee de adminGetSchoolConfig (default 30/60/10).
  const [gradingWeight, setGradingWeight] = useState<GradingWeight>(DEFAULT_GRADING_WEIGHT);
  // Sub-conjunto de periodos seleccionados por el docente (null = todos).
  const [selectedKeys, setSelectedKeys] = useState<string[] | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // El boletín se genera con TODOS los datos (period = null) y la selección de
  // periodos se aplica en el cliente (las Cloud Functions no cambian).
  const reportLogo = report?.schoolConfig?.logoUrl || institutionLogo || '';
  const planLabel = REGLA_PLAN_LABEL[regla] || regla;

  // Foco inicial en el diálogo (navegación por teclado).
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

  // Ponderación de la institución (gradingWeight) para el cálculo por
  // categorías (teórica/práctica/apreciativa). POLÍTICA INSTITUCIONAL: el
  // boletín usa SIEMPRE la ponderación institucional (fuente autoritativa,
  // editada solo por el admin); nunca una ponderación local obsoleta del
  // docente. Ver getEffectiveGradingWeight en gradingUtils.
  useEffect(() => {
    let cancelled = false;
    adminGetSchoolConfig()
      .then((res) => {
        if (!cancelled && res.gradingWeight) setGradingWeight(res.gradingWeight);
      })
      .catch((err: any) => {
        console.warn('No se pudo leer gradingWeight para el boletín:', err?.message || err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Columnas del plan (todos los periodos disponibles para la selección).
  // Para semanal/mensual se derivan de los registros del estudiante.
  const allColumns = useMemo(
    () => (report ? tableColumnsForRegla(regla, report.memberships) : tableColumnsForRegla(regla)),
    [regla, report],
  );

  // Si cambia la regla o los datos y la selección actual quedó vacía/obsoleta,
  // volver a "todos los periodos".
  useEffect(() => {
    setSelectedKeys((prev) => {
      if (prev && prev.length > 0 && allColumns.some((c) => prev.includes(c.key))) return prev;
      return allColumns.map((c) => c.key);
    });
  }, [allColumns]);

  const togglePeriod = (key: string) => {
    setSelectedKeys((prev) => {
      const cur = prev && prev.length > 0 ? prev : allColumns.map((c) => c.key);
      if (cur.includes(key)) {
        if (cur.length <= 1) return cur; // siempre al menos un periodo
        return cur.filter((k) => k !== key);
      }
      return [...cur, key];
    });
  };

  // Recarga los datos al cambiar de estudiante o al reintentar.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setReport(null);
    loadInstitutionalReport(
      { studentId: student.studentId, period: null },
      { uid: user?.uid || '', isAdmin: true },
    )
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((err: any) => {
        console.error('loadInstitutionalReport error:', err);
        if (!cancelled) setError(err?.message || 'No se pudo cargar el boletín.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.studentId, user?.uid, reloadTick]);

  const handleExport = async () => {
    if (!report) return;
    setExporting(true);
    try {
      const label = regla;
      const safeName = `${report.student.firstName}-${report.student.lastName}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9_-]/gi, '')
        .toLowerCase();
      await exportInstitutionalReport('admin-boletin-report', `boletin-${safeName}-${label}.pdf`);
      showToast('success', 'Boletín exportado en PDF.');
    } catch (err: any) {
      console.error('exportInstitutionalReport error:', err);
      showToast('error', err?.message || 'No se pudo exportar el boletín.');
    } finally {
      setExporting(false);
    }
  };

  const handleExportJSON = () => {
    if (!report || !planTable) return;
    const boletinJSON = {
      version: '3.0',
      exportedAt: new Date().toISOString(),
      student: report.student,
      institution: {
        name: report.institutionName,
        logoUrl: report.schoolConfig?.logoUrl,
        primaryColor: report.schoolConfig?.primaryColor,
      },
      plan: { regla, label: planLabel },
      anioLectivo,
      grupo: buildGrupoLabel(report.memberships),
      memberships: report.memberships.map((m) => ({
        subjectId: m.subjectId,
        subjectName: m.subjectName,
        periodo: m.periodo,
        teacherName: m.teacherName,
        evaluations: m.evaluations,
        avgPct: m.avgPct,
        attendance: m.attendance,
        attendanceRecords: m.attendanceRecords,
        grado: m.grado,
        seccion: m.seccion,
      })),
      planTable: {
        columns: planTable.columns,
        rows: planTable.rows.map((r) => ({
          subjectName: r.subjectName,
          grades: r.grades,
          final: r.final,
          attendance: r.attendance,
        })),
        totals: planTable.totals,
      },
      habits: HABITOS,
      observations: report.observations || [],
      summary: {
        general: planTable.totals.overall,
        aprobadas: planTable.rows.filter((r) => (r.final ?? 0) >= 60).length,
        reprobadas: planTable.rows.filter((r) => (r.final ?? 0) < 60).length,
        total: planTable.rows.length,
      },
    };

    const safeName = `${report.student.firstName}-${report.student.lastName}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]/gi, '')
      .toLowerCase();

    const blob = new Blob([JSON.stringify(boletinJSON, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `boletin-${safeName}-${regla}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Boletín exportado en formato JSON.');
  };

  // Tabla plan-adaptive: columnas de calificaciones + asistencia por sub-periodo
  // del plan, limitadas a los periodos seleccionados y con nota ponderada por
  // categorías (gradingWeight).
  const planTable = useMemo(() => {
    if (!report) return null;
    const keys = selectedKeys && selectedKeys.length > 0 ? selectedKeys : allColumns.map((c) => c.key);
    return computePlanTable(regla, report.memberships, { selectedKeys: keys, gradingWeight });
  }, [report, regla, selectedKeys, allColumns, gradingWeight]);

  // Año Lectivo DINÁMICO: rango de fechas de los periodos seleccionados
  // (inicio del primero → fin del último). Se recalcula al cambiar la
  // selección; si no hay rango derivable, cae al año escolar estándar.
  const anioLectivo = useMemo(() => {
    const cols = planTable?.columns ?? [];
    if (cols.length === 0) return schoolYearLabel();
    const startYear = schoolYearStartYear();
    const ranges = cols
      .map((c) => periodDateRange(regla, c.key, allColumns, startYear))
      .filter((r): r is { start: string; end: string } => r !== null);
    if (ranges.length === 0) return schoolYearLabel();
    const starts = ranges.map((r) => r.start).sort();
    const ends = ranges.map((r) => r.end).sort();
    return `${formatDateDMY(starts[0])} - ${formatDateDMY(ends[ends.length - 1])}`;
  }, [planTable, regla, allColumns]);

  // Observaciones (sin filtro de periodo: se muestra el plan completo).
  const visibleObservations = useMemo(() => {
    if (!report) return { generales: [], porAsignatura: [] as typeof report.observations };
    const all = report.observations || [];
    return {
      generales: all.filter((o) => !o.subjectId),
      porAsignatura: all.filter((o) => o.subjectId),
    };
  }, [report]);

  // Columnas de hábitos: mismas que el plan (si son pocas) o una sola "PERIODO".
  const habitColumns = useMemo(() => {
    const cols = planTable?.columns.map((c) => c.label) ?? [];
    return cols.length > 0 && cols.length <= 8 ? cols : ['PERIODO'];
  }, [planTable]);

  // Resumen con totales del plan (sin asistencia global: los datos de
  // ausencias/tardanzas ya no se muestran en el boletín).
  const summary = useMemo(() => {
    const rows = planTable?.rows ?? [];
    const finals = rows.map((r) => r.final).filter((v): v is number => v !== null);
    const general = finals.length > 0
      ? Math.round((finals.reduce((a, b) => a + b, 0) / finals.length) * 10) / 10
      : null;
    const aprobadas = finals.filter((v) => v >= 60).length;
    return {
      general,
      aprobadas,
      reprobadas: finals.length - aprobadas,
      total: rows.length,
    };
  }, [planTable]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
      <div
        className="absolute inset-0 bg-[#1A3C40]/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-boletin-title"
        tabIndex={-1}
        className="relative w-full max-w-4xl max-h-[92vh] rounded-[2rem] bg-[#F0F7F4] shadow-2xl overflow-hidden outline-none flex flex-col"
      >
        {/* Encabezado (fuera del área imprimible) */}
        <div className="px-6 md:px-8 pt-6 pb-5 bg-white border-b border-neutral-100 flex flex-wrap items-center gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-[var(--institution-primary)] text-[var(--institution-primary-contrast)] flex items-center justify-center shadow-lg shrink-0">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 id="admin-boletin-title" className="text-lg font-black text-[#1A3C40] tracking-tight truncate">
                Boletín de {student.firstName} {student.lastName}
              </h3>
              <p className="text-xs text-neutral-500 font-medium mt-0.5">
                {student.cedula ? `Cédula: ${student.cedula}` : 'Sin cédula'} ·{' '}
                {student.memberships.length} asignatura{student.memberships.length === 1 ? '' : 's'} ·{' '}
                {planLabel}
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportJSON}
              disabled={!report || loading}
              title="Exportar boletín en formato JSON"
              className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              JSON
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!report || loading || exporting}
              title="Exportar boletín en PDF (A4)"
              className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-[#1A3C40] hover:bg-[#2E7D32] text-white text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar boletín"
              title="Cerrar"
              className="shrink-0 w-10 h-10 rounded-2xl bg-neutral-50 hover:bg-neutral-100 text-[#1A3C40] flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--institution-primary)]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Selector de periodos (fuera del área imprimible): el docente elige
            uno o varios sub-periodos del plan; la tabla muestra el detalle de
            cada uno y el resumen consolidado. */}
        <div className="px-6 md:px-8 pt-4 shrink-0">
          <div className="bg-white border border-neutral-200 rounded-2xl px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 mr-1">
                Periodos:
              </span>
              {allColumns.map((c) => {
                const active = selectedKeys?.includes(c.key) ?? true;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => togglePeriod(c.key)}
                    aria-pressed={active}
                    title={active ? `Quitar ${c.label}` : `Agregar ${c.label}`}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-[var(--institution-primary)] ${
                      active
                        ? 'bg-[#1A3C40] text-white'
                        : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
                    }`}
                  >
                    {active && <Check className="w-3 h-3" />}
                    {c.label}
                  </button>
                );
              })}
              {allColumns.length === 0 && (
                <span className="text-xs font-bold text-neutral-400">Cargando periodos...</span>
              )}
            </div>
            <p className="text-[10px] font-bold text-neutral-400 mt-1.5">
              Selecciona uno o varios periodos ({planLabel}). La tabla muestra el detalle de cada
              uno y una fila consolidada de promedios finales.
            </p>
          </div>
        </div>

        {/* Contenido */}
        <div className="p-6 md:p-8 overflow-y-auto flex-1">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-10 h-10 text-[var(--institution-primary)] animate-spin mb-4" />
              <p className="text-sm font-bold text-[#1A3C40]">Cargando boletín...</p>
            </div>
          )}

          {!loading && error && (
            <div className="bg-white border border-red-100 rounded-[2rem] p-10 text-center">
              <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-6" />
              <p className="text-lg font-black text-[#1A3C40] mb-2">Error al cargar el boletín</p>
              <p className="text-sm text-neutral-500 font-medium">{error}</p>
              <button
                type="button"
                onClick={() => setReloadTick((t) => t + 1)}
                className="mt-6 inline-flex items-center gap-2 bg-[#1A3C40] hover:bg-[#0E2A2E] text-white px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95"
              >
                <RefreshCw className="w-4 h-4" />
                Reintentar
              </button>
            </div>
          )}

          {!loading && report && (
            <div className="space-y-4">
              {/* ── Área imprimible / exportable (UNA página A4) ────────────
                  Estilo de documento: fondo blanco, texto #1A3C40, tablas con
                  borde 1px #4A5568, sin sombras ni fondos de color. Todo lo
                  interactivo (botones, detalle de evaluaciones) vive FUERA. */}
              <div
                id="admin-boletin-report"
                className="report-container boletin-a4 mx-auto bg-white text-[#1A3C40] p-6"
              >
                {/* Encabezado institucional: logo opcional centrado (sin logo
                    solo se muestra el nombre; no desalinea el bloque). NO se
                    repite el plan ni el año escolar (ya van en su lugar: plan
                    sobre las tablas y rango dinámico en "Año Lectivo"). */}
                <div className="text-center border-b-2 border-[#1A3C40] pb-2 mb-3">
                  {reportLogo && (
                    <img
                      src={reportLogo}
                      alt={report.institutionName || 'Institución'}
                      className="mx-auto mb-1 h-14 object-contain"
                    />
                  )}
                  <h4 className="text-xl font-black uppercase tracking-tight leading-tight">
                    {report.institutionName || 'Institución'}
                  </h4>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-neutral-600 mt-0.5">
                    Boletín de calificaciones
                  </p>
                </div>

                {/* Datos del estudiante (grid 3×2). "Año Lectivo" es el rango de
                    fechas de los PERIODOS seleccionados (inicio del primero a
                    fin del último); "Grupo" se arma con los datos disponibles
                    (grado/sección derivados + turno). */}
                <div className="mb-3 grid grid-cols-3 gap-x-4 gap-y-0.5 border border-[#4A5568] p-2 text-[11px] leading-tight">
                  <div>
                    <span className="font-bold">Nombre:</span>{' '}
                    {report.student.firstName} {report.student.lastName}
                  </div>
                  <div>
                    <span className="font-bold">Cédula:</span> {report.student.cedula || '—'}
                  </div>
                  <div>
                    <span className="font-bold">Año Lectivo:</span> {anioLectivo}
                  </div>
                  <div>
                    <span className="font-bold">Grupo:</span>{' '}
                    {buildGrupoLabel(report.memberships)}
                  </div>
                  <div>
                    <span className="font-bold">Consejero:</span> —
                  </div>
                  <div>
                    <span className="font-bold">Fecha:</span>{' '}
                    {new Date().toLocaleDateString('es-ES')}
                  </div>
                </div>

                {report.memberships.length === 0 ? (
                  <div className="text-center py-8 text-xs font-bold text-neutral-500">
                    El estudiante no tiene datos académicos registrados.
                  </div>
                ) : planTable ? (
                  <>
                    {/* Título del plan sobre las tablas (área imprimible). No
                        desalinea las tablas: es un párrafo independiente con
                        margen propio y centrado. */}
                    <p className="mb-1 mt-0 text-center text-xs font-black uppercase tracking-[0.2em] text-[#1A3C40]">
                      {planLabel.toUpperCase()}
                    </p>

                    {/* Calificaciones (izquierda) + Asistencia (derecha), en
                        paralelo. La tabla de asistencia usa SOLO columnas A/T
                        por sub-periodo del plan (sin ausencias ni totales). */}
                    <div className="flex gap-px mb-3">
                      <table className="w-full border-collapse text-[10px]">
                        <thead>
                          <tr>
                            <th className="border border-[#4A5568] px-1 py-0.5 text-left font-bold uppercase">
                              Asignatura
                            </th>
                            {planTable.columns.map((c) => (
                              <th
                                key={c.key}
                                className="border border-[#4A5568] px-1 py-0.5 text-center font-bold uppercase"
                              >
                                {c.label}
                              </th>
                            ))}
                            <th className="border border-[#4A5568] px-1 py-0.5 text-center font-bold uppercase">
                              Nota
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {planTable.rows.map((r, i) => (
                            <tr key={i}>
                              <td className="border border-[#4A5568] px-1 py-0.5 text-left">
                                {r.subjectName}
                              </td>
                              {planTable.columns.map((c) => (
                                <td
                                  key={c.key}
                                  className="border border-[#4A5568] px-1 py-0.5 text-center"
                                >
                                  {r.grades[c.key] === null ? '—' : r.grades[c.key]}
                                </td>
                              ))}
                              <td className="border border-[#4A5568] px-1 py-0.5 text-center font-bold">
                                {r.final === null ? '—' : r.final}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        {/* Resumen HORIZONTAL: promedio final por columna (vertical)
                            + promedio consolidado de los periodos mostrados. */}
                        <tfoot>
                          <tr>
                            <td className="border border-[#4A5568] px-1 py-0.5 text-left font-bold">
                              Promedio final
                            </td>
                            {planTable.columns.map((c) => (
                              <td
                                key={c.key}
                                className="border border-[#4A5568] px-1 py-0.5 text-center font-bold"
                              >
                                {planTable.totals.byColumn[c.key] === null
                                  ? '—'
                                  : planTable.totals.byColumn[c.key]}
                              </td>
                            ))}
                            <td className="border border-[#4A5568] px-1 py-0.5 text-center font-bold">
                              {planTable.totals.overall === null ? '—' : planTable.totals.overall}
                            </td>
                          </tr>
                        </tfoot>
                      </table>

                      <table className="w-full border-collapse text-[10px]">
                        <thead>
                          <tr>
                            {planTable.columns.map((c, idx) => (
                              <React.Fragment key={c.key}>
                                <th className="border border-[#4A5568] px-0.5 py-0.5 text-center font-bold uppercase">
                                  A{idx + 1}
                                </th>
                                <th className="border border-[#4A5568] px-0.5 py-0.5 text-center font-bold uppercase">
                                  T{idx + 1}
                                </th>
                              </React.Fragment>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {planTable.rows.map((r, i) => (
                            <tr key={i}>
                              {planTable.columns.map((c) => (
                                <React.Fragment key={c.key}>
                                  <td className="border border-[#4A5568] px-0.5 py-0.5 text-center">
                                    {r.attendance[c.key]?.present || ''}
                                  </td>
                                  <td className="border border-[#4A5568] px-0.5 py-0.5 text-center">
                                    {r.attendance[c.key]?.late || ''}
                                  </td>
                                </React.Fragment>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Hábitos y actitudes: debajo de ambas tablas, ancho
                        completo. Grid en blanco (el modelo moderno no persiste
                        hábitos; se deja para llenar a mano — misma decisión que
                        el boletín heredado). */}
                    <div className="mb-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.15em] mb-1">
                        Hábitos y actitudes
                      </p>
                      <table className="w-full border-collapse text-[10px]">
                        <thead>
                          <tr>
                            <th className="border border-[#4A5568] px-1 py-0.5 text-left font-bold">
                              Hábitos
                            </th>
                            {habitColumns.map((h) => (
                              <th
                                key={h}
                                className="border border-[#4A5568] px-1 py-0.5 text-center font-bold w-12"
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {HABITOS.map((h) => (
                            <tr key={h}>
                              <td className="border border-[#4A5568] px-1 py-0.5">{h}</td>
                              {habitColumns.map((col) => (
                                <td
                                  key={col}
                                  className="border border-[#4A5568] px-1 py-0.5 text-center"
                                />
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Resumen con totales del plan (sin %; el rango del año
                        lectivo ya se muestra en los datos del estudiante). */}
                    <div className="mb-3 border border-[#4A5568] p-2 text-[10px]">
                      <p className="font-black uppercase tracking-[0.15em] mb-1">
                        Resumen del {planLabel} · {anioLectivo}
                      </p>
                      <div className="grid grid-cols-4 gap-2">
                        <div>
                          <span className="font-bold">Promedio general:</span>{' '}
                          {summary.general === null ? '—' : summary.general}
                        </div>
                        <div>
                          <span className="font-bold">Aprobadas:</span> {summary.aprobadas}
                        </div>
                        <div>
                          <span className="font-bold">Reprobadas:</span> {summary.reprobadas}
                        </div>
                        <div>
                          <span className="font-bold">Total asignaturas:</span> {summary.total}
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}

                {/* Observaciones del boletín (generales primero, luego por
                    asignatura; etiquetadas con su autor) */}
                <div className="mb-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.15em] mb-1">
                    Observaciones
                  </p>
                  {visibleObservations.generales.length === 0 &&
                  visibleObservations.porAsignatura.length === 0 ? (
                    <div className="border border-[#4A5568] h-14" />
                  ) : (
                    <div className="space-y-1 text-[10px] leading-tight">
                      {visibleObservations.generales.map((o) => (
                        <div key={o.id} className="border border-[#4A5568] p-1">
                          <span className="font-bold">Docente consejero ({o.authorName}):</span>{' '}
                          {o.text}
                        </div>
                      ))}
                      {visibleObservations.porAsignatura.map((o) => (
                        <div key={o.id} className="border border-[#4A5568] p-1">
                          <span className="font-bold">
                            {o.subjectName || 'Asignatura'} ({o.authorName}):
                          </span>{' '}
                          {o.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Firmas */}
                <div className="flex justify-between pt-2">
                  <div className="text-center">
                    <div className="h-8 w-48 border-b border-[#1A3C40]" />
                    <p className="text-[10px] mt-0.5">Profesor consejero</p>
                  </div>
                  <div className="text-center">
                    <div className="h-8 w-48 border-b border-[#1A3C40]" />
                    <p className="text-[10px] mt-0.5">Director</p>
                  </div>
                </div>
              </div>

              {/* Detalle interactivo de evaluaciones (fuera del área
                  imprimible para no romper la página única del PDF) */}
              {report.memberships.length > 0 && (
                <details className="bg-white border border-neutral-200 rounded-[2rem] shadow-sm overflow-hidden">
                  <summary className="flex items-center gap-3 px-6 py-4 cursor-pointer select-none hover:bg-neutral-50 transition-colors">
                    <BookOpen className="w-5 h-5 text-[#1A3C40]" />
                    <span className="text-sm font-black text-[#1A3C40] tracking-tight">
                      Evaluaciones detalladas por asignatura
                    </span>
                    <ChevronDown className="w-4 h-4 text-neutral-400 ml-auto" />
                  </summary>
                  <div className="px-6 pb-6 space-y-4">
                    {report.memberships.map((m) => (
                      <div
                        key={`ev-${m.teacherUid}-${m.subjectId}`}
                        className="rounded-2xl border border-neutral-200 overflow-hidden"
                      >
                        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-neutral-50 border-b border-neutral-100">
                          <BookOpen className="w-4 h-4 text-neutral-400" />
                          <span className="text-xs font-black text-[#1A3C40]">{m.subjectName}</span>
                          <span className="text-xs font-bold text-neutral-400">· {m.teacherName}</span>
                        </div>
                        {m.evaluations.length === 0 ? (
                          <p className="px-4 py-3 text-xs font-bold text-neutral-400">
                            Sin evaluaciones registradas.
                          </p>
                        ) : (
                          <table className="w-full text-left">
                            <thead>
                              <tr className="bg-white border-b border-neutral-100">
                                <th className="px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">
                                  Evaluación
                                </th>
                                <th className="px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">
                                  Tipo
                                </th>
                                <th className="px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">
                                  Fecha
                                </th>
                                <th className="px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-center">
                                  Nota
                                </th>
                                <th className="px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-center">
                                  Promedio
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-50 bg-white">
                              {m.evaluations.map((ev) => (
                                <tr key={ev.evaluationId}>
                                  <td className="px-4 py-2 text-xs font-bold text-neutral-700">{ev.title}</td>
                                  <td className="px-4 py-2 text-xs font-bold text-neutral-500 capitalize">
                                    {ev.type === 'teorica'
                                      ? 'Teórica'
                                      : ev.type === 'practica'
                                        ? 'Práctica'
                                        : 'Apreciativa'}
                                  </td>
                                  <td className="px-4 py-2 text-xs font-bold text-neutral-500">
                                    {ev.date ? ev.date.split('-').reverse().join('/') : '—'}
                                  </td>
                                  <td className="px-4 py-2 text-center text-xs font-black text-[#1A3C40]">
                                    {ev.score !== null ? `${ev.score}/${ev.maxScore}` : '—'}
                                  </td>
                                  <td className="px-4 py-2 text-center text-xs font-black text-[var(--institution-primary)]">
                                    {ev.scorePct !== null ? ev.scorePct : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Acciones (fuera del área exportable) */}
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={exporting}
                  className="inline-flex items-center gap-2 bg-[#1A3C40] hover:bg-[#0E2A2E] disabled:opacity-50 text-white px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-[#1A3C40]/20 focus:outline-none focus:ring-2 focus:ring-[var(--institution-primary)]"
                >
                  {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  {exporting ? 'Exportando...' : 'Exportar PDF'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-2 bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-600 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-[var(--institution-primary)]"
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
