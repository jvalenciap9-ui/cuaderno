/**
 * gradingUtils.ts — Agrupación de calificaciones por categorías del plan y
 * ponderación (institucional o individual), usada por el boletín.
 *
 * El boletín NO muestra las evaluaciones sueltas: agrupa por categoría
 * (teórica/práctica/apreciativa) dentro de cada sub-periodo y calcula la nota
 * final de cada periodo como la SUMA PONDERADA de sus categorías según la
 * ponderación efectiva (política institucional: la institucional SIEMPRE gana
 * para miembros de la institución — getEffectiveGradingWeight; los docentes
 * individuales usan su configuración personal). Los pesos que no tienen
 * evaluaciones en el periodo se re-normalizan sobre los presentes (mismo
 * criterio que gradeCalculator.calculateWeightedAverage).
 */

import type { GradingWeight } from './adminApi';

export interface GradeInput {
  type?: string | null;
  scorePct?: number | null;
}

export interface WeightedBreakdown {
  /** Nota final del grupo de evaluaciones (0-100), re-normalizada. */
  final: number | null;
  /** Promedio por categoría (solo las presentes). */
  byCategory: Record<'teoria' | 'practica' | 'apreciativa', number | null>;
  /** Categorías que tienen al menos una evaluación calificada. */
  categoriesUsed: Array<'teoria' | 'practica' | 'apreciativa'>;
}

const CATEGORIES = ['teoria', 'practica', 'apreciativa'] as const;
const CATEGORY_KEYS = ['teoria', 'practica', 'apreciativa'] as const;

export const DEFAULT_INSTITUTION_WEIGHTS = { teoria: 30, practica: 60, apreciativa: 10 };

/** Pesos efectivos (0-100) a partir de un gradingWeight institucional/individual. */
export function effectiveWeights(
  gw?: GradingWeight | null,
): { teoria: number; practica: number; apreciativa: number } {
  const w = gw?.weights;
  return {
    teoria: typeof w?.teoria === 'number' && Number.isFinite(w.teoria) ? w.teoria : DEFAULT_INSTITUTION_WEIGHTS.teoria,
    practica: typeof w?.practica === 'number' && Number.isFinite(w.practica) ? w.practica : DEFAULT_INSTITUTION_WEIGHTS.practica,
    apreciativa: typeof w?.apreciativa === 'number' && Number.isFinite(w.apreciativa) ? w.apreciativa : DEFAULT_INSTITUTION_WEIGHTS.apreciativa,
  };
}

/**
 * Nota final de un grupo de evaluaciones (un sub-periodo del plan) como suma
 * ponderada de sus categorías. Devuelve null si no hay evaluaciones con nota.
 */
export function weightedBreakdown(evaluations: GradeInput[], gw?: GradingWeight | null): WeightedBreakdown {
  const weights = effectiveWeights(gw);
  const sums: Record<string, { sum: number; count: number }> = {
    teoria: { sum: 0, count: 0 },
    practica: { sum: 0, count: 0 },
    apreciativa: { sum: 0, count: 0 },
  };
  for (const ev of evaluations) {
    if (typeof ev.scorePct !== 'number' || !Number.isFinite(ev.scorePct)) continue;
    const t = ev.type || 'teoria';
    if (!(t in sums)) continue;
    sums[t].sum += ev.scorePct;
    sums[t].count += 1;
  }
  const avgOf = (t: string): number | null => (sums[t].count > 0 ? sums[t].sum / sums[t].count : null);
  const byCategory: WeightedBreakdown['byCategory'] = {
    teoria: avgOf('teoria'),
    practica: avgOf('practica'),
    apreciativa: avgOf('apreciativa'),
  };
  const categoriesUsed = CATEGORY_KEYS.filter((t) => sums[t].count > 0);
  let weighted = 0;
  let used = 0;
  for (const t of CATEGORY_KEYS) {
    const avg = avgOf(t);
    if (avg !== null) {
      weighted += avg * weights[t];
      used += weights[t];
    }
  }
  const final = used > 0 ? (weighted / used) : null;
  return {
    final: final === null ? null : Math.round(final * 10) / 10,
    byCategory,
    categoriesUsed,
  };
}

/**
 * Matriz de prioridad de la ponderación (política institucional). Espejo TS de
 * functions/lib/grading-policy.js (probada en scripts/test-grading-policy.mjs).
 *
 * REGLA FUNDAMENTAL: solamente el administrador institucional configura o
 * modifica las ponderaciones; la fuente autoritativa es
 * institutions/{id}.gradingWeight. El campo `applyTo` se conserva en el
 * esquema por compatibilidad pero YA NO tiene efecto en la resolución: para
 * cualquier miembro de la institución la ponderación institucional SIEMPRE
 * gana sobre la personal del docente (quien no puede editarla). Un docente
 * individual (Premium Pro sin institución) conserva su configuración personal.
 * Si un miembro institucional no tiene ponderación institucional legible,
 * weight = null y el consumidor aplica sus defaults; la personal queda
 * IGNORADA (no borrada).
 */
export interface EffectiveGradingWeightCtx {
  isInstitutionalMember: boolean;
  isAdmin: boolean;
}

export function getEffectiveGradingWeight<T>(
  ctx: EffectiveGradingWeightCtx,
  individual?: T | null,
  institutional?: T | null,
): { weight: T | null; canEdit: boolean; source: 'institutional' | 'personal' } {
  if (ctx?.isInstitutionalMember) {
    return {
      weight: institutional && typeof institutional === 'object' ? institutional : null,
      canEdit: ctx.isAdmin === true,
      source: 'institutional',
    };
  }
  return {
    weight: individual && typeof individual === 'object' ? individual : null,
    canEdit: true,
    source: 'personal',
  };
}

/**
 * @deprecated Punto de compatibilidad para el boletín admin (contexto
 * institucional): la institucional SIEMPRE gana. Usa getEffectiveGradingWeight
 * para la matriz completa con contexto de miembro/admin.
 */
export function resolveGradingWeight(
  individual?: GradingWeight | null,
  institutional?: GradingWeight | null,
): GradingWeight | null {
  return institutional || individual || null;
}
