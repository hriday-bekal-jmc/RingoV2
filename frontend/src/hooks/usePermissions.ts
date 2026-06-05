import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { getPermissions, type RolePermissions, type NavPermission } from '../config/permissions';
import apiClient from '../services/apiClient';

// Master list of all nav items with canonical labels + icons
// Labels here are fallback only — Sidebar.tsx overrides via i18n
export const ALL_NAV_ITEMS: NavPermission[] = [
  { to: '/dashboard',        label: 'ダッシュボード', icon: '▦' },
  { to: '/approvals',        label: '承認待ち',       icon: '🔔' },
  { to: '/approval-history', label: '承認履歴',       icon: '📋' },
  { to: '/accounting',       label: '精算管理',       icon: '▤' },
  { to: '/history',          label: '申請履歴',       icon: '⟲' },
  { to: '/admin',            label: '管理画面',       icon: '⚙' },
];

interface RolePermRow {
  canSubmit: boolean;
  canApprove: boolean;
  canSettle: boolean;
  canAdmin: boolean;
  navPages: string[];
}


export function usePermissions(roleOverride?: string, isAdminOverride?: boolean): RolePermissions {
  const { user } = useAuth();
  const role    = roleOverride    ?? user?.role     ?? 'EMPLOYEE';
  const isAdmin = isAdminOverride ?? user?.is_admin ?? false;

  const staticPerms = getPermissions(role, isAdmin);

  const { data } = useQuery<Record<string, RolePermRow>>({
    queryKey: ['permissions'],
    queryFn: async () => (await apiClient.get('/permissions')).data,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  if (!data) return staticPerms;
  const dbRow = data[role];
  if (!dbRow) return staticPerms;

  const navItems = dbRow.navPages
    .map((route) => ALL_NAV_ITEMS.find((n) => n.to === route))
    .filter((n): n is NavPermission => Boolean(n));

  // Per-user capability overrides — additive only (can grant, never revoke)
  const overrides   = user?.cap_overrides ?? [];
  const hasOverride = (cap: string) => overrides.includes(cap);

  const canApprove = dbRow.canApprove || isAdmin || hasOverride('can_approve');
  const canSettle  = dbRow.canSettle  || isAdmin || hasOverride('can_settle');
  const canAdmin   = dbRow.canAdmin   || isAdmin || hasOverride('can_admin');

  // Nav: admins see all. Overrides add the matching page if not already present.
  let finalNavItems = isAdmin ? ALL_NAV_ITEMS : navItems;
  if (!isAdmin) {
    const extra: NavPermission[] = [];
    if (canSettle  && !finalNavItems.find((n) => n.to === '/accounting'))       extra.push(ALL_NAV_ITEMS.find((n) => n.to === '/accounting')!);
    if (canApprove && !finalNavItems.find((n) => n.to === '/approvals'))        extra.push(ALL_NAV_ITEMS.find((n) => n.to === '/approvals')!);
    if (canApprove && !finalNavItems.find((n) => n.to === '/approval-history')) extra.push(ALL_NAV_ITEMS.find((n) => n.to === '/approval-history')!);
    if (canAdmin   && !finalNavItems.find((n) => n.to === '/admin'))            extra.push(ALL_NAV_ITEMS.find((n) => n.to === '/admin')!);
    if (extra.length > 0) finalNavItems = [...finalNavItems, ...extra.filter(Boolean)];
  }

  return {
    ...staticPerms,
    canSubmit:  dbRow.canSubmit,
    canApprove,
    canSettle,
    canAdmin,
    navItems: finalNavItems,
  };
}
