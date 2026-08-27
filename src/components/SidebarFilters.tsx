/**
 * SidebarFilters.tsx — Sección desplegable "Filtros" del panel admin (sidebar).
 *
 * Mueve los filtros combinados de turno y nivel educativo desde el centro del
 * dashboard al sidebar, debajo del botón "Dashboard Administrativo". Comparte
 * estado con el dashboard vía AdminFiltersContext (sin duplicar lógica): los
 * mismos selectores afectan a docentes, asignaturas, censo, métricas, alertas
 * y exportaciones. Identidad EdiAgil (#F0F7F4/#1A3C40/#FFC107/#2E7D32).
 */

import React, { useState } from 'react';
import { SlidersHorizontal, ChevronDown, X } from 'lucide-react';
import { useAdminFilters } from '../contexts/AdminFiltersContext';
import {
  TURNOS,
  NIVELES,
  TURNO_LABEL,
  NIVEL_LABEL,
  type TurnoFiltro,
  type NivelFiltro,
} from '../lib/dashboardFilters';

export function SidebarFilters() {
  const { turno, nivelEducativo, setTurno, setNivelEducativo, clearFilters } = useAdminFilters();
  const [open, setOpen] = useState(false);
  const activeCount = (turno ? 1 : 0) + (nivelEducativo ? 1 : 0);

  const selectCls =
    'w-full appearance-none bg-white border border-[#1A3C40]/15 rounded-xl pl-3 pr-9 py-2.5 text-sm font-bold text-[#1A3C40] outline-none focus:border-[#1A3C40] focus:ring-2 focus:ring-[#FFC107]/40 transition-all cursor-pointer';

  return (
    <div className="mb-6 rounded-2xl border border-[#1A3C40]/10 bg-[#F0F7F4]/80 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="admin-filters-panel"
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[#F0F7F4]"
      >
        <span className="flex items-center gap-2.5">
          <SlidersHorizontal className="w-4 h-4 text-[#1A3C40]" />
          <span className="font-black text-xs uppercase tracking-widest text-[#1A3C40]">Filtros</span>
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-[#FFC107] text-[#1A3C40] text-[10px] font-black">
              {activeCount}
            </span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-[#1A3C40]/50 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div id="admin-filters-panel" className="px-4 pb-4 space-y-3 border-t border-[#1A3C40]/10 pt-3">
          <div>
            <label
              id="admin-filters-turno-label"
              className="block text-[10px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/60 mb-1.5"
            >
              Turno
            </label>
            <div className="relative">
              <select
                value={turno}
                onChange={(e) => setTurno(e.target.value as TurnoFiltro)}
                aria-labelledby="admin-filters-turno-label"
                className={selectCls}
              >
                {TURNOS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1A3C40]/40 pointer-events-none" />
            </div>
          </div>

          <div>
            <label
              id="admin-filters-nivel-label"
              className="block text-[10px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/60 mb-1.5"
            >
              Nivel educativo
            </label>
            <div className="relative">
              <select
                value={nivelEducativo}
                onChange={(e) => setNivelEducativo(e.target.value as NivelFiltro)}
                aria-labelledby="admin-filters-nivel-label"
                className={selectCls}
              >
                {NIVELES.map((n) => (
                  <option key={n.value} value={n.value}>
                    {n.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1A3C40]/40 pointer-events-none" />
            </div>
          </div>

          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="w-full inline-flex items-center justify-center gap-1.5 bg-white border border-[#1A3C40]/15 hover:border-[#D32F2F]/40 hover:text-[#D32F2F] text-[#1A3C40] px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Limpiar ({activeCount})
            </button>
          )}

          {activeCount > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {turno && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#FFC107]/20 border border-[#FFC107]/50 text-[#1A3C40] text-[10px] font-black px-2.5 py-1">
                  {TURNO_LABEL[turno]}
                </span>
              )}
              {nivelEducativo && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#2E7D32]/10 border border-[#2E7D32]/40 text-[#2E7D32] text-[10px] font-black px-2.5 py-1">
                  {NIVEL_LABEL[nivelEducativo]}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
