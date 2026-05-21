import { ReactNode, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { usePermissions } from './hooks/usePermissions';
import type { RolePermissions } from './config/permissions';
import ErrorBoundary from './components/common/ErrorBoundary';
import RingoLoader from './components/common/RingoLoader';
import Layout from './components/common/Layout';

// ─── Eager imports (small, used on initial load) ─────────────────────────────
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import History from './pages/History';
import NewApplication from './pages/NewApplication';
import ApplicationDetail from './pages/ApplicationDetail';
import Approvals from './pages/Approvals';
import Profile from './pages/Profile';

// ─── Lazy imports (heavy, accessed less often) ───────────────────────────────
// Code-split these so the initial bundle stays light. Each loads on first nav.
const Admin            = lazy(() => import('./pages/Admin'));
const Accounting       = lazy(() => import('./pages/Accounting'));
const ApprovalHistory  = lazy(() => import('./pages/ApprovalHistory'));
const Settlement       = lazy(() => import('./pages/Settlement'));
// DEV-ONLY: i18n editor. Email-gated inside the page. Remove on prod cleanup.
const DevI18n          = lazy(() => import('./pages/DevI18n'));

// Per-route Suspense wrapper. Renders Layout shell so Sidebar stays mounted
// while the lazy chunk downloads — no sidebar blink on first nav to a lazy page.
function LazyRoute({ children, title = '' }: { children: ReactNode; title?: string }) {
  return (
    <Suspense fallback={<Layout title={title}><RingoLoader.Block /></Layout>}>
      {children}
    </Suspense>
  );
}

// ─── ログイン認証ガード ───
function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <RingoLoader.Page />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// ─── 権限チェックガード ───
function RequirePermission({
  check,
  children,
}: {
  check: (perms: RolePermissions) => boolean;
  children: ReactNode;
}) {
  const { role, isAdmin } = useAuth();
  const perms = usePermissions(role, isAdmin);
  if (!check(perms)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

// ─── メインルーティング ───
export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* ダッシュボード */}
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />

        {/* 申請履歴 */}
        <Route path="/history" element={<RequireAuth><History /></RequireAuth>} />

        {/* 新規申請 */}
        <Route path="/applications/new/:templateCode" element={
          <RequireAuth>
            <RequirePermission check={(p) => p.canSubmit}>
              <NewApplication />
            </RequirePermission>
          </RequireAuth>
        } />

        {/* 申請詳細 */}
        <Route path="/applications/:id" element={<RequireAuth><ApplicationDetail /></RequireAuth>} />

        {/* 精算入力 (lazy) — per-route Suspense keeps Sidebar mounted */}
        <Route path="/applications/:id/settlement" element={
          <RequireAuth>
            <RequirePermission check={(p) => p.canSubmit}>
              <LazyRoute><Settlement /></LazyRoute>
            </RequirePermission>
          </RequireAuth>
        } />

        {/* 承認待ち */}
        <Route path="/approvals" element={
          <RequireAuth>
            <RequirePermission check={(p) => p.canApprove}>
              <Approvals />
            </RequirePermission>
          </RequireAuth>
        } />

        {/* プロフィール */}
        <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />

        {/* 精算管理 (lazy — 経理・総務・管理者) */}
        <Route path="/accounting" element={
          <RequireAuth>
            <RequirePermission check={(p) => p.canSettle}>
              <LazyRoute><Accounting /></LazyRoute>
            </RequirePermission>
          </RequireAuth>
        } />

        {/* 承認履歴 (lazy) */}
        <Route path="/approval-history" element={
          <RequireAuth>
            <RequirePermission check={(p) => p.canApprove}>
              <LazyRoute><ApprovalHistory /></LazyRoute>
            </RequirePermission>
          </RequireAuth>
        } />

        {/* 管理画面 (lazy) */}
        <Route path="/admin" element={
          <RequireAuth>
            <RequirePermission check={(p) => p.canAdmin}>
              <LazyRoute><Admin /></LazyRoute>
            </RequirePermission>
          </RequireAuth>
        } />

        {/* DEV-ONLY: i18n editor (email-gated inside page). Remove on prod cleanup. */}
        <Route path="/dev/i18n" element={
          <RequireAuth>
            <LazyRoute><DevI18n /></LazyRoute>
          </RequireAuth>
        } />

        {/* 404 Not Found */}
        <Route path="*" element={<div className="p-8 text-warmgray-800">404 — Not Found</div>} />
      </Routes>
    </ErrorBoundary>
  );
}
