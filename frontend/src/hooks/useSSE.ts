// DEPRECATED — SSEProvider (mounted at app root in main.tsx) owns the single
// EventSource connection. Do NOT re-introduce this hook; calling it inside
// Layout would open a SECOND connection per page, doubling /api/events
// traffic and React Query invalidations.
//
// Kept as a stub for safety so any stale import still type-checks.
// All cache invalidation now lives in SSEProvider with per-event-type
// debouncing — see src/providers/SSEProvider.tsx.

export function useSSE(): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(
      '[useSSE] deprecated — SSEProvider already handles the connection. ' +
      'Remove this call to avoid duplicate /api/events streams.',
    );
  }
}
