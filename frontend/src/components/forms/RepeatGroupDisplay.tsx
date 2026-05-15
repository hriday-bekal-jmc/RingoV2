import { useLang } from '../../context/LanguageContext';

export interface RepeatDisplayField {
  name: string;
  label: string;
  label_en?: string | null;
  type: string;
  fields?: RepeatDisplayField[];
}

function labelFor(field: RepeatDisplayField, lang: 'ja' | 'en'): string {
  return lang === 'en' && field.label_en ? field.label_en : field.label;
}

function isBlank(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function isFileValue(value: unknown): value is string {
  return typeof value === 'string' && (value.includes('/api/files/') || value.includes('/uploads/'));
}

function formatValue(value: unknown): string {
  if (isBlank(value)) return '';
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function FileLinks({ value }: { value: string }) {
  const { t } = useLang();
  const urls = value.split(',').map((url) => url.trim()).filter(Boolean);
  if (urls.length === 0) return <span className="text-warmgray-300">—</span>;

  return (
    <div className="flex flex-wrap gap-1.5">
      {urls.map((url, index) => {
        const filename = decodeURIComponent((url.split('/').pop() ?? `file_${index + 1}`).replace(/^\d+_/, ''));
        return (
          <a
            key={`${url}-${index}`}
            href={url.startsWith('http') ? url : url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1 rounded-lg border border-ringo-200/70 bg-ringo-50/70 px-2 py-1 text-xs font-semibold text-ringo-600 hover:text-ringo-700"
          >
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            <span className="truncate">{t('attach_label')} {index + 1}: {filename}</span>
          </a>
        );
      })}
    </div>
  );
}

export default function RepeatGroupDisplay({
  field,
  value,
  compact = false,
}: {
  field: RepeatDisplayField;
  value: unknown;
  compact?: boolean;
}) {
  const { lang, t } = useLang();
  const rows = Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null && !Array.isArray(row))
    : [];
  const childFields = field.fields?.filter((f) => f.type !== 'header' && f.type !== 'repeat_group') ?? [];

  if (rows.length === 0) {
    return <span className="text-warmgray-300 text-xs">{t('not_entered')}</span>;
  }

  return (
    <div className="space-y-2">
      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className={`rounded-xl border border-white/80 bg-white/70 ${compact ? 'p-2.5' : 'p-3'} space-y-2 min-w-0`}
        >
          <div className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">
            {lang === 'en' ? `Row ${rowIndex + 1}` : `${rowIndex + 1}行目`}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
            {(childFields.length ? childFields : Object.keys(row).map((name) => ({ name, label: name, type: 'text' }))).map((child) => {
              const cell = row[child.name];
              const text = formatValue(cell);
              const full = child.type === 'textarea' || child.type === 'file' || text.length > 60 || text.includes('\n');
              return (
                <div key={child.name} className={`min-w-0 ${full ? 'md:col-span-2' : ''}`}>
                  <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-0.5 break-words [overflow-wrap:anywhere]">
                    {labelFor(child, lang)}
                  </dt>
                  <dd className="text-sm font-medium text-warmgray-800 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {isFileValue(cell) ? (
                      <FileLinks value={cell} />
                    ) : text ? (
                      text
                    ) : (
                      <span className="text-warmgray-300 text-xs">{t('not_entered')}</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
