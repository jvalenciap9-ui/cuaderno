import { safeJSONParse } from './utils';

export type CalculationMode = 'average' | 'sum';
export type ViewMode = 'categories' | 'modules';

export interface GradingWeights {
  teorica: { name: string; value: number };
  practica: { name: string; value: number };
  apreciativa: { name: string; value: number };
  checkpoint: { name: string; value: number };
}

export type GradeScaleType = 'porcentaje' | 'numerica_1_5' | 'personalizada';

export interface GradingScale {
  type?: GradeScaleType;
  maxScore: number;
  minPassingScore: number;
  minScore?: number;
  decimals?: number;
}

export const DEFAULT_WEIGHTS: GradingWeights = {
  teorica: { name: 'Teórica', value: 30 },
  practica: { name: 'Práctica', value: 60 },
  apreciativa: { name: 'Apreciativa', value: 10 },
  checkpoint: { name: 'Agregar 4ta Nota', value: 0 }
};

export const DEFAULT_SCALE: GradingScale = {
  type: 'porcentaje',
  maxScore: 100,
  minPassingScore: 71,
  minScore: 0,
  decimals: 1,
};

export const DEFAULT_NUMERICA_SCALE: GradingScale = {
  type: 'numerica_1_5',
  maxScore: 5,
  minPassingScore: 3.0,
  minScore: 1.0,
  decimals: 1,
};

export interface FormattedGradeResult {
  displayValue: string;
  numericValue: number | null;
  isPassing: boolean;
}

/**
 * Función canónica para formatear y calcular notas según la escala activa
 * (porcentual 0-100 o numérica 1-5).
 */
export function formatDisplayGrade(
  score: number | null | undefined,
  maxScore: number | null | undefined,
  scale: GradingScale
): FormattedGradeResult {
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
    return { displayValue: '—', numericValue: null, isPassing: true };
  }

  const evalMax = typeof maxScore === 'number' && maxScore > 0 ? maxScore : 100;
  const ratio = Math.min(1, Math.max(0, score / evalMax)); // 0.0 a 1.0

  const decimals = typeof scale.decimals === 'number' ? scale.decimals : 1;
  const scaleType = scale.type || (scale.maxScore <= 5 ? 'numerica_1_5' : 'porcentaje');

  let numericValue: number;
  if (scaleType === 'numerica_1_5') {
    const min = typeof scale.minScore === 'number' ? scale.minScore : 1.0;
    const max = scale.maxScore || 5.0;
    numericValue = min + ratio * (max - min);
  } else {
    const max = scale.maxScore || 100;
    numericValue = ratio * max;
  }

  const factor = Math.pow(10, decimals);
  numericValue = Math.round(numericValue * factor) / factor;

  const defaultMinPassing = scaleType === 'numerica_1_5' ? 3.0 : 70.0;
  const minPassing = typeof scale.minPassingScore === 'number' ? scale.minPassingScore : defaultMinPassing;
  const isPassing = numericValue >= minPassing;

  return {
    displayValue: numericValue.toFixed(decimals),
    numericValue,
    isPassing,
  };
}

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
      const avgRatio = sumPct / activeEvals.length;
      weightedSum += avgRatio * cat.weight;
    }
  });

  if (totalWeightUsed === 0) return 0;

  const ratio = weightedSum / totalWeightUsed;
  const scaleType = gradingScale.type || (gradingScale.maxScore <= 5 ? 'numerica_1_5' : 'porcentaje');

  if (scaleType === 'numerica_1_5') {
    const min = typeof gradingScale.minScore === 'number' ? gradingScale.minScore : 1.0;
    const max = gradingScale.maxScore || 5.0;
    return Math.round((min + ratio * (max - min)) * 10) / 10;
  } else {
    const max = gradingScale.maxScore || 100;
    return Math.round((ratio * max) * 10) / 10;
  }
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
