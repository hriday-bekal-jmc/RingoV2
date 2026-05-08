import { useEffect, useRef } from 'react';

/**
 * Attach an IntersectionObserver to the returned ref div.
 * When the div scrolls into view (within rootMargin), calls onIntersect — but
 * only when `enabled` is true. Uses the "latest callback" pattern so the
 * observer is only recreated when enabled/rootMargin change, not every render.
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

    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) callbackRef.current(); },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, rootMargin]);

  return ref;
}
