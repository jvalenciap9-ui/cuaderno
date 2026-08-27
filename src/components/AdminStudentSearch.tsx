import React, { useState } from 'react';
import {
  Search,
  Loader2,
  AlertTriangle,
  GraduationCap,
  BookOpen,
  UserRound,
  TriangleAlert,
  CheckCircle2,
  Info,
} from 'lucide-react';
import { searchStudent } from '../lib/adminApi';
import type { StudentSearchRow } from '../lib/adminApi';
import { showToast } from '../hooks/useToast';
import { NIVEL_LABEL, TURNO_LABEL } from '../lib/dashboardFilters';

// Paleta EdiAgil (Módulo 2): la identidad visual de la marca, no la de los
// módulos admin previos (que usan acento azul).
const BRAND_TEXT = '#1A3C40';

export function AdminStudentSearch() {
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [rows, setRows] = useState<StudentSearchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  const doSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = q.trim();
    if (query.length < 2) {
      showToast('info', 'Escribe al menos 2 caracteres para buscar.');
      return;
    }
    setSearching(true);
    setError('');
    setSearched(true);
    try {
      const res = await searchStudent(query);
      setRows(res.students);
      setTotal(res.total);
    } catch (err: any) {
      console.error('searchStudent error:', err);
      setError(err?.message || 'No se pudo buscar. Intenta de nuevo.');
      setRows([]);
      setTotal(0);
    } finally {
      setSearching(false);
    }
  };

  const discrepancyRows = rows.filter(r => r.estado === 'inactivo');
  const estudiantesConDiscrepancia = new Set(discrepancyRows.map(r => r.nombreCompleto)).size;

  return (
    <div className="space-y-6">
      {/* Encabezado + búsqueda */}
      <div className="bg-[#F0F7F4] border border-[#1A3C40]/10 rounded-[2rem] p-6 md:p-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#1A3C40] text-[#FFC107] flex items-center justify-center shrink-0">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-black text-[#1A3C40] tracking-tight">Búsqueda de discrepancias</h3>
            <p className="text-sm text-[#1A3C40]/70 font-medium mt-0.5">
              Boletín estudiantil: localiza a un alumno por nombre o cédula y revisa sus asignaturas,
              docentes, niveles y turnos en toda la institución.
            </p>
          </div>
        </div>

        <form onSubmit={doSearch} className="flex flex-col md:flex-row gap-3 mt-6">
          <div className="relative flex-1 max-w-2xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#1A3C40]/35" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre o cédula (mín. 2 caracteres)..."
              className="w-full bg-white border border-[#1A3C40]/15 rounded-2xl pl-12 pr-4 py-4 text-sm font-medium text-[#1A3C40] outline-none focus:border-[#1A3C40] focus:ring-4 focus:ring-[#FFC107]/30 transition-all placeholder:text-[#1A3C40]/35"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="inline-flex items-center justify-center gap-2 text-white px-6 py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
            style={{ background: BRAND_TEXT }}
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {searching ? 'Buscando...' : 'Buscar'}
          </button>
        </form>
        <p className="flex items-center gap-1.5 text-xs text-[#1A3C40]/50 font-medium mt-3">
          <Info className="w-3.5 h-3.5" />
          La búsqueda cubre toda la institución, sin importar los filtros de turno/nivel del panel.
        </p>
      </div>

      {error && (
        <div className="bg-[#D32F2F]/10 border border-[#D32F2F]/30 rounded-[2rem] p-10 text-center">
          <AlertTriangle className="w-12 h-12 text-[#D32F2F] mx-auto mb-6" />
          <p className="text-lg font-black text-[#1A3C40] mb-2">Error en la búsqueda</p>
          <p className="text-sm text-[#1A3C40]/70 font-medium">{error}</p>
        </div>
      )}

      {searching && (
        <div className="bg-white border border-[#1A3C40]/10 rounded-[2rem] shadow-sm">
          <div className="flex flex-col items-center justify-center py-24">
            <Loader2 className="w-10 h-10 animate-spin mb-4" style={{ color: BRAND_TEXT }} />
            <p className="text-sm font-bold text-[#1A3C40]/70">Buscando en toda la institución...</p>
          </div>
        </div>
      )}

      {!searching && searched && !error && rows.length === 0 && (
        <div className="bg-white border border-[#1A3C40]/10 rounded-[2rem] p-12 text-center shadow-sm">
          <UserRound className="w-12 h-12 text-[#1A3C40]/20 mx-auto mb-6" />
          <p className="text-lg font-black text-[#1A3C40] mb-2">Sin resultados</p>
          <p className="text-sm text-[#1A3C40]/60 font-medium">
            Prueba con otro nombre o cédula de un alumno de la institución.
          </p>
        </div>
      )}

      {!searching && rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-black text-[#1A3C40]">
              {total > rows.length
                ? `Mostrando ${rows.length} de ${total} filas`
                : `${total} fila${total === 1 ? '' : 's'}`}
            </span>
            <span className="text-[#1A3C40]/40 font-bold">·</span>
            <span className="text-sm font-bold text-[#1A3C40]/70">
              {new Set(rows.map(r => r.nombreCompleto)).size} estudiante(s)
            </span>
          </div>

          {discrepancyRows.length > 0 && (
            <div className="flex items-start gap-3 bg-[#D32F2F]/10 border border-[#D32F2F]/30 rounded-2xl px-5 py-4">
              <TriangleAlert className="w-5 h-5 text-[#D32F2F] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-black text-[#D32F2F]">
                  {estudiantesConDiscrepancia} estudiante{estudiantesConDiscrepancia === 1 ? '' : 's'} con discrepancia
                  {estudiantesConDiscrepancia === 1 ? '' : 's'} detectada{estudiantesConDiscrepancia === 1 ? '' : 's'}
                </p>
                <p className="text-sm text-[#D32F2F]/80 font-medium">
                  Revisa las filas marcadas en rojo: asignaciones a varios turnos, la misma asignatura en
                  turnos distintos o matrículas duplicadas.
                </p>
              </div>
            </div>
          )}

          <div className="bg-white border border-[#1A3C40]/10 rounded-[2rem] shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[#1A3C40]">
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-[#FFC107]">Estudiante</th>
                    <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-[#FFC107]">Cédula</th>
                    <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-[#FFC107]">Asignatura</th>
                    <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-[#FFC107]">Docente</th>
                    <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-[#FFC107]">Grado</th>
                    <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-[#FFC107]">Periodo</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-[#FFC107]">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1A3C40]/5">
                  {rows.map((r) => {
                    const inactivo = r.estado === 'inactivo';
                    return (
                      <tr key={`${r.studentId}-${r.subjectId}-${r.teacherUid}`} className={inactivo ? 'bg-[#D32F2F]/5' : 'hover:bg-[#F0F7F4]/70 transition-colors'}>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-sm shrink-0 ${inactivo ? 'bg-[#D32F2F]/15 text-[#D32F2F]' : 'bg-[#1A3C40]/8 text-[#1A3C40]'}`}>
                              {r.nombreCompleto.charAt(0)}
                            </div>
                            <span className="font-black text-sm text-[#1A3C40]">{r.nombreCompleto}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm font-bold text-[#1A3C40]/70">{r.cedula || '—'}</td>
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[#1A3C40]">
                            <BookOpen className={`w-3.5 h-3.5 ${inactivo ? 'text-[#D32F2F]' : 'text-[#1A3C40]/40'}`} />
                            {r.asignatura}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm font-bold text-[#1A3C40]/70">{r.docente}</td>
                        <td className="px-4 py-4">
                          <span className="text-sm font-bold text-[#1A3C40]/70">
                            {NIVEL_LABEL[r.grado] || r.grado || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {r.periodo ? (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-[#F0F7F4] border border-[#1A3C40]/10 text-[#1A3C40]">
                              {TURNO_LABEL[r.periodo] || r.periodo}
                            </span>
                          ) : (
                            <span className="text-sm font-bold text-[#1A3C40]/40">Sin turno</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {inactivo ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-[#D32F2F] text-white">
                                <TriangleAlert className="w-3 h-3" />
                                Discrepancia
                              </span>
                              <ul className="space-y-0.5">
                                {r.discrepancias.map((d) => (
                                  <li key={d} className="text-[11px] font-bold text-[#D32F2F]">
                                    · {d}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-[#2E7D32] text-white">
                              <CheckCircle2 className="w-3 h-3" />
                              Activo
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
