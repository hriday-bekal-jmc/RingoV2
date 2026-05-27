// Role-based permission map for RINGO
// Each role lists what it can access and do.

export type Role =
  | 'SHITSUCHO'
  | 'GM'
  | 'SENIOR_MANAGER'
  | 'MANAGER'
  | 'SUB_MANAGER'
  | 'SUB_MANAGER_TSUKI'
  | 'LEADER'
  | 'SUB_LEADER'
  | 'CHIEF'
  | 'MEMBER'
  | 'SENMU'
  | 'PRESIDENT'
  | 'ADMIN';

export interface RolePermissions {
  label: string;          // Japanese display name
  label_en: string;       // English display name
  description: string;    // Japanese description
  description_en: string; // English description
  canSubmit: boolean;
  canApprove: boolean;
  canSettle: boolean;
  canAdmin: boolean;
  approverRoles: string[];
  navItems: NavPermission[];
}

export interface NavPermission {
  to: string;
  label: string;
  icon: string;
}

const BASE_NAV: NavPermission[] = [
  { to: '/dashboard', label: 'ダッシュボード', icon: '▦' },
  { to: '/history',   label: '申請履歴',       icon: '⟲' },
];

const APPROVER_FULL_NAV: NavPermission[] = [
  { to: '/dashboard',        label: 'ダッシュボード', icon: '▦' },
  { to: '/approvals',        label: '承認待ち',       icon: '🔔' },
  { to: '/approval-history', label: '承認履歴',       icon: '📋' },
  { to: '/history',          label: '申請履歴',       icon: '⟲' },
];

const EXEC_NAV: NavPermission[] = [
  { to: '/dashboard',        label: 'ダッシュボード', icon: '▦' },
  { to: '/approvals',        label: '承認待ち',       icon: '🔔' },
  { to: '/approval-history', label: '承認履歴',       icon: '📋' },
];

