/**
 * InstitutionalReport.tsx — Fase 2 del nuevo boletín institucional.
 *
 * Documento de solo lectura (para imprimir/exportar a PDF) que se alimenta de
 * la capa híbrida de consultas dinámicas (src/lib/institutionalReport.ts):
 *  - Admin: datos consolidados de la institución vía Cloud Functions
 *    (adminGetStudentBoletin + schoolConfig con nombre/logo de la institución).
 *  - Docente: su propia data offline (Dexie) con fallback Firestore.
 *
 * El área imprimible es exclusivamente `.report-container`: dentro NO hay
 * botones, iconos ni enlaces. El botón de impresión y demás UI interactiva
 * viven fuera con la clase `.no-print`.
 */

import { useEffect, useMemo, useState } from 'react';
import html2pdf from 'html2pdf.js';
import { useAuth } from './AuthProvider';
import { usePlan } from '../hooks/usePlan';
import {
  loadInstitutionalReport,
  PERIODO_LABEL,
  type InstitutionalReportData,
  type InstitutionalReportFilters,
} from '../lib/institutionalReport';

const INK = '#1A3C40';
const LINE = '#E0E0E0';

// Ítems reglamentarios de la tabla de hábitos y actitudes (escala S/R/X).
const HABITOS_ESTANDAR = [
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

interface InstitutionalReportProps {
  filters: InstitutionalReportFilters;
  onBack: () => void;
  /** Bloque opcional renderizado FUERA del documento (ej. AI Insights actual). */
  insightsSlot?: React.ReactNode;
}

export function InstitutionalReport({ filters, onBack, insightsSlot }: InstitutionalReportProps) {
  const { user } = useAuth();
  const { profile, isAdmin, loading: loadingPlan } = usePlan();

  const [data, setData] = useState<InstitutionalReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const ctx = useMemo(
    () => ({
      uid: user?.uid || null,
      isAdmin,
      institutionName: profile?.institutionName || '',
      schoolId: profile?.institutionId || filters.schoolId || undefined,
    }),
    [user, isAdmin, profile, filters.schoolId],
  );

  useEffect(() => {
    if (loadingPlan) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);
    loadInstitutionalReport(filters, ctx)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: any) => {
        console.error('loadInstitutionalReport error:', err);
        if (!cancelled) setError(err?.message || 'No se pudo generar el reporte.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.studentId, filters.grado, filters.periodo, loadingPlan, ctx.isAdmin]);

  const reload = () => {
    setLoading(true);
    setError('');
    loadInstitutionalReport(filters, ctx)
      .then(setData)
      .catch((err: any) => setError(err?.message || 'No se pudo generar el reporte.'))
      .finally(() => setLoading(false));
  };

  const exportPdf = async () => {
    if (exporting || !data) return;
    const element = document.getElementById('boletin-documento');
    if (!element) return;

    setExporting(true);
    try {
      const fileName = `Boletín_${data.student.lastName || 'estudiante'}_${new Date().toISOString().slice(0, 10)}.pdf`;
      await html2pdf()
        .set({
          margin: 10,
          filename: fileName,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(element)
        .save();
    } catch (err) {
      console.error('Error exportando PDF:', err);
      alert('No se pudo generar el PDF. Intente imprimir y usar "Guardar como PDF".');
    } finally {
      setExporting(false);
    }
  };

  // ── Derivados del documento ──
  const gradosUnicos = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const m of data.memberships) {
      if (m.grado) set.add(m.grado);
    }
    return Array.from(set);
  }, [data]);

  const seccionesUnicas = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const m of data.memberships) {
      if (m.seccion) set.add(m.seccion);
    }
    return Array.from(set);
  }, [data]);

  const gradoMostrado = filters.grado || gradosUnicos.join(', ') || '—';

  const promedioFila = useMemo(() => {
    if (!data) return null;
    const avgs = data.memberships.map((m) => m.avgPct).filter((v): v is number => v !== null);
    if (avgs.length === 0) return null;
    return avgs.reduce((a, b) => a + b, 0) / avgs.length;
  }, [data]);

  const anioLectivo = useMemo(() => {
    const y = new Date().getFullYear();
    return `${y - 1}-${y}`;
  }, []);

  const issuedAt = useMemo(() => {
    return new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
  }, []);

  const periodoMostrado = useMemo(() => {
    if (filters.periodo) return PERIODO_LABEL[filters.periodo] || filters.periodo;
    if (!data) return '—';
    const turnos = new Set(data.memberships.map((m) => m.periodo).filter(Boolean) as string[]);
    if (turnos.size === 1) return PERIODO_LABEL[Array.from(turnos)[0]] || Array.from(turnos)[0];
    return turnos.size > 1 ? 'Todos los turnos' : '—';
  }, [filters.periodo, data]);

  const fmtNota = (v: number | null) => (v !== null ? v.toLocaleString('es-ES', { maximumFractionDigits: 1 }) : '—');

  const grupoMostrado = [gradoMostrado, seccionesUnicas.length > 0 ? `Sección ${seccionesUnicas.join(', ')}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-6 print:space-y-0">
      {/* ── Barra de acciones: fuera del área imprimible ── */}
      <div className="no-print mx-auto w-full max-w-4xl flex flex-wrap items-center justify-between gap-4">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-black text-blue-600 hover:text-blue-700 transition-colors"
        >
          <span aria-hidden>←</span>
          Volver a resultados
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-900 transition-colors"
            disabled={exporting}
          >
            Imprimir
          </button>
          <button
            onClick={exportPdf}
            disabled={exporting}
            className="rounded-md bg-[#1A3C40] px-4 py-2 text-sm font-medium text-white hover:bg-[#0E2A2E] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Generando...
              </>
            ) : (
              'Exportar PDF'
            )}
          </button>
        </div>
      </div>

      {loading && (
        <div className="no-print mx-auto w-full max-w-4xl bg-white border border-neutral-200 rounded-[2rem] shadow-sm">
          <div className="flex flex-col items-center justify-center py-24">
            <div className="w-10 h-10 border-4 border-neutral-200 border-t-[#1A3C40] rounded-full animate-spin mb-4" />
            <p className="text-sm font-bold text-neutral-500">Generando reporte...</p>
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="no-print mx-auto w-full max-w-4xl bg-white border border-neutral-200 rounded-[2rem] p-12 text-center shadow-sm">
          <p className="text-4xl mb-4" aria-hidden>⚠</p>
          <p className="text-lg font-black text-neutral-900 mb-2">Error al generar el reporte</p>
          <p className="text-sm text-neutral-500 font-medium">{error}</p>
          <button
            onClick={reload}
            className="mt-6 inline-flex items-center gap-2 bg-[#1A3C40] hover:opacity-90 text-white px-5 py-2.5 rounded-md text-xs font-black uppercase tracking-widest transition-all active:scale-95"
          >
            Reintentar
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* ── Contenedor del boletín (área imprimible, solo lectura) ── */}
          <div
            id="boletin-documento"
            className="report-container mx-auto w-full max-w-4xl rounded-[2rem] border border-neutral-200 shadow-sm print:rounded-none print:border-none print:shadow-none overflow-hidden"
          >
            {/* Encabezado institucional (dinámico desde schoolConfig) */}
            <header className="px-8 pt-8 pb-6 text-center border-b print:px-4" style={{ borderColor: LINE }}>
              <div className="flex flex-col items-center gap-2">
                {data.schoolConfig?.logoUrl ? (
                  <img
                    src={data.schoolConfig.logoUrl}
                    alt="Logo institucional"
                    className="mx-auto mb-1 h-20 object-contain"
                  />
                ) : (
                  <div
                    className="mx-auto mb-1 w-20 h-20 rounded-full flex items-center justify-center text-white font-bold text-3xl"
                    style={{ backgroundColor: INK, fontFamily: 'Outfit, sans-serif' }}
                  >
                    {(data.institutionName || 'E').charAt(0).toUpperCase()}
                  </div>
                )}
                <h1 className="text-2xl font-bold uppercase tracking-wide" style={{ fontFamily: 'Outfit, sans-serif' }}>
                  {data.institutionName || 'Nombre de la Institución'}
                </h1>
                {data.schoolConfig?.slogan && (
                  <p className="text-sm italic" style={{ color: '#6b7a7d' }}>
                    {data.schoolConfig.slogan}
                  </p>
                )}
                <h2 className="mt-1 text-lg font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>
                  BOLETÍN DE CALIFICACIONES
                </h2>
                <p className="text-sm uppercase">
                  Turno: {periodoMostrado} · Año lectivo {anioLectivo}
                </p>
              </div>
            </header>

            {/* Datos del estudiante */}
            <section className="px-8 py-6 print:px-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 border p-4 text-sm" style={{ borderColor: LINE }}>
                {[
                  { label: 'Nombre:', value: `${data.student.firstName} ${data.student.lastName}` },
                  { label: 'Año Lectivo:', value: anioLectivo },
                  { label: 'Cédula:', value: data.student.cedula || '—' },
                  { label: 'Fecha:', value: issuedAt },
                  { label: 'Grupo:', value: grupoMostrado },
                  { label: 'Consejero:', value: data.schoolConfig?.directorName || '—' },
                  { label: 'Plan:', value: '—' },
                  { label: 'Pasaporte:', value: '—' },
                ].map((row) => (
                  <div key={row.label}>
                    <span className="font-semibold">{row.label}</span>{' '}
                    <span className="font-normal">{row.value}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Tabla de asignaturas */}
            <section className="px-8 pb-6 print:px-4">
              <h3 className="mb-2 text-base font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>
                Asignaturas
              </h3>
              <table className="w-full border-collapse text-sm" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ border: `1px solid ${LINE}` }}>
                    <th className="border px-2 py-1.5 text-left font-bold uppercase tracking-wide" style={{ borderColor: LINE, background: '#f5f6f6' }}>Asignatura</th>
                    <th className="border px-2 py-1.5 font-bold uppercase tracking-wide hidden sm:table-cell" style={{ borderColor: LINE, background: '#f5f6f6' }}>Docente</th>
                    <th className="border px-2 py-1.5 font-bold uppercase tracking-wide" style={{ borderColor: LINE, background: '#f5f6f6' }}>Nota</th>
                    <th className="border px-2 py-1.5 font-bold uppercase tracking-wide" style={{ borderColor: LINE, background: '#f5f6f6' }}>Asistencias</th>
                    <th className="border px-2 py-1.5 font-bold uppercase tracking-wide" style={{ borderColor: LINE, background: '#f5f6f6' }}>Tardanzas</th>
                    <th className="border px-2 py-1.5 font-bold uppercase tracking-wide" style={{ borderColor: LINE, background: '#f5f6f6' }}>Ausencias</th>
                  </tr>
                </thead>
                <tbody>
                  {data.memberships.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-sm font-medium border" style={{ borderColor: LINE, color: '#6b7a7d' }}>
                        Sin asignaturas para los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    data.memberships.map((m) => (
                      <tr key={m.subjectId}>
                        <td className="border px-2 py-1.5 font-semibold" style={{ borderColor: LINE }}>
                          {m.subjectName}
                          {m.grado ? (
                            <span className="ml-1 text-xs font-medium" style={{ color: '#6b7a7d' }}>
                              · {m.grado}
                              {m.seccion ? ` · Sección ${m.seccion}` : ''}
                            </span>
                          ) : null}
                        </td>
                        <td className="border px-2 py-1.5 hidden sm:table-cell" style={{ borderColor: LINE, color: '#4a5f63' }}>
                          {m.teacherName}
                        </td>
                        <td className="border px-2 py-1.5 text-center font-bold" style={{ borderColor: LINE }}>
                          {fmtNota(m.avgPct)}
                        </td>
                        <td className="border px-2 py-1.5 text-center" style={{ borderColor: LINE }}>{m.attendance.present}</td>
                        <td className="border px-2 py-1.5 text-center" style={{ borderColor: LINE }}>{m.attendance.late}</td>
                        <td className="border px-2 py-1.5 text-center" style={{ borderColor: LINE }}>{m.attendance.absent}</td>
                      </tr>
                    ))
                  )}
                  {data.memberships.length > 0 && (
                    <tr className="font-semibold">
                      <td colSpan={2} className="border px-2 py-1.5 text-right font-bold uppercase tracking-wide" style={{ borderColor: LINE, background: '#f5f6f6' }}>
                        Promedio
                      </td>
                      <td className="border px-2 py-1.5 text-center font-bold" style={{ borderColor: LINE, background: '#f5f6f6' }}>
                        {promedioFila !== null ? fmtNota(promedioFila) : '—'}
                      </td>
                      <td colSpan={3} className="border px-2 py-1.5" style={{ borderColor: LINE, background: '#f5f6f6' }} />
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            {/* Tabla de hábitos y actitudes */}
            <section className="px-8 pb-6 print:px-4">
              <h3 className="mb-2 text-base font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>
                Hábitos y Actitudes
              </h3>
              <table className="w-full border-collapse text-sm" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ border: `1px solid ${LINE}` }}>
                    <th className="border px-2 py-1.5 text-left font-bold uppercase tracking-wide" style={{ borderColor: LINE, background: '#f5f6f6' }}>
                      Hábitos y actitudes
                    </th>
                    <th className="border px-2 py-1.5 font-bold uppercase tracking-wide w-16" style={{ borderColor: LINE, background: '#f5f6f6' }}>S</th>
                    <th className="border px-2 py-1.5 font-bold uppercase tracking-wide w-16" style={{ borderColor: LINE, background: '#f5f6f6' }}>R</th>
                    <th className="border px-2 py-1.5 font-bold uppercase tracking-wide w-16" style={{ borderColor: LINE, background: '#f5f6f6' }}>X</th>
                  </tr>
                </thead>
                <tbody>
                  {HABITOS_ESTANDAR.map((habit) => (
                    <tr key={habit}>
                      <td className="border px-2 py-1.5" style={{ borderColor: LINE }}>{habit}</td>
                      <td className="border px-2 py-1.5 text-center" style={{ borderColor: LINE }}>{''}</td>
                      <td className="border px-2 py-1.5 text-center" style={{ borderColor: LINE }}>{''}</td>
                      <td className="border px-2 py-1.5 text-center" style={{ borderColor: LINE }}>{''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* Observaciones */}
            <section className="px-8 pb-6 print:px-4">
              <h3 className="mb-2 text-base font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>
                Observaciones
              </h3>
              <div className="h-24 border p-2" style={{ borderColor: LINE }} />
            </section>

            {/* Firmas */}
            <footer className="px-8 pb-6 print:px-4">
              <div className="flex justify-between gap-8">
                <div className="text-center flex-1">
                  <div className="mb-2 h-10 w-full max-w-64 mx-auto border-b" style={{ borderColor: '#9db0b3' }} />
                  <p className="text-sm">Profesor consejero</p>
                </div>
                <div className="text-center flex-1">
                  <div className="mb-2 h-10 w-full max-w-64 mx-auto border-b" style={{ borderColor: '#9db0b3' }} />
                  <p className="text-sm">Director</p>
                </div>
              </div>
            </footer>

            {/* Leyenda */}
            <div className="px-8 pb-8 pt-2 text-xs border-t print:px-4" style={{ borderColor: LINE }}>
              <p className="font-bold">LEYENDA:</p>
              <p>S - Satisfactorio | R - Regular | X - No Satisface</p>
              <p>5 - Excelente | 4 - Bueno | 3 - Regular | 2 - Apenas Regular | 1 - Mala</p>
            </div>
          </div>
        </>
      )}

      {/* Contenido externo al documento (no se imprime) */}
      {!loading && !error && data && insightsSlot && (
        <div className="no-print mx-auto w-full max-w-4xl">{insightsSlot}</div>
      )}
    </div>
  );
}
