import { format } from 'date-fns';
import React, { useState } from 'react';
import { X, Settings, Shield, Zap, CreditCard, Bell, Database, Trash2, Download, FileText, BarChart3, Info, Heart, Key, AlertCircle, Loader2, Check, Layers, Sparkles, Upload, ChevronDown, SlidersHorizontal, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth } from '../lib/firebase';
import { collection, query, where, getDocs, writeBatch, doc, limit, orderBy, startAfter, setDoc, getDoc } from 'firebase/firestore';
import { db as dexieDb } from '../lib/db';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { usePlan } from '../hooks/usePlan';
import { showToast } from '../hooks/useToast';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'general' | 'advanced' | 'billing';
}

import { safeJSONParse } from '../lib/utils';
import { STORAGE_KEYS, getStorageItem, setStorageItem } from '../lib/storageKeys';
import { useGradeSettings } from '../contexts/GradeSettingsContext';
import { parseWeights, calculateStudentGrades } from '../lib/gradeCalculator';
import { addSubjectCounterOp } from '../lib/subjectCounter';
import { exportAdminDataToJSON, triggerAdminJSONDownload, adminRestoreInstitutionBackup, adminGetSchoolConfig, adminSaveGradingWeight, DEFAULT_GRADING_WEIGHT, type GradingWeight } from '../lib/adminApi';
import { validateInstitutionBackup, type BackupSummary } from '../lib/backupValidation';
import { GradingWeightEditor } from './GradingWeightEditor';

