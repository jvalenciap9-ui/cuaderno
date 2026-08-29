import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Trash2, Plus, Users, ArrowUp, ArrowDown, Info, Sparkles } from "lucide-react";
import {
  trackEvent,
  ANALYTICS_CATEGORIES,
  ANALYTICS_ACTIONS,
} from "../lib/analytics";
import type { SubjectDoc, Periodo, PeriodoKey, NivelEducativo } from '../types/firestore';
import { NIVEL_LABEL, TURNO_LABEL } from '../lib/dashboardFilters';
import { REGLA_PLAN_LABEL, type ReglaPlan } from '../lib/adminApi';
import { useInstitution } from '../hooks/useInstitution';
import { useAuth } from './AuthProvider';
import { usePlan } from '../hooks/usePlan';
import { collection, doc, updateDoc, writeBatch, query, where, getDocs, deleteDoc, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { addSubjectCounterOp } from '../lib/subjectCounter';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
// ── Aula/Grupo multiasignatura ──────────────────────────────────────────────
import {
  createClassGroupWithMaterias,
  validateMateriaNames,
  normalizeName,
  computeAulaDisplayName,
  SUGERENCIAS_MATERIAS,
  MIN_MATERIAS_AULA,
  MAX_MATERIAS_AULA,
  MATERIA_COLORS,
} from '../lib/classGroups';
import { showToast } from '../hooks/useToast';

type SubjectPlan = "otro" | "semanal" | "mensual" | "trimestral" | "cuatrimestral" | "anual_8" | "anual_10";

const PLAN_RULE_TO_SUBJECT: Record<ReglaPlan, SubjectPlan> = {
  semanal: "semanal",
  mensual: "mensual",
  trimestral: "trimestral",
  cuatrimestral: "cuatrimestral",
  anual: "anual_10",
};

interface SubjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjectToEdit?: SubjectDoc | null;
  checkCanCreate?: (modality: 'una' | 'varias') => string | null;
  onCreated?: (result: { kind: 'subject'; subjectId: string } | { kind: 'group'; groupId: string; firstMateriaId: string }) => void;
}

const COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
];

