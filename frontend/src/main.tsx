import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { SidebarProvider } from './context/SidebarContext';
import { SSEProvider } from './providers/SSEProvider';
import './index.css';

/**
 * React Query cache strategy:
 *
 *   - Default gcTime is 2 minutes — most pages don't need long retention since
 *     SSEProvider keeps live data fresh. Heavy paginated lists (Admin Apps,
 *     History infinite queries) override gcTime explicitly to 60s at call
 *     site to free memory faster. Slow-changing reference data (templates,
 *     departments, profile) overrides up to 30 min.
 *
 *   - staleTime 90s globally — request coalescing for rapid nav. SSE
 *     invalidation flips data to stale immediately on real change, so the
 *     90s is purely a guard against ping-pong refetches.
 *
 *   - Persistence: successful queries are serialised to localStorage and
 *     rehydrated on next load so pages render instantly with last-known data
 *     while fresh data fetches in background. maxAge 24h, cleared on logout.
 *     Infinite/paginated queries are excluded (too large, staleness matters).
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 90_000,
      gcTime:    5 * 60 * 1000,   // 5min — longer gcTime needed for persistence to be useful
      retry: (failCount, error: unknown) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status && status >= 400 && status < 500) return false;
        return failCount < 1;
      },
      // SSEProvider drives invalidation — window focus refetch would be noise
      refetchOnWindowFocus: false,
      refetchOnReconnect:   true,
      networkMode:          'online',
    },
    mutations: {
      networkMode: 'online',
    },
  },
});

// Persist dashboard/template/reference queries to localStorage.
// Infinite queries (pagination) and auth-state are excluded — they're either
// too large or contain session-sensitive data handled separately.
const EXCLUDED_PERSIST_KEYS = new Set([
  'approvalHistory', 'adminApps', 'appDetailHistory',
  'historyApps', 'accountingApps',
]);

export const localPersister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'ringo_rq_cache',
});

// Prevent scroll wheel from changing number input values.
// Browser default: focused number input + scroll = value change (silent, confusing).
// Fix: blur the input on wheel so the page scrolls normally instead.
document.addEventListener('wheel', () => {
  const el = document.activeElement as HTMLInputElement | null;
  if (el?.tagName === 'INPUT' && el.type === 'number') el.blur();
}, { passive: true });

// document.getElementById('root') の後ろの "!" は「絶対にnullではない」とTypeScriptに伝えるマークです
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: localPersister,
        maxAge: 24 * 60 * 60 * 1000, // 24h
        buster: 'v2',                  // bump when cache shape changes incompatibly
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            query.state.status === 'success' &&
            !EXCLUDED_PERSIST_KEYS.has(String(query.queryKey[0])),
        },
      }}
    >
      <BrowserRouter>
        <LanguageProvider>
          <SidebarProvider>
            <AuthProvider>
              {/* Single SSE connection — live updates everywhere */}
              <SSEProvider>
                <App />
              </SSEProvider>
            </AuthProvider>
          </SidebarProvider>
        </LanguageProvider>
      </BrowserRouter>
    </PersistQueryClientProvider>
  </React.StrictMode>,
);