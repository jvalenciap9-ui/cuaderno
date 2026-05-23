/**
 * ToastContainer.tsx — Contenedor visual de notificaciones
 * Se monta una sola vez en App.tsx (esquina inferior derecha).
 */

import React from 'react';
import { useToastStore, ToastType } from '../hooks/useToast';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '../lib/utils';

const CONFIG: Record<ToastType, { icon: React.ElementType; bg: string; border: string; text: string; iconColor: string }> = {
  success: {
    icon: CheckCircle,
    bg: 'bg-white',
    border: 'border-emerald-200',
    text: 'text-neutral-800',
    iconColor: 'text-emerald-500',
  },
  error: {
    icon: XCircle,
    bg: 'bg-white',
    border: 'border-red-200',
    text: 'text-neutral-800',
    iconColor: 'text-red-500',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-white',
    border: 'border-amber-200',
    text: 'text-neutral-800',
    iconColor: 'text-amber-500',
  },
  info: {
    icon: Info,
    bg: 'bg-white',
    border: 'border-indigo-200',
    text: 'text-neutral-800',
    iconColor: 'text-indigo-500',
  },
};

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[999] flex flex-col gap-3 max-w-sm w-full pointer-events-none">
      {toasts.map(toast => {
        const cfg = CONFIG[toast.type];
        const Icon = cfg.icon;

        return (
          <div
            key={toast.id}
            className={cn(
              'flex items-start gap-4 px-5 py-4 rounded-2xl border shadow-2xl shadow-black/10',
              'animate-in slide-in-from-bottom-4 fade-in duration-300',
              'pointer-events-auto',
              cfg.bg, cfg.border
            )}
          >
            <Icon className={cn('w-5 h-5 mt-0.5 shrink-0', cfg.iconColor)} />
            <p className={cn('flex-1 text-sm font-semibold leading-snug', cfg.text)}>
              {toast.message}
            </p>
            <button
              onClick={() => dismiss(toast.id)}
              className="shrink-0 text-neutral-300 hover:text-neutral-600 transition-colors mt-0.5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
