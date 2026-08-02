import type { ReactNode } from 'react';

interface TooltipProps {
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}

export function Tooltip({ text, position = 'top', children }: TooltipProps) {
  const positionClasses: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <div className="relative group inline-flex">
      {children}
      <div
        className={`absolute z-50 px-3 py-1.5 text-[11px] font-black text-white bg-neutral-900 rounded-xl whitespace-nowrap pointer-events-none shadow-lg opacity-0 group-hover:opacity-100 transition-all duration-200 invisible group-hover:visible ${positionClasses[position]}`}
      >
        {text}
      </div>
    </div>
  );
}
