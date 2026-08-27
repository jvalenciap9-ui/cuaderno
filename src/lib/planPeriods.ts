/**
 * planPeriods.ts — Modelo de periodos del boletín adaptado al plan elegido.
 *
 * El boletín (AdminBoletin.tsx) navega por periodos que dependen de la regla
 * institucional `planRules.reglaSeleccionada` (semanal | mensual | trimestral |
 * cuatrimestral | anual). Este módulo es la fuente única de verdad para:
 *
 *  - Las claves de periodo (periodKey) por regla.
 *  - Las etiquetas legibles ("I Trimestre", "PRIMER CUATRIMESTRE",
 *    "AÑO ESCOLAR 2025-2026", "SEMANA 34", "MES 9").
 *  - La derivación del periodo de una fecha (predicado por MES, como el
 *    trimestre existente) y el conteo de pasos de la navegación ◀ ▶.
 *  - La traducción a lo que se le pasa al backend `adminGetStudentBoletin`:
 *      · trimestral  → 'I'|'II'|'III'  (ruta EXACTA actual, estable y default).
 *      · cuatrimestral → 'C1'|'C2' (soportado aditivamente en functions/index.js).
 *      · anual        → 'anual' (idem).
 *      · semanal/mensual → null (todos): el backend no puede enumerar semanas/
 *        meses sin schema nuevo; la ETIQUETA se calcula en el cliente y los
 *        datos mostrados son de todo el periodo (decisión documentada).
 *
 * Rangos por MES documentados (mismo criterio que trimestreFromDate):
 *   trimestral:     I = sep-nov | II = dic-feb | III = mar-ago  (existente)
 *   cuatrimestral:  C1 = sep-feb | C2 = mar-ago
 *   anual:          todo el año escolar (sep–ago)
 *   semanal/mensual: semanas ISO / meses distintos derivados de los registros
 *                    del estudiante (evaluations.date / attendance.date).
 */

// Regla por defecto si planRules está ausente (mismo default que adminApi).
export const REGLA_PLAN_DEFAULT = 'trimestral' as const;

export type ReglaPlanBoletin =
  | 'semanal'
  | 'mensual'
  | 'trimestral'
  | 'cuatrimestral'
  | 'anual';

// Claves de periodo. Las reglas fijas usan claves estables:
//   trimestral: 'I'|'II'|'III'   cuatrimestral: 'C1'|'C2'   anual: 'anual'
// semanal/mensual usan claves derivadas de la fecha: 'W2026-34' | 'M2026-9'.
export type PeriodKey = string;

export const CUATRIMESTRE_KEYS = ['C1', 'C2'] as const;
export type CuatrimestreKey = (typeof CUATRIMESTRE_KEYS)[number];

export const ANUAL_KEY = 'anual';

// ─── Derivación del periodo por fecha (predicado por MES) ─────────────────
const monthFromDate = (date?: string | null): number | null => {
  const m = String(date || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return parseInt(m[2], 10);
};

export function periodFromDate(regla: ReglaPlanBoletin, date?: string | null): PeriodKey | null {
  const month = monthFromDate(date);
  if (month === null) return null;
  switch (regla) {
    case 'trimestral':
      if (month >= 9 && month <= 11) return 'I';
      if (month === 12 || month <= 2) return 'II';
      return 'III';
    case 'cuatrimestral':
      return month >= 9 || month <= 2 ? 'C1' : 'C2';
    case 'anual':
      return ANUAL_KEY;
    case 'semanal':
      return `W${isoWeekKey(date)}`;
    case 'mensual': {
      const y = String(date || '').slice(0, 4);
      return `M${y}-${month}`;
    }
    default:
      return 'III';
  }
}

/** Año escolar (sep–ago): "2025-2026" para el boletín anual. */
export function schoolYearLabel(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  return m >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/** Año de INICIO del año escolar (sep–ago) al que pertenece una fecha. */
export function schoolYearStartYear(date: Date = new Date()): number {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  return m >= 9 ? y : y - 1;
}

// ─── Rango de fechas de un periodo (Año Lectivo dinámico del boletín) ──────
// Cada sub-periodo del plan tiene un rango de fechas conocido por su mes/semana:
//   · trimestral → I = sep-nov, II = dic-feb, III = mar-ago (del año escolar)
//   · cuatrimestral/anual → C1/A1..C4/A4 = los 4 bloques trimestrales del año
//   · mensual → el mes concreto (raw 'yyyy-MM')
//   · semanal → la semana ISO concreta (raw 'yyyy-Www')
export interface PeriodDateRange {
  start: string; // 'yyyy-MM-dd'
  end: string; // 'yyyy-MM-dd'
}

const p2 = (n: number) => String(n).padStart(2, '0');
const MONTH_END: Record<number, number> = {
  1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31,
};
const febEnd = (y: number) => (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28);

function isoMonday(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  const day = (jan4.getDay() + 6) % 7; // lunes = 0
  jan4.setDate(jan4.getDate() - day + 3); // jueves de la semana 1
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - 3); // lunes de la semana 1
  monday.setDate(monday.getDate() + (week - 1) * 7);
  return monday;
}

const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

/** Formatea 'yyyy-MM-dd' → 'dd/mm/aaaa'. */
export function formatDateDMY(isoDate: string): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : isoDate;
}

