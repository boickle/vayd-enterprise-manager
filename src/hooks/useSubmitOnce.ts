import { useCallback, useRef } from 'react';

/**
 * Wraps an async submit so a second call while the first is still running is ignored.
 * The in-flight flag is a ref set synchronously, before the first await, so a double
 * click can't slip in while React state (e.g. a disabled button) catches up. (SCH-06)
 */
export function useSubmitOnce<Args extends unknown[]>(
  submit: (...args: Args) => Promise<void>
): (...args: Args) => Promise<void> {
  const inFlightRef = useRef(false);
  const submitRef = useRef(submit);
  submitRef.current = submit;

  return useCallback(async (...args: Args) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await submitRef.current(...args);
    } finally {
      inFlightRef.current = false;
    }
  }, []);
}
