// ── RINGO i18n dictionary ─────────────────────────────────────────────────────
// Add keys here. useT() returns string for current language.
//
// DEV-ONLY OVERRIDES: i18n.overrides.json is written by the /dev/i18n page.
// Production cleanup = delete i18n.overrides.json + the 3 lines below marked
// with `DEV-OVERRIDES`. Safe: if file is empty {ja:{},en:{}} nothing changes.

// DEV-OVERRIDES (line 1/3)
import overridesRaw from './i18n.overrides.json';

export type Lang = 'ja' | 'en';

// Field label resolver — picks label_en when lang=en AND label_en is set,
// otherwise falls back to legacy `label` (Japanese). Used across all places
// that render a schema field name to keep behavior identical.
export function fieldLabel(
  f: { label: string; label_en?: string | null } | undefined,
  lang: Lang,
): string {
  if (!f) return '';
  return lang === 'en' && f.label_en ? f.label_en : f.label;
}

// Resolve raw stored value to human-readable label for select/checkbox fields.
// Option `value` is now an opaque auto-generated key (opt_xxx) — viewers must
// look up the corresponding label_ja/label_en, otherwise users see the key.
// Single value (string) or multi-select (array of strings) supported. Falls
// back to raw value when no options array or no match (legacy data, deleted
// option, etc.).
export function optionLabel(
  f: { type?: string; options?: { value: string; label_ja?: string; label_en?: string }[] } | undefined,
  val: unknown,
  lang: Lang,
): string {
  if (val == null || val === '') return '';
  if (!f) return String(val);
  const opts = Array.isArray(f.options) ? f.options : null;
  if (!opts || (f.type !== 'select' && f.type !== 'checkbox')) return String(val);
  const pick = (v: string): string => {
    const o = opts.find((x) => x.value === v);
    if (!o) return v;
    return (lang === 'en' && o.label_en) ? o.label_en : (o.label_ja ?? v);
  };
  if (Array.isArray(val)) return val.map((v) => pick(String(v))).join('、');
  return pick(String(val));
}

