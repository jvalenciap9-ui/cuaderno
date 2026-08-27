/**
 * dashboardFilters.ts — Dimensiones de filtrado del dashboard administrativo.
 *
 * Fuente única de verdad para los valores admitidos de turno (periodo de la
 * asignatura) y nivel educativo. Debe mantenerse en sincronía con la whitelist
 * del backend en functions/index.js (PERIODOS_VALIDOS / NIVELES_VALIDOS).
 */

export type TurnoFiltro = '' | 'matutino' | 'vespertino' | 'nocturno';

export type NivelFiltro = '' | 'inicial' | 'primaria' | 'secundaria' | 'universidad';

export const TURNO_LABEL: Record<string, string> = {
  matutino: 'Matutino',
  vespertino: 'Vespertino',
  nocturno: 'Nocturno',
};

export const NIVEL_LABEL: Record<string, string> = {
  inicial: 'Inicial',
  primaria: 'Primaria',
  secundaria: 'Secundaria',
  universidad: 'Universidad',
};

export const TURNOS: { value: TurnoFiltro; label: string }[] = [
  { value: '', label: 'Todos los turnos' },
  { value: 'matutino', label: 'Matutino' },
  { value: 'vespertino', label: 'Vespertino' },
  { value: 'nocturno', label: 'Nocturno' },
];

export const NIVELES: { value: NivelFiltro; label: string }[] = [
  { value: '', label: 'Todos los niveles' },
  { value: 'inicial', label: 'Inicial' },
  { value: 'primaria', label: 'Primaria' },
  { value: 'secundaria', label: 'Secundaria' },
  { value: 'universidad', label: 'Universidad' },
];
