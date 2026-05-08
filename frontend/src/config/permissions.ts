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
  label_en: string;       // English display name
  description: string;    // Japanese description
  description_en: string; // English description
  canSubmit: boolean;     // submit new applications
  canApprove: boolean;    // access approval inbox
  canSettle: boolean;     // access settlements / accounting dashboard
  canAdmin: boolean;      // access /admin (user + route management)
  approverRoles: string[]; // which approval step roles this user can act on
  navItems: NavPermission[];
  legacy?: boolean;       // role kept for DB compat but superseded
}

export interface NavPermission {
  to: string;
  label: string;
  icon: string;
}

const ROLE_MAP: Record<Role, RolePermissions> = {
  EMPLOYEE: {
    label: '一般社員',
    label_en: 'Employee',
    description: '稟議を申請し、自分の申請履歴を閲覧できます。',
    description_en: 'Can submit applications and view own application history.',
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
    label_en: 'Manager',
    description: '部下の稟議申請を承認 / 差し戻しできます。',
    description_en: 'Approves or returns subordinate applications.',
    canSubmit: true,
    canApprove: true,
    canSettle: false,
    canAdmin: false,
    approverRoles: ['MANAGER'],
    navItems: [
      { to: '/dashboard',        label: 'ダッシュボード', icon: '▦' },
      { to: '/approvals',        label: '承認待ち',       icon: '🔔' },
      { to: '/approval-history', label: '承認履歴',       icon: '📋' },
      { to: '/history',          label: '申請履歴',       icon: '⟲' },
    ],
  },
  GM: {
    label: '部門長',
    label_en: 'General Manager',
    description: 'マネージャー承認後の稟議を最終承認します。',
    description_en: 'Final approver after manager sign-off.',
    canSubmit: true,
    canApprove: true,
    canSettle: false,
    canAdmin: false,
    approverRoles: ['GM'],
    navItems: [
      { to: '/dashboard',        label: 'ダッシュボード', icon: '▦' },
      { to: '/approvals',        label: '承認待ち',       icon: '🔔' },
      { to: '/approval-history', label: '承認履歴',       icon: '📋' },
      { to: '/history',          label: '申請履歴',       icon: '⟲' },
    ],
  },
  SOUMU: {
    label: '総務部',
    label_en: 'General Affairs',
    description: '総務ステップの承認・精算確認・領収書確認を担当します（経理機能含む）。',
    description_en: 'Handles approval steps, settlement verification, and receipt review (includes accounting duties).',
    canSubmit: true,
    canApprove: true,
    canSettle: true,  // 総務部が経理業務を兼務
    canAdmin: false,
    approverRoles: ['SOUMU'],
    navItems: [
      { to: '/dashboard',        label: 'ダッシュボード', icon: '▦' },
      { to: '/approvals',        label: '承認待ち',       icon: '🔔' },
      { to: '/approval-history', label: '承認履歴',       icon: '📋' },
      { to: '/accounting',       label: '精算管理',       icon: '▤' },
      { to: '/history',          label: '申請履歴',       icon: '⟲' },
    ],
  },
  SENMU: {
    label: '専務',
    label_en: 'Executive Director',
    description: '専務・社長確認ステップの承認を担当します。',
    description_en: 'Handles executive and presidential confirmation steps.',
    canSubmit: false,
    canApprove: true,
    canSettle: false,
    canAdmin: false,
    approverRoles: ['SENMU', 'PRESIDENT'],
    navItems: [
      { to: '/dashboard',        label: 'ダッシュボード', icon: '▦' },
      { to: '/approvals',        label: '承認待ち',       icon: '🔔' },
      { to: '/approval-history', label: '承認履歴',       icon: '📋' },
    ],
  },
  PRESIDENT: {
    label: '社長',
    label_en: 'President',
    description: '最終確認・承認を行います。',
    description_en: 'Final confirmation and approval authority.',
    canSubmit: false,
    canApprove: true,
    canSettle: false,
    canAdmin: false,
    approverRoles: ['PRESIDENT'],
    navItems: [
      { to: '/dashboard',        label: 'ダッシュボード', icon: '▦' },
      { to: '/approvals',        label: '承認待ち',       icon: '🔔' },
      { to: '/approval-history', label: '承認履歴',       icon: '📋' },
    ],
  },
  ACCOUNTING: {
    label: '経理（旧）',
    label_en: 'Accounting (legacy)',
    description: '旧経理ロール。現在は総務部（SOUMU）が経理機能を担当します。',
    description_en: 'Legacy role. General Affairs (SOUMU) now handles accounting duties.',
    legacy: true,
    canSubmit: false,
    canApprove: true,
    canSettle: true,
    canAdmin: false,
    approverRoles: ['ACCOUNTING'],
    navItems: [
      { to: '/dashboard',        label: 'ダッシュボード', icon: '▦' },
      { to: '/approvals',        label: '承認待ち',       icon: '🔔' },
      { to: '/approval-history', label: '承認履歴',       icon: '📋' },
      { to: '/accounting',       label: '経理',           icon: '▤' },
    ],
  },
  ADMIN: {
    label: 'システム管理者',
    label_en: 'System Administrator',
    description: '全機能にアクセスできます。ユーザー管理・承認ルート設定を担当します。',
    description_en: 'Full access. Manages users, roles, and approval routes.',
    canSubmit: true,
    canApprove: true,
    canSettle: true,
    canAdmin: true,
    approverRoles: ['EMPLOYEE', 'MANAGER', 'GM', 'SOUMU', 'SENMU', 'PRESIDENT', 'ACCOUNTING', 'ADMIN'],
    navItems: [
      { to: '/dashboard',        label: 'ダッシュボード', icon: '▦' },
      { to: '/approvals',        label: '承認待ち',       icon: '🔔' },
      { to: '/approval-history', label: '承認履歴',       icon: '📋' },
      { to: '/accounting',       label: '経理',           icon: '▤' },
      { to: '/history',          label: '申請履歴',       icon: '⟲' },
      { to: '/admin',            label: '管理画面',       icon: '⚙' },
    ],
  },
};

export function getPermissions(role?: string): RolePermissions {
  return ROLE_MAP[(role as Role) ?? 'EMPLOYEE'] ?? ROLE_MAP.EMPLOYEE;
}

export { ROLE_MAP };