export function SubjectModal({
  isOpen,
  onClose,
  subjectToEdit,
  checkCanCreate,
  onCreated,
}: SubjectModalProps) {
  const { user } = useAuth();
  const { isPro, canMultiSubject } = usePlan();
  const hasMultiAccess = canMultiSubject ?? isPro;
  const { periodos, planRules } = useInstitution();
  
  // ── Campos comunes / legacy ──
  const [name, setName] = useState("");
  const [teacher, setTeacher] = useState("");
  const [schedule, setSchedule] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>("");
  const [nivelEducativo, setNivelEducativo] = useState<NivelEducativo | ''>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [plan, setPlan] = useState<SubjectPlan>("otro");
  const [color, setColor] = useState(COLORS[0]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Estado de Aula/Grupo multiasignatura ──
  const [step, setStep] = useState<1 | 2>(1);
  const [modality, setModality] = useState<'una' | 'varias'>('una');
  const [customAulaName, setCustomAulaName] = useState("");
  const [grado, setGrado] = useState("");
  const [seccion, setSeccion] = useState("");
  const [materiaNames, setMateriaNames] = useState<string[]>(Array(MIN_MATERIAS_AULA).fill(''));
  const [materiaError, setMateriaError] = useState<string | null>(null);

  const isEditing = !!subjectToEdit?.id;

  // Cálculo automático del nombre visible del Aula (Grado + Sección o Nombre personalizado)
  const effectiveAulaName = useMemo(
    () => computeAulaDisplayName(grado, seccion, customAulaName),
    [grado, seccion, customAulaName]
  );

  useEffect(() => {
    if (subjectToEdit) {
      setName(subjectToEdit.name);
      setTeacher(subjectToEdit.teacher || "");
      setSchedule(subjectToEdit.schedule || "");
      setPeriodo(subjectToEdit.periodo || "");
      setNivelEducativo(subjectToEdit.nivelEducativo || "");
      setStartDate(subjectToEdit.startDate || "");
      setEndDate(subjectToEdit.endDate || "");
      setPlan(subjectToEdit.plan || "otro");
      setColor(subjectToEdit.color || COLORS[0]);
    } else {
      setName("");
      setTeacher("");
      setSchedule("");
      setPeriodo("");
      setNivelEducativo("");
      setStartDate("");
      setEndDate("");
      setPlan("otro");
      setColor(COLORS[0]);
    }
    setShowDeleteConfirm(false);
    setStep(1);
    setModality('una');
    setCustomAulaName("");
    setGrado("");
    setSeccion("");
    setMateriaNames(Array(MIN_MATERIAS_AULA).fill(''));
    setMateriaError(null);
  }, [subjectToEdit, isOpen]);

  const showAulaTip = !isEditing && (nivelEducativo === 'inicial' || nivelEducativo === 'primaria');

  // Funciones para manipular la lista de materias (fuente única de verdad)
  const addMateriaRow = () => {
    if (materiaNames.length < MAX_MATERIAS_AULA) {
      setMateriaNames((prev) => [...prev, '']);
      setMateriaError(null);
    }
  };

  const removeMateriaRow = (idx: number) => {
    if (materiaNames.length > MIN_MATERIAS_AULA) {
      setMateriaNames((prev) => prev.filter((_, i) => i !== idx));
      setMateriaError(null);
    }
  };

  const updateMateriaName = (idx: number, val: string) => {
    setMateriaNames((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
    setMateriaError(null);
  };

  const moveMateria = (idx: number, dir: -1 | 1) => {
    setMateriaNames((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const addSuggested = (nombre: string) => {
    setMateriaNames((prev) => {
      const key = (s: string) => normalizeName(s).toLowerCase();
      if (prev.some((p) => key(p) === key(nombre))) return prev;
      const next = [...prev];
      const emptyIdx = next.findIndex((p) => !normalizeName(p));
      if (emptyIdx >= 0) {
        next[emptyIdx] = nombre;
      } else if (next.length < MAX_MATERIAS_AULA) {
        next.push(nombre);
      }
      setMateriaError(null);
      return next;
    });
  };

  // Validación en vivo para retroalimentación accesible
  const materiaValidation = useMemo(
    () => (modality === 'varias' ? validateMateriaNames(materiaNames) : { ok: true }),
    [modality, materiaNames],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || isSubmitting) return;

    // ── Paso 1 → Paso 2 (solo creación multiasignatura) ──
    if (!isEditing && step === 1 && modality === 'varias') {
      if (!hasMultiAccess) {
        showToast('warning', 'Aula Multiasignatura es una función exclusiva de Premium Pro.');
        return;
      }
      const finalName = effectiveAulaName;
      if (!finalName) {
        const err = 'Selecciona el Grado y Sección o escribe un nombre para el Aula.';
        setMateriaError(err);
        showToast('warning', err);
        return;
      }
      const blockReason = checkCanCreate?.('varias') ?? null;
      if (blockReason) {
        showToast('warning', blockReason);
        return;
      }
      setMateriaError(null);
      setStep(2);
      return;
    }

    setIsSubmitting(true);

    try {
      if (isEditing && subjectToEdit.id) {
        // RUTA LEGACY INTACTA: editar asignatura antigua
        await updateDoc(doc(db, 'subjects', subjectToEdit.id), {
          name,
          teacher,
          schedule,
          periodo: periodo || null,
          nivelEducativo: nivelEducativo || null,
          startDate,
          endDate,
          plan,
          color,
        });
        trackEvent(ANALYTICS_CATEGORIES.SUBJECT, ANALYTICS_ACTIONS.EDIT);
      } else if (modality === 'varias' && step === 2) {
        // ── Creación ATÓMICA del Aula/Grupo + sus materias ──
        const validation = validateMateriaNames(materiaNames);
        if (!validation.ok) {
          const errMsg = validation.error || 'Verifica la lista de materias antes de guardar.';
          setMateriaError(errMsg);
          showToast('error', errMsg);
          setIsSubmitting(false);
          return;
        }
        const blockReason = checkCanCreate?.('varias') ?? null;
        if (blockReason) {
          showToast('warning', blockReason);
          setIsSubmitting(false);
          return;
        }
        const finalName = effectiveAulaName || 'Aula Multiasignatura';
        const res = await createClassGroupWithMaterias(user.uid, {
          name: finalName,
          nivelEducativo,
          grado,
          seccion,
          periodo,
          planAcademico: plan,
          teacher,
          schedule,
          materias: validation.names!,
        });
        trackEvent(ANALYTICS_CATEGORIES.SUBJECT, ANALYTICS_ACTIONS.CREATE);
        showToast('success', `Aula «${finalName}» creada con ${validation.names!.length} materias.`);
        onCreated?.({ kind: 'group', groupId: res.groupId, firstMateriaId: res.firstMateriaId });
      } else {
        // ── Creación de UNA materia (ruta legacy idéntica) ──
        const blockReason = checkCanCreate?.('una') ?? null;
        if (blockReason) {
          showToast('warning', blockReason);
          setIsSubmitting(false);
          return;
        }
        const subjectRef = doc(collection(db, 'subjects'));
        const batch = writeBatch(db);
        batch.set(subjectRef, {
          userId: user.uid,
          name,
          teacher,
          schedule,
          periodo: periodo || null,
          nivelEducativo: nivelEducativo || null,
          startDate,
          endDate,
          plan,
          color,
          createdAt: Date.now(),
        });
        await addSubjectCounterOp(batch, user.uid, +1);
        await batch.commit();
        trackEvent(ANALYTICS_CATEGORIES.SUBJECT, ANALYTICS_ACTIONS.CREATE);
        onCreated?.({ kind: 'subject', subjectId: subjectRef.id });
      }
      onClose();
    } catch (error: any) {
      console.error("Error al guardar aula/materia:", error);
      const msg = error?.message || 'No se pudo crear el aula. Comprueba los campos e intenta nuevamente.';
      setMateriaError(msg);
      showToast('error', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const inputCls = "h-11 px-3.5 py-2 text-sm font-medium border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all w-full text-neutral-900 bg-white placeholder:text-neutral-300";
  const labelCls = "block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-1.5";

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-4 bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="bg-white border border-neutral-200 rounded-3xl shadow-2xl w-full max-w-[680px] max-h-[88vh] md:max-h-[85vh] flex flex-col overflow-hidden"
        >
          {/* Encabezado fijo */}
          <div className="flex items-center justify-between p-4 md:p-5 border-b border-neutral-100 shrink-0 bg-white">
            <div>
              <h2 className="text-lg md:text-xl font-black text-neutral-900 tracking-tight">
                {isEditing
                  ? "Editar Asignatura"
                  : step === 1
                    ? "Nueva Asignatura / Aula Multiasignatura"
                    : `Materias de «${effectiveAulaName || 'Aula Multiasignatura'}»`}
              </h2>
              {!isEditing && (
                <p className="text-xs text-neutral-500 font-medium">
                  {step === 1 ? "Paso 1: Datos de configuración" : `Paso 2: ${materiaNames.length} de ${MAX_MATERIAS_AULA} materias en la lista`}
                </p>
              )}
            </div>
            <button
              type="button"
              aria-label="Cerrar"
              title="Cerrar ventana"
              onClick={onClose}
              className="text-neutral-400 hover:text-neutral-900 transition-colors p-2 hover:bg-neutral-50 rounded-xl"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
            {/* Cuerpo desplazable */}
            <div className="p-4 md:p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar bg-white">
              
              {/* ══════════ EDITAR (legacy intacto) ══════════ */}
              {isEditing ? (
                <>
                  <div>
                    <label className={labelCls}>Nombre de la Asignatura</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={inputCls}
                      placeholder="Ej. Matemáticas Avanzadas"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Profesor/a</label>
                    <input
                      type="text"
                      required
                      value={teacher}
                      onChange={(e) => setTeacher(e.target.value)}
                      className={inputCls}
                      placeholder="Ej. Dra. García"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Horario</label>
                    <input
                      type="text"
                      required
                      value={schedule}
                      onChange={(e) => setSchedule(e.target.value)}
                      className={inputCls}
                      placeholder="Ej. Lunes y Miércoles 10:00 AM"
                    />
                  </div>
                </>
              ) : /* ══════════ PASO 1: DATOS DEL AULA ══════════ */
              step === 1 ? (
                <>
                  <div className="bg-[#F0F7F4] border border-[#1A3C40]/10 rounded-2xl p-4">
                    <div className="flex items-start gap-3">
                      <Users className="w-5 h-5 text-[#1A3C40] shrink-0 mt-0.5" />
                      <p className="text-xs font-semibold text-[#1A3C40] leading-relaxed">
                        Un <strong>Aula Multiasignatura</strong> comparte participantes y asistencia diaria entre varias materias. Las evaluaciones y calificaciones se manejan de forma aislada por cada materia.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>Nivel Educativo</label>
                    <select
                      value={nivelEducativo}
                      onChange={(e) => setNivelEducativo(e.target.value as NivelEducativo | '')}
                      className={inputCls}
                    >
                      <option value="">Sin nivel definido</option>
                      <option value="inicial">{NIVEL_LABEL.inicial}</option>
                      <option value="primaria">{NIVEL_LABEL.primaria}</option>
                      <option value="secundaria">{NIVEL_LABEL.secundaria}</option>
                      <option value="universidad">{NIVEL_LABEL.universidad}</option>
                    </select>
                  </div>

                  {showAulaTip && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                      <div className="flex items-start gap-3">
                        <Sparkles className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-xs font-black text-neutral-800 leading-snug">
                            Docente de aula: varias materias con los mismos estudiantes.
                          </p>
                          <p className="text-xs text-neutral-500 font-medium mt-0.5">
                            Recomendación para {NIVEL_LABEL[nivelEducativo as 'inicial' | 'primaria']}. Si eres especialista, elige «Una materia».
                          </p>
                        </div>
                        {modality !== 'varias' && (
                          <button
                            type="button"
                            onClick={() => setModality('varias')}
                            title="Seleccionar modalidad Varias materias"
                            className="shrink-0 bg-neutral-900 hover:bg-neutral-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-colors min-h-[36px]"
                          >
                            Elegir
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className={labelCls}>Modalidad</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {([
                        { id: 'una', title: 'Una materia', desc: 'Docente especialista (un grupo por materia)' },
                        { id: 'varias', title: 'Varias materias', desc: 'Docente de aula (mismos participantes)', proBadge: true },
                      ] as const).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setModality(opt.id)}
                          aria-pressed={modality === opt.id}
                          title={`Modalidad: ${opt.title}`}
                          className={`text-left rounded-xl border p-3.5 transition-all min-h-[44px] ${modality === opt.id
                            ? 'border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-500/20'
                            : 'border-neutral-200 bg-neutral-50 hover:bg-white hover:border-indigo-200'}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="block text-xs font-black text-neutral-900">{opt.title}</span>
                            {'proBadge' in opt && (
                              <span className="bg-amber-100 text-amber-800 text-[9px] font-black uppercase px-2 py-0.5 rounded-full border border-amber-200">
                                PRO
                              </span>
                            )}
                          </div>
                          <span className="block text-xs font-medium text-neutral-500 mt-0.5 leading-snug">{opt.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Upsell para plan Gratis si selecciona Varias materias */}
                  {modality === 'varias' && !hasMultiAccess && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <Sparkles className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-black text-amber-900">
                            Aula Multiasignatura · Función Premium Pro
                          </p>
                          <p className="text-xs text-amber-800 font-medium mt-1 leading-relaxed">
                            Organiza varias materias dentro de una misma aula, comparte participantes y asistencia, y mantén las calificaciones separadas. Disponible con Premium Pro.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => setModality('una')}
                          className="px-4 py-2 rounded-xl text-xs font-bold text-neutral-500 hover:text-neutral-900 transition-colors"
                        >
                          Ahora no
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            showToast('info', 'Abre Configuración para conocer las ventajas de Premium Pro.');
                          }}
                          className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-colors shadow-md shadow-amber-500/20"
                        >
                          Ver Premium Pro
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Configuración de Grado y Sección con vista previa unificada */}
                  {modality === 'varias' && (
                    <div className="space-y-3 bg-neutral-50/80 border border-neutral-200 rounded-2xl p-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelCls}>Grado</label>
                          <input
                            type="text"
                            value={grado}
                            onChange={(e) => setGrado(e.target.value)}
                            className={inputCls}
                            placeholder="Ej. 3.º"
                          />
                        </div>
                        <div>
                          <label className={labelCls}>Sección</label>
                          <input
                            type="text"
                            value={seccion}
                            onChange={(e) => setSeccion(e.target.value)}
                            className={inputCls}
                            placeholder="Ej. A"
                          />
                        </div>
                      </div>

                      {/* Vista previa del nombre generado */}
                      <div className="flex items-center justify-between bg-white border border-neutral-200 rounded-xl px-3.5 py-2.5">
                        <span className="text-xs font-bold text-neutral-500">Nombre del Aula:</span>
                        <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg">
                          {effectiveAulaName || 'Ej. 3.º A'}
                        </span>
                      </div>

                      <div>
                        <label className={labelCls}>Nombre personalizado (opcional)</label>
                        <input
                          type="text"
                          value={customAulaName}
                          onChange={(e) => setCustomAulaName(e.target.value)}
                          className={inputCls}
                          placeholder="Ej. Aula Arcoíris (opcional si usas Grado y Sección)"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className={labelCls}>Turno / Periodo</label>
                    <select
                      value={periodo}
                      onChange={(e) => setPeriodo(e.target.value as Periodo)}
                      className={inputCls}
                    >
                      <option value="">Sin periodo definido</option>
                      {(Object.keys(periodos) as PeriodoKey[]).map(key => {
                        const cfg = periodos[key];
                        const disabled = !cfg.activo && periodo !== key;
                        const horario =
                          cfg.activo && cfg.horarioInicio && cfg.horarioFin
                            ? ` · ${cfg.horarioInicio} – ${cfg.horarioFin}`
                            : '';
                        return (
                          <option key={key} value={key} disabled={disabled}>
                            {TURNO_LABEL[key]}{horario}{disabled ? ' (inactivo)' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {planRules.recomendarADocentes && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <p className="text-[10px] font-black text-neutral-500 uppercase tracking-widest">
                            Recomendación Institucional
                          </p>
                          <p className="text-xs font-black text-neutral-800 mt-0.5">
                            {REGLA_PLAN_LABEL[planRules.reglaSeleccionada]}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPlan(PLAN_RULE_TO_SUBJECT[planRules.reglaSeleccionada])}
                          title="Usar plan recomendado"
                          className="bg-neutral-900 hover:bg-neutral-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-colors min-h-[36px]"
                        >
                          Usar
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className={labelCls}>Tipo de Plan / Duración</label>
                    <select
                      value={plan}
                      onChange={(e) => setPlan(e.target.value as SubjectPlan)}
                      className={inputCls}
                    >
                      <option value="otro">Otro / Ninguno</option>
                      <option value="semanal">Plan Semanal</option>
                      <option value="mensual">Plan Mensual</option>
                      <option value="trimestral">Plan Trimestral</option>
                      <option value="cuatrimestral">Plan Cuatrimestral</option>
                      <option value="anual_8">Plan Anual (8 meses)</option>
                      <option value="anual_10">Plan Anual (10 meses)</option>
                    </select>
                  </div>

                  <div>
                    <label className={labelCls}>Profesor/a (opcional)</label>
                    <input
                      type="text"
                      value={teacher}
                      onChange={(e) => setTeacher(e.target.value)}
                      className={inputCls}
                      placeholder="Ej. Prof. Carlos Ruiz"
                    />
                  </div>
                </>
              ) : /* ══════════ PASO 2: MATERIAS DEL AULA ══════════ */
              modality === 'varias' ? (
                <>
                  <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                    <label className="text-xs font-black text-neutral-800 uppercase tracking-wider">
                      Lista de materias
                    </label>
                    <span className="text-xs font-bold bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full border border-indigo-100">
                      {materiaNames.length} de {MAX_MATERIAS_AULA} materias
                    </span>
                  </div>

                  {/* Sugerencias de materias */}
                  <div>
                    <label className="block text-xs font-medium text-neutral-500 mb-2">
                      Sugerencias ({NIVEL_LABEL[(nivelEducativo || 'primaria') as 'inicial' | 'primaria']}) — toca para añadir:
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {SUGERENCIAS_MATERIAS[(nivelEducativo === 'inicial' ? 'inicial' : 'primaria')].map((sug) => (
                        <button
                          key={sug}
                          type="button"
                          onClick={() => addSuggested(sug)}
                          title={`Añadir «${sug}»`}
                          className="inline-flex items-center gap-1 bg-white border border-neutral-200 hover:border-indigo-400 hover:bg-indigo-50 text-neutral-700 px-2.5 py-1 rounded-full text-xs font-semibold transition-all active:scale-95 min-h-[32px]"
                        >
                          <Plus className="w-3 h-3 text-indigo-500" />
                          {sug}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Filas de materias (fuente de verdad directa) */}
                  <div className="space-y-2.5">
                    {materiaNames.map((value, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-neutral-50 p-1.5 rounded-xl border border-neutral-200/60">
                        <span className="w-6 shrink-0 text-center text-xs font-black text-neutral-400">
                          {idx + 1}
                        </span>
                        <span
                          className="w-3.5 h-3.5 rounded-full shrink-0 border border-white shadow-sm"
                          style={{ backgroundColor: MATERIA_COLORS[idx % MATERIA_COLORS.length] }}
                          aria-hidden="true"
                        />
                        <input
                          type="text"
                          value={value}
                          onChange={(e) => updateMateriaName(idx, e.target.value)}
                          required
                          className={`${inputCls} h-10 py-1 text-xs`}
                          placeholder={`Nombre de la materia #${idx + 1}`}
                          aria-label={`Nombre de la materia ${idx + 1}`}
                        />
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => moveMateria(idx, -1)}
                            disabled={idx === 0}
                            aria-label={`Subir materia ${idx + 1}`}
                            title="Subir"
                            className="p-1.5 text-neutral-400 hover:text-neutral-900 disabled:opacity-20 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                          >
                            <ArrowUp className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveMateria(idx, 1)}
                            disabled={idx === materiaNames.length - 1}
                            aria-label={`Bajar materia ${idx + 1}`}
                            title="Bajar"
                            className="p-1.5 text-neutral-400 hover:text-neutral-900 disabled:opacity-20 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                          >
                            <ArrowDown className="w-4 h-4" />
                          </button>
                          {materiaNames.length > MIN_MATERIAS_AULA && (
                            <button
                              type="button"
                              onClick={() => removeMateriaRow(idx)}
                              aria-label={`Quitar materia ${idx + 1}`}
                              title="Quitar esta materia"
                              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}

                    {materiaNames.length < MAX_MATERIAS_AULA && (
                      <button
                        type="button"
                        onClick={addMateriaRow}
                        title="Añadir otra materia"
                        className="w-full flex items-center justify-center gap-2 border border-dashed border-neutral-300 hover:border-indigo-400 hover:bg-indigo-50/50 text-neutral-600 hover:text-indigo-600 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all min-h-[44px]"
                      >
                        <Plus className="w-4 h-4" />
                        Añadir materia
                      </button>
                    )}
                  </div>

                  {/* Mensajes de error específicos con alto contraste */}
                  {(materiaError || (!materiaValidation.ok && materiaValidation.error)) && (
                    <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5 text-xs font-bold text-red-700">
                      <Info className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <p className="flex-1 leading-snug">{materiaError || materiaValidation.error}</p>
                    </div>
                  )}

                  <p className="text-xs text-neutral-400 font-medium px-1 leading-relaxed">
                    Al guardar se creará el aula «{effectiveAulaName || 'Aula Multiasignatura'}» con todas sus materias de una sola vez. Podrás registrar la asistencia diaria una sola vez.
                  </p>
                </>
              ) : /* ══════════ PASO 2b: UNA MATERIA (legacy) ══════════ */
              (
                <>
                  <div>
                    <label className={labelCls}>Nombre de la Asignatura</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={inputCls}
                      placeholder="Ej. Matemáticas Avanzadas"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Horario</label>
                    <input
                      type="text"
                      required
                      value={schedule}
                      onChange={(e) => setSchedule(e.target.value)}
                      className={inputCls}
                      placeholder="Ej. Lunes y Miércoles 10:00 AM"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Fecha Inicio</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Fecha Final</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Color Distintivo</label>
                    <div className="flex flex-wrap gap-2.5 px-1">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setColor(c)}
                          title="Seleccionar este color"
                          className={`w-8 h-8 rounded-full transition-all duration-200 border-2 border-white shadow-sm ${color === c ? "scale-110 shadow-lg ring-2 ring-indigo-500/30" : "hover:scale-105 opacity-70 hover:opacity-100"}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Pie de acciones fijo */}
            <div className="p-4 md:p-5 border-t border-neutral-100 flex justify-between items-center bg-white shrink-0">
              <div>
                {isEditing && !showDeleteConfirm && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    title="Eliminar esta asignatura"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-red-500 hover:bg-red-50 transition-all text-xs font-black uppercase tracking-wider min-h-[44px]"
                  >
                    <Trash2 className="w-4 h-4" />
                    Eliminar
                  </button>
                )}
                {!isEditing && step === 2 && (
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    title="Volver a los datos del aula"
                    className="px-4 py-2.5 rounded-xl text-neutral-500 hover:bg-neutral-100 transition-all text-xs font-black uppercase tracking-wider min-h-[44px]"
                  >
                    ← Atrás
                  </button>
                )}
              </div>

              {showDeleteConfirm ? (
                <div className="flex-1 flex items-center justify-between bg-red-50 p-3 rounded-2xl border border-red-100">
                  <span className="text-xs font-black text-red-600 uppercase tracking-wider">
                    ¿Confirmar eliminación?
                  </span>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="text-xs font-black text-neutral-500 hover:text-neutral-900 transition-colors uppercase"
                    >
                      No
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const id = subjectToEdit!.id!;
                          const batch = writeBatch(db);
                          batch.delete(doc(db, 'subjects', id));

                          const subCollections = ['notes', 'materials', 'subjectModules', 'calendarEvents', 'evaluations', 'students', 'grades', 'attendance'];

                          for (const collName of subCollections) {
                            const q = query(collection(db, collName), where('subjectId', '==', id), where('userId', '==', user?.uid), limit(500));
                            const snapshot = await getDocs(q);
                            snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref));
                          }

                          await addSubjectCounterOp(batch, user!.uid, -1);
                          await batch.commit();

                          trackEvent(
                            ANALYTICS_CATEGORIES.SUBJECT,
                            ANALYTICS_ACTIONS.DELETE,
                          );
                          onClose();
                        } catch (error) {
                          handleFirestoreError(error, OperationType.DELETE, `subjects/${subjectToEdit!.id}`);
                        }
                      }}
                      className="text-xs font-black text-red-600 hover:text-red-700 uppercase"
                    >
                      Sí, eliminar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={onClose}
                    title="Cancelar y cerrar"
                    className="px-4 py-2.5 text-xs font-black text-neutral-400 hover:text-neutral-900 transition-colors uppercase tracking-wider disabled:opacity-50 min-h-[44px]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || (modality === 'varias' && step === 2 && !materiaValidation.ok)}
                    title={
                      isEditing
                        ? 'Guardar la asignatura'
                        : step === 1
                          ? 'Siguiente paso'
                          : 'Crear el Aula Multiasignatura'
                    }
                    className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black transition-all shadow-lg shadow-indigo-500/20 active:scale-95 uppercase tracking-wider text-xs disabled:opacity-50 disabled:scale-100 min-h-[44px]"
                  >
                    {isSubmitting
                      ? 'Guardando...'
                      : !isEditing && step === 1 && modality === 'varias'
                        ? 'Siguiente →'
                        : modality === 'varias'
                          ? `Crear aula (${materiaNames.length} materias)`
                          : 'Guardar'}
                  </button>
                </div>
              )}
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
