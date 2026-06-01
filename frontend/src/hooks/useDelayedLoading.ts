import { useEffect, useState } from 'react';

/**
 * Returns true only if isLoading is still true after `delayMs`.
 * Fast responses (<delayMs) skip the loader entirely — no flicker.
 */
export function useDelayedLoading(isLoading: boolean, delayMs = 150): boolean {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isLoading) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [isLoading, delayMs]);

  return show;
}
