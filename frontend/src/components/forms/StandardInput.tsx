import { useState, useRef } from 'react';
import { UseFormRegister, FieldError, Merge, FieldErrorsImpl, UseFormSetValue } from 'react-hook-form';
import apiClient from '../../services/apiClient';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace('/api', '') || 'http://localhost:3000';

interface FormField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'textarea' | 'file' | string;
  required?: boolean;
  multiple?: boolean;
}

interface StandardInputProps {
  field: FormField;
  register: UseFormRegister<any>;
  setValue?: UseFormSetValue<any>;
  error?: FieldError | Merge<FieldError, FieldErrorsImpl<any>>;
  isDraft?: boolean;
}

interface UploadedFile {
  id: string;
  url: string;
  original_name: string;
}

export default function StandardInput({ field, register, setValue, error, isDraft }: StandardInputProps) {
  // For file fields — controlled upload, store URLs back into form
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Required validation is skipped when saving as draft
  const requiredRule = isDraft ? false : (field.required ?? false);

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
      // Prefix relative /uploads/* URLs with backend origin
      const newFiles: UploadedFile[] = (res.data.files as UploadedFile[]).map((f) => ({
        ...f,
        url: f.url.startsWith('http') ? f.url : `${API_BASE}${f.url}`,
      }));
      const updated = [...uploadedFiles, ...newFiles];
      setUploadedFiles(updated);
      // Store URLs as comma-separated string in form value
      if (setValue) {
        setValue(field.name, updated.map((f) => f.url).join(','));
      }
    } catch (err: any) {
      setUploadError(err.response?.data?.error ?? 'アップロードに失敗しました');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeFile = (id: string) => {
    const updated = uploadedFiles.filter((f) => f.id !== id);
    setUploadedFiles(updated);
    if (setValue) {
      setValue(field.name, updated.map((f) => f.url).join(','));
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="label-normal">
        {field.label}
        {field.required && !isDraft && <span className="text-ringo-500 ml-0.5">*</span>}
        {field.required && isDraft && <span className="text-warmgray-400 ml-1 text-[10px] font-normal">(下書き: 任意)</span>}
      </label>

      {field.type === 'text' && (
        <input
          type="text"
          {...register(field.name, { required: requiredRule })}
          className="input"
        />
      )}

      {field.type === 'number' && (
        <input
          type="number"
          {...register(field.name, { required: requiredRule, valueAsNumber: true })}
          className="input"
        />
      )}

      {field.type === 'date' && (
        <input
          type="date"
          {...register(field.name, { required: requiredRule })}
          className="input"
        />
      )}

      {field.type === 'textarea' && (
        <textarea
          {...register(field.name, { required: requiredRule })}
          className="input resize-y"
          rows={3}
        />
      )}

      {/* File upload — controlled, separate upload call */}
      {field.type === 'file' && (
        <div className="space-y-2">
          {/* Hidden form field to store URL value */}
          <input type="hidden" {...register(field.name, { required: requiredRule })} />

          <label className={`flex items-center justify-center gap-2 w-full py-6 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-150
            ${uploading
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
                  <span className="text-sm font-medium text-warmgray-600">クリックしてファイルを選択</span>
                  <p className="text-[11px] text-warmgray-400 mt-0.5">PDF・画像・Excel・Word / 最大 20MB</p>
                </div>
              </>
            )}
          </label>

          {uploadError && (
            <p className="text-xs text-ringo-500 flex items-center gap-1">
              <span>⚠</span> {uploadError}
            </p>
          )}

          {uploadedFiles.length > 0 && (
            <ul className="space-y-1.5">
              {uploadedFiles.map((f) => (
                <li key={f.id} className="flex items-center gap-2 bg-white/60 border border-white/80 rounded-lg px-3 py-2">
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
                    className="text-warmgray-400 hover:text-red-500 transition-colors"
                    onClick={() => removeFile(f.id)}
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
