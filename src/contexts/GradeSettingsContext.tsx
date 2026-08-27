import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../components/AuthProvider';
import { usePlan } from '../hooks/usePlan';
import { useInstitution } from '../hooks/useInstitution';
import { STORAGE_KEYS, getStorageItem, setStorageItem } from '../lib/storageKeys';
// Modo Demo: los ajustes se guardan solo en localStorage (sin Firestore).
import { IS_DEMO_MODE } from '../lib/demoAdminData';
import { safeJSONParse } from '../lib/utils';
import { parseWeights, type ViewMode, type CalculationMode, type GradingWeights, type GradingScale, DEFAULT_WEIGHTS, DEFAULT_SCALE } from '../lib/gradeCalculator';
import { effectiveWeights } from '../lib/gradingUtils';
import type { GradingWeight } from '../lib/adminApi';

interface GradeSettings {
  viewMode: ViewMode;
  calculationMode: CalculationMode;
  weights: GradingWeights;
  gradingScale: GradingScale;
  useCheckpoint: boolean;
  setViewMode: (mode: ViewMode) => void;
  setCalculationMode: (mode: CalculationMode) => void;
  setWeights: (weights: GradingWeights) => void;
  setGradingScale: (scale: GradingScale) => void;
  setUseCheckpoint: (val: boolean) => void;
  // Política institucional de ponderación: false para docentes vinculados a
  // una institución (solo lectura; la edita el admin en Configuración).
  canEditWeights: boolean;
  // De dónde provienen las ponderaciones efectivas expuestas arriba.
  weightsSource: 'institutional' | 'personal';
}

const GradeSettingsContext = createContext<GradeSettings | null>(null);

function loadFromStorage() {
  return {
    viewMode: (getStorageItem(STORAGE_KEYS.GRADING_VIEW_MODE) as ViewMode) || 'categories',
    calculationMode: (getStorageItem(STORAGE_KEYS.GRADING_CALCULATION_MODE) as CalculationMode) || 'average',
    weights: parseWeights(getStorageItem(STORAGE_KEYS.GRADING_WEIGHTS)),
    gradingScale: safeJSONParse(getStorageItem(STORAGE_KEYS.GRADING_SCALE), { ...DEFAULT_SCALE }),
    useCheckpoint: safeJSONParse(getStorageItem(STORAGE_KEYS.USE_CHECKPOINT), false),
  };
}

function saveToStorage(viewMode: ViewMode, calculationMode: CalculationMode, weights: GradingWeights, gradingScale: GradingScale, useCheckpoint: boolean) {
  setStorageItem(STORAGE_KEYS.GRADING_VIEW_MODE, viewMode);
  setStorageItem(STORAGE_KEYS.GRADING_CALCULATION_MODE, calculationMode);
  setStorageItem(STORAGE_KEYS.GRADING_WEIGHTS, JSON.stringify(weights));
  setStorageItem(STORAGE_KEYS.GRADING_SCALE, JSON.stringify(gradingScale));
  setStorageItem(STORAGE_KEYS.USE_CHECKPOINT, JSON.stringify(useCheckpoint));
  window.dispatchEvent(new Event('storage'));
}

function firestoreDocId(userId: string) {
  return doc(db, 'userSettings', userId);
}

async function loadFromFirestore(userId: string) {
  try {
    const snap = await getDoc(firestoreDocId(userId));
    if (snap.exists()) {
      return snap.data();
    }
  } catch (e) {
    console.warn('Failed to load settings from Firestore:', e);
  }
  return {};
}

async function saveToFirestore(userId: string, data: Record<string, unknown>) {
  try {
    await setDoc(firestoreDocId(userId), data, { merge: true });
  } catch (e) {
    console.warn('Failed to save settings to Firestore:', e);
  }
}

// Mapea la ponderación institucional (GradingWeight) al modelo de categorías
// del docente (GradingWeights). 'competencias' reinterpreta las etiquetas como
// Saber/Hacer/Ser sobre los mismos tres tipos de evaluación. La 4ta nota
// (checkpoint) no forma parte del modelo institucional → peso 0 (sin efecto
// en el cálculo). Ponderación institucional ausente → defaults 30/60/10.
function institutionalToTeacherWeights(gw: GradingWeight | null): GradingWeights {
  const w = effectiveWeights(gw);
  const names = gw?.mode === 'competencias'
    ? { teorica: 'Saber', practica: 'Hacer', apreciativa: 'Ser' }
    : { teorica: DEFAULT_WEIGHTS.teorica.name, practica: DEFAULT_WEIGHTS.practica.name, apreciativa: DEFAULT_WEIGHTS.apreciativa.name };
  return {
    teorica: { name: names.teorica, value: w.teoria },
    practica: { name: names.practica, value: w.practica },
    apreciativa: { name: names.apreciativa, value: w.apreciativa },
    checkpoint: { name: DEFAULT_WEIGHTS.checkpoint.name, value: 0 },
  };
}

