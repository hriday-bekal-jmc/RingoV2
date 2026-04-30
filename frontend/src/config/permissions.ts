// Role-based permission map for RINGO
// Each role lists what it can access and do.

export type Role =
  | 'EMPLOYEE'
  | 'MANAGER'
  | 'GM'
  | 'SOUMU'
  | 'SENMU'
  | 'PRESIDENT'
  | 'ACCOUNTING'
  | 'ADMIN';

export interface RolePermissions {
  label: string;          // Japanese display name
  description: string;
  canSubmit: boolean;     // submit new applications
  canApprove: boolean;    // access approval inbox
  canSettle: boolean;     // access settlements / accounting dashboard
  canAdmin: boolean;      // access /admin (user + route management)
  approverRoles: string[]; // which approval step roles this user can act on
  navItems: NavPermission[];
}

export interface NavPermission {
  to: string;
  label: string;
  icon: string;
}

const ROLE_MAP: Record<Role, RolePermissions> = {
  EMPLOYEE: {
    label: '一般社員',
    description: '稟議を申請し、自分の申請履歴を閲覧できます。',
    canSubmit: true,
    canApprove: false,
    canSettle: false,
    canAdmin: false,
    approverRoles: [],
    navItems: [
      { to: '/dashboard', label: 'ダッシュボード', icon: '▦' },
      { to: '/history',   label: '申請履歴',       icon: '⟲' },
    ],
  },
  MANAGER: {
    label: '管理職',
    description: '部下の稟議申請を承認 / 差し戻しできます。',
    canSubmit: true,
    canApprove: true,
    canSettle: false,
    canAdmin: false,
    approverRoles: ['MANAGER'],
    navItems: [
      { to: '/dashboard', label: 'ダッシュボード', icon: '▦' },
      { to: '/approvals', label: '承認待ち',       icon: '🔔' },
      { to: '/history',   label: '申請履歴',       icon: '⟲' },
    ],
  },
  GM: {
    label: '部門長',
    description: 'マネージャー承認後の稟議を最終承認します。',
    canSubmit: true,
    canApprove: true,
    canSettle: false,
    canAdmin: false,
    approverRoles: ['GM'],
    navItems: [
      { to: '/dashboard', label: 'ダッシュボード', icon: '▦' },
      { to: '/approvals', label: '承認待ち',       icon: '🔔' },
      { to: '/history',   label: '申請履歴',       icon: '⟲' },
    ],
  },
  SOUMU: {
    label: '総務',
    description: '総務ステップの承認を担当します。',
    canSubmit: true,
    canApprove: true,
    canSettle: false,
    canAdmin: false,
    approverRoles: ['SOUMU'],
    navItems: [
      { to: '/dashboard', label: 'ダッシュボード', icon: '▦' },
      { to: '/approvals', label: '承認待ち',       icon: '🔔' },
      { to: '/history',   label: '申請履歴',       icon: '⟲' },
    ],
  },
  SENMU: {
    label: '専務',
    description: '専務・社長確認ステップの承認を担当します。',
    canSubmit: false,
    canApprove: true,
    canSettle: false,
    canAdmin: false,
    approverRoles: ['SENMU', 'PRESIDENT'],
    navItems: [
      { to: '/dashboard', label: 'ダッシュボード', icon: '▦' },
      { to: '/approvals', label: '承認待ち',       icon: '🔔' },
    ],
  },
  PRESIDENT: {
    label: '社長',
    description: '最終確認・承認を行います。',
    canSubmit: false,
    canApprove: true,
    canSettle: false,
    canAdmin: false,
    approverRoles: ['PRESIDENT'],
    navItems: [
      { to: '/dashboard', label: 'ダッシュボード', icon: '▦' },
      { to: '/approvals', label: '承認待ち',       icon: '🔔' },
    ],
  },
  ACCOUNTING: {
    label: '経理',
    description: '精算処理・領収書確認・CSV出力を担当します。',
    canSubmit: false,
    canApprove: true,
    canSettle: true,
    canAdmin: false,
    approverRoles: ['ACCOUNTING'],
    navItems: [
      { to: '/dashboard',  label: 'ダッシュボード', icon: '▦' },
      { to: '/approvals',  label: '承認待ち',       icon: '🔔' },
      { to: '/accounting', label: '経理',           icon: '▤' },
    ],
  },
  ADMIN: {
    label: 'システム管理者',
    description: '全機能にアクセスできます。ユーザー管理・承認ルート設定を担当します。',
    canSubmit: true,
    canApprove: true,
    canSettle: true,
    canAdmin: true,
    approverRoles: ['EMPLOYEE', 'MANAGER', 'GM', 'SOUMU', 'SENMU', 'PRESIDENT', 'ACCOUNTING', 'ADMIN'],
    navItems: [
      { to: '/dashboard',  label: 'ダッシュボード', icon: '▦' },
      { to: '/approvals',  label: '承認待ち',       icon: '🔔' },
      { to: '/accounting', label: '経理',           icon: '▤' },
      { to: '/history',    label: '申請履歴',       icon: '⟲' },
      { to: '/admin',      label: '管理画面',       icon: '⚙' },
    ],
  },
};

export function getPermissions(role?: string): RolePermissions {
  return ROLE_MAP[(role as Role) ?? 'EMPLOYEE'] ?? ROLE_MAP.EMPLOYEE;
}

export { ROLE_MAP };
