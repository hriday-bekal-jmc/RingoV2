import { useEffect, useRef, useState } from 'react';

/**
 * Smart loading gate — prevents both kinds of loader jank:
 *
 *   1. FLASH-ON-FAST-FETCH: if data arrives before `delayMs`, the loader
 *      never shows at all. Sub-200ms responses feel instant, not "loading".
 *
 *   2. FLASH-AND-VANISH: once the loader IS shown, it stays visible for at
 *      least `minDurationMs`. A spinner that appears then disappears 30ms
 *      later reads as a glitch; holding it briefly reads as intentional.
 *
 * Net effect: loaders appear only when genuinely needed, and when they do
 * appear they feel deliberate — never a stutter.
 *
 * Back-compat: existing callers `useDelayedLoading(isLoading)` and
 * `useDelayedLoading(isLoading, 150)` keep working unchanged.
 */
export function useDelayedLoading(
  isLoading: boolean,
  delayMs = 200,
  minDurationMs = 350,
): boolean {
  const [show, setShow] = useState(false);
  // Timestamp (ms) when the loader actually became visible — drives min-duration.
  const shownAtRef = useRef<number | null>(null);
  const delayTimer = useRef<ReturnType<typeof setTimeout>>();
  const hideTimer  = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(delayTimer.current);
    clearTimeout(hideTimer.current);

    if (isLoading) {
      // Wait `delayMs` before revealing — fast fetches skip the loader entirely.
      delayTimer.current = setTimeout(() => {
        shownAtRef.current = performance.now();
        setShow(true);
      }, delayMs);
      return () => { clearTimeout(delayTimer.current); clearTimeout(hideTimer.current); };
    }

    // Loading finished.
    if (shownAtRef.current === null) {
      // Loader never showed (fetch beat the delay) — nothing to hide.
      setShow(false);
      return;
    }

    // Loader is visible — keep it up until min-duration elapses, then hide.
    const elapsed = performance.now() - shownAtRef.current;
    const remaining = Math.max(0, minDurationMs - elapsed);
    hideTimer.current = setTimeout(() => {
      shownAtRef.current = null;
      setShow(false);
    }, remaining);

    return () => { clearTimeout(delayTimer.current); clearTimeout(hideTimer.current); };
  }, [isLoading, delayMs, minDurationMs]);

  return show;
}