export function GradeSettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { profile } = usePlan();
  const { gradingWeight: institutionalWeight } = useInstitution();
  const initial = loadFromStorage();

  const [viewMode, setViewModeState] = useState<ViewMode>(initial.viewMode);
  const [calculationMode, setCalculationModeState] = useState<CalculationMode>(initial.calculationMode);
  const [weights, setWeightsState] = useState<GradingWeights>(initial.weights);
  const [gradingScale, setGradingScaleState] = useState<GradingScale>(initial.gradingScale);
  const [useCheckpoint, setUseCheckpointState] = useState<boolean>(initial.useCheckpoint);
  const [firestoreLoaded, setFirestoreLoaded] = useState(false);

  const isInstitutionalMember = !!profile?.institutionId;
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    if (IS_DEMO_MODE || !user?.uid) {
      setFirestoreLoaded(true);
      return;
    }
    loadFromFirestore(user.uid).then(fsSettings => {
      if (fsSettings.gradingViewMode) setViewModeState(fsSettings.gradingViewMode as ViewMode);
      if (fsSettings.gradingCalculationMode) setCalculationModeState(fsSettings.gradingCalculationMode as CalculationMode);
      if (fsSettings.weights) setWeightsState(fsSettings.weights as GradingWeights);
      if (fsSettings.gradingScale) setGradingScaleState(fsSettings.gradingScale as GradingScale);
      if (typeof fsSettings.useCheckpoint === 'boolean') setUseCheckpointState(fsSettings.useCheckpoint as boolean);
      setFirestoreLoaded(true);
    });
  }, [user?.uid]);

  useEffect(() => {
    if (IS_DEMO_MODE || !user?.uid || !firestoreLoaded) return;
    saveToFirestore(user.uid, {
      gradingViewMode: viewMode,
      gradingCalculationMode: calculationMode,
      weights,
      gradingScale,
      useCheckpoint,
    });
  }, [viewMode, calculationMode, weights, gradingScale, useCheckpoint, user?.uid, firestoreLoaded]);

  // Política institucional: para miembros de la institución las ponderaciones
  // efectivas son SIEMPRE las institucionales (la personal queda ignorada, no
  // borrada) y solo el admin puede editarlas. Docentes individuales (Premium
  // Pro sin institución) conservan su configuración personal intacta.
  const canEditWeights = !isInstitutionalMember || isAdmin;
  const weightsSource: 'institutional' | 'personal' = isInstitutionalMember ? 'institutional' : 'personal';
  const effectiveWeightsState = useMemo(
    () => (isInstitutionalMember ? institutionalToTeacherWeights(institutionalWeight) : weights),
    [isInstitutionalMember, institutionalWeight, weights],
  );

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    setStorageItem(STORAGE_KEYS.GRADING_VIEW_MODE, mode);
    window.dispatchEvent(new Event('storage'));
  }, []);

  const setCalculationMode = useCallback((mode: CalculationMode) => {
    setCalculationModeState(mode);
    setStorageItem(STORAGE_KEYS.GRADING_CALCULATION_MODE, mode);
    window.dispatchEvent(new Event('storage'));
  }, []);

  const setWeights = useCallback((newWeights: GradingWeights) => {
    // La ponderación es política institucional: un docente vinculado a una
    // institución NO puede modificarla (la edición personal se ignora).
    if (isInstitutionalMember && !isAdmin) return;
    setWeightsState(newWeights);
    setStorageItem(STORAGE_KEYS.GRADING_WEIGHTS, JSON.stringify(newWeights));
    window.dispatchEvent(new Event('storage'));
  }, [isInstitutionalMember, isAdmin]);

  const setGradingScale = useCallback((newScale: GradingScale) => {
    setGradingScaleState(newScale);
    setStorageItem(STORAGE_KEYS.GRADING_SCALE, JSON.stringify(newScale));
    window.dispatchEvent(new Event('storage'));
  }, []);

  const setUseCheckpoint = useCallback((val: boolean) => {
    setUseCheckpointState(val);
    setStorageItem(STORAGE_KEYS.USE_CHECKPOINT, JSON.stringify(val));
    window.dispatchEvent(new Event('storage'));
  }, []);

  const value = useMemo(() => ({
    viewMode,
    calculationMode,
    weights: effectiveWeightsState,
    gradingScale,
    useCheckpoint,
    setViewMode,
    setCalculationMode,
    setWeights,
    setGradingScale,
    setUseCheckpoint,
    canEditWeights,
    weightsSource,
  }), [viewMode, calculationMode, effectiveWeightsState, gradingScale, useCheckpoint, setViewMode, setCalculationMode, setWeights, setGradingScale, setUseCheckpoint, canEditWeights, weightsSource]);

  return (
    <GradeSettingsContext.Provider value={value}>
      {children}
    </GradeSettingsContext.Provider>
  );
}

export function useGradeSettings(): GradeSettings {
  const ctx = useContext(GradeSettingsContext);
  if (!ctx) {
    throw new Error('useGradeSettings must be used within a GradeSettingsProvider');
  }
  return ctx;
}
