/**
 * Renders the stored value of ANY form field type in read-only display contexts.
 *
 * Add handling for new field types HERE — it will automatically propagate to:
 *   - ApplicationDetail FormDataViewer
 *   - Approvals DetailModal + AppDetailPanel FormDataViewer
 *   - AdminAppDetailModal FormDataCard
 *   - RepeatGroupDisplay cell values
 */
import { useLang } from '../../context/LanguageContext';
import { optionLabel } from '../../i18n';

export interface DisplayField {
  name: string;
  label: string;
  label_en?: string | null;
  type: string;
  fields?: DisplayField[];
  options?: Array<{ value: string; label_ja?: string; label_en?: string; label?: string }>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function isFileValue(v: unknown): boolean {
  if (typeof v !== 'string' || !v) return false;
  return v.split(',').some((s) => s.trim().startsWith('/api/files/') || s.trim().startsWith('/uploads/'));
}

export function isLongField(field: DisplayField, value: unknown): boolean {
  return (
    field.type === 'repeat_group' ||
    field.type === 'route_entry' ||
    field.type === 'textarea' ||
    field.type === 'file' ||
    field.type === 'ai_file_reader' ||
    (typeof value === 'string' && !isFileValue(value) && value.length > 60)
  );
}

export function formatAllowanceDays(value: unknown, lang: 'ja' | 'en'): string {
  const n = Number(value);
  if (n === 0.5) return lang === 'ja' ? '半日' : 'Half day';
  if (n === 1)   return lang === 'ja' ? '1日'  : '1 day';
  return lang === 'ja' ? '0日' : '0 days';
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function FileLinks({ val }: { val: unknown }) {
  const { lang } = useLang();
  return (
    <div className="flex flex-wrap gap-1.5 mt-0.5">
      {String(val).split(',').filter(Boolean).map((url, i) => (
        <a key={i} href={url.trim()} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-ringo-600 hover:text-ringo-700 bg-ringo-50/60 border border-ringo-200/60 px-2.5 py-1 rounded-lg font-medium transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
          {lang === 'ja' ? 'ファイル' : 'File'} {i + 1}
        </a>
      ))}
    </div>
  );
}

interface RouteRow { id?: string; from_station?: string; to_station?: string; fare?: number }

function RouteEntryDisplay({ value, lang }: { value: unknown; lang: 'ja' | 'en' }) {
  const routes = Array.isArray(value)
    ? (value as RouteRow[]).filter((r) => r.from_station || r.to_station)
    : [];
  if (routes.length === 0) return <span className="text-warmgray-300 text-xs">—</span>;
  const total = routes.reduce((s, r) => s + (Number(r.fare) || 0), 0) * 2;
  return (
    <div className="space-y-1.5">
      {routes.map((r, i) => (
        <div key={i} className="flex items-center gap-2 text-sm flex-wrap">
          <span className="font-medium text-warmgray-700 min-w-0 truncate">{r.from_station || '—'}</span>
          <svg className="w-3.5 h-3.5 text-warmgray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
          <span className="font-medium text-warmgray-700 min-w-0 truncate">{r.to_station || '—'}</span>
          <span className="ml-auto text-ringo-600 font-bold tabular-nums shrink-0">
            ¥{(Number(r.fare) || 0).toLocaleString('ja-JP')}
          </span>
        </div>
      ))}
      <div className="pt-1.5 border-t border-warmgray-100 flex justify-between text-xs font-semibold text-warmgray-600">
        <span>{lang === 'ja' ? '合計（往復）' : 'Total (round-trip)'}</span>
        <span className="text-ringo-700 tabular-nums">¥{total.toLocaleString('ja-JP')}</span>
      </div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Renders just the VALUE of a form field — no label, no container.
 * Callers wrap in whatever dt/dd/box styling their context requires.
 *
 * For repeat_group, pass a `renderRepeat` prop to avoid circular imports
 * (RepeatGroupDisplay uses FieldValueContent for cells).
 */
export function FieldValueContent({
  field,
  value,
  renderRepeat,
}: {
  field: DisplayField;
  value: unknown;
  /** Called for repeat_group fields to avoid circular import */
  renderRepeat?: (field: DisplayField, value: unknown) => React.ReactNode;
}): React.ReactNode {
  const { lang } = useLang();

  if (field.type === 'repeat_group') {
    return renderRepeat ? renderRepeat(field, value) : <span className="text-warmgray-300 text-xs">—</span>;
  }

  if (field.type === 'route_entry') {
    return <RouteEntryDisplay value={value} lang={lang} />;
  }

  if (field.type === 'allowance_days') {
    return <span>{formatAllowanceDays(value, lang)}</span>;
  }

  const isFile = field.type === 'file' || field.type === 'ai_file_reader' || isFileValue(value);
  if (isFile && value) return <FileLinks val={value} />;

  if (value == null || value === '') return <span className="text-warmgray-300 text-xs">—</span>;

  const label = optionLabel(field as never, value, lang);
  return (
    <span className={field.type === 'textarea' ? 'block whitespace-pre-wrap leading-relaxed' : ''}>
      {label || String(value)}
    </span>
  );
}
