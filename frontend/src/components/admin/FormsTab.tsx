// Admin Forms tab — template list + activate/delete. Editing opens FormBuilderV2
// (formbuilder/). OptionsEditor + VersionHistory are shared helpers used by the
// builder. Save creates a new version on the backend; old applications keep their
// original schema reference, so editing never breaks existing data.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useLang } from '../../context/LanguageContext';
import ConfirmDialog from '../common/ConfirmDialog';
import InlineConfirm from '../common/InlineConfirm';
import FormBuilderV2 from './formbuilder/FormBuilderV2';


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
    min_time?:  string;
    max_time?:  string;
    step?:      number;
    /** date: must be ≥ the named sibling field value */
    date_after_or_equal?: string;
    /** number: must be ≤ the named sibling field value */
    max_from_field?: string;
  };
  /** number computed: days between two date fields */
  date_diff_from?: string;
  date_diff_to?:   string;
  conditional_on?: {
    field:  string;
    equals: string | number | boolean;
  };
  /** Layout width override. undefined = auto (type-based default). */
  col_span?: string;
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


// ─────────────────────────────────────────────────────────────────────────────
// Main tab — list of templates
// ─────────────────────────────────────────────────────────────────────────────
export default function FormsTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const { lang } = useLang();
  const queryClient = useQueryClient();
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [betaEditingId, setBetaEditingId] = useState<string | null>(null);
  const [betaCreating, setBetaCreating]   = useState(false);

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
        <button onClick={() => setBetaCreating(true)} className="btn-primary text-xs bg-gradient-to-r from-ringo-500 to-ringo-400">
          ✨ {lang === 'en' ? 'New form' : '新規作成'}
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
                  onClick={() => setBetaEditingId(t.id)}
                  className="btn-primary flex-1 text-xs min-w-[100px] bg-gradient-to-r from-ringo-500 to-ringo-400"
                >
                  ✨ {lang === 'en' ? 'Edit' : '編集'}
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

      {betaEditingId && (
        <FormBuilderV2
          templateId={betaEditingId}
          onClose={() => setBetaEditingId(null)}
          showToast={showToast}
        />
      )}
      {betaCreating && (
        <FormBuilderV2
          templateId={null}
          onClose={() => setBetaCreating(false)}
          showToast={showToast}
        />
      )}

    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Options editor for select fields
// ─────────────────────────────────────────────────────────────────────────────
export function OptionsEditor({
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
              placeholder={lang === 'en' ? 'Option name' : 'オプション名'}
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
export function VersionHistory({
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
