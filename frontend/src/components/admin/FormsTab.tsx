// Admin Forms tab — full form template CRUD + versioning + field builder.
//
// Hierarchy:
//   FormsTab       — list of all templates, "Edit" / "New" / "History" buttons
//   FormBuilder    — modal for editing schema (fields, validation, conditional)
//   FieldEditor    — single field's config panel
//   VersionHistory — list of past versions w/ rollback
//
// Save creates a new version on the backend. Old applications keep their old
// schema reference, so editing never breaks existing data.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useLang } from '../../context/LanguageContext';
import ConfirmDialog from '../common/ConfirmDialog';
import InlineConfirm from '../common/InlineConfirm';

// ── No-op pass-through (EN inputs hidden in builder; EN stays blank until dev fills it) ──
// Renderers (fieldLabel, t()) already fall back to JA when EN is missing, so
// non-dev users toggling English see JA strings until the dev adds a real EN
// translation via /dev/i18n. This lets the dev page detect "missing EN" cleanly.
function mirrorFields(fields: FormField[]): FormField[] {
  return fields;
}

// ── Types ───────────────────────────────────────────────────────────────────
interface FieldOption {
  value:   string;
  label_ja: string;
  label_en: string;
}

interface FormField {
  name:          string;
  label:         string;           // label_ja kept for backward compat
  label_en?:     string;
  type:          string;
  required?:     boolean;
  placeholder?:  string;
  helper_text?:  string;
  default_value?: string | number | boolean | null;
  options?:      FieldOption[];
  // Auto-sum: this field's numeric value contributes to `sum_target` field
  sum_target?:   string;
  // Auto-sum target: receives the sum, read-only in UI
  computed?:     boolean;
  // Multiple values (repeating row group)
  multiple?:     boolean;
  // Repeatable group fields. Stored as one JSON array under this field name.
  fields?:       FormField[];
  min_rows?:     number;
  max_rows?:     number;
  add_label?:    string;
  add_label_en?: string;
  validation?: {
    regex?:     string;
    min?:       number;
    max?:       number;
    maxlength?: number;
    /** Time fields: HH:mm earliest/latest allowed, step in minutes */
    min_time?:  string;
    max_time?:  string;
    step?:      number;
  };
  conditional_on?: {
    field:  string;
    equals: string | number | boolean;
  };
  /** Layout width override. undefined = auto (type-based default). */
  col_span?: 'half' | 'full';
  /** Show this field's value in the application list row (Approvals + History). */
  show_in_row?: boolean;
  /**
   * For custom-renderer forms (e.g. transportation): field renders inside the
   * per-entry section instead of the top-level header section.
   */
  entry_field?: boolean;
  /**
   * allowance_days type: where to pull the per-day rate.
   * 'user_role' (default) = user's daily_allowance_rate from allowance_rates table.
   * 'custom' = flat custom_rate defined on this field (¥/day).
   */
  rate_source?: 'user_role' | 'custom';
  custom_rate?: number;
  /**
   * route_entry type: whether to show the "copy return route" button.
   * Default true when undefined.
   */
  show_copy_return?: boolean;
  /** route_entry: show transport-mode selector per route row. Options = selectable modes */
  show_mode?: boolean;
  /**
   * For number fields with show_in_row: name of the counterpart field in the
   * OTHER schema (ringi↔settlement) to compare against. When both values
   * exist and differ, the row is highlighted amber.
   */
  row_compare_with?: string;
  /** ai_file_reader: form field name to auto-fill with extracted date (YYYY-MM-DD) */
  target_date_field?: string;
  /** ai_file_reader: form field name to auto-fill with extracted amount (integer ¥) */
  target_amount_field?: string;
  /** ai_file_reader: custom semantic fields — [{target: fieldName, hint: "plain language description"}] */
  extract_fields?: Array<{ target: string; hint: string }>;
  /** ai_file_reader / file: Drive folder category for uploaded files */
  file_category?: 'receipts' | 'invoices' | 'transportation' | 'other';
  /** user_picker: sibling field name to auto-set with selected user count */
  count_field?: string;
  /** number: safe math formula using sibling field names; implies computed=true */
  formula?: string;
  /** repeat_group sum target: child field name whose values are summed */
  sum_field?: string;
  /** number: display unit appended after value (e.g. '人', 'km') */
  unit?: string;
  /** number: designates this field as the headline amount for accounting/settlements page */
  amount_field?: boolean;
}

interface FormSchema {
  fields: FormField[];
}

interface TemplateListItem {
  id:                          string;
  code:                        string;
  title:                       string;
  title_ja:                    string;
  pattern_id:                  number;
  is_active:                   boolean;
  is_protected?:               boolean;
  component_type?:             string | null;
  icon:                        string | null;
  gradient:                    string | null;
  description_ja:              string | null;
  description_en:              string | null;
  app_number_prefix:           string;
  app_number_digits:           number;
  active_version_id:           string | null;
  active_version_number:       number | null;
  active_version_created_at:   string | null;
  version_count:               number;
  application_count:           number;
}

interface TemplateVersion {
  id:                 string;
  version_number:     number;
  schema_definition:  FormSchema;
  settlement_schema:  FormSchema | null;
  is_active:          boolean;
  notes:              string | null;
  created_at:         string;
  application_count:  number;
  created_by_name:    string | null;
}

interface TemplateDetail {
  template: {
    id:                 string;
    code:               string;
    title:              string;
    title_ja:           string;
    pattern_id:         number;
    is_active:          boolean;
    is_protected?:      boolean;
    component_type?:    string | null;
    icon:               string | null;
    gradient:           string | null;
    description_ja:     string | null;
    description_en:     string | null;
    app_number_prefix:  string;
    app_number_digits:  number;
  };
  versions: TemplateVersion[];
  allowed_dept_ids: string[];
}

interface Department {
  id:   string;
  name: string;
}

// Curated gradient palette — admin picks via swatch grid (not free-text)
const GRADIENT_OPTIONS = [
  { val: 'from-sky-400 to-blue-500',         label: 'Sky' },
  { val: 'from-mustard-400 to-mustard-600',  label: 'Mustard' },
  { val: 'from-rose-400 to-pink-500',        label: 'Rose' },
  { val: 'from-violet-400 to-purple-500',    label: 'Violet' },
  { val: 'from-emerald-400 to-teal-500',     label: 'Emerald' },
  { val: 'from-amber-400 to-mustard-600',    label: 'Amber' },
  { val: 'from-ringo-400 to-ringo-600',      label: 'Ringo' },
  { val: 'from-teal-400 to-cyan-500',        label: 'Teal' },
  { val: 'from-slate-400 to-zinc-500',       label: 'Slate' },
  { val: 'from-indigo-400 to-violet-600',    label: 'Indigo' },
];

const FIELD_TYPES = [
  { value: 'text',           label_ja: 'テキスト',             label_en: 'Text' },
  { value: 'textarea',       label_ja: 'テキスト（複数行）',   label_en: 'Textarea' },
  { value: 'number',         label_ja: '数値',                label_en: 'Number' },
  { value: 'date',           label_ja: '日付',                label_en: 'Date' },
  { value: 'time',           label_ja: '時刻',                label_en: 'Time' },
  { value: 'select',         label_ja: 'プルダウン',           label_en: 'Select' },
  { value: 'checkbox',       label_ja: 'チェックボックス',     label_en: 'Checkbox' },
  { value: 'file',           label_ja: 'ファイル',             label_en: 'File upload' },
  { value: 'repeat_group',   label_ja: '繰り返しグループ',     label_en: 'Repeatable group' },
  { value: 'header',         label_ja: 'セクション見出し',     label_en: 'Section header' },
  // Reusable transport types — usable in any form via DynamicForm
  { value: 'allowance_days',  label_ja: '日当支給日数（0/半日/1日）',         label_en: 'Allowance days (0/half/1)' },
  { value: 'route_entry',     label_ja: '交通経路（乗車駅→降車駅・運賃）',   label_en: 'Transport route (from/to/fare)' },
  // AI-assisted file upload — uploads receipt/bill image, runs Gemini OCR, auto-fills target fields
  { value: 'ai_file_reader',  label_ja: 'AI領収書読み取り',                  label_en: 'AI receipt reader' },
  // Multi-select employees + free-add external names; auto-sets a count sibling field
  { value: 'user_picker',     label_ja: '参加者選択',                        label_en: 'User picker' },
];

