import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import NewApplication from './pages/NewApplication.jsx';
import Approvals from './pages/Approvals.jsx'; // ← 追加

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/applications/new/:templateCode" element={<NewApplication />} />
      
      {/* ↓ 承認待ち画面のルートを追加 */}
      <Route path="/approvals" element={<Approvals />} />
      
      <Route path="*" element={<div className="p-8">404 — Not Found</div>} />
    </Routes>
  );
}