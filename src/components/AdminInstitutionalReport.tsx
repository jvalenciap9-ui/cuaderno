import type {
  AdminInstitutionAlertsResponse,
  InstitutionAlertType,
  InstitutionalMetrics,
  InstitutionalRiskLevel,
  InstitutionalRiskStudentRow,
  SchoolConfig,
  SubjectMetric,
  TeacherSummary,
} from '../lib/adminApi';
import { TURNO_LABEL, NIVEL_LABEL } from '../lib/dashboardFilters';

/**
 * AdminInformeReport — documento del "Informe Institucional PDF".
 *
 * Contenedor fijo de 794px (A4 @96dpi) que vive OFF-SCREEN dentro de
 * AdminDashboard; `exportInstitutionalReport('admin-informe-report', ...)`
 * lo captura con html2canvas-pro. Usa SOLO colores literales (hex), nunca
 * CSS vars de institución, para que la captura sea determinista.
 * Las tendencias son barras div/CSS (Recharts queda fuera del contenedor:
 * su render asíncrono no es fiable bajo html2canvas).
 */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const fmtFecha = (d: Date): string =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

const fmtTrendDate = (ym: string): string => {
  const [y, m] = ym.split('-');
  const idx = Number(m) - 1;
  return MESES[idx] ? `${MESES[idx]} ${(y || '').slice(2)}` : ym;
};

const fmtPct = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : `${Math.round(v)}%`;

const RISK_ORDER: Record<InstitutionalRiskLevel, number> = { high: 0, medium: 1, low: 2 };

const RISK_BADGE: Record<InstitutionalRiskLevel, string> = {
  high: 'bg-[#D32F2F] text-white',
  medium: 'bg-[#FFC107] text-[#1A3C40]',
  low: 'bg-[#2E7D32] text-white',
};

const RISK_LABEL: Record<InstitutionalRiskLevel, string> = { high: 'Alto', medium: 'Medio', low: 'Bajo' };

const ALERT_TYPE_LABEL: Record<InstitutionAlertType, string> = {
  student_grades: 'Notas bajas',
  student_attendance: 'Asistencia baja',
  group_grades: 'Grupo con notas bajas',
  group_attendance: 'Grupo con asistencia baja',
  teacher_inactive: 'Docente inactivo',
};

