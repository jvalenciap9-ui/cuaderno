import { auth } from './firebase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

import { useCollection } from 'react-firebase-hooks/firestore';
import { Query } from 'firebase/firestore';

export function useCustomCollectionData<T = any>(query: Query | null | undefined): [T[], boolean, Error | undefined] {
  const [snapshot, loading, error] = useCollection(query);
  
  if (error) {
    console.error("useCustomCollectionData error: " + (error.message || String(error)));
  }

  const data = snapshot ? snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as T)) : [];
  return [data, loading, error];
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const message = error instanceof Error ? error.message : String(error);
  
  const errInfo: FirestoreErrorInfo = {
    error: message,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));

  // Mostrar mensaje amigable al usuario (no bloquear la UI)
  let userMessage = 'Ocurrió un error al guardar los datos.';
  if (message.includes('permission-denied') || message.includes('PERMISSION_DENIED')) {
    userMessage = 'Sin permisos para realizar esta acción. Verifica tu sesión.';
  } else if (message.includes('unavailable') || message.includes('offline')) {
    userMessage = 'Sin conexión. Los cambios se sincronizarán cuando vuelvas a conectarte.';
  } else if (message.includes('quota-exceeded')) {
    userMessage = 'Límite de uso alcanzado. Intenta más tarde.';
  } else if (message.includes('not-found')) {
    userMessage = 'El elemento no fue encontrado. Puede haber sido eliminado.';
  }

  // Emitir evento para que el ToastContainer lo muestre
  window.dispatchEvent(new CustomEvent('app:toast', { 
    detail: { type: 'error', message: userMessage } 
  }));
  
  // NO re-lanzar — permite que la UI continúe funcionando
}