const dict = {
  ja: {
    // Nav
    nav_dashboard:   'ダッシュボード',
    nav_approvals:   '承認待ち',
    nav_accounting:  '精算管理',
    nav_history:     '申請履歴',
    nav_admin:            '管理画面',
    nav_profile:          'プロフィール',
    nav_approval_history: '承認履歴',

    // Page titles
    title_dashboard:   'ダッシュボード',
    title_approvals:   '承認待ち一覧',
    title_history:     '申請履歴',
    title_admin:       '管理画面',
    title_profile:          'プロフィール',
    title_settlement:       '精算入力',
    title_new_app:          '新規申請',
    title_approval_history: '承認履歴',

    // Greeting
    greeting_morning:  'おはようございます',
    greeting_day:      'こんにちは',
    greeting_evening:  'お疲れ様です',

    // Status labels
    status_draft:           '下書き',
    status_pending:         '申請中',
    status_approved:        '稟議承認済',
    status_rejected:        '却下',
    status_returned:        '差し戻し',
    status_pending_settle:  '未精算',
    status_settle_approved: '精算承認済',
    status_completed:       '完了',
    status_cancelled:       'キャンセル',

    // Buttons
    btn_submit:       '申請する',
    btn_draft:        '下書き保存',
    btn_approve:      '承認する',
    btn_return:       '差し戻し',
    btn_reject:       '却下する',
    btn_close:        '閉じる',
    btn_save:         '保存する',
    btn_cancel:       'キャンセル',
    btn_settle:       '精算入力',
    btn_settle_submit:'精算申請する',
    btn_new_app:      '＋ 新規申請',
    btn_view_all:     '全申請履歴を見る →',
    btn_logout:       'ログアウト',

    // Dashboard
    dash_stat_pending:   '承認待ち',
    dash_stat_returned:  '差し戻し',
    dash_stat_draft:     '下書き',
    dash_stat_approval:  '要承認',
    dash_stat_total:     '全申請数',
    dash_forms_title:    '申請フォーム',
    dash_recent_title:   '最近の申請',
    dash_require_title:  '要承認',
    dash_no_apps:        '申請がまだありません',
    dash_view_history:   '全申請履歴を見る →',
    dash_view_approvals: '承認画面へ →',
    dash_draft_link:     '下書き',

    // Approvals
    approvals_inbox:    '承認インボックス',
    approvals_subtitle: '行をクリックして詳細を確認できます',
    approvals_pending_badge: '件 保留中',
    approvals_no_items: '承認待ちはありません',
    approvals_all_done: '全て処理済みです',
    approvals_content:  '申請内容',
    approvals_settlement_badge: '精算',
    approvals_settle_phase: '精算承認フェーズ — 実費の確認・精算承認を行ってください',
    approvals_original: '元の稟議内容',

    // History
    history_filter_all: '全て',
    history_no_items:   '該当する申請がありません',
    history_clear:      'フィルターを解除する',
    history_detail:     '詳細',
    history_edit:       '編集',
    history_delete:     '削除',
    history_editable:   '編集可能',

    // Profile
    profile_name_label:   '表示名',
    profile_email_label:  'メールアドレス',
    profile_role_label:   '権限',
    profile_dept_label:   '所属部署',
    profile_lang_label:   '言語設定',
    profile_lang_ja:      '日本語',
    profile_lang_en:      'English',
    profile_save_success: '保存しました',
    profile_lang_hint:    'アプリ全体の表示言語を変更します',

    // Toast messages
    toast_submitted:       '申請が完了しました 🎉',
    toast_drafted:         '下書きを保存しました 📝',
    toast_settled:         '精算申請を提出しました 💴 承認フローが開始されました',
    toast_draft_deleted:   '下書きを削除しました',
    toast_delete_error:    '削除に失敗しました',
    toast_submit_error:    '申請に失敗しました',
    toast_draft_updated:   '下書きを更新しました',
    toast_approved:        '承認しました — 次の承認者へ',
    toast_returned:        '差し戻しました',
    toast_rejected:        '却下しました',
    toast_approve_fail:    '承認失敗',
    toast_return_fail:     '差し戻し失敗',
    toast_reject_fail:     '却下失敗',

    // History page
    history_items_suffix:  '件',
    history_draft_suffix:  '下書き',
    history_new_app:       '＋ 新規申請',
    confirm_delete_title:  '下書きを削除',
    confirm_delete_btn:    '削除する',
    confirm_submit_title:  '申請を提出',
    confirm_submit_body:   'を申請します。提出後は承認フローが開始されます。',
    confirm_delete_body:   'の下書きを削除します。この操作は元に戻せません。',

    // Approvals modal
    approvals_col_app:     '申請 / 申請者',
    approvals_col_step:    '承認ステップ',
    approvals_col_date:    '申請日',
    approvals_applicant_lbl: '申請者',
    approvals_current_lbl: '現在',
    approvals_final_hint:  '最終承認 — 申請番号を発行します',
    approvals_comment:     'コメント',
    approvals_approve_ph:  '承認コメント（任意）',
    approvals_reason_ph:   '理由を入力してください（必須）',
    approvals_back:        '戻る',
    approvals_processing:  '処理中...',
    approvals_final_btn:   '最終承認',
    approvals_approve_btn: '承認する',
    approvals_error_msg:   'データ取得に失敗しました。ページをリロードしてください。',
    approvals_settle_content: '精算内容',
    action_require_comment:'理由を入力するとボタンが有効になります',
    attach_label:          '添付',
    not_entered:           '未入力',

    // NewApplication / Route preview
    route_approval:        '承認ルート',
    route_select:          'ルート選択',
    route_default_suffix:  '（デフォルト）',
    route_no_route_warn:   'あなたの部署にはこのテンプレートの承認ルートが設定されていません。管理者にお問い合わせください。',
    route_no_steps:        'ステップが設定されていません。管理者に連絡してください。',
    route_loading:         '読み込み中',

    // CalendarPicker / CustomSelect
    date_placeholder:      '日付を選択',
    date_today:            '今日',
    date_clear:            'クリア',
    select_placeholder:    '— 選択してください —',
    select_empty:          '選択肢なし',
    route_applicant_node:  '申請者',
    route_done_node:       '完了',
    form_loading:          'フォームを読み込み中...',
    form_load_error:       'フォームの読み込みに失敗しました。ページをリロードしてください。',

    // RETURNED flow
    returned_reason_title: '差し戻し理由',
    returned_edit_hint:    '内容を修正して再提出してください。過去の承認履歴は保存されています。',
    returned_by:           '差し戻した人',
    round_original:        '初回申請',
    round_resubmit:        '再提出 #',
    btn_resubmit:          '修正して再提出する',
    btn_correct_resend:    '訂正して再送信',
    unsettled_returned_badge: '精算差し戻し',

    // ApplicationDetail
    detail_no_number:      '申請番号未発行',
    detail_submitted_lbl:  '申請日',
    detail_applicant_lbl:  '申請者',
    detail_content:        '申請内容',
    detail_timeline:       '承認タイムライン',
    detail_unassigned:     '(未割当)',
    detail_comment:        'コメント',
    detail_draft_prefix:   '下書き',
    detail_ringi_approved: '稟議が承認されました',
    detail_settle_hint:    '出張や立替が終わりましたら、領収書を添付して精算を行ってください。',
    detail_create_settle:  '精算書を作成する',
    detail_route_select:   '承認ルートを選択',
    detail_no_route_warn:  'このテンプレートの承認ルートが部署に設定されていません。管理者に連絡してください。',

    // Settlement
    settle_back:           '申請履歴に戻る',
    settle_suffix:         '精算入力',
    settle_subtitle:       '稟議承認後の実費・領収書を入力して精算フローを開始します',
    settle_flow_title:     '精算承認フロー',
    settle_flow_note:      '精算ルートは管理者が設定した承認経路に従います。最後に総務部が精算確認して完了となります。',
    settle_original:       '元の稟議内容',
    settle_original_badge: '稟議内容（承認済）',
    settle_expected_label: '申請時の概算金額',
    settle_expected_hint:  '実費を下記フォームに入力してください',
    settle_form_title:     '精算情報の入力',
    settle_not_available:  'この申請は精算入力できません。（承認済みかつ精算対応テンプレートのみ）',
    settle_not_found:      '申請が見つかりません。',
    settle_approve_node:   '承認',
    settle_soumu_node:     '総務（精算確認）',
    settle_senmu_node:     '専務/社長',

    // Admin tabs
    admin_users_tab:       'ユーザー管理',
    admin_routes_tab:      '承認ルート',

    // Two-stage flow (立替精算申請)
    two_stage_badge:       '稟議＋精算',
    two_stage_hint:        '稟議承認 → 精算入力 → 精算承認の3フェーズで完了します',
    two_stage_flow_label:  '2フェーズフロー',
    phase_ringi:           '稟議',
    phase_waiting_settle:  '精算待ち',
    phase_settlement:      '精算',
    route_pair_ringi:      '稟議ルート',
    route_pair_settle:     '精算ルート',
    route_paired_hint:     '2ルートで1フロー: 稟議承認後に精算ルートが自動起動します',

    // ApplicationDetail — settlement section
    detail_settle_data_title: '精算内容（申請済）',

    // Settlement route selector
    settle_route_title:    '精算承認ルート',
    settle_no_route_warn:  'あなたの部署には精算承認ルートが設定されていません。管理者にお問い合わせください。',

    // Accounting page
    title_accounting:           '精算管理',
    accounting_subtitle:        '精算申請の一覧・振込日・振込証明を管理します',
    accounting_no_items:        '精算申請がありません',
    accounting_col_app:         '申請番号',
    accounting_col_applicant:   '申請者',
    accounting_col_dept:        '部署',
    accounting_col_template:    '申請種別',
    accounting_col_expected:    '概算金額',
    accounting_col_actual:      '実費合計',
    accounting_col_transfer:    '振込日',
    accounting_col_proof:       '振込証明',
    accounting_col_status:      'ステータス',
    accounting_transfer_date_ph:'日付を選択',
    accounting_note_ph:         '備考（任意）',
    accounting_save_date:       '保存',
    accounting_upload_proof:    '振込証明をアップロード',
    accounting_proof_uploaded:  '証明あり',
    accounting_proof_view:      '確認',
    accounting_export_csv:      'CSVダウンロード',
    accounting_export_all:      '全件',
    accounting_export_selected: '選択中',
    accounting_filter_all:      '全て',
    accounting_filter_pending:  '精算中',
    accounting_filter_done:     '完了',
    accounting_saving:          '保存中...',
    accounting_uploading:       'アップロード中...',
    accounting_approve_btn:     '最終承認',
    accounting_approving:       '処理中...',
    accounting_approve_done:    '承認済み',
    accounting_awaiting:        '承認待ち',
    accounting_result_title:    '経理処理結果',
    col_detail:                 '詳細',

    // Form hints
    draft_hint:            '※ 下書きは後で編集・提出できます',

    // Admin page — general
    admin_apps_tab:           '申請管理',
    admin_perms_tab:          'ロール権限',
    admin_forms_tab:          'フォーム編集',
    admin_add_user:           'ユーザー追加',
    admin_create_user:        'ユーザー新規作成',
    admin_edit_user:          'プロフィール編集',
    admin_filter_all_dept:    '全部署',
    admin_filter_all_role:    '全ロール',
    admin_filter_all_people:  '全員',
    admin_filter_active:      '有効',
    admin_filter_inactive:    '無効',
    admin_col_user:           'ユーザー',
    admin_col_status:         '状態',
    admin_status_active:      '有効',
    admin_status_inactive:    '無効',
    admin_field_name:         '氏名',
    admin_field_email:        'メールアドレス',
    admin_field_password:     'パスワード',
    admin_field_password_chg: '新しいパスワード（変更する場合のみ）',
    admin_field_role:         'ロール',
    admin_field_dept:         '部署',
    admin_field_active:       'アカウント有効',
    admin_unset:              '— 未設定 —',
    admin_no_users:           'ユーザーが見つかりません',
    admin_disable_only:       '無効化のみ（データ保持）',
    admin_saving:             '保存中...',
    admin_users_count:        '名',
    // Admin — routes
    admin_add_route:          'ルート追加',
    admin_new_route_title:    '新規承認ルート',
    admin_filter_all_form:    '全フォーム',
    admin_stage_all:          '全ステージ',
    admin_stage_ringi:        '稟議',
    admin_stage_settle:       '精算',
    admin_stage_tatekai:      '立替精算',
    admin_field_template:     'テンプレート',
    admin_field_stage:        'ステージ',
    admin_field_route_name:   'ルート名',
    admin_route_name_ph:      '例: 総務部 出張稟議',
    admin_no_steps:           'ステップが未設定です',
    admin_add_step_btn:       'ステップを追加する',
    admin_step_form_title:    'ステップ追加',
    admin_step_approver:      '承認者',
    admin_step_label:         'ステップ名',
    admin_step_action:        'アクション',
    admin_step_label_ph:      '例: 総務承認',
    admin_done_node:          '完了',
    admin_no_routes:          '承認ルートがまだありません',
    admin_creating:           '作成中...',
    admin_adding:             '追加中...',
    admin_routes_count:       'ルート',
    // Admin — applications
    admin_apps_search_ph:     '氏名 / テンプレート / 申請番号...',
    admin_filter_all_status:  '全ステータス',
    admin_clear_filter:       'クリア ✕',
    admin_col_app_number:     '申請番号',
    admin_col_submitted:      '申請日',
    admin_no_apps_data:       '申請データがありません',
    admin_apps_count:         '件',
    // Admin — permissions
    admin_perms_hint:              'ロールはユーザー管理タブで個別に変更できます。変更は最大60秒以内に反映されます（再ログイン不要）。',
    admin_perms_col_role:          'ロール',
    admin_perms_col_display:       '表示名 / 説明',
    admin_perms_col_submit:        '申請',
    admin_perms_col_approve:       '承認',
    admin_perms_col_settle:        '精算',
    admin_perms_col_admin:         '管理',
    admin_perms_col_pages:         'アクセスページ',
    admin_perms_legacy_badge:      '旧ロール',
    admin_perm_google_title:       'Google ログイン',
    admin_perm_google_body:        '初回サインインユーザーは自動で EMPLOYEE に設定。ドメイン制限で社外アカウントを拒否します。',
    admin_perm_role_title:         'ロール変更の即時反映',
    admin_perm_role_body:          'トークンバージョン管理により最大60秒以内に反映。再ログイン不要。',
    admin_perm_route_title:        '承認ルート',
    admin_perm_route_body:         '各ステップには特定ユーザーを割り当て。委任設定で不在時も自動代替。',
    admin_perm_admin_title:        'ADMIN 特権',
    admin_perm_admin_body:         '全ロールのステップを代理承認可能。ユーザー・ルート・テンプレートを管理できます。',
    admin_perm_token_title:        'セキュリティ',
    admin_perm_token_body:         'ファイルは認証済みルート経由のみ取得可。JWT は HttpOnly Cookie で管理。',

    // Role names (switchable via dev i18n page)
    role_SHITSUCHO:         '室長',
    role_GM:                'ゼネラルマネージャー',
    role_SENIOR_MANAGER:    'シニアマネージャー',
    role_MANAGER:           'マネージャー',
    role_SUB_MANAGER:       'サブマネージャー',
    role_SUB_MANAGER_TSUKI: 'サブマネージャー付',
    role_LEADER:            'リーダー',
    role_SUB_LEADER:        'サブリーダー',
    role_CHIEF:             'チーフ',
    role_MEMBER:            'メンバー',
    role_SENMU:             '専務',
    role_PRESIDENT:         '社長',
    role_ADMIN:             'システム管理者',

    // Common
    loading:   '読み込み中...',
    error_load: 'データ取得に失敗しました',
    optional:  '(任意)',
    required:  '*必須',
  },

  en: {
    // Nav
    nav_dashboard:   'Dashboard',
    nav_approvals:   'Approvals',
    nav_accounting:  'Accounting',
    nav_history:     'History',
    nav_admin:            'Admin',
    nav_profile:          'Profile',
    nav_approval_history: 'Approval History',

    // Page titles
    title_dashboard:   'Dashboard',
    title_approvals:   'Pending Approvals',
    title_history:     'Application History',
    title_admin:       'Admin Panel',
    title_profile:          'Profile',
    title_settlement:       'Expense Settlement',
    title_new_app:          'New Application',
    title_approval_history: 'Approval History',

    // Greeting
    greeting_morning:  'Good morning',
    greeting_day:      'Hello',
    greeting_evening:  'Good evening',

    // Status labels
    status_draft:           'Draft',
    status_pending:         'Pending',
    status_approved:        'Approved',
    status_rejected:        'Rejected',
    status_returned:        'Returned',
    status_pending_settle:  'Settlement Pending',
    status_settle_approved: 'Settlement Approved',
    status_completed:       'Completed',
    status_cancelled:       'Cancelled',

    // Buttons
    btn_submit:       'Submit',
    btn_draft:        'Save Draft',
    btn_approve:      'Approve',
    btn_return:       'Return',
    btn_reject:       'Reject',
    btn_close:        'Close',
    btn_save:         'Save',
    btn_cancel:       'Cancel',
    btn_settle:       'Submit Expenses',
    btn_settle_submit:'Submit Settlement',
    btn_new_app:      '+ New Application',
    btn_view_all:     'View all history →',
    btn_logout:       'Logout',

    // Dashboard
    dash_stat_pending:   'Awaiting',
    dash_stat_returned:  'Returned',
    dash_stat_draft:     'Drafts',
    dash_stat_approval:  'Need Action',
    dash_stat_total:     'Total',
    dash_forms_title:    'Application Forms',
    dash_recent_title:   'Recent',
    dash_require_title:  'Need Approval',
    dash_no_apps:        'No applications yet',
    dash_view_history:   'View all history →',
    dash_view_approvals: 'Go to Approvals →',
    dash_draft_link:     'Drafts',

    // Approvals
    approvals_inbox:    'Approval Inbox',
    approvals_subtitle: 'Click a row to see details',
    approvals_pending_badge: 'pending',
    approvals_no_items: 'No pending approvals',
    approvals_all_done: 'All caught up!',
    approvals_content:  'Application Details',
    approvals_settlement_badge: 'Settlement',
    approvals_settle_phase: 'Settlement Phase — Review actual expenses and approve reimbursement',
    approvals_original: 'Original Application',

    // History
    history_filter_all: 'All',
    history_no_items:   'No matching applications',
    history_clear:      'Clear filter',
    history_detail:     'Detail',
    history_edit:       'Edit',
    history_delete:     'Delete',
    history_editable:   'Editable',

    // Profile
    profile_name_label:   'Display Name',
    profile_email_label:  'Email',
    profile_role_label:   'Role',
    profile_dept_label:   'Department',
    profile_lang_label:   'Language',
    profile_lang_ja:      '日本語',
    profile_lang_en:      'English',
    profile_save_success: 'Saved',
    profile_lang_hint:    'Changes the display language for the entire app',

    // Toast messages
    toast_submitted:       'Application submitted successfully 🎉',
    toast_drafted:         'Draft saved 📝',
    toast_settled:         'Expense settlement submitted 💴 Approval flow started',
    toast_draft_deleted:   'Draft deleted',
    toast_delete_error:    'Delete failed',
    toast_submit_error:    'Submission failed',
    toast_draft_updated:   'Draft updated',
    toast_approved:        'Approved — sent to next approver',
    toast_returned:        'Returned to applicant',
    toast_rejected:        'Rejected',
    toast_approve_fail:    'Approval failed',
    toast_return_fail:     'Return failed',
    toast_reject_fail:     'Rejection failed',

    // History page
    history_items_suffix:  'items',
    history_draft_suffix:  'draft',
    history_new_app:       '+ New Application',
    confirm_delete_title:  'Delete Draft',
    confirm_delete_btn:    'Delete',
    confirm_submit_title:  'Submit Application',
    confirm_submit_body:   'Submit this application? The approval workflow will begin.',
    confirm_delete_body:   'Delete this draft? This cannot be undone.',

    // Approvals modal
    approvals_col_app:     'Application / Applicant',
    approvals_col_step:    'Approval Steps',
    approvals_col_date:    'Submitted',
    approvals_applicant_lbl: 'Applicant',
    approvals_current_lbl: 'Current',
    approvals_final_hint:  'Final Approval — Application number will be assigned',
    approvals_comment:     'Comment',
    approvals_approve_ph:  'Approval comment (optional)',
    approvals_reason_ph:   'Enter reason (required)',
    approvals_back:        'Back',
    approvals_processing:  'Processing...',
    approvals_final_btn:   'Final Approval',
    approvals_approve_btn: 'Approve',
    approvals_error_msg:   'Failed to load data. Please reload the page.',
    approvals_settle_content: 'Settlement Details',
    action_require_comment:'Enter a reason to enable this button',
    attach_label:          'Attachment',
    not_entered:           'Not entered',

    // NewApplication / Route preview
    route_approval:        'Approval Route',
    route_select:          'Select Route',
    route_default_suffix:  ' (default)',
    route_no_route_warn:   'No approval route is configured for your department for this template. Please contact an administrator.',
    route_no_steps:        'No steps configured. Please contact an administrator.',
    route_loading:         'Loading',

    // CalendarPicker / CustomSelect
    date_placeholder:      'Select a date',
    date_today:            'Today',
    date_clear:            'Clear',
    select_placeholder:    '— Please select —',
    select_empty:          'No options available',
    route_applicant_node:  'You',
    route_done_node:       'Done',
    form_loading:          'Loading form...',
    form_load_error:       'Failed to load form. Please reload the page.',

    // RETURNED flow
    returned_reason_title: 'Return Reason',
    returned_edit_hint:    'Please edit and resubmit. Your previous approval history is preserved.',
    returned_by:           'Returned by',
    round_original:        'Initial Submission',
    round_resubmit:        'Resubmission #',
    btn_resubmit:          'Edit & Resubmit',
    btn_correct_resend:    'Correct & resend',
    unsettled_returned_badge: 'Settlement returned',

    // ApplicationDetail
    detail_no_number:      'No number yet',
    detail_submitted_lbl:  'Submitted',
    detail_applicant_lbl:  'Applicant',
    detail_content:        'Application Details',
    detail_timeline:       'Approval Timeline',
    detail_unassigned:     '(Unassigned)',
    detail_comment:        'Comment',
    detail_draft_prefix:   'Draft',
    detail_ringi_approved: 'Application Approved',
    detail_settle_hint:    'Once your expense is complete, attach receipts and submit for reimbursement.',
    detail_create_settle:  'Start Settlement',
    detail_route_select:   'Select Approval Route',
    detail_no_route_warn:  'No approval route configured for your department. Please contact an administrator.',

    // Settlement
    settle_back:           'Back to History',
    settle_suffix:         'Settlement',
    settle_subtitle:       'Enter actual costs and receipts to start the settlement approval flow',
    settle_flow_title:     'Settlement Approval Flow',
    settle_flow_note:      'The settlement route follows the approval path configured by the administrator. Admin office verifies and completes.',
    settle_original:       'Original Application',
    settle_original_badge: 'Application (Approved)',
    settle_expected_label: 'Budgeted Amount',
    settle_expected_hint:  'Enter actual costs below',
    settle_form_title:     'Expense Details',
    settle_not_available:  'Settlement is not available for this application. (Approved applications with a settlement template only)',
    settle_not_found:      'Application not found.',
    settle_approve_node:   'Approve',
    settle_soumu_node:     'Admin (verify)',
    settle_senmu_node:     'VP / President',

    // Admin tabs
    admin_users_tab:       'Users',
    admin_routes_tab:      'Approval Routes',

    // Two-stage flow (Expense Claim / 立替精算申請)
    two_stage_badge:       'Ringi + Settlement',
    two_stage_hint:        'Completes in 3 phases: Ringi Approval → Expense Input → Settlement Approval',
    two_stage_flow_label:  '2-Phase Flow',
    phase_ringi:           'Ringi Phase',
    phase_waiting_settle:  'Awaiting Settlement',
    phase_settlement:      'Settlement Phase',
    route_pair_ringi:      'Ringi Route',
    route_pair_settle:     'Settlement Route',
    route_paired_hint:     '2 routes = 1 flow: Settlement route auto-starts after Ringi is approved',

    // ApplicationDetail — settlement section
    detail_settle_data_title: 'Settlement Details (Submitted)',

    // Settlement route selector
    settle_route_title:    'Settlement Approval Route',
    settle_no_route_warn:  'No settlement approval route is configured for your department. Please contact an administrator.',

    // Accounting page
    title_accounting:           'Accounting',
    accounting_subtitle:        'Manage settlement applications, transfer dates, and proof of payment',
    accounting_no_items:        'No settlement applications',
    accounting_col_app:         'Application #',
    accounting_col_applicant:   'Applicant',
    accounting_col_dept:        'Department',
    accounting_col_template:    'Type',
    accounting_col_expected:    'Est. Amount',
    accounting_col_actual:      'Actual',
    accounting_col_transfer:    'Transfer Date',
    accounting_col_proof:       'Proof',
    accounting_col_status:      'Status',
    accounting_transfer_date_ph:'Select date',
    accounting_note_ph:         'Note (optional)',
    accounting_save_date:       'Save',
    accounting_upload_proof:    'Upload Transfer Proof',
    accounting_proof_uploaded:  'Proof on file',
    accounting_proof_view:      'View',
    accounting_export_csv:      'Export CSV',
    accounting_export_all:      'All',
    accounting_export_selected: 'Selected',
    accounting_filter_all:      'All',
    accounting_filter_pending:  'Pending',
    accounting_filter_done:     'Completed',
    accounting_saving:          'Saving...',
    accounting_uploading:       'Uploading...',
    accounting_approve_btn:     'Final Approval',
    accounting_approving:       'Processing...',
    accounting_approve_done:    'Approved',
    accounting_awaiting:        'Awaiting',
    accounting_result_title:    'Accounting Result',
    col_detail:                 'Detail',

    // Form hints
    draft_hint:            '※ Drafts can be edited and submitted later',

    // Admin page — general
    admin_apps_tab:           'Applications',
    admin_perms_tab:          'Permissions',
    admin_forms_tab:          'Forms',
    admin_add_user:           'Add User',
    admin_create_user:        'Create User',
    admin_edit_user:          'Edit Profile',
    admin_filter_all_dept:    'All Depts',
    admin_filter_all_role:    'All Roles',
    admin_filter_all_people:  'All',
    admin_filter_active:      'Active',
    admin_filter_inactive:    'Inactive',
    admin_col_user:           'User',
    admin_col_status:         'Status',
    admin_status_active:      'Active',
    admin_status_inactive:    'Inactive',
    admin_field_name:         'Full Name',
    admin_field_email:        'Email',
    admin_field_password:     'Password',
    admin_field_password_chg: 'New Password (only if changing)',
    admin_field_role:         'Role',
    admin_field_dept:         'Department',
    admin_field_active:       'Account Active',
    admin_unset:              '— Not Set —',
    admin_no_users:           'No users found',
    admin_disable_only:       'Disable only (keep data)',
    admin_saving:             'Saving...',
    admin_users_count:        'users',
    // Admin — routes
    admin_add_route:          'Add Route',
    admin_new_route_title:    'New Approval Route',
    admin_filter_all_form:    'All Forms',
    admin_stage_all:          'All Stages',
    admin_stage_ringi:        'Ringi',
    admin_stage_settle:       'Settlement',
    admin_stage_tatekai:      'Tatekai',
    admin_field_template:     'Template',
    admin_field_stage:        'Stage',
    admin_field_route_name:   'Route Name',
    admin_route_name_ph:      'e.g. Admin Dept — Business Trip',
    admin_no_steps:           'No steps configured',
    admin_add_step_btn:       'Add a step',
    admin_step_form_title:    'Add Step',
    admin_step_approver:      'Approver',
    admin_step_label:         'Step Name',
    admin_step_action:        'Action',
    admin_step_label_ph:      'e.g. Admin Approval',
    admin_done_node:          'Done',
    admin_no_routes:          'No approval routes yet',
    admin_creating:           'Creating...',
    admin_adding:             'Adding...',
    admin_routes_count:       'routes',
    // Admin — applications
    admin_apps_search_ph:     'Name / template / app #...',
    admin_filter_all_status:  'All Statuses',
    admin_clear_filter:       'Clear ✕',
    admin_col_app_number:     'App #',
    admin_col_submitted:      'Submitted',
    admin_no_apps_data:       'No applications found',
    admin_apps_count:         'items',
    // Admin — permissions
    admin_perms_hint:              'Roles can be changed per user in the Users tab. Changes take effect within 60 seconds — no re-login required.',
    admin_perms_col_role:          'Role',
    admin_perms_col_display:       'Display / Description',
    admin_perms_col_submit:        'Submit',
    admin_perms_col_approve:       'Approve',
    admin_perms_col_settle:        'Finance',
    admin_perms_col_admin:         'Admin',
    admin_perms_col_pages:         'Accessible Pages',
    admin_perms_legacy_badge:      'Legacy',
    admin_perm_google_title:       'Google Login',
    admin_perm_google_body:        'First-time sign-in users are auto-assigned EMPLOYEE. Domain restriction blocks external accounts.',
    admin_perm_role_title:         'Instant Role Propagation',
    admin_perm_role_body:          'Token versioning invalidates old JWTs within 60 seconds. No re-login needed.',
    admin_perm_route_title:        'Approval Routes',
    admin_perm_route_body:         'Each step is assigned a specific user. Delegation auto-substitutes when unavailable.',
    admin_perm_admin_title:        'ADMIN Privilege',
    admin_perm_admin_body:         'Can act on any approval step across all roles. Manages users, routes, and templates.',
    admin_perm_token_title:        'Security',
    admin_perm_token_body:         'Files served via auth-gated routes only. JWT stored in HttpOnly cookies.',

    // Role names (switchable via dev i18n page)
    role_SHITSUCHO:         'Division Chief',
    role_GM:                'General Manager',
    role_SENIOR_MANAGER:    'Senior Manager',
    role_MANAGER:           'Manager',
    role_SUB_MANAGER:       'Sub Manager',
    role_SUB_MANAGER_TSUKI: 'Associate Sub Manager',
    role_LEADER:            'Leader',
    role_SUB_LEADER:        'Sub Leader',
    role_CHIEF:             'Chief',
    role_MEMBER:            'Member',
    role_SENMU:             'Managing Director',
    role_PRESIDENT:         'President',
    role_ADMIN:             'System Administrator',

    // Common
    loading:   'Loading...',
    error_load: 'Failed to load data',
    optional:  '(optional)',
    required:  '*required',
  },
} as const;

// DEV-OVERRIDES (line 2/3): merge override JSON into both langs at module init.
// Safe in prod: empty {} = no-op. Delete this block + import + json file on prod cleanup.
const overrides = overridesRaw as { ja?: Record<string, string>; en?: Record<string, string> };
Object.assign((dict as any).ja, overrides.ja ?? {});
Object.assign((dict as any).en, overrides.en ?? {});

// DEV-OVERRIDES (line 3/3): DictKey union widened so override-added keys typecheck.
// On prod cleanup, revert to: `export type DictKey = keyof typeof dict['ja'];`
export type DictKey = keyof typeof dict['ja'] | string;
export type Dict = typeof dict['ja'];
export { dict };
