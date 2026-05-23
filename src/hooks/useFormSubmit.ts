import { useRef, useCallback } from 'react';

export function useFormSubmit() {
  const submittingRef = useRef(false);

  const guard = useCallback(async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (submittingRef.current) return undefined;
    submittingRef.current = true;
    try {
      return await fn();
    } finally {
      submittingRef.current = false;
    }
  }, []);

  return { guard, isSubmitting: submittingRef };
}