const ROLE_MAP: Record<Role, RolePermissions> = {
  SHITSUCHO: {
    label: '室長',
    label_en: 'Division Chief',
    description: '部門の承認・稟議申請を担当します。',
    description_en: 'Handles departmental approvals and can submit applications.',
    canSubmit: true,
    canApprove: true,
    canSettle: false,
    canAdmin: false,
    approverRoles: ['SHITSUCHO'],
    navItems: APPROVER_FULL_NAV,
  },
  GM: {
    label: 'ゼネラルマネージャー',
    label_en: 'General Manager',
    description: '上位承認者として最終判断を担当します。',
    description_en: 'Senior approver with final decision authority.',
    canSubmit: true,
    canApprove: true,
    canSettle: false,
    canAdmin: false,
    approverRoles: ['GM'],
    navItems: APPROVER_FULL_NAV,
  },
  SENIOR_MANAGER: {
    label: 'シニアマネージャー',
    label_en: 'Senior Manager',
    description: '承認・稟議申請を担当します。',
    description_en: 'Approves applications and can submit their own.',
    canSubmit: true,
    canApprove: true,
    canSettle: false,
    canAdmin: false,
    approverRoles: ['SENIOR_MANAGER'],
    navItems: APPROVER_FULL_NAV,
  },
  MANAGER: {
    label: 'マネージャー',
    label_en: 'Manager',
    description: '部下の稟議申請を承認・差し戻しできます。',
    description_en: 'Approves or returns subordinate applications.',
    canSubmit: true,
    canApprove: true,
    canSettle: false,
    canAdmin: false,
    approverRoles: ['MANAGER'],
    navItems: APPROVER_FULL_NAV,
  },
  SUB_MANAGER: {
    label: 'サブマネージャー',
    label_en: 'Sub Manager',
    description: '承認補佐・稟議申請を担当します。',
    description_en: 'Assists with approvals and can submit applications.',
    canSubmit: true,
    canApprove: true,
    canSettle: false,
    canAdmin: false,
    approverRoles: ['SUB_MANAGER'],
    navItems: APPROVER_FULL_NAV,
  },
  SUB_MANAGER_TSUKI: {
    label: 'サブマネージャー付',
    label_en: 'Associate Sub Manager',
    description: '稟議申請を行います。',
    description_en: 'Can submit applications.',
    canSubmit: true,
    canApprove: false,
    canSettle: false,
    canAdmin: false,
    approverRoles: [],
    navItems: BASE_NAV,
  },
  LEADER: {
    label: 'リーダー',
    label_en: 'Leader',
    description: '稟議申請を行います。',
    description_en: 'Can submit applications.',
    canSubmit: true,
    canApprove: false,
    canSettle: false,
    canAdmin: false,
    approverRoles: [],
    navItems: BASE_NAV,
  },
  SUB_LEADER: {
    label: 'サブリーダー',
    label_en: 'Sub Leader',
    description: '稟議申請を行います。',
    description_en: 'Can submit applications.',
    canSubmit: true,
    canApprove: false,
    canSettle: false,
    canAdmin: false,
    approverRoles: [],
    navItems: BASE_NAV,
  },
  CHIEF: {
    label: 'チーフ',
    label_en: 'Chief',
    description: '稟議申請を行います。',
    description_en: 'Can submit applications.',
    canSubmit: true,
    canApprove: false,
    canSettle: false,
    canAdmin: false,
    approverRoles: [],
    navItems: BASE_NAV,
  },
  MEMBER: {
    label: 'メンバー',
    label_en: 'Member',
    description: '稟議を申請し、自分の申請履歴を閲覧できます。',
    description_en: 'Can submit applications and view own history.',
    canSubmit: true,
    canApprove: false,
    canSettle: false,
    canAdmin: false,
    approverRoles: [],
    navItems: BASE_NAV,
  },
  SENMU: {
    label: '専務',
    label_en: 'Managing Director',
    description: '専務確認ステップの承認を担当します。',
    description_en: 'Handles executive confirmation steps.',
    canSubmit: false,
    canApprove: true,
    canSettle: false,
    canAdmin: false,
    approverRoles: ['SENMU'],
    navItems: EXEC_NAV,
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
    navItems: EXEC_NAV,
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
    approverRoles: [
      'SHITSUCHO', 'GM', 'SENIOR_MANAGER', 'MANAGER', 'SUB_MANAGER',
      'SUB_MANAGER_TSUKI', 'LEADER', 'SUB_LEADER', 'CHIEF', 'MEMBER',
      'SENMU', 'PRESIDENT', 'ADMIN',
    ],
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

const ADMIN_NAV: NavPermission[] = [
  { to: '/approvals',        label: 'Approvals',        icon: 'A' },
  { to: '/approval-history', label: 'Approval History', icon: 'H' },
  { to: '/accounting',       label: 'Accounting',       icon: '$' },
  { to: '/admin',            label: 'Admin',            icon: '*' },
];

function mergeNav(base: NavPermission[], extra: NavPermission[]): NavPermission[] {
  const seen = new Set<string>();
  const merged: NavPermission[] = [];
  for (const item of [...base, ...extra]) {
    if (seen.has(item.to)) continue;
    seen.add(item.to);
    merged.push(item);
  }
  return merged;
}

export function getPermissions(role?: string, isAdmin = false): RolePermissions {
  const base = ROLE_MAP[(role as Role) ?? 'MEMBER'] ?? ROLE_MAP.MEMBER;
  if (!isAdmin && role !== 'ADMIN') return base;

  return {
    ...base,
    canApprove: true,
    canSettle:  true,
    canAdmin:   true,
    approverRoles: Array.from(new Set([
      ...base.approverRoles,
      'SHITSUCHO', 'GM', 'SENIOR_MANAGER', 'MANAGER', 'SUB_MANAGER',
      'SUB_MANAGER_TSUKI', 'LEADER', 'SUB_LEADER', 'CHIEF', 'MEMBER',
      'SENMU', 'PRESIDENT',
    ])),
    navItems: mergeNav(base.navItems, ADMIN_NAV),
  };
}

export { ROLE_MAP };