/**
 * Rango de fechas (inicio-fin) de un sub-periodo del plan, dentro del año
 * escolar indicado. Devuelve null si no se puede derivar.
 */
export function periodDateRange(
  regla: ReglaPlanBoletin,
  key: string,
  columns: PlanTableColumn[],
  schoolYearStart: number,
): PeriodDateRange | null {
  if (regla === 'semanal' || regla === 'mensual') {
    const col = columns.find((c) => c.key === key);
    if (!col?.raw) return null;
    if (regla === 'mensual') {
      const m = col.raw.match(/^(\d{4})-(\d{2})$/);
      if (!m) return null;
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const endDay = mo === 2 ? febEnd(y) : MONTH_END[mo] || 30;
      return { start: `${y}-${p2(mo)}-01`, end: `${y}-${p2(mo)}-${p2(endDay)}` };
    }
    const w = col.raw.match(/^(\d{4})-(\d{2})$/);
    if (!w) return null;
    const monday = isoMonday(Number(w[1]), Number(w[2]));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: iso(monday), end: iso(sunday) };
  }
  const y2 = schoolYearStart + 1;
  if (regla === 'trimestral') {
    if (key === 'I') return { start: `${schoolYearStart}-09-01`, end: `${schoolYearStart}-11-30` };
    if (key === 'II') return { start: `${schoolYearStart}-12-01`, end: `${y2}-02-${p2(febEnd(y2))}` };
    if (key === 'III') return { start: `${y2}-03-01`, end: `${y2}-08-31` };
    return null;
  }
  if (key === 'C1' || key === 'A1') return { start: `${schoolYearStart}-09-01`, end: `${schoolYearStart}-11-30` };
  if (key === 'C2' || key === 'A2') return { start: `${schoolYearStart}-12-01`, end: `${y2}-02-${p2(febEnd(y2))}` };
  if (key === 'C3' || key === 'A3') return { start: `${y2}-03-01`, end: `${y2}-05-31` };
  if (key === 'C4' || key === 'A4') return { start: `${y2}-06-01`, end: `${y2}-08-31` };
  return null;
}

// ─── Etiquetas ─────────────────────────────────────────────────────────────
export function periodKeyLabel(regla: ReglaPlanBoletin, key: PeriodKey | null | undefined): string {
  if (!key) return 'Todos los periodos';
  switch (regla) {
    case 'trimestral':
      return key === 'I' ? 'I Trimestre' : key === 'II' ? 'II Trimestre' : key === 'III' ? 'III Trimestre' : key;
    case 'cuatrimestral':
      return key === 'C1' ? 'Primer Cuatrimestre' : key === 'C2' ? 'Segundo Cuatrimestre' : key;
    case 'anual':
      return `Año Escolar ${schoolYearLabel()}`;
    case 'semanal':
      return `Semana ${String(key).replace(/^W\d{4}-/, '')}`;
    case 'mensual':
      return `Mes ${String(key).replace(/^M\d{4}-/, '')}`;
    default:
      return key;
  }
}

