import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function parseLocalDate(dateVal: string | number | Date | null | undefined): Date {
  if (!dateVal) return new Date();
  if (dateVal instanceof Date) return dateVal;
  if (typeof dateVal === 'number') return new Date(dateVal);
  if (typeof dateVal !== 'string') return new Date(dateVal);
  const cleanStr = dateVal.includes('T') ? dateVal : dateVal.replace(/-/g, '/');
  return new Date(cleanStr);
}


export function safeJSONParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value || value === 'undefined') return fallback;
  try {
    const parsed = JSON.parse(value);
    // If fallback is an object and parsed is null, we should use fallback
    if (parsed === null && fallback !== null) return fallback;
    return parsed as T;
  } catch (e) {
    return fallback;
  }
}
