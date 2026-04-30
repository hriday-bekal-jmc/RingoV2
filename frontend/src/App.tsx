import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { getPermissions } from './config/permissions';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NewApplication from './pages/NewApplication';
import Approvals from './pages/Approvals';
import Admin from './pages/Admin';

function RequireAuth({ children }: { children: React.ReactNode }) {
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

function RequirePermission({
  check,
  children,
}: {
  check: (perms: ReturnType<typeof getPermissions>) => boolean;
  children: React.ReactNode;
}) {
  const { role } = useAuth();
  const perms = getPermissions(role);
  if (!check(perms)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      <Route
        path="/dashboard"
        element={<RequireAuth><Dashboard /></RequireAuth>}
      />
      <Route
        path="/applications/new/:templateCode"
        element={
          <RequireAuth>
            <RequirePermission check={(p) => p.canSubmit}>
              <NewApplication />
            </RequirePermission>
          </RequireAuth>
        }
      />
      <Route
        path="/approvals"
        element={
          <RequireAuth>
            <RequirePermission check={(p) => p.canApprove}>
              <Approvals />
            </RequirePermission>
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <RequirePermission check={(p) => p.canAdmin}>
              <Admin />
            </RequirePermission>
          </RequireAuth>
        }
      />

      <Route path="*" element={<div className="p-8 text-warmgray-800">404 — Not Found</div>} />
    </Routes>
  );
}
