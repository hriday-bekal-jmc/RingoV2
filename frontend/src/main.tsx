import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 90_000,
      gcTime:    2 * 60 * 1000,   // 2min default — call sites override as needed
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

// document.getElementById('root') の後ろの "!" は「絶対にnullではない」とTypeScriptに伝えるマークです
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  </React.StrictMode>,
);