const REPEAT_CHILD_FIELD_TYPES = FIELD_TYPES.filter((ft) => ft.value !== 'header');
const DEFAULT_REPEAT_MAX_ROWS = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Main tab — list of templates
// ─────────────────────────────────────────────────────────────────────────────
export default function FormsTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const { lang } = useLang();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating]   = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery<TemplateListItem[]>({
    queryKey: ['form-templates'],
    queryFn:  async () => (await apiClient.get('/admin/form-templates')).data,
    staleTime: 30_000,
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) =>
      is_active
        ? (await apiClient.patch(`/admin/form-templates/${id}`, { is_active: true })).data
        : (await apiClient.delete(`/admin/form-templates/${id}`)).data,
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['form-templates'] });
      queryClient.invalidateQueries({ queryKey: ['templates', 'active'] });
      showToast(vars.is_active
        ? (lang === 'en' ? 'Form activated' : 'フォームを有効化しました')
        : (lang === 'en' ? 'Form deactivated' : 'フォームを無効化しました'));
    },
  });

  const hardDelete = useMutation({
    mutationFn: async (id: string) => (await apiClient.delete(`/admin/form-templates/${id}?hard=true`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-templates'] });
      queryClient.invalidateQueries({ queryKey: ['templates', 'active'] });
      showToast(lang === 'en' ? 'Form deleted' : 'フォームを削除しました');
    },
    onError: (e: any) => showToast(`${lang === 'en' ? 'Cannot delete' : '削除不可'}: ${e.response?.data?.error ?? e.message}`, 'error'),
  });

  return (
    <div className="space-y-4">
      {/* Header w/ "New form" CTA */}
      <div className="flex items-center justify-between">
        <h3 className="section-title mb-0">{lang === 'en' ? 'Form templates' : 'フォームテンプレート'}</h3>
        <button onClick={() => setCreating(true)} className="btn-primary text-xs">
          + {lang === 'en' ? 'New form' : '新規作成'}
        </button>
      </div>

      {isLoading ? (
        <div className="card py-12 text-center text-warmgray-400 text-sm">読み込み中...</div>
      ) : !templates?.length ? (
        <div className="card py-12 text-center text-warmgray-400 text-sm">
          {lang === 'en' ? 'No templates yet — click New form' : 'まだフォームがありません'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map((t) => (
            <div key={t.id} className="card !p-4 space-y-3 animate-fade-up">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-warmgray-800 truncate">{t.title_ja}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  {!t.is_active && (
                    <span className="badge-draft text-[10px]">{lang === 'en' ? 'Inactive' : '無効'}</span>
                  )}
                  {t.is_protected && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200/60" title={lang === 'en' ? 'Protected — deactivate only, cannot be deleted' : '保護されたテンプレート — 無効化のみ可能'}>
                      🔒 {lang === 'en' ? 'Protected' : '保護'}
                    </span>
                  )}
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200/60">
                    v{t.active_version_number ?? '?'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-warmgray-500">
                <span>{t.version_count} {lang === 'en' ? 'versions' : 'バージョン'}</span>
                <span className="text-warmgray-300">·</span>
                <span>{t.application_count} {lang === 'en' ? 'applications' : '申請'}</span>
              </div>

              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setEditingId(t.id)}
                  className="btn-outline flex-1 text-xs min-w-[100px]"
                >
                  {lang === 'en' ? 'Edit / Versions' : '編集・履歴'}
                </button>
                <button
                  onClick={() => toggleActive.mutate({ id: t.id, is_active: !t.is_active })}
                  disabled={toggleActive.isPending}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold border transition-colors ${
                    t.is_active
                      ? 'bg-white/60 text-warmgray-600 border-warmgray-300/70 hover:bg-warmgray-100 hover:text-warmgray-800'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200/60 hover:bg-emerald-100'
                  }`}
                  title={t.is_active
                    ? (lang === 'en' ? 'Deactivate (hides from new submissions)' : '無効化（新規申請から非表示）')
                    : (lang === 'en' ? 'Reactivate' : '有効化')}
                >
                  {t.is_active ? (lang === 'en' ? 'Deactivate' : '無効化') : (lang === 'en' ? 'Activate' : '有効化')}
                </button>
                {/* Hard delete only when zero apps reference this template AND not protected */}
                {t.application_count === 0 && !t.is_protected && (
                  <InlineConfirm
                    isActive={confirmingDeleteId === t.id}
                    onTrigger={() => setConfirmingDeleteId(t.id)}
                    onConfirm={() => {
                      hardDelete.mutate(t.id);
                      setConfirmingDeleteId(null);
                    }}
                    onCancel={() => setConfirmingDeleteId(null)}
                    message={lang === 'en' ? 'Delete form?' : '削除しますか？'}
                    triggerLabel="✕"
                    confirmLabel={lang === 'en' ? 'Delete' : '削除する'}
                    triggerClass="text-xs px-2.5 py-1.5 rounded-lg font-semibold border border-red-200/60 text-red-600 hover:bg-red-50 transition-colors"
                    disabled={hardDelete.isPending}
                    reservedWidth={confirmingDeleteId === t.id ? 220 : 36}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editingId && (
        <FormBuilder
          templateId={editingId}
          onClose={() => setEditingId(null)}
          showToast={showToast}
        />
      )}
      {creating && (
        <FormBuilder
          templateId={null}
          onClose={() => setCreating(false)}
          showToast={showToast}
        />
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Form Builder modal — edit/create a template
// ─────────────────────────────────────────────────────────────────────────────
function FormBuilder({
  templateId, onClose, showToast,
}: {
  templateId: string | null;
  onClose:    () => void;
  showToast:  (m: string, t?: 'success' | 'error' | 'info') => void;
}) {
  const { lang } = useLang();
  const queryClient = useQueryClient();
  const isNew = templateId === null;

  // Auto-generated unique code for new forms — admin never sees/types it.
  // Format: TMPL_<8 uppercase hex> (URL-safe, fits VARCHAR(50)).
  function genCode(): string {
    const rand = (crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)).replace(/-/g, '');
    return `TMPL_${rand.slice(0, 8).toUpperCase()}`;
  }

  // Load existing template + versions
  const { data: detail } = useQuery<TemplateDetail>({
    queryKey: ['form-templates', templateId],
    queryFn:  async () => (await apiClient.get(`/admin/form-templates/${templateId}`)).data,
    enabled:  !isNew,
  });

  const activeVersion = detail?.versions.find(v => v.is_active);

  // Editor state
  const [code, setCode]                         = useState('');
  const [titleJa, setTitleJa]                   = useState('');
  const [titleEn, setTitleEn]                   = useState('');
  const [patternId, setPatternId]               = useState(1);
  const [icon, setIcon]                         = useState('📋');
  const [gradient, setGradient]                 = useState('from-slate-400 to-slate-500');
  const [descJa, setDescJa]                     = useState('');
  const [descEn, setDescEn]                     = useState('');
  const [appNumberPrefix, setAppNumberPrefix]   = useState('RNG');
  const [appNumberDigits, setAppNumberDigits]   = useState(6);
  const [fields, setFields]                     = useState<FormField[]>([]);
  const [settleFields, setSettleFields]         = useState<FormField[]>([]);
  const [editingSettle, setEditingSettle]       = useState(false);
  const [notes, setNotes]                       = useState('');
  const [showHistory, setShowHistory]           = useState(false);
  const [allowedDepts, setAllowedDepts]         = useState<string[]>([]);

  // Load all departments for picker
  const { data: departments } = useQuery<Department[]>({
    queryKey: ['admin', 'departments-list'],
    queryFn:  async () => (await apiClient.get('/admin/departments')).data,
    staleTime: 5 * 60_000,
  });

  // Auto-assign code for new templates on first mount (admin never sees it)
  if (isNew && code === '') setCode(genCode());

  // Hydrate state from loaded data
  const hydrated = useState(false);
  if (!hydrated[0] && detail && !isNew) {
    setCode(detail.template.code);
    setTitleJa(detail.template.title_ja);
    setTitleEn(detail.template.title);
    setPatternId(detail.template.pattern_id);
    setIcon(detail.template.icon ?? '📋');
    setGradient(detail.template.gradient ?? 'from-slate-400 to-slate-500');
    setDescJa(detail.template.description_ja ?? '');
    setDescEn(detail.template.description_en ?? '');
    setAppNumberPrefix(detail.template.app_number_prefix ?? 'RNG');
    setAppNumberDigits(detail.template.app_number_digits ?? 6);
    setAllowedDepts(detail.allowed_dept_ids ?? []);
    setFields(activeVersion?.schema_definition?.fields ?? []);
    setSettleFields(activeVersion?.settlement_schema?.fields ?? []);
    hydrated[1](true);
  }

  // Pattern 1 = ringi only. Pattern 2 = settlement only. Pattern 3 = both.
  const hasSettlement = patternId === 2 || patternId === 3;
  const hasRingi      = patternId === 1 || patternId === 3;

  // Custom-renderer forms (component_type set, e.g. 'transportation') have TWO independent
  // schemas: schema_definition = admin-editable header fields shown above the custom section;
  // settlement_schema = accounting-stage fields. Treat them like pattern 3 in the builder.
  const isCustomRenderer = !!(detail?.template?.component_type);

  // For plain pattern 2 (no custom renderer): force settle mode (single schema).
  // For pattern 1: force ringi mode.
  // For custom renderer or pattern 3: allow toggle.
  if (patternId === 2 && !isCustomRenderer && !editingSettle) setEditingSettle(true);
  if (patternId === 1 && editingSettle)  setEditingSettle(false);
  const currentFields = editingSettle ? settleFields : fields;
  const setCurrentFields = editingSettle ? setSettleFields : setFields;

  // Mutations
  const create = useMutation({
    mutationFn: async () => (await apiClient.post('/admin/form-templates', {
      code: code.trim(),
      title:    titleEn || titleJa,                       // legacy `title` col — keep JA fallback for non-null
      title_ja: titleJa,
      pattern_id: patternId,
      icon, gradient,
      description_ja: descJa || null,
      description_en: descEn || null,                       // leave blank — dev fills via /dev/i18n
      app_number_prefix: appNumberPrefix.trim().toUpperCase() || 'RNG',
      app_number_digits: appNumberDigits,
      // Pattern 2 (settlement-only) treats settlement schema as primary:
      // sync it to schema_definition too so frontend that reads either field works.
      // Custom renderers have independent header (fields) + settlement (settleFields).
      // Plain pattern 2: single schema synced to both.
      schema_definition: (hasRingi || isCustomRenderer) ? { fields: mirrorFields(fields) } : { fields: mirrorFields(settleFields) },
      settlement_schema: hasSettlement ? { fields: mirrorFields(settleFields) } : null,
      notes: notes || 'Initial version',
    })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-templates'] });
      queryClient.invalidateQueries({ queryKey: ['templates', 'active'] });
      showToast(lang === 'en' ? 'Form created' : 'フォームを作成しました');
      onClose();
    },
    onError: (e: any) => showToast(`${lang === 'en' ? 'Create failed' : '作成失敗'}: ${e.response?.data?.error ?? e.message}`, 'error'),
  });

  const saveVersion = useMutation({
    mutationFn: async () => (await apiClient.post(`/admin/form-templates/${templateId}/versions`, {
      schema_definition: (hasRingi || isCustomRenderer) ? { fields: mirrorFields(fields) } : { fields: mirrorFields(settleFields) },
      settlement_schema: hasSettlement ? { fields: mirrorFields(settleFields) } : null,
      notes,
    })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-templates'] });
      queryClient.invalidateQueries({ queryKey: ['form-templates', templateId] });
      queryClient.invalidateQueries({ queryKey: ['templates', 'active'] }); // refresh dashboard tiles
      showToast(lang === 'en' ? 'New version saved' : '新バージョン保存しました');
      onClose();
    },
    onError: (e: any) => showToast(`${lang === 'en' ? 'Save failed' : '保存失敗'}: ${e.response?.data?.error ?? e.message}`, 'error'),
  });

  const saveMeta = useMutation({
    mutationFn: async () => (await apiClient.patch(`/admin/form-templates/${templateId}`, {
      title: titleEn || titleJa,                          // legacy `title` col — JA fallback for not-null
      title_ja: titleJa, pattern_id: patternId,
      icon, gradient,
      description_ja: descJa || null,
      description_en: descEn || null,                     // leave blank — dev fills via /dev/i18n
      app_number_prefix: appNumberPrefix.trim().toUpperCase() || 'RNG',
      app_number_digits: appNumberDigits,
    })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-templates'] });
    },
  });

  const saveDepts = useMutation({
    mutationFn: async () => (await apiClient.put(`/admin/form-templates/${templateId}/departments`, {
      department_ids: allowedDepts,
    })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-templates', templateId] });
      queryClient.invalidateQueries({ queryKey: ['templates', 'active'] });
    },
  });

  const activate = useMutation({
    mutationFn: async (vid: string) => (await apiClient.post(`/admin/form-templates/${templateId}/versions/${vid}/activate`, {})).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-templates'] });
      queryClient.invalidateQueries({ queryKey: ['form-templates', templateId] });
      showToast(lang === 'en' ? 'Version activated' : 'バージョンを有効にしました');
    },
  });

  const deleteVersion = useMutation({
    mutationFn: async (vid: string) => (await apiClient.delete(`/admin/form-templates/${templateId}/versions/${vid}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form-templates'] });
      queryClient.invalidateQueries({ queryKey: ['form-templates', templateId] });
      showToast(lang === 'en' ? 'Version deleted' : 'バージョンを削除しました');
    },
    onError: (e: any) => showToast(`${lang === 'en' ? 'Cannot delete' : '削除不可'}: ${e.response?.data?.error ?? e.message}`, 'error'),
  });

  // Field operations — work against currentFields (RINGI or settlement)
  const addField = () => {
    setCurrentFields([...currentFields, {
      name: `field_${currentFields.length + 1}`,
      label: '新規項目',
      label_en: 'New field',
      type: 'text',
      required: false,
    }]);
  };
  const updateField = (idx: number, patch: Partial<FormField>) => {
    setCurrentFields(currentFields.map((f, i) => i === idx ? { ...f, ...patch } : f));
  };
  const removeField = (idx: number) => setCurrentFields(currentFields.filter((_, i) => i !== idx));
  const moveField = (idx: number, dir: -1 | 1) => {
    const next = [...currentFields];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setCurrentFields(next);
  };
  const createRepeatGroupTotal = (groupIndex: number, childIndex: number) => {
    setCurrentFields((prev) => {
      const group = prev[groupIndex];
      const child = group?.fields?.[childIndex];
      if (!group || !child || child.type !== 'number') return prev;

      const base = `${group.name}_${child.name}_total`
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '') || `total_${prev.length + 1}`;
      const usedNames = new Set(prev.map((f) => f.name));
      let totalName = base;
      let n = 2;
      while (usedNames.has(totalName)) {
        totalName = `${base}_${n}`;
        n += 1;
      }

      const totalField: FormField = {
        name: totalName,
        label: `${child.label || group.label} 合計`,
        label_en: `${child.label_en || child.label || group.label_en || group.label || 'Amount'} total`,
        type: 'number',
        required: false,
        computed: true,
      };

      const next = prev.map((field, i) => {
        if (i !== groupIndex) return field;
        return {
          ...field,
          fields: (field.fields ?? []).map((rowField, j) =>
            j === childIndex ? { ...rowField, sum_target: totalName } : rowField,
          ),
        };
      });
      return [...next, totalField];
    });
  };

  const checkUniqueNames = (flds: FormField[], schemaLabel: string): boolean => {
    const names = flds.map(f => f.name.trim()).filter(Boolean);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length) {
      showToast(
        `${schemaLabel}: ${lang === 'en' ? 'Duplicate field names' : '重複フィールド名'} – ${[...new Set(dupes)].join(', ')}`,
        'error',
      );
      return false;
    }
    for (const f of flds) {
      if (f.type === 'repeat_group' && f.fields?.length) {
        if (!checkUniqueNames(f.fields, `${schemaLabel}/${f.name}`)) return false;
      }
    }
    return true;
  };

  const handleSave = async () => {
    // Uniqueness guard — runs for both new and edit paths
    if (hasRingi && !checkUniqueNames(fields, lang === 'en' ? 'Ringi schema' : '稟議スキーマ')) return;
    if (hasSettlement && !checkUniqueNames(settleFields, lang === 'en' ? 'Settlement schema' : '精算スキーマ')) return;

    if (isNew) {
      if (!code.trim()) { showToast('code が必須です', 'error'); return; }
      if (!titleJa.trim()) { showToast('日本語タイトルが必須です', 'error'); return; }
      // Chain: create then set departments (if any selected)
      try {
        const created = await create.mutateAsync();
        if (allowedDepts.length > 0 && created?.template?.id) {
          await apiClient.put(`/admin/form-templates/${created.template.id}/departments`, {
            department_ids: allowedDepts,
          });
        }
      } catch { /* toasted by create.onError */ }
    } else {
      const metaChanged = titleJa !== detail?.template.title_ja
        || titleEn !== detail?.template.title
        || patternId !== detail?.template.pattern_id
        || icon !== (detail?.template.icon ?? '📋')
        || gradient !== (detail?.template.gradient ?? 'from-slate-400 to-slate-500')
        || descJa !== (detail?.template.description_ja ?? '')
        || descEn !== (detail?.template.description_en ?? '')
        || appNumberPrefix !== (detail?.template.app_number_prefix ?? 'RNG')
        || appNumberDigits !== (detail?.template.app_number_digits ?? 6);
      const deptsChanged = JSON.stringify([...allowedDepts].sort())
        !== JSON.stringify([...(detail?.allowed_dept_ids ?? [])].sort());
      if (metaChanged)  saveMeta.mutate();
      if (deptsChanged) saveDepts.mutate();
      saveVersion.mutate();
    }
  };

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center sm:p-4 bg-warmgray-900/60 backdrop-blur-sm animate-fade-up" onClick={onClose}>
      <div
        className="relative bg-surface-50 sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-w-4xl sm:max-h-[90vh] overflow-hidden flex flex-col border border-white/80"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-white/40 bg-white/60 backdrop-blur-sm flex items-center justify-between gap-2 sm:gap-4">
          <h2 className="text-base sm:text-lg font-bold text-warmgray-800 truncate min-w-0">
            {isNew ? (lang === 'en' ? 'New form template' : '新規フォーム') : (lang === 'en' ? `Edit: ${titleJa}` : `編集: ${titleJa}`)}
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            {!isNew && (
              <button
                onClick={() => setShowHistory(s => !s)}
                className="btn-outline text-xs whitespace-nowrap"
              >
                {showHistory ? (lang === 'en' ? '← Edit' : '← 編集') : (lang === 'en' ? 'History' : '履歴')}
              </button>
            )}
            <button onClick={onClose} className="text-warmgray-400 hover:text-warmgray-600 transition-colors text-xl leading-none">✕</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
          {showHistory && detail ? (
            <VersionHistory
              versions={detail.versions}
              onActivate={(vid) => activate.mutate(vid)}
              onDelete={(vid) => deleteVersion.mutate(vid)}
              activatingId={activate.isPending ? activate.variables : undefined}
              deletingId={deleteVersion.isPending ? deleteVersion.variables : undefined}
            />
          ) : (
            <>
              {/* Metadata — code field hidden, auto-generated for new forms */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">
                    Pattern ID *
                  </label>
                  <select
                    value={patternId}
                    onChange={(e) => setPatternId(Number(e.target.value))}
                    className="input mt-1"
                  >
                    <option value={1}>1 — {lang === 'en' ? 'Ringi only (no settlement)' : '稟議のみ（精算なし）'}</option>
                    <option value={2}>2 — {lang === 'en' ? 'Settlement only (no ringi phase)' : '精算のみ（稟議フェーズなし）'}</option>
                    <option value={3}>3 — {lang === 'en' ? 'Ringi + Settlement (two-phase)' : '稟議＋精算（2フェーズ）'}</option>
                  </select>
                  {!isNew && (
                    <p className="text-[10px] text-amber-600 mt-1">
                      ⚠ {lang === 'en' ? 'Changing pattern affects new submissions only — existing apps keep their flow' : 'パターン変更は新規申請のみに反映。既存申請のフローは変わりません'}
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">日本語タイトル *</label>
                  <input
                    type="text"
                    value={titleJa}
                    onChange={(e) => setTitleJa(e.target.value)}
                    className="input mt-1"
                    placeholder="出張稟議書"
                  />
                </div>
                {/* English title input hidden — see mirrorFields. Re-enable for i18n maintenance only. */}
              </div>

              {/* Display meta — dashboard tile appearance */}
              <div className="card !p-4 bg-white/40 space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-warmgray-500">
                  {lang === 'en' ? 'Dashboard tile' : 'ダッシュボードタイル表示'}
                </p>

                {/* Live preview */}
                <div className={`!p-4 flex items-start gap-3 rounded-xl bg-white/60 border border-white/80`}>
                  <div className={`flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-xl border border-white/60`}>
                    {icon}
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-sm font-semibold text-warmgray-800 leading-tight">
                      {titleJa || '日本語タイトル'}
                    </p>
                    <p className="text-[11px] text-warmgray-400 mt-0.5 leading-tight">
                      {(lang === 'en' ? descEn : descJa) || (lang === 'en' ? 'Description preview' : '説明プレビュー')}
                    </p>
                  </div>
                </div>

                {/* Icon (emoji) + gradient picker */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">
                      {lang === 'en' ? 'Icon (emoji)' : 'アイコン（絵文字）'}
                    </label>
                    <input
                      type="text"
                      value={icon}
                      onChange={(e) => setIcon(e.target.value.slice(0, 4))}
                      className="input mt-1 text-2xl text-center"
                      placeholder="✈️"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">
                      {lang === 'en' ? 'Color' : 'カラー'}
                    </label>
                    <div className="grid grid-cols-5 gap-1.5 mt-1">
                      {GRADIENT_OPTIONS.map((g) => (
                        <button
                          key={g.val}
                          type="button"
                          onClick={() => setGradient(g.val)}
                          title={g.label}
                          className={`w-full aspect-square rounded-lg bg-gradient-to-br ${g.val} transition-all ${
                            gradient === g.val ? 'ring-2 ring-warmgray-800 scale-110' : 'hover:scale-105'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Description (JA only — EN mirrored on save) */}
                <input
                  type="text"
                  value={descJa}
                  onChange={(e) => setDescJa(e.target.value)}
                  className="input"
                  placeholder="日本語説明"
                />

                {/* Application number prefix */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">
                    {lang === 'en' ? 'Application Number Prefix' : '申請番号プレフィックス'}
                  </label>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <input
                        type="text"
                        value={appNumberPrefix}
                        onChange={(e) => setAppNumberPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                        className="input w-24 sm:w-28 font-mono uppercase"
                        placeholder="RNG"
                        maxLength={10}
                      />
                      <span className="text-xs text-warmgray-400 shrink-0">-{new Date().getFullYear()}-</span>
                      <span className="text-xs font-mono text-warmgray-500 shrink-0 truncate">{'0'.repeat(appNumberDigits - 1)}1</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <label className="text-[10px] text-warmgray-400 shrink-0">
                        {lang === 'en' ? 'Digits' : '桁数'}
                      </label>
                      <select
                        value={appNumberDigits}
                        onChange={(e) => setAppNumberDigits(Number(e.target.value))}
                        className="input w-16 text-sm"
                      >
                        {[4, 5, 6, 7, 8].map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-[10px] text-warmgray-400">
                    {lang === 'en'
                      ? 'Sequence resets each year. Letters and numbers only, max 10 chars.'
                      : '年ごとにリセット。英数字のみ、最大10文字。'}
                  </p>
                  {(() => {
                    const totalApps = detail?.versions.reduce((s, v) => s + (v.application_count ?? 0), 0) ?? 0;
                    const prefixChanged = appNumberPrefix !== (detail?.template.app_number_prefix ?? 'RNG');
                    if (!isNew && totalApps > 0 && prefixChanged) {
                      return (
                        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200/60 rounded-lg px-3 py-2 mt-1">
                          <span className="shrink-0">⚠️</span>
                          <p>
                            {lang === 'en'
                              ? `${totalApps} existing application(s) keep their current numbers. Only new submissions will use "${appNumberPrefix}". Numbering restarts from 1.`
                              : `既存の申請${totalApps}件は現在の番号を維持します。新規申請からのみ「${appNumberPrefix}」が使用され、連番は1から再開します。`}
                          </p>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              </div>

              {/* Department permissions */}
              <div className="card !p-4 bg-white/40 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-warmgray-500">
                    {lang === 'en' ? 'Available to departments' : '利用可能な部署'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setAllowedDepts([])}
                    className="text-[11px] text-ringo-500 hover:text-ringo-600 font-semibold"
                  >
                    {lang === 'en' ? 'All departments' : '全部署で利用可'}
                  </button>
                </div>
                <p className="text-[11px] text-warmgray-500">
                  {allowedDepts.length === 0
                    ? (lang === 'en' ? '✓ Available to ALL departments (no restriction)' : '✓ 全部署で利用可能（制限なし）')
                    : (lang === 'en' ? `Restricted to ${allowedDepts.length} department(s)` : `${allowedDepts.length} 部署のみで利用可能`)}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {(departments ?? []).map((d) => {
                    const isOn = allowedDepts.includes(d.id);
                    return (
                      <label key={d.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-xs font-medium transition-colors ${
                        isOn ? 'bg-ringo-50 text-ringo-700 border border-ringo-200/80' : 'bg-white/60 text-warmgray-600 border border-white/80 hover:bg-white/90'
                      }`}>
                        <input
                          type="checkbox"
                          checked={isOn}
                          onChange={() => {
                            setAllowedDepts((prev) =>
                              prev.includes(d.id) ? prev.filter(x => x !== d.id) : [...prev, d.id]
                            );
                          }}
                          className="w-3.5 h-3.5 accent-ringo-500"
                        />
                        <span className="truncate">{d.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Schema phase toggle:
                  - Pattern 3 (ringi + settle): toggle between 稟議 / 精算
                  - Custom renderer (component_type set): toggle between フォーム項目 / 精算項目
                  - Pattern 1 / plain pattern 2: no toggle */}
              {(hasRingi && hasSettlement) || (isCustomRenderer && hasSettlement) ? (
                <div className="space-y-2">
                  {isCustomRenderer && (
                    <div className="flex items-start gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200/60 rounded-xl px-3 py-2">
                      <span className="shrink-0 mt-0.5">🔧</span>
                      <span>
                        {lang === 'ja'
                          ? 'カスタムフォーム。「フォーム項目」はカスタムセクション上部に表示される管理者設定フィールド（例：件名）です。「精算項目」は会計担当者が記入する項目です。'
                          : 'Custom renderer form. "Form fields" are admin-configurable header fields shown above the custom section (e.g. subject). "Settlement fields" are filled by accounting.'}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 bg-white/40 border border-white/60 rounded-xl p-1 w-fit">
                    <button
                      onClick={() => setEditingSettle(false)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        !editingSettle ? 'bg-warmgray-800 text-white shadow-sm' : 'text-warmgray-500'
                      }`}
                    >
                      {isCustomRenderer
                        ? (lang === 'en' ? 'Form fields' : 'フォーム項目')
                        : (lang === 'en' ? 'Ringi schema' : '稟議スキーマ')}
                    </button>
                    <button
                      onClick={() => setEditingSettle(true)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        editingSettle ? 'bg-teal-600 text-white shadow-sm' : 'text-warmgray-500'
                      }`}
                    >
                      {lang === 'en' ? 'Settlement fields' : '精算項目'}
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Fields */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="section-title mb-0">
                    {editingSettle
                      ? (lang === 'en' ? 'Settlement fields' : '精算項目')
                      : isCustomRenderer
                        ? (lang === 'en' ? 'Form fields (header)' : 'フォーム項目（ヘッダー）')
                        : (lang === 'en' ? 'Fields' : '入力項目')}
                  </h3>
                  <button onClick={addField} className="btn-outline text-xs">+ {lang === 'en' ? 'Add field' : '項目追加'}</button>
                </div>

                {currentFields.length === 0 ? (
                  <div className="card py-8 text-center text-warmgray-400 text-sm">
                    {lang === 'en' ? 'No fields yet' : '項目がありません'}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {currentFields.map((f, i) => (
                      <FieldEditor
                        key={i}
                        field={f}
                        index={i}
                        total={currentFields.length}
                        siblingNames={currentFields.filter((_, j) => j !== i).map(x => x.name)}
                        // Numeric fields in same schema that could receive sum totals
                        computedFieldNames={currentFields.filter(x => x.computed && x.type === 'number').map(x => x.name)}
                        isCustomRenderer={isCustomRenderer}
                        onUpdate={(p) => updateField(i, p)}
                        onCreateRepeatGroupTotal={(childIdx) => createRepeatGroupTotal(i, childIdx)}
                        onRemove={() => removeField(i)}
                        onMove={(d) => moveField(i, d)}
                        otherSchemaFields={editingSettle ? fields : settleFields}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Notes for version */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">
                  {lang === 'en' ? 'Version notes (optional)' : 'バージョンメモ（任意）'}
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="input mt-1"
                  placeholder={lang === 'en' ? 'Why this change?' : '変更理由など'}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!showHistory && (
          <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-white/40 bg-white/60 backdrop-blur-sm flex items-center justify-end gap-2 shrink-0">
            <button onClick={onClose} className="btn-ghost text-sm flex-1 sm:flex-none">{lang === 'en' ? 'Cancel' : 'キャンセル'}</button>
            <button
              onClick={handleSave}
              disabled={create.isPending || saveVersion.isPending}
              className="btn-primary text-sm flex-1 sm:flex-none"
            >
              {create.isPending || saveVersion.isPending
                ? (lang === 'en' ? 'Saving...' : '保存中...')
                : isNew
                ? (lang === 'en' ? 'Create form' : '作成する')
                : (lang === 'en' ? 'Save as new version' : '新バージョンとして保存')}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

// ─────────────────────────────────────────────────────────────────────────────
// Single field editor card
// ─────────────────────────────────────────────────────────────────────────────
function FieldEditor({
  field, index, total, siblingNames, computedFieldNames, otherSchemaFields,
  isCustomRenderer,
  onUpdate, onCreateRepeatGroupTotal, onRemove, onMove,
}: {
  field: FormField;
  index: number;
  total: number;
  siblingNames: string[];
  computedFieldNames: string[];
  /** Fields from the OTHER schema (ringi↔settlement). Used for row_compare_with dropdown. */
  otherSchemaFields?: FormField[];
  /** True when editing a custom-renderer form (e.g. transportation). Enables entry_field toggle. */
  isCustomRenderer?: boolean;
  onUpdate: (patch: Partial<FormField>) => void;
  onCreateRepeatGroupTotal: (childIndex: number) => void;
  onRemove: () => void;
  onMove:   (dir: -1 | 1) => void;
}) {
  const { lang } = useLang();
  const [expanded, setExpanded] = useState(false);

  const isHeader = field.type === 'header';
  const isSelect = field.type === 'select';
  const isText = ['text', 'textarea'].includes(field.type);
  const isNumber = field.type === 'number';
  const isTime = field.type === 'time';
  const isRepeatGroup = field.type === 'repeat_group';

  const updateType = (type: string) => {
    if (type === 'repeat_group') {
      onUpdate({
        type,
        fields: field.fields ?? [],
        min_rows: field.min_rows ?? 0,
        max_rows: field.max_rows ?? DEFAULT_REPEAT_MAX_ROWS,
        multiple: undefined,
        computed: undefined,
        sum_target: undefined,
      });
      return;
    }
    onUpdate({
      type,
      fields: undefined,
      min_rows: undefined,
      max_rows: undefined,
      add_label: undefined,
      add_label_en: undefined,
    });
  };

  return (
    <div className="card !p-4 space-y-3 border border-white/60">
      {/* Row 1: index + name */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-warmgray-400 w-6 shrink-0">#{index + 1}</span>
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={field.name}
            onChange={(e) => onUpdate({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
            className={`input w-full text-xs font-mono ${siblingNames.includes(field.name) ? 'border-red-400 ring-1 ring-red-300' : ''}`}
            placeholder="field_name"
          />
          {siblingNames.includes(field.name) && (
            <p className="text-[10px] text-red-500 mt-0.5 pl-0.5">
              {lang === 'en' ? '⚠ Duplicate name — must be unique' : '⚠ 重複しています — 一意にしてください'}
            </p>
          )}
        </div>
      </div>
      {/* Row 2: type select + action buttons */}
      <div className="flex items-center gap-2">
        <select
          value={field.type}
          onChange={(e) => updateType(e.target.value)}
          className="select text-xs flex-1 min-w-0"
        >
          {FIELD_TYPES.map(ft => (
            <option key={ft.value} value={ft.value}>
              {lang === 'en' ? ft.label_en : ft.label_ja}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="btn-ghost px-2.5 py-2 text-xs disabled:opacity-30" title="Move up">▲</button>
          <button onClick={() => onMove(1)}  disabled={index === total - 1} className="btn-ghost px-2.5 py-2 text-xs disabled:opacity-30" title="Move down">▼</button>
          <button onClick={() => setExpanded(s => !s)} className="btn-ghost px-2.5 py-2 text-xs" title="Settings">{expanded ? '−' : '⚙'}</button>
          <button onClick={onRemove} className="text-red-400 hover:text-red-600 px-2.5 py-2 text-sm rounded-lg hover:bg-red-50 transition-colors" title="Remove">✕</button>
        </div>
      </div>

      {/* Label (JA only — EN mirrored on save via mirrorFields) */}
      <input
        type="text"
        value={field.label}
        onChange={(e) => onUpdate({ label: e.target.value })}
        className="input text-sm w-full"
        placeholder="日本語ラベル"
      />

      {/* Options — ALWAYS visible when type uses choices (core, not advanced) */}
      {(isSelect || field.type === 'checkbox') && (
        <OptionsEditor
          options={field.options ?? []}
          onChange={(opts) => onUpdate({ options: opts })}
          hint={field.type === 'checkbox'
            ? (/* hint */ 'Empty = single boolean. Add options for multi-select group.')
            : undefined}
        />
      )}

      {/* Header type: minimal expanded — subtitle only */}
      {expanded && isHeader && (
        <div className="pt-3 border-t border-white/40 space-y-3">
          <input
            type="text"
            value={field.helper_text ?? ''}
            onChange={(e) => onUpdate({ helper_text: e.target.value })}
            className="input text-xs"
            placeholder={lang === 'en' ? 'Subtitle / description (optional)' : 'サブタイトル（任意）'}
          />
        </div>
      )}

      {expanded && !isHeader && (
        <div className="pt-3 border-t border-white/40 space-y-3">
          {/* Required + multiple + computed flags */}
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-warmgray-600">
              <input
                type="checkbox"
                checked={field.required ?? false}
                onChange={(e) => onUpdate({ required: e.target.checked })}
              />
              {lang === 'en' ? 'Required' : '必須'}
            </label>
            {field.type === 'file' && (
              <label className="flex items-center gap-1.5 text-xs font-semibold text-warmgray-600">
                <input
                  type="checkbox"
                  checked={field.multiple ?? false}
                  onChange={(e) => onUpdate({ multiple: e.target.checked })}
                />
                {lang === 'en' ? 'Allow multiple files' : '複数ファイルを許可'}
              </label>
            )}
            {field.type === 'number' && (
              <label className="flex items-center gap-1.5 text-xs font-semibold text-warmgray-600">
                <input
                  type="checkbox"
                  checked={field.computed ?? false}
                  onChange={(e) => onUpdate({ computed: e.target.checked, sum_target: undefined, formula: undefined })}
                />
                {lang === 'en' ? 'Auto-sum total (read-only)' : '自動合計（読取専用）'}
              </label>
            )}
          </div>

          {/* Formula — number fields only */}
          {field.type === 'number' && (
            <div className="bg-teal-50/60 border border-teal-200/60 rounded-xl p-3 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-teal-700">
                {lang === 'en' ? 'Formula (auto-calc)' : '計算式（自動計算）'}
              </p>
              <input
                type="text"
                value={field.formula ?? ''}
                onChange={(e) => onUpdate({ formula: e.target.value || undefined, computed: e.target.value ? true : field.computed })}
                placeholder={lang === 'en' ? 'e.g. participant_count * 2000' : '例）participant_count * 2000'}
                className="w-full rounded-lg border border-teal-200 bg-white/80 px-3 py-1.5 text-xs font-mono outline-none focus:border-teal-400"
              />
              <p className="text-[10px] text-teal-600">
                {lang === 'en'
                  ? 'Use field names as variables. Supports +−×÷, Math.min(), Math.max().'
                  : 'フィールド名を変数として使用。+−×÷、Math.min()、Math.max() 対応。'}
              </p>
            </div>
          )}

          {/* User picker settings */}
          {field.type === 'user_picker' && (
            <div className="bg-violet-50/60 border border-violet-200/60 rounded-xl p-3 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-violet-700">
                {lang === 'en' ? 'User picker options' : '参加者選択オプション'}
              </p>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-warmgray-500 uppercase tracking-wide">
                  {lang === 'en' ? 'Auto-set count field' : '人数自動入力先フィールド名'}
                </label>
                <input
                  type="text"
                  value={field.count_field ?? ''}
                  onChange={(e) => onUpdate({ count_field: e.target.value || undefined })}
                  placeholder={lang === 'en' ? 'e.g. participant_count' : '例）participant_count'}
                  className="w-full rounded-lg border border-violet-200 bg-white/80 px-3 py-1.5 text-xs font-mono outline-none focus:border-violet-400"
                />
                <p className="text-[10px] text-violet-500">
                  {lang === 'en'
                    ? 'When set, this number field is automatically updated with the selected user count.'
                    : '設定すると、選択人数がこのフィールドに自動入力されます。'}
                </p>
              </div>
            </div>
          )}

          {/* Show in row + Amount field designation */}
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-warmgray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={field.show_in_row ?? false}
                onChange={(e) => onUpdate({ show_in_row: e.target.checked || undefined })}
                className="w-4 h-4 accent-ringo-500"
              />
              {lang === 'en' ? 'Show in list row' : '一覧行に表示'}
            </label>
            {field.type === 'number' && (
              <label className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 cursor-pointer select-none" title={lang === 'en' ? 'Marks this field as the headline amount shown in accounting/settlements' : '精算管理・会計ページの金額として使用するフィールドを指定'}>
                <input
                  type="checkbox"
                  checked={field.amount_field ?? false}
                  onChange={(e) => onUpdate({ amount_field: e.target.checked || undefined })}
                  className="w-4 h-4 accent-emerald-600"
                />
                {lang === 'en' ? 'Use as accounting amount' : '精算金額フィールド'}
              </label>
            )}
          </div>

          {/* route_entry settings: copy-return + per-route mode */}
          {field.type === 'route_entry' && (
            <div className="bg-emerald-50/60 border border-emerald-200/60 rounded-xl p-3 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                {lang === 'en' ? 'Route options' : 'ルートオプション'}
              </p>
              <label className="flex items-center gap-2 text-xs font-semibold text-emerald-800 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={field.show_copy_return !== false}
                  onChange={(e) => onUpdate({ show_copy_return: e.target.checked ? undefined : false })}
                  className="w-4 h-4 accent-emerald-500"
                />
                {lang === 'en' ? 'Show "copy return route" button' : '「復路コピー」ボタンを表示'}
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-emerald-800 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!!field.show_mode}
                  onChange={(e) => onUpdate({ show_mode: e.target.checked || undefined })}
                  className="w-4 h-4 accent-emerald-500"
                />
                {lang === 'en' ? 'Show transport mode per route row' : '各経路に交通手段を表示'}
              </label>
              {field.show_mode && (
                <div className="pl-6 space-y-1.5">
                  <p className="text-[10px] text-emerald-600">
                    {lang === 'en'
                      ? 'Options below = selectable modes on each route row (e.g. train, taxi, car).'
                      : '以下の選択肢が各経路行の交通手段ドロップダウンに表示されます。'}
                  </p>
                  <OptionsEditor
                    options={field.options ?? []}
                    onChange={(opts) => onUpdate({ options: opts })}
                  />
                </div>
              )}
            </div>
          )}

          {/* allowance_days settings: rate source + custom step options */}
          {field.type === 'allowance_days' && (
            <div className="bg-sky-50/60 border border-sky-200/60 rounded-xl p-3 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700">
                {lang === 'en' ? 'Allowance settings' : '日当設定'}
              </p>
              {/* Rate source */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-sky-700 uppercase tracking-widest">
                  {lang === 'en' ? 'Rate source' : 'レート参照元'}
                </p>
                <div className="flex items-center gap-4 flex-wrap">
                  <label className="flex items-center gap-1.5 text-xs text-sky-800 cursor-pointer select-none">
                    <input
                      type="radio"
                      name={`rate_source_${field.name}`}
                      checked={!field.rate_source || field.rate_source === 'user_role'}
                      onChange={() => onUpdate({ rate_source: 'user_role', custom_rate: undefined })}
                    />
                    {lang === 'en' ? "User's role rate" : 'ユーザー役職レート（日当テーブル）'}
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-sky-800 cursor-pointer select-none">
                    <input
                      type="radio"
                      name={`rate_source_${field.name}`}
                      checked={field.rate_source === 'custom'}
                      onChange={() => onUpdate({ rate_source: 'custom' })}
                    />
                    {lang === 'en' ? 'Custom flat rate' : 'カスタムレート（固定）'}
                  </label>
                </div>
                {field.rate_source === 'custom' && (
                  <div className="flex items-center gap-2">
                    <div className="relative w-36">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-sky-400 pointer-events-none">¥</span>
                      <input
                        type="number"
                        min={0}
                        value={field.custom_rate ?? ''}
                        onChange={(e) => onUpdate({ custom_rate: e.target.value ? Number(e.target.value) : undefined })}
                        className="input pl-6 text-xs"
                        placeholder="3000"
                      />
                    </div>
                    <span className="text-xs text-sky-600">/日</span>
                  </div>
                )}
              </div>
              {/* Selectable step options */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-sky-700 uppercase tracking-widest">
                  {lang === 'en' ? 'Selectable steps' : '選択ステップ'}
                </p>
                <p className="text-[10px] text-sky-600">
                  {lang === 'en'
                    ? 'Each option: label shown on pill button, value = numeric multiplier (0.5 = half day, 2 = double day, etc.). Empty = use default 0 / 0.5 / 1.'
                    : 'ラベル＝ボタン表示テキスト、値＝数値倍率（0.5＝半日、2＝2日分など）。空欄＝デフォルト 0/0.5/1。'}
                </p>
                <OptionsEditor
                  options={field.options ?? []}
                  onChange={(opts) => onUpdate({ options: opts })}
                  hint={lang === 'en'
                    ? 'Value must be numeric (e.g. 0, 0.5, 1, 1.5, 2). Label = button text.'
                    : '値は数値（例: 0, 0.5, 1, 1.5, 2）。ラベルはボタンに表示されるテキスト。'}
                />
              </div>
            </div>
          )}

          {/* ai_file_reader settings: target fields + Drive category */}
          {field.type === 'ai_file_reader' && (
            <div className="bg-violet-50/60 border border-violet-200/60 rounded-xl p-3 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-violet-700">
                {lang === 'en' ? 'AI reader settings' : 'AI読み取り設定'}
              </p>
              <p className="text-[10px] text-violet-600">
                {lang === 'en'
                  ? 'After upload, clicking "Auto-fill" runs Gemini OCR on the image and fills the target fields. Leave blank to skip that field.'
                  : 'アップロード後に「自動入力」を押すとGemini OCRが実行され、対象フィールドに値が自動入力されます。空欄にすると対象フィールドをスキップします。'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label text-violet-700">
                    {lang === 'en' ? 'Fill date into field name' : '日付を入力するフィールド名'}
                  </label>
                  <input
                    type="text"
                    className="input text-xs"
                    placeholder="date"
                    value={field.target_date_field ?? ''}
                    onChange={(e) => onUpdate({ target_date_field: e.target.value || undefined })}
                  />
                </div>
                <div>
                  <label className="label text-violet-700">
                    {lang === 'en' ? 'Fill amount into field name' : '金額を入力するフィールド名'}
                  </label>
                  <input
                    type="text"
                    className="input text-xs"
                    placeholder="total"
                    value={field.target_amount_field ?? ''}
                    onChange={(e) => onUpdate({ target_amount_field: e.target.value || undefined })}
                  />
                </div>
              </div>
              {/* Custom semantic extraction fields */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-violet-700">
                    {lang === 'en' ? 'Custom AI fields (semantic)' : 'カスタムAI抽出フィールド（意味検索）'}
                  </label>
                  <button
                    type="button"
                    onClick={() => onUpdate({ extract_fields: [...(field.extract_fields ?? []), { target: '', hint: '' }] })}
                    className="text-[11px] font-semibold text-violet-700 hover:text-violet-900"
                  >
                    + {lang === 'en' ? 'Add field' : 'フィールド追加'}
                  </button>
                </div>
                <p className="text-[10px] text-violet-500">
                  {lang === 'en'
                    ? 'AI uses the hint to semantically find matching text in the document. Date and amount are always extracted by regex above.'
                    : 'AIはヒントをもとに文書内の一致テキストを意味的に検索します。日付・金額は上記のregex抽出が優先されます。'}
                </p>
                {(field.extract_fields ?? []).length > 0 && (
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-2 gap-1 text-[10px] font-semibold text-violet-600 uppercase tracking-wide px-1">
                      <span>{lang === 'en' ? 'Field name (target)' : 'フィールド名（入力先）'}</span>
                      <span>{lang === 'en' ? 'AI hint (what to look for)' : 'AIヒント（何を探すか）'}</span>
                    </div>
                    {(field.extract_fields ?? []).map((ef, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={ef.target}
                          onChange={(e) => {
                            const next = [...(field.extract_fields ?? [])];
                            next[i] = { ...ef, target: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') };
                            onUpdate({ extract_fields: next });
                          }}
                          placeholder="vendor_name"
                          className="input text-xs font-mono flex-1 min-w-0"
                        />
                        <input
                          type="text"
                          value={ef.hint}
                          onChange={(e) => {
                            const next = [...(field.extract_fields ?? [])];
                            next[i] = { ...ef, hint: e.target.value };
                            onUpdate({ extract_fields: next });
                          }}
                          placeholder={lang === 'en' ? 'store or vendor name' : '店名または業者名'}
                          className="input text-xs flex-1 min-w-0"
                        />
                        <button
                          type="button"
                          onClick={() => onUpdate({ extract_fields: (field.extract_fields ?? []).filter((_, j) => j !== i) })}
                          className="text-red-400 hover:text-red-600 text-sm shrink-0"
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="label text-violet-700">
                  {lang === 'en' ? 'Drive folder category' : 'Driveフォルダカテゴリ'}
                </label>
                <select
                  className="input text-xs"
                  value={field.file_category ?? ''}
                  onChange={(e) => onUpdate({ file_category: (e.target.value || undefined) as typeof field.file_category })}
                >
                  <option value="">{lang === 'en' ? 'Default (root)' : 'デフォルト（ルート）'}</option>
                  <option value="receipts">{lang === 'en' ? 'Receipts' : '領収書'}</option>
                  <option value="invoices">{lang === 'en' ? 'Invoices / Bills' : '請求書・明細'}</option>
                  <option value="transportation">{lang === 'en' ? 'Transportation' : '交通費'}</option>
                  <option value="other">{lang === 'en' ? 'Other' : 'その他'}</option>
                </select>
              </div>
            </div>
          )}

          {/* file type: Drive category selector */}
          {field.type === 'file' && (
            <div className="bg-slate-50/60 border border-slate-200/60 rounded-xl p-3 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
                {lang === 'en' ? 'Storage settings' : 'ストレージ設定'}
              </p>
              <div>
                <label className="label text-slate-600">
                  {lang === 'en' ? 'Drive folder category' : 'Driveフォルダカテゴリ'}
                </label>
                <select
                  className="input text-xs"
                  value={field.file_category ?? ''}
                  onChange={(e) => onUpdate({ file_category: (e.target.value || undefined) as typeof field.file_category })}
                >
                  <option value="">{lang === 'en' ? 'Default (root)' : 'デフォルト（ルート）'}</option>
                  <option value="receipts">{lang === 'en' ? 'Receipts' : '領収書'}</option>
                  <option value="invoices">{lang === 'en' ? 'Invoices / Bills' : '請求書・明細'}</option>
                  <option value="transportation">{lang === 'en' ? 'Transportation' : '交通費'}</option>
                  <option value="other">{lang === 'en' ? 'Other' : 'その他'}</option>
                </select>
              </div>
            </div>
          )}

          {/* Entry field toggle — only for custom-renderer forms (e.g. transportation) */}
          {isCustomRenderer && (
            <div className="bg-amber-50/60 border border-amber-200/60 rounded-xl p-3 space-y-1.5">
              <label className="flex items-center gap-2 text-xs font-semibold text-amber-800 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={field.entry_field ?? false}
                  onChange={(e) => onUpdate({ entry_field: e.target.checked || undefined })}
                  className="w-4 h-4 accent-amber-500"
                />
                {lang === 'en' ? 'Per-entry field (renders inside each daily entry row)' : '明細フィールド（1日ごとの入力行に表示）'}
              </label>
              <p className="text-[10px] text-amber-700 pl-6">
                {lang === 'en'
                  ? 'Unchecked = renders once in the header section above the entry list.'
                  : 'オフ = 明細リスト上部のヘッダー欄に1回だけ表示されます。'}
              </p>
            </div>
          )}
          {field.show_in_row && isNumber && otherSchemaFields && otherSchemaFields.filter((x) => x.type === 'number').length > 0 && (
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-warmgray-500 shrink-0">
                {lang === 'en' ? 'Compare with' : '比較対象'}
              </span>
              <select
                value={field.row_compare_with ?? ''}
                onChange={(e) => onUpdate({ row_compare_with: e.target.value || undefined })}
                className="input text-xs flex-1"
              >
                <option value="">{lang === 'en' ? '— none —' : '— なし —'}</option>
                {otherSchemaFields.filter((x) => x.type === 'number').map((x) => (
                  <option key={x.name} value={x.name}>
                    {x.label}{x.label_en ? ` / ${x.label_en}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Width toggle — not shown for repeat_group (always full) or header (always full) */}
          {!isRepeatGroup && (
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-warmgray-500 shrink-0">
                {lang === 'en' ? 'Width' : '幅'}
              </span>
              <div className="flex rounded-lg border border-warmgray-200 overflow-hidden text-xs font-medium">
                {([
                  { v: undefined,  ja: '自動',   en: 'Auto' },
                  { v: 'half',     ja: '½ 半幅', en: '½ Half' },
                  { v: 'full',     ja: '⬛ 全幅', en: '⬛ Full' },
                ] as const).map(({ v, ja, en }, i) => (
                  <button
                    key={String(v ?? 'auto')}
                    type="button"
                    onClick={() => onUpdate({ col_span: v })}
                    className={`px-3 py-1.5 transition-colors ${i > 0 ? 'border-l border-warmgray-200' : ''} ${
                      field.col_span === v
                        ? 'bg-ringo-500 text-white'
                        : 'text-warmgray-600 hover:bg-warmgray-50'
                    }`}
                  >
                    {lang === 'en' ? en : ja}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-warmgray-400">
                {lang === 'en'
                  ? 'Auto = full for textarea/file, half for others'
                  : '自動 = textarea/fileは全幅、他は半幅'}
              </span>
            </div>
          )}

          {isRepeatGroup && (
            <RepeatGroupFieldsEditor
              field={field}
              computedFieldNames={computedFieldNames}
              onCreateTotal={onCreateRepeatGroupTotal}
              onUpdate={onUpdate}
            />
          )}

          {/* Sum source – pick which "total" this numeric field contributes to */}
          {field.type === 'number' && !field.computed && computedFieldNames.length > 0 && (
            <div className="bg-teal-50/40 border border-teal-200/40 rounded-xl p-3 space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-teal-700">
                {lang === 'en' ? 'Add to total' : '合計に加算'}
              </label>
              <select
                value={field.sum_target ?? ''}
                onChange={(e) => onUpdate({ sum_target: e.target.value || undefined })}
                className="input text-xs"
              >
                <option value="">— {lang === 'en' ? 'Not a sum source' : '加算しない'} —</option>
                {computedFieldNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <p className="text-[10px] text-warmgray-500">
                {lang === 'en'
                  ? 'This value adds into the selected auto-sum field on every change.'
                  : 'この数値が変わると上記の合計フィールドに自動で加算されます。'}
              </p>
            </div>
          )}

          {(isText || isNumber || field.type === 'date' || isTime) && (
            <input
              type="text"
              value={field.placeholder ?? ''}
              onChange={(e) => onUpdate({ placeholder: e.target.value })}
              className="input text-xs"
              placeholder={lang === 'en' ? 'Placeholder' : 'プレースホルダー'}
            />
          )}

          <input
            type="text"
            value={field.helper_text ?? ''}
            onChange={(e) => onUpdate({ helper_text: e.target.value })}
            className="input text-xs"
            placeholder={lang === 'en' ? 'Helper text (small description)' : '補足説明'}
          />

          {/* Validation */}
          {isText && (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={field.validation?.regex ?? ''}
                onChange={(e) => onUpdate({ validation: { ...field.validation, regex: e.target.value || undefined } })}
                className="input text-xs font-mono"
                placeholder="regex (^\\d+$)"
              />
              <input
                type="number"
                value={field.validation?.maxlength ?? ''}
                onChange={(e) => onUpdate({ validation: { ...field.validation, maxlength: e.target.value ? Number(e.target.value) : undefined } })}
                className="input text-xs"
                placeholder="maxlength"
              />
            </div>
          )}
          {isNumber && (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                value={field.validation?.min ?? ''}
                onChange={(e) => onUpdate({ validation: { ...field.validation, min: e.target.value ? Number(e.target.value) : undefined } })}
                className="input text-xs"
                placeholder="min"
              />
              <input
                type="number"
                value={field.validation?.max ?? ''}
                onChange={(e) => onUpdate({ validation: { ...field.validation, max: e.target.value ? Number(e.target.value) : undefined } })}
                className="input text-xs"
                placeholder="max"
              />
            </div>
          )}

          {/* Time-specific: min/max boundary + minute step */}
          {isTime && (
            <div className="bg-sky-50/50 border border-sky-200/50 rounded-xl p-3 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700">
                {lang === 'en' ? 'Time constraints (optional)' : '時刻制約（任意）'}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <p className="text-[10px] text-warmgray-500 font-medium">
                    {lang === 'en' ? 'Earliest (min)' : '最早時刻'}
                  </p>
                  <input
                    type="time"
                    value={field.validation?.min_time ?? ''}
                    onChange={(e) => onUpdate({ validation: { ...field.validation, min_time: e.target.value || undefined } })}
                    className="input-time text-xs w-full"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] text-warmgray-500 font-medium">
                    {lang === 'en' ? 'Latest (max)' : '最遅時刻'}
                  </p>
                  <input
                    type="time"
                    value={field.validation?.max_time ?? ''}
                    onChange={(e) => onUpdate({ validation: { ...field.validation, max_time: e.target.value || undefined } })}
                    className="input-time text-xs w-full"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-warmgray-500 font-medium">
                  {lang === 'en' ? 'Minute increment' : '分単位'}
                </p>
                <select
                  value={field.validation?.step ?? 1}
                  onChange={(e) => onUpdate({ validation: { ...field.validation, step: Number(e.target.value) } })}
                  className="select text-xs"
                >
                  <option value={1}>{lang === 'en' ? 'Any (1 min)' : '任意（1分）'}</option>
                  <option value={5}>5 {lang === 'en' ? 'min' : '分'}</option>
                  <option value={10}>10 {lang === 'en' ? 'min' : '分'}</option>
                  <option value={15}>15 {lang === 'en' ? 'min' : '分'}</option>
                  <option value={30}>30 {lang === 'en' ? 'min' : '分'}</option>
                  <option value={60}>{lang === 'en' ? '1 hour' : '1時間'}</option>
                </select>
              </div>
            </div>
          )}

          {/* Conditional visibility */}
          <div className="bg-amber-50/50 border border-amber-200/40 rounded-xl p-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
              {lang === 'en' ? 'Show only if (optional)' : '条件付き表示（任意）'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={field.conditional_on?.field ?? ''}
                onChange={(e) => {
                  if (!e.target.value) { onUpdate({ conditional_on: undefined }); return; }
                  onUpdate({ conditional_on: { field: e.target.value, equals: field.conditional_on?.equals ?? '' } });
                }}
                className="input text-xs"
              >
                <option value="">— {lang === 'en' ? 'always show' : '常に表示'} —</option>
                {siblingNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <input
                type="text"
                value={String(field.conditional_on?.equals ?? '')}
                onChange={(e) => {
                  if (!field.conditional_on?.field) return;
                  onUpdate({ conditional_on: { field: field.conditional_on.field, equals: e.target.value } });
                }}
                disabled={!field.conditional_on?.field}
                className="input text-xs disabled:opacity-40"
                placeholder={lang === 'en' ? 'equals value' : '等しい値'}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function newRepeatChildField(index: number): FormField {
  return {
    name: `item_${index + 1}`,
    label: '明細項目',
    label_en: 'Line item',
    type: 'text',
    required: false,
  };
}

function RepeatGroupFieldsEditor({
  field,
  computedFieldNames,
  onCreateTotal,
  onUpdate,
}: {
  field: FormField;
  computedFieldNames: string[];
  onCreateTotal: (childIndex: number) => void;
  onUpdate: (patch: Partial<FormField>) => void;
}) {
  const { lang } = useLang();
  const childFields = field.fields ?? [];
  const [expandedChildren, setExpandedChildren] = useState<Set<number>>(new Set());
  const toggleChildExpand = (idx: number) =>
    setExpandedChildren((prev) => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next; });

  const updateChild = (idx: number, patch: Partial<FormField>) => {
    onUpdate({ fields: childFields.map((f, i) => i === idx ? { ...f, ...patch } : f) });
  };
  const removeChild = (idx: number) => onUpdate({ fields: childFields.filter((_, i) => i !== idx) });
  const moveChild = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= childFields.length) return;
    const next = [...childFields];
    [next[idx], next[target]] = [next[target], next[idx]];
    onUpdate({ fields: next });
  };
  const addChild = () => onUpdate({ fields: [...childFields, newRepeatChildField(childFields.length)] });

  const setChildType = (idx: number, type: string) => {
    const child = childFields[idx];
    if (type === 'repeat_group') {
      updateChild(idx, {
        type,
        fields: child.fields ?? [],
        min_rows: child.min_rows ?? 0,
        max_rows: child.max_rows ?? DEFAULT_REPEAT_MAX_ROWS,
        options: undefined,
        multiple: undefined,
        computed: undefined,
        sum_target: undefined,
      });
      return;
    }
    updateChild(idx, {
      type,
      options: ['select', 'checkbox'].includes(type) ? (child.options ?? []) : undefined,
      multiple: type === 'file' ? (child.multiple ?? false) : undefined,
      computed: undefined,
      sum_target: type === 'number' ? child.sum_target : undefined,
      fields: undefined,
      min_rows: undefined,
      max_rows: undefined,
    });
  };

  const setMaxRows = (raw: string) => {
    const next = Math.max(1, Math.min(DEFAULT_REPEAT_MAX_ROWS, Number(raw) || DEFAULT_REPEAT_MAX_ROWS));
    onUpdate({ max_rows: next });
  };

  return (
    <div className="bg-white/50 border border-teal-200/50 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-teal-700">
            {lang === 'en' ? 'Repeatable row fields' : '繰り返し行の項目'}
          </p>
          <p className="text-[10px] text-warmgray-500 mt-0.5">
            {lang === 'en'
              ? 'Each submitted row is stored as one object inside this JSON field.'
              : '各行はこのフィールド内のJSON配列として保存されます。'}
          </p>
        </div>
        <button type="button" onClick={addChild} className="btn-outline text-xs shrink-0">
          + {lang === 'en' ? 'Add row field' : '行項目追加'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input
          type="number"
          min={0}
          max={DEFAULT_REPEAT_MAX_ROWS}
          value={field.min_rows ?? 0}
          onChange={(e) => onUpdate({ min_rows: Math.max(0, Number(e.target.value) || 0) })}
          className="input text-xs"
          placeholder={lang === 'en' ? 'Min rows' : '最小行数'}
        />
        <input
          type="number"
          min={1}
          max={DEFAULT_REPEAT_MAX_ROWS}
          value={field.max_rows ?? DEFAULT_REPEAT_MAX_ROWS}
          onChange={(e) => setMaxRows(e.target.value)}
          className="input text-xs"
          placeholder={lang === 'en' ? 'Max rows' : '最大行数'}
        />
        <input
          type="text"
          value={field.add_label ?? ''}
          onChange={(e) => onUpdate({ add_label: e.target.value || undefined })}
          className="input text-xs"
          placeholder="追加ボタン名"
        />
      </div>

      {childFields.length === 0 ? (
        <div className="rounded-lg border border-dashed border-warmgray-200 bg-white/50 py-6 text-center text-xs text-warmgray-400">
          {lang === 'en' ? 'No row fields yet' : '行項目がありません'}
        </div>
      ) : (
        <div className="space-y-2">
          {childFields.map((child, idx) => {
            const duplicate = childFields.some((f, i) => i !== idx && f.name === child.name);
            return (
              <div key={idx} className="rounded-xl border border-white/80 bg-white/70 p-3 space-y-2">
                {/* Child row header: name + type on one line, actions on second line on mobile */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-warmgray-400 w-6 shrink-0">{idx + 1}</span>
                    <input
                      type="text"
                      value={child.name}
                      onChange={(e) => updateChild(idx, { name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                      className={`input text-xs font-mono flex-1 min-w-0 ${duplicate ? 'border-red-400 ring-1 ring-red-300' : ''}`}
                      placeholder="field_name"
                    />
                  </div>
                  <div className="flex items-center gap-2 pl-8">
                    <select value={child.type} onChange={(e) => setChildType(idx, e.target.value)} className="select text-xs flex-1 min-w-0">
                      {REPEAT_CHILD_FIELD_TYPES.map((ft) => (
                        <option key={ft.value} value={ft.value}>
                          {lang === 'en' ? ft.label_en : ft.label_ja}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button type="button" onClick={() => moveChild(idx, -1)} disabled={idx === 0} className="btn-ghost text-xs px-2.5 py-2 disabled:opacity-30">▲</button>
                      <button type="button" onClick={() => moveChild(idx, 1)} disabled={idx === childFields.length - 1} className="btn-ghost text-xs px-2.5 py-2 disabled:opacity-30">▼</button>
                      <button type="button" onClick={() => toggleChildExpand(idx)} className="btn-ghost text-xs px-2.5 py-2">{expandedChildren.has(idx) ? '−' : '⚙'}</button>
                      <button type="button" onClick={() => removeChild(idx)} className="text-red-400 hover:text-red-600 px-2.5 py-2 text-sm rounded-lg hover:bg-red-50 transition-colors">×</button>
                    </div>
                  </div>
                </div>
                {duplicate && (
                  <p className="text-[10px] text-red-500 pl-8">{lang === 'en' ? 'Duplicate row field name' : '行項目名が重複しています'}</p>
                )}
                <input
                  type="text"
                  value={child.label}
                  onChange={(e) => updateChild(idx, { label: e.target.value })}
                  className="input text-xs w-full"
                  placeholder="日本語ラベル"
                />
                <div className="flex items-center gap-4 flex-wrap">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-warmgray-600">
                    <input
                      type="checkbox"
                      checked={child.required ?? false}
                      onChange={(e) => updateChild(idx, { required: e.target.checked })}
                    />
                    {lang === 'en' ? 'Required' : '必須'}
                  </label>
                  {child.type === 'file' && (
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-warmgray-600">
                      <input
                        type="checkbox"
                        checked={child.multiple ?? false}
                        onChange={(e) => updateChild(idx, { multiple: e.target.checked })}
                      />
                      {lang === 'en' ? 'Multiple files' : '複数ファイル'}
                    </label>
                  )}
                  {child.type === 'number' && (
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-warmgray-600">
                      <input
                        type="checkbox"
                        checked={child.computed ?? false}
                        onChange={(e) => updateChild(idx, { computed: e.target.checked, sum_target: undefined, formula: undefined })}
                      />
                      {lang === 'en' ? 'Auto-sum total' : '自動合計'}
                    </label>
                  )}
                </div>

                {/* Expanded settings panel */}
                {expandedChildren.has(idx) && (
                  <div className="pt-2 border-t border-warmgray-100 space-y-2">
                    <input
                      type="text"
                      value={child.label_en ?? ''}
                      onChange={(e) => updateChild(idx, { label_en: e.target.value || undefined })}
                      className="input text-xs w-full"
                      placeholder="English label"
                    />
                    {['text', 'textarea', 'number', 'date'].includes(child.type) && (
                      <input
                        type="text"
                        value={child.placeholder ?? ''}
                        onChange={(e) => updateChild(idx, { placeholder: e.target.value || undefined })}
                        className="input text-xs w-full"
                        placeholder={lang === 'en' ? 'Placeholder text' : 'プレースホルダー'}
                      />
                    )}
                    {child.type === 'number' && (
                      <input
                        type="text"
                        value={child.unit ?? ''}
                        onChange={(e) => updateChild(idx, { unit: e.target.value || undefined })}
                        className="input text-xs w-full"
                        placeholder={lang === 'en' ? 'Unit (e.g. 人, km)' : '単位（例：人、km）'}
                      />
                    )}
                    {child.type === 'number' && (
                      <input
                        type="text"
                        value={child.formula ?? ''}
                        onChange={(e) => updateChild(idx, { formula: e.target.value || undefined, computed: e.target.value ? true : child.computed })}
                        className="input text-xs w-full font-mono"
                        placeholder={lang === 'en' ? 'Formula (e.g. price * qty)' : '計算式（例：price * qty）'}
                      />
                    )}
                    {child.type === 'ai_file_reader' && (
                      <>
                        <input
                          type="text"
                          value={child.target_date_field ?? ''}
                          onChange={(e) => updateChild(idx, { target_date_field: e.target.value || undefined })}
                          className="input text-xs w-full font-mono"
                          placeholder={lang === 'en' ? 'Date field to fill (e.g. receipt_date)' : '日付フィールド名（例：receipt_date）'}
                        />
                        <input
                          type="text"
                          value={child.target_amount_field ?? ''}
                          onChange={(e) => updateChild(idx, { target_amount_field: e.target.value || undefined })}
                          className="input text-xs w-full font-mono"
                          placeholder={lang === 'en' ? 'Amount field to fill (e.g. receipt_amount)' : '金額フィールド名（例：receipt_amount）'}
                        />
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-semibold text-violet-600">{lang === 'en' ? 'Custom AI fields' : 'カスタムAI抽出'}</span>
                            <button type="button" onClick={() => updateChild(idx, { extract_fields: [...(child.extract_fields ?? []), { target: '', hint: '' }] })} className="text-[10px] text-violet-600 hover:text-violet-800">+ add</button>
                          </div>
                          {(child.extract_fields ?? []).map((ef, ei) => (
                            <div key={ei} className="flex items-center gap-1">
                              <input type="text" value={ef.target} onChange={(e) => { const next = [...(child.extract_fields ?? [])]; next[ei] = { ...ef, target: e.target.value }; updateChild(idx, { extract_fields: next }); }} placeholder="field_name" className="input text-xs font-mono flex-1 min-w-0" />
                              <input type="text" value={ef.hint} onChange={(e) => { const next = [...(child.extract_fields ?? [])]; next[ei] = { ...ef, hint: e.target.value }; updateChild(idx, { extract_fields: next }); }} placeholder="hint" className="input text-xs flex-1 min-w-0" />
                              <button type="button" onClick={() => updateChild(idx, { extract_fields: (child.extract_fields ?? []).filter((_, j) => j !== ei) })} className="text-red-400 text-sm shrink-0">×</button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {child.type === 'user_picker' && (
                      <input
                        type="text"
                        value={child.count_field ?? ''}
                        onChange={(e) => updateChild(idx, { count_field: e.target.value || undefined })}
                        className="input text-xs w-full font-mono"
                        placeholder={lang === 'en' ? 'Count field (e.g. participant_count)' : '人数フィールド名（例：participant_count）'}
                      />
                    )}
                  </div>
                )}

                {child.type === 'number' && (
                  <div className="bg-teal-50/40 border border-teal-200/40 rounded-xl p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-teal-700">
                        {lang === 'en' ? 'Repeat-row auto sum' : '繰り返し行の自動合計'}
                      </label>
                      <button
                        type="button"
                        onClick={() => onCreateTotal(idx)}
                        className="text-[11px] font-semibold text-teal-700 hover:text-teal-900"
                      >
                        + {lang === 'en' ? 'Create total field' : '合計フィールド作成'}
                      </button>
                    </div>
                    {computedFieldNames.length > 0 ? (
                      <select
                        value={child.sum_target ?? ''}
                        onChange={(e) => updateChild(idx, { sum_target: e.target.value || undefined })}
                        className="input text-xs"
                      >
                        <option value="">- {lang === 'en' ? 'Not a sum source' : '加算しない'} -</option>
                        {computedFieldNames.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                    ) : (
                      <div className="rounded-lg border border-dashed border-teal-200 bg-white/60 px-3 py-2 text-xs text-warmgray-500">
                        {lang === 'en'
                          ? 'No auto-sum total field exists yet. Create one here, or add a top-level number field and mark it Auto-sum total.'
                          : '自動合計フィールドがまだありません。ここで作成するか、上位に数値フィールドを追加して自動合計にしてください。'}
                      </div>
                    )}
                    <p className="text-[10px] text-warmgray-500">
                      {lang === 'en'
                        ? 'This number field is summed across every repeated row and written into the selected total field.'
                        : 'この数値項目は、繰り返し行すべての値を合計して選択した合計フィールドに反映されます。'}
                    </p>
                  </div>
                )}
                {(child.type === 'select' || child.type === 'checkbox') && (
                  <OptionsEditor
                    options={child.options ?? []}
                    onChange={(opts) => updateChild(idx, { options: opts })}
                    hint={child.type === 'checkbox'
                      ? (lang === 'en' ? 'Empty = single boolean checkbox. Add options for multi-select.' : '空の場合は単一チェック、選択肢ありの場合は複数選択です。')
                      : undefined}
                  />
                )}
                {child.type === 'repeat_group' && (
                  <RepeatGroupFieldsEditor
                    field={child}
                    computedFieldNames={computedFieldNames}
                    onCreateTotal={() => {/* nested totals not supported at this level */}}
                    onUpdate={(patch) => updateChild(idx, patch)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Options editor for select fields
// ─────────────────────────────────────────────────────────────────────────────
function OptionsEditor({
  options, onChange, hint,
}: {
  options: FieldOption[];
  onChange: (opts: FieldOption[]) => void;
  hint?: string;
}) {
  const { lang } = useLang();
  // Auto-gen stable random value so admin only types the label.
  // Stable = renaming label never breaks existing form_data references.
  const genValue = (): string => {
    const rand = (crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)).replace(/-/g, '');
    return `opt_${rand.slice(0, 8)}`;
  };
  const add = () => onChange([...options, { value: genValue(), label_ja: '', label_en: '' }]);
  const update = (i: number, p: Partial<FieldOption>) =>
    onChange(options.map((o, j) => j === i ? { ...o, ...p } : o));
  const remove = (i: number) => onChange(options.filter((_, j) => j !== i));

  // Backfill missing values on render for options created before auto-gen existed.
  // (Edits any blank-value option to a fresh value next time onChange fires.)

  return (
    <div className="space-y-2 bg-teal-50/40 border border-teal-200/40 rounded-xl p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-teal-700">
          {lang === 'en' ? 'Options' : '選択肢'}
        </p>
        <button onClick={add} className="text-xs font-semibold text-teal-600 hover:text-teal-800">+ {lang === 'en' ? 'Add option' : '選択肢を追加'}</button>
      </div>
      {hint && <p className="text-[10px] text-teal-600/80">{hint}</p>}
      {options.length === 0 ? (
        <p className="text-xs text-warmgray-400 text-center py-2">{lang === 'en' ? 'No options' : '選択肢がありません'}</p>
      ) : (
        options.map((o, i) => (
          <div key={i} className="flex items-center gap-1.5">
            {/* Value input hidden — auto-generated stable key. Admin only edits label. */}
            <input
              type="text"
              value={o.label_ja}
              onChange={(e) => update(i, {
                label_ja: e.target.value,
                ...(o.value ? {} : { value: genValue() }),
              })}
              className="input text-xs flex-1"
              placeholder="日本語"
            />
            <button onClick={() => remove(i)} className="text-red-400 hover:text-red-600 text-sm px-1.5">✕</button>
          </div>
        ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Version history with rollback
// ─────────────────────────────────────────────────────────────────────────────
function VersionHistory({
  versions, onActivate, onDelete, activatingId, deletingId,
}: {
  versions: TemplateVersion[];
  onActivate: (vid: string) => void;
  onDelete:   (vid: string) => void;
  activatingId: string | undefined;
  deletingId:   string | undefined;
}) {
  const { lang } = useLang();
  const [pendingDelete, setPendingDelete] = useState<TemplateVersion | null>(null);

  return (
    <div className="space-y-2">
      <h3 className="section-title">{lang === 'en' ? 'Version history' : 'バージョン履歴'}</h3>
      <p className="text-xs text-warmgray-500">
        {lang === 'en'
          ? 'Click "Activate" on any old version to roll back. Existing applications keep their original schema.'
          : '古いバージョンに戻すと、新しい申請からそのバージョンが使われます。既存の申請は元のバージョンを保持します。'}
      </p>
      <ul className="space-y-2">
        {versions.map((v) => (
          <li key={v.id} className="card !p-4 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-warmgray-800">v{v.version_number}</span>
                {v.is_active && <span className="badge-approved text-[10px]">{lang === 'en' ? 'Active' : '有効'}</span>}
                <span className="text-[11px] text-warmgray-400">
                  {new Date(v.created_at).toLocaleString(lang === 'en' ? 'en-US' : 'ja-JP')}
                </span>
              </div>
              {v.notes && <p className="text-xs text-warmgray-500 mt-1 truncate">{v.notes}</p>}
              {v.created_by_name && <p className="text-[10px] text-warmgray-400 mt-0.5">by {v.created_by_name}</p>}
              <p className="text-[10px] text-warmgray-400 mt-0.5">
                {v.schema_definition?.fields?.length ?? 0} {lang === 'en' ? 'fields' : '項目'}
                {' · '}
                {v.application_count ?? 0} apps
              </p>
            </div>
            {!v.is_active && (
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => onActivate(v.id)}
                  disabled={activatingId === v.id || deletingId === v.id}
                  className="btn-outline text-xs"
                >
                  {activatingId === v.id
                    ? (lang === 'en' ? 'Activating...' : '切替中...')
                    : (lang === 'en' ? 'Activate' : '有効化')}
                </button>
                {(v.application_count ?? 0) === 0 ? (
                  <button
                    onClick={() => setPendingDelete(v)}
                    disabled={activatingId === v.id || deletingId === v.id}
                    className="text-xs px-3 py-1.5 rounded-lg font-semibold border border-red-200/60 text-red-600 hover:bg-red-50 transition-colors"
                    title={lang === 'en' ? 'Delete this unused version' : '未使用バージョンを削除'}
                  >
                    {deletingId === v.id ? '...' : '✕'}
                  </button>
                ) : (
                  <span
                    className="text-[10px] px-2 py-1 rounded-full border border-warmgray-200 text-warmgray-500 bg-warmgray-50"
                    title={lang === 'en' ? 'Locked because applications reference it' : '参照する申請があるため削除不可'}
                  >
                    {v.application_count} apps
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title={lang === 'en' ? 'Delete this version?' : 'このバージョンを削除しますか？'}
        message={lang === 'en'
          ? `v${pendingDelete?.version_number} will be permanently removed. Applications referencing it cannot be deleted.`
          : `v${pendingDelete?.version_number} を削除します。このバージョンを参照する申請がある場合は削除できません。`}
        confirmLabel={lang === 'en' ? 'Delete version' : 'バージョンを削除'}
        confirmClass="btn-danger"
        cancelLabel={lang === 'en' ? 'Cancel' : 'キャンセル'}
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
