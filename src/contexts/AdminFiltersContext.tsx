/**
 * AdminFiltersContext.tsx — Estado elevado de los filtros del panel admin.
 *
 * Los filtros combinados de turno y nivel educativo viven AQUÍ (no en el
 * AdminDashboard) para que el sidebar (sección desplegable "Filtros") y todas
 * las vistas del dashboard compartan la misma selección sin duplicar lógica.
 * El AdminDashboard y sus vistas (docentes, asignaturas, censo, métricas,
 * alertas) y las exportaciones consumen este estado; el backend sigue
 * recibiendo turno/nivelEducativo como parámetros opcionales (whitelist).
 */

import React, { createContext, useContext, useState, type ReactNode } from 'react';
import type { TurnoFiltro, NivelFiltro } from '../lib/dashboardFilters';

interface AdminFiltersValue {
  turno: TurnoFiltro;
  nivelEducativo: NivelFiltro;
  setTurno: (turno: TurnoFiltro) => void;
  setNivelEducativo: (nivel: NivelFiltro) => void;
  clearFilters: () => void;
}

const AdminFiltersContext = createContext<AdminFiltersValue | null>(null);

export function AdminFiltersProvider({ children }: { children: ReactNode }) {
  const [turno, setTurno] = useState<TurnoFiltro>('');
  const [nivelEducativo, setNivelEducativo] = useState<NivelFiltro>('');
  const clearFilters = () => {
    setTurno('');
    setNivelEducativo('');
  };
  return (
    <AdminFiltersContext.Provider value={{ turno, nivelEducativo, setTurno, setNivelEducativo, clearFilters }}>
      {children}
    </AdminFiltersContext.Provider>
  );
}

export function useAdminFilters(): AdminFiltersValue {
  const ctx = useContext(AdminFiltersContext);
  if (!ctx) {
    throw new Error('useAdminFilters debe usarse dentro de <AdminFiltersProvider>.');
  }
  return ctx;
}
