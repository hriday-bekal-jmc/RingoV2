/**
 * SSEProvider — single persistent SSE connection per browser tab.
 *
 * Backend now uses outbox + Redis pub/sub + targeted recipients, so each
 * event we receive is meant for this user. We map the event to a minimal
 * set of React Query keys and debounce invalidations to coalesce bursts
 * (e.g. submit → approve in quick succession).
 *
 * Why per-event keys + debounce:
 *   - Before: every SSE event invalidated 4 broad keys → 4 refetches per event
 *     even when only one was affected. With multiple events per second, this
 *     thrashed React Query caches and triggered many overlapping HTTP requests.
 *   - Now: each event chooses a small set of keys to invalidate, and a 50ms
 *     debounce batches invalidations across a burst. Result: one refetch per
 *     burst of related events.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';

// In dev: use relative path so Vite proxy handles auth cookies correctly.
// In prod: VITE_API_BASE_URL must be set to the backend origin (e.g. https://api.ringo.jp/api).
const SSE_URL = import.meta.env.VITE_API_BASE_URL
  ? `${(import.meta.env.VITE_API_BASE_URL as string).replace(/\/api$/, '')}/api/events`
  : '/api/events';

// ─── Invalidation key map ────────────────────────────────────────────────────
//
// Each entry returns the React Query keys that should be marked stale for
// the given event. Keys are query-key prefixes (TanStack matches deeply).
// Pick the SMALLEST set that captures real staleness — avoid blanket invalidation.
//
// Why no broad `['myApplications']` invalidation:
//   The dashboard summary endpoint is now its own cached resource. We invalidate
//   it explicitly rather than the old fanned-out keys.
type KeyList = Array<readonly unknown[]>;

interface SubmitPayload    { applicationId?: string; type?: string }
interface ChangePayload    { applicationId?: string; type?: string }
interface ApprovalPayload  { applicationId?: string; type?: string; final?: boolean }
interface SettlementPayload{ applicationId?: string; type?: string }
interface CsvPayload       { jobId?: string }

function keysForApprovalAction(d: ApprovalPayload): KeyList {
  const keys: KeyList = [
    ['dashboard', 'summary'],
    ['dashboard', 'admin-overview'],
    ['pendingApprovals'],
    ['approvalHistory'],
    ['admin', 'applications'],          // admin list view
    ['accountingSettlements'],          // accounting inbox flips when SETTLEMENT step closes / final approval
  ];
  if (d.applicationId) {
    keys.push(['application', d.applicationId]);
    keys.push(['admin', 'application', d.applicationId]); // admin detail modal
    keys.push(['route-preview']);
  }
  // Any approval action (approve/return/reject) changes the app status →
  // invalidate applicant's history list unconditionally, not just on final.
  // Previously guarded by `d.final` which left dashboard dots stale after return.
  keys.push(['myApplications']);
  return keys;
}

function keysForApplicationSubmitted(d: SubmitPayload): KeyList {
  const keys: KeyList = [
    ['dashboard', 'summary'],
    ['dashboard', 'admin-overview'],
    ['myApplications'],
    ['pendingApprovals'],         // approver's inbox flips
    ['admin', 'applications'],    // admin list view
  ];
  if (d.applicationId) {
    keys.push(['application', d.applicationId]);
    keys.push(['admin', 'application', d.applicationId]);
  }
  // Settlement-stage submits affect accounting list. Includes pattern_id=2
  // direct-settlement submits (type='submit') which now create a settlements row.
  keys.push(['accountingSettlements']);
  return keys;
}

function keysForApplicationChanged(d: ChangePayload): KeyList {
  const keys: KeyList = [
    ['dashboard', 'summary'],
    ['dashboard', 'admin-overview'],
    ['myApplications'],
    ['admin', 'applications'],
  ];
  if (d.applicationId) {
    keys.push(['application', d.applicationId]);
    keys.push(['admin', 'application', d.applicationId]);
  }
  return keys;
}

function keysForSettlementAction(d: SettlementPayload): KeyList {
  const keys: KeyList = [
    ['dashboard', 'summary'],
    ['dashboard', 'admin-overview'],
    ['accountingSettlements'],
    ['admin', 'applications'],
  ];
  if (d.applicationId) {
    keys.push(['application', d.applicationId]);
    keys.push(['admin', 'application', d.applicationId]);
  }
  return keys;
}

function keysForCsvReady(_d: CsvPayload): KeyList {
  // Polling component handles UI; SSE just nudges status query to refetch.
  return [['csv-export-status']];
}

function keysForPermissionsUpdated(): KeyList {
  return [['permissions'], ['dashboard', 'summary']];
}

function keysForTemplateUpdated(): KeyList {
  // Invalidate all cached template schemas + the list on dashboard/new-app.
  // ['template'] prefix matches ['template', code] for any code.
  return [['template'], ['templates'], ['dashboard', 'summary']];
}

// ─── Batched invalidation ────────────────────────────────────────────────────
//
// Coalesce all invalidation requests in a 50ms window so a burst of events
// (e.g. user resubmits then immediately gets approved) triggers one batch
// of refetches instead of one per event.

const DEBOUNCE_MS = 50;

function createDebouncedInvalidator(queryClient: QueryClient): {
  enqueue: (keys: KeyList) => void;
  flush:   () => void;
} {
  // Use a Set of stringified keys for dedup; map back to arrays on flush.
  const pending = new Map<string, readonly unknown[]>();
  let timer: number | null = null;

  const flush = (): void => {
    timer = null;
    if (pending.size === 0) return;
    const keys = Array.from(pending.values());
    pending.clear();
    for (const k of keys) {
      queryClient.invalidateQueries({ queryKey: k as unknown[] });
    }
  };

  const enqueue = (keys: KeyList): void => {
    for (const k of keys) {
      pending.set(JSON.stringify(k), k);
    }
    if (timer !== null) return;
    timer = window.setTimeout(flush, DEBOUNCE_MS);
  };

  return { enqueue, flush };
}

export function SSEProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (esRef.current) return; // StrictMode double-invoke guard

    const es = new EventSource(SSE_URL, { withCredentials: true });
    esRef.current = es;

    const debounced = createDebouncedInvalidator(queryClient);

    // ── Event handlers ───────────────────────────────────────────────────
    const onApprovalAction = (e: MessageEvent): void => {
      const data = JSON.parse(e.data ?? '{}') as ApprovalPayload;
      debounced.enqueue(keysForApprovalAction(data));
    };
    const onAppSubmitted = (e: MessageEvent): void => {
      const data = JSON.parse(e.data ?? '{}') as SubmitPayload;
      debounced.enqueue(keysForApplicationSubmitted(data));
    };
    const onAppChanged = (e: MessageEvent): void => {
      const data = JSON.parse(e.data ?? '{}') as ChangePayload;
      debounced.enqueue(keysForApplicationChanged(data));
    };
    const onSettlementAction = (e: MessageEvent): void => {
      const data = JSON.parse(e.data ?? '{}') as SettlementPayload;
      debounced.enqueue(keysForSettlementAction(data));
    };
    const onCsvReady = (e: MessageEvent): void => {
      const data = JSON.parse(e.data ?? '{}') as CsvPayload;
      debounced.enqueue(keysForCsvReady(data));
    };
    const onPermissionsUpdated = (): void => {
      debounced.enqueue(keysForPermissionsUpdated());
    };
    const onTemplateUpdated = (): void => {
      debounced.enqueue(keysForTemplateUpdated());
    };

    es.addEventListener('APPROVAL_ACTION',       onApprovalAction);
    es.addEventListener('APPLICATION_SUBMITTED', onAppSubmitted);
    es.addEventListener('APPLICATION_CHANGED',   onAppChanged);
    es.addEventListener('SETTLEMENT_ACTION',     onSettlementAction);
    es.addEventListener('CSV_EXPORT_READY',      onCsvReady);
    es.addEventListener('PERMISSIONS_UPDATED',   onPermissionsUpdated);
    es.addEventListener('TEMPLATE_UPDATED',      onTemplateUpdated);

    // ── Admin changed THIS user's profile (role / dept / active / password) ─
    // Backend emits via outbox → emitToUsers([userId], 'user-state-changed').
    // Re-dispatch as window CustomEvent so AuthContext can listen without
    // depending directly on the SSE plumbing.
    const onUserStateChanged = (): void => {
      window.dispatchEvent(new CustomEvent('ringo:user-state-changed'));
    };
    es.addEventListener('user-state-changed', onUserStateChanged);

    // On page hide / tab close, flush any pending invalidations so cached
    // state stays consistent if the user returns later.
    const onPageHide = (): void => debounced.flush();
    window.addEventListener('pagehide', onPageHide);

    es.onerror = (): void => {
      // EventSource auto-reconnects (Last-Event-ID carries cursor server-side).
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[SSE] connection lost — browser will retry automatically');
      }
    };

    return () => {
      debounced.flush();
      window.removeEventListener('pagehide', onPageHide);
      es.removeEventListener('PERMISSIONS_UPDATED', onPermissionsUpdated);
      es.removeEventListener('TEMPLATE_UPDATED', onTemplateUpdated);
      es.close();
      esRef.current = null;
    };
  }, [isAuthenticated, queryClient]);

  return <>{children}</>;
}
