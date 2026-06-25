import { useState, useRef, useEffect, useMemo } from 'react';
import {
  UseFormRegister,
  RegisterOptions,
  FieldError,
  Merge,
  FieldErrorsImpl,
  UseFormSetValue,
  UseFormWatch,
} from 'react-hook-form';
import apiClient from '../../services/apiClient';
import CalendarPicker from './CalendarPicker';
import TimePicker from './TimePicker';
import CustomSelect from './CustomSelect';
import AiFileReaderInput from './AiFileReaderInput';
import UserPickerInput from './UserPickerInput';
import { TRANSPORT_MODE_OPTIONS } from './TransportationForm';
import { evalFormula, formulaDeps } from '../../utils/formulaEval';
import { fieldColSpanClass } from './fieldLayout';
import { useLang } from '../../context/LanguageContext';

// File URLs are same-origin (vite proxy /api in dev, reverse proxy in prod)

interface FormField {
  name: string;
  label: string;          // Japanese (legacy default)
  label_en?: string;      // English (admin-set)
  helper_text?: string;
  placeholder?: string;
  default_value?: string | number | boolean | null;
  type: string;
  required?: boolean;
  multiple?: boolean;
  fields?: FormField[];
  min_rows?: number;
  max_rows?: number;
  add_label?: string;
  add_label_en?: string;
  computed?: boolean;
  sum_target?: string;
  sum_field?:  string;   // child field name to aggregate inside repeat_group
  formula?:    string;   // safe math expression; implies computed
  count_field?: string;  // user_picker: auto-set sibling field with array length
  unit?:       string;   // display unit suffix instead of ¥ prefix (e.g. "人" for counts)
  col_span?: 'half' | 'full';
  show_mode?:         boolean;  // route_entry: show mode selector per row
  show_copy_return?:  boolean;  // route_entry: show copy-return button (default true)
  show_date?:         boolean;  // route_entry: show travel date per row
  target_date_field?:   string;
  target_amount_field?: string;
  date_diff_from?: string;
  date_diff_to?:   string;
  extract_fields?:      Array<{ target: string; hint: string }>;
  file_category?:       string;
  options?: string[] | { value: string; label?: string; label_ja?: string; label_en?: string }[];
  validation?: {
    regex?: string;
    min?: number;
    max?: number;
    maxlength?: number;
    /** Time fields: earliest/latest HH:mm, step in minutes */
    min_time?: string;
    max_time?: string;
    step?: number;
    validate_nights_from?: { check_in: string; check_out: string };
  };
}

interface UploadedFile {
  id: string;
  url: string;
  original_name: string;
}

interface StandardInputProps {
  field: FormField;
  register: UseFormRegister<Record<string, unknown>>;
  setValue?: UseFormSetValue<Record<string, unknown>>;
  watch?: UseFormWatch<Record<string, unknown>>;
  error?: FieldError | Merge<FieldError, FieldErrorsImpl<Record<string, unknown>>>;
  isDraft?: boolean;
  /** Pre-existing comma-separated file URLs (for edit/resubmit scenarios). */
  initialValue?: string;
}

/** Parse a stored file URL back into a display object.
 *  Modern URL: /api/files/<uuid>  (gated, served via authz check)
 *  Legacy URL: /uploads/{timestamp}_{sanitized_original_name}
 *  Both relative — same-origin in prod, vite proxy in dev → cookies sent.
 */
function parseFileUrl(url: string, index: number): UploadedFile {
  const filename = url.split('/').pop() ?? `file_${index + 1}`;
  const original_name = decodeURIComponent(filename.replace(/^\d+_/, ''));
  return { id: url, url, original_name };
}

type RepeatRow = Record<string, unknown>;

const MAX_REPEAT_ROWS = 50;

function isEmptyValue(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function isMeaningfulValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return !isEmptyValue(value);
}

function rowHasValue(row: RepeatRow, fields: FormField[]): boolean {
  return fields.some((f) => f.type !== 'header' && isMeaningfulValue(row[f.name]));
}

function cleanRepeatRows(rows: RepeatRow[], fields: FormField[]): RepeatRow[] {
  return rows
    .filter((row) => rowHasValue(row, fields))
    .map((row) => {
      const clean: RepeatRow = {};
      fields.forEach((f) => {
        if (f.type !== 'header' && !isEmptyValue(row[f.name])) clean[f.name] = row[f.name];
      });
      return clean;
    });
}

function blankRepeatRow(fields: FormField[]): RepeatRow {
  const row: RepeatRow = {};
  fields.forEach((f) => {
    if (f.default_value !== undefined) row[f.name] = f.default_value;
    else if (f.type === 'checkbox' && (!f.options || f.options.length === 0)) row[f.name] = false;
    else row[f.name] = '';
  });
  return row;
}

function normalizeRepeatRows(value: unknown, fields: FormField[], visibleRows: number): RepeatRow[] {
  if (Array.isArray(value) && value.length > 0) {
    return value
      .slice(0, MAX_REPEAT_ROWS)
      .filter((row): row is RepeatRow => typeof row === 'object' && row !== null && !Array.isArray(row))
      .map((row) => ({ ...row }));
  }
  return Array.from({ length: Math.max(1, visibleRows) }, () => blankRepeatRow(fields));
}

function localizedLabel(field: FormField, lang: 'ja' | 'en'): string {
  return lang === 'en' && field.label_en ? field.label_en : field.label;
}

function normalizeOptions(
  options: FormField['options'],
  lang: 'ja' | 'en',
): Array<{ value: string; label: string }> {
  return (options ?? []).map((o) => {
    if (typeof o === 'string') return { value: o, label: o };
    const obj = o as { value: string; label?: string; label_ja?: string; label_en?: string };
    return {
      value: obj.value,
      label: lang === 'en'
        ? (obj.label_en || obj.label_ja || obj.label || obj.value)
        : (obj.label_ja || obj.label || obj.label_en || obj.value),
    };
  });
}

