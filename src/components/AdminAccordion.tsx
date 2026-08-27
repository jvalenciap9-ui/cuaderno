import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';

interface AdminAccordionProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  loading?: boolean;
  onExpand?: () => void;
  badge?: string | number;
  /** Modo controlado: si se pasa `open`, el estado lo gestiona el padre. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * AdminAccordion — Sección colapsable del panel administrativo.
 *
 * Animación de altura fluida (300 ms), insignia opcional y carga diferida:
 * los children solo se montan cuando el acordeón está abierto (los datos de
 * cada sección se cargan al expandirla). Soporta modo controlado (open +
 * onOpenChange) para que el dashboard abra secciones desde el onboarding.
 */
export function AdminAccordion({
  title,
  icon,
  children,
  defaultOpen = false,
  loading = false,
  onExpand,
  badge,
  open,
  onOpenChange,
}: AdminAccordionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [isAnimating, setIsAnimating] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');

  const isOpen = open !== undefined ? open : internalOpen;

  useEffect(() => {
    if (!contentRef.current) return;
    if (isOpen) {
      setHeight(contentRef.current.scrollHeight);
      setIsAnimating(true);
      const timer = setTimeout(() => {
        setHeight('auto');
        setIsAnimating(false);
      }, 300);
      return () => clearTimeout(timer);
    }
    setHeight(0);
  }, [isOpen]);

  const toggle = () => {
    if (!isOpen && onExpand) {
      onExpand();
    }
    if (onOpenChange) {
      onOpenChange(!isOpen);
    } else {
      setInternalOpen(!isOpen);
    }
  };

  return (
    <div className="bg-white border border-[#1A3C40]/10 rounded-[2rem] shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-[#F0F7F4]/60"
      >
        <div className="flex items-center gap-3">
          {icon && <span className="w-5 h-5 text-[#1A3C40] shrink-0">{icon}</span>}
          <span className="font-black text-sm text-[#1A3C40] tracking-tight">{title}</span>
          {badge !== undefined && badge !== '' && (
            <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-[#FFC107] text-[#1A3C40] text-[10px] font-black">
              {badge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="w-4 h-4 text-[#1A3C40] animate-spin" />}
          <ChevronDown
            className={`w-4 h-4 text-[#1A3C40]/50 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </button>
      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: isOpen ? (height === 'auto' ? 'none' : `${height}px`) : 0,
          opacity: isOpen ? 1 : 0,
        }}
      >
        <div
          ref={contentRef}
          className="px-6 pb-6 border-t border-[#1A3C40]/10"
          style={{ transform: isOpen ? 'translateY(0)' : 'translateY(-10px)' }}
        >
          {isOpen ? (
            <div className="pt-5">{children}</div>
          ) : (
            <div className="pt-5" style={{ visibility: 'hidden', height: 0, overflow: 'hidden' }} />
          )}
        </div>
      </div>
    </div>
  );
}