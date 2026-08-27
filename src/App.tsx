/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, lazy, Suspense, useRef, type FormEvent } from "react";
import { useCustomCollectionData } from "./lib/firestoreUtils";
import { motion } from "motion/react";
import { GuidedTour } from "./components/GuidedTour";
import {
  BookOpen,
  Plus,
  BookMarked,
  Calendar,
  Clock,
  User,
  Trash2,
  Edit3,
  ChevronRight,
  Menu,
  X,
  LayoutDashboard,
  Settings,
  Layers,
  LogOut,
  HelpCircle,
  Download,
  Upload,
  ArrowLeft,
  Users,
} from "lucide-react";
import {
  exportSubjectToJSON,
  triggerJSONDownload,
  triggerGroupJSONDownload,
  importSubjectFromJSON,
  isValidBackup,
  isValidGroupBackup,
  importClassGroupFromJSON,
  exportClassGroupToJSON,
} from "./lib/jsonSyncUtils";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";

import { SubjectModal } from "./components/SubjectModal";
import { NoteModal } from "./components/NoteModal";
const SettingsModal = lazy(() => import("./components/SettingsModal").then(module => ({ default: module.SettingsModal })));
import { Dashboard } from "./components/Dashboard";
import { GradesTab } from "./components/GradesTab";
import { AttendanceTab } from "./components/AttendanceTab";
import { StudentsTab } from "./components/StudentsTab";
import { ModulesTab } from "./components/ModulesTab";
import { UserGuide } from "./components/UserGuide";
import { AdminDashboard } from "./components/AdminDashboard";
import { cn } from "./lib/utils";
import {
  initGA,
  trackPageView,
  trackEvent,
  ANALYTICS_CATEGORIES,
  ANALYTICS_ACTIONS,
} from "./lib/analytics";

import { useAuth } from './components/AuthProvider';
import { collection, query, where, orderBy, deleteDoc, doc, getDocs, writeBatch, limit, addDoc } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth, db } from './lib/firebase';
import { handleFirestoreError, OperationType } from './lib/firestoreUtils';
import { ToastContainer } from './components/ToastContainer';
import { TooltipProvider } from './components/TooltipProvider';
import { GradeSettingsProvider } from './contexts/GradeSettingsContext';
import { AdminFiltersProvider } from './contexts/AdminFiltersContext';
import { SidebarFilters } from './components/SidebarFilters';
import { STORAGE_KEYS, getStorageItem, setStorageItem, clearAppStorage } from './lib/storageKeys';
import { db as dexieDb } from './lib/db';
import { usePlan } from './hooks/usePlan';
import { useInstitution } from './hooks/useInstitution';
import { showToast } from './hooks/useToast';
import { checkGeminiHealth } from './lib/geminiClient';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { addSubjectCounterOp } from './lib/subjectCounter';
import { navigate, usePathname } from './lib/router';
import { LandingPage } from './components/LandingPage';
// Modo Demo (VITE_DEMO_MODE=true): evita lecturas a Firestore/IA reales.
import { IS_DEMO_MODE } from './lib/demoAdminData';
// ── Aula/Grupo multiasignatura ──────────────────────────────────────────────
import type { ClassGroupDoc, SubjectDoc, NoteDoc } from "./types/firestore";
import {
  canCreateClassGroup,
  canCreateStandaloneSubject,
  planSubjectDeletion,
  siblingsOf,
  lastMateriaStorageKey,
} from './lib/classGroups';

