import { useLang } from '../../context/LanguageContext';
import { FieldValueContent, isFileValue, isLongField } from './FieldValueDisplay';

export interface RepeatDisplayField {
  name: string;
  label: string;
  label_en?: string | null;
  type: string;
  fields?: RepeatDisplayField[];
  options?: Array<{ value: string; label_ja?: string; label_en?: string; label?: string }>;
}

function labelFor(field: RepeatDisplayField, lang: 'ja' | 'en'): string {
  return lang === 'en' && field.label_en ? field.label_en : field.label;
}

function isBlank(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
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
              const full = isLongField(child, cell) || child.type === 'file' || isFileValue(cell);
              return (
                <div key={child.name} className={`min-w-0 ${full ? 'md:col-span-2' : ''}`}>
                  <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-0.5 break-words [overflow-wrap:anywhere]">
                    {labelFor(child, lang)}
                  </dt>
                  <dd className="text-sm font-medium text-warmgray-800 break-words [overflow-wrap:anywhere]">
                    {isBlank(cell) && child.type !== 'allowance_days' ? (
                      <span className="text-warmgray-300 text-xs">{t('not_entered')}</span>
                    ) : (
                      <FieldValueContent field={child} value={cell} />
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
