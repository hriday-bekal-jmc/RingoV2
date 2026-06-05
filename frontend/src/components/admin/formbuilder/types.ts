// Shared types, constants, and pure helpers for the form builder.
//
// Single source of truth imported by BOTH the legacy FormsTab editor and the
// new 3-panel FormBuilderV2. Keep this a leaf module (no imports from FormsTab
// or builder components) so there is never a circular-import hazard.

// ── Field option ──────────────────────────────────────────────────────────────
export interface FieldOption {
  value:    string;
  label_ja: string;
  label_en: string;
}

// ── Form field (full property surface — every feature the renderer supports) ────
export interface FormField {
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
  /** Layout width override. undefined = auto (type-based default).
   *  quarter|third|half|twothirds|threequarters|full (legacy: half|full). */
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

export interface FormSchema {
  fields: FormField[];
}

export interface TemplateListItem {
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

export interface TemplateVersion {
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

export interface TemplateDetail {
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

export interface Department {
  id:   string;
  name: string;
}

// ── Curated gradient palette — admin picks via swatch grid (not free-text) ──────
export const GRADIENT_OPTIONS = [
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

// ── Field type registry ─────────────────────────────────────────────────────────
export const FIELD_TYPES = [
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

export const REPEAT_CHILD_FIELD_TYPES = FIELD_TYPES.filter((ft) => ft.value !== 'header');
export const DEFAULT_REPEAT_MAX_ROWS = 50;

// ── Pure helpers ────────────────────────────────────────────────────────────────
// Normalize options: plain strings ["交通費", ...] → {value, label_ja, label_en} objects.
// Migrations often store options as plain strings; the builder always needs objects.
export function normalizeOptions(opts: unknown): FieldOption[] {
  if (!Array.isArray(opts)) return [];
  return opts.map((o) => {
    if (typeof o === 'string') return { value: o, label_ja: o, label_en: o };
    const obj = o as Record<string, string>;
    return {
      value:    obj.value    ?? obj.label_ja ?? obj.label ?? '',
      label_ja: obj.label_ja ?? obj.label    ?? obj.value ?? '',
      label_en: obj.label_en ?? obj.label_ja ?? obj.value ?? '',
    };
  });
}

export function normalizeFields(fields: FormField[]): FormField[] {
  return fields.map((f) => ({
    ...f,
    options: f.options ? normalizeOptions(f.options) : undefined,
    fields:  f.fields  ? normalizeFields(f.fields)   : undefined,
  }));
}

// EN inputs hidden in builder; EN stays blank until dev fills it via /dev/i18n.
export function mirrorFields(fields: FormField[]): FormField[] {
  return fields;
}

// Auto-generated unique template code (admin never sees/types it).
// Format: TMPL_<8 uppercase hex> (URL-safe, fits VARCHAR(50)).
export function genCode(): string {
  const rand = (crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2)).replace(/-/g, '');
  return `TMPL_${rand.slice(0, 8).toUpperCase()}`;
}
