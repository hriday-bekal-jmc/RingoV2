import { ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { getPermissions } from './config/permissions';
import ErrorBoundary from './components/common/ErrorBoundary';

// ─── ページのインポート ───
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NewApplication from './pages/NewApplication';
import Approvals from './pages/Approvals';
import History from './pages/History';
import ApplicationDetail from './pages/ApplicationDetail';
import Settlement from './pages/Settlement';
import Profile from './pages/Profile';
import Admin from './pages/Admin';
import Accounting from './pages/Accounting';
import ApprovalHistory from './pages/ApprovalHistory';

// ─── ログイン認証ガード ───
function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-100">
        <div className="text-warmgray-600 text-sm">読み込み中...</div>
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// ─── 権限チェックガード ───
function RequirePermission({
  check,
  children,
}: {
  check: (perms: ReturnType<typeof getPermissions>) => boolean;
  children: ReactNode;
}) {
  const { role } = useAuth();
  const perms = getPermissions(role);
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

      {/* 精算入力 */}
      <Route path="/applications/:id/settlement" element={
        <RequireAuth>
          <RequirePermission check={(p) => p.canSubmit}>
            <Settlement />
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

      {/* 精算管理（経理・総務・管理者） */}
      <Route path="/accounting" element={
        <RequireAuth>
          <RequirePermission check={(p) => p.canSettle}>
            <Accounting />
          </RequirePermission>
        </RequireAuth>
      } />

      {/* 承認履歴 */}
      <Route path="/approval-history" element={
        <RequireAuth>
          <RequirePermission check={(p) => p.canApprove}>
            <ApprovalHistory />
          </RequirePermission>
        </RequireAuth>
      } />

      {/* 管理画面 */}
      <Route path="/admin" element={
        <RequireAuth>
          <RequirePermission check={(p) => p.canAdmin}>
            <Admin />
          </RequirePermission>
        </RequireAuth>
      } />

      {/* 404 Not Found */}
      <Route path="*" element={<div className="p-8 text-warmgray-800">404 — Not Found</div>} />
    </Routes>
    </ErrorBoundary>
  );
}