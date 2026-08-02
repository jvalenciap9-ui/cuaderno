import React, { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../components/AuthProvider';
import { STORAGE_KEYS, getStorageItem, setStorageItem } from '../lib/storageKeys';
import { safeJSONParse } from '../lib/utils';
import { parseWeights, type ViewMode, type CalculationMode, type GradingWeights, type GradingScale, DEFAULT_WEIGHTS, DEFAULT_SCALE } from '../lib/gradeCalculator';

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

export function GradeSettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const initial = loadFromStorage();

  const [viewMode, setViewModeState] = useState<ViewMode>(initial.viewMode);
  const [calculationMode, setCalculationModeState] = useState<CalculationMode>(initial.calculationMode);
  const [weights, setWeightsState] = useState<GradingWeights>(initial.weights);
  const [gradingScale, setGradingScaleState] = useState<GradingScale>(initial.gradingScale);
  const [useCheckpoint, setUseCheckpointState] = useState<boolean>(initial.useCheckpoint);
  const [firestoreLoaded, setFirestoreLoaded] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
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
    if (!user?.uid || !firestoreLoaded) return;
    saveToFirestore(user.uid, {
      gradingViewMode: viewMode,
      gradingCalculationMode: calculationMode,
      weights,
      gradingScale,
      useCheckpoint,
    });
  }, [viewMode, calculationMode, weights, gradingScale, useCheckpoint, user?.uid, firestoreLoaded]);

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
    setWeightsState(newWeights);
    setStorageItem(STORAGE_KEYS.GRADING_WEIGHTS, JSON.stringify(newWeights));
    window.dispatchEvent(new Event('storage'));
  }, []);

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

  return (
    <GradeSettingsContext.Provider value={{ viewMode, calculationMode, weights, gradingScale, useCheckpoint, setViewMode, setCalculationMode, setWeights, setGradingScale, setUseCheckpoint }}>
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