function SectionTitle({ num, title }: { num: string; title: string }) {
  return (
    <div className="flex items-center gap-2 bg-[#F0F7F4] border border-[#DCE8E3] rounded-md px-2.5 py-1.5 mb-2">
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#FFC107] text-[#1A3C40] text-[10px] font-black">
        {num}
      </span>
      <h5 className="text-[12px] font-black uppercase tracking-widest text-[#1A3C40]">{title}</h5>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-[#DCE8E3] rounded-lg px-2.5 py-1.5 bg-white">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#5C736D] leading-tight">{label}</p>
      <p className="text-[19px] font-black text-[#1A3C40] leading-tight">{value}</p>
      {sub ? <p className="text-[10px] font-bold text-[#5C736D] leading-tight">{sub}</p> : null}
    </div>
  );
}

interface AdminInformeReportProps {
  metrics: InstitutionalMetrics | null;
  alerts: AdminInstitutionAlertsResponse | null;
  teachers: TeacherSummary[];
  totals: { subjects: number; students: number; evaluations: number };
  schoolConfig: SchoolConfig;
  institutionName: string;
  turno: string;
  nivelEducativo: string;
  /** Ranking de asignaturas: solo presente si adminGetInstitutionStats respondió al exportar. */
  statsSubjects: SubjectMetric[] | null;
}

export function AdminInformeReport({
  metrics,
  alerts,
  teachers,
  totals,
  schoolConfig,
  institutionName,
  turno,
  nivelEducativo,
  statsSubjects,
}: AdminInformeReportProps) {
  if (!metrics) return <div id="admin-informe-report" />;

  const activeFilters = [turno, nivelEducativo].filter(Boolean);
  const filtrosTexto = activeFilters.length
    ? `Filtros: ${activeFilters.map((f) => TURNO_LABEL[f] || NIVEL_LABEL[f] || f).join(' · ')}`
    : 'Período: general';
  const hoy = new Date();
  const riesgoTotal = metrics.riskSummary.medium + metrics.riskSummary.high;

  const trendPoints = (metrics.trends?.attendance ?? []).slice(-12);

  const riskRows: InstitutionalRiskStudentRow[] = [...metrics.atRiskStudents]
    .sort((a, b) => RISK_ORDER[a.nivelRiesgo] - RISK_ORDER[b.nivelRiesgo])
    .slice(0, 10);

  // Ranking por asignatura SOLO con datos reales del loader existente; si no
  // hubo respuesta, la sección degrada a promedio global + distribución.
  const conDatos = (statsSubjects ?? []).filter((s) => typeof s.avgPct === 'number' && s.students > 0);
  const mejores = [...conDatos].sort((a, b) => (b.avgPct as number) - (a.avgPct as number)).slice(0, 5);
  const dificiles = [...conDatos].sort((a, b) => (a.avgPct as number) - (b.avgPct as number)).slice(0, 5);

  const activos30d = teachers.filter(
    (t) => t.lastActivity && Date.now() - t.lastActivity <= 30 * 86400000,
  ).length;

  const alertList = alerts
    ? [...alerts.alerts]
        .sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1))
        .slice(0, 9)
    : [];

  const gradoEntries = Object.entries(metrics.attendance.byGrado || {});

  return (
    <div id="admin-informe-report" className="report-container informe-a4 bg-white text-[#1A3C40] p-6">
      {/* ── Encabezado ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b-2 border-[#1A3C40] pb-2 mb-3">
        <img src={schoolConfig.logoUrl || '/logo.webp'} alt="" className="h-12 w-12 object-contain shrink-0" />
        <div className="flex-1 min-w-0">
          <h4 className="text-lg font-black uppercase tracking-tight leading-tight truncate">
            {institutionName || 'Institución'}
          </h4>
          <p className="text-[11px] font-black uppercase tracking-[0.25em] text-[#5C736D]">Informe institucional</p>
        </div>
        <div className="text-right text-[10px] font-bold text-[#5C736D] leading-snug shrink-0">
          <p>Fecha de generación</p>
          <p className="text-[#1A3C40] text-[11px] font-black">{fmtFecha(hoy)}</p>
          <p className="mt-0.5">{filtrosTexto}</p>
        </div>
      </div>

      {/* ── 1. Resumen ejecutivo ───────────────────────────────────────── */}
      <SectionTitle num="1" title="Resumen ejecutivo" />
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        <KpiCard label="Docentes activos" value={String(teachers.length)} />
        <KpiCard label="Estudiantes" value={String(totals.students)} />
        <KpiCard label="Asignaturas" value={String(totals.subjects)} />
        <KpiCard label="Asistencia global" value={fmtPct(metrics.attendance.global)} />
        <KpiCard label="Promedio general" value={fmtPct(metrics.grades.global)} />
        <KpiCard
          label="Estudiantes en riesgo"
          value={String(riesgoTotal)}
          sub={`Alto ${metrics.riskSummary.high} · Medio ${metrics.riskSummary.medium} · Bajo ${metrics.riskSummary.low}`}
        />
        <KpiCard
          label="Alertas activas"
          value={String(alerts?.summary?.total ?? 0)}
          sub={alerts ? `Críticas ${alerts.summary.critical} · Advertencias ${alerts.summary.warning}` : undefined}
        />
        <KpiCard label="Evaluaciones registradas" value={String(totals.evaluations)} />
      </div>

      {/* ── 2. Asistencia ──────────────────────────────────────────────── */}
      <SectionTitle num="2" title="Asistencia" />
      <div className="grid grid-cols-2 gap-3 mb-2">
        <div className="border border-[#DCE8E3] rounded-lg p-2.5">
          <p className="text-[10px] font-black uppercase tracking-widest text-[#5C736D] mb-1.5">
            Global: <span className="text-[#1A3C40]">{fmtPct(metrics.attendance.global)}</span>
          </p>
          {(['matutino', 'vespertino', 'nocturno'] as const).map((t) => {
            const v = metrics.attendance.byTurno?.[t] ?? null;
            return (
              <div key={t} className="flex items-center gap-2 mb-1 last:mb-0">
                <span className="w-[72px] shrink-0 text-[10px] font-bold text-[#1A3C40]">{TURNO_LABEL[t]}</span>
                <div className="flex-1 h-3 bg-[#EEF3F1] rounded-sm overflow-hidden">
                  {v !== null && (
                    <div
                      className="h-full bg-[#1A3C40] rounded-sm"
                      style={{ width: `${Math.min(100, Math.max(0, v))}%` }}
                    />
                  )}
                </div>
                <span className="w-10 shrink-0 text-right text-[10px] font-black text-[#1A3C40]">{fmtPct(v)}</span>
              </div>
            );
          })}
          {gradoEntries.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2 pt-1.5 border-t border-[#EEF3F1]">
              {gradoEntries.map(([k, v]) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 border border-[#DCE8E3] rounded-full px-2 py-0.5 text-[10px] font-bold text-[#1A3C40]"
                >
                  {NIVEL_LABEL[k] || k}: <span className="font-black">{fmtPct(v)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="border border-[#DCE8E3] rounded-lg p-2.5">
          <p className="text-[10px] font-black uppercase tracking-widest text-[#5C736D] mb-1.5">
            Tendencia de asistencia
          </p>
          {trendPoints.length > 0 ? (
            <>
              <div className="flex items-end gap-1 h-14">
                {trendPoints.map((p) => (
                  <div key={p.date} className="flex-1 h-full flex flex-col justify-end">
                    <div
                      className="w-full rounded-t-sm bg-[#2E7D32]"
                      style={{ height: `${Math.max(4, Math.min(100, p.value))}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[10px] font-bold text-[#5C736D] mt-0.5">
                <span>{fmtTrendDate(trendPoints[0].date)}</span>
                <span>{fmtTrendDate(trendPoints[trendPoints.length - 1].date)}</span>
              </div>
            </>
          ) : (
            <p className="text-[10px] font-bold text-[#5C736D]">Sin histórico suficiente.</p>
          )}
        </div>
      </div>

      {/* ── 3. Rendimiento académico ───────────────────────────────────── */}
      <SectionTitle num="3" title="Rendimiento académico" />
      <div className="border border-[#DCE8E3] rounded-lg p-2.5 mb-2">
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#5C736D]">Promedio general</p>
            <p className="text-[24px] font-black leading-tight text-[#1A3C40]">{fmtPct(metrics.grades.global)}</p>
          </div>
          <div className="flex-1">
            <div className="h-3 bg-[#EEF3F1] rounded-sm overflow-hidden">
              {metrics.grades.global !== null && (
                <div
                  className="h-full bg-[#2E7D32] rounded-sm"
                  style={{ width: `${Math.min(100, Math.max(0, metrics.grades.global))}%` }}
                />
              )}
            </div>
            <p className="text-[10px] font-bold text-[#5C736D] mt-1">
              Escala 0–100. Se considera en riesgo un promedio inferior a 60.
            </p>
          </div>
        </div>
        {mejores.length > 0 && (
          <div className="grid grid-cols-2 gap-3 mt-2 pt-2 border-t border-[#EEF3F1]">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#2E7D32] mb-1">Mejor desempeño</p>
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[#F0F7F4]">
                    <th className="px-1.5 py-1 text-[10px] font-black uppercase tracking-wider text-[#1A3C40]">Asignatura</th>
                    <th className="px-1.5 py-1 text-[10px] font-black uppercase tracking-wider text-right text-[#1A3C40]">Alum.</th>
                    <th className="px-1.5 py-1 text-[10px] font-black uppercase tracking-wider text-right text-[#1A3C40]">Prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {mejores.map((s) => (
                    <tr key={s.subjectId} className="border-b border-[#EEF3F1] last:border-0">
                      <td className="px-1.5 py-1 text-[10px] font-bold text-[#1A3C40] truncate max-w-[150px]">{s.subjectName}</td>
                      <td className="px-1.5 py-1 text-[10px] font-bold text-right text-[#5C736D]">{s.students}</td>
                      <td className="px-1.5 py-1 text-[10px] font-black text-right text-[#2E7D32]">{fmtPct(s.avgPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#D32F2F] mb-1">Requieren atención</p>
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[#F0F7F4]">
                    <th className="px-1.5 py-1 text-[10px] font-black uppercase tracking-wider text-[#1A3C40]">Asignatura</th>
                    <th className="px-1.5 py-1 text-[10px] font-black uppercase tracking-wider text-right text-[#1A3C40]">Alum.</th>
                    <th className="px-1.5 py-1 text-[10px] font-black uppercase tracking-wider text-right text-[#1A3C40]">Prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {dificiles.map((s) => (
                    <tr key={s.subjectId} className="border-b border-[#EEF3F1] last:border-0">
                      <td className="px-1.5 py-1 text-[10px] font-bold text-[#1A3C40] truncate max-w-[150px]">{s.subjectName}</td>
                      <td className="px-1.5 py-1 text-[10px] font-bold text-right text-[#5C736D]">{s.students}</td>
                      <td className={`px-1.5 py-1 text-[10px] font-black text-right ${(s.avgPct as number) < 60 ? 'text-[#D32F2F]' : 'text-[#1A3C40]'}`}>
                        {fmtPct(s.avgPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── 4. Riesgo académico ────────────────────────────────────────── */}
      <SectionTitle num="4" title="Riesgo académico" />
      <div className="flex items-center gap-2 mb-1.5">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-[#D32F2F] text-white">
          Alto: {metrics.riskSummary.high}
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-[#FFC107] text-[#1A3C40]">
          Medio: {metrics.riskSummary.medium}
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-[#2E7D32] text-white">
          Bajo: {metrics.riskSummary.low}
        </span>
        <span className="text-[10px] font-bold text-[#5C736D]">
          Casos prioritarios (máximo 10 de {metrics.atRiskStudents.length} filas detectadas):
        </span>
      </div>
      {riskRows.length > 0 ? (
        <table className="w-full text-left mb-2">
          <thead>
            <tr className="bg-[#F0F7F4]">
              <th className="px-2 py-1 text-[10px] font-black uppercase tracking-wider text-[#1A3C40]">Estudiante</th>
              <th className="px-2 py-1 text-[10px] font-black uppercase tracking-wider text-[#1A3C40]">Asignatura</th>
              <th className="px-2 py-1 text-[10px] font-black uppercase tracking-wider text-[#1A3C40]">Docente</th>
              <th className="px-2 py-1 text-[10px] font-black uppercase tracking-wider text-right text-[#1A3C40]">Asist.</th>
              <th className="px-2 py-1 text-[10px] font-black uppercase tracking-wider text-right text-[#1A3C40]">Nota</th>
              <th className="px-2 py-1 text-[10px] font-black uppercase tracking-wider text-right text-[#1A3C40]">Nivel</th>
            </tr>
          </thead>
          <tbody>
            {riskRows.map((r, i) => (
              <tr key={`${r.studentId}-${i}`} className="border-b border-[#EEF3F1] last:border-0">
                <td className="px-2 py-1 text-[10px] font-black text-[#1A3C40]">{r.studentName}</td>
                <td className="px-2 py-1 text-[10px] font-bold text-[#1A3C40] truncate max-w-[140px]">{r.asignatura}</td>
                <td className="px-2 py-1 text-[10px] font-bold text-[#5C736D] truncate max-w-[130px]">{r.docente}</td>
                <td className={`px-2 py-1 text-[10px] font-black text-right ${r.asistencia !== null && r.asistencia < 70 ? 'text-[#D32F2F]' : r.asistencia !== null && r.asistencia < 80 ? 'text-[#B45309]' : 'text-[#1A3C40]'}`}>
                  {r.asistencia === null ? '—' : fmtPct(r.asistencia)}
                </td>
                <td className={`px-2 py-1 text-[10px] font-black text-right ${r.nota !== null && r.nota < 60 ? 'text-[#D32F2F]' : 'text-[#1A3C40]'}`}>
                  {r.nota === null ? '—' : fmtPct(r.nota)}
                </td>
                <td className="px-2 py-1 text-right">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${RISK_BADGE[r.nivelRiesgo]}`}>
                    {RISK_LABEL[r.nivelRiesgo]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-[10px] font-bold text-[#5C736D] mb-2">Sin estudiantes en riesgo con los filtros activos.</p>
      )}

      {/* ── 5. Actividad docente ───────────────────────────────────────── */}
      <SectionTitle num="5" title="Actividad docente" />
      <div className="grid grid-cols-5 gap-1.5 mb-3">
        <KpiCard label="Docentes" value={String(teachers.length)} />
        <KpiCard label="Activos (30 días)" value={String(activos30d)} />
        <KpiCard label="Asignaturas" value={String(totals.subjects)} />
        <KpiCard label="Evaluaciones" value={String(totals.evaluations)} />
        <KpiCard label="Matrículas" value={String(totals.students)} />
      </div>

      {/* ── 6. Alertas ─────────────────────────────────────────────────── */}
      <SectionTitle num="6" title="Alertas" />
      {alertList.length > 0 ? (
        <div className="border border-[#DCE8E3] rounded-lg px-2.5 py-1 mb-3">
          <ul>
            {alertList.map((a) => (
              <li key={a.id} className="flex items-start gap-2 py-1 border-b border-[#EEF3F1] last:border-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0 mt-1"
                  style={{ backgroundColor: a.severity === 'critical' ? '#D32F2F' : '#FFC107' }}
                />
                <p className="flex-1 text-[10px] leading-snug text-[#1A3C40]">
                  <span className="font-black">{ALERT_TYPE_LABEL[a.type]}</span>
                  {' — '}
                  {a.message.length > 130 ? `${a.message.slice(0, 130)}…` : a.message}
                </p>
                <span className="shrink-0 text-[10px] font-bold text-[#5C736D]">
                  {a.lastActivity ? fmtFecha(new Date(a.lastActivity)) : ''}
                </span>
              </li>
            ))}
          </ul>
          {(alerts?.summary?.total ?? 0) > alertList.length && (
            <p className="text-[10px] font-bold text-[#5C736D] pt-1">
              Mostrando {alertList.length} de {alerts?.summary?.total} alertas (priorizando críticas).
            </p>
          )}
        </div>
      ) : (
        <p className="text-[10px] font-bold text-[#5C736D] mb-3">Sin alertas activas con los filtros aplicados.</p>
      )}

      {/* ── Pie ────────────────────────────────────────────────────────── */}
      <div className="mt-3 pt-2 border-t-2 border-[#1A3C40] text-center">
        <p className="text-[10px] font-black text-[#1A3C40]">
          Generado por EdiAgil · Panel Administrativo · {fmtFecha(hoy)}
        </p>
        <p className="text-[10px] font-bold text-[#5C736D]">{filtrosTexto}</p>
        <p className="text-[9px] font-bold text-[#5C736D]">
          Cálculos académicos basados en la ponderación institucional vigente.
        </p>
      </div>
    </div>
  );
}
