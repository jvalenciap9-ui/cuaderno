/**
 * useToast.ts — Sistema global de notificaciones no-bloqueantes
 * Reemplaza los errores silenciosos y los alert() de la app.
 */

import { useState, useEffect, useCallback } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

// Store global simple (sin Redux/Zustand) 
let listeners: Array<(toasts: Toast[]) => void> = [];
let toastQueue: Toast[] = [];

function notify(toasts: Toast[]) {
  listeners.forEach(fn => fn(toasts));
}

export function showToast(type: ToastType, message: string, duration = 4000) {
  const id = `toast-${Date.now()}-${Math.random()}`;
  const toast: Toast = { id, type, message, duration };
  toastQueue = [...toastQueue, toast];
  notify(toastQueue);

  // Auto-remove
  if (duration > 0) {
    setTimeout(() => {
      toastQueue = toastQueue.filter(t => t.id !== id);
      notify(toastQueue);
    }, duration);
  }
}

export const toast = {
  success: (msg: string, dur?: number) => showToast('success', msg, dur),
  error:   (msg: string, dur?: number) => showToast('error',   msg, dur),
  warning: (msg: string, dur?: number) => showToast('warning', msg, dur),
  info:    (msg: string, dur?: number) => showToast('info',    msg, dur),
};

export function useToastStore() {
  const [toasts, setToasts] = useState<Toast[]>(toastQueue);

  useEffect(() => {
    listeners.push(setToasts);
    return () => {
      listeners = listeners.filter(fn => fn !== setToasts);
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    toastQueue = toastQueue.filter(t => t.id !== id);
    notify(toastQueue);
  }, []);

  return { toasts, dismiss };
}
