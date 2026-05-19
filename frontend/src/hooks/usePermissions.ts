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

  // is_admin flag = full system access regardless of role.
  // Nav: show ALL pages (not just role's nav_pages + /admin).
  // This matches the static getPermissions() behaviour where isAdmin merges ADMIN_NAV.
  const canAdmin = dbRow.canAdmin || isAdmin;
  const finalNavItems = isAdmin ? ALL_NAV_ITEMS : navItems;

  return {
    ...staticPerms,
    canSubmit:  dbRow.canSubmit,
    canApprove: dbRow.canApprove || isAdmin,
    canSettle:  dbRow.canSettle  || isAdmin,
    canAdmin,
    navItems: finalNavItems,
  };
}
