const nav = {
  ja: {
    nav_dashboard:   'ダッシュボード',
    nav_approvals:   '承認待ち',
    nav_accounting:  '精算管理',
    nav_history:     '申請履歴',
    nav_admin:            '管理画面',
    nav_profile:          'プロフィール',
    nav_approval_history: '承認履歴',

    title_dashboard:   'ダッシュボード',
    title_approvals:   '承認待ち一覧',
    title_history:     '申請履歴',
    title_admin:       '管理画面',
    title_profile:          'プロフィール',
    title_settlement:       '精算入力',
    title_new_app:          '新規申請',
    title_approval_history: '承認履歴',
    title_accounting:       '精算管理',

    greeting_morning:  'おはようございます',
    greeting_day:      'こんにちは',
    greeting_evening:  'お疲れ様です',
  },
  en: {
    nav_dashboard:   'Dashboard',
    nav_approvals:   'Approvals',
    nav_accounting:  'Accounting',
    nav_history:     'History',
    nav_admin:            'Admin',
    nav_profile:          'Profile',
    nav_approval_history: 'Approval History',

    title_dashboard:   'Dashboard',
    title_approvals:   'Pending Approvals',
    title_history:     'Application History',
    title_admin:       'Admin Panel',
    title_profile:          'Profile',
    title_settlement:       'Expense Settlement',
    title_new_app:          'New Application',
    title_approval_history: 'Approval History',
    title_accounting:       'Accounting',

    greeting_morning:  'Good morning',
    greeting_day:      'Hello',
    greeting_evening:  'Good evening',
  },
} as const;

export default nav;
