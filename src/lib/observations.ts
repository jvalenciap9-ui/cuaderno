/**
 * observations.ts — Capa de datos de observaciones del boletín (boletín v2).
 *
 * Escritura desde el docente (src/components/GradesTab.tsx) y lectura para la
 * vista del boletín consolidado (el admin las obtiene vía Cloud Function
 * `adminGetStudentBoletin` → campo `observations`).
 *
 * - `subjectId === ''` → observación GENERAL del docente consejero.
 * - `subjectId` con valor → observación del docente para ESA asignatura.
 * - `period` es la clave del periodo activo de la institución derivada de
 *   `planRules.reglaSeleccionada` (ver src/lib/planPeriods.ts).
 *
 * Offline-first: se guarda en Firestore (reglas: escritura solo del autor,
 * lectura de la institución) Y en Dexie (tabla `observations`, v14). El id
 * Firestore es determinista (autor + estudiante + asignatura + periodo) para
 * que re-guardar actualice la misma observación.
 */

import { db as dexieDb, type Observation } from './db';
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db as firestore } from './firebase';
import { handleFirestoreError, OperationType } from './firestoreUtils';

export interface ObservationInput {
  userId: string;
  studentId: string;
  /** Id de la asignatura; '' = observación general del docente consejero. */
  subjectId: string;
  period: string;
  text: string;
}

const sanitizeIdPart = (s: string) => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_');

/** Id Firestore determinista de una observación (autor+estudiante+asignatura+periodo). */
export function observationFirestoreId(input: ObservationInput): string {
  const subject = input.subjectId ? sanitizeIdPart(input.subjectId) : 'general';
  return `obs_${sanitizeIdPart(input.userId)}_${sanitizeIdPart(input.studentId)}_${subject}_${sanitizeIdPart(
    input.period,
  )}`.slice(0, 128);
}

const sameRecord = (o: Observation, input: ObservationInput) =>
  o.userId === input.userId &&
  o.studentId === input.studentId &&
  o.subjectId === input.subjectId &&
  o.period === input.period;

/**
 * Guarda (crea o actualiza) una observación en Firestore + Dexie.
 * Devuelve `firestoreOk: false` si Firestore falló (handleFirestoreError ya
 * mostró el toast de error) pero la observación se conservó en Dexie
 * (offline-first). No re-lanza por diseño (la UI continúa).
 */
export async function saveObservation(input: ObservationInput): Promise<{ firestoreOk: boolean }> {
  const updatedAt = Date.now();
  let firestoreOk = true;
  try {
    await setDoc(doc(firestore, 'observations', observationFirestoreId(input)), {
      userId: input.userId,
      studentId: input.studentId,
      subjectId: input.subjectId,
      period: input.period,
      text: input.text,
      updatedAt,
    });
  } catch (err) {
    firestoreOk = false;
    handleFirestoreError(err, OperationType.WRITE, 'observations');
  }
  try {
    const existing = await dexieDb.observations.filter((o) => sameRecord(o, input)).first();
    if (existing?.id) {
      await dexieDb.observations.update(existing.id, { text: input.text, updatedAt });
    } else {
      await dexieDb.observations.add({ ...input, updatedAt });
    }
  } catch (err) {
    console.error('Dexie observations save error:', err);
  }
  return { firestoreOk };
}

/**
 * Carga las observaciones del docente para una asignatura (todas sus
 * observaciones generales + las de cada estudiante). Prioriza Firestore;
 * si no hay conexión, lee la caché de Dexie.
 */
export async function loadObservationsForSubject(
  userId: string,
  subjectId: string,
  studentIds: string[],
): Promise<Record<string, string>> {
  const byKey = (o: Observation) => `${o.studentId}|${o.subjectId || 'general'}|${o.period}`;
  const out: Record<string, string> = {};
  try {
    const snap = await getDocs(
      query(
        collection(firestore, 'observations'),
        where('userId', '==', userId),
        where('subjectId', 'in', ['', subjectId]),
      ),
    );
    snap.docs.forEach((d) => {
      const o = d.data() as Observation;
      if (studentIds.includes(o.studentId)) out[byKey(o)] = o.text;
    });
    // Refresca la caché Dexie con lo que venga de Firestore.
    await dexieDb.observations.bulkPut(
      snap.docs.map((d) => ({ ...(d.data() as Observation) })),
    );
  } catch (err) {
    if (!navigator.onLine) {
      // offline: leer caché local
      const cached = await dexieDb.observations.filter((o) => o.userId === userId).toArray();
      cached.forEach((o) => {
        if (studentIds.includes(o.studentId) && (o.subjectId === '' || o.subjectId === subjectId)) {
          out[byKey(o)] = o.text;
        }
      });
    } else {
      handleFirestoreError(err, OperationType.LIST, 'observations');
    }
  }
  return out;
}
