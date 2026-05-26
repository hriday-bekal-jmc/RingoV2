import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import { useLang } from '../../context/LanguageContext';
import { usePermissions } from '../../hooks/usePermissions';
import apiClient from '../../services/apiClient';
import UserAvatar from './UserAvatar';

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

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 transition-transform duration-200" style={{ transform: collapsed ? 'rotate(180deg)' : 'none' }}>
      <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

const NAV_I18N: Record<string, string> = {
  '/dashboard':        'nav_dashboard',
  '/approvals':        'nav_approvals',
  '/accounting':       'nav_accounting',
  '/history':          'nav_history',
  '/admin':            'nav_admin',
  '/approval-history': 'nav_approval_history',
};

// Compact labels for the floating pill (space-limited)
const NAV_SHORT: Record<string, { ja: string; en: string }> = {
  '/dashboard':        { ja: 'ホーム',   en: 'Home'    },
  '/approvals':        { ja: '承認',     en: 'Approve' },
  '/accounting':       { ja: '経理',     en: 'Finance' },
  '/history':          { ja: '履歴',     en: 'History' },
  '/approval-history': { ja: '承認履歴', en: 'Log'     },
  '/admin':            { ja: '管理',     en: 'Admin'   },
};

export default function Sidebar() {
  const { user } = useAuth();
  const { collapsed, toggle } = useSidebar();
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  const perms = usePermissions(user?.role, user?.is_admin);

  const { data: pendingRes } = useQuery<{ total: number }>({
    queryKey: ['pendingApprovals', 'badge'],
    queryFn: async () => (await apiClient.get('/approvals/pending/count')).data,
    enabled: perms.canApprove,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const pendingCount = pendingRes?.total ?? 0;

  // Active index for the sliding pill indicator
  const activeIndex = perms.navItems.findIndex((item) =>
    item.to === '/dashboard'
      ? location.pathname === '/dashboard'
      : location.pathname.startsWith(item.to),
  );

  return (
    <>
      {/* ══════════════════════════════════════════════════════════════════════
          DESKTOP sidebar rail (md+) — unchanged
          ══════════════════════════════════════════════════════════════════════ */}
      <aside
        className={`
          hidden
          md:flex md:flex-col select-none glass-dark overflow-hidden
          md:relative md:shrink-0
          md:rounded-3xl md:border md:border-white/10
          md:transition-[width] md:duration-200 md:ease-in-out
          ${collapsed ? 'md:w-[60px]' : 'md:w-60'}
        `}
      >
        <div className="relative flex flex-col flex-1 overflow-hidden">
          <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full bg-ringo-400/20 blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 -right-8 w-32 h-32 rounded-full bg-mustard-500/10 blur-2xl pointer-events-none" />

          {/* Logo */}
          <div className={`relative border-b border-white/10 shrink-0 flex items-center ${collapsed ? 'px-3.5 py-4 justify-center' : 'px-5 py-5'}`}>
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity"
            >
              <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                <span
                  className="w-5 h-5 bg-white"
                  style={{
                    WebkitMaskImage:    'url(/ringo-mark.svg)',
                    maskImage:          'url(/ringo-mark.svg)',
                    WebkitMaskRepeat:   'no-repeat',
                    maskRepeat:         'no-repeat',
                    WebkitMaskPosition: 'center',
                    maskPosition:       'center',
                    WebkitMaskSize:     'contain',
                    maskSize:           'contain',
                  }}
                  aria-label="RINGO"
                />
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <div className="text-[15px] font-bold tracking-[0.08em] text-white leading-tight">RINGO</div>
                  <div className="text-[9px] text-white/40 font-semibold tracking-[0.18em] uppercase mt-0.5">Workflow</div>
                </div>
              )}
            </button>
          </div>

          {/* Nav */}
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
            <NavLink
              to="/profile"
              title={collapsed ? t('nav_profile') : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl transition-all duration-150 mb-2
                 ${collapsed ? 'px-0 py-2 justify-center' : 'px-2 py-2'}
                 ${isActive ? 'bg-white/15' : 'hover:bg-white/10'}`
              }
            >
              <UserAvatar
                name={user?.full_name ?? ''}
                avatarUrl={user?.avatar_url}
                size={7}
                ring="ring-2 ring-white/20"
                className="flex-shrink-0 shadow-md"
              />
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-white/90 truncate">{user?.full_name ?? '—'}</div>
                  <div className="text-[10px] text-white/40">
                    {perms.label}
                    {user?.is_admin ? ' / Admin' : ''}
                  </div>
                </div>
              )}
            </NavLink>

            <button
              onClick={toggle}
              className="hidden md:flex w-full items-center justify-center gap-2 py-1.5 rounded-xl
                         text-white/40 hover:text-white/70 hover:bg-white/10
                         transition-all duration-150 text-[11px] font-medium"
              title={collapsed ? '展開' : '折りたたむ'}
            >
              <CollapseIcon collapsed={collapsed} />
              {!collapsed && <span>折りたたむ</span>}
            </button>
          </div>
        </div>
      </aside>

      {/* ══════════════════════════════════════════════════════════════════════
          MOBILE floating pill tab bar (<md)
          Image-2 style: active item = icon+label capsule, inactive = icon only
          Warm cream glass container, ringo-gradient active capsule
          ══════════════════════════════════════════════════════════════════════ */}
      <div
        className="md:hidden fixed z-50 left-1/2 -translate-x-1/2"
        style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))', willChange: 'transform' }}
      >
        {/* Outer pill container — warm cream frosted glass */}
        <div
          className="flex items-center"
          style={{
            background: 'rgba(251, 248, 244, 0.90)',
            backdropFilter: 'blur(28px) saturate(1.8)',
            WebkitBackdropFilter: 'blur(28px) saturate(1.8)',
            borderRadius: '9999px',
            border: '1px solid rgba(154, 46, 34, 0.13)',
            boxShadow: '0 8px 36px rgba(60,20,10,0.16), 0 2px 8px rgba(60,20,10,0.08), inset 0 1px 0 rgba(255,255,255,0.85)',
            padding: '5px',
            gap: '2px',
          }}
        >
            {perms.navItems.map((item, idx) => {
            const short = NAV_SHORT[item.to];
            const label = short
              ? (lang === 'en' ? short.en : short.ja)
              : (NAV_I18N[item.to] ? t(NAV_I18N[item.to] as any) : item.label);
            const isActive = idx === activeIndex;

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/dashboard'}
                className="select-none active:opacity-60 transition-opacity duration-100"
              >
                {/*
                  Capsule: padding is CONSTANT (no layout animation).
                  Only background + shadow animate (compositor-only, no reflow).
                  Label uses max-width with ease-out — no spring overshoot = no jitter.
                */}
                <span
                  className="flex items-center overflow-hidden"
                  style={{
                    gap: '5px',
                    padding: '8px 12px',
                    borderRadius: '9999px',
                    background: isActive ? 'var(--ringo-gradient)' : 'transparent',
                    boxShadow: isActive ? '0 2px 10px rgba(154,46,34,0.38)' : 'none',
                    transition: 'background 260ms ease, box-shadow 260ms ease, color 200ms ease',
                    color: isActive ? '#fff' : 'rgba(80,28,20,0.48)',
                  }}
                >
                  {/* Icon — only scale animates, no layout change */}
                  <span className="relative flex items-center justify-center shrink-0">
                    <span style={{
                      display: 'flex',
                      color: 'inherit',
                      transform: isActive ? 'scale(1.06)' : 'scale(1)',
                      transition: 'transform 220ms ease-out',
                    }}>
                      {ICONS[item.to] ?? (
                        <span className="w-[18px] h-[18px] text-xs flex items-center justify-center">{item.icon}</span>
                      )}
                    </span>
                    {/* Badge */}
                    {item.to === '/approvals' && pendingCount > 0 && (
                      <span
                        className="absolute flex items-center justify-center leading-none font-bold"
                        style={{
                          top: '-5px', right: '-7px',
                          minWidth: '15px', height: '15px', padding: '0 3px',
                          borderRadius: '9999px',
                          background: isActive ? 'rgba(255,255,255,0.92)' : 'var(--ringo-500)',
                          color: isActive ? 'var(--ringo-600)' : '#fff',
                          fontSize: '8px',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                          transition: 'background 200ms ease, color 200ms ease',
                        }}
                      >
                        {pendingCount > 99 ? '99+' : pendingCount}
                      </span>
                    )}
                  </span>

                  {/*
                    Label: max-width 0→80px with ease-out (no overshoot).
                    opacity fades slightly behind width so text doesn't clip visibly.
                    willChange hints compositor to pre-promote layer.
                  */}
                  <span
                    className="font-semibold leading-none tracking-tight whitespace-nowrap"
                    style={{
                      fontSize: '11px',
                      color: 'inherit',
                      maxWidth: isActive ? '80px' : '0px',
                      opacity: isActive ? 1 : 0,
                      overflow: 'hidden',
                      willChange: 'max-width, opacity',
                      transition: 'max-width 260ms ease-out, opacity 160ms ease',
                    }}
                  >
                    {label}
                  </span>
                </span>
              </NavLink>
            );
          })}
        </div>
      </div>
    </>
  );
}
