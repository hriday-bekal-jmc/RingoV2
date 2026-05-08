import { useEffect, useRef } from 'react';

/**
 * Attach an IntersectionObserver to the returned ref div.
 * When the div scrolls into view (within rootMargin), calls onIntersect — but
 * only when `enabled` is true. Uses the "latest callback" pattern so the
 * observer is only recreated when enabled/rootMargin change, not every render.
 *
 * Eager-fetch guard:
 *   The observer also fires its FIRST event at mount-time. If the sentinel is
 *   already visible (short list, tall viewport, or generous rootMargin), this
 *   would trigger an unwanted page-2 fetch the moment page-1 finishes loading.
 *
 *   To prevent that, we require the sentinel to be observed AT LEAST ONCE in
 *   the not-intersecting state before any intersect event is allowed to fire
 *   the callback. In practice:
 *     - Sentinel visible at mount → flag stays false → no eager fetch.
 *     - User scrolls → sentinel leaves view → flag flips → next entry fires.
 *     - Sentinel below viewport at mount → first event = not intersecting →
 *       flag flips → real "scrolled to bottom" fires the callback as expected.
 *
 * Usage:
 *   const sentinelRef = useScrollEnd(fetchNextPage, hasNextPage && !isFetchingNextPage);
 *   ...
 *   <div ref={sentinelRef} />
 */
export function useScrollEnd(
  onIntersect: () => void,
  enabled: boolean,
  rootMargin = '200px',
): React.RefObject<HTMLDivElement> {
  const ref          = useRef<HTMLDivElement>(null);
  const callbackRef  = useRef(onIntersect);
  callbackRef.current = onIntersect;   // always latest, no stale closure

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let armed = false;     // becomes true once sentinel has been seen out-of-view

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) {
          // Sentinel is not visible — arm the trigger for the next entry
          armed = true;
          return;
        }
        // Only fire if user actually scrolled (sentinel left view at least once).
        // This blocks the mount-time eager fetch when sentinel is visible at start.
        if (armed) callbackRef.current();
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, rootMargin]);

  return ref;
}
