import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
