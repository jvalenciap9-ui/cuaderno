/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, lazy, Suspense, type FormEvent } from "react";
import { useCustomCollectionData } from "./lib/firestoreUtils";
import { motion } from "motion/react";
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
import { collection, query, where, orderBy, deleteDoc, doc, getDocs, writeBatch, limit } from 'firebase/firestore';
import { db } from './lib/firebase';
import { handleFirestoreError, OperationType } from './lib/firestoreUtils';
import { ToastContainer } from './components/ToastContainer';
import { STORAGE_KEYS, getStorageItem } from './lib/storageKeys';
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
      <>
        <ToastContainer />
        <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-50 px-4">
          <div className="text-center space-y-6 max-w-sm w-full">
            <div className="w-24 h-24 bg-white rounded-[2rem] flex items-center justify-center mx-auto border border-neutral-200 shadow-2xl">
              <BookOpen className="w-10 h-10 text-indigo-600" />
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
              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-4 rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-500/20 active:scale-95 transition-all disabled:opacity-50"
              >
                {authLoading ? 'Cargando...' : isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}
              </button>
            </form>
            <button
              onClick={() => { setIsSignUp(!isSignUp); setAuthError(''); }}
              className="text-sm text-indigo-600 hover:text-indigo-500 font-bold transition-colors"
            >
              {isSignUp ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <ToastContainer />
      <CuadernoApp />
    </>
  );
}

function CuadernoApp() {
  const { user, logOut } = useAuth();
  const [currentView, setCurrentView] = useState<"dashboard" | "subject">(
    "dashboard",
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
  const [subjectToDelete, setSubjectToDelete] = useState<string | null>(null);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);

  useEffect(() => {
    initGA();
  }, []);

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
              <BookOpen className="w-5 h-5" />
            </div>
            <h1 className="font-black text-xl tracking-tight text-neutral-900">
              Mi Cuaderno
            </h1>
          </div>
          <button
            aria-label="Cerrar menú"
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
              <img src="/logo.png" alt="Logo" className="w-12 h-12 object-contain rounded-lg bg-white p-1 shadow-sm" onError={(e) => {
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
      <main className="flex-1 flex flex-col min-w-0 bg-neutral-50 relative overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center gap-4 p-6 border-b border-neutral-200 bg-white shadow-sm">
          <button
            aria-label="Abrir menú"
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
                if (tab) setActiveTab(tab);
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
                      onClick={() => setActiveTab(tab.id)}
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
                  <ModulesTab
                    subjectId={selectedSubject.id!}
                    onOpenNoteModal={(moduleId: string, note: NoteDoc | null) => {
                      setActiveModuleIdForNote(moduleId);
                      setNoteToEdit(note || null);
                      setIsNoteModalOpen(true);
                    }}
                    onDeleteNote={(id: string) => setNoteToDelete(id)}
                  />
                )}
                {activeTab === "grades" && (
                  <GradesTab subjectId={selectedSubject.id!} />
                )}
                {activeTab === "attendance" && (
                  <AttendanceTab subjectId={selectedSubject.id!} />
                )}
                {activeTab === "students" && (
                  <StudentsTab subjectId={selectedSubject.id!} />
                )}
              </motion.div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-8 bg-neutral-50 relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
              <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600 rounded-full blur-[120px]" />
              <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600 rounded-full blur-[120px]" />
            </div>

            <div className="text-center max-w-lg relative z-10">
              <div className="w-28 h-28 bg-white rounded-[2.5rem] flex items-center justify-center mx-auto mb-10 border border-neutral-200 shadow-2xl hover:scale-110 hover:rotate-3 transition-all duration-700 group">
                <BookOpen className="w-12 h-12 text-indigo-600 group-hover:scale-110 transition-transform" />
              </div>
              <h2 className="text-4xl font-black text-neutral-900 mb-6 tracking-tight leading-tight">
                Bienvenido a tu Cuaderno
              </h2>
              <p className="text-neutral-500 mb-12 leading-relaxed text-xl font-medium">
                Organiza tus clases, toma apuntes estructurados y mantén todo tu
                conocimiento en un solo lugar en la nube y de forma segura.
              </p>
              {!loadingSubjects && subjects.length === 0 ? (
                <button
                  onClick={() => setIsSubjectModalOpen(true)}
                  className="inline-flex items-center gap-4 bg-indigo-600 hover:bg-indigo-500 text-white px-10 py-5 rounded-[2rem] font-black transition-all shadow-2xl shadow-indigo-500/40 hover:shadow-indigo-500/60 active:scale-95 uppercase tracking-widest text-sm"
                >
                  <Plus className="w-6 h-6" />
                  Crear mi primera asignatura
                </button>
              ) : (
                <div className="inline-block px-8 py-4 bg-white border border-neutral-200 rounded-3xl shadow-sm text-neutral-400 font-black uppercase tracking-[0.2em] text-[10px] animate-bounce">
                  Selecciona una asignatura para comenzar
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
                className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDeleteSubject(subjectToDelete)}
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
                className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDeleteNote(noteToDelete)}
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
    </div>
  );
}
