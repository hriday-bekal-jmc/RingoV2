// AiFileReaderInput — upload a receipt/bill image, then optionally run Gemini
// OCR to auto-fill date and amount fields in the parent form.
//
// Field config (from schema):
//   target_date_field   — name of the form field to fill with extracted date
//   target_amount_field — name of the form field to fill with extracted amount
//   file_category       — Drive folder category ('receipts' | 'invoices' | ...)
//   multiple            — allow multiple files (default false)
//   required            — validation
//
// The field stores a comma-separated list of /api/files/:id URLs,
// identical to the regular 'file' field — so display components need no changes.

import { useRef, useState } from 'react';
import { useLang } from '../../context/LanguageContext';
import apiClient from '../../services/apiClient';
import type { UseFormSetValue } from 'react-hook-form';

interface UploadedFile {
  id:            string;
  url:           string;
  original_name: string;
}

interface AiFileReaderField {
  name:                string;
  label?:              string;
  required?:           boolean;
  multiple?:           boolean;
  target_date_field?:  string;
  target_amount_field?: string;
  file_category?:      string;
}

interface Props {
  field:       AiFileReaderField;
  setValue:    UseFormSetValue<Record<string, unknown>>;
  // Current comma-separated URL value (from react-hook-form watch)
  currentValue?: string;
  error?:      string;
  disabled?:   boolean;
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
  const [ocrFileId, setOcrFileId]   = useState<string | null>(null); // last uploaded file id for OCR
  const [ocring, setOcring]         = useState(false);
  const [ocrResult, setOcrResult]   = useState<{ date: string | null; amount: number | null } | null>(null);
  const [ocrErr, setOcrErr]         = useState<string | null>(null);
  const newUploadIds                = useRef<Set<string>>(new Set());

  const syncValue = (files: UploadedFile[]) => {
    setValue(field.name as never, files.map((f) => f.url).join(',') as never);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadErr(null);
    setOcrResult(null);
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

      // Store first uploaded file id for OCR (file field only accepts images)
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
    if (ocrFileId === id) setOcrFileId(null);
  };

  const runOcr = async () => {
    if (!ocrFileId) return;
    setOcring(true);
    setOcrErr(null);
    setOcrResult(null);

    try {
      const res = await apiClient.post(`/files/${ocrFileId}/ocr`);
      const { date, amount } = res.data as { date: string | null; amount: number | null };
      setOcrResult({ date, amount });

      // Auto-fill target fields
      if (date && field.target_date_field) {
        setValue(field.target_date_field as never, date as never);
      }
      if (amount !== null && field.target_amount_field) {
        setValue(field.target_amount_field as never, amount as never);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setOcrErr(msg ?? (lang === 'en' ? 'OCR failed' : 'OCR処理に失敗しました'));
    } finally {
      setOcring(false);
    }
  };

  const hasTargets = !!(field.target_date_field || field.target_amount_field);
  const canOcr     = !!ocrFileId && hasTargets;

  return (
    <div className="space-y-2">
      {/* Drop zone / upload button */}
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

      {/* Uploaded file list */}
      {uploadedFiles.length > 0 && (
        <ul className="space-y-1.5">
          {uploadedFiles.map((f) => (
            <li key={f.id} className="flex items-center gap-2 bg-white/70 border border-white/80 rounded-lg px-3 py-2">
              {/* File icon */}
              <svg className="w-4 h-4 text-violet-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M13.5 12h.008v.008H13.5V12zm0 0a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" />
              </svg>
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-w-0 truncate text-xs font-semibold text-violet-700 hover:text-violet-900"
              >
                {f.original_name}
              </a>
              <button
                type="button"
                onClick={() => removeFile(f.id)}
                disabled={disabled}
                className="text-warmgray-400 hover:text-red-500 text-sm leading-none disabled:opacity-30"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Auto-fill button — only shown when targets configured + file uploaded */}
      {canOcr && (
        <div className="flex items-center gap-3 flex-wrap">
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
                {lang === 'en' ? 'Reading…' : '読み取り中…'}
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

          {/* OCR result summary */}
          {ocrResult && (
            <div className="flex items-center gap-2 text-xs text-violet-700 bg-violet-50 border border-violet-200/60 rounded-lg px-3 py-1.5">
              <svg className="w-3.5 h-3.5 text-violet-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span>
                {[
                  ocrResult.date   ? (lang === 'en' ? `Date: ${ocrResult.date}` : `日付: ${ocrResult.date}`) : null,
                  ocrResult.amount !== null ? (lang === 'en' ? `Amount: ¥${ocrResult.amount.toLocaleString()}` : `金額: ¥${ocrResult.amount.toLocaleString('ja-JP')}`) : null,
                ].filter(Boolean).join(' · ') || (lang === 'en' ? 'No data extracted' : 'データを取得できませんでした')}
              </span>
            </div>
          )}
        </div>
      )}

      {ocrErr && <p className="text-xs text-red-500">⚠ {ocrErr}</p>}

      {/* Helper: explain what fields will be filled */}
      {hasTargets && (
        <p className="text-[10px] text-warmgray-400">
          {lang === 'en'
            ? `AI will fill: ${[field.target_date_field && `"${field.target_date_field}" (date)`, field.target_amount_field && `"${field.target_amount_field}" (amount)`].filter(Boolean).join(', ')}`
            : `AI入力先: ${[field.target_date_field && `「${field.target_date_field}」（日付）`, field.target_amount_field && `「${field.target_amount_field}」（金額）`].filter(Boolean).join('、')}`}
        </p>
      )}
    </div>
  );
}