export default function StandardInput({
  field,
  register,
  setValue,
  watch,
  error,
  isDraft,
  initialValue,
}: StandardInputProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track IDs uploaded in this session — only these get DELETE-on-remove.
  // Pre-existing files (from initialValue/watchedValue) are never auto-deleted.
  const newUploadIds = useRef<Set<string>>(new Set());

  // ── Initialise uploaded-file list from existing value ──────────────────────
  // Priority: initialValue prop (explicit) → watch current form value → empty
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>(() => {
    const raw = initialValue ?? '';
    if (!raw) return [];
    return raw
      .split(',')
      .filter(Boolean)
      .map((url, i) => parseFileUrl(url.trim(), i));
  });

  // If form value changes externally (e.g. defaultValues applied after mount),
  // sync the display list once — but only if our local list is still empty.
  const watchedValue = watch ? String(watch(field.name) ?? '') : '';
  useEffect(() => {
    if (field.type !== 'file') return;
    if (uploadedFiles.length > 0) return;   // already initialised — don't overwrite
    if (!watchedValue) return;
    setUploadedFiles(
      watchedValue
        .split(',')
        .filter(Boolean)
        .map((url, i) => parseFileUrl(url.trim(), i)),
    );
  // Only run when the watched value first arrives (not on every change)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedValue]);

  const { lang } = useLang();
  const requiredRule = isDraft ? false : (field.required ?? false);

  // Client-side format rules from field.validation. Surfaces "incompatible
  // format" etc. in RHF errors BEFORE submit → DynamicForm.handleInvalid
  // scrolls to + highlights the offending field (no backend roundtrip).
  // Drafts skip format checks (partial data allowed).
  const en = lang === 'en';
  const textRules = (): RegisterOptions => {
    const r: RegisterOptions = { required: requiredRule };
    if (isDraft) return r;
    const v = field.validation;
    if (v?.regex) {
      try {
        r.pattern = { value: new RegExp(v.regex), message: en ? 'Format is invalid.' : '形式が正しくありません。' };
      } catch { /* invalid stored regex — skip client check, backend still guards */ }
    }
    if (v?.maxlength) {
      r.maxLength = { value: v.maxlength, message: en ? `Up to ${v.maxlength} characters.` : `${v.maxlength}文字以内で入力してください。` };
    }
    return r;
  };
  const numberRules = (): RegisterOptions => {
    const r: RegisterOptions = { required: requiredRule, valueAsNumber: true };
    if (isDraft) return r;
    const v = field.validation;
    if (typeof v?.min === 'number') r.min = { value: v.min, message: en ? `Must be ${v.min} or more.` : `${v.min}以上で入力してください。` };
    if (typeof v?.max === 'number') r.max = { value: v.max, message: en ? `Must be ${v.max} or less.` : `${v.max}以下で入力してください。` };
    return r;
  };

  // ── File upload ────────────────────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadError(null);

    const formData = new FormData();
    Array.from(files).forEach((f) => formData.append('files', f));
    formData.append('field_name', field.name);

    try {
      const res = await apiClient.post('/uploads', formData);
      const newFiles: UploadedFile[] = (res.data.files as UploadedFile[]).map((f: UploadedFile) => ({
        ...f,
        // Keep URL relative — same-origin in prod / vite proxy in dev means cookie auto-sent
        url: f.url,
      }));
      newFiles.forEach((f) => newUploadIds.current.add(f.id));
      const updated = [...uploadedFiles, ...newFiles];
      setUploadedFiles(updated);
      setValue?.(field.name, updated.map((f) => f.url).join(','));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setUploadError(msg ?? 'アップロードに失敗しました');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeFile = (id: string) => {
    // Fire-and-forget DELETE for files uploaded this session (unlinked = safe to delete).
    if (newUploadIds.current.has(id)) {
      newUploadIds.current.delete(id);
      apiClient.delete(`/files/${id}`).catch(() => {});
    }
    const updated = uploadedFiles.filter((f) => f.id !== id);
    setUploadedFiles(updated);
    setValue?.(field.name, updated.map((f) => f.url).join(','));
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  // Prefer EN label when lang=en AND label_en provided; otherwise fall back
  // to the legacy Japanese `label` field (kept for backward compat).
  const displayLabel = lang === 'en' && field.label_en ? field.label_en : field.label;
  const hasError = !!error && !isDraft;
  return (
    <div
      id={`field-${field.name}`}
      data-field-error={hasError ? 'true' : undefined}
      // scroll-mt keeps the field clear of any sticky header when scrolled into view.
      // Ring is an outline (no box-model space) → highlight never shifts layout.
      className={`flex flex-col gap-1.5 scroll-mt-24 transition-all duration-200 ${
        hasError ? 'ring-1 ring-red-300 rounded-xl p-2 -m-2 bg-red-50/30' : ''
      }`}
    >
      <label className={`label-normal ${hasError ? 'text-red-600' : ''}`}>
        {displayLabel}
        {field.required && !isDraft && <span className="text-ringo-500 ml-0.5">*</span>}
      </label>
      {field.helper_text && (
        <p className="text-[11px] text-warmgray-400 -mt-0.5">{field.helper_text}</p>
      )}

      {field.type === 'repeat_group' && (
        <RepeatGroupInput
          field={field}
          register={register}
          setValue={setValue}
          watch={watch}
          isDraft={isDraft}
        />
      )}

      {field.type === 'text' && (
        <input
          type="text"
          placeholder={field.placeholder}
          {...register(field.name, textRules())}
          className="input"
        />
      )}

      {field.type === 'select' && (() => {
        const watched = watch ? String(watch(field.name) ?? '') : '';
        // Normalise options — supports string[], {value,label}[], and admin
        // {value, label_ja, label_en}[]. Pick locale-correct label.
        const opts = (field.options ?? []).map((o) => {
          if (typeof o === 'string') return { value: o, label: o };
          const obj = o as { value: string; label?: string; label_ja?: string; label_en?: string };
          const label = lang === 'en'
            ? (obj.label_en || obj.label_ja || obj.label || obj.value)
            : (obj.label_ja || obj.label || obj.label_en || obj.value);
          return { value: obj.value, label };
        });
        return (
          <>
            <input type="hidden" {...register(field.name, { required: requiredRule })} />
            <CustomSelect
              options={opts}
              value={watched}
              onChange={(v) => setValue?.(field.name, v)}
              placeholder={field.placeholder}
            />
          </>
        );
      })()}

      {field.type === 'number' && !field.computed && (
        <input
          type="number"
          placeholder={field.placeholder}
          {...register(field.name, numberRules())}
          className="input"
        />
      )}

      {field.type === 'date' && (() => {
        const watched = watch ? String(watch(field.name) ?? '') : '';
        return (
          <>
            <input type="hidden" {...register(field.name, { required: requiredRule })} />
            <CalendarPicker
              value={watched}
              onChange={(v) => setValue?.(field.name, v)}
              required={field.required}
            />
          </>
        );
      })()}

      {field.type === 'time' && (() => {
        const watched = watch ? String(watch(field.name) ?? '') : '';
        return (
          <>
            <input
              type="hidden"
              {...register(field.name, {
                required: requiredRule,
                validate: (v) => {
                  if (!v) return true;
                  if (!/^\d{2}:\d{2}$/.test(String(v)))
                    return lang === 'en' ? 'Invalid time format' : '時刻の形式が正しくありません';
                  if (field.validation?.min_time && String(v) < field.validation.min_time)
                    return lang === 'en'
                      ? `Must be ${field.validation.min_time} or later`
                      : `${field.validation.min_time} 以降を入力してください`;
                  if (field.validation?.max_time && String(v) > field.validation.max_time)
                    return lang === 'en'
                      ? `Must be ${field.validation.max_time} or earlier`
                      : `${field.validation.max_time} 以前を入力してください`;
                  return true;
                },
              })}
            />
            <TimePicker
              value={watched}
              onChange={(v) => setValue?.(field.name, v)}
              minTime={field.validation?.min_time}
              maxTime={field.validation?.max_time}
              step={field.validation?.step ?? 1}
            />
          </>
        );
      })()}

      {field.type === 'textarea' && (
        <textarea
          placeholder={field.placeholder}
          {...register(field.name, textRules())}
          className="input resize-y"
          rows={3}
        />
      )}

      {/* Checkbox — boolean (single) or multi-choice group with options */}
      {field.type === 'checkbox' && (() => {
        const opts = (field.options ?? []) as Array<{ value: string; label_ja?: string; label_en?: string; label?: string }>;
        // Boolean checkbox when no options configured
        if (!opts || opts.length === 0) {
          return (
            <label className="flex items-center gap-2 cursor-pointer text-sm text-warmgray-700">
              <input
                type="checkbox"
                {...register(field.name)}
                className="w-4 h-4 accent-ringo-500"
              />
              {field.placeholder ?? displayLabel}
            </label>
          );
        }
        // Multi-select group when options exist
        const watched = (watch ? watch(field.name) : []) as string[] | string | undefined;
        const checkedSet = new Set<string>(
          Array.isArray(watched) ? watched : (watched ? [watched] : []),
        );
        return (
          <>
            <input type="hidden" {...register(field.name, { required: requiredRule })} />
            <div className="flex flex-wrap gap-3 px-3 py-2.5 rounded-xl bg-white/50 border border-white/80">
              {opts.map((o) => {
                const id = `${field.name}-${o.value}`;
                const isOn = checkedSet.has(o.value);
                return (
                  <label key={o.value} htmlFor={id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg cursor-pointer text-sm font-medium transition-colors ${
                    isOn ? 'bg-ringo-50 text-ringo-700 border border-ringo-200/80' : 'bg-white/60 text-warmgray-600 border border-white/80 hover:bg-white/90'
                  }`}>
                    <input
                      id={id}
                      type="checkbox"
                      checked={isOn}
                      onChange={() => {
                        const next = new Set(checkedSet);
                        if (next.has(o.value)) next.delete(o.value); else next.add(o.value);
                        setValue?.(field.name, Array.from(next));
                      }}
                      className="w-3.5 h-3.5 accent-ringo-500"
                    />
                    {lang === 'en'
                      ? (o.label_en || o.label_ja || o.label || o.value)
                      : (o.label_ja || o.label || o.label_en || o.value)}
                  </label>
                );
              })}
            </div>
          </>
        );
      })()}

      {/* Computed / formula / sum_target — read-only auto-calculated */}
      {field.type === 'number' && (field.computed || field.formula) && (
        <ComputedNumberDisplay field={field} watch={watch} setValue={setValue} register={register} />
      )}

      {/* File upload — immediate upload, URL stored in hidden field */}
      {field.type === 'file' && (
        <div className="space-y-2">
          <input type="hidden" {...register(field.name, { required: requiredRule })} />

          {/* Drop zone */}
          <label
            className={`flex items-center justify-center gap-2 w-full py-6 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-150 ${
              uploading
                ? 'border-ringo-300 bg-ringo-50/30 opacity-60'
                : 'border-surface-300 hover:border-ringo-300 hover:bg-ringo-50/20 bg-white/40'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple={field.multiple}
              className="sr-only"
              onChange={handleFileChange}
              disabled={uploading}
            />
            {uploading ? (
              <>
                <svg className="animate-spin w-4 h-4 text-ringo-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span className="text-sm text-ringo-500 font-medium">アップロード中...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5 text-warmgray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                </svg>
                <div className="text-center">
                  <span className="text-sm font-medium text-warmgray-600">クリックしてファイルを追加</span>
                  <p className="text-[11px] text-warmgray-400 mt-0.5">PDF・画像・Excel / 最大 20MB</p>
                </div>
              </>
            )}
          </label>

          {uploadError && (
            <p className="text-xs text-ringo-500 flex items-center gap-1">
              <span>⚠</span> {uploadError}
            </p>
          )}

          {/* Existing + newly uploaded files */}
          {uploadedFiles.length > 0 && (
            <ul className="space-y-1.5">
              {uploadedFiles.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center gap-2 bg-white/60 border border-white/80 rounded-lg px-3 py-2"
                >
                  <svg className="w-4 h-4 text-warmgray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                  </svg>
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-xs text-ringo-600 hover:text-ringo-700 truncate font-medium"
                  >
                    {f.original_name}
                  </a>
                  <button
                    type="button"
                    onClick={() => removeFile(f.id)}
                    title="削除"
                    className="text-warmgray-400 hover:text-red-500 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {field.type === 'allowance_days' && (
        <AllowanceDaysInput field={field} setValue={setValue} watch={watch} isDraft={isDraft} />
      )}

      {field.type === 'route_entry' && (
        <RouteEntryInput field={field} setValue={setValue} watch={watch} isDraft={isDraft} />
      )}

      {field.type === 'ai_file_reader' && setValue && (
        <>
          <input type="hidden" {...register(field.name, { required: requiredRule })} />
          <AiFileReaderInput
            field={field}
            setValue={setValue}
            currentValue={watch ? String(watch(field.name) ?? '') : ''}
            error={typeof error?.message === 'string' ? error.message : undefined}
            disabled={false}
          />
        </>
      )}

      {field.type === 'user_picker' && setValue && (
        <>
          <input type="hidden" {...register(field.name, { required: requiredRule })} />
          <UserPickerInput
            field={field}
            setValue={setValue}
            currentValue={watch ? String(watch(field.name) ?? '') : ''}
            error={typeof error?.message === 'string' ? error.message : undefined}
          />
        </>
      )}

      {error && !isDraft && (
        <p className="text-xs text-ringo-500 flex items-center gap-1">
          <span>⚠</span> {typeof error.message === 'string' && error.message ? error.message : 'この項目は必須です'}
        </p>
      )}
    </div>
  );
}

// ── ComputedNumberDisplay ─────────────────────────────────────────────────────
// Handles three computed number variants:
//   1. formula  — reactive expression evaluated from sibling field values
//   2. sum_target + sum_field — sums a child field across a repeat_group array
//   3. plain computed — set externally (e.g. by user_picker count_field)
function ComputedNumberDisplay({
  field, watch, setValue, register,
}: {
  field: FormField;
  watch?: UseFormWatch<Record<string, unknown>>;
  setValue?: UseFormSetValue<Record<string, unknown>>;
  register: UseFormRegister<Record<string, unknown>>;
}) {
  const { lang } = useLang();

  // Collect formula deps so we only watch + recompute when they change
  const deps = useMemo(() => formulaDeps(field.formula ?? ''), [field.formula]);

  // Watch ONLY the fields this calculation needs (not the whole form). Subscribing
  // to every field via watch() re-rendered this component on every keystroke
  // anywhere, which raced with typing and made digits appear to drop.
  const watchNames = useMemo(() => {
    const n = new Set<string>();
    deps.forEach((d) => n.add(d));
    if (field.date_diff_from) n.add(field.date_diff_from);
    if (field.date_diff_to)   n.add(field.date_diff_to);
    if (field.sum_target)     n.add(field.sum_target);
    n.add(field.name); // own value — needed for injected/plain-computed display
    return Array.from(n);
  }, [deps, field.date_diff_from, field.date_diff_to, field.sum_target, field.name]);

  const watchedArr = (watch ? watch(watchNames) : []) as unknown[];
  const valMap: Record<string, unknown> = {};
  watchNames.forEach((nm, i) => { valMap[nm] = watchedArr[i]; });

  // Compute the value DURING render so the display is always fresh (no 1-frame lag).
  const computeValue = (): number => {
    if (field.date_diff_from && field.date_diff_to) {
      const from = valMap[field.date_diff_from];
      const to   = valMap[field.date_diff_to];
      if (typeof from === 'string' && typeof to === 'string' && from && to) {
        return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
      }
      return 0;
    }
    if (field.formula && deps.length > 0) {
      const numValues: Record<string, number> = {};
      for (const dep of deps) {
        const v = valMap[dep];
        numValues[dep] = typeof v === 'number' ? v : parseFloat(String(v ?? '0')) || 0;
      }
      return evalFormula(field.formula, numValues);
    }
    if (field.sum_target && field.sum_field) {
      const rows = valMap[field.sum_target];
      if (Array.isArray(rows)) {
        return rows.reduce((acc: number, row: unknown) => {
          const r = row as Record<string, unknown>;
          const v = parseFloat(String(r[field.sum_field!] ?? '0'));
          return acc + (isFinite(v) ? v : 0);
        }, 0);
      }
      return 0;
    }
    // Injected / plain computed (e.g. set by SumWatcher or user_picker) — just read it.
    return Number(valMap[field.name]) || 0;
  };

  const isAutoComputed = !!(field.formula || (field.sum_target && field.sum_field) || field.date_diff_from);
  const current = computeValue();

  // Persist the computed value into the form (for submission). Display already
  // shows `current`, so this effect never affects what the user sees.
  useEffect(() => {
    if (!setValue || !isAutoComputed) return;
    setValue(field.name as never, current as never, { shouldDirty: false, shouldValidate: false, shouldTouch: false });
  }, [current, isAutoComputed, setValue, field.name]);

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-teal-50/60 border border-teal-200/60">
      <input type="hidden" {...register(field.name, { valueAsNumber: true })} />
      <span className="text-xl font-bold text-teal-700">
        {field.unit
          ? `${current.toLocaleString('ja-JP')} ${field.unit}`
          : `¥${current.toLocaleString('ja-JP')}`}
      </span>
      <span className="text-xs text-teal-500 font-medium">{lang === 'en' ? '(auto)' : '（自動計算）'}</span>
    </div>
  );
}

// ── AllowanceDaysInput ────────────────────────────────────────────────────────
// Reusable 0 / 半日 / 1日 picker. Syncs value (0 | 0.5 | 1) to react-hook-form.
// Add to any form schema with type: 'allowance_days'.
function AllowanceDaysInput({
  field,
  setValue,
  watch,
}: {
  field: FormField;
  setValue?: UseFormSetValue<Record<string, unknown>>;
  watch?: UseFormWatch<Record<string, unknown>>;
  isDraft?: boolean;
}) {
  const { lang } = useLang();
  const rawVal = watch?.(field.name);
  const current = rawVal !== undefined && rawVal !== null ? Number(rawVal) : 0;

  const set = (v: 0 | 0.5 | 1) => {
    setValue?.(field.name, v, { shouldDirty: true, shouldTouch: false, shouldValidate: false });
  };

  const OPTIONS: { value: 0 | 0.5 | 1; label_ja: string; label_en: string }[] = [
    { value: 0,   label_ja: '0日',  label_en: '0 days' },
    { value: 0.5, label_ja: '半日', label_en: 'Half day' },
    { value: 1,   label_ja: '1日',  label_en: '1 day' },
  ];

  return (
    <div className="flex gap-2">
      {OPTIONS.map(({ value, label_ja, label_en }) => (
        <button
          key={value}
          type="button"
          onClick={() => set(value)}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
            current === value
              ? 'bg-ringo-600 text-white border-ringo-600 shadow-sm'
              : 'bg-white border-warmgray-200 text-warmgray-700 hover:border-ringo-300 hover:bg-ringo-50'
          }`}
        >
          {lang === 'en' ? label_en : label_ja}
        </button>
      ))}
    </div>
  );
}

// ── RouteEntryInput ────────────────────────────────────────────────────────────
interface RouteRow {
  id: string;
  mode?: string;
  mode_custom?: string;
  from_station: string;
  to_station: string;
  fare: number;
  travel_date?: string;
}

function RouteEntryInput({
  field,
  setValue,
  watch,
}: {
  field: FormField;
  setValue?: UseFormSetValue<Record<string, unknown>>;
  watch?: UseFormWatch<Record<string, unknown>>;
  isDraft?: boolean;
}) {
  const { lang } = useLang();
  const rawVal = watch?.(field.name);

  const parseRoutes = (val: unknown): RouteRow[] => {
    if (Array.isArray(val)) {
      return (val as RouteRow[]).map((r) => ({
        id:           r.id ?? crypto.randomUUID(),
        mode:         r.mode,
        mode_custom:  r.mode_custom,
        from_station: r.from_station ?? '',
        to_station:   r.to_station ?? '',
        fare:         Number(r.fare) || 0,
        travel_date:  r.travel_date,
      }));
    }
    return [{ id: crypto.randomUUID(), from_station: '', to_station: '', fare: 0 }];
  };

  const [routes, setRoutes] = useState<RouteRow[]>(() => parseRoutes(rawVal));

  const lastRouteRef = useRef<string>('');
  useEffect(() => {
    const serialized = JSON.stringify(routes);
    lastRouteRef.current = serialized;
    setValue?.(field.name, routes, { shouldDirty: true, shouldTouch: false, shouldValidate: false });
  }, [routes, field.name, setValue]);

  // Resync on external reset (e.g. copy from ringi)
  useEffect(() => {
    if (!Array.isArray(rawVal) || rawVal.length === 0) return;
    if (JSON.stringify(rawVal) === lastRouteRef.current) return;
    setRoutes(parseRoutes(rawVal));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawVal]);

  const update  = (i: number, patch: Partial<RouteRow>) =>
    setRoutes((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add     = () => setRoutes((prev) => [...prev, { id: crypto.randomUUID(), from_station: '', to_station: '', fare: 0 }]);
  const remove  = (i: number) => setRoutes((prev) => prev.filter((_, j) => j !== i));
  const swap    = (i: number) =>
    setRoutes((prev) => prev.map((r, j) => j === i ? { ...r, from_station: r.to_station, to_station: r.from_station } : r));
  const copyReturn = () => {
    const last = routes[routes.length - 1];
    if (!last) return;
    setRoutes((prev) => [
      ...prev,
      { id: crypto.randomUUID(), mode: last.mode, mode_custom: last.mode_custom, from_station: last.to_station, to_station: last.from_station, fare: last.fare },
    ]);
  };

  const total = routes.reduce((s, r) => s + (Number(r.fare) || 0), 0);

  const normalizedOptions = useMemo(() => {
    const opts = field.options && Array.isArray(field.options) && field.options.length > 0
      ? field.options as Array<{ value: string; label_ja?: string; label_en?: string; label?: string }>
      : TRANSPORT_MODE_OPTIONS;
    return opts.map((o) => ({
      value: o.value,
      // Use || so empty string falls through to the other language label or value
      label: (lang === 'en'
        ? (o.label_en || o.label_ja)
        : (o.label_ja || o.label_en)
      ) || (o as { label?: string }).label || o.value,
    }));
  }, [field.options, lang]);

  return (
    <div className="space-y-2 rounded-xl border border-ringo-100 bg-ringo-50/40 p-3">
      {routes.map((r, i) => (
        <div key={r.id} className="flex flex-col gap-1.5">
          {/* Date row */}
          {field.show_date && (
            <div className="sm:w-56">
              <CalendarPicker
                value={r.travel_date ?? ''}
                onChange={(val) => update(i, { travel_date: val || undefined })}
              />
            </div>
          )}
          {/* Mode row */}
          {field.show_mode && (
            <div className="flex items-center gap-2">
              <CustomSelect
                value={r.mode ?? ''}
                onChange={(val) => update(i, { mode: val, mode_custom: val !== 'other' ? undefined : r.mode_custom })}
                placeholder={lang === 'en' ? 'Mode' : '交通手段'}
                options={normalizedOptions}
                className="text-xs w-full sm:w-auto"
              />
              {r.mode === 'other' && (
                <input
                  type="text"
                  value={r.mode_custom ?? ''}
                  onChange={(e) => update(i, { mode_custom: e.target.value })}
                  placeholder={lang === 'en' ? 'Specify transport' : '交通手段を入力'}
                  className="input flex-1 text-xs"
                />
              )}
            </div>
          )}
          {/* From / swap / to / fare / delete */}
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={r.from_station}
              onChange={(e) => update(i, { from_station: e.target.value })}
              placeholder={lang === 'ja' ? '出発地' : 'From'}
              className="input flex-1 min-w-0 text-sm"
            />
            <button
              type="button"
              onClick={() => swap(i)}
              title={lang === 'ja' ? '乗降駅を入替' : 'Swap stations'}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-warmgray-200 bg-white text-warmgray-400 hover:text-ringo-600 hover:border-ringo-300 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
            <input
              type="text"
              value={r.to_station}
              onChange={(e) => update(i, { to_station: e.target.value })}
              placeholder={lang === 'ja' ? '到着地' : 'To'}
              className="input flex-1 min-w-0 text-sm"
            />
            <div className="relative shrink-0 w-20">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-warmgray-400 pointer-events-none">¥</span>
              <input
                type="number"
                min={0}
                step={1}
                value={r.fare || ''}
                onChange={(e) => update(i, { fare: Number(e.target.value) || 0 })}
                className="input pl-5 text-sm"
              />
            </div>
            {routes.length > 1 && (
              <button type="button" onClick={() => remove(i)} className="shrink-0 text-warmgray-300 hover:text-red-400 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <button type="button" onClick={add} className="text-xs text-ringo-600 hover:text-ringo-700 font-medium">
          + {lang === 'ja' ? '経路追加' : 'Add route'}
        </button>
        {field.show_copy_return !== false && (
          <button
            type="button"
            onClick={copyReturn}
            disabled={routes.length === 0}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-ringo-300/70 bg-ringo-50/60 px-2.5 py-1 text-xs font-semibold text-ringo-600 hover:bg-ringo-50 disabled:opacity-40 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            {lang === 'ja' ? '復路コピー' : 'Copy return'}
          </button>
        )}
        <span className="ml-auto text-xs font-semibold text-warmgray-600 tabular-nums">
          {lang === 'ja' ? '合計' : 'Total'}: ¥{total.toLocaleString('ja-JP')}
        </span>
      </div>
    </div>
  );
}

function RepeatGroupInput({
  field,
  register,
  setValue,
  watch,
  isDraft,
}: {
  field: FormField;
  register: UseFormRegister<Record<string, unknown>>;
  setValue?: UseFormSetValue<Record<string, unknown>>;
  watch?: UseFormWatch<Record<string, unknown>>;
  isDraft?: boolean;
}) {
  const { lang } = useLang();
  const childFields = useMemo(
    () => (field.fields ?? []).filter((f) => f.type !== 'header'),
    [field.fields],
  );
  const minRows = Math.max(0, Number(field.min_rows ?? ((field.required && !isDraft) ? 1 : 0)) || 0);
  const maxRows = Math.max(1, Math.min(MAX_REPEAT_ROWS, Number(field.max_rows ?? MAX_REPEAT_ROWS) || MAX_REPEAT_ROWS));
  const initialVisibleRows = Math.min(maxRows, Math.max(1, minRows));

  const [rows, setRows] = useState<RepeatRow[]>(() =>
    normalizeRepeatRows(watch?.(field.name), childFields, initialVisibleRows),
  );

  const storedRows = useMemo(() => cleanRepeatRows(rows, childFields), [rows, childFields]);

  // Sync ref so the resync effect can compare without a stale closure.
  const storedRowsRef = useRef(storedRows);
  storedRowsRef.current = storedRows;

  // Flag set by Effect A so Effect B skips the cycle where we just wrote to RHF.
  // Prevents a race: watchedExternal captured at render time is one cycle behind
  // storedRows, so a JSON comparison there would always misfire.
  const justWroteRef = useRef(false);

  useEffect(() => {
    justWroteRef.current = true;
    setValue?.(field.name, storedRows, {
      shouldDirty: true,
      shouldTouch: false,
      shouldValidate: false,
    });
  }, [field.name, setValue, storedRows]);

  // Resync local rows when an external reset pushes new data into RHF
  // (e.g. copy-from-ringi). Skipped when Effect A fired in the same cycle.
  const watchedExternal = watch?.(field.name);
  useEffect(() => {
    if (justWroteRef.current) { justWroteRef.current = false; return; }
    if (!Array.isArray(watchedExternal) || watchedExternal.length === 0) return;
    if (JSON.stringify(watchedExternal) === JSON.stringify(storedRowsRef.current)) return;
    setRows(normalizeRepeatRows(watchedExternal, childFields, initialVisibleRows));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedExternal]);

  const updateCell = (rowIndex: number, childName: string, value: unknown) => {
    setRows((prev) => {
      const next = prev.map((row, i) => i === rowIndex ? { ...row, [childName]: value } : row);
      // Auto-calc nights when check-in or check-out date changes
      const nightsField = childFields.find((f) => f.validation?.validate_nights_from);
      if (nightsField) {
        const { check_in: ciKey, check_out: coKey } = nightsField.validation!.validate_nights_from as { check_in: string; check_out: string };
        if (childName === ciKey || childName === coKey) {
          const row = next[rowIndex];
          const ci = String(childName === ciKey ? value : (row[ciKey] ?? ''));
          const co = String(childName === coKey ? value : (row[coKey] ?? ''));
          if (ci && co) {
            const diff = Math.round((new Date(co).getTime() - new Date(ci).getTime()) / 86_400_000);
            if (diff >= 0) {
              return next.map((r, i) => i === rowIndex ? { ...r, [nightsField.name]: diff } : r);
            }
          }
        }
      }
      return next;
    });
  };

  const addRow = () => {
    setRows((prev) => prev.length >= maxRows ? prev : [...prev, blankRepeatRow(childFields)]);
  };

  const removeRow = (rowIndex: number) => {
    setRows((prev) => {
      if (prev.length <= Math.max(1, minRows)) return prev;
      return prev.filter((_, i) => i !== rowIndex);
    });
  };

  const validateRows = () => {
    if (minRows > 0 && storedRows.length < minRows) {
      return lang === 'en' ? `Add at least ${minRows} row(s).` : `${minRows}行以上追加してください。`;
    }
    for (const [rowIndex, row] of storedRows.entries()) {
      for (const child of childFields) {
        if (!child.required) continue;
        if (isEmptyValue(row[child.name])) {
          return `${localizedLabel(child, lang)} ${lang === 'en' ? `is required in row ${rowIndex + 1}.` : `は${rowIndex + 1}行目で必須です。`}`;
        }
      }
    }
    return true;
  };

  const addLabel = lang === 'en'
    ? (field.add_label_en || field.add_label || 'Add row')
    : (field.add_label || field.add_label_en || '行を追加');

  if (childFields.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-warmgray-200 bg-white/50 px-4 py-6 text-center text-sm text-warmgray-400">
        {lang === 'en' ? 'No row fields are configured yet.' : '行項目が設定されていません。'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input type="hidden" {...register(field.name, { validate: validateRows })} />
      <div className="rounded-2xl border border-white/80 bg-white/40 p-3 space-y-3">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="rounded-xl border border-surface-200/80 bg-white/80 p-3 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-warmgray-400">
                {lang === 'en' ? `Row ${rowIndex + 1}` : `${rowIndex + 1}行目`}
              </span>
              <button
                type="button"
                onClick={() => removeRow(rowIndex)}
                disabled={rows.length <= Math.max(1, minRows)}
                className="text-xs font-semibold text-warmgray-400 hover:text-red-500 disabled:opacity-30 disabled:hover:text-warmgray-400"
              >
                {lang === 'en' ? 'Remove' : '削除'}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-x-4 gap-y-3">
              {childFields.map((child) => (
                <div
                  key={child.name}
                  className={`min-w-0 ${fieldColSpanClass(child)}`}
                >
                  <RepeatCell
                    groupName={field.name}
                    rowIndex={rowIndex}
                    field={child}
                    value={row[child.name]}
                    onChange={(value) => updateCell(rowIndex, child.name, value)}
                    onFillSibling={(name, value) => updateCell(rowIndex, name, value)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addRow}
          disabled={rows.length >= maxRows}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-ringo-200 bg-ringo-50/30 px-4 py-3 text-sm font-semibold text-ringo-600 hover:bg-ringo-50 disabled:opacity-40 disabled:hover:bg-ringo-50/30 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          {addLabel}
          <span className="text-[11px] text-ringo-400">({rows.length}/{maxRows})</span>
        </button>
      </div>
    </div>
  );
}

// Inline 1-level nested repeat group — no react-hook-form registration, just value/onChange
function NestedRepeatGroupInput({
  parentGroupName,
  parentRowIndex,
  field,
  value,
  onChange,
}: {
  parentGroupName: string;
  parentRowIndex: number;
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { lang } = useLang();
  const childFields = field.fields ?? [];
  const rows: Record<string, unknown>[] = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const addLabel = (lang === 'en' ? (field.add_label_en ?? 'Add row') : (field.add_label ?? '行を追加'));
  const maxRows = field.max_rows ?? 50;

  const addRow = () => {
    const blank: Record<string, unknown> = { id: crypto.randomUUID() };
    childFields.forEach((cf) => { blank[cf.name] = cf.type === 'number' ? 0 : ''; });
    onChange([...rows, blank]);
  };

  const removeRow = (ri: number) => onChange(rows.filter((_, i) => i !== ri));

  const updateCell = (ri: number, name: string, val: unknown) => {
    onChange(rows.map((r, i) => i === ri ? { ...r, [name]: val } : r));
  };

  return (
    <div className="rounded-xl border border-warmgray-200 bg-warmgray-50/50 p-2 space-y-2">
      {rows.length === 0 ? (
        <p className="text-xs text-warmgray-400 text-center py-2">
          {lang === 'en' ? 'No rows yet' : '行がありません'}
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, ri) => (
            <div key={ri} className="rounded-lg border border-white/80 bg-white/70 p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-warmgray-400">#{ri + 1}</span>
                <button type="button" onClick={() => removeRow(ri)} className="text-red-400 hover:text-red-600 text-xs">×</button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {childFields.map((cf) => (
                  <RepeatCell
                    key={cf.name}
                    groupName={`${parentGroupName}_${parentRowIndex}_${field.name}`}
                    rowIndex={ri}
                    field={cf}
                    value={row[cf.name]}
                    onChange={(val) => updateCell(ri, cf.name, val)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {rows.length < maxRows && (
        <button
          type="button"
          onClick={addRow}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-warmgray-300 bg-white/60 py-1.5 text-xs font-semibold text-warmgray-500 hover:border-ringo-300 hover:text-ringo-600 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          {addLabel}
        </button>
      )}
    </div>
  );
}

function RepeatCell({
  groupName,
  rowIndex,
  field,
  value,
  onChange,
  onFillSibling,
}: {
  groupName: string;
  rowIndex: number;
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  onFillSibling?: (name: string, value: unknown) => void;
}) {
  const { lang } = useLang();
  const label = localizedLabel(field, lang);
  const requiredMark = field.required ? <span className="text-ringo-500 ml-0.5">*</span> : null;

  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label className="text-xs font-bold text-warmgray-500 break-words [overflow-wrap:anywhere]">
        {label}{requiredMark}
      </label>

      {field.type === 'text' && (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="input"
        />
      )}

      {field.type === 'textarea' && (
        <textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="input min-h-[90px] resize-y whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
          rows={3}
        />
      )}

      {field.type === 'number' && (
        <input
          type="number"
          value={value === 0 ? 0 : String(value ?? '')}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          placeholder={field.placeholder}
          className="input"
        />
      )}

      {field.type === 'date' && (
        <CalendarPicker
          value={String(value ?? '') || undefined}
          onChange={(val) => onChange(val)}
          required={field.required}
        />
      )}

      {field.type === 'time' && (
        <TimePicker
          value={String(value ?? '')}
          onChange={onChange}
          minTime={field.validation?.min_time}
          maxTime={field.validation?.max_time}
          step={field.validation?.step ?? 1}
        />
      )}

      {field.type === 'select' && (
        <CustomSelect
          value={String(value ?? '')}
          onChange={(val) => onChange(val)}
          options={normalizeOptions(field.options, lang)}
        />
      )}

      {field.type === 'checkbox' && (() => {
        const opts = normalizeOptions(field.options, lang);
        if (opts.length === 0) {
          return (
            <label className="inline-flex items-center gap-2 text-sm text-warmgray-700">
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => onChange(e.target.checked)}
                className="w-4 h-4 accent-ringo-500"
              />
              {field.placeholder ?? label}
            </label>
          );
        }
        const current = new Set(Array.isArray(value) ? value.map(String) : (value ? [String(value)] : []));
        return (
          <div className="flex flex-wrap gap-2 rounded-xl bg-white/50 border border-white/80 px-3 py-2">
            {opts.map((o) => {
              const checked = current.has(o.value);
              return (
                <label key={o.value} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                  checked ? 'border-ringo-200 bg-ringo-50 text-ringo-700' : 'border-surface-200 bg-white/70 text-warmgray-600'
                }`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = new Set(current);
                      if (next.has(o.value)) next.delete(o.value); else next.add(o.value);
                      onChange(Array.from(next));
                    }}
                    className="w-3.5 h-3.5 accent-ringo-500"
                  />
                  {o.label}
                </label>
              );
            })}
          </div>
        );
      })()}

      {field.type === 'allowance_days' && (
        <div className="flex gap-1.5">
          {([{v:0,ja:'0日',en:'0 days'},{v:0.5,ja:'半日',en:'Half'},{v:1,ja:'1日',en:'1 day'}] as {v:0|0.5|1;ja:string;en:string}[]).map(({v,ja,en}) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                Number(value) === v
                  ? 'bg-ringo-600 text-white border-ringo-600 shadow-sm'
                  : 'bg-white border-warmgray-200 text-warmgray-700 hover:border-ringo-300 hover:bg-ringo-50'
              }`}
            >
              {lang === 'en' ? en : ja}
            </button>
          ))}
        </div>
      )}

      {field.type === 'file' && (
        <RepeatFileInput
          groupName={groupName}
          rowIndex={rowIndex}
          field={field}
          value={String(value ?? '')}
          onChange={onChange}
        />
      )}

      {field.type === 'ai_file_reader' && (
        <RepeatAiFileInput
          groupName={groupName}
          rowIndex={rowIndex}
          field={field}
          value={String(value ?? '')}
          onChange={(v) => onChange(v)}
          onFillSibling={onFillSibling}
        />
      )}

      {field.type === 'repeat_group' && (
        <NestedRepeatGroupInput
          parentGroupName={groupName}
          parentRowIndex={rowIndex}
          field={field}
          value={value}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function RepeatFileInput({
  groupName,
  rowIndex,
  field,
  value,
  onChange,
}: {
  groupName: string;
  rowIndex: number;
  field: FormField;
  value: string;
  onChange: (value: string) => void;
}) {
  const { lang } = useLang();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>(() =>
    value
      .split(',')
      .filter(Boolean)
      .map((url, i) => parseFileUrl(url.trim(), i)),
  );
  const newUploadIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (files.length > 0 || !value) return;
    setFiles(value.split(',').filter(Boolean).map((url, i) => parseFileUrl(url.trim(), i)));
  }, [value, files.length]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected || selected.length === 0) return;

    setUploading(true);
    setUploadError(null);
    const formData = new FormData();
    Array.from(selected).forEach((f) => formData.append('files', f));
    formData.append('field_name', `${groupName}.${rowIndex}.${field.name}`);
    formData.append('folder', 'receipts');

    try {
      const res = await apiClient.post('/uploads', formData);
      const uploaded = (res.data.files as UploadedFile[]).map((f) => ({ ...f, url: f.url }));
      uploaded.forEach((f) => newUploadIds.current.add(f.id));
      const next = field.multiple ? [...files, ...uploaded] : uploaded.slice(-1);
      setFiles(next);
      onChange(next.map((f) => f.url).join(','));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setUploadError(msg ?? (lang === 'en' ? 'Upload failed' : 'アップロードに失敗しました'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeFile = (id: string) => {
    if (newUploadIds.current.has(id)) {
      newUploadIds.current.delete(id);
      apiClient.delete(`/files/${id}`).catch(() => {});
    }
    const next = files.filter((f) => f.id !== id);
    setFiles(next);
    onChange(next.map((f) => f.url).join(','));
  };

  return (
    <div className="space-y-2">
      <label className={`flex items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-4 cursor-pointer transition-colors ${
        uploading ? 'border-ringo-300 bg-ringo-50/40 opacity-70' : 'border-surface-300 bg-white/50 hover:border-ringo-300 hover:bg-ringo-50/20'
      }`}>
        <input
          ref={fileInputRef}
          type="file"
          multiple={field.multiple}
          className="sr-only"
          onChange={handleFileChange}
          disabled={uploading}
        />
        <span className="text-sm font-semibold text-warmgray-600">
          {uploading ? (lang === 'en' ? 'Uploading...' : 'アップロード中...') : (lang === 'en' ? 'Upload file' : 'ファイルを追加')}
        </span>
      </label>

      {uploadError && <p className="text-xs text-ringo-500">{uploadError}</p>}

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-2 rounded-lg border border-white/80 bg-white/70 px-3 py-2 min-w-0">
              <a href={file.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate text-xs font-semibold text-ringo-600 hover:text-ringo-700">
                {file.original_name}
              </a>
              <button type="button" onClick={() => removeFile(file.id)} className="text-warmgray-400 hover:text-red-500 text-sm">×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── RepeatAiFileInput ─────────────────────────────────────────────────────────
// AI file reader variant for inside repeat_group rows. Unlike top-level
// AiFileReaderInput (which uses UseFormSetValue), this works with value/onChange
// callback pattern. OCR fills sibling row fields via onFillSibling.
function RepeatAiFileInput({
  groupName,
  rowIndex,
  field,
  value,
  onChange,
  onFillSibling,
}: {
  groupName: string;
  rowIndex: number;
  field: FormField;
  value: string;
  onChange: (value: string) => void;
  onFillSibling?: (name: string, value: unknown) => void;
}) {
  const { lang } = useLang();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [ocrFileId, setOcrFileId] = useState<string | null>(null);
  const [ocring, setOcring] = useState(false);
  const [ocrErr, setOcrErr] = useState<string | null>(null);
  const [ocrPreview, setOcrPreview] = useState<Array<{key:string;label:string;value:string;type:'date'|'amount'|'custom';enabled:boolean}> | null>(null);
  const newUploadIds = useRef<Set<string>>(new Set());

  const [files, setFiles] = useState<UploadedFile[]>(() =>
    value.split(',').filter(Boolean).map((url, i) => parseFileUrl(url.trim(), i)),
  );

  const syncFiles = (next: UploadedFile[]) => {
    setFiles(next);
    onChange(next.map((f) => f.url).join(','));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected || selected.length === 0) return;
    setUploading(true);
    setUploadErr(null);
    setOcrPreview(null);
    setOcrErr(null);

    const fd = new FormData();
    Array.from(selected).forEach((f) => fd.append('files', f));
    fd.append('field_name', `${groupName}.${rowIndex}.${field.name}`);
    if (field.file_category) fd.append('folder', field.file_category);

    try {
      const res = await apiClient.post('/uploads', fd);
      const uploaded = (res.data.files as UploadedFile[]);
      uploaded.forEach((f) => newUploadIds.current.add(f.id));
      const next = field.multiple ? [...files, ...uploaded] : uploaded.slice(-1);
      syncFiles(next);
      if (uploaded.length > 0) { setOcrFileId(uploaded[0].id); setOcrPreview(null); }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setUploadErr(msg ?? (lang === 'en' ? 'Upload failed' : 'アップロードに失敗しました'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeFile = (id: string) => {
    if (newUploadIds.current.has(id)) {
      newUploadIds.current.delete(id);
      apiClient.delete(`/files/${id}`).catch(() => {});
    }
    const next = files.filter((f) => f.id !== id);
    syncFiles(next);
    if (ocrFileId === id) { setOcrFileId(null); setOcrPreview(null); }
  };

  const runOcr = async () => {
    if (!ocrFileId) return;
    setOcring(true);
    setOcrErr(null);
    setOcrPreview(null);
    try {
      const res = await apiClient.post(`/files/${ocrFileId}/ocr`, {
        extract_fields: (field.extract_fields ?? []).map((ef) => ({ name: ef.target, hint: ef.hint })),
      });
      const { date, amount, custom } = res.data as { date: string | null; amount: number | null; custom: Record<string, string | null> };
      const items: typeof ocrPreview = [];
      if (field.target_date_field) items.push({ key: field.target_date_field, label: lang === 'en' ? 'Date' : '日付', value: date ?? '', type: 'date', enabled: !!date });
      if (field.target_amount_field) items.push({ key: field.target_amount_field, label: lang === 'en' ? 'Amount' : '金額', value: amount !== null ? String(amount) : '', type: 'amount', enabled: amount !== null });
      for (const ef of (field.extract_fields ?? [])) {
        const found = custom?.[ef.target] ?? null;
        items.push({ key: ef.target, label: ef.hint, value: found ?? '', type: 'custom', enabled: !!found });
      }
      setOcrPreview(items);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setOcrErr(msg ?? (lang === 'en' ? 'OCR failed' : 'OCR処理に失敗しました'));
    } finally {
      setOcring(false);
    }
  };

  const applyOcrPreview = () => {
    if (!ocrPreview) return;
    for (const item of ocrPreview) {
      if (!item.enabled || !item.value) continue;
      if (item.type === 'amount') {
        const n = parseInt(item.value.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(n)) onFillSibling?.(item.key, n);
      } else {
        onFillSibling?.(item.key, item.value);
      }
    }
    setOcrPreview(null);
  };

  const canOcr = !!ocrFileId && !!(field.target_date_field || field.target_amount_field || (field.extract_fields?.length ?? 0) > 0);

  return (
    <div className="space-y-2">
      <div
        onClick={() => fileInputRef.current?.click()}
        className={`flex items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-4 cursor-pointer transition-colors
          ${uploadErr ? 'border-red-300 bg-red-50/40' : 'border-violet-300/70 bg-violet-50/40 hover:bg-violet-50/80'}`}
      >
        <svg className="w-5 h-5 text-violet-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <span className="text-xs font-semibold text-violet-700">
          {uploading
            ? (lang === 'en' ? 'Uploading…' : 'アップロード中…')
            : (lang === 'en' ? 'Upload receipt' : '領収書をアップロード')}
        </span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple={field.multiple}
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        onChange={handleFileChange}
        disabled={uploading}
      />
      {uploadErr && <p className="text-xs text-red-500">⚠ {uploadErr}</p>}

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 bg-white/70 border border-white/80 rounded-lg px-3 py-2">
              <svg className="w-4 h-4 text-violet-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
              </svg>
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate text-xs font-semibold text-violet-700 hover:text-violet-900">
                {f.original_name}
              </a>
              <button type="button" onClick={() => removeFile(f.id)} className="text-warmgray-400 hover:text-red-500 text-sm leading-none">×</button>
            </li>
          ))}
        </ul>
      )}

      {canOcr && !ocrPreview && (
        <button
          type="button"
          onClick={runOcr}
          disabled={ocring}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
        >
          {ocring ? (
            <>
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              {lang === 'en' ? 'Reading…' : '読み取り中…'}
            </>
          ) : (
            <>{lang === 'en' ? 'AI Auto-fill' : 'AI自動入力'}</>
          )}
        </button>
      )}

      {ocrPreview && (
        <div className="rounded-xl border border-violet-200/70 bg-violet-50/60 p-2.5 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-violet-700">
            {lang === 'en' ? 'AI found' : 'AI読み取り結果'}
          </p>
          {ocrPreview.map((item) => (
            <div key={item.key} className={`flex items-center gap-1.5 rounded-lg px-2 py-1 ${item.enabled ? 'bg-white/80 border border-violet-100' : 'opacity-40'}`}>
              <input type="checkbox" checked={item.enabled} onChange={(e) => setOcrPreview((p) => p?.map((x) => x.key === item.key ? { ...x, enabled: e.target.checked } : x) ?? null)} className="w-3 h-3 accent-violet-500 shrink-0" />
              <span className="text-[10px] text-warmgray-500 shrink-0 w-16 truncate">{item.label}</span>
              <input
                type={item.type === 'date' ? 'date' : 'text'}
                value={item.value}
                onChange={(e) => setOcrPreview((p) => p?.map((x) => x.key === item.key ? { ...x, value: e.target.value, enabled: true } : x) ?? null)}
                className="input text-xs flex-1 min-w-0 py-0.5"
              />
            </div>
          ))}
          <div className="flex gap-1.5 pt-0.5">
            <button type="button" onClick={applyOcrPreview} className="flex-1 rounded-lg bg-violet-600 py-1 text-xs font-bold text-white hover:bg-violet-700">
              {lang === 'en' ? 'Fill' : '入力'}
            </button>
            <button type="button" onClick={() => setOcrPreview(null)} className="rounded-lg border border-warmgray-200 px-2 py-1 text-xs text-warmgray-500 hover:bg-warmgray-50">
              {lang === 'en' ? '×' : '×'}
            </button>
          </div>
        </div>
      )}

      {ocrErr && <p className="text-xs text-red-500">⚠ {ocrErr}</p>}
    </div>
  );
}
