import { safeJSONParse } from './utils';

export type CalculationMode = 'average' | 'sum';
export type ViewMode = 'categories' | 'modules';

export interface GradingWeights {
  teorica: { name: string; value: number };
  practica: { name: string; value: number };
  apreciativa: { name: string; value: number };
  checkpoint: { name: string; value: number };
}

export interface GradingScale {
  maxScore: number;
  minPassingScore: number;
}

export const DEFAULT_WEIGHTS: GradingWeights = {
  teorica: { name: 'Teórica', value: 30 },
  practica: { name: 'Práctica', value: 60 },
  apreciativa: { name: 'Apreciativa', value: 10 },
  checkpoint: { name: 'Agregar 4ta Nota', value: 0 }
};

export const DEFAULT_SCALE: GradingScale = {
  maxScore: 100,
  minPassingScore: 71
};

/**
 * Parsea las ponderaciones guardadas en base de datos local o devuelve las por defecto.
 */
export function parseWeights(data: string | null): GradingWeights {
  if (!data) return DEFAULT_WEIGHTS;
  try {
    const parsed = safeJSONParse<Record<string, unknown> | null>(data, null);
    if (!parsed) return DEFAULT_WEIGHTS;
    const output = { ...DEFAULT_WEIGHTS };
    (['teorica', 'practica', 'apreciativa', 'checkpoint'] as const).forEach(key => {
      const val = parsed[key];
      if (val !== undefined) {
        if (typeof val === 'number') {
          output[key].value = val;
        } else if (typeof val === 'object' && val !== null) {
          const w = val as { value?: number; name?: string };
          output[key].value = typeof w.value === 'number' ? w.value : (parseFloat(String(w.value)) || output[key].value);
          output[key].name = w.name ?? output[key].name;
        }
      }
    });
    return output;
  } catch (e) {
    return DEFAULT_WEIGHTS;
  }
}

/**
 * Calculates the category-weighted average grade for a subset of evaluations.
 */
export function calculateWeightedAverage(
  studentGrades: any[],
  evaluationsSubset: any[],
  weights: GradingWeights,
  gradingScale: GradingScale,
  useCheckpoint: boolean
): number {
  const categories: { id: string; weight: number }[] = [
    { id: 'teorica', weight: weights.teorica.value },
    { id: 'practica', weight: weights.practica.value },
    { id: 'apreciativa', weight: weights.apreciativa.value }
  ];

  if (useCheckpoint) {
    categories.push({ id: 'checkpoint', weight: weights.checkpoint.value });
  }

  let weightedSum = 0;
  let totalWeightUsed = 0;

  categories.forEach(cat => {
    const typeEvals = evaluationsSubset.filter(e => e.type === cat.id);
    const activeEvals = typeEvals.filter(ev =>
      studentGrades.some(g => g.evaluationId === ev.id && typeof g.score === 'number')
    );
    if (activeEvals.length > 0) {
      totalWeightUsed += cat.weight;
      let sumPct = 0;
      activeEvals.forEach(ev => {
        const grade = studentGrades.find(g => g.evaluationId === ev.id);
        const score = grade?.score || 0;
        const max = ev.maxScore || 100;
        sumPct += (score / max);
      });
      const avg = sumPct / activeEvals.length;
      weightedSum += avg * cat.weight;
    }
  });

  return totalWeightUsed > 0 ? (weightedSum / totalWeightUsed) * (gradingScale.maxScore || 100) : 0;
}

/**
 * Calculates the grades of a student in a centralized manner.
 * Returns the total grade and details by type and by module.
 */
export function calculateStudentGrades(
  studentId: string,
  studentGrades: any[],
  evaluations: any[],
  modules: any[],
  useCheckpoint: boolean,
  weights: GradingWeights,
  gradingScale: GradingScale,
  viewMode: ViewMode,
  calculationMode: CalculationMode
) {
  const categories: { id: string; weight: number }[] = [
    { id: 'teorica', weight: weights.teorica.value },
    { id: 'practica', weight: weights.practica.value },
    { id: 'apreciativa', weight: weights.apreciativa.value }
  ];

  if (useCheckpoint) {
    categories.push({ id: 'checkpoint', weight: weights.checkpoint.value });
  }

  // 1. Calcular promedio global por categorías (independiente de módulos)
  const globalFinalValue = calculateWeightedAverage(studentGrades, evaluations, weights, gradingScale, useCheckpoint);

  const globalDetails: Record<string, number> = { teorica: 0, practica: 0, apreciativa: 0, checkpoint: 0 };
  categories.forEach(cat => {
    const typeEvals = evaluations.filter(e => e.type === cat.id);
    const activeEvals = typeEvals.filter(ev =>
      studentGrades.some(g => g.evaluationId === ev.id && typeof g.score === 'number')
    );
    if (activeEvals.length > 0) {
      let sumPct = 0;
      activeEvals.forEach(ev => {
        const grade = studentGrades.find(g => g.evaluationId === ev.id);
        const score = grade?.score || 0;
        const max = ev.maxScore || 100;
        sumPct += (score / max);
      });
      const avg = sumPct / activeEvals.length;
      globalDetails[cat.id] = avg * (gradingScale.maxScore || 100);
    }
  });

  // 2. Calcular notas por módulo
  const moduleNotes: Record<string, number> = {};
  const parentModules = modules.filter(m => !m.parentId);
  const childModules = modules.filter(m => m.parentId);

  const modulesToCalculate = parentModules.length > 0 ? parentModules : (modules.length > 0 ? modules : []);

  modulesToCalculate.forEach(mod => {
    const childIds = childModules.filter(c => c.parentId === mod.id).map(c => c.id);
    const typeEvals = evaluations.filter(e => 
      e.moduleId === mod.id || childIds.includes(e.moduleId)
    );
    
    moduleNotes[mod.id!] = calculateWeightedAverage(studentGrades, typeEvals, weights, gradingScale, useCheckpoint);
  });

  // 3. Determinar el promedio/suma final de acuerdo a la vista y el modo de cálculo
  let finalCalculated = globalFinalValue;
  if (viewMode === 'modules' && modulesToCalculate.length > 0) {
    const modValues = Object.values(moduleNotes);
    const sum = modValues.reduce((a, b) => a + b, 0);
    if (calculationMode === 'sum') {
      finalCalculated = sum;
    } else {
      finalCalculated = modValues.length > 0 ? sum / modValues.length : 0;
    }
  }

  return {
    total: Math.round(finalCalculated * 10) / 10,
    globalBase: Math.round(globalFinalValue * 10) / 10,
    teorica: Math.round(globalDetails.teorica * 10) / 10,
    practica: Math.round(globalDetails.practica * 10) / 10,
    apreciativa: Math.round(globalDetails.apreciativa * 10) / 10,
    checkpoint: Math.round(globalDetails.checkpoint * 10) / 10,
    byModule: moduleNotes
  };
}
