/**
 * SSEProvider — single persistent SSE connection for the whole app.
 *
 * One EventSource per browser tab, regardless of how many pages are mounted.
 * Invalidates React Query caches on every relevant event so all pages stay
 * live without manual refresh.
 *
 * Placed inside QueryClientProvider + AuthProvider so it can:
 *   1. Access the QueryClient to call invalidateQueries
 *   2. Only connect when the user is authenticated
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';

// In dev: use relative path so Vite proxy handles auth cookies correctly.
// In prod: VITE_API_BASE_URL must be set to the backend origin (e.g. https://api.ringo.jp/api).
const SSE_URL = import.meta.env.VITE_API_BASE_URL
  ? `${(import.meta.env.VITE_API_BASE_URL as string).replace(/\/api$/, '')}/api/events`
  : '/api/events';

// All query keys that SSE events can affect
const KEYS = {
  approvals:    ['pendingApprovals'],
  myApps:       ['myApplications'],
  accounting:   ['accountingSettlements'],
  routePreview: ['route-preview'],
} as const;

function invalidateApp(qc: ReturnType<typeof useQueryClient>, applicationId?: string) {
  if (applicationId) {
    qc.invalidateQueries({ queryKey: ['application', applicationId] });
  }
}

export function SSEProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    // Already connected — skip (StrictMode double-invoke guard)
    if (esRef.current) return;

    const es = new EventSource(SSE_URL, { withCredentials: true });
    esRef.current = es;

    // ── Event handlers ──────────────────────────────────────────────────────

    const onApprovalAction = (e: MessageEvent) => {
      const data = JSON.parse(e.data ?? '{}') as { applicationId?: string };
      queryClient.invalidateQueries({ queryKey: KEYS.approvals });
      queryClient.invalidateQueries({ queryKey: KEYS.myApps });
      queryClient.invalidateQueries({ queryKey: KEYS.accounting });
      invalidateApp(queryClient, data.applicationId);
    };

    const onAppSubmitted = (e: MessageEvent) => {
      const data = JSON.parse(e.data ?? '{}') as { applicationId?: string };
      queryClient.invalidateQueries({ queryKey: KEYS.approvals });
      queryClient.invalidateQueries({ queryKey: KEYS.myApps });
      queryClient.invalidateQueries({ queryKey: KEYS.accounting });
      invalidateApp(queryClient, data.applicationId);
    };

    const onSettlementAction = (e: MessageEvent) => {
      const data = JSON.parse(e.data ?? '{}') as { applicationId?: string };
      queryClient.invalidateQueries({ queryKey: KEYS.accounting });
      queryClient.invalidateQueries({ queryKey: KEYS.myApps });
      invalidateApp(queryClient, data.applicationId);
    };

    es.addEventListener('APPROVAL_ACTION',       onApprovalAction);
    es.addEventListener('APPLICATION_SUBMITTED',  onAppSubmitted);
    es.addEventListener('SETTLEMENT_ACTION',      onSettlementAction);

    // ── Admin changed THIS user's profile (role / dept / active / password) ─
    // Backend emits via emitToUsers([userId], 'user-state-changed', ...).
    // We re-dispatch as a window CustomEvent so AuthContext can listen
    // without depending on this SSE plumbing directly. AuthContext re-fetches
    // /me on receipt → fingerprint check → invalidates all caches if changed.
    const onUserStateChanged = () => {
      window.dispatchEvent(new CustomEvent('ringo:user-state-changed'));
    };
    es.addEventListener('user-state-changed', onUserStateChanged);

    es.onerror = () => {
      // EventSource auto-reconnects — no manual retry needed.
      // Log in dev only.
      if (import.meta.env.DEV) {
        console.warn('[SSE] connection lost — browser will retry automatically');
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [isAuthenticated, queryClient]);

  return <>{children}</>;
}
