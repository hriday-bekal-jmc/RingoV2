// AiFileReaderInput — upload a receipt/bill image, run Gemini OCR, preview results, fill form.
//
// Extraction strategy (hybrid):
//   date + amount  → regex-validated on backend (accurate, deterministic)
//   extract_fields → Gemini semantic match per hint (for custom terms like vendor name)
//
// Field config (from schema):
//   target_date_field   — form field name to fill with extracted date
//   target_amount_field — form field name to fill with extracted amount
//   extract_fields      — [{target, hint}] custom semantic fields
//   file_category       — Drive folder category
//   multiple            — allow multiple files

import { useRef, useState } from 'react';
import { useLang } from '../../context/LanguageContext';
import apiClient from '../../services/apiClient';
import type { UseFormSetValue } from 'react-hook-form';

interface UploadedFile {
  id:            string;
  url:           string;
  original_name: string;
}

export interface ExtractField {
  target: string;  // form field name to fill
  hint:   string;  // plain-language description for AI
}

interface AiFileReaderField {
  name:                string;
  label?:              string;
  required?:           boolean;
  multiple?:           boolean;
  target_date_field?:  string;
  target_amount_field?: string;
  extract_fields?:     ExtractField[];
  file_category?:      string;
}

// One row in the preview panel
interface PreviewItem {
  key:     string;       // form field name
  label:   string;       // human label shown in preview
  value:   string;       // editable string (amount stored as string, converted on fill)
  type:    'date' | 'amount' | 'custom';
  enabled: boolean;      // user can toggle off to skip this field
}

interface Props {
  field:        AiFileReaderField;
  setValue:     UseFormSetValue<Record<string, unknown>>;
  currentValue?: string;
  error?:       string;
  disabled?:    boolean;
}

