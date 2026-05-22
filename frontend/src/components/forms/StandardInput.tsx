import { useState, useRef, useEffect, useMemo } from 'react';
import {
  UseFormRegister,
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
  col_span?: 'half' | 'full';
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

  const requiredRule = isDraft ? false : (field.required ?? false);

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
  const { lang } = useLang();
  // Prefer EN label when lang=en AND label_en provided; otherwise fall back
  // to the legacy Japanese `label` field (kept for backward compat).
  const displayLabel = lang === 'en' && field.label_en ? field.label_en : field.label;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="label-normal">
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
          {...register(field.name, { required: requiredRule })}
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
            />
          </>
        );
      })()}

      {field.type === 'number' && !field.computed && (
        <input
          type="number"
          {...register(field.name, { required: requiredRule, valueAsNumber: true })}
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
          {...register(field.name, { required: requiredRule })}
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

      {/* Computed total — read-only, driven by DynamicForm auto-sum */}
      {field.type === 'number' && field.computed && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-teal-50/60 border border-teal-200/60">
          <input
            type="hidden"
            {...register(field.name, { required: requiredRule, valueAsNumber: true })}
          />
          <span className="text-xl font-bold text-teal-700">
            ¥{((watch ? Number(watch(field.name)) : 0) || 0).toLocaleString('ja-JP')}
          </span>
          <span className="text-xs text-teal-500 font-medium">（自動計算）</span>
        </div>
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

      {error && !isDraft && (
        <p className="text-xs text-ringo-500 flex items-center gap-1">
          <span>⚠</span> {typeof error.message === 'string' && error.message ? error.message : 'この項目は必須です'}
        </p>
      )}
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
// Reusable transport route picker. Stores array of {id,from_station,to_station,fare}
// in form field value. Add to any schema with type: 'route_entry'.
// Total displayed as yen × 2 (round-trip assumption).
interface RouteRow { id: string; from_station: string; to_station: string; fare: number }

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

  const [routes, setRoutes] = useState<RouteRow[]>(() => {
    if (Array.isArray(rawVal)) {
      return (rawVal as RouteRow[]).map((r) => ({
        id: r.id ?? crypto.randomUUID(),
        from_station: r.from_station ?? '',
        to_station:   r.to_station ?? '',
        fare:         Number(r.fare) || 0,
      }));
    }
    return [{ id: crypto.randomUUID(), from_station: '', to_station: '', fare: 0 }];
  });

  useEffect(() => {
    setValue?.(field.name, routes, { shouldDirty: true, shouldTouch: false, shouldValidate: false });
  }, [routes, field.name, setValue]);

  const update = (i: number, patch: Partial<RouteRow>) =>
    setRoutes((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add    = () => setRoutes((prev) => [...prev, { id: crypto.randomUUID(), from_station: '', to_station: '', fare: 0 }]);
  const remove = (i: number) => setRoutes((prev) => prev.filter((_, j) => j !== i));
  const swap   = (i: number) =>
    setRoutes((prev) => prev.map((r, j) => j === i ? { ...r, from_station: r.to_station, to_station: r.from_station } : r));

  const total = routes.reduce((s, r) => s + (Number(r.fare) || 0), 0) * 2;

  return (
    <div className="space-y-2 rounded-xl border border-ringo-100 bg-ringo-50/40 p-3">
      {routes.map((r, i) => (
        <div key={r.id} className="flex items-center gap-1.5">
          <input
            type="text"
            value={r.from_station}
            onChange={(e) => update(i, { from_station: e.target.value })}
            placeholder={lang === 'ja' ? '乗車駅' : 'From station'}
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
            placeholder={lang === 'ja' ? '降車駅' : 'To station'}
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
            <button
              type="button"
              onClick={() => remove(i)}
              className="shrink-0 text-warmgray-300 hover:text-red-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={add}
          className="text-xs text-ringo-600 hover:text-ringo-700 font-medium"
        >
          + {lang === 'ja' ? '経路追加' : 'Add route'}
        </button>
        <span className="text-xs font-semibold text-warmgray-600 tabular-nums">
          {lang === 'ja' ? '合計（往復）' : 'Total (round-trip)'}: ¥{total.toLocaleString('ja-JP')}
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
    () => (field.fields ?? []).filter((f) => f.type !== 'repeat_group' && f.type !== 'header'),
    [field.fields],
  );
  const minRows = Math.max(0, Number(field.min_rows ?? ((field.required && !isDraft) ? 1 : 0)) || 0);
  const maxRows = Math.max(1, Math.min(MAX_REPEAT_ROWS, Number(field.max_rows ?? MAX_REPEAT_ROWS) || MAX_REPEAT_ROWS));
  const initialVisibleRows = Math.min(maxRows, Math.max(1, minRows));

  const [rows, setRows] = useState<RepeatRow[]>(() =>
    normalizeRepeatRows(watch?.(field.name), childFields, initialVisibleRows),
  );

  const storedRows = useMemo(() => cleanRepeatRows(rows, childFields), [rows, childFields]);

  useEffect(() => {
    setValue?.(field.name, storedRows, {
      shouldDirty: true,
      shouldTouch: false,
      shouldValidate: false,
    });
  }, [field.name, setValue, storedRows]);

  const updateCell = (rowIndex: number, childName: string, value: unknown) => {
    setRows((prev) => prev.map((row, i) => i === rowIndex ? { ...row, [childName]: value } : row));
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {childFields.map((child) => (
                <div
                  key={child.name}
                  className={`min-w-0 ${child.type === 'textarea' || child.type === 'file' ? 'md:col-span-2' : ''}`}
                >
                  <RepeatCell
                    groupName={field.name}
                    rowIndex={rowIndex}
                    field={child}
                    value={row[child.name]}
                    onChange={(value) => updateCell(rowIndex, child.name, value)}
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

function RepeatCell({
  groupName,
  rowIndex,
  field,
  value,
  onChange,
}: {
  groupName: string;
  rowIndex: number;
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
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

      {field.type === 'file' && (
        <RepeatFileInput
          groupName={groupName}
          rowIndex={rowIndex}
          field={field}
          value={String(value ?? '')}
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
