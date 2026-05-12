import { useState, useRef, useEffect } from 'react';
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
import CustomSelect from './CustomSelect';
import { useLang } from '../../context/LanguageContext';

// File URLs are same-origin (vite proxy /api in dev, reverse proxy in prod)

interface FormField {
  name: string;
  label: string;          // Japanese (legacy default)
  label_en?: string;      // English (admin-set)
  helper_text?: string;
  placeholder?: string;
  type: string;
  required?: boolean;
  multiple?: boolean;
  computed?: boolean;
  sum_target?: string;
  options?: string[] | { value: string; label?: string; label_ja?: string; label_en?: string }[];
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

      {error && !isDraft && (
        <p className="text-xs text-ringo-500 flex items-center gap-1">
          <span>⚠</span> この項目は必須です
        </p>
      )}
    </div>
  );
}
