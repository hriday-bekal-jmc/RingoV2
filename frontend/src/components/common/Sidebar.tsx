import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getPermissions } from '../../config/permissions';

export default function Sidebar() {
  const { user } = useAuth();
  const perms = getPermissions(user?.role);

  return (
    <aside className="w-56 bg-ringo-700 text-cream-50 min-h-screen flex flex-col">
      <div className="px-6 py-6 border-b border-ringo-800">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-cream-50 text-ringo-700 font-bold">R</span>
          <span className="text-xl font-bold tracking-wide">リンゴ</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {perms.navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/dashboard'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-ringo-800 text-white'
                  : 'text-cream-100 hover:bg-ringo-800/50'
              }`
            }
          >
            <span className="text-base w-5 text-center">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Role badge */}
      <div className="px-6 py-4 border-t border-ringo-800 space-y-1">
        <div className="text-xs font-semibold text-cream-200/90">{perms.label}</div>
        <div className="text-xs text-cream-200/50">RINGO v0.1</div>
      </div>
    </aside>
  );
}
