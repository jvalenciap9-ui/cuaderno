/**
 * MateriaSelector.tsx — Desplegable de materia dentro de un Aula/Grupo
 * multiasignatura (Calificaciones y Planificación/Apuntes).
 *
 * - Solo se renderiza cuando recibe ≥2 materias de un aula real (las
 *   asignaturas independientes nunca lo ven: cero cambios visuales legacy).
 * - `<select>` nativo: navegable con teclado, etiqueta accesible, móvil-friendly.
 * - El cambio delega en `onSwitch` (cada pestaña valida cambios pendientes
 *   antes de soltarlo hacia App.tsx): nunca descarta notas silenciosamente.
 */

import { BookOpen } from 'lucide-react';
import type { SubjectDoc } from '../types/firestore';

interface MateriaSelectorProps {
  /** Asignatura actualmente abierta o identificador de alcance. */
  currentSubject: SubjectDoc;
  /** Materias hermanas del MISMO aula (≥2 para mostrar el selector). */
  materias: SubjectDoc[];
  /** Solicitud de cambio de materia (la pestaña puede interceptarla). */
  onSwitch: (materiaId: string) => void;
  /** Texto opcional del hint derecho (desktop). */
  hint?: string;
  /** Permite incluir la opción explícita "General · Todas las materias". */
  includeGeneral?: boolean;
  selectedScope?: string;
}

export function MateriaSelector({ currentSubject, materias, onSwitch, hint, includeGeneral, selectedScope }: MateriaSelectorProps) {
  if (materias.length < 2) return null;

  const activeValue = selectedScope === 'general' ? 'general' : String(currentSubject.id);

  return (
    <div className="flex flex-wrap items-center gap-3 bg-white border border-neutral-200 rounded-2xl px-5 py-4 shadow-sm mb-8">
      <div className="flex items-center gap-2.5 min-w-0">
        <BookOpen className="w-4 h-4 text-[var(--institution-primary)] shrink-0" />
        <label
          htmlFor="materia-selector"
          className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] whitespace-nowrap"
        >
          Materia:
        </label>
      </div>
      <select
        id="materia-selector"
        value={activeValue}
        onChange={(e) => onSwitch(e.target.value)}
        aria-label="Materia del aula"
        title="Cambiar de materia dentro de esta aula (participantes y asistencia compartidos; evaluaciones propias de cada materia)"
        className="flex-1 min-w-[180px] max-w-md bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold text-sm cursor-pointer"
      >
        {includeGeneral && (
          <option value="general">
            General · Todas las materias
          </option>
        )}
        {materias.map((m) => (
          <option key={m.id} value={String(m.id)}>
            {m.name}
          </option>
        ))}
      </select>
      {hint && (
        <span className="hidden md:inline text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
          {hint}
        </span>
      )}
    </div>
  );
}
