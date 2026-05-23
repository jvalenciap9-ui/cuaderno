import React, { memo } from 'react';
import { cn } from '../lib/utils';

interface SubjectChipProps {
  id: string;
  name: string;
  color: string;
  onClick?: (id: string) => void;
  className?: string;
}

export const SubjectChip = memo(function SubjectChip({ id, name, color, onClick, className }: SubjectChipProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        if (onClick) {
          e.stopPropagation();
          onClick(id);
        }
      }}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all",
        onClick ? "hover:scale-105 active:scale-95 cursor-pointer shadow-sm" : "cursor-default",
        className
      )}
      style={{
        backgroundColor: `${color}15`,
        color: color,
        border: `1px solid ${color}30`
      }}
    >
      <span 
        className="w-2 h-2 rounded-full shrink-0" 
        style={{ backgroundColor: color }}
      />
      <span className="truncate max-w-[150px]">{name}</span>
    </button>
  );
});
