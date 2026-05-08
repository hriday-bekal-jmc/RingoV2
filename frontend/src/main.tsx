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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data stays "fresh" for 90s — avoids redundant network hits on nav
      staleTime: 90_000,
      // Keep unused cache for 10 min (fast back-nav, no spinner flash)
      gcTime: 10 * 60 * 1000,
      // Retry once on network error; don't hammer on 4xx
      retry: (failCount, error: unknown) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status && status >= 400 && status < 500) return false;
        return failCount < 1;
      },
      // SSEProvider handles live updates — window focus refetch is noise
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      networkMode: 'online',
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