/** Versión corta para la navegación (botones / aria-label). */
export function periodKeyShort(regla: ReglaPlanBoletin, key: PeriodKey | null | undefined): string {
  if (!key) return 'Todos';
  switch (regla) {
    case 'trimestral':
      return key;
    case 'cuatrimestral':
      return key === 'C1' ? 'I' : 'II';
    case 'anual':
      return 'Anual';
    case 'semanal':
      return `S${String(key).replace(/^W\d{4}-/, '')}`;
    case 'mensual':
      return `M${String(key).replace(/^M\d{4}-/, '')}`;
    default:
      return key;
  }
}

/** true si la fecha cae en el periodo pedido (null = todos). */
export function matchesPeriodKey(
  regla: ReglaPlanBoletin,
  date?: string | null,
  key?: PeriodKey | null,
): boolean {
  if (!key) return true;
  if (regla === 'anual') return true; // una sola vista de todo el año
  return periodFromDate(regla, date) === key;
}

/**
 * Pasos de la navegación ◀ ▶ para una regla. El primer paso es siempre
 * "Todos los periodos" (null). Para semanal/mensual los pasos se derivan de
 * los registros del estudiante (semanas/meses distintos en sus evaluaciones).
 */
export function periodStepsForRegla(
  regla: ReglaPlanBoletin,
  report?: { memberships: Array<{ evaluations?: Array<{ date?: string | null }> }> } | null,
): Array<PeriodKey | null> {
  switch (regla) {
    case 'trimestral':
      return [null, 'I', 'II', 'III'];
    case 'cuatrimestral':
      return [null, 'C1', 'C2'];
    case 'anual':
      return [null, ANUAL_KEY];
    case 'semanal':
    case 'mensual': {
      const keys = new Set<string>();
      for (const m of report?.memberships || []) {
        for (const ev of m.evaluations || []) {
          const k = periodFromDate(regla, ev.date);
          if (k) keys.add(k);
        }
      }
      const sorted = Array.from(keys).sort((a, b) => {
        // orden natural: 'W2026-1' < 'W2026-10'; 'M2026-1' < 'M2026-10'
        const num = (s: string) => parseInt(s.replace(/^[A-Z]\d{4}-/, ''), 10) || 0;
        return num(a) - num(b);
      });
      return [null, ...sorted];
    }
    default:
      return [null, 'I', 'II', 'III'];
  }
}

/**
 * Traducción a lo que se le pasa a `adminGetStudentBoletin` (periodo del
 * backend). trimestral mantiene la ruta EXACTA actual ('I'|'II'|'III');
 * cuatrimestral y anual usan claves aditivas del backend; semanal/mensual
 * devuelven null (el backend no filtra por semana/mes — decisión documentada).
 */
export function backendPeriodParam(regla: ReglaPlanBoletin, key: PeriodKey | null | undefined): string | null {
  if (!key) return null;
  if (regla === 'semanal' || regla === 'mensual') return null;
  return key;
}

/**
 * Periodo ACTUAL de la institución según la regla del plan (para que el
 * docente etiquete sus observaciones). Para semanal/mensual usa la fecha de
 * hoy; trimestral/cuatrimestral/anual usan el mes.
 */
export function currentPeriodKey(regla: ReglaPlanBoletin, date: Date = new Date()): PeriodKey {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
  return periodFromDate(regla, iso) || ANUAL_KEY;
}

// ─── Columnas de la tabla de calificaciones / asistencia por plan ─────────
// La tabla del boletín muestra UNA columna de calificaciones por sub-periodo
// del plan (y una columna A/T de asistencia al lado por sub-periodo):
//   semanal → S1, S2, ... (una columna por semana ISO presente en los datos)
//   mensual → M1, M2, ... (una columna por mes presente)
//   trimestral → I, II, III (bloques sep-nov / dic-feb / mar-ago, existente)
//   cuatrimestral → C1, C2, C3, C4
//   anual → A1, A2, A3, A4
// C1-C4 / A1-A4 usan los 4 bloques trimestrales del año escolar (sep–ago):
//   bloque 1 = sep-nov, 2 = dic-feb, 3 = mar-may, 4 = jun-ago.
export interface PlanTableColumn {
  key: string; // 'I'|'II'|'III'|'C1'..|'A1'..|'S1'..|'M1'..
  label: string; // etiqueta corta de la columna
  raw?: string; // solo semanal/mensual: clave cruda (semana ISO / 'yyyy-MM')
}

