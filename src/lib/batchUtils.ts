/**
 * Utilidades para operaciones en batch con Firestore
 * Reduce escrituras individuales a una sola operación
 * 
 * Beneficio: 30 escrituras = 1 operación (30x más eficiente)
 */

import {
  writeBatch,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  Firestore,
  DocumentReference,
} from 'firebase/firestore';

interface BatchOperation {
  type: 'set' | 'update' | 'delete';
  ref: DocumentReference;
  data?: Record<string, any>;
}

/**
 * Ejecuta múltiples operaciones en un único batch
 * @param db - Instancia de Firestore
 * @param operations - Array de operaciones
 * @returns Promise que resuelve cuando el batch se completa
 */
export async function executeBatch(
  db: Firestore,
  operations: BatchOperation[]
): Promise<void> {
  if (operations.length === 0) return;

  const batch = writeBatch(db);

  operations.forEach((op) => {
    switch (op.type) {
      case 'set':
        if (op.data) batch.set(op.ref, op.data);
        break;
      case 'update':
        if (op.data) batch.update(op.ref, op.data);
        break;
      case 'delete':
        batch.delete(op.ref);
        break;
    }
  });

  await batch.commit();
}

/**
 * Divide operaciones en chunks si superan el límite de Firestore (500 ops por batch)
 * @param db - Instancia de Firestore
 * @param operations - Array de operaciones
 * @returns Promise que resuelve cuando todos los chunks se completan
 */
export async function executeBatchChunked(
  db: Firestore,
  operations: BatchOperation[]
): Promise<void> {
  const CHUNK_SIZE = 400; // Usar 400 para seguridad (límite es 500)

  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const chunk = operations.slice(i, i + CHUNK_SIZE);
    await executeBatch(db, chunk);
  }
}

/**
 * Helper para crear una operación SET
 */
export function createSetOp(
  ref: DocumentReference,
  data: Record<string, any>
): BatchOperation {
  return { type: 'set', ref, data };
}

/**
 * Helper para crear una operación UPDATE
 */
export function createUpdateOp(
  ref: DocumentReference,
  data: Record<string, any>
): BatchOperation {
  return { type: 'update', ref, data };
}

/**
 * Helper para crear una operación DELETE
 */
export function createDeleteOp(ref: DocumentReference): BatchOperation {
  return { type: 'delete', ref };
}

/**
 * Ejemplo de uso:
 * 
 * // Antes (30 operaciones individuales - LENTO):
 * for (const student of students) {
 *   await setDoc(doc(db, 'grades', student.id), { score: 0 });
 * }
 * 
 * // Después (1 operación batch - RÁPIDO):
 * const operations = students.map(s =>
 *   createSetOp(doc(db, 'grades', s.id), { score: 0 })
 * );
 * await executeBatchChunked(db, operations);
 */
