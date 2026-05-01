import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000/api';

/**
 * Connects to the backend SSE stream at /api/events.
 * On any APPROVAL_ACTION or APPLICATION_SUBMITTED event, invalidates
 * the relevant React Query caches so all pages update in real-time
 * without manual refresh.
 *
 * EventSource auto-reconnects on network errors — no extra logic needed.
 */
export function useSSE() {
  const queryClient = useQueryClient();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Avoid duplicate connections (React StrictMode double-invoke)
    if (esRef.current) return;

    const es = new EventSource(`${API_BASE}/events`, { withCredentials: true });
    esRef.current = es;

    const invalidateApprovals = () => {
      queryClient.invalidateQueries({ queryKey: ['pendingApprovals'] });
    };

    const invalidateApps = () => {
      queryClient.invalidateQueries({ queryKey: ['myApplications'] });
    };

    const invalidateAll = () => {
      invalidateApprovals();
      invalidateApps();
    };

    es.addEventListener('APPROVAL_ACTION', invalidateAll);
    es.addEventListener('APPLICATION_SUBMITTED', invalidateAll);

    // Log errors in dev; EventSource will auto-reconnect
    es.onerror = (e) => {
      if (import.meta.env.DEV) console.warn('[SSE] connection error, will retry', e);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [queryClient]);
}