export default function App() {
  const { user } = useAuth();
  const pathname = usePathname();

  // Capturar parámetros de plan desde la landing page para el flujo de registro
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const planParam = params.get('plan');
    if (planParam === 'pro' || planParam === 'school') {
      localStorage.setItem('ediagil_pending_checkout_plan', planParam);
    }
    const instParam = params.get('institutionName');
    if (instParam) {
      localStorage.setItem('ediagil_pending_checkout_institution', instParam);
    }
  }, [pathname]);

  // ── Toast global listener (recibe errores de handleFirestoreError) ──────
  useEffect(() => {
    const handler = (e: Event) => {
      const { type, message } = (e as CustomEvent).detail;
      showToast(type, message);
    };
    window.addEventListener('app:toast', handler);
    return () => window.removeEventListener('app:toast', handler);
  }, []);

  // ── Verificar disponibilidad del servidor proxy al iniciar ───────────────
  useEffect(() => {
    if (!import.meta.env.DEV || IS_DEMO_MODE) return;
    checkGeminiHealth().then(({ ok, hasKey, error }) => {
      if (!ok) {
        showToast('error', `Servidor IA no disponible: ${error || 'Inicia el servidor con npm run dev:full'}`, 8000);
      } else if (!hasKey) {
        showToast('warning', 'Falta GEMINI_API_KEY en .env.local — La IA no funcionará.', 8000);
      }
    });
  }, []);

  // Normalizar la URL a /app cuando el usuario está autenticado
  // (no redirigir desde '/' en modo normal para poder trabajar en la landing
  // estando logueado; en modo demo sí se fuerza la entrada directa a la app).
  useEffect(() => {
    const shouldNormalizeToApp =
      (user && pathname === '/login') ||
      (IS_DEMO_MODE && user && pathname !== '/app' && pathname !== '/login');
    if (shouldNormalizeToApp) {
      window.history.replaceState({}, '', '/app');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [user, pathname]);

  useNetworkStatus();

  // Si no hay usuario y se intenta entrar a la app, mostrar login
  if (!user && (pathname === '/login' || pathname === '/app')) {
    return <LoginScreen onBack={() => navigate('/')} />;
  }

  // Mostrar la landing page en la raíz y sub-rutas, incluso si estamos logueados (para diseño).
  // En modo demo la app se muestra directo: el host demo nunca cae en la landing.
  if (pathname !== '/app' && pathname !== '/login' && !(IS_DEMO_MODE && user)) {
    return <LandingPage pathname={pathname} />;
  }

  return (
    <TooltipProvider>
      <ToastContainer />
      <GradeSettingsProvider>
        <AdminFiltersProvider>
          <CuadernoApp />
        </AdminFiltersProvider>
      </GradeSettingsProvider>
    </TooltipProvider>
  );
}

function LoginScreen({ onBack }: { onBack: () => void }) {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const [isSignUp, setIsSignUp] = useState(
    () => new URLSearchParams(window.location.search).get('mode') === 'signup',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setAuthError('');
    try {
      await signInWithGoogle();
    } catch {
      setAuthError('Error al iniciar sesión con Google. Asegúrate de haber habilitado el proveedor en Firebase Console > Authentication > Sign-in method.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email.trim()) {
      setAuthError('Ingresa tu email primero.');
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
      setShowResetPassword(false);
    } catch {
      setAuthError('Error al enviar el correo de recuperación. Inténtalo de nuevo más tarde.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAuth = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      if (isSignUp) {
        await signUp(email, password);
      } else {
        await signIn(email, password);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      console.error('Auth error:', err);
      if (message.includes('auth/operation-not-allowed')) {
        setAuthError('El registro por email no está habilitado en Firebase. Actívalo en Firebase Console > Authentication > Sign-in method > Email/Password.');
      } else if (message.includes('auth/email-already-in-use')) {
        setAuthError('Este email ya está registrado. Inicia sesión.');
      } else if (message.includes('auth/invalid-email')) {
        setAuthError('Email no válido.');
      } else if (message.includes('auth/weak-password')) {
        setAuthError('La contraseña debe tener al menos 6 caracteres.');
      } else if (message.includes('auth/user-not-found') || message.includes('auth/wrong-password') || message.includes('auth/invalid-credential')) {
        setAuthError('Email o contraseña incorrectos.');
      } else {
        setAuthError(message);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <TooltipProvider>
      <ToastContainer />
      <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-50 px-4">
        <button
          onClick={onBack}
          title="Volver a la página principal"
          className="mb-8 inline-flex items-center gap-2 text-sm font-bold text-neutral-500 hover:text-neutral-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a la página principal
        </button>
        <div className="text-center space-y-6 max-w-sm w-full">
            <div className="w-24 h-24 bg-white rounded-[2rem] flex items-center justify-center mx-auto border border-neutral-200 shadow-2xl overflow-hidden p-1">
              <img src="/logo.webp" alt="EdiAgil Logo" className="app-logo w-full h-full object-contain" style={{ filter: 'none', backgroundColor: 'transparent' }} />
            </div>
            <h1 className="text-4xl font-black text-neutral-900 tracking-tight">EdiAgil</h1>
            <p className="text-neutral-500 font-medium px-4">Gestiona tus clases, asistencias y calificaciones en la nube.</p>
            <form onSubmit={handleAuth} className="space-y-4 w-full">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="w-full bg-white border border-neutral-200 rounded-2xl px-6 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-medium"
              />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Contraseña (mín. 6 caracteres)"
                className="w-full bg-white border border-neutral-200 rounded-2xl px-6 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-medium"
              />
              {authError && (
                <p className="text-red-500 text-sm font-medium">{authError}</p>
              )}
              {resetSent && (
                <p className="text-emerald-600 text-sm font-medium">Te enviamos un email para restablecer tu contraseña.</p>
              )}
              {showResetPassword ? (
                <div className="space-y-4">
                  <p className="text-sm text-neutral-500 font-medium">Ingresa tu email y te enviaremos un enlace para restablecer tu contraseña.</p>
                  <button
                    type="button"
                    disabled={authLoading}
                    onClick={handleResetPassword}
                    title="Enviar correo para restablecer contraseña"
                    className="w-full bg-amber-500 hover:bg-amber-400 text-white px-6 py-4 rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg active:scale-95 transition-all disabled:opacity-50"
                  >
                    {authLoading ? 'Enviando...' : 'Enviar enlace de recuperación'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowResetPassword(false); setAuthError(''); }}
                    title="Regresar al inicio de sesión"
                    className="w-full text-sm text-neutral-500 hover:text-neutral-900 font-bold transition-colors"
                  >
                    Volver
                  </button>
                </div>
              ) : (
                <>
                  <button
                    id="login-button"
                    type="submit"
                    disabled={authLoading}
                    title={isSignUp ? 'Crear una cuenta nueva' : 'Iniciar sesión en tu cuenta'}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-4 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-500/20 active:scale-95 transition-all disabled:opacity-50"
                  >
                    {authLoading ? 'Cargando...' : isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}
                  </button>
                  <div className="relative flex items-center gap-4 py-1">
                    <div className="flex-1 h-px bg-neutral-200" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">o</span>
                    <div className="flex-1 h-px bg-neutral-200" />
                  </div>
                  <button
                    id="google-login-button"
                    type="button"
                    disabled={googleLoading || authLoading}
                    onClick={handleGoogleLogin}
                    title="Iniciar sesión con Google"
                    className="w-full flex items-center justify-center gap-3 bg-white border border-neutral-200 hover:bg-neutral-50 hover:border-neutral-300 text-neutral-700 px-6 py-4 rounded-2xl font-black uppercase tracking-widest text-xs shadow-sm active:scale-95 transition-all disabled:opacity-50"
                  >
                    <GoogleG className="w-5 h-5" />
                    {googleLoading ? 'Conectando...' : 'Continuar con Google'}
                  </button>
                  {!isSignUp && (
                    <button
                      type="button"
                      onClick={() => { setShowResetPassword(true); setAuthError(''); setResetSent(false); }}
                      title="Solicitar restablecimiento de contraseña"
                      className="w-full text-sm text-indigo-600 hover:text-indigo-500 font-bold transition-colors"
                    >
                      ¿Olvidaste tu contraseña?
                    </button>
                  )}
                </>
              )}
            </form>
            {!showResetPassword && (
              <button
                id="login-toggle"
                onClick={() => { setIsSignUp(!isSignUp); setAuthError(''); setResetSent(false); }}
                title="Cambiar entre inicio de sesión y registro"
                className="text-sm text-indigo-600 hover:text-indigo-500 font-bold transition-colors"
              >
                {isSignUp ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
              </button>
            )}
            <div className="flex items-center justify-center gap-4 pt-2">
              <a href="/terminos.html" target="_blank" rel="noopener noreferrer" className="text-[11px] text-neutral-400 hover:text-indigo-600 font-medium transition-colors">Términos</a>
              <span className="text-neutral-300 text-[11px]">·</span>
              <a href="/privacidad.html" target="_blank" rel="noopener noreferrer" className="text-[11px] text-neutral-400 hover:text-indigo-600 font-medium transition-colors">Privacidad</a>
            </div>
          </div>
        </div>
    </TooltipProvider>
  );
}

function CuadernoApp() {
  const { user, logOut } = useAuth();
  const { plan: dbPlan, loading: loadingPlan, isAdmin, profile } = usePlan();
  // Personalización institucional (Módulo 5): nombre, logo y color primario
  // del admin, reflejados para TODOS los docentes de la institución.
  const institution = useInstitution();
  const [currentView, setCurrentView] = useState<"dashboard" | "subject" | "admin">(
    "subject",
  );
  const [activeTab, setActiveTab] = useState<
    "planning" | "grades" | "attendance" | "students" | "modules"
  >("modules");
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(
    null,
  );
  const [isSubjectModalOpen, setIsSubjectModalOpen] = useState(false);
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [activeModuleIdForNote, setActiveModuleIdForNote] = useState<
    string | undefined
  >(undefined);
  const [subjectToEdit, setSubjectToEdit] = useState<SubjectDoc | null>(null);
  const [noteToEdit, setNoteToEdit] = useState<NoteDoc | null>(null);

  const [importedBackupData, setImportedBackupData] = useState<any>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isImportingLoading, setIsImportingLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'general' | 'advanced' | 'billing'>('general');
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [tourSubjectId, setTourSubjectId] = useState<string | null>(null);
  const [subjectToDelete, setSubjectToDelete] = useState<string | null>(null);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);

  useEffect(() => {
    initGA();
  }, []);

  useEffect(() => {
    if (isAdmin && currentView !== "admin") {
      setCurrentView("admin");
    }
  }, [isAdmin, currentView]);

  // Guarda de rol: un docente nunca debe poder aterrizar en la vista admin
  // (ni por ruta directa ni por estado), se le redirige a su dashboard o asignatura.
  useEffect(() => {
    if (!isAdmin && currentView === "admin") {
      setCurrentView(selectedSubjectId ? "subject" : "dashboard");
    }
  }, [isAdmin, currentView, selectedSubjectId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      showToast('success', '¡Pago exitoso! Tu plan Premium ha sido activado.');
      setSettingsInitialTab('billing');
      setIsSettingsModalOpen(true);
      window.history.replaceState({}, '', '/app');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, []);

  // Notificación de vencimiento de suscripción o prueba (7 días antes)
  useEffect(() => {
    if (loadingPlan || !profile) return;
    
    const notified = sessionStorage.getItem('ediagil_expiration_notified');
    if (notified) return;

    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    
    // Check for trial expiration
    const profileAny = profile as any;
    if (profileAny.isTrial && profileAny.trialEndsAt && profileAny.trialEndsAt > now) {
      const timeRemaining = profileAny.trialEndsAt - now;
      if (timeRemaining <= SEVEN_DAYS_MS) {
        const daysLeft = Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));
        showToast('warning', `¡Tu prueba gratuita expira en ${daysLeft} día${daysLeft === 1 ? '' : 's'}! Activa un plan para mantener los beneficios.`);
        sessionStorage.setItem('ediagil_expiration_notified', 'true');
        return;
      }
    }
    
    // Check for paid plan expiration
    if (dbPlan !== 'free' && profile.expiresAt && profile.expiresAt > now) {
      const timeRemaining = (profile.expiresAt as number) - now;
      if (timeRemaining <= SEVEN_DAYS_MS) {
        const daysLeft = Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));
        showToast('warning', `¡Tu plan ${dbPlan === 'school' ? 'Institucional' : 'Premium Pro'} expira en ${daysLeft} día${daysLeft === 1 ? '' : 's'}! Renueva para no perder acceso a las funciones avanzadas.`);
        sessionStorage.setItem('ediagil_expiration_notified', 'true');
      }
    }
  }, [loadingPlan, profile, dbPlan]);

  // Procesar plan pendiente seleccionado desde la landing page tras registrarse
  useEffect(() => {
    if (loadingPlan || !user) return;
    const pendingPlan = localStorage.getItem('ediagil_pending_checkout_plan') as 'pro' | 'school' | null;
    const institutionName = localStorage.getItem('ediagil_pending_checkout_institution') || '';
    
    if (pendingPlan === 'pro' || pendingPlan === 'school') {
      if (dbPlan === 'free') {
        localStorage.removeItem('ediagil_pending_checkout_plan');
        localStorage.removeItem('ediagil_pending_checkout_institution');
        
        showToast('info', 'Redirigiendo a la pasarela de pago para activar tu plan...');
        
        (async () => {
          try {
            const token = await user.getIdToken();
            const res = await fetch('/api/create-checkout', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({ 
                plan: pendingPlan, 
                ...(pendingPlan === 'school' && institutionName.trim() ? { institutionName: institutionName.trim() } : {})
              }),
            });
            const data = await res.json();
            if (res.ok && data.url) {
              window.location.href = data.url;
            } else {
              showToast('error', data.error || 'Error al iniciar el pago.');
            }
          } catch (err: any) {
            console.error('Error auto-redirecting to checkout:', err);
            showToast('error', 'Error de red al iniciar el pago.');
          }
        })();
      } else {
        localStorage.removeItem('ediagil_pending_checkout_plan');
        localStorage.removeItem('ediagil_pending_checkout_institution');
      }
    }
  }, [user, dbPlan, loadingPlan]);

  useEffect(() => {
    const leftoverTourId = localStorage.getItem('tour_subject_id');
    if (leftoverTourId && user?.uid) {
      (async () => {
        try {
          const batch = writeBatch(db);
          batch.delete(doc(db, 'subjects', leftoverTourId));
          const subCollections = ['notes', 'materials', 'subjectModules', 'calendarEvents', 'evaluations', 'students', 'grades', 'attendance'];
          for (const collName of subCollections) {
            const q = query(collection(db, collName), where('subjectId', '==', leftoverTourId), where('userId', '==', user.uid), limit(500));
            const snapshot = await getDocs(q);
            snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
          }
          if (user?.uid) await addSubjectCounterOp(batch, user.uid, -1);
          await batch.commit();
        } catch (e) {
          console.warn("Failed to clean up leftover tour subject:", e);
        } finally {
          localStorage.removeItem('tour_subject_id');
        }
      })();
    }
  }, [user]);

  useEffect(() => {
    const path =
      currentView === "dashboard"
        ? "/dashboard"
        : currentView === "admin"
          ? "/admin"
          : `/subject/${selectedSubjectId}/${activeTab}`;
    trackPageView(path);
  }, [currentView, selectedSubjectId, activeTab]);

  const subjectsRef = collection(db, 'subjects');
  // En modo demo no se consulta Firestore real (el admin no ve la lista de
  // asignaturas de todos modos).
  const subjectsQuery = !IS_DEMO_MODE && user?.uid ? query(subjectsRef, where('userId', '==', user?.uid), limit(500)) : null;
  const [subjects = [], loadingSubjects] = useCustomCollectionData(subjectsQuery);

  // ── Aula/Grupo multiasignatura: grupos reales del docente (live) ─────────
  const classGroupsQuery = !IS_DEMO_MODE && user?.uid ? query(collection(db, 'classGroups'), where('userId', '==', user?.uid), limit(200)) : null;
  const [groups = [], loadingGroups] = useCustomCollectionData<ClassGroupDoc>(classGroupsQuery);

  /** Materias hermanas del aula de una asignatura, en orden estable. */
  const aulaMateriasOf = (subject: SubjectDoc | undefined): SubjectDoc[] =>
    subject?.groupId ? siblingsOf(subjects as SubjectDoc[], subject.groupId) : [];

  const selectedSubject = subjects.find((s) => s.id === selectedSubjectId);
  const selectedGroup = selectedSubject?.groupId ? groups.find((g) => g.id === selectedSubject.groupId) ?? null : null;

  const [activeSubscription, setActiveSubscription] = useState<
    "free" | "pro" | "school"
  >(() => {
    return (
      (getStorageItem(STORAGE_KEYS.ACTIVE_SUBSCRIPTION) as
        | "free"
        | "pro"
        | "school") || "free"
    );
  });

  useEffect(() => {
    if (!loadingPlan && dbPlan) {
      const sandboxMode = getStorageItem('ediagil_sandbox_mode') === 'true';
      if (!sandboxMode) {
        setStorageItem(STORAGE_KEYS.ACTIVE_SUBSCRIPTION, dbPlan);
        setActiveSubscription(dbPlan);
        window.dispatchEvent(new Event("subscription_change"));
      }
    }
  }, [dbPlan, loadingPlan]);

  useEffect(() => {
    const handleSubChange = () => {
      setActiveSubscription(
        (getStorageItem(STORAGE_KEYS.ACTIVE_SUBSCRIPTION) as
          | "free"
          | "pro"
          | "school") || "free",
      );
    };
    window.addEventListener("subscription_change", handleSubChange);
    return () =>
      window.removeEventListener("subscription_change", handleSubChange);
  }, []);

  const handleStartTour = async () => {
    if (subjects.length === 0 && user) {
      try {
        const batch = writeBatch(db);
        const demoRef = doc(collection(db, 'subjects'));
        batch.set(demoRef, {
          name: 'Mi Asignatura Demo',
          userId: user.uid,
          color: '#4f46e5',
          createdAt: Date.now(),
          plan: 'trimestral',
          teacher: '',
          schedule: '',
          periodo: null,
        });
        await addSubjectCounterOp(batch, user.uid, +1);
        await batch.commit();
        setTourSubjectId(demoRef.id);
        setSelectedSubjectId(demoRef.id);

        const moduleRef = await addDoc(collection(db, 'subjectModules'), {
          userId: user.uid,
          subjectId: demoRef.id,
          title: 'Unidad 1: Introducción',
          description: 'Principios fundamentales de la asignatura',
          order: 1,
          createdAt: Date.now(),
          startDate: format(new Date(), 'yyyy-MM-dd'),
          endDate: format(new Date(new Date().setMonth(new Date().getMonth() + 2)), 'yyyy-MM-dd'),
        });

        await addDoc(collection(db, 'students'), {
          userId: user.uid,
          subjectId: demoRef.id,
          cedula: '12345678',
          firstName: 'Juan',
          lastName: 'Pérez',
          gender: 'M',
        });

        await addDoc(collection(db, 'evaluations'), {
          userId: user.uid,
          subjectId: demoRef.id,
          moduleId: moduleRef.id,
          title: 'Examen Diagnóstico',
          maxScore: 100,
          date: format(new Date(), 'yyyy-MM-dd'),
          type: 'teorica',
        });

        localStorage.setItem('tour_subject_id', demoRef.id);
      } catch {
        // fallback: continue without demo subject
      }
    }
    setIsTourOpen(true);
  };

  const handleCloseTour = async () => {
    setIsTourOpen(false);
    if (tourSubjectId) {
      try {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'subjects', tourSubjectId));

        const subCollections = ['notes', 'materials', 'subjectModules', 'calendarEvents', 'evaluations', 'students', 'grades', 'attendance'];
        for (const collName of subCollections) {
          const q = query(collection(db, collName), where('subjectId', '==', tourSubjectId), where('userId', '==', user?.uid), limit(500));
          const snapshot = await getDocs(q);
          snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
        }

        if (user?.uid) await addSubjectCounterOp(batch, user.uid, -1);
        await batch.commit();
      } catch {
        // cleanup silently
      }

      if (selectedSubjectId === tourSubjectId) {
        setSelectedSubjectId(null);
      }
      setTourSubjectId(null);
      localStorage.removeItem('tour_subject_id');
    }
  };

  const handleEditSubject = (subject: SubjectDoc) => {
    setSubjectToEdit(subject);
    setIsSubjectModalOpen(true);
  };

  /**
   * Aula/Grupo: validación previa de límites según la modalidad elegida en el
   * modal. Fuente central de permisos (usePlan/PLAN_LIMITS + classGroups):
   * NADA hardcodeado aquí. Gratis = 2 unidades (asignaturas independientes +
   * aulas) y máximo 1 aula; las materias internas NO consumen cuota.
   */
  const checkCanCreate = (modality: 'una' | 'varias'): string | null => {
    if (activeSubscription !== 'free') return null;
    const decision = modality === 'varias'
      ? canCreateClassGroup('free', subjects as SubjectDoc[], groups as ClassGroupDoc[])
      : canCreateStandaloneSubject('free', subjects as SubjectDoc[], groups as ClassGroupDoc[]);
    return decision.allowed ? null : decision.reason ?? null;
  };

  const handleCreated = (result: { kind: 'subject'; subjectId: string } | { kind: 'group'; groupId: string; firstMateriaId: string }) => {
    if (result.kind === 'group') {
      setSelectedSubjectId(result.firstMateriaId);
    } else {
      setSelectedSubjectId(result.subjectId);
    }
    setCurrentView('subject');
  };

  /** Cambio de materia DENTRO de un mismo aula (selector de Calificaciones/Planificación). */
  const handleSelectAulaMateria = (materiaId: string) => {
    const materia = subjects.find((s) => s.id === materiaId);
    if (!materia) return;
    // Recordar la última materia usada POR AULA.
    try {
      if (materia.groupId) localStorage.setItem(lastMateriaStorageKey(materia.groupId), String(materiaId));
    } catch { /* storage lleno/bloqueado: no bloquear el cambio */ }
    setSelectedSubjectId(String(materiaId));
  };

  const handleNewSubject = () => {
    if (activeSubscription === "free") {
      // Límite por UNIDADES (asignaturas independientes + aulas; máx 1 aula).
      const decision = canCreateStandaloneSubject('free', subjects as SubjectDoc[], groups as ClassGroupDoc[]);
      const groupDecision = canCreateClassGroup('free', subjects as SubjectDoc[], groups as ClassGroupDoc[]);
      if (!decision.allowed && !groupDecision.allowed) {
        showToast('warning', groupDecision.reason || decision.reason || 'Has alcanzado tu límite del plan gratuito.');
        return;
      }
      // Con al menos una modalidad posible se abre el modal (la validación
      // fina por modalidad vive en checkCanCreate).
    }
    setSubjectToEdit(null);
    setIsSubjectModalOpen(true);
  };

  const handleDeleteSubject = async (id: string) => {
    try {
      // ── Aula/Grupo: plan de eliminación inteligente ────────────────────
      // - Asignatura independiente → como siempre (counter -1).
      // - Materia intermedia de un aula → solo se borra ELLA (counter 0);
      //   si era la canónica, participantes/asistencia se MUEVEN a la
      //   siguiente hermana (cero pérdida de historial).
      // - Última materia del aula → borra también el doc del aula y libera
      //   la unidad (counter -1).
      const plan = planSubjectDeletion(subjects as SubjectDoc[], groups as ClassGroupDoc[], id);
      if (!plan.found) return;

      const batch = writeBatch(db);
      batch.delete(doc(db, 'subjects', id));

      if (plan.isGrouped && plan.reassignTo) {
        // Reasignar la lista compartida al nuevo canonical del aula.
        for (const collName of ['students', 'attendance'] as const) {
          const q = query(collection(db, collName), where('subjectId', '==', id), where('userId', '==', user?.uid), limit(500));
          const snapshot = await getDocs(q);
          snapshot.docs.forEach((docSnap) => batch.update(docSnap.ref, { subjectId: plan.reassignTo! }));
        }
      }

      const subCollections = ['notes', 'materials', 'subjectModules', 'calendarEvents', 'evaluations', 'students', 'grades', 'attendance'];
      // Si la canónica se está moviendo a otra hermana, NO borrar la lista
      // compartida: ya fue REASIGNADA arriba (las queries ven estado
      // pre-batch; borrar aquí eliminaría lo recién movido).
      const collsToDelete = (plan.isGrouped && plan.reassignTo)
        ? subCollections.filter((c) => c !== 'students' && c !== 'attendance')
        : subCollections;

      for (const collName of collsToDelete) {
        const q = query(collection(db, collName), where('subjectId', '==', id), where('userId', '==', user?.uid), limit(500));
        const snapshot = await getDocs(q);
        snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
      }

      if (!plan.isGrouped || plan.deleteGroup) {
        if (user?.uid) await addSubjectCounterOp(batch, user.uid, -1);
      }
      const targetGroupId = subjects.find((s) => s.id === id)?.groupId;
      if (plan.deleteGroup && targetGroupId) {
        batch.delete(doc(db, 'classGroups', targetGroupId));
      }

      await batch.commit();

      if (selectedSubjectId === id) setSelectedSubjectId(null);
      trackEvent(ANALYTICS_CATEGORIES.SUBJECT, ANALYTICS_ACTIONS.DELETE);
      setSubjectToDelete(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `subjects/${id}`);
    }
  };

  const handleEditNote = (note: NoteDoc) => {
    setNoteToEdit(note);
    setIsNoteModalOpen(true);
  };

  const handleDeleteNote = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'notes', id));
      trackEvent(ANALYTICS_CATEGORIES.NOTE, ANALYTICS_ACTIONS.DELETE);
      setNoteToDelete(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `notes/${id}`);
    }
  };

  const handleExportJSON = async (subject: SubjectDoc) => {
    if (!user) return;
    try {
      showToast('info', 'Generando archivo de exportación...');
      // Aula/Grupo: exporta el aula COMPLETA (materias + lista compartida).
      const materias = aulaMateriasOf(subject);
      if (subject.groupId && materias.length >= 2) {
        const groupName = groups.find((g) => g.id === subject.groupId)?.name || subject.groupId;
        const backup = await exportClassGroupToJSON(
          user.uid,
          subject.groupId,
          groupName,
          materias.map((m) => ({ id: m.id!, name: m.name })),
        );
        triggerGroupJSONDownload(backup, groupName);
        showToast('success', 'Aula exportada con éxito (todas sus materias y la lista compartida).');
        return;
      }
      const backup = await exportSubjectToJSON(user.uid, subject.id);
      triggerJSONDownload(backup, subject.name);
      showToast('success', 'Asignatura exportada con éxito.');
    } catch (error) {
      console.error(error);
      showToast('error', 'Error al exportar la asignatura.');
    }
  };

  const triggerFileInputClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileImportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        // Aula/Grupo (v1.1) primero; asignatura suelta (v1.0) después.
        if (isValidGroupBackup(json)) {
          setImportedBackupData(json);
          setIsImportModalOpen(true);
        } else if (isValidBackup(json)) {
          setImportedBackupData(json);
          setIsImportModalOpen(true);
        } else {
          showToast('error', 'El archivo no tiene un formato válido de respaldo de EdiAgil.');
        }
      } catch (err) {
        showToast('error', 'Error al leer el archivo JSON.');
      }
    };
    reader.readAsText(file);
  };

  const handleLogout = async () => {
    try {
      clearAppStorage();
      await dexieDb.delete();
    } catch (e) {
      console.warn('Error cleaning up local data:', e);
    }
    logOut();
  };

  const handleConfirmImport = async (mode: 'create' | 'overwrite') => {
    if (!user || !importedBackupData) return;
    setIsImportingLoading(true);
    try {
      // ── Aula/Grupo (v1.1): restaurar aula completa ──
      if (isValidGroupBackup(importedBackupData)) {
        if (mode === 'overwrite') {
          showToast('warning', 'La sobrescritura aplica a asignaturas individuales; el aula se importará como nueva.');
        }
        showToast('info', 'Restaurando el aula completa (materias, participantes y asistencia)...');
        const res = await importClassGroupFromJSON(user.uid, importedBackupData);
        showToast('success', 'Aula importada con éxito.');
        setSelectedSubjectId(res.firstMateriaId);
        setCurrentView('subject');
        setIsImportModalOpen(false);
        setImportedBackupData(null);
        return;
      }
      showToast('info', mode === 'create' ? 'Creando asignatura...' : 'Sobrescribiendo asignatura...');
      const newSubjectId = await importSubjectFromJSON(
        user.uid,
        importedBackupData,
        mode,
        mode === 'overwrite' ? selectedSubjectId! : undefined
      );

      showToast('success', mode === 'create' ? 'Asignatura importada con éxito.' : 'Asignatura sobrescrita con éxito.');
      setSelectedSubjectId(newSubjectId);
      setCurrentView('subject');
      setIsImportModalOpen(false);
      setImportedBackupData(null);
    } catch (error) {
      console.error(error);
      showToast('error', 'Ocurrió un error al importar los datos.');
    } finally {
      setIsImportingLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-neutral-50 text-neutral-900 font-sans overflow-hidden selection:bg-indigo-500/30">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-neutral-900/40 backdrop-blur-md z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed md:static inset-y-0 left-0 z-40 w-80 bg-white border-r border-neutral-200 flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] shadow-sm",
          isSidebarOpen
            ? "translate-x-0"
            : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="p-8 border-b border-neutral-100 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {isAdmin ? (
              <>
                <img src={institution.logoUrl || '/logo.webp'} alt="Logo institucional" className="app-logo w-7 h-7 object-contain" style={{ filter: 'none', backgroundColor: 'transparent' }} />
                <div>
                  <h1 className="font-black text-xl tracking-tight text-neutral-900">
                    Panel Institucional
                  </h1>
                  <p className="text-xs font-medium text-neutral-500 truncate">
                    {institution.name || profile?.institutionName || 'Cuenta institucional'}
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-xl bg-[var(--institution-primary)] flex items-center justify-center text-white shadow-lg">
                  <img src={institution.logoUrl || '/logo.webp'} alt="Logo institucional" className="app-logo w-5 h-5 object-contain" style={{ filter: 'none', backgroundColor: 'transparent' }} />
                </div>
                <div className="min-w-0">
                  <h1 className="font-black text-xl tracking-tight text-neutral-900">
                    Mi Cuaderno
                  </h1>
                  {institution.name && (
                    <p className="text-xs font-medium text-neutral-500 truncate">
                      {institution.name}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
          <button
            aria-label="Cerrar menú"
            title="Cerrar menú lateral"
            className="md:hidden text-neutral-400 hover:text-neutral-900 transition-colors"
            onClick={() => setIsSidebarOpen(false)}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
          {!isAdmin && (
            <button
              onClick={() => {
                setCurrentView("dashboard");
                setSelectedSubjectId(null);
                setIsSidebarOpen(false);
              }}
              title="Ver el panel principal"
              className={cn(
                "w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all mb-6 hover:scale-[1.02] active:scale-95 group",
                currentView === "dashboard"
                  ? "bg-[var(--institution-primary)] text-[var(--institution-primary-contrast)] shadow-xl"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900",
              )}
            >
              <div className="flex items-center gap-2">
                <img src="/logo.webp" alt="Logo" className="app-logo w-12 h-12 object-contain rounded-lg bg-white p-1 shadow-sm" style={{ filter: 'none', backgroundColor: 'transparent' }} onError={(e) => {
                  // Fallback to icon if logo is not found
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }} />
                <LayoutDashboard
                  className={cn(
                    "hidden w-5 h-5 transition-transform group-hover:rotate-12",
                    currentView === "dashboard" ? "text-[var(--institution-primary-contrast)]" : "text-neutral-400",
                  )}
                />
              </div>
              <span className="font-black text-sm uppercase tracking-widest">
                Dashboard
              </span>
            </button>
          )}

          {isAdmin && (
            <button
              onClick={() => {
                setCurrentView("admin");
                setSelectedSubjectId(null);
                setIsSidebarOpen(false);
              }}
              title="Panel institucional de administración"
              className={cn(
                "w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all mb-6 hover:scale-[1.02] active:scale-95 group",
                currentView === "admin"
                  ? "bg-[var(--institution-primary)] text-[var(--institution-primary-contrast)] shadow-xl"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900",
              )}
            >
              <div className="flex items-center gap-2">
                <img src="/logo.webp" alt="Logo" className="app-logo w-12 h-12 object-contain rounded-lg bg-white p-1 shadow-sm" style={{ filter: 'none', backgroundColor: 'transparent' }} onError={(e) => {
                  // Fallback to icon if logo is not found
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }} />
                <LayoutDashboard
                  className={cn(
                    "hidden w-5 h-5 transition-transform group-hover:rotate-12",
                    currentView === "admin" ? "text-[var(--institution-primary-contrast)]" : "text-neutral-400",
                  )}
                />
              </div>
              <span className="font-black text-sm uppercase tracking-widest">
                Dashboard Administrativo
              </span>
            </button>
          )}

          {/* Filtros del panel admin (turno + nivel educativo) en el sidebar */}
          {isAdmin && <SidebarFilters />}

          {!isAdmin && (
          <>
          <div className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-6 px-4">
            Asignaturas
          </div>

          {!loadingSubjects && !loadingGroups && subjects.length === 0 ? (
            <div className="text-center px-6 py-12 text-neutral-400 text-sm font-medium italic bg-neutral-50 rounded-3xl border border-dashed border-neutral-200">
              No tienes asignaturas aún.
            </div>
          ) : (
            <div className="space-y-2">
              {/* ── Aulas/Grupos primero (etiqueta + sus materias), luego las
                  asignaturas independientes. Las antiguas se ven EXACTAMENTE
                  igual que siempre. ── */}
              {(() => {
                type Item =
                  | { kind: 'aula'; group: ClassGroupDoc; members: SubjectDoc[] }
                  | { kind: 'solo'; subject: SubjectDoc };
                const items: Item[] = [];
                const inAula = new Set<string>();
                for (const g of groups) {
                  const members = siblingsOf(subjects as SubjectDoc[], g.id);
                  if (members.length > 0) {
                    items.push({ kind: 'aula', group: g, members });
                    members.forEach((m) => inAula.add(String(m.id)));
                  }
                }
                for (const s of subjects as SubjectDoc[]) {
                  if (!inAula.has(String(s.id))) items.push({ kind: 'solo', subject: s });
                }

                /** Abre una asignatura; si pertenece a un aula, restaura la
                    última materia usada en ESE aula (memoria por aula). */
                const openSubject = (subject: SubjectDoc) => {
                  let targetId = String(subject.id);
                  if (subject.groupId) {
                    try {
                      const last = localStorage.getItem(lastMateriaStorageKey(subject.groupId));
                      const validLast = last
                        ? siblingsOf(subjects as SubjectDoc[], subject.groupId).some((m) => m.id === last)
                        : false;
                      if (validLast) targetId = last!;
                    } catch { /* storage bloqueado: usar la materia clicada */ }
                  }
                  setSelectedSubjectId(targetId);
                  setCurrentView("subject");
                  setIsSidebarOpen(false);
                };

                return items.map((item) =>
                  item.kind === 'aula' ? (
                    <div key={`aula-${item.group.id}`} className="pt-2">
                      <div className="flex items-center gap-2 px-4 pb-1.5">
                        <Users className="w-3 h-3 text-[var(--institution-primary)]" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500 truncate">
                          Aula · {item.group.name}
                        </span>
                        <span className="ml-auto shrink-0 text-[9px] font-black text-neutral-400 bg-neutral-100 rounded-full px-2 py-0.5">
                          {item.members.length} materias
                        </span>
                      </div>
                      <div className="space-y-2">
                        {item.members.map((subject) => (
                          <button
                            key={subject.id}
                            title="Abrir esta materia del aula"
                            onClick={() => openSubject(subject)}
                            className={cn(
                              "w-full flex items-center justify-between pl-6 pr-4 py-3.5 rounded-2xl transition-all group hover:scale-[1.02] active:scale-95",
                              selectedSubjectId === subject.id &&
                                currentView === "subject"
                                ? "bg-neutral-100 text-neutral-900 shadow-sm border border-neutral-200"
                                : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 border border-transparent",
                            )}
                          >
                            <div className="flex items-center gap-4 truncate">
                              <div
                                className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm border-2 border-white"
                                style={{ backgroundColor: subject.color }}
                              />
                              <span className="truncate font-black text-sm">
                                {subject.name}
                              </span>
                            </div>
                            <ChevronRight
                              className={cn(
                                "w-4 h-4 shrink-0 transition-all duration-300",
                                selectedSubjectId === subject.id
                                  ? "opacity-100 translate-x-0 text-[var(--institution-primary)]"
                                  : "opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0",
                              )}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <button
                      key={item.subject.id}
                      title="Seleccionar esta asignatura"
                      onClick={() => openSubject(item.subject)}
                      className={cn(
                        "w-full flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all group hover:scale-[1.02] active:scale-95",
                        selectedSubjectId === item.subject.id &&
                          currentView === "subject"
                          ? "bg-neutral-100 text-neutral-900 shadow-sm border border-neutral-200"
                          : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900 border border-transparent",
                      )}
                    >
                      <div className="flex items-center gap-4 truncate">
                        <div
                          className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm border-2 border-white"
                          style={{ backgroundColor: item.subject.color }}
                        />
                        <span className="truncate font-black text-sm">
                          {item.subject.name}
                        </span>
                      </div>
                      <ChevronRight
                        className={cn(
                          "w-4 h-4 shrink-0 transition-all duration-300",
                          selectedSubjectId === item.subject.id
                            ? "opacity-100 translate-x-0 text-[var(--institution-primary)]"
                            : "opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0",
                        )}
                      />
                    </button>
                  ),
                );
              })()}
            </div>
          )}
          </>
          )}
        </div>

        <div className="p-6 border-t border-neutral-100 space-y-3">
          <button
            id="weightings-btn"
            aria-label="Configuración"
            onClick={() => setIsSettingsModalOpen(true)}
            title="Ajustes de la aplicación"
            className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all text-neutral-400 hover:bg-neutral-50 hover:text-neutral-900 group"
          >
            <Settings className="w-5 h-5 transition-transform group-hover:rotate-90" />
            <span className="font-black text-[10px] uppercase tracking-[0.2em]">
              Configuración
            </span>
          </button>
          {!isAdmin && (
          <button
            id="new-subject-btn"
            onClick={handleNewSubject}
            title="Añadir una nueva asignatura"
            className="w-full flex items-center justify-center gap-3 bg-neutral-900 hover:bg-neutral-800 text-white py-4 rounded-2xl transition-all hover:shadow-2xl active:scale-95 text-sm font-black uppercase tracking-widest"
          >
            <Plus className="w-5 h-5" />
            Nueva Asignatura
          </button>
          )}
          {!isAdmin && (
          <button
            id="import-subject-btn"
            onClick={triggerFileInputClick}
            title="Importar asignatura desde archivo JSON"
            className="w-full flex items-center justify-center gap-3 bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-700 py-3.5 rounded-2xl transition-all hover:shadow-md active:scale-95 text-xs font-black uppercase tracking-widest"
          >
            <Upload className="w-4 h-4 text-neutral-500" />
            Importar JSON
          </button>
          )}
          <input
            type="file"
            accept=".json"
            onChange={handleFileImportChange}
            ref={fileInputRef}
            className="hidden"
          />
          <button
            aria-label="Cerrar sesión"
            onClick={handleLogout}
            title="Cerrar Sesión"
            className="w-full mt-2 flex items-center justify-center gap-3 bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-600 py-3 rounded-2xl transition-all active:scale-95 text-xs font-black uppercase tracking-widest"
          >
            <LogOut className="w-4 h-4" />
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-neutral-50 relative">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center gap-4 p-6 border-b-[3px] border-b-[var(--institution-primary)] bg-white shadow-sm">
          <button
            aria-label="Abrir menú"
            title="Abrir menú lateral"
            onClick={() => setIsSidebarOpen(true)}
            className="text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            <Menu className="w-6 h-6" />
          </button>
          <span className="font-black truncate text-neutral-900 uppercase tracking-widest text-sm">
            {currentView === "dashboard"
              ? "Dashboard"
              : currentView === "admin"
                ? "Panel Administrativo"
                : selectedSubject
                  ? selectedSubject.name
                  : "Mi Cuaderno"}
          </span>
        </header>

        {currentView === "admin" && isAdmin ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <AdminDashboard />
          </div>
        ) : currentView === "dashboard" ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <Dashboard
              onNavigateToSubject={(id: string, tab: string) => {
                setSelectedSubjectId(id);
                setCurrentView("subject");
                if (tab) setActiveTab(tab as "planning" | "grades" | "attendance" | "students" | "modules");
              }}
              onNewSubject={handleNewSubject}
              onOpenSettings={() => setIsSettingsModalOpen(true)}
            />
          </div>
        ) : selectedSubject ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="max-w-5xl mx-auto p-8 md:p-12">
              {/* Subject Header */}
              <div className="mb-12">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-8 mb-10">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-4 mb-4">
                      <div
                        className="w-6 h-6 rounded-full border-4 border-white shadow-md"
                        style={{ backgroundColor: selectedSubject.color }}
                      />
                      <h2 className="text-4xl md:text-5xl font-black text-neutral-900 tracking-tight leading-tight truncate">
                        {selectedSubject.name}
                      </h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-500 mt-6">
                      {/* Chip del Aula/Grupo (solo materias agrupadas): nombre
                          del aula + grado y sección. */}
                      {selectedGroup && (
                        <div className="flex items-center gap-2.5 bg-[#F0F7F4] px-4 py-2 rounded-xl border border-[#1A3C40]/10 shadow-sm">
                          <Users className="w-4 h-4 text-[#1A3C40]" />
                          <span className="font-bold text-[#1A3C40] text-xs">
                            {selectedGroup.name}
                            {(selectedGroup.grado || selectedGroup.seccion) && (
                              <span className="text-neutral-500 font-bold">
                                {' · '}
                                {[selectedGroup.grado, selectedGroup.seccion].filter(Boolean).join(' ')}
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                      {selectedSubject.plan &&
                        selectedSubject.plan !== "otro" && (
                          <div className="flex items-center gap-2.5 bg-white px-4 py-2 rounded-xl border border-neutral-200 shadow-sm hover:border-[var(--institution-primary)]/40 transition-colors">
                            <Layers className="w-4 h-4 text-[var(--institution-primary)]" />
                            <span className="font-bold uppercase text-[10px] tracking-widest">
                              {selectedSubject.plan.replace("_", " ")}
                            </span>
                          </div>
                        )}
                      {selectedSubject.teacher && (
                        <div className="flex items-center gap-2.5 bg-white px-4 py-2 rounded-xl border border-neutral-200 shadow-sm hover:border-[var(--institution-primary)]/40 transition-colors">
                          <User className="w-4 h-4 text-[var(--institution-primary)]" />
                          <span className="font-bold">
                            {selectedSubject.teacher}
                          </span>
                        </div>
                      )}
                      {selectedSubject.schedule && (
                        <div className="flex items-center gap-2.5 bg-white px-4 py-2 rounded-xl border border-neutral-200 shadow-sm hover:border-[var(--institution-primary)]/40 transition-colors">
                          <Calendar className="w-4 h-4 text-[var(--institution-primary)]" />
                          <span className="font-bold">
                            {selectedSubject.schedule}
                          </span>
                        </div>
                      )}
                      {selectedSubject.periodo && (
                        <div className="flex items-center gap-2.5 bg-white px-4 py-2 rounded-xl border border-neutral-200 shadow-sm hover:border-indigo-200 transition-colors">
                          <Clock className="w-4 h-4 text-indigo-500" />
                          <span className="font-bold capitalize">
                            {selectedSubject.periodo === 'matutino'
                              ? 'Matutino'
                              : selectedSubject.periodo === 'vespertino'
                                ? 'Vespertino'
                                : 'Nocturno'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="flex items-center gap-2 bg-white p-1.5 rounded-2xl border border-neutral-200 shadow-sm">
                      <button
                        aria-label="Exportar JSON"
                        onClick={() => handleExportJSON(selectedSubject)}
                        className="p-3 text-neutral-400 hover:text-[var(--institution-primary)] hover:bg-[var(--institution-primary)]/10 rounded-xl transition-all active:scale-90"
                        title="Exportar asignatura como JSON"
                      >
                        <Download className="w-6 h-6" />
                      </button>
                      <button
                        aria-label="Editar asignatura"
                        onClick={() => handleEditSubject(selectedSubject)}
                        className="p-3 text-neutral-400 hover:text-[var(--institution-primary)] hover:bg-[var(--institution-primary)]/10 rounded-xl transition-all active:scale-90"
                        title="Editar asignatura"
                      >
                        <Edit3 className="w-6 h-6" />
                      </button>
                      <button
                        aria-label="Eliminar asignatura"
                        onClick={() => setSubjectToDelete(selectedSubject.id!)}
                        className="p-3 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all active:scale-90"
                        title="Eliminar asignatura"
                      >
                        <Trash2 className="w-6 h-6" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-8 border-b border-neutral-200 mb-8 overflow-x-auto no-scrollbar scroll-smooth">
                  {[
                    { id: "modules", label: "Módulos y Materiales" },
                    { id: "grades", label: "Calificaciones" },
                    { id: "attendance", label: "Asistencia" },
                    { id: "students", label: "Participantes" },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      id={`tab-${tab.id}`}
                      onClick={() => setActiveTab(tab.id as "modules" | "grades" | "attendance" | "students")}
                      title={`Sección de ${tab.label}`}
                      className={cn(
                         "pb-4 text-[10px] font-black uppercase tracking-[0.2em] transition-all border-b-4 whitespace-nowrap active:scale-95",
                         activeTab === tab.id
                          ? "border-[var(--institution-primary)] text-neutral-900"
                          : "border-transparent text-neutral-400 hover:text-neutral-600",
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab Content */}
              <motion.div
                key={`${selectedSubjectId}-${activeTab}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              >
                {activeTab === "modules" && (
                  <div id="materials-section">
                    <ModulesTab
                      subjectId={selectedSubject.id!}
                      onOpenNoteModal={(moduleId: string, note: NoteDoc | null) => {
                        setActiveModuleIdForNote(moduleId);
                        setNoteToEdit(note || null);
                        setIsNoteModalOpen(true);
                      }}
                      onDeleteNote={(id: string) => setNoteToDelete(id)}
                      aulaMaterias={aulaMateriasOf(selectedSubject)}
                      onSelectMateria={handleSelectAulaMateria}
                    />
                  </div>
                )}
                {activeTab === "grades" && (
                  <div id="grades-section">
                    <GradesTab
                      subjectId={selectedSubject.id!}
                      aulaMaterias={aulaMateriasOf(selectedSubject)}
                      onSelectMateria={handleSelectAulaMateria}
                    />
                  </div>
                )}
                {activeTab === "attendance" && (
                  <div id="attendance-section">
                    <AttendanceTab subjectId={selectedSubject.id!} />
                  </div>
                )}
                {activeTab === "students" && (
                  <div id="participants-section">
                    <StudentsTab subjectId={selectedSubject.id!} />
                  </div>
                )}
              </motion.div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-8 bg-neutral-50 relative">
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none overflow-hidden">
              <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600 rounded-full blur-[120px]" />
              <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600 rounded-full blur-[120px]" />
            </div>

            <div className="text-center max-w-lg relative z-10">
              <div className="w-28 h-28 bg-white rounded-[2.5rem] flex items-center justify-center mx-auto mb-10 border border-neutral-200 shadow-2xl hover:scale-110 hover:rotate-3 transition-all duration-700 group">
                <img src="/logo.webp" alt="Logo" className="app-logo w-12 h-12 object-contain group-hover:scale-110 transition-transform" style={{ filter: 'none', backgroundColor: 'transparent' }} />
              </div>
              <h2 className="text-4xl font-black text-neutral-900 mb-6 tracking-tight leading-tight">
                Bienvenido a tu Cuaderno
              </h2>
              <p className="text-neutral-500 mb-12 leading-relaxed text-xl font-medium">
                Organiza tus clases, toma apuntes estructurados y mantén todo tu
                conocimiento en un solo lugar en la nube y de forma segura.
              </p>
              {!loadingSubjects && (
                <div className="flex flex-col items-center gap-6">
                  {subjects.length > 0 && (
                    <div className="inline-block px-8 py-4 bg-white border border-neutral-200 rounded-3xl shadow-sm text-neutral-400 font-black uppercase tracking-[0.2em] text-[10px] animate-bounce">
                      Selecciona una asignatura para comenzar
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsSubjectModalOpen(true)}
                    title="Crear una nueva asignatura"
                    style={{ touchAction: 'manipulation' }}
                    className="inline-flex items-center gap-4 bg-indigo-600 hover:bg-indigo-500 text-white px-10 py-5 rounded-[2rem] font-black transition-all shadow-2xl shadow-indigo-500/40 hover:shadow-indigo-500/60 active:scale-95 uppercase tracking-widest text-sm"
                  >
                    <Plus className="w-6 h-6" />
                    {subjects.length === 0 ? "Crear mi primera asignatura" : "Crear nueva asignatura"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Subject Deletion Confirmation */}
      {subjectToDelete !== null && (
        <div className="fixed inset-0 bg-neutral-900/40 backdrop-blur-md z-[60] flex items-center justify-center p-4">
          <div className="bg-white border border-neutral-200 rounded-[2.5rem] p-10 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mb-8 mx-auto">
              <Trash2 className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-black text-neutral-900 mb-4 text-center tracking-tight">
              Eliminar Asignatura
            </h3>
            <p className="text-neutral-500 mb-10 text-center font-medium leading-relaxed">
              ¿Estás seguro de eliminar esta asignatura y todos sus apuntes?
              Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => setSubjectToDelete(null)}
                title="Cancelar y mantener la asignatura"
                className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDeleteSubject(subjectToDelete)}
                title="Eliminar permanentemente la asignatura y todos sus datos"
                className="flex-1 bg-red-600 hover:bg-red-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-red-500/20 active:scale-95"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Note Deletion Confirmation */}
      {noteToDelete !== null && (
        <div className="fixed inset-0 bg-neutral-900/40 backdrop-blur-md z-[60] flex items-center justify-center p-4">
          <div className="bg-white border border-neutral-200 rounded-[2.5rem] p-10 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mb-8 mx-auto">
              <Trash2 className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-black text-neutral-900 mb-4 text-center tracking-tight">
              Eliminar Apunte
            </h3>
            <p className="text-neutral-500 mb-10 text-center font-medium leading-relaxed">
              ¿Estás seguro de eliminar este apunte? Esta acción no se puede
              deshacer.
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => setNoteToDelete(null)}
                title="Cancelar y mantener el apunte"
                className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDeleteNote(noteToDelete)}
                title="Eliminar permanentemente este apunte"
                className="flex-1 bg-red-600 hover:bg-red-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-red-500/20 active:scale-95"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JSON Import Options Modal */}
      {isImportModalOpen && importedBackupData && (
        <div className="fixed inset-0 bg-neutral-900/40 backdrop-blur-md z-[60] flex items-center justify-center p-4">
          <div className="bg-white border border-neutral-200 rounded-[2.5rem] p-10 max-w-md w-full shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-8 mx-auto">
              <Upload className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-black text-neutral-900 mb-4 text-center tracking-tight">
              {isValidGroupBackup(importedBackupData) ? 'Importar Aula/Grupo' : 'Importar Asignatura'}
            </h3>
            <p className="text-neutral-500 mb-6 text-center font-medium leading-relaxed">
              Se detectó el respaldo de:{' '}
              <strong className="text-neutral-900">
                {isValidGroupBackup(importedBackupData)
                  ? `Aula «${importedBackupData.classGroup.name}» (${importedBackupData.materias.length} materias)`
                  : importedBackupData.subject?.name}
              </strong>
              .
              <br />
              {isValidGroupBackup(importedBackupData)
                ? 'Se restaurarán todas las materias y la lista compartida de participantes.'
                : '¿Cómo deseas realizar la importación?'}
            </p>

            {isImportingLoading ? (
              <div className="flex flex-col items-center justify-center py-6">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-3" />
                <span className="text-sm font-bold text-neutral-500">Importando datos, por favor espera...</span>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <button
                  onClick={() => handleConfirmImport('create')}
                  title="Importar como nueva asignatura o aula"
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
                >
                  {isValidGroupBackup(importedBackupData) ? 'Importar aula completa' : 'Crear como nueva asignatura'}
                </button>

                {selectedSubject && !isValidGroupBackup(importedBackupData) && (
                  <div className="border-t border-neutral-100 pt-4 mt-2">
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
                      <p className="text-[11px] text-amber-700 font-bold leading-normal">
                        ⚠️ ATENCIÓN: Sobrescribir eliminará permanentemente todos los datos actuales de la asignatura &quot;{selectedSubject.name}&quot; antes de importar.
                      </p>
                    </div>
                    <button
                      onClick={() => handleConfirmImport('overwrite')}
                      title="Sobrescribir los datos de la asignatura actual"
                      className="w-full bg-amber-500 hover:bg-amber-400 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
                    >
                      Sobrescribir asignatura actual
                    </button>
                  </div>
                )}

                <button
                  onClick={() => {
                    setIsImportModalOpen(false);
                    setImportedBackupData(null);
                  }}
                  title="Cancelar la importación"
                  className="w-full bg-neutral-100 hover:bg-neutral-200 text-neutral-900 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95 mt-2"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <SubjectModal
        isOpen={isSubjectModalOpen}
        onClose={() => setIsSubjectModalOpen(false)}
        subjectToEdit={subjectToEdit}
        checkCanCreate={checkCanCreate}
        onCreated={handleCreated}
      />

      <Suspense fallback={null}>
        <SettingsModal
          isOpen={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
          initialTab={settingsInitialTab}
        />
      </Suspense>

      {selectedSubjectId && (
        <>
          <NoteModal
            isOpen={isNoteModalOpen}
            onClose={() => setIsNoteModalOpen(false)}
            subjectId={selectedSubjectId}
            moduleId={activeModuleIdForNote}
            noteToEdit={noteToEdit}
          />
        </>
      )}

      <GuidedTour
        run={isTourOpen}
        onClose={handleCloseTour}
        setCurrentView={setCurrentView}
        setActiveTab={setActiveTab}
        isAuthenticated={!!user}
        firstSubjectId={subjects.length > 0 ? subjects[0].id : tourSubjectId}
        onSelectSubject={(id) => setSelectedSubjectId(id)}
      />

      <UserGuide
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        onStartTour={handleStartTour}
      />

      {/* Help / Tour floating button */}
      <button
        id="tour-help-btn"
        onClick={() => setIsGuideOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl shadow-2xl shadow-indigo-500/40 flex items-center justify-center transition-all active:scale-90 hover:scale-110 group"
        title="Guía de uso"
        aria-label="Abrir guía de uso"
      >
        <HelpCircle className="w-6 h-6" />
        <span className="absolute right-16 bg-neutral-900 text-white text-xs font-black px-3 py-1.5 rounded-xl whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none tracking-wide">
          Guía de uso
        </span>
      </button>

      {/* Identificación visual permanente en entorno Staging / RC1 */}
      {import.meta.env.VITE_SHOW_RC1_BADGE === 'true' && (
        <div className="fixed bottom-3 right-3 z-[100] bg-amber-500 text-slate-950 font-black text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-full shadow-lg border border-amber-300 pointer-events-none select-none">
          ENTORNO RC1 — DATOS DE PRUEBA
        </div>
      )}
    </div>
  );
}

function GoogleG({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z" />
    </svg>
  );
}
