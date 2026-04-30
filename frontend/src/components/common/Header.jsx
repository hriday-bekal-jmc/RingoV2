import { useAuth } from '../../context/AuthContext.jsx';

export default function Header({ title }) {
  const { user } = useAuth();
  const displayName = user?.full_name || 'ゲスト';
  const dept = user?.department_name || '';
  const role = user?.role || '';

  return (
    <header className="bg-cream-50 border-b border-ringo-200 px-8 py-4 flex items-center justify-between">
      <h1 className="text-xl font-bold text-warmgray-800">{title}</h1>
      <div className="flex items-center gap-4">
        <button className="text-warmgray-600 hover:text-ringo-600 relative">
          🔔
        </button>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-ringo-300 flex items-center justify-center text-ringo-800 font-semibold text-sm">
            {displayName.slice(0, 1)}
          </div>
          <div className="text-right leading-tight">
            <div className="text-sm font-semibold text-warmgray-800">{displayName}</div>
            <div className="text-xs text-warmgray-600">{dept} {role && `(${role})`}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
