import { useEffect, useRef } from 'react';

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip) return;

    let currentTarget: HTMLElement | null = null;
    let hideTimeout: ReturnType<typeof setTimeout>;

    const show = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[title]');
      if (!target || target === currentTarget) return;

      clearTimeout(hideTimeout);
      currentTarget = target;
      const text = target.getAttribute('title') || '';
      if (!text) return;

      target.removeAttribute('title');
      target.dataset.originalTitle = text;

      tooltip.textContent = text;

      const rect = target.getBoundingClientRect();
      const tooltipWidth = 260;
      let left = rect.left + rect.width / 2;
      if (left - tooltipWidth / 2 < 8) left = 8 + tooltipWidth / 2;
      if (left + tooltipWidth / 2 > window.innerWidth - 8) left = window.innerWidth - 8 - tooltipWidth / 2;

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${rect.top - 8}px`;
      tooltip.style.opacity = '1';
      tooltip.style.visibility = 'visible';
    };

    const hide = () => {
      hideTimeout = setTimeout(() => {
        tooltip.style.opacity = '0';
        tooltip.style.visibility = 'hidden';
        if (currentTarget && currentTarget.dataset.originalTitle) {
          currentTarget.setAttribute('title', currentTarget.dataset.originalTitle);
          delete currentTarget.dataset.originalTitle;
        }
        currentTarget = null;
      }, 100);
    };

    document.addEventListener('mouseover', show, true);
    document.addEventListener('mouseout', hide, true);

    return () => {
      document.removeEventListener('mouseover', show, true);
      document.removeEventListener('mouseout', hide, true);
      clearTimeout(hideTimeout);
    };
  }, []);

  return (
    <>
      {children}
      <div
        ref={tooltipRef}
        className="fixed z-[9999] max-w-[260px] px-3 py-2 text-[11px] font-bold text-white bg-neutral-900 rounded-xl shadow-lg pointer-events-none transition-all duration-200 -translate-x-1/2 -translate-y-full leading-relaxed"
        style={{ opacity: 0, visibility: 'hidden' }}
      />
    </>
  );
}
