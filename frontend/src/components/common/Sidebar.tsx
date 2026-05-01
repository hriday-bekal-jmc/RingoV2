import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { getPermissions } from '../../config/permissions';
import apiClient from '../../services/apiClient';

// ── Icons ─────────────────────────────────────────────────────────────────────
const ICONS: Record<string, JSX.Element> = {
  '/dashboard': (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M3 4a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 12a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4zM11 4a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V4zM11 12a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
    </svg>
  ),
  '/approvals': (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  ),
  '/accounting': (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
      <path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" />
    </svg>
  ),
  '/history': (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
    </svg>
  ),
  '/admin': (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  ),
};

export default function Sidebar() {
  const { user } = useAuth();
  const perms = getPermissions(user?.role);

  const { data: pendingApprovals } = useQuery<any[]>({
    queryKey: ['pendingApprovals'],
    queryFn: async () => (await apiClient.get('/approvals/pending')).data,
    enabled: perms.canApprove,
    refetchInterval: 60_000,
  });
  const pendingCount = pendingApprovals?.length ?? 0;

  const initial = user?.full_name?.slice(0, 1) ?? '?';

  return (
    <aside className="w-60 min-h-screen flex flex-col select-none shrink-0 glass-dark relative overflow-hidden">
      {/* Decorative glow blob */}
      <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full bg-ringo-400/20 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -right-8 w-32 h-32 rounded-full bg-mustard-500/10 blur-2xl pointer-events-none" />

      {/* Logo */}
      <div className="relative px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-ringo-400 to-ringo-600 flex items-center justify-center shadow-lg">
            <span className="text-white font-bold text-base">R</span>
          </div>
          <div>
            <div className="text-base font-bold tracking-wide text-white">リンゴ</div>
            <div className="text-[10px] text-white/40 font-medium tracking-widest uppercase">Workflow</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="relative flex-1 px-3 py-4 space-y-0.5">
        {perms.navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/dashboard'}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-white/15 text-white shadow-sm'
                  : 'text-white/60 hover:bg-white/10 hover:text-white/90'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 w-0.5 h-6 bg-gradient-to-b from-ringo-300 to-mustard-400 rounded-r-full" />
                )}
                <span className={`transition-colors ${isActive ? 'text-white' : 'text-white/50 group-hover:text-white/80'}`}>
                  {ICONS[item.to] ?? <span className="w-4 h-4 text-xs">{item.icon}</span>}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.to === '/approvals' && pendingCount > 0 && (
                  <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-r from-ringo-500 to-ringo-400 text-white text-[10px] font-bold shadow-sm">
                    {pendingCount > 99 ? '99+' : pendingCount}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div className="relative px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          {user?.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={user.full_name ?? ''}
              className="flex-shrink-0 w-8 h-8 rounded-full object-cover ring-2 ring-white/20"
            />
          ) : (
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-ringo-400 to-mustard-500 flex items-center justify-center text-xs font-bold text-white shadow-md">
              {initial}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white/90 truncate">{user?.full_name ?? '—'}</div>
            <div className="text-[10px] text-white/40">{perms.label}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
