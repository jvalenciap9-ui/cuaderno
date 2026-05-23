import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Trash2 } from "lucide-react";
import { 
  trackEvent,
  ANALYTICS_CATEGORIES,
  ANALYTICS_ACTIONS,
} from "../lib/analytics";
import type { SubjectDoc } from '../types/firestore';
import { useAuth } from './AuthProvider';
import { collection, doc, addDoc, updateDoc, writeBatch, query, where, getDocs, deleteDoc, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';

type SubjectPlan = "otro" | "semanal" | "mensual" | "trimestral" | "cuatrimestral" | "anual_8" | "anual_10";

interface SubjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjectToEdit?: SubjectDoc | null;
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
}: SubjectModalProps) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [teacher, setTeacher] = useState("");
  const [schedule, setSchedule] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [plan, setPlan] = useState<SubjectPlan>("otro");
  const [color, setColor] = useState(COLORS[0]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (subjectToEdit) {
      setName(subjectToEdit.name);
      setTeacher(subjectToEdit.teacher || "");
      setSchedule(subjectToEdit.schedule || "");
      setStartDate(subjectToEdit.startDate || "");
      setEndDate(subjectToEdit.endDate || "");
      setPlan(subjectToEdit.plan || "otro");
      setColor(subjectToEdit.color || COLORS[0]);
    } else {
      setName("");
      setTeacher("");
      setSchedule("");
      setStartDate("");
      setEndDate("");
      setPlan("otro");
      setColor(COLORS[0]);
    }
    setShowDeleteConfirm(false);
  }, [subjectToEdit, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || isSubmitting) return;
    setIsSubmitting(true);
    
    try {
      if (subjectToEdit?.id) {
        await updateDoc(doc(db, 'subjects', subjectToEdit.id), {
          name,
          teacher,
          schedule,
          startDate,
          endDate,
          plan,
          color,
        });
        trackEvent(ANALYTICS_CATEGORIES.SUBJECT, ANALYTICS_ACTIONS.EDIT);
      } else {
        await addDoc(collection(db, 'subjects'), {
          userId: user.uid,
          name,
          teacher,
          schedule,
          startDate,
          endDate,
          plan,
          color,
          createdAt: Date.now(),
        });
        trackEvent(ANALYTICS_CATEGORIES.SUBJECT, ANALYTICS_ACTIONS.CREATE);
      }
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'subjects');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

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
              {subjectToEdit ? "Editar Asignatura" : "Nueva Asignatura"}
            </h2>
            <button
              type="button"
              aria-label="Cerrar"
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
            <div className="p-8 space-y-6 overflow-y-auto flex-1">
              <div>
                <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">
                  Nombre de la Asignatura
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold placeholder:text-neutral-300"
                  placeholder="Ej. Matemáticas Avanzadas"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">
                  Profesor/a
                </label>
                <input
                  type="text"
                  required
                  value={teacher}
                  onChange={(e) => setTeacher(e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold placeholder:text-neutral-300"
                  placeholder="Ej. Dra. García"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">
                  Horario
                </label>
                <input
                  type="text"
                  required
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold placeholder:text-neutral-300"
                  placeholder="Ej. Lunes y Miércoles 10:00 AM"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">
                    Fecha Inicio
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">
                    Fecha Final
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">
                  Tipo de Plan / Duración
                </label>
                <select
                  value={plan}
                  onChange={(e) => setPlan(e.target.value as SubjectPlan)}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-5 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold"
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
                <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-3 px-1">
                  Color Distintivo
                </label>
                <div className="flex flex-wrap gap-3 px-1">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`w-10 h-10 rounded-full transition-all duration-300 border-4 border-white shadow-sm ${color === c ? "scale-125 shadow-xl ring-2 ring-indigo-500/20" : "hover:scale-110 opacity-60 hover:opacity-100"}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="p-8 pt-6 flex justify-between items-center border-t border-neutral-100 shrink-0">
              <div>
                {subjectToEdit && !showDeleteConfirm && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-red-500 hover:bg-red-50 transition-all text-xs font-black uppercase tracking-widest"
                  >
                    <Trash2 className="w-4 h-4" />
                    Eliminar
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
                      className="text-xs font-black text-neutral-400 hover:text-neutral-900 transition-colors uppercase tracking-widest"
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
                    className="px-6 py-4 text-xs font-black text-neutral-400 hover:text-neutral-900 transition-colors uppercase tracking-widest disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-10 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-black transition-all shadow-xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest text-xs disabled:opacity-50 disabled:scale-100"
                  >
                    Guardar
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
