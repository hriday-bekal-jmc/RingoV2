import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import apiClient from '../services/apiClient';

export interface User {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_admin: boolean;
  department_id?: string;
  department_name?: string;
  avatar_url?: string | null;
  daily_allowance_rate?: number | null;
  // Notification preferences
  notify_email:      boolean;
  notify_gchat:      boolean;
  gchat_webhook_url: string | null;
  /** Per-user capability grants beyond role (e.g. ["can_settle"]) */
  cap_overrides?:    string[];
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  role?: string;
  isAdmin: boolean;
  departmentId?: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Safety-net poll. Most updates come via SSE 'user-state-changed' push (instant)
// or visibilitychange refetch (when user comes back to tab). This 30-min poll
// is only there to catch edge cases where SSE silently dropped events.
//
// Why 30 min not 60s: real-time data (apps, approvals, settlements) is already
// covered by other SSE events. /me only catches admin-side role/dept/active
// changes which happen a few times a month. 30 min worst-case latency is fine.
const ME_POLL_MS = 30 * 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Fingerprint = role + department_id. Change → all React Query caches stale.
  const fingerprintRef = useRef<string>('');

  const fetchMe = useCallback(async (isFirstLoad = false) => {
    try {
      // Cold start: index.html kicks off /auth/me in parallel with the JS
      // bundle (window.__ME__). Consume it once instead of re-fetching —
      // saves a full round-trip. null = network error → normal fetch path.
      type PreMe = { ok: boolean; body: { user?: User | null } | null } | null;
      const pre = isFirstLoad
        ? (window as unknown as { __ME__?: Promise<PreMe> }).__ME__
        : undefined;
      if (pre) {
        (window as unknown as { __ME__?: Promise<PreMe> }).__ME__ = undefined;
        const early = await pre;
        if (early !== null) {
          const fresh: User | null = early.ok ? (early.body?.user ?? null) : null;
          fingerprintRef.current = `${fresh?.role ?? ''}|${fresh?.is_admin ? '1' : '0'}|${fresh?.department_id ?? ''}`;
          setUser(fresh);
          return;
        }
        // Network error on the early fetch — fall through to apiClient below.
      }

      const res = await apiClient.get('/auth/me');
      const fresh: User | null = res.data.user ?? null;
      const fp = `${fresh?.role ?? ''}|${fresh?.is_admin ? '1' : '0'}|${fresh?.department_id ?? ''}`;

      if (!isFirstLoad && fingerprintRef.current && fingerprintRef.current !== fp) {
        // Role or department changed while user was logged in.
        // Flush all React Query caches so dept/role-filtered data refetches.
        queryClient.invalidateQueries();
      }

      fingerprintRef.current = fp;
      setUser(fresh);
    } catch {
      setUser(null);
    }
  }, [queryClient]);

  useEffect(() => {
    // Initial load
    fetchMe(true).finally(() => setLoading(false));

    // ── Primary: SSE push ─────────────────────────────────────────────────
    // SSEProvider receives the 'user-state-changed' event from backend and
    // re-dispatches it as a window CustomEvent. We listen here and refetch
    // /me immediately. Means admin changes propagate in ~1s.
    const onSseUserChanged = (): void => { fetchMe(false); };
    window.addEventListener('ringo:user-state-changed', onSseUserChanged);

    // ── Secondary: visibility change ──────────────────────────────────────
    // User returning to tab after being away → refetch in case SSE was
    // disconnected and missed an event.
    const onVisibility = (): void => {
      if (!document.hidden) fetchMe(false);
    };
    document.addEventListener('visibilitychange', onVisibility);

    // ── Backstop: long safety poll ────────────────────────────────────────
    // Catches the rare case where SSE silently dropped events AND the user
    // never switched tabs for 30+ minutes. Only runs on visible tabs.
    const id = setInterval(() => {
      if (!document.hidden) fetchMe(false);
    }, ME_POLL_MS);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('ringo:user-state-changed', onSseUserChanged);
    };
  }, [fetchMe]);

  const logout = async () => {
    await apiClient.post('/auth/logout').catch(() => {});
    queryClient.clear();
    localStorage.removeItem('ringo_rq_cache');
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      setUser,
      logout,
      isAuthenticated: !!user,
      role: user?.role,
      isAdmin: !!user?.is_admin,
      departmentId: user?.department_id,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
