import { useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import { useLang } from '../../context/LanguageContext';
import { getPermissions } from '../../config/permissions';
import apiClient from '../../services/apiClient';

// ── Icon map ──────────────────────────────────────────────────────────────────
const ICONS: Record<string, JSX.Element> = {
  '/dashboard': (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M3 4a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 12a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4zM11 4a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V4zM11 12a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
    </svg>
  ),
  '/approvals': (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  ),
  '/accounting': (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
      <path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" />
    </svg>
  ),
  '/history': (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
    </svg>
  ),
  '/approval-history': (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
      <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm9.707 5.707a1 1 0 00-1.414-1.414L9 12.586l-1.293-1.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  ),
  '/admin': (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  ),
};

// Collapse toggle icon
function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 transition-transform duration-200" style={{ transform: collapsed ? 'rotate(180deg)' : 'none' }}>
      <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

// Map permissions nav key to i18n key
const NAV_I18N: Record<string, string> = {
  '/dashboard':        'nav_dashboard',
  '/approvals':        'nav_approvals',
  '/accounting':       'nav_accounting',
  '/history':          'nav_history',
  '/admin':            'nav_admin',
  '/approval-history': 'nav_approval_history',
};

export default function Sidebar() {
  const { user } = useAuth();
  const { collapsed, toggle, mobileOpen, closeMobile } = useSidebar();
  const { t } = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  const perms = getPermissions(user?.role);

  // Auto-close mobile drawer when route changes
  useEffect(() => { closeMobile(); }, [location.pathname, closeMobile]);

  // Lock body scroll while mobile drawer is open
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mobileOpen]);

  // limit=1 — only need the total count (COUNT(*) OVER() window fn), not the rows.
  // Separate key suffix 'badge' avoids conflict with Approvals page's infinite query.
  const { data: pendingRes } = useQuery<{ total: number }>({
    queryKey: ['pendingApprovals', 'badge'],
    queryFn: async () => (await apiClient.get('/approvals/pending?limit=1&offset=0')).data,
    enabled: perms.canApprove,
    staleTime: 30_000,
  });
  const pendingCount = pendingRes?.total ?? 0;

  const initial = user?.full_name?.slice(0, 1) ?? '?';

  return (
    <>
      {/* Mobile backdrop — only visible when drawer is open on small screens.
          Click anywhere outside drawer to close. */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-warmgray-900/50 backdrop-blur-sm animate-fade-in"
          onClick={closeMobile}
        />
      )}

      <aside
        className={`
          flex flex-col select-none glass-dark overflow-hidden
          /* ─ Desktop (md+): static rail, width toggles via collapsed state */
          md:relative md:h-screen md:shrink-0 md:transition-[width] md:duration-200 md:ease-in-out
          ${collapsed ? 'md:w-[60px]' : 'md:w-60'}
          /* ─ Mobile (<md): fixed drawer that slides in from left */
          fixed inset-y-0 left-0 z-50 w-64 h-screen
          transition-transform duration-200 ease-in-out
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
        `}
      >
        <div className="relative flex flex-col flex-1 overflow-hidden">
      {/* Decorative blobs */}
      <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full bg-ringo-400/20 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -right-8 w-32 h-32 rounded-full bg-mustard-500/10 blur-2xl pointer-events-none" />

      {/* Logo */}
      <div className={`relative border-b border-white/10 shrink-0 flex items-center ${collapsed ? 'px-3.5 py-4 justify-center' : 'px-5 py-5'}`}>
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity"
        >
          <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <svg viewBox="0 0 64 64" className="w-5 h-5" fill="none">
              <path d="M32 18C28 12 18 13 16 21c-2 9 5 28 16 28s18-19 16-28c-2-8-12-9-16-3z"
                stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M32 18c0-3 1-7 4-9"
                stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="32" cy="34" r="3" fill="#C9A227" />
            </svg>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-[15px] font-bold tracking-[0.08em] text-white leading-tight">RINGO</div>
              <div className="text-[9px] text-white/40 font-semibold tracking-[0.18em] uppercase mt-0.5">Workflow</div>
            </div>
          )}
        </button>
      </div>

      {/* Nav — flex-1 prevents overflow, overflow-hidden clips */}
      <nav className="relative flex-1 overflow-hidden flex flex-col py-3 px-2 space-y-0.5">
        {perms.navItems.map((item) => {
          const i18nKey = NAV_I18N[item.to] as any;
          const label = i18nKey ? t(i18nKey) : item.label;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/dashboard'}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                `relative group flex items-center gap-3 rounded-xl text-sm font-medium
                 transition-all duration-150
                 ${collapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2.5'}
                 ${isActive
                   ? 'bg-white/15 text-white shadow-sm'
                   : 'text-white/60 hover:bg-white/10 hover:text-white/90'
                 }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && !collapsed && (
                    <span className="absolute left-0 w-0.5 h-6 bg-gradient-to-b from-ringo-300 to-mustard-400 rounded-r-full" />
                  )}
                  <span className={`transition-colors shrink-0 ${isActive ? 'text-white' : 'text-white/50 group-hover:text-white/80'}`}>
                    {ICONS[item.to] ?? <span className="w-[18px] h-[18px] text-xs flex items-center justify-center">{item.icon}</span>}
                  </span>
                  {!collapsed && <span className="flex-1 truncate">{label}</span>}
                  {item.to === '/approvals' && pendingCount > 0 && (
                    <span className={`flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-gradient-to-r from-ringo-500 to-ringo-400 text-white text-[10px] font-bold shadow-sm ${collapsed ? 'absolute -top-0.5 -right-0.5 scale-75' : ''}`}>
                      {pendingCount > 99 ? '99+' : pendingCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* User footer */}
      <div className={`relative border-t border-white/10 shrink-0 ${collapsed ? 'px-2 py-3' : 'px-4 py-4'}`}>
        {/* Profile link */}
        <NavLink
          to="/profile"
          title={collapsed ? t('nav_profile') : undefined}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl transition-all duration-150 mb-2
             ${collapsed ? 'px-0 py-2 justify-center' : 'px-2 py-2'}
             ${isActive ? 'bg-white/15' : 'hover:bg-white/10'}`
          }
        >
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt={user.full_name ?? ''} className="flex-shrink-0 w-7 h-7 rounded-full object-cover ring-2 ring-white/20" />
          ) : (
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-ringo-400 to-mustard-500 flex items-center justify-center text-[11px] font-bold text-white shadow-md">
              {initial}
            </div>
          )}
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-white/90 truncate">{user?.full_name ?? '—'}</div>
              <div className="text-[10px] text-white/40">{getPermissions(user?.role).label}</div>
            </div>
          )}
        </NavLink>

        {/* Collapse toggle — desktop only; mobile users tap backdrop to close */}
        <button
          onClick={toggle}
          className={`hidden md:flex w-full items-center justify-center gap-2 py-1.5 rounded-xl
                      text-white/40 hover:text-white/70 hover:bg-white/10
                      transition-all duration-150 text-[11px] font-medium`}
          title={collapsed ? '展開' : '折りたたむ'}
        >
          <CollapseIcon collapsed={collapsed} />
          {!collapsed && <span>折りたたむ</span>}
        </button>
      </div>
        </div>
      </aside>
    </>
  );
}
