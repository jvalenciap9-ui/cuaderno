import React, { useEffect, useState } from 'react';
import {
  Search,
  Loader2,
  AlertTriangle,
  GraduationCap,
  BookOpen,
  UserRound,
  Sparkles,
  CheckCircle2,
  Lightbulb,
  TrendingUp,
  ArrowLeft,
  FileText,
} from 'lucide-react';
import {
  adminSearchStudents,
  adminGenerateStudentInsights,
} from '../lib/adminApi';
import type {
  StudentSearchResult,
  StudentMembership,
  StudentAIInsights,
} from '../lib/adminApi';
import { showToast } from '../hooks/useToast';
import { PERIODO_LABEL } from '../lib/institutionalReport';
import { NIVEL_LABEL, type TurnoFiltro, type NivelFiltro } from '../lib/dashboardFilters';
import { AdminBoletin } from './AdminBoletin';

interface AdminStudentsProps {
  turno?: TurnoFiltro;
  nivelEducativo?: NivelFiltro;
}

export function AdminStudents({ turno = '', nivelEducativo = '' }: AdminStudentsProps) {
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<StudentSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  const [selected, setSelected] = useState<StudentSearchResult | null>(null);

  // Alumno cuyo boletín se muestra en el modal de navegación por periodo.
  const [boletinStudent, setBoletinStudent] = useState<StudentSearchResult | null>(null);

  const [insights, setInsights] = useState<StudentAIInsights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [insightsError, setInsightsError] = useState('');

  const generateInsights = async () => {
    if (!selected) return;
    setLoadingInsights(true);
    setInsightsError('');
    setInsights(null);
    try {
      const res = await adminGenerateStudentInsights(selected.studentId);
      setInsights(res.insights);
    } catch (err: any) {
      console.error('adminGenerateStudentInsights error:', err);
      setInsightsError(err?.message || 'No se pudo generar la retroalimentación.');
    } finally {
      setLoadingInsights(false);
    }
  };

  const doSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = q.trim();
    if (query.length < 2) {
      showToast('info', 'Escribe al menos 2 caracteres para buscar.');
      return;
    }
    setSearching(true);
    setError('');
    setSelected(null);
    setSearched(true);
    try {
      const res = await adminSearchStudents(query, { turno, nivelEducativo });
      setResults(res.students);
      setTotal(res.total);
    } catch (err: any) {
      console.error('adminSearchStudents error:', err);
      setError(err?.message || 'No se pudo buscar.');
      setResults([]);
      setTotal(0);
    } finally {
      setSearching(false);
    }
  };

  const backToList = () => {
    setSelected(null);
    setInsights(null);
    setInsightsError('');
    setBoletinStudent(null);
  };

  // Si cambian los filtros globales, repite la búsqueda con los nuevos valores.
  useEffect(() => {
    if (searched) doSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turno, nivelEducativo]);

  // Agrupa las membresías de un estudiante por docente para mostrarlas
  // consolidadas en una sola ficha (estudiantes con varios docentes).
  const groupByTeacher = (memberships: StudentMembership[]) => {
    const map = new Map<string, StudentMembership[]>();
    for (const m of memberships) {
      const key = m.teacherUid;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return Array.from(map.entries());
  };

  // ── Vista de detalle del alumno ──
  if (selected) {
    return (
      <div className="space-y-6">
        {/* Header con botón volver */}
        <div className="flex items-center gap-4">
          <button
            onClick={backToList}
            className="inline-flex items-center gap-2 text-sm font-bold text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </button>
        </div>

        {/* Ficha del alumno */}
        <div className="bg-white border border-neutral-200 rounded-[2rem] shadow-sm p-8">
          <div className="flex flex-wrap items-center gap-5">
            <div className="w-16 h-16 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 font-black text-2xl">
              {selected.firstName.charAt(0)}
            </div>
            <div>
              <h2 className="text-xl font-black text-neutral-900">
                {selected.firstName} {selected.lastName}
              </h2>
              <p className="text-sm text-neutral-400 font-medium mt-0.5">
                {selected.cedula ? `Cédula: ${selected.cedula}` : 'Sin cédula'} ·{' '}
                {selected.gender === 'M' ? 'Masculino' : selected.gender === 'F' ? 'Femenino' : 'Género no especificado'}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-widest bg-indigo-50 text-indigo-600 px-3.5 py-1.5 rounded-full">
                {selected.memberships.length} asignatura{selected.memberships.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={() => setBoletinStudent(selected)}
                aria-label={`Ver boletín de ${selected.firstName} ${selected.lastName}`}
                title={`Ver boletín de ${selected.firstName} ${selected.lastName}`}
                className="inline-flex items-center gap-1.5 bg-neutral-900 hover:bg-neutral-700 text-white px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <FileText className="w-3.5 h-3.5" />
                Ver boletín
              </button>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {groupByTeacher(selected.memberships).map(([teacherUid, ms]) => (
              <div key={teacherUid}>
                <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-neutral-500 mb-2">
                  <UserRound className="w-3.5 h-3.5 text-neutral-400" />
                  {ms[0].teacherName}
                  <span className="text-neutral-300 font-bold">·</span>
                  <span className="text-neutral-400">
                    {ms.length} asignatura{ms.length === 1 ? '' : 's'}
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {ms.map((m) => (
                    <span
                      key={`${m.teacherUid}-${m.subjectId}`}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-neutral-600 bg-neutral-50 border border-neutral-100 rounded-full px-3 py-1.5"
                    >
                      <BookOpen className="w-3.5 h-3.5 text-neutral-400" />
                      {m.subjectName}
                      {m.periodo ? (
                        <span className="text-neutral-400">· {PERIODO_LABEL[m.periodo] || m.periodo}</span>
                      ) : null}
                      {m.nivelEducativo ? (
                        <span className="text-neutral-400">· {NIVEL_LABEL[m.nivelEducativo] || m.nivelEducativo}</span>
                      ) : null}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Panel de AI Insights */}
        <div className="bg-white border border-neutral-200 rounded-[2rem] shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 px-8 pt-7 pb-5 border-b border-neutral-100">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-black text-neutral-900 tracking-tight">AI Insights</h4>
                <p className="text-xs text-neutral-400 font-medium mt-0.5">
                  Retroalimentación pedagógica generada con Gemini sobre los datos consolidados del alumno
                </p>
              </div>
            </div>
            <button
              onClick={generateInsights}
              disabled={loadingInsights}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95"
            >
              {loadingInsights ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {loadingInsights ? 'Analizando...' : insights ? 'Regenerar insights' : 'Generar insights'}
            </button>
          </div>

          <div className="px-8 py-6">
            {insightsError && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-2xl px-5 py-4">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-black text-red-700">No se pudieron generar los insights</p>
                  <p className="text-sm text-red-500 font-medium mt-0.5">{insightsError}</p>
                </div>
              </div>
            )}

            {!insights && !loadingInsights && !insightsError && (
              <p className="text-sm text-neutral-400 font-medium">
                Analiza el rendimiento, las evaluaciones y la asistencia del alumno en todas sus asignaturas
                y docentes para obtener una retroalimentación personalizada.
              </p>
            )}

            {loadingInsights && (
              <div className="flex items-center gap-4 py-4">
                <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                <div>
                  <p className="text-sm font-black text-neutral-900">Consultando a Gemini...</p>
                  <p className="text-xs text-neutral-400 font-medium mt-0.5">
                    Consolidando {selected.memberships.length} asignatura{
                      selected.memberships.length === 1 ? '' : 's'
                    } y generando la retroalimentación pedagógica.
                  </p>
                </div>
              </div>
            )}

            {insights && (
              <div className="space-y-5">
                {insights.resumen && (
                  <div className="bg-indigo-50/70 border border-indigo-100 rounded-2xl p-5">
                    <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600 mb-2">
                      Resumen general
                    </p>
                    <p className="text-sm font-medium text-neutral-700 leading-relaxed">{insights.resumen}</p>
                  </div>
                )}

                {insights.fortalezas.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingUp className="w-4 h-4 text-emerald-500" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500">
                        Fortalezas
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {insights.fortalezas.map((f, i) => (
                        <li key={i} className="flex items-center gap-3 rounded-2xl bg-emerald-50 border border-emerald-100 px-4 py-3">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                          <span className="text-sm font-medium text-neutral-700">{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {insights.areasDeMejora.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500">
                        Áreas de mejora
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {insights.areasDeMejora.map((a, i) => (
                        <li key={i} className="flex items-center gap-3 rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3">
                          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                          <span className="text-sm font-medium text-neutral-700">{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {insights.recomendaciones.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Lightbulb className="w-4 h-4 text-indigo-500" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500">
                        Recomendaciones
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {insights.recomendaciones.map((r, i) => (
                        <li key={i} className="flex items-center gap-3 rounded-2xl bg-indigo-50 border border-indigo-100 px-4 py-3">
                          <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-black flex items-center justify-center shrink-0">
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

        {boletinStudent && (
          <AdminBoletin student={boletinStudent} onClose={() => setBoletinStudent(null)} />
        )}
      </div>
    );
  }

  // ── Búsqueda ──
  return (
    <div className="space-y-8">
      {(turno || nivelEducativo) && (
        <div className="flex flex-wrap items-center gap-2 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3.5 text-xs font-black text-amber-700">
          Censo filtrado:
          {turno && <span className="px-2.5 py-1 rounded-full bg-white border border-amber-200">{PERIODO_LABEL[turno]}</span>}
          {nivelEducativo && <span className="px-2.5 py-1 rounded-full bg-white border border-amber-200">{NIVEL_LABEL[nivelEducativo]}</span>}
        </div>
      )}
      <form onSubmit={doSearch} className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1 max-w-2xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar alumno por nombre, apellido, cédula, asignatura, turno o nivel..."
            className="w-full bg-white border border-neutral-200 rounded-2xl pl-12 pr-4 py-4 text-sm font-medium text-neutral-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 transition-all"
          />
        </div>
        <button
          type="submit"
          disabled={searching}
          className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-6 py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-blue-500/20"
        >
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {searching ? 'Buscando...' : 'Buscar'}
        </button>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-[2rem] p-10 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-6" />
          <p className="text-lg font-black text-neutral-900 mb-2">Error en la búsqueda</p>
          <p className="text-sm text-neutral-500 font-medium">{error}</p>
        </div>
      )}

      {searching && (
        <div className="bg-white border border-neutral-200 rounded-[2rem] shadow-sm">
          <div className="flex flex-col items-center justify-center py-24">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
            <p className="text-sm font-bold text-neutral-500">Buscando en toda la institución...</p>
          </div>
        </div>
      )}

      {!searching && searched && !error && results.length === 0 && (
        <div className="bg-white border border-neutral-200 rounded-[2rem] p-12 text-center shadow-sm">
          <UserRound className="w-12 h-12 text-neutral-200 mx-auto mb-6" />
          <p className="text-lg font-black text-neutral-900 mb-2">Sin resultados</p>
          <p className="text-sm text-neutral-500 font-medium">
            Prueba con otro nombre, apellido, cédula, asignatura, turno o nivel de un alumno de la institución
            {turno || nivelEducativo ? ' — recuerda que los filtros del panel están activos.' : '.'}
          </p>
        </div>
      )}

      {!searching && results.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-blue-500" />
            <span className="text-sm font-black text-neutral-700">
              {total > results.length
                ? `Mostrando ${results.length} de ${total} coincidencias`
                : `${total} coincidencia${total === 1 ? '' : 's'}`}
            </span>
          </div>
          <div className="space-y-4">
            {results.map((student) => (
              <div
                key={student.studentId}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(student)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(student);
                  }
                }}
                aria-label={`Abrir ficha de ${student.firstName} ${student.lastName}`}
                className="w-full text-left bg-white border border-neutral-200 hover:border-blue-300 hover:shadow-lg hover:shadow-blue-500/5 rounded-[2rem] p-6 shadow-sm transition-all active:scale-[0.99] group cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 font-black text-lg group-hover:bg-blue-600 group-hover:text-white transition-colors">
                      {student.firstName.charAt(0)}
                    </div>
                    <div>
                      <p className="font-black text-base text-neutral-900">
                        {student.firstName} {student.lastName}
                      </p>
                      <p className="text-xs text-neutral-400 font-medium mt-0.5">
                        {student.cedula ? `Cédula: ${student.cedula}` : 'Sin cédula'} · {student.gender === 'M' ? 'Masculino' : student.gender === 'F' ? 'Femenino' : '—'}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest bg-indigo-50 text-indigo-600 px-3.5 py-1.5 rounded-full">
                      {student.memberships.length} asignatura{student.memberships.length === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setBoletinStudent(student);
                      }}
                      aria-label={`Ver boletín de ${student.firstName} ${student.lastName}`}
                      title={`Ver boletín de ${student.firstName} ${student.lastName}`}
                      className="inline-flex items-center gap-1.5 bg-neutral-900 hover:bg-neutral-700 text-white px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Ver boletín
                    </button>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {groupByTeacher(student.memberships).map(([teacherUid, ms]) => (
                    <div key={teacherUid}>
                      <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-neutral-500 mb-1.5">
                        <UserRound className="w-3.5 h-3.5 text-neutral-400" />
                        {ms[0].teacherName}
                        <span className="text-neutral-300 font-bold">·</span>
                        <span className="text-neutral-400">
                          {ms.length} asignatura{ms.length === 1 ? '' : 's'}
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {ms.map((m) => (
                          <span
                            key={`${m.teacherUid}-${m.subjectId}`}
                            className="inline-flex items-center gap-1.5 text-xs font-bold text-neutral-600 bg-neutral-50 border border-neutral-100 rounded-full px-3 py-1.5"
                          >
                            <BookOpen className="w-3.5 h-3.5 text-neutral-400" />
                            {m.subjectName}
                            {m.periodo ? (
                              <span className="text-neutral-400">· {PERIODO_LABEL[m.periodo] || m.periodo}</span>
                            ) : null}
                            {m.nivelEducativo ? (
                              <span className="text-neutral-400">· {NIVEL_LABEL[m.nivelEducativo] || m.nivelEducativo}</span>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {boletinStudent && (
        <AdminBoletin student={boletinStudent} onClose={() => setBoletinStudent(null)} />
      )}
    </div>
  );
}