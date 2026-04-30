import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/dashboard', label: 'ダッシュボード', icon: '▦' },
  { to: '/applications/new', label: '新規申請', icon: '＋' },
  { to: '/approvals', label: '承認待ち', icon: '🔔' },
  { to: '/history', label: '履歴', icon: '⟲' },
  { to: '/accounting', label: '経理', icon: '▤' },
];

export default function Sidebar() {
  return (
    <aside className="w-56 bg-ringo-700 text-cream-50 min-h-screen flex flex-col">
      <div className="px-6 py-6 border-b border-ringo-800">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-cream-50 text-ringo-700 font-bold">R</span>
          <span className="text-xl font-bold tracking-wide">リンゴ</span>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
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
      <div className="px-6 py-4 text-xs text-cream-200/70 border-t border-ringo-800">
        RINGO v0.1
      </div>
    </aside>
  );
}
