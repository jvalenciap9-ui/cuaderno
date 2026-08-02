/**
 * subjectCounter.ts — Contador de asignaturas por usuario (línea de defensa de Firestore rules).
 *
 * Las reglas de seguridad no pueden contar documentos en una colección, así que
 * mantenemos un contador atómico en `/userCounters/{uid}` que se escribe en el
 * MISMO batch que crea/borra la asignatura. Las reglas verifican que el contador
 * se haya incrementado exactamente +1 en la misma operación y que no exceda el
 * límite del plan.
 *
 * Política C8 "2 por año natural" (plan free): además de `subjectCount` se
 * llevan `createdThisYear` y `yearKey` (año calendario). Se cuentan las
 * asignaturas CREADAS en el año actual; borrar NO libera cupo del año y un año
 * nuevo reinicia el contador a 1.
 */

import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';

const counterRef = (uid: string) => doc(db, 'userCounters', uid);

export const MAX_FREE_SUBJECTS = 2;

const MAX_WRITES_PER_WINDOW = 120;
const WINDOW_MS = 60000;

function currentYearKey(): string {
  return String(new Date().getFullYear());
}

interface CounterData {
  subjectCount: number;
  createdThisYear: number;
  yearKey: string;
  writes: number;
  writeWindowStart: number;
}

async function getCounterData(uid: string): Promise<CounterData | null> {
  try {
    const snap = await getDoc(counterRef(uid));
    if (snap.exists()) {
      const data = snap.data();
      return {
        subjectCount: typeof data.subjectCount === 'number' && data.subjectCount >= 0 ? data.subjectCount : 0,
        createdThisYear: typeof data.createdThisYear === 'number' && data.createdThisYear >= 0 ? data.createdThisYear : 0,
        yearKey: typeof data.yearKey === 'string' && data.yearKey.length > 0 ? data.yearKey : currentYearKey(),
        writes: typeof data.writes === 'number' && data.writes >= 0 ? data.writes : 0,
        writeWindowStart: typeof data.writeWindowStart === 'number' && data.writeWindowStart > 0 ? data.writeWindowStart : 0,
      };
    }
  } catch {
    // Sin conexión o sin permiso de lectura: asumir 0 para no bloquear al usuario
  }
  return null;
}

/**
 * Lee el contador actual de asignaturas del usuario.
 */
export async function getSubjectCount(uid: string): Promise<number> {
  const data = await getCounterData(uid);
  return data?.subjectCount ?? 0;
}

/**
 * Lee el contador de asignaturas creadas en el año calendario actual.
 */
export async function getSubjectsCreatedThisYear(uid: string): Promise<{ createdThisYear: number; yearKey: string }> {
  const data = await getCounterData(uid);
  return {
    createdThisYear: data?.createdThisYear ?? 0,
    yearKey: data?.yearKey ?? currentYearKey(),
  };
}

/**
 * Añade la operación de actualización del contador a un batch ya creado.
 * `delta` debe ser +1 (crear asignatura) o -1 (borrar asignatura).
 * Llámalo ANTES de hacer commit del batch para que la escritura del contador
 * y la del documento sean atómicas.
 *
 * Además del contador, instrumenta el rate limit M1 de las reglas: escribe
 * `writes`/`writeWindowStart` (ventana de 60s) de forma coherente, incrementando
 * el contador de writes si la ventana sigue activa o reiniciándolo a 1 si venció.
 */
export async function addSubjectCounterOp(batch: import('firebase/firestore').WriteBatch, uid: string, delta: number) {
  const current = await getCounterData(uid);
  const next = Math.max(0, (current?.subjectCount ?? 0) + delta);
  const now = Date.now();
  let writes = 1;
  let writeWindowStart = now;
  if (current && current.writeWindowStart > 0 && current.writeWindowStart + WINDOW_MS > now) {
    writes = current.writes + 1;
    writeWindowStart = current.writeWindowStart;
  }

  const year = currentYearKey();
  let createdThisYear = current?.createdThisYear ?? 0;
  let yearKey = current?.yearKey ?? year;

  if (delta > 0) {
    if (yearKey === year) {
      createdThisYear = createdThisYear + 1;
    } else {
      // Año nuevo: reinicia el contador a 1
      createdThisYear = 1;
      yearKey = year;
    }
  }
  // delta < 0: borrar NO libera cupo del año (createdThisYear/yearKey se preservan)

  batch.set(counterRef(uid), { subjectCount: next, createdThisYear, yearKey, updatedAt: now, writes, writeWindowStart });
  return next;
}