export function SettingsModal({ isOpen, onClose, initialTab }: SettingsModalProps) {
  const { plan: dbPlan, profile, limits } = usePlan();
  const [activeTab, setActiveTab] = useState<'general' | 'advanced' | 'billing'>(initialTab || 'general');
  
  const [sandboxMode, setSandboxMode] = useState<boolean>(() => {
    return getStorageItem('ediagil_sandbox_mode') === 'true';
  });

  const [activeSubscription, setActiveSubscription] = useState<'free' | 'pro' | 'school'>(() => {
    return (getStorageItem(STORAGE_KEYS.ACTIVE_SUBSCRIPTION) as 'free' | 'pro' | 'school') || 'free';
  });

  // Mantener sincronizado el estado local con la base de datos si NO estamos en sandbox mode
  React.useEffect(() => {
    if (!sandboxMode && dbPlan) {
      setActiveSubscription(dbPlan);
    }
  }, [dbPlan, sandboxMode]);

  const functions = getFunctions();
  const profileAny = profile as unknown as { isTrial?: boolean; trialEndsAt?: number; trialUsed?: boolean };
  // WR-01: isTrial derivado del perfil RAW (no de dbPlan derivado), para que un
  // trial expirado (cuyo plan derivado ya es 'free') pueda resolverse.
  const isTrial = profileAny?.isTrial === true && dbPlan === 'pro';
  const rawTrial = profileAny?.isTrial === true;
  const trialEndsAt = typeof profileAny?.trialEndsAt === 'number' ? profileAny.trialEndsAt : undefined;
  const trialDaysLeft = trialEndsAt !== undefined ? Math.ceil((trialEndsAt - Date.now()) / 86400000) : 0;

  const handleSelectPlan = (plan: 'free' | 'pro' | 'school') => {
    setActiveSubscription(plan);
    setStorageItem(STORAGE_KEYS.ACTIVE_SUBSCRIPTION, plan);
    window.dispatchEvent(new Event('subscription_change'));
  };

  const handleToggleSandbox = (val: boolean) => {
    setSandboxMode(val);
    setStorageItem('ediagil_sandbox_mode', String(val));
    if (!val && dbPlan) {
      handleSelectPlan(dbPlan);
    }
  };

  const [licenseKey, setLicenseKey] = useState('');
  const [licenseLoading, setLicenseLoading] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState<{ type: 'success' | 'error' | '', message: string }>({ type: '', message: '' });
  const [checkoutLoading, setCheckoutLoading] = useState<'pro' | 'school' | null>(null);
  const [trialLoading, setTrialLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [institutionName, setInstitutionName] = useState('');

  const handleManageSubscription = async () => {
    setPortalLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Debes iniciar sesión');
      const token = await user.getIdToken();
      const res = await fetch('/api/create-portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al abrir portal');
      if (data.url) window.open(data.url, '_blank');
    } catch (err: any) {
      showToast('error', err?.message || 'Error al abrir el portal de suscripción');
    } finally {
      setPortalLoading(false);
    }
  };

  const handleCheckout = async (plan: 'pro' | 'school') => {
    setCheckoutLoading(plan);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Debes iniciar sesión');
      const token = await user.getIdToken();

      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ plan, ...(plan === 'school' && institutionName.trim() ? { institutionName: institutionName.trim() } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error del servidor');
      if (data.url) window.location.href = data.url;
    } catch (err: any) {
      console.error('❌ Checkout error:', err);
      showToast('error', err?.message || 'Error al iniciar el pago. Intenta de nuevo.');
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleActivateTrial = async () => {
    setTrialLoading(true);
    try {
      const fn = httpsCallable(functions, 'activateTrial');
      await fn();
      showToast('success', '¡Tu prueba gratuita de Premium Pro (14 días) está activa!');
    } catch (err: any) {
      console.error('❌ Error activando prueba gratuita:', err);
      showToast('error', err?.message || 'No se pudo activar la prueba gratuita. Intenta de nuevo.');
    } finally {
      setTrialLoading(false);
    }
  };

  const resolveExpiredTrial = async () => {
    try {
      const fn = httpsCallable(functions, 'resolveTrialExpiry');
      await fn();
    } catch {}
  };

  React.useEffect(() => {
    if (!sandboxMode && rawTrial && trialEndsAt !== undefined && trialEndsAt < Date.now()) {
      resolveExpiredTrial();
    }
  }, [sandboxMode, rawTrial, trialEndsAt]);

  const handleRedeemKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseKey.trim()) return;
    setLicenseLoading(true);
    setLicenseStatus({ type: '', message: '' });

    try {
      const redeemKeyFn = httpsCallable<{ key: string }, { success: boolean; plan: 'free' | 'pro' | 'school'; message: string }>(functions, 'redeemLicenseKey');
      const result = await redeemKeyFn({ key: licenseKey });
      
      if (result.data?.success) {
        setLicenseStatus({ type: 'success', message: result.data.message });
        setLicenseKey('');
        handleSelectPlan(result.data.plan);
      }
    } catch (err: any) {
      console.error(err);
      setLicenseStatus({ 
        type: 'error', 
        message: err?.message || 'Error al canjear el código. Verifica que sea correcto.' 
      });
    } finally {
      setLicenseLoading(false);
    }
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [isConfirmingClearCalendar, setIsConfirmingClearCalendar] = useState(false);
  const [isConfirmingClearEvaluations, setIsConfirmingClearEvaluations] = useState(false);
  const [importData, setImportData] = useState<any>(null);
  const { viewMode, calculationMode, weights, gradingScale, useCheckpoint, setViewMode, setCalculationMode, setWeights, setGradingScale, setUseCheckpoint, canEditWeights, weightsSource } = useGradeSettings();

  const handleUpdateWeight = (type: keyof typeof weights, field: 'name' | 'value', value: string) => {
    const newWeights = { ...weights };
    if (field === 'value') {
      newWeights[type].value = parseFloat(value) || 0;
    } else {
      newWeights[type].name = value;
    }
    setWeights(newWeights);
  };

  const toggleCheckpoint = () => {
    setUseCheckpoint(!useCheckpoint);
  };

  const handleUpdateScale = (field: 'maxScore' | 'minPassingScore', value: string) => {
    const newScale = { ...gradingScale, [field]: parseFloat(value) || 0 };
    setGradingScale(newScale);
  };

  const getAllDocsForUser = async (colName: string, subjectId?: string) => {
    if (!auth.currentUser) return [];
    const uid = auth.currentUser.uid;
    const allDocs: Record<string, any>[] = [];
    let lastDoc: any = null;
    for (;;) {
      let q = query(collection(db, colName), where('userId', '==', uid));
      if (subjectId) q = query(q, where('subjectId', '==', subjectId));
      q = query(q, orderBy('__name__', 'asc'));
      if (lastDoc) q = query(q, startAfter(lastDoc));
      const snaps = await getDocs(q);
      if (snaps.docs.length === 0) break;
      allDocs.push(...snaps.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      lastDoc = snaps.docs[snaps.docs.length - 1];
    }
    return allDocs;
  };

  const getDocsForUser = async (colName: string) => {
    return getAllDocsForUser(colName);
  };

  const clearCollection = async (colName: string) => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    let lastDoc: any = null;
    for (;;) {
      let q = query(collection(db, colName), where('userId', '==', uid), orderBy('__name__', 'asc'));
      if (lastDoc) q = query(q, startAfter(lastDoc));
      const snaps = await getDocs(q);
      if (snaps.docs.length === 0) break;
      let batch = writeBatch(db);
      let count = 0;
      for (const d of snaps.docs) {
        batch.delete(d.ref);
        count++;
        if (count % 400 === 0) {
          await batch.commit();
          batch = writeBatch(db);
        }
      }
      if (count % 400 !== 0) await batch.commit();
      lastDoc = snaps.docs[snaps.docs.length - 1];
    }
    if (colName === 'subjects') {
      const resetRef = doc(db, 'userCounters', uid);
      const now = Date.now();
      const existingCounter = await getDoc(resetRef);
      let writes = 1;
      let writeWindowStart = now;
      const prev = existingCounter.exists() ? existingCounter.data() : null;
      if (prev && typeof prev.writeWindowStart === 'number' && prev.writeWindowStart + 60000 > now && typeof prev.writes === 'number') {
        writes = prev.writes + 1;
        writeWindowStart = prev.writeWindowStart;
      }
      // C8: el reset a 0 preserva el cupo del año (createdThisYear/yearKey),
      // coherente con "borrar una asignatura NO libera cupo del año".
      const year = String(new Date().getFullYear());
      const createdThisYear = prev && typeof prev.createdThisYear === 'number' && prev.createdThisYear >= 0
        ? prev.createdThisYear : 0;
      const yearKey = prev && typeof prev.yearKey === 'string' && prev.yearKey.length > 0 ? prev.yearKey : year;
      await setDoc(resetRef, { subjectCount: 0, createdThisYear, yearKey, updatedAt: now, writes, writeWindowStart }, { merge: true });
    }
  };

  const triggerAllQueries = async () => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const collectionsToTest = [
      'subjects', 'notes', 'students', 'evaluations', 'grades', 'attendance', 'materials', 'subjectModules', 'calendarEvents'
    ];
    
    // Simulate complex queries to force index generation links in the console
    for (const col of collectionsToTest) {
      try {
        const q1 = query(collection(db, col), where('userId', '==', uid), where('subjectId', '==', 'test-subject-id'), limit(500));
        await getDocs(q1);
      } catch(e) {
        console.warn(`Query over ${col} missed index. Check console for links.`);
      }
      if (col === 'calendarEvents' || col === 'evaluations') {
        try {
          const q2 = query(collection(db, col), where('moduleId', '==', 'test-module-id'), where('userId', '==', uid), limit(500));
          await getDocs(q2);
        } catch(e) {
          console.warn(`Query over ${col} by moduleId missed index.`);
        }
      }
      if (col === 'grades') {
        try {
          const q3 = query(collection(db, col), where('evaluationId', '==', 'test-eval'), where('userId', '==', uid), limit(500));
          await getDocs(q3);
        } catch(e) {
          console.warn(`Query over grades missed index.`);
        }
      }
    }
    showToast('success', 'Diagnóstico completado. Revisa la consola del navegador. Si hay índices compuestos pendientes, Firestore mostrará los enlaces en la consola.');
  };

  const buildExportData = async () => {
    const settings = {
      gradingWeights: parseWeights(getStorageItem(STORAGE_KEYS.GRADING_WEIGHTS)),
      gradingScale: safeJSONParse(getStorageItem(STORAGE_KEYS.GRADING_SCALE), { maxScore: 100, minPassingScore: 71 }),
      useCheckpoint: safeJSONParse(getStorageItem(STORAGE_KEYS.USE_CHECKPOINT), false),
      viewMode: (getStorageItem(STORAGE_KEYS.GRADING_VIEW_MODE) || 'categories') as string,
      calculationMode: (getStorageItem(STORAGE_KEYS.GRADING_CALCULATION_MODE) || 'average') as string,
    };

    const [extractedEvents, uploadedDocs] = await Promise.all([
      dexieDb.extractedEvents.toArray(),
      dexieDb.uploadedDocs.toArray(),
    ]);

    return {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      subjects: await getDocsForUser('subjects'),
      notes: await getDocsForUser('notes'),
      students: await getDocsForUser('students'),
      evaluations: await getDocsForUser('evaluations'),
      grades: await getDocsForUser('grades'),
      attendance: await getDocsForUser('attendance'),
      materials: await getDocsForUser('materials'),
      modules: await getDocsForUser('subjectModules'),
      calendarEvents: await getDocsForUser('calendarEvents'),
      classGroups: await getDocsForUser('classGroups'),
      extractedEvents,
      uploadedDocs,
      settings,
    };
  };

  const triggerJSONDownload = (data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportData = async () => {
    if (!auth.currentUser) return;
    const data = await buildExportData();
    triggerJSONDownload(data, `mi-cuaderno-backup-${format(new Date(), 'yyyy-MM-dd')}.json`);
  };

  const autoBackupBeforeImport = async () => {
    const data = await buildExportData();
    triggerJSONDownload(data, `respaldo-automatico-pre-import-${format(new Date(), 'yyyy-MM-dd')}.json`);
  };

  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = safeJSONParse(event.target?.result as string, null);
        if (!data) throw new Error("Invalid json schema");
        setImportData(data);
      } catch (error) {
        console.error('Error importing data:', error);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Respaldo institucional (solo administradores) ────────────────────────
  // PDF = consumir/compartir; JSON = proteger/recuperar. Este pipeline es la
  // vía de RECUPERACIÓN: validación → preview → confirmación fuerte
  // ("RESTAURAR") → backup previo automático → restauración con permiso del
  // backend. El flujo JSON personal del docente NO se toca.
  const isAdminUser = profile?.role === 'admin';
  const adminBackupFileRef = React.useRef<HTMLInputElement>(null);
  const [backupExportOpen, setBackupExportOpen] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [importedBackup, setImportedBackup] = useState<{ payload: any; summary: BackupSummary } | null>(null);
  const [restoreStage, setRestoreStage] = useState<'preview' | 'confirm'>('preview');
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);

  // ── Ponderaciones académicas (política institucional, solo admin) ────────
  // La ponderación es configuración institucional: el admin la edita aquí y
  // los docentes la consultan en solo lectura. La fuente es
  // institutions/{id}.gradingWeight (escritura SOLO vía adminSaveGradingWeight).
  const [instWeight, setInstWeight] = useState<GradingWeight | null>(null);
  const [instWeightLoading, setInstWeightLoading] = useState(false);
  const [instWeightSaving, setInstWeightSaving] = useState(false);
  const [weightConfirmOpen, setWeightConfirmOpen] = useState(false);

  React.useEffect(() => {
    if (!isOpen || !isAdminUser) return;
    let cancelled = false;
    setInstWeightLoading(true);
    adminGetSchoolConfig()
      .then((res) => {
        if (!cancelled) setInstWeight(res.gradingWeight ?? { ...DEFAULT_GRADING_WEIGHT });
      })
      .catch((err) => {
        console.warn('No se pudo leer la ponderación institucional:', err?.message || err);
        if (!cancelled) setInstWeight({ ...DEFAULT_GRADING_WEIGHT });
      })
      .finally(() => {
        if (!cancelled) setInstWeightLoading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen, isAdminUser]);

  const instWeightTotal = React.useMemo(() => {
    if (!instWeight) return 0;
    if (instWeight.mode === 'personalizada') {
      return Object.values(instWeight.customWeights).reduce((acc, v) => acc + (typeof v === 'number' && Number.isFinite(v) ? v : 0), 0);
    }
    return instWeight.weights.teoria + instWeight.weights.practica + instWeight.weights.apreciativa;
  }, [instWeight]);
  const instWeightComplete = Math.abs(instWeightTotal - 100) < 0.01;

  const handleSaveInstWeight = () => {
    if (!instWeight || instWeightSaving) return;
    if (!instWeightComplete) {
      showToast('error', `La suma de las ponderaciones debe ser 100%. Actualmente suma ${Math.round(instWeightTotal * 100) / 100}%.`);
      return;
    }
    // B5: nunca guardar silenciosamente — advertencia de impacto en cálculos.
    setWeightConfirmOpen(true);
  };

  const confirmSaveInstWeight = async () => {
    if (!instWeight || instWeightSaving) return;
    setWeightConfirmOpen(false);
    setInstWeightSaving(true);
    try {
      const res = await adminSaveGradingWeight(instWeight);
      setInstWeight(res.gradingWeight ?? instWeight);
      showToast('success', 'Ponderaciones académicas actualizadas. Los docentes verán los nuevos valores.');
    } catch (err: any) {
      console.error('Error guardando ponderación institucional:', err);
      showToast('error', err?.message && typeof err.message === 'string' && err.message.length < 200 ? err.message : 'No se pudo guardar la ponderación. Intenta de nuevo.');
    } finally {
      setInstWeightSaving(false);
    }
  };

  const resetInstWeight = () => {
    setInstWeight((prev) => ({
      ...(prev ?? DEFAULT_GRADING_WEIGHT),
      mode: 'tradicional',
      weights: { ...DEFAULT_GRADING_WEIGHT.weights },
      customWeights: {},
    }));
    showToast('info', 'Valores restablecidos a 30/60/10. Aplica los cambios para guardar.');
  };

  const sanitizeFilenamePart = (name: string) =>
    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Institucion';

  React.useEffect(() => {
    if (!backupExportOpen && !importedBackup && !weightConfirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || exportingBackup || restoring || instWeightSaving) return;
      if (weightConfirmOpen) {
        setWeightConfirmOpen(false);
        return;
      }
      if (importedBackup && restoreStage === 'confirm') {
        setRestoreStage('preview');
        return;
      }
      setBackupExportOpen(false);
      setImportedBackup(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [backupExportOpen, importedBackup, restoreStage, exportingBackup, restoring, weightConfirmOpen, instWeightSaving]);

  const fullBackupOptions = {
    includeMetrics: true,
    includeAlerts: true,
    includeTeachers: true,
    includeStudents: true,
    includeDiscrepancies: true,
    includeStats: true,
  } as const;

  const handleAdminBackupExport = async () => {
    setExportingBackup(true);
    try {
      showToast('info', 'Preparando respaldo...');
      // SIN filtros turno/nivel: el respaldo es institucional completo.
      const data = await exportAdminDataToJSON(fullBackupOptions);
      const instPart = sanitizeFilenamePart(data.institutionName || profile?.institutionName || 'Institucion');
      triggerAdminJSONDownload(data, `EdiAgil-Respaldo-${instPart}-${format(new Date(), 'yyyy-MM-dd')}.json`);
      showToast('success', 'Respaldo descargado correctamente.');
      setBackupExportOpen(false);
    } catch (err) {
      console.error('Error exportando respaldo institucional:', err);
      showToast('error', 'No se pudo generar el respaldo institucional. Intenta de nuevo.');
    } finally {
      setExportingBackup(false);
    }
  };

  const handleAdminBackupFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (adminBackupFileRef.current) adminBackupFileRef.current.value = '';
    if (!file) return;
    if (!profile?.institutionId) {
      showToast('error', 'Tu cuenta no tiene una institución asignada.');
      return;
    }
    showToast('info', 'Validando archivo...');
    const reader = new FileReader();
    reader.onerror = () => {
      showToast('error', 'No se pudo leer el archivo. Intenta de nuevo.');
    };
    reader.onload = (event) => {
      try {
        const parsed = safeJSONParse(event.target?.result as string, null);
        const result = validateInstitutionBackup(parsed, profile!.institutionId!);
        if (result.ok === false) {
          console.warn('Respaldo inválido:', result.code);
          showToast('error', result.userMessage);
          return;
        }
        setImportedBackup({ payload: parsed, summary: result.summary });
        setRestoreStage('preview');
        setRestoreConfirmText('');
      } catch {
        showToast('error', 'Este archivo no parece ser un respaldo válido de EdiAgil.');
      }
    };
    reader.readAsText(file);
  };

  const handleAdminBackupRestore = async () => {
    if (!importedBackup || restoring) return;
    setRestoring(true);
    try {
      // BACKUP PREVIO AUTOMÁTICO: nunca restaurar sin completar este paso.
      showToast('info', 'Preparando respaldo...');
      const currentState = await exportAdminDataToJSON(fullBackupOptions);
      const instPart = sanitizeFilenamePart(currentState.institutionName || profile?.institutionName || 'Institucion');
      triggerAdminJSONDownload(currentState, `EdiAgil-PreRestauracion-${instPart}-${format(new Date(), 'yyyy-MM-dd_HH-mm')}.json`);

      showToast('info', 'Restaurando configuración institucional...');
      const res = await adminRestoreInstitutionBackup(importedBackup.payload);
      showToast('success', 'Configuración institucional restaurada correctamente.');
      // Avisos no fatales del backend (p. ej. ponderación inválida omitida).
      if (res?.warnings?.length) {
        res.warnings.forEach((w) => showToast('warning', w));
      }
      setImportedBackup(null);
    } catch (err: any) {
      console.error('Error restaurando respaldo institucional:', err);
      showToast(
        'error',
        err?.code && typeof err.message === 'string' && err.message.length < 200
          ? err.message
          : 'La restauración falló. Usa el archivo de pre-restauración que se descargó para recuperar el estado anterior.',
      );
    } finally {
      setRestoring(false);
    }
  };

  const applySettings = async (settings: any) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    if (settings.gradingWeights !== undefined) setStorageItem(STORAGE_KEYS.GRADING_WEIGHTS, JSON.stringify(settings.gradingWeights));
    if (settings.gradingScale !== undefined) setStorageItem(STORAGE_KEYS.GRADING_SCALE, JSON.stringify(settings.gradingScale));
    if (settings.useCheckpoint !== undefined) setStorageItem(STORAGE_KEYS.USE_CHECKPOINT, JSON.stringify(settings.useCheckpoint));
    if (settings.viewMode !== undefined) setStorageItem(STORAGE_KEYS.GRADING_VIEW_MODE, String(settings.viewMode));
    if (settings.calculationMode !== undefined) setStorageItem(STORAGE_KEYS.GRADING_CALCULATION_MODE, String(settings.calculationMode));

    const fsDoc: Record<string, unknown> = {};
    if (settings.viewMode !== undefined) fsDoc.gradingViewMode = settings.viewMode;
    if (settings.calculationMode !== undefined) fsDoc.gradingCalculationMode = settings.calculationMode;
    if (settings.gradingWeights !== undefined) fsDoc.weights = settings.gradingWeights;
    if (settings.gradingScale !== undefined) fsDoc.gradingScale = settings.gradingScale;
    if (settings.useCheckpoint !== undefined) fsDoc.useCheckpoint = settings.useCheckpoint;

    try {
      if (Object.keys(fsDoc).length > 0) {
        await setDoc(doc(db, 'userSettings', uid), fsDoc, { merge: true });
      }
    } catch (e) {
      console.warn('Error saving settings to Firestore:', e);
    }
    window.dispatchEvent(new Event('storage'));
  };

  const restoreLocalTables = async (data: any) => {
    const convertDateFields = (records: any[], fields: string[]) =>
      (records || []).map((r: any) => {
        const out = { ...r };
        for (const f of fields) {
          if (typeof out[f] === 'string' && out[f] && !isNaN(Date.parse(out[f]))) {
            out[f] = new Date(out[f]);
          }
        }
        return out;
      });

    if (Array.isArray(data.extractedEvents)) {
      try {
        await dexieDb.extractedEvents.bulkPut(convertDateFields(data.extractedEvents, ['startDate', 'endDate']));
      } catch (e) {
        console.warn('Error restoring extractedEvents:', e);
      }
    }
    if (Array.isArray(data.uploadedDocs)) {
      try {
        await dexieDb.uploadedDocs.bulkPut(convertDateFields(data.uploadedDocs, ['processedAt']));
      } catch (e) {
        console.warn('Error restoring uploadedDocs:', e);
      }
    }
  };

  const confirmImport = async () => {
    if (!importData || !auth.currentUser) return;
    try {
      const data = importData;

      if (!data || typeof data !== 'object') {
        showToast('error', 'El archivo no tiene un formato de respaldo válido.');
        setImportData(null);
        return;
      }

      const hasModules = Array.isArray(data.modules) || Array.isArray(data.subjectModules);
      const requiredKeys = ['subjects', 'notes', 'students', 'evaluations', 'grades', 'attendance', 'materials', 'calendarEvents'];
      const validStructure = hasModules && requiredKeys.every(key => Array.isArray(data[key]));
      if (!validStructure) {
        showToast('error', 'El archivo no tiene un formato de respaldo válido de EdiAgil.');
        setImportData(null);
        return;
      }

      await autoBackupBeforeImport();
      showToast('info', 'Se descargó un respaldo automático antes de importar. Guárdalo por seguridad.');

      const collections = ['subjects', 'notes', 'students', 'evaluations', 'grades', 'attendance', 'materials', 'subjectModules', 'calendarEvents', 'classGroups'];
      await Promise.all(collections.map(col => clearCollection(col)));

      const importCol = async (dataList: Record<string, unknown>[], colName: string) => {
        if (!dataList || dataList.length === 0) return;
        let batch = writeBatch(db);
        let count = 0;
        for (const item of dataList) {
          const docId = typeof item.id === 'string' ? item.id : undefined;
          const { id, ...dataToSave } = item;
          dataToSave.userId = auth.currentUser!.uid;
          
          const docRef = docId ? doc(db, colName, docId) : doc(collection(db, colName));
          batch.set(docRef, dataToSave);
          count++;
          if (count % 400 === 0) {
            await batch.commit();
            batch = writeBatch(db);
          }
        }
        if (count % 400 !== 0) await batch.commit();
      };

      // Las AULAS/GRUPOS se importan ANTES que las asignaturas: cada aula
      // consume 1 unidad (+1) y sus materias internas luego NO incrementan
      // (la regla de subjects.create las reconoce por groupId del aula propio).
      const restoredGroupIds = new Set<string>();
      if (Array.isArray(data.classGroups)) {
        for (const group of data.classGroups) {
          const docId = typeof group.id === 'string' ? group.id : undefined;
          const { id, ...groupToSave } = group as Record<string, unknown> & { id?: string };
          groupToSave.userId = auth.currentUser!.uid;
          const gRef = docId ? doc(db, 'classGroups', docId) : doc(collection(db, 'classGroups'));
          restoredGroupIds.add(gRef.id);
          const gBatch = writeBatch(db);
          gBatch.set(gRef, groupToSave);
          await addSubjectCounterOp(gBatch, auth.currentUser!.uid, +1);
          await gBatch.commit();
        }
      }

      // Las asignaturas se importan una a la vez: la regla de seguridad exige que
      // el contador `userCounters/{uid}` se incremente exactamente +1 por asignatura
      // en el mismo batch, SALVO materias internas de un aula restaurada arriba
      // (esas no consumen cuota y la reglas las aceptan sin incremento).
      if (data.subjects) {
        for (const subject of data.subjects) {
          const docId = typeof subject.id === 'string' ? subject.id : undefined;
          const { id, ...subjectToSave } = subject as Record<string, unknown> & { id?: string; groupId?: string };
          subjectToSave.userId = auth.currentUser!.uid;
          const isInternalMateria =
            typeof subjectToSave.groupId === 'string' && restoredGroupIds.has(subjectToSave.groupId);
          const subjRef = docId ? doc(db, 'subjects', docId) : doc(collection(db, 'subjects'));
          const subjBatch = writeBatch(db);
          subjBatch.set(subjRef, subjectToSave);
          if (!isInternalMateria) {
            await addSubjectCounterOp(subjBatch, auth.currentUser!.uid, +1);
          }
          await subjBatch.commit();
        }
      }
      if (data.notes) await importCol(data.notes, 'notes');
      if (data.students) await importCol(data.students, 'students');
      if (data.evaluations) await importCol(data.evaluations, 'evaluations');
      if (data.grades) await importCol(data.grades, 'grades');
      if (data.attendance) await importCol(data.attendance, 'attendance');
      if (data.materials) await importCol(data.materials, 'materials');
      if (data.modules) await importCol(data.modules, 'subjectModules');
      else if (data.subjectModules) await importCol(data.subjectModules, 'subjectModules');
      if (data.calendarEvents) await importCol(data.calendarEvents, 'calendarEvents');

      if (data.settings) {
        await applySettings(data.settings);
      }

      await restoreLocalTables(data);

      window.location.reload();
    } catch (error) {
      console.error('Error importing data:', error);
      handleFirestoreError(error, OperationType.WRITE, 'import');
      showToast('error', 'La importación falló. Usa el respaldo automático descargado (respaldo-automatico-pre-import-*.json) para restaurar tus datos.');
      setImportData(null);
    }
  };

  const handleExportDetailedSummary = async () => {
    const { utils, writeFile } = await import('xlsx');
    if (!auth.currentUser) return;
    const getDocsForUserSubject = async (colName: string, subjectId: string) => {
      return getAllDocsForUser(colName, subjectId);
    };

    const subjects = await getAllDocsForUser('subjects');
    
    const wb = utils.book_new();

    for (const subject of subjects) {
      const subjectId = subject.id;
      const students = await getDocsForUserSubject('students', subjectId);
      const evaluations = await getDocsForUserSubject('evaluations', subjectId);
      const grades = await getDocsForUserSubject('grades', subjectId);
      const attendance = await getDocsForUserSubject('attendance', subjectId);
      const notes = await getDocsForUserSubject('notes', subjectId);
      const modules = await getDocsForUserSubject('subjectModules', subjectId);

      // Summary Sheet
      const summaryData = [
        ['Resumen de Asignatura', subject.name],
        ['Profesor', 'Usuario'],
        ['Fecha de Reporte', new Date().toLocaleDateString()],
        [],
        ['Estadísticas Generales'],
        ['Total Estudiantes', students.length],
        ['Total Evaluaciones', evaluations.length],
        ['Total Apuntes', notes.length],
        ['Total Módulos', modules.length]
      ];
      const wsSummary = utils.aoa_to_sheet(summaryData);
      utils.book_append_sheet(wb, wsSummary, `${subject.name.substring(0, 20)} - Resumen`);

      // Grades Sheet
      const weights = parseWeights(getStorageItem(STORAGE_KEYS.GRADING_WEIGHTS));
      const savedScale = getStorageItem(STORAGE_KEYS.GRADING_SCALE);
      const gradingScale = safeJSONParse(savedScale, { maxScore: 100, minPassingScore: 71 });
      const useCheckpoint = safeJSONParse(getStorageItem(STORAGE_KEYS.USE_CHECKPOINT), false);

      const gradesHeader = ['Estudiante', ...evaluations.map(e => e.title), 'Promedio Final'];
      const gradesRows = students.map(s => {
        const studentGrades = grades.filter(g => g.studentId === s.id);
        const calculated = calculateStudentGrades(
          s.id, studentGrades, evaluations, modules,
          useCheckpoint, weights, gradingScale, 'categories', 'average'
        );
        const evalScores = evaluations.map(e => {
          const g = grades.find(grade => grade.studentId === s.id && grade.evaluationId === e.id);
          return g ? g.score : 0;
        });
        return [`${s.lastName}, ${s.firstName}`, ...evalScores, calculated.total.toFixed(2)];
      });
      const wsGrades = utils.aoa_to_sheet([gradesHeader, ...gradesRows]);
      utils.book_append_sheet(wb, wsGrades, `${subject.name.substring(0, 20)} - Notas`);
    }

    writeFile(wb, `resumen-detallado-clases-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleClearData = async () => {
    try {
      const collections = ['subjects', 'notes', 'students', 'evaluations', 'grades', 'attendance', 'materials', 'subjectModules', 'calendarEvents', 'classGroups'];
      await Promise.all(collections.map(col => clearCollection(col)));
      window.location.reload();
    } catch (error) {
      console.error("Error clearing data:", error);
      handleFirestoreError(error, OperationType.DELETE, 'clear_data');
    }
  };

  return (
    <>
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-neutral-900/40 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="bg-white border border-neutral-200 rounded-[2.5rem] w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col md:flex-row h-[80vh]"
          >
            {/* Sidebar */}
            <div className="w-full md:w-72 bg-neutral-50 border-r border-neutral-200 p-8 flex flex-col">
              <div className="flex items-center gap-4 mb-10">
                <div className="w-10 h-10 bg-neutral-900 rounded-xl flex items-center justify-center text-white">
                  <Settings className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-black text-neutral-900 tracking-tight">Ajustes</h3>
              </div>

              <div className="space-y-2 flex-1">
                {[
                  { id: 'general', label: 'General', icon: Settings },
                  { id: 'advanced', label: 'Avanzado', icon: Zap },
                  { id: 'billing', label: 'Suscripción', icon: CreditCard }
                ].map(tab => (
                  <button
                    key={tab.id}
                    title={`Sección de ${tab.label}`}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all font-black text-xs uppercase tracking-widest ${
                      activeTab === tab.id 
                        ? "bg-white text-indigo-600 shadow-sm border border-neutral-200" 
                        : "text-neutral-400 hover:text-neutral-600"
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="pt-8 border-t border-neutral-200">
                <div className={`p-5 rounded-3xl border transition-all ${activeSubscription !== 'free' ? 'bg-emerald-50 border-emerald-100' : 'bg-indigo-50 border-indigo-100'}`}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-2 flex items-center gap-2">
                    <Shield className={`w-3 h-3 ${activeSubscription !== 'free' ? 'text-emerald-500' : 'text-indigo-500'}`} />
                    Plan Actual
                  </p>
                  <p className={`text-lg font-black ${activeSubscription !== 'free' ? 'text-emerald-900' : 'text-indigo-900'}`}>
                    {activeSubscription === 'pro' ? 'Premium Pro' : activeSubscription === 'school' ? 'Institucional' : 'Versión Gratis'}
                  </p>
                  <button 
                    onClick={() => setActiveTab('billing')}
                    title="Ir a gestión de suscripción"
                    className={`mt-4 w-full py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
                      activeSubscription !== 'free'
                        ? 'bg-white text-emerald-600 border border-emerald-200 hover:bg-emerald-100' 
                        : 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20 hover:bg-indigo-500'
                    }`}
                  >
                    {activeSubscription !== 'free' ? 'Gestionar Plan' : 'Ver Planes'}
                  </button>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col bg-white overflow-hidden">
              <div className="p-8 border-b border-neutral-100 flex items-center justify-between">
                <h4 className="text-sm font-black text-neutral-400 uppercase tracking-[0.2em]">
                  {activeTab === 'general' && 'Configuración General'}
                  {activeTab === 'advanced' && 'Funciones Avanzadas'}
                  {activeTab === 'billing' && 'Gestión de Suscripción'}
                </h4>
                <button onClick={onClose} title="Cerrar ventana" className="text-neutral-400 hover:text-neutral-900 transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-10 space-y-10 custom-scrollbar">
                {activeTab === 'general' && (
                  <div className="space-y-8">
                    <section className="space-y-4">
                      <h5 className="text-lg font-black text-neutral-900">Notificaciones</h5>
                      <div className="space-y-4">
                        <label className="flex items-center justify-between p-4 bg-neutral-50 rounded-2xl border border-neutral-100 cursor-pointer hover:bg-white hover:border-indigo-100 transition-all">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-neutral-200 shadow-sm">
                              <Bell className="w-5 h-5 text-neutral-400" />
                            </div>
                            <div>
                              <p className="font-bold text-neutral-900">Recordatorios de clase</p>
                              <p className="text-xs text-neutral-500">Recibe avisos antes de tus clases</p>
                            </div>
                          </div>
                          <input type="checkbox" defaultChecked className="w-5 h-5 rounded-lg border-neutral-300 text-indigo-600 focus:ring-indigo-500" />
                        </label>
                      </div>
                    </section>

                    <section className="space-y-4">
                      <h5 className="text-lg font-black text-neutral-900">Datos y Privacidad</h5>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <button 
                          id="export-btn"
                          onClick={handleExportData}
                          title="Exportar respaldo completo en JSON"
                          className="flex items-center gap-4 p-4 bg-neutral-50 rounded-2xl border border-neutral-100 hover:bg-white hover:border-indigo-100 transition-all text-left group"
                        >
                          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-neutral-200 shadow-sm group-hover:scale-110 transition-transform">
                            <Download className="w-5 h-5 text-indigo-500" />
                          </div>
                          <div>
                            <p className="font-bold text-neutral-900">Exportar JSON</p>
                            <p className="text-[10px] text-neutral-500 uppercase tracking-widest">Backup Completo</p>
                          </div>
                        </button>
                        {importData ? (
                          <div className="flex flex-col gap-3 p-4 bg-emerald-50 rounded-2xl border border-emerald-100 md:col-span-2">
                            <p className="text-sm font-bold text-emerald-900 border-b border-emerald-200/50 pb-2">
                              ¿Sobrescribir datos con backup cargado?
                            </p>
                            <div className="flex items-center gap-3 mt-1">
                              <button 
                                onClick={() => setImportData(null)}
                                title="Cancelar importación"
                                className="flex-1 bg-white hover:bg-neutral-50 text-neutral-900 font-bold py-2 rounded-xl text-xs transition-colors border border-neutral-200"
                              >
                                Cancelar
                              </button>
                              <button 
                                onClick={confirmImport}
                                title="Confirmar importación de datos"
                                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded-xl text-xs transition-colors shadow-sm"
                              >
                                Importar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button 
                            onClick={() => fileInputRef.current?.click()}
                            title="Seleccionar archivo JSON para importar"
                            className="flex items-center gap-4 p-4 bg-neutral-50 rounded-2xl border border-neutral-100 hover:bg-white hover:border-indigo-100 transition-all text-left group"
                          >
                            <input 
                              type="file" 
                              ref={fileInputRef} 
                              onChange={handleImportData} 
                              accept=".json" 
                              className="hidden" 
                            />
                            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-neutral-200 shadow-sm group-hover:scale-110 transition-transform">
                              <Download className="w-5 h-5 text-emerald-500 rotate-180" />
                            </div>
                            <div>
                              <p className="font-bold text-neutral-900">Importar JSON</p>
                              <p className="text-[10px] text-neutral-500 uppercase tracking-widest">Restaurar Backup</p>
                            </div>
                          </button>
                        )}

                        {isConfirmingClear ? (
                          <div className="flex flex-col gap-3 p-4 bg-red-50 rounded-2xl border border-red-100">
                            <p className="text-sm font-bold text-red-900 border-b border-red-200/50 pb-2">
                              ¿Eliminar TODOS los datos? Esta acción es irreversible.
                            </p>
                            <p className="text-xs font-medium text-red-800 leading-relaxed">
                              Se eliminarán aulas, materias y contenido académico. Tu cuenta, plan Premium Pro y código piloto no se modifican. Si después aparece Plan Gratis, la licencia piloto de esa cuenta no está activa en este proyecto.
                            </p>
                            <div className="flex items-center gap-3 mt-1">
                              <button 
                                onClick={() => setIsConfirmingClear(false)}
                                title="Cancelar eliminación de datos"
                                className="flex-1 bg-white hover:bg-neutral-50 text-neutral-900 font-bold py-2 rounded-xl text-xs transition-colors border border-neutral-200"
                              >
                                Cancelar
                              </button>
                              <button 
                                onClick={handleClearData}
                                title="Confirmar eliminación de todos los datos"
                                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded-xl text-xs transition-colors shadow-sm"
                              >
                                Sí, borrar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button 
                            onClick={() => setIsConfirmingClear(true)}
                            title="Eliminar todos los datos de la aplicación"
                            className="flex items-center gap-4 p-4 bg-neutral-50 rounded-2xl border border-neutral-100 hover:bg-red-50 hover:border-red-100 transition-all text-left group"
                          >
                            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-neutral-200 shadow-sm group-hover:scale-110 transition-transform">
                              <Trash2 className="w-5 h-5 text-red-500" />
                            </div>
                            <div>
                              <p className="font-bold text-neutral-900">Borrar Todo</p>
                              <p className="text-[10px] text-neutral-500 uppercase tracking-widest">Acción Irreversible</p>
                            </div>
                          </button>
                        )}
                      </div>
                    </section>

                    {isAdminUser && (
                      <section className="space-y-4">
                        <div className="flex items-center gap-3">
                          <h5 className="text-lg font-black text-neutral-900">Respaldo institucional</h5>
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#F0F7F4] border border-[#1A3C40]/20 text-[#1A3C40] text-[9px] font-black uppercase tracking-widest px-2.5 py-1">
                            <Shield className="w-3 h-3" />
                            Administrador
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500 leading-relaxed">
                          Protege la información académica de tu institución mediante una copia completa de seguridad.
                          <br />
                          El archivo de respaldo puede utilizarse para recuperar información en caso de emergencia o migración.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <button
                            onClick={() => setBackupExportOpen(true)}
                            title="Descargar una copia completa de seguridad institucional"
                            className="flex items-center gap-4 p-4 bg-[#F0F7F4] rounded-2xl border border-[#1A3C40]/10 hover:bg-white hover:border-[#1A3C40]/30 transition-all text-left group"
                          >
                            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-[#1A3C40]/10 shadow-sm group-hover:scale-110 transition-transform">
                              <Download className="w-5 h-5 text-[#1A3C40]" />
                            </div>
                            <div>
                              <p className="font-bold text-[#1A3C40]">Exportar respaldo JSON</p>
                              <p className="text-xs text-neutral-500 leading-snug mt-0.5">Descarga una copia completa de la información institucional.</p>
                            </div>
                          </button>
                          <button
                            onClick={() => adminBackupFileRef.current?.click()}
                            title="Restaurar la configuración institucional desde un archivo de respaldo"
                            className="flex items-center gap-4 p-4 bg-neutral-50 rounded-2xl border border-neutral-100 hover:bg-white hover:border-[#1A3C40]/30 transition-all text-left group"
                          >
                            <input
                              type="file"
                              ref={adminBackupFileRef}
                              onChange={handleAdminBackupFileChange}
                              accept=".json,application/json"
                              className="hidden"
                            />
                            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-neutral-200 shadow-sm group-hover:scale-110 transition-transform">
                              <Upload className="w-5 h-5 text-[#2E7D32]" />
                            </div>
                            <div>
                              <p className="font-bold text-neutral-900">Restaurar configuración institucional</p>
                              <p className="text-xs text-neutral-500 leading-snug mt-0.5">Recupera la configuración desde un respaldo generado por EdiAgil.</p>
                            </div>
                          </button>
                        </div>
                        <p className="text-xs text-neutral-500 leading-relaxed">
                          Recupera la configuración institucional guardada en un respaldo de EdiAgil. Esta operación no elimina información existente ni reemplaza automáticamente todos los datos académicos históricos.
                        </p>
                        <details className="group rounded-2xl border border-[#1A3C40]/10 bg-[#F0F7F4]/60 px-4 py-3">
                          <summary className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-lg text-xs font-bold text-[#1A3C40] outline-none focus-visible:ring-2 focus-visible:ring-[#FFC107] [&::-webkit-details-marker]:hidden">
                            ¿Qué se restaurará?
                            <ChevronDown className="w-4 h-4 shrink-0 transition-transform duration-200 group-open:rotate-180" />
                          </summary>
                          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-[#1A3C40]/10 pt-3">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-widest text-[#2E7D32]">Sí se restaurará</p>
                              <ul className="mt-2 space-y-1.5">
                                {[
                                  'Configuración institucional (nombre, logo, colores, eslogan y datos del centro).',
                                  'Parámetros compatibles: ponderación de evaluación, periodos de clase y reglas del plan.',
                                  'Configuraciones administrativas soportadas.',
                                ].map(item => (
                                  <li key={item} className="flex items-start gap-2 text-xs text-neutral-600 leading-snug">
                                    <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#2E7D32]" />
                                    {item}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-widest text-[#D32F2F]">No se restaurará automáticamente</p>
                              <ul className="mt-2 space-y-1.5">
                                {[
                                  'Métricas calculadas.',
                                  'Estadísticas derivadas.',
                                  'Datos analíticos (listas de docentes/alumnos del informe).',
                                  'Cualquier información no soportada por el esquema actual.',
                                ].map(item => (
                                  <li key={item} className="flex items-start gap-2 text-xs text-neutral-600 leading-snug">
                                    <X className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#D32F2F]" />
                                    {item}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </details>
                      </section>
                    )}

                    {isAdminUser && (
                      <section className="space-y-4">
                        <div className="flex items-center gap-3">
                          <h5 className="text-lg font-black text-neutral-900">Ponderaciones académicas</h5>
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#F0F7F4] border border-[#1A3C40]/20 text-[#1A3C40] text-[9px] font-black uppercase tracking-widest px-2.5 py-1">
                            <Shield className="w-3 h-3" />
                            Administrador
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500 leading-relaxed">
                          Define cómo se distribuye el peso de las evaluaciones en la institución. Estas reglas serán utilizadas por los docentes vinculados al centro educativo.
                        </p>
                        {instWeightLoading ? (
                          <div className="flex items-center justify-center gap-3 p-8 bg-neutral-50 rounded-3xl border border-neutral-100">
                            <Loader2 className="w-5 h-5 animate-spin text-[#1A3C40]" />
                            <span className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Cargando ponderación...</span>
                          </div>
                        ) : instWeight ? (
                          <>
                            <div className="p-5 bg-[#F0F7F4]/60 border border-[#1A3C40]/10 rounded-3xl">
                              <GradingWeightEditor value={instWeight} onChange={setInstWeight} />
                            </div>
                            {typeof instWeight.updatedAt === 'number' && (
                              <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                                Última actualización: {format(new Date(instWeight.updatedAt), 'dd/MM/yyyy HH:mm')}
                                {' · '}Modificado por: Administrador
                              </p>
                            )}
                            <div className="flex flex-col sm:flex-row gap-3">
                              <button
                                onClick={resetInstWeight}
                                title="Restablecer la ponderación a los valores tradicionales 30/60/10"
                                className="flex items-center justify-center gap-2 bg-white hover:bg-neutral-50 text-neutral-700 font-bold py-3 px-4 rounded-xl text-xs border border-neutral-200 transition-colors"
                              >
                                <RotateCcw className="w-4 h-4" />
                                Restablecer 30/60/10
                              </button>
                              <button
                                onClick={handleSaveInstWeight}
                                disabled={!instWeightComplete || instWeightSaving}
                                title="Guardar la ponderación institucional"
                                className="flex-1 flex items-center justify-center gap-2 bg-[#1A3C40] hover:bg-[#2E7D32] disabled:opacity-50 text-white font-black uppercase tracking-widest py-3 px-4 rounded-xl text-xs transition-all active:scale-95"
                              >
                                {instWeightSaving ? (
                                  <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Aplicando...
                                  </>
                                ) : (
                                  <>
                                    <SlidersHorizontal className="w-4 h-4" />
                                    Guardar ponderación
                                  </>
                                )}
                              </button>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-neutral-500">No se pudo cargar la ponderación institucional.</p>
                        )}
                      </section>
                    )}
                  </div>
                )}

                {activeTab === 'advanced' && (
                  <div className="space-y-10">
                    <section id="weightings-section" className="space-y-6">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center border border-indigo-100">
                          <BarChart3 className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div>
                          <h5 className="text-lg font-black text-neutral-900">Configuración de Ponderaciones</h5>
                          <p className="text-xs text-neutral-500 font-medium">Define cómo se calcula el promedio final</p>
                        </div>
                      </div>

                      {!canEditWeights ? (
                        <>
                          {/* POLÍTICA INSTITUCIONAL: el docente vinculado a una
                              institución consulta la ponderación; solo el admin
                              la edita (Configuración → General). */}
                          <div className="bg-[#F0F7F4] border border-[#1A3C40]/20 rounded-3xl p-6 space-y-4">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[#1A3C40]/20 text-[#1A3C40] text-[10px] font-black uppercase tracking-widest px-3 py-1.5">
                                <Shield className="w-3.5 h-3.5 text-[#2E7D32]" />
                                Definido por tu institución
                              </span>
                              <span className="text-xs font-black text-[#1A3C40] tabular-nums">
                                {weights.teorica.value + weights.practica.value + weights.apreciativa.value}%
                              </span>
                            </div>
                            <p className="text-xs text-neutral-500 font-medium">
                              Esta configuración es administrada por el centro educativo.
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              {([
                                { id: 'teorica', color: 'bg-blue-500' },
                                { id: 'practica', color: 'bg-emerald-500' },
                                { id: 'apreciativa', color: 'bg-amber-500' },
                              ] as const).map(({ id, color }) => (
                                <div key={id} className="bg-white border border-neutral-100 rounded-2xl px-4 py-3">
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <span className={`w-2 h-2 rounded-full ${color}`} />
                                    <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest truncate">{weights[id].name}</span>
                                  </div>
                                  <p className="text-lg font-black text-neutral-900 tabular-nums">{weights[id].value}%</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      ) : (
                      <div className={`grid grid-cols-1 gap-6 ${useCheckpoint ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
                        {([
                          { id: 'teorica', color: 'blue' },
                          { id: 'practica', color: 'emerald' },
                          { id: 'apreciativa', color: 'amber' },
                          ...(useCheckpoint ? [{ id: 'checkpoint', color: 'indigo' }] : [])
                        ] as const).map(type => (
                          <div key={type.id} className="bg-neutral-50 border border-neutral-100 p-6 rounded-3xl space-y-4">
                            <input
                              type="text"
                              value={weights[type.id as keyof typeof weights].name}
                              onChange={(e) => handleUpdateWeight(type.id as keyof typeof weights, 'name', e.target.value)}
                              className="block w-full bg-transparent text-[10px] font-black text-neutral-400 uppercase tracking-widest outline-none border-b border-transparent focus:border-neutral-200"
                            />
                            <div className="relative">
                              <input
                                type="number"
                                step="0.1"
                                value={weights[type.id as keyof typeof weights].value}
                                onChange={(e) => handleUpdateWeight(type.id as keyof typeof weights, 'value', e.target.value)}
                                className="w-full bg-white border border-neutral-200 rounded-2xl px-4 py-3 font-black text-lg outline-none focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500 transition-all"
                              />
                              <span className="absolute right-4 top-1/2 -translate-y-1/2 font-black text-neutral-300">%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      )}

                      <div className="p-6 bg-neutral-50 border border-neutral-100 rounded-3xl space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center border border-neutral-200">
                              <FileText className="w-4 h-4 text-indigo-600" />
                            </div>
                            <div>
                              <p className="font-bold text-neutral-900">Opción de Agregar 4ta Nota</p>
                              <p className="text-[10px] text-neutral-500 uppercase tracking-widest font-bold">Habilitar evaluación adicional</p>
                            </div>
                          </div>
                          <button 
                            onClick={toggleCheckpoint}
                            title={useCheckpoint ? 'Deshabilitar cuarta nota' : 'Habilitar cuarta nota'}
                            className={`w-12 h-6 rounded-full transition-all relative ${useCheckpoint ? 'bg-indigo-600' : 'bg-neutral-200'}`}
                          >
                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${useCheckpoint ? 'left-7' : 'left-1'}`} />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="p-6 bg-neutral-50 border border-neutral-100 rounded-3xl space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center border border-neutral-200 shadow-sm">
                                <Layers className="w-4 h-4 text-indigo-600" />
                              </div>
                              <div>
                                <p className="font-bold text-neutral-900 text-sm">Método de Evaluación</p>
                                <p className="text-[9px] text-neutral-500 uppercase tracking-widest font-bold font-medium">Por tipo de nota o por módulos</p>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 bg-neutral-200/40 p-1.5 rounded-2xl w-full">
                            <button
                              type="button"
                              onClick={() => setViewMode('categories')}
                              className={`flex-1 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                                viewMode === 'categories'
                                  ? 'bg-white text-indigo-600 shadow-sm border border-neutral-200/50'
                                  : 'text-neutral-500 hover:text-neutral-700'
                              }`}
                            >
                              Por Tipo
                            </button>
                            <button
                              type="button"
                              onClick={() => setViewMode('modules')}
                              className={`flex-1 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                                viewMode === 'modules'
                                  ? 'bg-white text-indigo-600 shadow-sm border border-neutral-200/50'
                                  : 'text-neutral-500 hover:text-neutral-700'
                              }`}
                            >
                              Por Módulos
                            </button>
                          </div>
                        </div>

                        <div className={`p-6 bg-neutral-50 border border-neutral-100 rounded-3xl space-y-4 transition-all duration-300 ${viewMode === 'modules' ? 'opacity-100 scale-100' : 'opacity-40 pointer-events-none'}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center border border-neutral-200 shadow-sm">
                                <BarChart3 className="w-4 h-4 text-indigo-600" />
                              </div>
                              <div>
                                <p className="font-bold text-neutral-900 text-sm">Cálculo Modular</p>
                                <p className="text-[9px] text-neutral-500 uppercase tracking-widest font-bold font-medium">Cómo combinar las notas de módulos</p>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 bg-neutral-200/40 p-1.5 rounded-2xl w-full">
                            <button
                              type="button"
                              disabled={viewMode !== 'modules'}
                              onClick={() => setCalculationMode('average')}
                              className={`flex-1 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                                calculationMode === 'average' && viewMode === 'modules'
                                  ? 'bg-white text-indigo-600 shadow-sm border border-neutral-200/50'
                                  : 'text-neutral-500 hover:text-neutral-700'
                              }`}
                            >
                              Promediar
                            </button>
                            <button
                              type="button"
                              disabled={viewMode !== 'modules'}
                              onClick={() => setCalculationMode('sum')}
                              className={`flex-1 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                                calculationMode === 'sum' && viewMode === 'modules'
                                  ? 'bg-white text-indigo-600 shadow-sm border border-neutral-200/50'
                                  : 'text-neutral-500 hover:text-neutral-700'
                              }`}
                            >
                              Sumar
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div className="p-6 bg-neutral-50 border border-neutral-100 rounded-3xl space-y-4">
                          <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest">Puntuación Máxima</label>
                          <input 
                            type="number" 
                            value={gradingScale.maxScore} 
                            onChange={(e) => handleUpdateScale('maxScore', e.target.value)}
                            className="w-full bg-white border border-neutral-200 rounded-2xl px-4 py-3 font-black text-lg outline-none focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500 transition-all"
                          />
                        </div>
                        <div className="p-6 bg-neutral-50 border border-neutral-100 rounded-3xl space-y-4">
                          <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest">Nota Mínima para Aprobar</label>
                          <input 
                            type="number" 
                            value={gradingScale.minPassingScore} 
                            onChange={(e) => handleUpdateScale('minPassingScore', e.target.value)}
                            className="w-full bg-white border border-neutral-200 rounded-2xl px-4 py-3 font-black text-lg outline-none focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500 transition-all"
                          />
                        </div>
                      </div>

                      <div className={`rounded-3xl flex items-start gap-4 p-6 border ${weightsSource === 'institutional' ? 'bg-[#F0F7F4] border-[#1A3C40]/20' : 'bg-amber-50 border-amber-100'}`}>
                        <Info className={`w-5 h-5 shrink-0 mt-0.5 ${weightsSource === 'institutional' ? 'text-[#1A3C40]' : 'text-amber-500'}`} />
                        <p className={`text-xs font-medium leading-relaxed ${weightsSource === 'institutional' ? 'text-[#1A3C40]/80' : 'text-amber-900/70'}`}>
                          {weightsSource === 'institutional'
                            ? 'Las ponderaciones de tu institución se aplican al cálculo del promedio final de todos los docentes vinculados. Esta configuración es administrada por el centro educativo.'
                            : 'Las ponderaciones se suman directamente para el cálculo del promedio final (ej. 30% + 60% + 10% = 100%).'}
                        </p>
                      </div>
                    </section>

                    <div className="space-y-4 pt-10 border-t border-neutral-100">
                      <h5 className="text-lg font-black text-neutral-900">Configuración de Base de Datos</h5>
                      <div className="p-6 bg-neutral-50 rounded-3xl border border-neutral-100 space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Database className="w-5 h-5 text-neutral-400" />
                            <span className="font-bold text-neutral-700">Estado de Cloud Firestore</span>
                          </div>
                          <span className="px-3 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-black rounded-full border border-emerald-100 uppercase tracking-widest">Conectado</span>
                        </div>
                        <p className="text-xs text-neutral-500 leading-relaxed font-medium">
                          Tus datos se almacenan de forma segura en la nube (Firebase Firestore). Esto permite una sincronización en tiempo real entre múltiples dispositivos. Funciona de manera offline y guarda datos localmente si pierdes internet.
                        </p>
                        {isConfirmingClearCalendar ? (
                          <div className="mt-2 p-4 bg-red-50 rounded-2xl border border-red-100 flex flex-col gap-3">
                            <p className="text-sm font-bold text-red-900 border-b border-red-200/50 pb-2">
                              ¿Eliminar TODOS los eventos generados por IA? (No borra evaluaciones)
                            </p>
                            <div className="flex items-center gap-3">
                              <button 
                                onClick={() => setIsConfirmingClearCalendar(false)}
                                title="Cancelar limpieza de eventos"
                                className="flex-1 bg-white hover:bg-neutral-50 text-neutral-900 font-bold py-2 rounded-xl text-xs transition-colors border border-neutral-200"
                              >
                                Cancelar
                              </button>
                              <button 
                                onClick={async () => {
                                  try {
                                    await clearCollection('calendarEvents');
                                    setIsConfirmingClearCalendar(false);
                                  } catch (error) {
                                    console.error(error);
                                  }
                                }}
                                title="Confirmar eliminación de eventos"
                                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded-xl text-xs transition-colors shadow-sm"
                              >
                                Sí, borrar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setIsConfirmingClearCalendar(true)}
                            title="Eliminar todos los eventos generados por IA"
                            className="mt-2 w-full bg-red-50 hover:bg-red-100 text-red-600 font-bold py-3 px-4 rounded-xl text-sm transition-colors text-left flex items-center gap-2"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                            Limpiar Eventos de Calendario (IA)
                          </button>
                        )}
                        
                        {isConfirmingClearEvaluations ? (
                          <div className="mt-2 p-4 bg-orange-50 rounded-2xl border border-orange-100 flex flex-col gap-3">
                            <p className="text-sm font-bold text-orange-900 border-b border-orange-200/50 pb-2">
                              ¿Eliminar TODAS las Evaluaciones del sistema? Esta acción es irreversible.
                            </p>
                            <div className="flex items-center gap-3">
                              <button 
                                onClick={() => setIsConfirmingClearEvaluations(false)}
                                title="Cancelar limpieza de evaluaciones"
                                className="flex-1 bg-white hover:bg-neutral-50 text-neutral-900 font-bold py-2 rounded-xl text-xs transition-colors border border-neutral-200"
                              >
                                Cancelar
                              </button>
                              <button 
                                onClick={async () => {
                                  try {
                                    await clearCollection('evaluations');
                                    setIsConfirmingClearEvaluations(false);
                                  } catch (error) {
                                    console.error(error);
                                  }
                                }}
                                title="Confirmar eliminación de evaluaciones"
                                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold py-2 rounded-xl text-xs transition-colors shadow-sm"
                              >
                                Sí, borrar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setIsConfirmingClearEvaluations(true)}
                            title="Eliminar todas las evaluaciones del sistema"
                            className="mt-2 w-full bg-orange-50 hover:bg-orange-100 text-orange-600 font-bold py-3 px-4 rounded-xl text-sm transition-colors text-left flex items-center gap-2"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                            Limpiar Todas las Evaluaciones
                          </button>
                        )}
                        
                        <div className="mt-8 border-t border-neutral-200 pt-8">
                          <h4 className="text-sm font-black text-neutral-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Zap className="w-4 h-4 text-indigo-500" />
                            Diagnóstico de Base de Datos
                          </h4>
                          <p className="text-xs text-neutral-500 mb-4 leading-relaxed">
                            Si notas que desaparecen datos o algunas pantallas fallan (especialmente al usar filtros compuestos), puede que Firebase necesite crear Índices Compuestos. Ejecuta esta herramienta y abre la consola de tu navegador para hacer clic en los enlaces de generación.
                          </p>
                          <button
                            onClick={triggerAllQueries}
                            title="Generar enlaces para crear índices compuestos en Firebase"
                            className="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold py-3 px-4 rounded-xl text-sm transition-colors text-left flex items-center gap-2"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
                            Generar Enlaces de Índices
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'billing' && (
                  <div className="space-y-8">
                    {import.meta.env.DEV && (
                    <div className="p-6 bg-neutral-50 rounded-3xl border border-neutral-100 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all ${sandboxMode ? 'bg-amber-50 border-amber-100 text-amber-600' : 'bg-neutral-100 border-neutral-200 text-neutral-400'}`}>
                          <Zap className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-bold text-neutral-900">Modo de Prueba (Sandbox)</p>
                          <p className="text-xs text-neutral-500 font-medium">Permite alternar planes localmente con un clic para desarrollo</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleToggleSandbox(!sandboxMode)}
                        title={sandboxMode ? 'Desactivar modo de prueba' : 'Activar modo de prueba'}
                        className={`w-12 h-6 rounded-full transition-all relative ${sandboxMode ? 'bg-amber-500' : 'bg-neutral-200'}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${sandboxMode ? 'left-7' : 'left-1'}`} />
                      </button>
                    </div>
                    )}

                     {/* Banner de Suscripción Real en Prod */}
                     {licenseStatus?.type === 'error' && (
                       <div className="p-4 mt-2 bg-red-50 border border-red-100 rounded">
                         <p className="text-sm text-red-800">{licenseStatus.message}</p>
                         <button
                            onClick={() => window.location.reload()}
                            title="Recargar la página para aplicar cambios"
                            className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-xs"
                          >
                            Recargar
                          </button>
                       </div>
                     )}
                    {!sandboxMode && dbPlan !== 'free' && profile && (
                      <div className="p-6 bg-emerald-50 rounded-3xl border border-emerald-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-800 mb-1">Suscripción Activa y Sincronizada</p>
                          <h6 className="text-lg font-black text-emerald-950">
                            {profile.plan === 'pro' ? 'Premium Pro' : 'Plan Institucional'}
                          </h6>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-emerald-700/80 font-medium">
                            {profile.paymentProvider && (
                              <span>Proveedor: <strong className="uppercase">{profile.paymentProvider.replace('_', ' ')}</strong></span>
                            )}
                            {profile.subscriptionId && (
                              <span>ID: <strong>{profile.subscriptionId.substring(0, 16)}...</strong></span>
                            )}
                          </div>
                        </div>
                        {profile.expiresAt ? (
                          <div className="bg-emerald-600 text-white px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest shadow-md shrink-0 text-center">
                            Expiración: {new Date(profile.expiresAt as number).toLocaleDateString()}
                          </div>
                        ) : (
                          <div className="bg-emerald-600 text-white px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest shadow-md shrink-0 text-center">
                            Suscripción Activa
                          </div>
                        )}
                      </div>
                    )}

                    {!sandboxMode && dbPlan !== 'free' && (
                      <div className="p-6 bg-white rounded-3xl border border-neutral-200 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center border border-indigo-100">
                            <CreditCard className="w-5 h-5 text-indigo-600" />
                          </div>
                          <div>
                            <p className="font-bold text-neutral-900">Gestionar Suscripción</p>
                            <p className="text-xs text-neutral-500 font-medium">Administra tu plan, facturación o cancela cuando quieras</p>
                          </div>
                        </div>
                        <button
                          onClick={handleManageSubscription}
                          disabled={portalLoading}
                          title="Abrir portal de gestión de suscripción"
                          className="flex items-center gap-2 px-6 py-3 bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-400 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg"
                        >
                          {portalLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            'Gestionar'
                          )}
                        </button>
                      </div>
                    )}

                    {profile && (
                      <div className="p-6 bg-white rounded-3xl border border-neutral-200 space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h6 className="font-black text-neutral-900 flex items-center gap-2">
                              <Sparkles className="w-5 h-5 text-indigo-600" />
                              Uso de Inteligencia Artificial (Gemini)
                            </h6>
                            <p className="text-xs text-neutral-500 font-medium mt-0.5">
                              Consumo de consultas inteligentes de este mes
                            </p>
                          </div>
                          <span className="text-sm font-black text-neutral-900 bg-neutral-100 px-3 py-1 rounded-full">
                            {profile.aiCallsThisMonth || 0} / {limits?.aiCallsPerMonth || 15}
                          </span>
                        </div>

                        <div className="w-full bg-neutral-100 rounded-full h-3.5 overflow-hidden border border-neutral-200/50">
                          <div 
                            className={`h-full transition-all duration-500 ${
                              ((profile.aiCallsThisMonth || 0) / (limits?.aiCallsPerMonth || 15)) >= 0.8 
                                ? 'bg-red-500 shadow-md shadow-red-500/20' 
                                : ((profile.aiCallsThisMonth || 0) / (limits?.aiCallsPerMonth || 15)) >= 0.5 
                                  ? 'bg-amber-500 shadow-md shadow-amber-500/20' 
                                  : 'bg-indigo-600 shadow-md shadow-indigo-500/20'
                            }`}
                            style={{ width: `${Math.min(100, ((profile.aiCallsThisMonth || 0) / (limits?.aiCallsPerMonth || 15)) * 100)}%` }}
                          />
                        </div>

                        {((profile.aiCallsThisMonth || 0) / (limits?.aiCallsPerMonth || 15)) >= 0.8 && (
                          <p className="text-[11px] text-red-600 font-bold flex items-center gap-1.5 animate-pulse">
                            <AlertCircle className="w-3.5 h-3.5" />
                            ¡Te estás acercando al límite de consultas mensuales! Considera actualizar tu plan.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Planes Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                      {/* Plan Gratis */}
                      <div
                        className={`p-8 rounded-[2.5rem] border-2 transition-all flex flex-col justify-between ${
                          activeSubscription === 'free'
                            ? 'border-indigo-600 bg-indigo-50/20'
                            : 'border-neutral-100 bg-white hover:border-indigo-200 hover:bg-neutral-50/50'
                        }`}
                        onClick={() => sandboxMode && handleSelectPlan('free')}
                      >
                        <div>
                          <h6 className="text-xl font-black text-neutral-900 mb-1">Gratis</h6>
                          <p className="text-4xl font-black text-neutral-900 mb-1">$0<span className="text-sm text-neutral-400">/mes</span></p>
                          <p className="text-[11px] text-neutral-400 font-semibold mb-6">Para siempre, sin tarjeta</p>
                          <ul className="space-y-2.5 mb-8">
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className="w-3.5 h-3.5 text-indigo-500 shrink-0" />Estudiantes ilimitados</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className="w-3.5 h-3.5 text-indigo-500 shrink-0" />Hasta 2 cursos</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className="w-3.5 h-3.5 text-indigo-500 shrink-0" />Calificaciones básicas</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className="w-3.5 h-3.5 text-indigo-500 shrink-0" />Registro de asistencia</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-400"><X className="w-3.5 h-3.5 text-neutral-300 shrink-0" />Informes IA</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-400"><X className="w-3.5 h-3.5 text-neutral-300 shrink-0" />Exportar PDF/Excel</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-400"><X className="w-3.5 h-3.5 text-neutral-300 shrink-0" />Syllabus AI</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className="w-3.5 h-3.5 text-indigo-500 shrink-0" />Respaldo Básico</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className="w-3.5 h-3.5 text-indigo-500 shrink-0" />15 consultas IA/mes</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className="w-3.5 h-3.5 text-indigo-500 shrink-0" />Copias de seguridad</li>
                          </ul>
                        </div>
                        {activeSubscription === 'free' ? (
                          <div className="space-y-2">
                            <div className="text-center py-3.5 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-indigo-500/20">Plan Actual</div>
                            {!isTrial && !profile?.trialUsed && (
                              <p className="text-[9px] text-neutral-400 font-medium text-center">14 días de Pro gratis disponibles</p>
                            )}
                          </div>
                        ) : sandboxMode ? (
                          <button className="w-full py-3.5 bg-neutral-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-neutral-800 transition-all" title="Cambiar al plan Gratis (modo prueba)">Seleccionar</button>
                        ) : (
                          <div className="text-center py-3 border border-neutral-200 text-neutral-400 rounded-2xl text-[10px] font-black uppercase tracking-widest leading-tight">
                            Comenzar Gratis<br />
                            <span className="text-[9px] font-bold text-neutral-300 normal-case tracking-normal">Sin tarjeta de crédito requerida</span>
                          </div>
                        )}
                      </div>

                      {/* Plan Premium Pro */}
                      <div
                        className={`p-8 rounded-[2.5rem] border-2 transition-all relative overflow-hidden flex flex-col justify-between ${
                          activeSubscription === 'pro'
                            ? 'border-emerald-600 bg-emerald-50/20'
                            : 'border-neutral-100 bg-white hover:border-emerald-200 hover:bg-neutral-50/50'
                        }`}
                        onClick={() => sandboxMode && handleSelectPlan('pro')}
                      >
                        <div className="absolute top-4 right-4 bg-amber-400 text-white px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest shadow-lg">MÁS POPULAR</div>
                        <div>
                          <h6 className="text-xl font-black text-neutral-900 mb-1">Premium Pro</h6>
                          <p className="text-4xl font-black text-neutral-900 mb-1">$11.99<span className="text-sm text-neutral-400">/año</span></p>
                          <p className="text-[11px] text-emerald-600 font-black mb-1">Equivale a menos de US$1/mes · facturado anualmente</p>
                          <p className="text-[10px] text-neutral-400 font-medium mb-6">Facturación anual · Cancelas cuando quieras</p>
                          <ul className="space-y-2.5 mb-8">
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'pro' ? 'text-emerald-500' : 'text-neutral-300'} shrink-0`} />Hasta 999 estudiantes</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'pro' ? 'text-emerald-500' : 'text-neutral-300'} shrink-0`} />Hasta 999 cursos</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'pro' ? 'text-emerald-500' : 'text-neutral-300'} shrink-0`} />Calificaciones avanzadas con pesos</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'pro' ? 'text-emerald-500' : 'text-neutral-300'} shrink-0`} />Asistencia con alertas inteligentes</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'pro' ? 'text-emerald-500' : 'text-neutral-300'} shrink-0`} />2.000 consultas IA/mes</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'pro' ? 'text-emerald-500' : 'text-neutral-300'} shrink-0`} />Exportar PDF/Excel</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'pro' ? 'text-emerald-500' : 'text-neutral-300'} shrink-0`} />Syllabus AI</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'pro' ? 'text-emerald-500' : 'text-neutral-300'} shrink-0`} />Sincronización Multi-dispositivo</li>
                          </ul>
                        </div>
                        {activeSubscription === 'pro' ? (
                          isTrial ? (
                            <div className="text-center py-3.5 bg-amber-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-amber-500/20">
                              {trialDaysLeft > 0 ? `Plan de prueba — quedan ${trialDaysLeft} días` : 'Plan de prueba'}
                            </div>
                          ) : (
                            <div className="text-center py-3.5 bg-emerald-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20">Plan Actual</div>
                          )
                        ) : sandboxMode ? (
                          <button className="w-full py-3.5 bg-neutral-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-neutral-800 transition-all">Seleccionar</button>
                        ) : (
                          <div className="space-y-2 mt-auto w-full">
                            {/* WR-02: el botón de prueba solo si aún no la usó */}
                            {activeSubscription === 'free' && !profileAny?.trialUsed && (
                              <button
                                onClick={handleActivateTrial}
                                disabled={trialLoading}
                                title="Activar prueba gratuita de Premium Pro durante 14 días"
                                className="w-full flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-amber-300 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30 active:scale-95 transition-all"
                              >
                                {trialLoading ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Zap className="w-4 h-4" />
                                )}
                                {trialLoading ? 'Activando...' : 'Probar Premium 14 días gratis'}
                              </button>
                            )}
                            <button
                              onClick={() => handleCheckout('pro')}
                              disabled={checkoutLoading === 'pro'}
                              title="Adquirir plan Premium Pro"
                              className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-400 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/30 active:scale-95 transition-all"
                            >
                              {checkoutLoading === 'pro' ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <CreditCard className="w-4 h-4" />
                              )}
                              {checkoutLoading === 'pro' ? 'Redirigiendo...' : 'Obtener Premium Pro'}
                            </button>
                            <a
                              href="https://github.com/sponsors/jvalenciap9"
                              target="_blank"
                              rel="noreferrer"
                              className="w-full flex items-center justify-center gap-2 py-3 bg-pink-600 hover:bg-pink-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-pink-500/10 hover:shadow-pink-500/30 active:scale-95 transition-all"
                            >
                              <Heart className="w-4 h-4 fill-white" />
                              GitHub Sponsors
                            </a>
                            <p className="text-[9px] text-neutral-400 font-medium text-center">Pago seguro procesado por Lemon Squeezy</p>
                          </div>
                        )}
                      </div>

                      {/* Plan Institucional */}
                      <div
                        className={`p-8 rounded-[2.5rem] border-2 transition-all relative overflow-hidden flex flex-col justify-between ${
                          activeSubscription === 'school'
                            ? 'border-blue-600 bg-blue-50/20'
                            : 'border-neutral-100 bg-white hover:border-blue-200 hover:bg-neutral-50/50'
                        }`}
                        onClick={() => sandboxMode && handleSelectPlan('school')}
                      >
                        <div className="absolute top-4 right-4 bg-blue-600 text-white px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest shadow-lg">🏫 Colegios</div>
                        <div>
                          <h6 className="text-xl font-black text-neutral-900 mb-1">Institucional</h6>
                          <p className="text-4xl font-black text-neutral-900 mb-1">$199.99<span className="text-sm text-neutral-400">/año</span></p>
                          <div className="p-2 bg-amber-50 border border-amber-200 rounded-xl space-y-1 mb-4">
                            <p className="text-[9px] font-black uppercase tracking-widest text-amber-800">Promoción Fundadores activa</p>
                            <p className="text-lg font-black text-amber-900">$99.99 <span className="text-sm font-bold text-amber-700">primer año</span></p>
                            <p className="text-[10px] font-bold text-neutral-600">Renovación: $199.99/año</p>
                          </div>
                          <ul className="space-y-2.5 mb-8">
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'school' ? 'text-blue-500' : 'text-neutral-300'} shrink-0`} />Hasta 999 estudiantes</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'school' ? 'text-blue-500' : 'text-neutral-300'} shrink-0`} />Hasta 999 cursos</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'school' ? 'text-blue-500' : 'text-neutral-300'} shrink-0`} />9.999 consultas IA/mes</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'school' ? 'text-blue-500' : 'text-neutral-300'} shrink-0`} />Panel administrativo</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'school' ? 'text-blue-500' : 'text-neutral-300'} shrink-0`} />Sincronización Multi-dispositivo</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'school' ? 'text-blue-500' : 'text-neutral-300'} shrink-0`} />Copias de seguridad</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'school' ? 'text-blue-500' : 'text-neutral-300'} shrink-0`} />Todo lo de Premium Pro incluido</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'school' ? 'text-blue-500' : 'text-neutral-300'} shrink-0`} />Onboarding personalizado</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'school' ? 'text-blue-500' : 'text-neutral-300'} shrink-0`} />Reportes institucionales</li>
                            <li className="flex items-center gap-2 text-xs font-bold text-neutral-500"><CheckCircle className={`w-3.5 h-3.5 ${activeSubscription === 'school' ? 'text-blue-500' : 'text-neutral-300'} shrink-0`} />Facturación centralizada</li>
                          </ul>
                        </div>
                        {activeSubscription === 'school' ? (
                          <div className="text-center py-3.5 bg-blue-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-500/20">Plan Actual</div>
                        ) : sandboxMode ? (
                          <button className="w-full py-3.5 bg-neutral-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-neutral-800 transition-all" title="Cambiar al plan Institucional (modo prueba)">Seleccionar</button>
                        ) : (
                          <div className="space-y-2 mt-auto w-full">
                            <input
                              type="text"
                              value={institutionName}
                              onChange={(e) => setInstitutionName(e.target.value)}
                              placeholder="Nombre de tu institución"
                              maxLength={200}
                              disabled={checkoutLoading === 'school'}
                              className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-4 py-2.5 text-xs text-neutral-900 outline-none focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 transition-all placeholder:text-neutral-400"
                            />
                            <button
                              onClick={() => handleCheckout('school')}
                              disabled={checkoutLoading === 'school'}
                              title="Comprar el plan Institucional"
                              className="w-full flex items-center justify-center gap-2 py-3.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-400 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-500/10 hover:shadow-blue-500/30 active:scale-95 transition-all"
                            >
                              {checkoutLoading === 'school' ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Layers className="w-4 h-4" />
                              )}
                              {checkoutLoading === 'school' ? 'Redirigiendo...' : 'Comprar Institucional'}
                            </button>
                            <p className="text-[9px] text-neutral-400 font-medium text-center">Pago seguro procesado por Lemon Squeezy</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Canje de Licencias */}
                    <div className="p-8 rounded-[2.5rem] border border-neutral-200 bg-white shadow-sm space-y-6">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center border border-indigo-100 shadow-sm shrink-0">
                          <Key className="w-6 h-6" />
                        </div>
                        <div>
                          <h6 className="text-lg font-black text-neutral-900">¿Tienes un código de licencia premium?</h6>
                          <p className="text-xs text-neutral-500 font-medium">Ingresa el código que te entregó el administrador para activar tu plan Pro o Institucional.</p>
                        </div>
                      </div>

                      <form onSubmit={handleRedeemKey} className="flex flex-col sm:flex-row gap-4 mt-2">
                        <div className="flex-1 relative">
                          <input 
                            type="text" 
                            value={licenseKey}
                            onChange={(e) => setLicenseKey(e.target.value)}
                            placeholder="EJ. PRO-XXXX-XXXX-XXXX"
                            disabled={licenseLoading}
                            className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-3.5 text-neutral-900 outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-mono font-bold tracking-widest"
                          />
                        </div>
                        <button 
                          type="submit"
                          disabled={licenseLoading || !licenseKey.trim()}
                          title="Canjear código de licencia premium"
                          className="px-8 py-3.5 bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-200 text-white disabled:text-neutral-400 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg"
                        >
                          {licenseLoading ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Validando...
                            </>
                          ) : (
                            'Canjear Código'
                          )}
                        </button>
                      </form>

                      {/* Notificaciones de Estado */}
                      <AnimatePresence>
                        {licenseStatus.type === 'success' && (
                          <motion.div 
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-start gap-3"
                          >
                            <Check className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-emerald-950 font-bold leading-relaxed">{licenseStatus.message}</p>
                          </motion.div>
                        )}
                        {licenseStatus.type === 'error' && (
                          <motion.div 
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3"
                          >
                            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-red-950 font-bold leading-relaxed">{licenseStatus.message}</p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                )}
              <div className="flex items-center justify-center gap-4 pt-4 pb-2 border-t border-neutral-100">
                <a href="/terminos.html" target="_blank" rel="noopener noreferrer" className="text-[11px] text-neutral-400 hover:text-indigo-600 font-medium transition-colors">Términos de Servicio</a>
                <span className="text-neutral-300 text-[11px]">·</span>
                <a href="/privacidad.html" target="_blank" rel="noopener noreferrer" className="text-[11px] text-neutral-400 hover:text-indigo-600 font-medium transition-colors">Política de Privacidad</a>
              </div>
            </div>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {isAdminUser && backupExportOpen && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-neutral-900/50 p-4"
          onClick={() => { if (!exportingBackup) setBackupExportOpen(false); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Descargar respaldo institucional"
            className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl border border-neutral-200 p-8 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="w-12 h-12 bg-[#F0F7F4] rounded-2xl flex items-center justify-center border border-[#1A3C40]/10">
                <Shield className="w-6 h-6 text-[#1A3C40]" />
              </div>
              <button
                onClick={() => { if (!exportingBackup) setBackupExportOpen(false); }}
                title="Cerrar ventana"
                disabled={exportingBackup}
                className="text-neutral-400 hover:text-neutral-900 transition-colors disabled:opacity-40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <h6 className="text-xl font-black text-neutral-900 tracking-tight">Descargar respaldo institucional</h6>
            <p className="text-sm text-neutral-500 leading-relaxed">
              Este archivo contiene información académica y datos de estudiantes y docentes. Guárdalo en un lugar seguro.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              <button
                onClick={() => setBackupExportOpen(false)}
                title="Cancelar descarga del respaldo"
                disabled={exportingBackup}
                className="flex-1 bg-white hover:bg-neutral-50 text-neutral-900 font-bold py-3 px-4 rounded-xl text-xs border border-neutral-200 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleAdminBackupExport}
                title="Generar y descargar el respaldo institucional completo"
                disabled={exportingBackup}
                className="flex-1 bg-[#1A3C40] hover:bg-[#2E7D32] disabled:opacity-60 text-white font-black uppercase tracking-widest py-3 px-4 rounded-xl text-xs transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                {exportingBackup ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Preparando...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Descargar respaldo
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdminUser && weightConfirmOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-neutral-900/50 p-4"
          onClick={() => { if (!instWeightSaving) setWeightConfirmOpen(false); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Cambiar ponderaciones académicas"
            className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl border border-amber-200 p-8 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center border border-amber-100">
                <AlertCircle className="w-6 h-6 text-amber-500" />
              </div>
              <button
                onClick={() => { if (!instWeightSaving) setWeightConfirmOpen(false); }}
                title="Cerrar ventana"
                className="text-neutral-400 hover:text-neutral-900 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <h6 className="text-xl font-black text-neutral-900 tracking-tight">Cambiar ponderaciones académicas</h6>
            <p className="text-sm text-neutral-500 leading-relaxed">
              Este cambio puede modificar los promedios calculados de los estudiantes y afectar boletines, métricas y alertas académicas.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              <button
                onClick={() => setWeightConfirmOpen(false)}
                title="Cancelar el cambio de ponderación"
                className="flex-1 bg-white hover:bg-neutral-50 text-neutral-900 font-bold py-3 px-4 rounded-xl text-xs border border-neutral-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmSaveInstWeight}
                title="Aplicar la nueva ponderación institucional"
                className="flex-1 bg-[#1A3C40] hover:bg-[#2E7D32] text-white font-black uppercase tracking-widest py-3 px-4 rounded-xl text-xs transition-all active:scale-95"
              >
                Aplicar cambios
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdminUser && importedBackup && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-neutral-900/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={restoreStage === 'preview' ? 'Respaldo encontrado' : 'Confirmar restauración de la configuración institucional'}
            className={`w-full max-w-lg bg-white rounded-[2rem] shadow-2xl border p-8 space-y-5 ${restoreStage === 'confirm' ? 'border-red-200' : 'border-neutral-200'}`}
          >
            {restoreStage === 'preview' ? (
              <>
                <div className="flex items-start justify-between">
                  <div className="w-12 h-12 bg-[#F0F7F4] rounded-2xl flex items-center justify-center border border-[#1A3C40]/10">
                    <Database className="w-6 h-6 text-[#1A3C40]" />
                  </div>
                  <button
                    onClick={() => setImportedBackup(null)}
                    title="Cerrar ventana"
                    className="text-neutral-400 hover:text-neutral-900 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <h6 className="text-xl font-black text-neutral-900 tracking-tight">Respaldo encontrado</h6>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                    <p className="text-[9px] font-black uppercase tracking-widest text-neutral-400">Institución</p>
                    <p className="text-sm font-bold text-neutral-900 mt-0.5 break-words">{importedBackup.summary.institutionName || '—'}</p>
                  </div>
                  <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                    <p className="text-[9px] font-black uppercase tracking-widest text-neutral-400">Fecha de exportación</p>
                    <p className="text-sm font-bold text-neutral-900 mt-0.5">
                      {(() => {
                        const d = importedBackup.summary.exportedAt ? new Date(importedBackup.summary.exportedAt) : null;
                        return d && !Number.isNaN(d.getTime()) ? format(d, 'dd/MM/yyyy HH:mm') : '—';
                      })()}
                    </p>
                  </div>
                  <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                    <p className="text-[9px] font-black uppercase tracking-widest text-neutral-400">Docentes</p>
                    <p className="text-sm font-bold text-neutral-900 mt-0.5">{importedBackup.summary.counts.teachers ?? '—'}</p>
                  </div>
                  <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                    <p className="text-[9px] font-black uppercase tracking-widest text-neutral-400">Asignaturas</p>
                    <p className="text-sm font-bold text-neutral-900 mt-0.5">{importedBackup.summary.counts.subjects ?? '—'}</p>
                  </div>
                  <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                    <p className="text-[9px] font-black uppercase tracking-widest text-neutral-400">Evaluaciones</p>
                    <p className="text-sm font-bold text-neutral-900 mt-0.5">{importedBackup.summary.counts.evaluations ?? '—'}</p>
                  </div>
                  <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                    <p className="text-[9px] font-black uppercase tracking-widest text-neutral-400">Registros de asistencia</p>
                    <p className="text-sm font-bold text-neutral-900 mt-0.5">{importedBackup.summary.counts.attendance ?? '—'}</p>
                  </div>
                </div>
                <p className="-mt-1 text-[10px] text-neutral-400 leading-snug">
                  Los conteos describen el contenido del informe analítico del respaldo; la restauración aplica únicamente la configuración institucional.
                </p>
                <div className="flex items-start gap-3 p-4 bg-[#F0F7F4] border border-[#1A3C40]/20 rounded-2xl">
                  <Info className="w-5 h-5 text-[#1A3C40] shrink-0 mt-0.5" />
                  <p className="text-xs text-neutral-700 font-medium leading-relaxed">
                    Se actualizará la configuración institucional con los valores del respaldo. Los datos académicos existentes no se eliminan ni se modifican.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 pt-1">
                  <button
                    onClick={() => setImportedBackup(null)}
                    title="Cancelar la restauración"
                    className="flex-1 bg-white hover:bg-neutral-50 text-neutral-900 font-bold py-3 px-4 rounded-xl text-xs border border-neutral-200 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => setRestoreStage('confirm')}
                    title="Continuar hacia la confirmación final"
                    className="flex-1 bg-[#1A3C40] hover:bg-[#2E7D32] text-white font-black uppercase tracking-widest py-3 px-4 rounded-xl text-xs transition-all active:scale-95"
                  >
                    Continuar con restauración
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center border border-red-100">
                  <AlertCircle className="w-6 h-6 text-[#D32F2F]" />
                </div>
                <h6 className="text-xl font-black text-neutral-900 tracking-tight">Confirmar restauración de configuración</h6>
                <p className="text-sm text-neutral-500 leading-relaxed">
                  Esta operación actualizará la configuración institucional. No puede deshacerse automáticamente.
                  Antes de restaurar se descargará un respaldo automático del estado actual.
                </p>
                <div className="space-y-2">
                  <label htmlFor="restore-confirm-input" className="block text-[10px] font-black uppercase tracking-widest text-neutral-400">
                    Escribe RESTAURAR para confirmar
                  </label>
                  <input
                    id="restore-confirm-input"
                    type="text"
                    value={restoreConfirmText}
                    onChange={(e) => setRestoreConfirmText(e.target.value)}
                    placeholder="RESTAURAR"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full bg-white border border-neutral-200 focus:border-[#D32F2F] rounded-2xl px-4 py-3 font-black tracking-widest outline-none focus:ring-4 focus:ring-red-500/10 transition-all"
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-3 pt-1">
                  <button
                    onClick={() => setRestoreStage('preview')}
                    title="Volver al resumen del respaldo"
                    disabled={restoring}
                    className="flex-1 bg-white hover:bg-neutral-50 text-neutral-900 font-bold py-3 px-4 rounded-xl text-xs border border-neutral-200 transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleAdminBackupRestore}
                    title="Descargar respaldo previo y restaurar la configuración institucional"
                    disabled={restoring || restoreConfirmText !== 'RESTAURAR'}
                    className="flex-1 bg-[#D32F2F] hover:bg-red-700 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white font-black uppercase tracking-widest py-3 px-4 rounded-xl text-xs transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    {restoring ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Restaurando...
                      </>
                    ) : (
                      'Restaurar configuración'
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function CheckCircle({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
