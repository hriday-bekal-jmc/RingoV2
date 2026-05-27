// ─────────────────────────────────────────────────────────────────────────────
// Notification template variable definitions
//
// HOW TO ADD A NEW VARIABLE:
//   1. Add an entry here (frontend display only)
//   2. In backend/src/services/notificationService.ts, add resolution logic
//      inside fetchAppContext() or fetchRouteProgress() to populate the key.
//
// Fields:
//   key      — must match the {{key}} used in templates and backend resolver
//   labelJa  — Japanese label shown on chips in the admin UI
//   labelEn  — English label shown when UI is in English mode
//   descJa   — Japanese description in the variable reference panel
//   group    — 'basic' | 'progress' | add more groups as needed
// ─────────────────────────────────────────────────────────────────────────────

export const TEMPLATE_VAR_DEFS = [
  // ── Basic application info ────────────────────────────────────────────────
  {
    key:     'applicant_name',
    labelJa: '申請者名',
    labelEn: 'Applicant',
    descJa:  '申請者の氏名',
    group:   'basic',
  },
  {
    key:     'actor_name',
    labelJa: '操作者名',
    labelEn: 'Actor',
    descJa:  '操作を行った人の氏名（承認者・差し戻し者など）',
    group:   'basic',
  },
  {
    key:     'application_number',
    labelJa: '申請番号',
    labelEn: 'App no.',
    descJa:  '申請番号（例: RNG-2025-000001）',
    group:   'basic',
  },
  {
    key:     'template_name',
    labelJa: '申請種別',
    labelEn: 'App type',
    descJa:  '申請種別名（例: 出張申請）',
    group:   'basic',
  },
  {
    key:     'department_name',
    labelJa: '部署名',
    labelEn: 'Department',
    descJa:  '申請者の所属部署',
    group:   'basic',
  },
  {
    key:     'app_url',
    labelJa: '申請URL',
    labelEn: 'URL',
    descJa:  '申請詳細ページへのURL',
    group:   'basic',
  },
  {
    key:     'comment',
    labelJa: 'コメント',
    labelEn: 'Comment',
    descJa:  'コメント（差し戻し・却下時に入力されたもの）',
    group:   'basic',
  },
  {
    key:     'step_name',
    labelJa: 'ステップ名',
    labelEn: 'Step name',
    descJa:  '承認ステップ名',
    group:   'basic',
  },
  {
    key:     'date',
    labelJa: '日付',
    labelEn: 'Date',
    descJa:  '操作が行われた日付',
    group:   'basic',
  },

  // ── Route progress ────────────────────────────────────────────────────────
  {
    key:     'route_progress',
    labelJa: '承認進捗',
    labelEn: 'Progress',
    descJa:  'ステップ X / Y 形式（例: ステップ 2 / 5）',
    group:   'progress',
  },
  {
    key:     'route_dots',
    labelJa: '進捗ドット',
    labelEn: 'Progress dots',
    descJa:  'ドット形式（例: ●●◎○○）● 承認済 ◎ 現在 ○ 待機',
    group:   'progress',
  },
  {
    key:     'route_step_number',
    labelJa: '現ステップ番号',
    labelEn: 'Step no.',
    descJa:  '現在のステップ番号（数字のみ）',
    group:   'progress',
  },
  {
    key:     'route_total_steps',
    labelJa: '総ステップ数',
    labelEn: 'Total steps',
    descJa:  '合計ステップ数（数字のみ）',
    group:   'progress',
  },
  {
    key:     'current_step',
    labelJa: '現ステップ名',
    labelEn: 'Current step',
    descJa:  '現在の承認ステップ名',
    group:   'progress',
  },
  {
    key:     'current_step_approver',
    labelJa: '現担当者',
    labelEn: 'Current approver',
    descJa:  '現在の担当承認者名',
    group:   'progress',
  },
] as const;

export type TemplateVarDef = typeof TEMPLATE_VAR_DEFS[number];
export type TemplateVarGroup = TemplateVarDef['group'];