const QUARTERS: Array<[string, number[]]> = [
  ['1', [9, 10, 11]],
  ['2', [12, 1, 2]],
  ['3', [3, 4, 5]],
  ['4', [6, 7, 8]],
];

const ROMAN_NUMERALS = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV',
];

/**
 * Numeral romano posicional (1-based) para etiquetar las columnas del plan:
 * 1 → I, 2 → II, ..., 15 → XV. Más allá de 15 (o valores no enteros) cae a
 * String(n) — los planes prácticos nunca superan 15 sub-periodos.
 */
export function romanNumeral(n: number): string {
  if (Number.isInteger(n) && n >= 1 && n <= ROMAN_NUMERALS.length) return ROMAN_NUMERALS[n - 1];
  return String(n);
}

export function tableColumnsForRegla(
  regla: ReglaPlanBoletin,
  memberships?: Array<{
    evaluations?: Array<{ date?: string | null }>;
    attendanceRecords?: Array<{ date?: string | null }>;
  }> | null,
): PlanTableColumn[] {
  if (regla === 'trimestral') {
    return [
      { key: 'I', label: romanNumeral(1) },
      { key: 'II', label: romanNumeral(2) },
      { key: 'III', label: romanNumeral(3) },
    ];
  }
  if (regla === 'cuatrimestral') {
    return QUARTERS.map(([n], i) => ({ key: `C${n}`, label: romanNumeral(i + 1) }));
  }
  if (regla === 'anual') {
    return QUARTERS.map(([n], i) => ({ key: `A${n}`, label: romanNumeral(i + 1) }));
  }
  if (regla === 'semanal') {
    const weeks = new Set<string>();
    for (const m of memberships || []) {
      for (const e of m.evaluations || []) if (e.date) weeks.add(isoWeekKey(e.date));
      for (const a of m.attendanceRecords || []) if (a.date) weeks.add(isoWeekKey(a.date));
    }
    return Array.from(weeks)
      .sort()
      .map((w, i) => ({ key: `S${i + 1}`, label: romanNumeral(i + 1), raw: w }));
  }
  if (regla === 'mensual') {
    const months = new Set<string>();
    for (const m of memberships || []) {
      for (const e of m.evaluations || []) if (e.date) months.add(String(e.date).slice(0, 7));
      for (const a of m.attendanceRecords || []) if (a.date) months.add(String(a.date).slice(0, 7));
    }
    return Array.from(months)
      .sort()
      .map((mm, i) => ({ key: `M${i + 1}`, label: romanNumeral(i + 1), raw: mm }));
  }
  return [
    { key: 'I', label: romanNumeral(1) },
    { key: 'II', label: romanNumeral(2) },
    { key: 'III', label: romanNumeral(3) },
  ];
}

/** Columna del plan a la que pertenece una fecha (null si ninguna). */
export function columnKeyFromDate(
  regla: ReglaPlanBoletin,
  date?: string | null,
  columns: PlanTableColumn[] = tableColumnsForRegla(regla),
): string | null {
  if (regla === 'semanal' || regla === 'mensual') {
    const raw = regla === 'semanal' ? isoWeekKey(date) : String(date || '').slice(0, 7);
    const col = columns.find((c) => c.raw === raw);
    return col ? col.key : null;
  }
  const month = monthFromDate(date);
  if (month === null) return null;
  if (regla === 'trimestral') {
    if (month >= 9 && month <= 11) return 'I';
    if (month === 12 || month <= 2) return 'II';
    return 'III';
  }
  const prefix = regla === 'cuatrimestral' ? 'C' : 'A';
  const idx = QUARTERS.findIndex(([, r]) => r.includes(month));
  return idx >= 0 ? `${prefix}${QUARTERS[idx][0]}` : null;
}

// ─── Semana ISO (helpers) ──────────────────────────────────────────────────
// ISO-8601: semana que contiene el jueves. Retorna "YYYY-WNN".
function isoWeekKey(date?: string | null): string {
  const m = String(date || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Mover al jueves de esa semana
  const day = (d.getDay() + 6) % 7; // lunes = 0
  d.setDate(d.getDate() - day + 3);
  const isoYear = d.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  jan4.setDate(jan4.getDate() - jan4Day + 3);
  const week = Math.round(((d.getTime() - jan4.getTime()) / 86400000 + 1) / 7);
  return `${isoYear}-${String(week).padStart(2, '0')}`;
}