export default function AiFileReaderInput({ field, setValue, currentValue, error, disabled }: Props) {
  const { lang } = useLang();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>(() =>
    (currentValue ?? '')
      .split(',')
      .filter(Boolean)
      .map((url, i) => ({ id: `existing-${i}`, url, original_name: url.split('/').pop() ?? url })),
  );

  const [uploading, setUploading]   = useState(false);
  const [uploadErr, setUploadErr]   = useState<string | null>(null);
  const [ocrFileId, setOcrFileId]   = useState<string | null>(null);
  const [ocring, setOcring]         = useState(false);
  const [ocrErr, setOcrErr]         = useState<string | null>(null);
  const [preview, setPreview]       = useState<PreviewItem[] | null>(null);
  const newUploadIds                = useRef<Set<string>>(new Set());

  const syncValue = (files: UploadedFile[]) => {
    setValue(field.name as never, files.map((f) => f.url).join(',') as never);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadErr(null);
    setPreview(null);
    setOcrErr(null);

    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('files', f));
    fd.append('field_name', field.name);
    if (field.file_category) fd.append('folder', field.file_category);

    try {
      const res = await apiClient.post('/uploads', fd);
      const newFiles: UploadedFile[] = res.data.files;
      newFiles.forEach((f) => newUploadIds.current.add(f.id));
      const updated = [...uploadedFiles, ...newFiles];
      setUploadedFiles(updated);
      syncValue(updated);
      if (newFiles.length > 0) setOcrFileId(newFiles[0].id);
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
    const updated = uploadedFiles.filter((f) => f.id !== id);
    setUploadedFiles(updated);
    syncValue(updated);
    if (ocrFileId === id) { setOcrFileId(null); setPreview(null); }
  };

  const runOcr = async () => {
    if (!ocrFileId) return;
    setOcring(true);
    setOcrErr(null);
    setPreview(null);

    try {
      const res = await apiClient.post(`/files/${ocrFileId}/ocr`, {
        extract_fields: (field.extract_fields ?? []).map((ef) => ({ name: ef.target, hint: ef.hint })),
      });
      const { date, amount, custom } = res.data as {
        date:   string | null;
        amount: number | null;
        custom: Record<string, string | null>;
      };

      const items: PreviewItem[] = [];

      if (field.target_date_field) {
        items.push({
          key: field.target_date_field,
          label: lang === 'en' ? 'Date' : '日付',
          value: date ?? '',
          type: 'date',
          enabled: !!date,
        });
      }
      if (field.target_amount_field) {
        items.push({
          key: field.target_amount_field,
          label: lang === 'en' ? 'Amount' : '金額',
          value: amount !== null ? String(amount) : '',
          type: 'amount',
          enabled: amount !== null,
        });
      }
      for (const ef of (field.extract_fields ?? [])) {
        const found = custom[ef.target] ?? null;
        items.push({
          key: ef.target,
          label: ef.hint,
          value: found ?? '',
          type: 'custom',
          enabled: !!found,
        });
      }

      setPreview(items);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setOcrErr(msg ?? (lang === 'en' ? 'OCR failed' : 'OCR処理に失敗しました'));
    } finally {
      setOcring(false);
    }
  };

  const updatePreviewItem = (key: string, patch: Partial<PreviewItem>) => {
    setPreview((prev) => prev?.map((p) => p.key === key ? { ...p, ...patch } : p) ?? null);
  };

  const applyPreview = () => {
    if (!preview) return;
    for (const item of preview) {
      if (!item.enabled || !item.value) continue;
      if (item.type === 'amount') {
        const n = parseInt(item.value.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(n)) setValue(item.key as never, n as never);
      } else {
        setValue(item.key as never, item.value as never);
      }
    }
    setPreview(null);
  };

  const hasTargets = !!(field.target_date_field || field.target_amount_field || (field.extract_fields?.length ?? 0) > 0);
  const canOcr     = !!ocrFileId && hasTargets;
  const anyFound   = preview?.some((p) => p.value);

  return (
    <div className="space-y-2">
      {/* Drop zone */}
      <div
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 transition-colors cursor-pointer
          ${error ? 'border-red-300 bg-red-50/40' : 'border-violet-300/70 bg-violet-50/40 hover:bg-violet-50/80'}
          ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
        onClick={() => fileInputRef.current?.click()}
      >
        <svg className="w-7 h-7 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <p className="text-xs font-semibold text-violet-700">
          {uploading
            ? (lang === 'en' ? 'Uploading…' : 'アップロード中…')
            : (lang === 'en' ? 'Click to upload receipt / bill' : '領収書・請求書をアップロード')}
        </p>
        <p className="text-[10px] text-violet-500">
          {lang === 'en' ? 'JPEG, PNG, WebP — max 20 MB' : 'JPEG・PNG・WebP — 最大20MB'}
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple={field.multiple}
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        onChange={handleFileChange}
        disabled={disabled || uploading}
      />

      {uploadErr && <p className="text-xs text-red-500">⚠ {uploadErr}</p>}

      {/* File list */}
      {uploadedFiles.length > 0 && (
        <ul className="space-y-1.5">
          {uploadedFiles.map((f) => (
            <li key={f.id} className="flex items-center gap-2 bg-white/70 border border-white/80 rounded-lg px-3 py-2">
              <svg className="w-4 h-4 text-violet-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M13.5 12h.008v.008H13.5V12z" />
              </svg>
              <a href={f.url} target="_blank" rel="noopener noreferrer"
                className="flex-1 min-w-0 truncate text-xs font-semibold text-violet-700 hover:text-violet-900">
                {f.original_name}
              </a>
              <button type="button" onClick={() => removeFile(f.id)} disabled={disabled}
                className="text-warmgray-400 hover:text-red-500 text-sm leading-none disabled:opacity-30">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Read button */}
      {canOcr && !preview && (
        <button
          type="button"
          onClick={runOcr}
          disabled={ocring || disabled}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50 transition-colors shadow-sm"
        >
          {ocring ? (
            <>
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              {lang === 'en' ? 'Reading…' : 'AI読み取り中…'}
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              {lang === 'en' ? 'Auto-fill from receipt' : 'AI自動入力'}
            </>
          )}
        </button>
      )}

      {/* Preview panel — shown after OCR, before apply */}
      {preview && (
        <div className="rounded-xl border border-violet-200/70 bg-violet-50/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-violet-700">
              {lang === 'en' ? 'AI found — review before filling' : 'AI読み取り結果 — 確認してから入力'}
            </p>
            <button type="button" onClick={() => setPreview(null)}
              className="text-warmgray-400 hover:text-warmgray-600 text-xs">
              {lang === 'en' ? 'dismiss' : '閉じる'}
            </button>
          </div>

          {!anyFound && (
            <p className="text-xs text-warmgray-500 italic">
              {lang === 'en' ? 'No data could be extracted from this image.' : 'この画像からデータを取得できませんでした。'}
            </p>
          )}

          <div className="space-y-1.5">
            {preview.map((item) => (
              <div key={item.key} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors ${
                item.enabled ? 'bg-white/80 border border-violet-100' : 'bg-white/30 border border-warmgray-100 opacity-50'
              }`}>
                <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(e) => updatePreviewItem(item.key, { enabled: e.target.checked })}
                    className="w-3.5 h-3.5 accent-violet-500"
                  />
                  <span className="text-[10px] font-semibold text-warmgray-500 max-w-[80px] truncate" title={item.label}>
                    {item.label}
                  </span>
                </label>
                <span className="text-[10px] text-warmgray-300 shrink-0">→</span>
                {item.type === 'amount' ? (
                  <div className="relative flex-1 min-w-0">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-warmgray-400 pointer-events-none">¥</span>
                    <input
                      type="number"
                      value={item.value}
                      onChange={(e) => updatePreviewItem(item.key, { value: e.target.value, enabled: true })}
                      className="input pl-5 text-xs w-full tabular-nums"
                    />
                  </div>
                ) : (
                  <input
                    type={item.type === 'date' ? 'date' : 'text'}
                    value={item.value}
                    onChange={(e) => updatePreviewItem(item.key, { value: e.target.value, enabled: true })}
                    className="input text-xs flex-1 min-w-0"
                  />
                )}
              </div>
            ))}
          </div>

          {anyFound && (
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={applyPreview}
                className="flex-1 rounded-lg bg-violet-600 py-1.5 text-xs font-bold text-white hover:bg-violet-700 transition-colors"
              >
                {lang === 'en' ? 'Fill checked fields' : 'チェック項目を入力'}
              </button>
              <button
                type="button"
                onClick={runOcr}
                disabled={ocring}
                className="rounded-lg border border-violet-300 bg-white/70 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-40 transition-colors"
              >
                {lang === 'en' ? 'Re-read' : '再読み取り'}
              </button>
            </div>
          )}
        </div>
      )}

      {ocrErr && <p className="text-xs text-red-500">⚠ {ocrErr}</p>}

      {hasTargets && !preview && (
        <p className="text-[10px] text-warmgray-400">
          {lang === 'en'
            ? `AI will extract: ${[
                field.target_date_field && 'date',
                field.target_amount_field && 'amount',
                ...(field.extract_fields ?? []).map((ef) => ef.hint),
              ].filter(Boolean).join(', ')}`
            : `AI抽出: ${[
                field.target_date_field && '日付',
                field.target_amount_field && '金額',
                ...(field.extract_fields ?? []).map((ef) => ef.hint),
              ].filter(Boolean).join('、')}`}
        </p>
      )}
    </div>
  );
}
