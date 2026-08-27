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
import { collection, doc, updateDoc, writeBatch, query, where, getDocs, deleteDoc, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { addSubjectCounterOp } from '../lib/subjectCounter';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
// ── Aula/Grupo multiasignatura ──────────────────────────────────────────────
import {
  createClassGroupWithMaterias,
  validateMateriaNames,
  normalizeName,
  SUGERENCIAS_MATERIAS,
  MIN_MATERIAS_AULA,
  MAX_MATERIAS_AULA,
  MATERIA_COLORS,
} from '../lib/classGroups';
import { showToast } from '../hooks/useToast';

type SubjectPlan = "otro" | "semanal" | "mensual" | "trimestral" | "cuatrimestral" | "anual_8" | "anual_10";

// Mapea la regla de planificación institucional (planRules.reglaSeleccionada)
// al tipo de plan que ya usa el sistema en subjects.plan. "anual" → anual_10
// (10 meses), la variante más cercana al plan anual completo.
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
  /**
   * Aula/Grupo: validación previa de límites del plan según la modalidad
   * elegida (devuelve el motivo del bloqueo o null si se permite).
   */
  checkCanCreate?: (modality: 'una' | 'varias') => string | null;
  /** Notifica a App qué se creó para navegar al aula/asignatura nueva. */
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
  // Módulo 1 del plan admin: periodos de clase activos y regla de
  // planificación de la institución (solo lectura para docentes).
  const { periodos, planRules } = useInstitution();
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

  // ── Estado del flujo Aula/Grupo (solo CREACIÓN; editar es siempre legacy) ──
  const [step, setStep] = useState<1 | 2>(1);
  const [modality, setModality] = useState<'una' | 'varias'>('una');
  const [aulaName, setAulaName] = useState("");
  const [grado, setGrado] = useState("");
  const [seccion, setSeccion] = useState("");
  const [materiaCount, setMateriaCount] = useState(MIN_MATERIAS_AULA);
  const [materiaNames, setMateriaNames] = useState<string[]>(Array(MIN_MATERIAS_AULA).fill(''));
  const [materiaError, setMateriaError] = useState<string | null>(null);

  const isEditing = !!subjectToEdit?.id;

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
    setAulaName("");
    setGrado("");
    setSeccion("");
    setMateriaCount(MIN_MATERIAS_AULA);
    setMateriaNames(Array(MIN_MATERIAS_AULA).fill(''));
    setMateriaError(null);
  }, [subjectToEdit, isOpen]);

  // Recomendación visible para docentes de aula (Inicial/Primaria). NO es
  // vinculante: los docentes especialistas existen y pueden usar "Una materia".
  const showAulaTip = !isEditing && (nivelEducativo === 'inicial' || nivelEducativo === 'primaria');

  /** Sincroniza el tamaño de la lista de materias conservando lo escrito. */
  const applyMateriaCount = (n: number) => {
    const clamped = Math.max(MIN_MATERIAS_AULA, Math.min(MAX_MATERIAS_AULA, Math.floor(n || MIN_MATERIAS_AULA)));
    setMateriaCount(clamped);
    setMateriaNames((prev) => {
      const next = prev.slice(0, clamped);
      while (next.length < clamped) next.push('');
      return next;
    });
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
      if (emptyIdx >= 0) next[emptyIdx] = nombre;
      else if (next.length < MAX_MATERIAS_AULA) next.push(nombre);
      else return prev;
      setMateriaCount(next.length);
      return next;
    });
  };

  /** Valida en vivo la lista de materias para habilitar Guardar. */
  const materiaValidation = useMemo(
    () => (modality === 'varias' ? validateMateriaNames(materiaNames) : { ok: true }),
    [modality, materiaNames],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || isSubmitting) return;

    // ── Paso 1 → Paso 2 (solo creación multiasignatura) ──
    if (!isEditing && step === 1 && modality === 'varias') {
      if (!normalizeName(aulaName)) {
        showToast('warning', 'Ponle un nombre al Aula/Grupo (ej. «3.º A»).');
        return;
      }
      const blockReason = checkCanCreate?.('varias') ?? null;
      if (blockReason) {
        showToast('warning', blockReason);
        return;
      }
      setStep(2);
      return;
    }

    setIsSubmitting(true);

    try {
      if (isEditing && subjectToEdit.id) {
        // RUTA LEGACY INTACTA: editar asignatura antigua exactamente como antes.
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
          setMateriaError(validation.error || 'Lista de materias inválida.');
          setIsSubmitting(false);
          return;
        }
        const blockReason = checkCanCreate?.('varias') ?? null;
        if (blockReason) {
          showToast('warning', blockReason);
          setIsSubmitting(false);
          return;
        }
        const res = await createClassGroupWithMaterias(user.uid, {
          name: aulaName,
          nivelEducativo,
          grado,
          seccion,
          periodo,
          planAcademico: plan,
          teacher,
          schedule,
          materias: materiaNames,
        });
        trackEvent(ANALYTICS_CATEGORIES.SUBJECT, ANALYTICS_ACTIONS.CREATE);
        showToast('success', `Aula «${normalizeName(aulaName)}» creada con ${validation.names!.length} materias. Los participantes y la asistencia se comparten entre todas.`);
        onCreated?.({ kind: 'group', groupId: res.groupId, firstMateriaId: res.firstMateriaId });
      } else {
        // ── Creación de UNA materia (ruta legacy idéntica: sin documento de aula) ──
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
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'subjects');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const inputCls = "w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold placeholder:text-neutral-300";
  const labelCls = "block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1";

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white border border-neutral-200 rounded-[2.5rem] shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between p-8 border-b border-neutral-100 shrink-0">
            <h2 className="text-2xl font-black text-neutral-900 tracking-tight">
              {isEditing
                ? "Editar Asignatura"
                : step === 1
                  ? "Nueva Asignatura · Aula/Grupo"
                  : `Materias de «${normalizeName(aulaName)}»`}
            </h2>
            <button
              type="button"
              aria-label="Cerrar"
              title="Cerrar ventana"
              onClick={onClose}
              className="text-neutral-400 hover:text-neutral-900 transition-colors p-2 hover:bg-neutral-50 rounded-xl"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex flex-col flex-1 overflow-hidden"
          >
            <div className="p-8 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
              {/* ══════════ EDITAR (legacy intacto) ══════════ */}
              {isEditing ? (
                <>
                  {/* ...campos clásicos tal cual... */}
                  <div>
                    <label className={labelCls}>
                      Nombre de la Asignatura
                    </label>
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
                    <label className={labelCls}>
                      Profesor/a
                    </label>
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
                    <label className={labelCls}>
                      Horario
                    </label>
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
              ) : /* ══════════ PASO 1: DATOS DEL AULA/GRUPO ══════════ */
              step === 1 ? (
                <>
                  <div className="bg-[#F0F7F4] border border-[#1A3C40]/10 rounded-2xl px-5 py-4">
                    <div className="flex items-start gap-3">
                      <Users className="w-5 h-5 text-[#1A3C40] shrink-0 mt-0.5" />
                      <p className="text-xs font-bold text-[#1A3C40] leading-relaxed">
                        Un <strong>Aula/Grupo</strong> agrupa varias materias con los <strong>mismos participantes</strong>: importas la lista una vez y registras la asistencia una vez al día. Las evaluaciones y calificaciones siguen siendo propias de cada materia.
                      </p>
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>
                      Nombre del Aula/Grupo
                    </label>
                    <input
                      type="text"
                      required
                      value={aulaName}
                      onChange={(e) => setAulaName(e.target.value)}
                      className={inputCls}
                      placeholder="Ej. 3.º A"
                    />
                  </div>

                  <div>
                    <label className={labelCls}>
                      Nivel Educativo
                    </label>
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
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
                      <div className="flex items-start gap-3">
                        <Sparkles className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-black text-neutral-800 leading-snug">
                            Docente de aula — varias materias con los mismos participantes.
                          </p>
                          <p className="text-[11px] text-neutral-500 font-medium mt-1">
                            Recomendación para {NIVEL_LABEL[nivelEducativo as 'inicial' | 'primaria']}. Puedes elegir «Una materia» si eres docente especialista.
                          </p>
                        </div>
                        {modality !== 'varias' && (
                          <button
                            type="button"
                            onClick={() => setModality('varias')}
                            title="Seleccionar la modalidad Varias materias (puedes cambiarla)"
                            className="shrink-0 bg-neutral-900 hover:bg-neutral-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
                          >
                            Elegir
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className={labelCls}>
                      Modalidad
                    </label>
                    <div className="grid grid-cols-1 gap-3">
                      {([
                        { id: 'una', title: 'Una materia', desc: 'Docente especialista: un grupo propio por asignatura.' },
                        { id: 'varias', title: 'Varias materias', desc: 'Docente de aula: mismos participantes y asistencia única.' },
                      ] as const).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setModality(opt.id)}
                          aria-pressed={modality === opt.id}
                          title={`Modalidad: ${opt.title}`}
                          className={`text-left rounded-2xl border px-5 py-4 transition-all ${modality === opt.id
                            ? 'border-indigo-500 bg-indigo-50/60 ring-4 ring-indigo-500/5'
                            : 'border-neutral-200 bg-neutral-50 hover:bg-white hover:border-indigo-200'}`}
                        >
                          <span className="block text-sm font-black text-neutral-900">{opt.title}</span>
                          <span className="block text-[11px] font-medium text-neutral-500 mt-0.5">{opt.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>
                        Grado
                      </label>
                      <input
                        type="text"
                        value={grado}
                        onChange={(e) => setGrado(e.target.value)}
                        className={inputCls}
                        placeholder="Ej. 3er grado"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>
                        Sección
                      </label>
                      <input
                        type="text"
                        value={seccion}
                        onChange={(e) => setSeccion(e.target.value)}
                        className={inputCls}
                        placeholder="Ej. A"
                      />
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>
                      Turno
                    </label>
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
                    <p className="text-[11px] text-neutral-400 font-medium mt-2 px-1">
                      Los periodos desactivados por tu institución aparecen bloqueados.
                    </p>
                  </div>

                  {planRules.recomendarADocentes && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <p className="text-[10px] font-black text-neutral-500 uppercase tracking-[0.2em]">
                            Recomendación de tu institución
                          </p>
                          <p className="text-sm font-black text-neutral-800 mt-1">
                            {REGLA_PLAN_LABEL[planRules.reglaSeleccionada]}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPlan(PLAN_RULE_TO_SUBJECT[planRules.reglaSeleccionada])}
                          title="Usar el plan recomendado por tu institución"
                          className="inline-flex items-center gap-2 bg-neutral-900 hover:bg-neutral-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
                        >
                          Usar recomendación
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className={labelCls}>
                      Tipo de Plan / Duración
                    </label>
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
                    <label className={labelCls}>
                      Profesor/a (opcional, se aplica a todas las materias)
                    </label>
                    <input
                      type="text"
                      value={teacher}
                      onChange={(e) => setTeacher(e.target.value)}
                      className={inputCls}
                      placeholder="Ej. Dra. García"
                    />
                  </div>
                </>
              ) : /* ══════════ PASO 2a: MATERIAS DEL AULA (modalidad varias) ══════════ */
              modality === 'varias' ? (
                <>
                  <div>
                    <label className={labelCls}>
                      Cantidad de materias (mínimo {MIN_MATERIAS_AULA})
                    </label>
                    <input
                      type="number"
                      min={MIN_MATERIAS_AULA}
                      max={MAX_MATERIAS_AULA}
                      required
                      value={materiaCount}
                      onChange={(e) => applyMateriaCount(Number(e.target.value))}
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>
                      Materias sugeridas ({NIVEL_LABEL[(nivelEducativo || 'primaria') as 'inicial' | 'primaria']}) — toca para añadir; puedes escribir otras
                    </label>
                    <div className="flex flex-wrap gap-2 px-1">
                      {SUGERENCIAS_MATERIAS[(nivelEducativo === 'inicial' ? 'inicial' : 'primaria')].map((sug) => (
                        <button
                          key={sug}
                          type="button"
                          onClick={() => addSuggested(sug)}
                          title={`Añadir «${sug}» a la lista`}
                          className="inline-flex items-center gap-1.5 bg-white border border-neutral-200 hover:border-indigo-400 hover:bg-indigo-50 text-neutral-600 px-3 py-1.5 rounded-full text-[11px] font-bold transition-all active:scale-95"
                        >
                          <Plus className="w-3 h-3" />
                          {sug}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {materiaNames.map((value, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="w-6 shrink-0 text-center text-[10px] font-black text-neutral-400">
                          {idx + 1}
                        </span>
                        <span
                          className="w-4 h-4 rounded-full shrink-0 border-2 border-white shadow-sm"
                          style={{ backgroundColor: MATERIA_COLORS[idx % MATERIA_COLORS.length] }}
                          aria-hidden="true"
                        />
                        <input
                          type="text"
                          value={value}
                          onChange={(e) => {
                            const next = [...materiaNames];
                            next[idx] = e.target.value;
                            setMateriaNames(next);
                          }}
                          required
                          className={`${inputCls} py-3`}
                          placeholder={`Nombre de la materia #${idx + 1}`}
                          aria-label={`Nombre de la materia ${idx + 1}`}
                        />
                        <div className="flex flex-col gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => moveMateria(idx, -1)}
                            disabled={idx === 0}
                            aria-label={`Subir materia ${idx + 1}`}
                            title="Subir"
                            className="p-1 text-neutral-300 hover:text-neutral-900 disabled:opacity-30 transition-colors"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveMateria(idx, 1)}
                            disabled={idx === materiaNames.length - 1}
                            aria-label={`Bajar materia ${idx + 1}`}
                            title="Bajar"
                            className="p-1 text-neutral-300 hover:text-neutral-900 disabled:opacity-30 transition-colors"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {materiaNames.length > MIN_MATERIAS_AULA && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = materiaNames.filter((_, i) => i !== idx);
                              setMateriaNames(next);
                              setMateriaCount(next.length);
                            }}
                            aria-label={`Quitar materia ${idx + 1}`}
                            title="Quitar esta materia"
                            className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    {materiaNames.length < MAX_MATERIAS_AULA && (
                      <button
                        type="button"
                        onClick={() => applyMateriaCount(materiaNames.length + 1)}
                        title="Añadir otra materia"
                        className="w-full flex items-center justify-center gap-2 border border-dashed border-neutral-300 hover:border-indigo-400 hover:bg-indigo-50/40 text-neutral-500 hover:text-indigo-600 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all active:scale-[0.99]"
                      >
                        <Plus className="w-4 h-4" />
                        Añadir materia
                      </button>
                    )}
                  </div>

                  {!materiaValidation.ok && materiaValidation.error && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
                      <Info className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-xs font-bold text-red-600">{materiaValidation.error}</p>
                    </div>
                  )}

                  <p className="text-[11px] text-neutral-400 font-medium px-1 leading-relaxed">
                    Al guardar se creará el aula «{normalizeName(aulaName)}» con todas sus materias de una sola vez. Podrás importar la lista de participantes una única vez y registrar la asistencia diaria una sola vez.
                  </p>
                </>
              ) : /* ══════════ PASO 2b: UNA MATERIA (legacy) ══════════ */
              (
                <>
                  <div>
                    <label className={labelCls}>
                      Nombre de la Asignatura
                    </label>
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
                    <label className={labelCls}>
                      Horario
                    </label>
                    <input
                      type="text"
                      required
                      value={schedule}
                      onChange={(e) => setSchedule(e.target.value)}
                      className={inputCls}
                      placeholder="Ej. Lunes y Miércoles 10:00 AM"
                    />
                  </div>

                  <div>
                    <label className={labelCls}>
                      Fecha Inicio
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      Fecha Final
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>
                      Color Distintivo
                    </label>
                    <div className="flex flex-wrap gap-3 px-1">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setColor(c)}
                          title="Seleccionar este color"
                          className={`w-10 h-10 rounded-full transition-all duration-300 border-4 border-white shadow-sm ${color === c ? "scale-125 shadow-xl ring-2 ring-indigo-500/20" : "hover:scale-110 opacity-60 hover:opacity-100"}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="p-8 pt-6 flex justify-between items-center border-t border-neutral-100 shrink-0">
              <div>
                {isEditing && !showDeleteConfirm && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    title="Eliminar esta asignatura"
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-red-500 hover:bg-red-50 transition-all text-xs font-black uppercase tracking-widest"
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
                    className="px-4 py-2 rounded-xl text-neutral-400 hover:bg-neutral-50 hover:text-neutral-900 transition-all text-xs font-black uppercase tracking-widest"
                  >
                    ← Atrás
                  </button>
                )}
              </div>

              {showDeleteConfirm ? (
                <div className="flex-1 flex items-center justify-between bg-red-50 p-4 rounded-2xl border border-red-100 animate-in fade-in slide-in-from-right-4">
                  <span className="text-xs font-black text-red-600 uppercase tracking-widest">
                    ¿Confirmar?
                  </span>
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      title="Cancelar eliminación"
                      className="text-xs font-black text-neutral-400 hover:text-neutral-900 transition-colors uppercase tracking-widest"
                    >
                      No
                    </button>
                    <button
                      type="button"
                      title="Confirmar eliminación de la asignatura"
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
                      className="text-xs font-black text-red-600 hover:text-red-700 uppercase tracking-widest"
                    >
                      Sí, eliminar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-4">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={onClose}
                    title="Cancelar y cerrar ventana"
                    className="px-6 py-4 text-xs font-black text-neutral-400 hover:text-neutral-900 transition-colors uppercase tracking-widest disabled:opacity-50"
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
                          ? 'Continuar'
                          : 'Crear el Aula/Grupo con todas sus materias'
                    }
                    className="px-10 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-black transition-all shadow-xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest text-xs disabled:opacity-50 disabled:scale-100"
                  >
                    {isSubmitting
                      ? 'Guardando...'
                      : !isEditing && step === 1 && modality === 'varias'
                        ? 'Continuar'
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
