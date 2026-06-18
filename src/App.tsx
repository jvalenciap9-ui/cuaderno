/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, lazy, Suspense, type FormEvent } from "react";
import { useCustomCollectionData } from "./lib/firestoreUtils";
import { motion } from "motion/react";
import { GuidedTour } from "./components/GuidedTour";
import {
  BookOpen,
  Plus,
  BookMarked,
  Calendar,
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
} from "lucide-react";
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
import type { SubjectDoc, NoteDoc } from "./types/firestore";
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
import { STORAGE_KEYS, getStorageItem, setStorageItem } from './lib/storageKeys';
import { usePlan } from './hooks/usePlan';
import { showToast } from './hooks/useToast';
import { checkGeminiHealth } from './lib/geminiClient';
import { useNetworkStatus } from './hooks/useNetworkStatus';

export default function App() {
  const { user, signIn, signUp, logOut } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);

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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('auth/user-not-found')) {
        setAuthError('No hay cuenta con este email.');
      } else {
        setAuthError('Error al enviar. Verifica el email e intenta de nuevo.');
      }
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
    if (!import.meta.env.DEV) return;
    checkGeminiHealth().then(({ ok, hasKey, error }) => {
      if (!ok) {
        showToast('error', `Servidor IA no disponible: ${error || 'Inicia el servidor con npm run dev:full'}`, 8000);
      } else if (!hasKey) {
        showToast('warning', 'Falta GEMINI_API_KEY en .env.local — La IA no funcionará.', 8000);
      }
    });
  }, []);

  useNetworkStatus();

  if (!user) {
    return (
      <TooltipProvider>
        <ToastContainer />
        <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-50 px-4">
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

  return (
    <TooltipProvider>
      <ToastContainer />
      <CuadernoApp />
    </TooltipProvider>
  );
}

function CuadernoApp() {
  const { user, logOut } = useAuth();
  const { plan: dbPlan, loading: loadingPlan } = usePlan();
  const [currentView, setCurrentView] = useState<"dashboard" | "subject">(
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [tourSubjectId, setTourSubjectId] = useState<string | null>(null);
  const [subjectToDelete, setSubjectToDelete] = useState<string | null>(null);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);

  useEffect(() => {
    initGA();
  }, []);

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
        : `/subject/${selectedSubjectId}/${activeTab}`;
    trackPageView(path);
  }, [currentView, selectedSubjectId, activeTab]);

  const subjectsRef = collection(db, 'subjects');
  const subjectsQuery = user?.uid ? query(subjectsRef, where('userId', '==', user?.uid), limit(500)) : null;
  const [subjects = [], loadingSubjects] = useCustomCollectionData(subjectsQuery);

  const selectedSubject = subjects.find((s) => s.id === selectedSubjectId);

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
        const demoRef = await addDoc(collection(db, 'subjects'), {
          name: 'Mi Asignatura Demo',
          userId: user.uid,
          color: '#4f46e5',
          createdAt: Date.now(),
          plan: 'trimestral',
          teacher: '',
          schedule: '',
        });
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

  const handleNewSubject = () => {
    if (activeSubscription === "free") {
      const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
      const subjectsLastYear = subjects.filter(
        (s) => (s.createdAt || Date.now()) > oneYearAgo,
      );
      if (subjectsLastYear.length >= 3) {
        alert(
          "Has alcanzado el límite de crear 3 asignaturas por año en el plan gratis. Por favor, mejora tu plan en la configuración para crear asignaturas ilimitadas o espera para crear una nueva.",
        );
        return;
      }
    }
    setSubjectToEdit(null);
    setIsSubjectModalOpen(true);
  };

  const handleDeleteSubject = async (id: string) => {
    try {
      // Create a batch
      const batch = writeBatch(db);
      
      batch.delete(doc(db, 'subjects', id));

      const subCollections = ['notes', 'materials', 'subjectModules', 'calendarEvents', 'evaluations', 'students', 'grades', 'attendance'];
      
      for (const collName of subCollections) {
        const q = query(collection(db, collName), where('subjectId', '==', id), where('userId', '==', user?.uid), limit(500));
        const snapshot = await getDocs(q);
        snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
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
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <img src="/logo.webp" alt="Logo" className="app-logo w-5 h-5 object-contain" style={{ filter: 'none', backgroundColor: 'transparent' }} />
            </div>
            <h1 className="font-black text-xl tracking-tight text-neutral-900">
              Mi Cuaderno
            </h1>
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
                ? "bg-indigo-600 text-white shadow-xl shadow-indigo-500/20"
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
                  currentView === "dashboard" ? "text-white" : "text-neutral-400",
                )}
              />
            </div>
            <span className="font-black text-sm uppercase tracking-widest">
              Dashboard
            </span>
          </button>

          <div className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-6 px-4">
            Asignaturas
          </div>

          {!loadingSubjects && subjects.length === 0 ? (
            <div className="text-center px-6 py-12 text-neutral-400 text-sm font-medium italic bg-neutral-50 rounded-3xl border border-dashed border-neutral-200">
              No tienes asignaturas aún.
            </div>
          ) : (
            <div className="space-y-2">
              {subjects.map((subject: SubjectDoc) => (
                <button
                  key={subject.id}
                  title="Seleccionar esta asignatura"
                  onClick={() => {
                    setSelectedSubjectId(subject.id);
                    setCurrentView("subject");
                    setIsSidebarOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all group hover:scale-[1.02] active:scale-95",
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
                        ? "opacity-100 translate-x-0 text-indigo-600"
                        : "opacity-0 -translate-x-4 group-hover:opacity-100 group-hover:translate-x-0",
                    )}
                  />
                </button>
              ))}
            </div>
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
          <button
            id="new-subject-btn"
            onClick={handleNewSubject}
            title="Añadir una nueva asignatura"
            className="w-full flex items-center justify-center gap-3 bg-neutral-900 hover:bg-neutral-800 text-white py-4 rounded-2xl transition-all hover:shadow-2xl active:scale-95 text-sm font-black uppercase tracking-widest"
          >
            <Plus className="w-5 h-5" />
            Nueva Asignatura
          </button>
          <button
            aria-label="Cerrar sesión"
            onClick={logOut}
            title="Cerrar Sessión"
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
        <header className="md:hidden flex items-center gap-4 p-6 border-b border-neutral-200 bg-white shadow-sm">
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
              : selectedSubject
                ? selectedSubject.name
                : "Mi Cuaderno"}
          </span>
        </header>

        {currentView === "dashboard" ? (
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
                      {selectedSubject.plan &&
                        selectedSubject.plan !== "otro" && (
                          <div className="flex items-center gap-2.5 bg-white px-4 py-2 rounded-xl border border-neutral-200 shadow-sm hover:border-indigo-200 transition-colors">
                            <Layers className="w-4 h-4 text-indigo-500" />
                            <span className="font-bold uppercase text-[10px] tracking-widest">
                              {selectedSubject.plan.replace("_", " ")}
                            </span>
                          </div>
                        )}
                      {selectedSubject.teacher && (
                        <div className="flex items-center gap-2.5 bg-white px-4 py-2 rounded-xl border border-neutral-200 shadow-sm hover:border-indigo-200 transition-colors">
                          <User className="w-4 h-4 text-indigo-500" />
                          <span className="font-bold">
                            {selectedSubject.teacher}
                          </span>
                        </div>
                      )}
                      {selectedSubject.schedule && (
                        <div className="flex items-center gap-2.5 bg-white px-4 py-2 rounded-xl border border-neutral-200 shadow-sm hover:border-indigo-200 transition-colors">
                          <Calendar className="w-4 h-4 text-indigo-500" />
                          <span className="font-bold">
                            {selectedSubject.schedule}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="flex items-center gap-2 bg-white p-1.5 rounded-2xl border border-neutral-200 shadow-sm">
                      <button
                        aria-label="Editar asignatura"
                        onClick={() => handleEditSubject(selectedSubject)}
                        className="p-3 text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all active:scale-90"
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
                          ? "border-indigo-600 text-indigo-600"
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
                    />
                  </div>
                )}
                {activeTab === "grades" && (
                  <div id="grades-section">
                    <GradesTab subjectId={selectedSubject.id!} />
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

      <SubjectModal
        isOpen={isSubjectModalOpen}
        onClose={() => setIsSubjectModalOpen(false)}
        subjectToEdit={subjectToEdit}
      />

      <Suspense fallback={null}>
        <SettingsModal
          isOpen={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
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
    </div>
  );
}
