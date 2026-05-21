import { useLang } from '../../context/LanguageContext';
import type { TransportFormData, TransportEntry, TransportRoute } from './TransportationForm';

// ── Schema types (mirrors FormsTab.tsx FormField, minimal surface) ─────────────

interface SchemaField {
  name: string;
  label: string;
  label_en?: string | null;
  type: string;
  entry_field?: boolean;
  options?: { value: string; label_ja: string; label_en: string }[];
  rate_source?: 'user_role' | 'custom';
  custom_rate?: number;
  show_mode?: boolean;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface TransportationDetailProps {
  formData: TransportFormData | Record<string, unknown>;
  dailyAllowanceRate?: number | null;
  compact?: boolean;
  /** Pass template.schema_definition for dynamic field labels/rendering */
  schema?: { fields: SchemaField[] };
}

// ── Fallback entry fields (same as TransportationForm.tsx) ─────────────────────

const FALLBACK_ENTRY_FIELDS: SchemaField[] = [
  { name: 'date',           label: '日付',           label_en: 'Date',           type: 'date',           entry_field: true },
  { name: 'destination',    label: '出張先',          label_en: 'Destination',    type: 'text',           entry_field: true },
  { name: 'purpose',        label: '訪問先（用務）',  label_en: 'Purpose',        type: 'text',           entry_field: true },
  { name: 'routes',         label: '交通費',          label_en: 'Routes',         type: 'route_entry',    entry_field: true, show_mode: true,
    options: [
      { value: 'train', label_ja: '電車・地下鉄', label_en: 'Train / Subway' },
      { value: 'bus',   label_ja: 'バス',          label_en: 'Bus' },
      { value: 'taxi',  label_ja: 'タクシー',      label_en: 'Taxi' },
      { value: 'car',   label_ja: '自家用車',      label_en: 'Private Car' },
      { value: 'airplane', label_ja: '飛行機',     label_en: 'Airplane' },
      { value: 'other', label_ja: 'その他',        label_en: 'Other' },
    ]
  },
  { name: 'allowance_days', label: '日当支給日数',    label_en: 'Allowance Days', type: 'allowance_days', entry_field: true },
  { name: 'other_expense',  label: 'その他費用',      label_en: 'Other Expenses', type: 'number',         entry_field: true },
  { name: 'note',           label: '備考',            label_en: 'Note',           type: 'text',           entry_field: true },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function yen(n: number): string {
  return `¥${Number(n).toLocaleString('ja-JP')}`;
}

function getEntryFields(schema?: { fields: SchemaField[] }): SchemaField[] {
  if (!schema?.fields) return FALLBACK_ENTRY_FIELDS;
  const ef = schema.fields.filter((f) => !!f.entry_field);
  return ef.length > 0 ? ef : FALLBACK_ENTRY_FIELDS;
}

function findByType(fields: SchemaField[], type: string): SchemaField | undefined {
  return fields.find((f) => f.type === type);
}

function getRoutes(e: TransportEntry, entryFields: SchemaField[]): TransportRoute[] {
  const rf = findByType(entryFields, 'route_entry');
  const routes = rf ? e[rf.name] : e.routes;
  return (routes as TransportRoute[] | undefined) ?? [];
}

function getAllowanceDays(e: TransportEntry, entryFields: SchemaField[]): number {
  const af = findByType(entryFields, 'allowance_days');
  return Number(af ? e[af.name] : e.allowance_days) || 0;
}

function getOtherExpense(e: TransportEntry, entryFields: SchemaField[]): number {
  const nf = entryFields.find((f) => f.type === 'number');
  return Math.max(0, Number(nf ? e[nf.name] : e.other_expense) || 0);
}

function calcEntryFare(e: TransportEntry, entryFields: SchemaField[]): number {
  return getRoutes(e, entryFields).reduce((s, r) => s + (Number(r.fare) || 0), 0);
}

function getAllowanceRate(field: SchemaField, userRate: number | null): number {
  if (field.rate_source === 'custom' && field.custom_rate != null) return field.custom_rate;
  return userRate ?? 0;
}

function calcEntryAllowance(e: TransportEntry, entryFields: SchemaField[], rate: number | null): number {
  const af = findByType(entryFields, 'allowance_days');
  if (!af) return 0;
  return getAllowanceDays(e, entryFields) * getAllowanceRate(af, rate);
}

function formatDate(d: string): string {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${y}/${m}/${day}`;
}

function allowanceDaysLabel(days: number): string {
  if (days === 0) return '0日';
  if (days === 0.5) return '半日';
  return '1日';
}

// Safely cast unknown formData to TransportFormData
function asFormData(raw: TransportFormData | Record<string, unknown>): TransportFormData | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d['entries'])) return null;
  return raw as TransportFormData;
}

// ── Route Row ────────────────────────────────────────────────────────────────

function RouteRow({
  route,
  modeOptions,
}: {
  route: TransportRoute;
  modeOptions?: { value: string; label_ja: string; label_en: string }[];
}) {
  const modeLabel = route.mode && modeOptions
    ? (modeOptions.find((o) => o.value === route.mode)?.label_ja ?? route.mode)
    : null;
  return (
    <div className="flex items-start gap-2 text-sm text-warmgray-700">
      <div className="flex-1 min-w-0">
        {modeLabel && (
          <span className="inline-block text-[10px] font-semibold bg-ringo-100 text-ringo-700 rounded px-1.5 py-0.5 mb-1">
            {modeLabel}
          </span>
        )}
        <div className="flex items-center gap-1.5">
          <span className="truncate max-w-[110px]">{route.from_station || '—'}</span>
          <span className="text-warmgray-400 shrink-0">→</span>
          <span className="truncate max-w-[110px]">{route.to_station || '—'}</span>
        </div>
      </div>
      <span className="text-warmgray-500 whitespace-nowrap tabular-nums shrink-0">
        {yen(Number(route.fare) || 0)}
      </span>
    </div>
  );
}

// ── Entry Card ───────────────────────────────────────────────────────────────

function EntryCard({
  entry,
  rate,
  index,
  entryFields,
}: {
  entry: TransportEntry;
  rate: number | null;
  index: number;
  entryFields: SchemaField[];
}) {
  const fare       = calcEntryFare(entry, entryFields);
  const allowance  = calcEntryAllowance(entry, entryFields, rate);
  const other      = getOtherExpense(entry, entryFields);
  const subtotal   = fare + allowance + other;
  const routes     = getRoutes(entry, entryFields);
  const allowDays  = getAllowanceDays(entry, entryFields);
  // Mode options from the route_entry field config (for per-route mode label display)
  const routeField  = findByType(entryFields, 'route_entry');
  const modeOptions = routeField?.show_mode ? (routeField.options ?? undefined) : undefined;

  // Look up date + destination + purpose fields by name from schema (or fallback)
  const dateF    = entryFields.find((f) => f.type === 'date');
  const dateVal  = dateF ? (entry[dateF.name] as string | undefined) ?? '' : '';

  const destF    = entryFields.find((f) => f.name === 'destination') ?? entryFields.find((f) => f.type === 'text');
  const destVal  = destF ? (entry[destF.name] as string | undefined) ?? '' : '';

  const purpF    = entryFields.find((f) => f.name === 'purpose');
  const purpVal  = purpF ? (entry[purpF.name] as string | undefined) ?? '' : '';

  const noteF    = entryFields.find((f) => f.name === 'note') ?? entryFields.filter((f) => f.type === 'text').slice(-1)[0];
  const noteVal  = noteF && noteF !== destF ? (entry[noteF.name] as string | undefined) ?? '' : '';

  // Collect extra text fields (not date/dest/purpose/note/route_entry/allowance_days/number)
  const knownNames = new Set([dateF?.name, destF?.name, purpF?.name, noteF?.name].filter(Boolean));
  const extraTextFields = entryFields.filter(
    (f) => !['date','route_entry','allowance_days','number'].includes(f.type) && !knownNames.has(f.name),
  );

  return (
    <div className="card border border-warmgray-200 rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-ringo-100 text-ringo-700 text-xs font-semibold">
            {index + 1}
          </span>
          <div>
            {dateVal && <div className="font-medium text-warmgray-900">{formatDate(dateVal)}</div>}
            {destVal && <div className="text-sm text-warmgray-600">{destVal}</div>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-warmgray-500">小計</div>
          <div className="font-semibold text-warmgray-900">{yen(subtotal)}</div>
        </div>
      </div>

      {/* Purpose */}
      {purpVal && (
        <div className="text-sm text-warmgray-600">
          <span className="text-warmgray-400">{purpF?.label ?? '用務'}：</span>{purpVal}
        </div>
      )}

      {/* Extra fields (text, select, etc.) */}
      {extraTextFields.map((f) => {
        const raw = (entry[f.name] as string | undefined) ?? '';
        if (!raw) return null;
        // Resolve select option label if options present
        const displayVal = f.type === 'select' && f.options
          ? (f.options.find((o) => o.value === raw)?.label_ja ?? raw)
          : raw;
        return (
          <div key={f.name} className="text-sm text-warmgray-600">
            <span className="text-warmgray-400">{f.label}：</span>{displayVal}
          </div>
        );
      })}

      {/* Routes */}
      {routes.length > 0 && (
        <div className="bg-ringo-50/40 border border-ringo-100 rounded-md p-3 space-y-1.5">
          <div className="text-xs font-medium text-warmgray-500 mb-1">交通費</div>
          {routes.map((r: TransportRoute) => (
            <RouteRow key={r.id} route={r} modeOptions={modeOptions} />
          ))}
          <div className="pt-1 border-t border-ringo-100 flex justify-between text-sm">
            <span className="text-warmgray-500">交通費計</span>
            <span className="font-medium text-warmgray-800">{yen(fare)}</span>
          </div>
        </div>
      )}

      {/* Allowance */}
      {allowDays > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-warmgray-500">
            日当 {allowanceDaysLabel(allowDays)} × {yen(rate ?? 0)}
          </span>
          <span className="font-medium text-warmgray-800">{yen(allowance)}</span>
        </div>
      )}

      {/* Other expenses */}
      {other > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-warmgray-500">その他費用</span>
          <span className="font-medium text-warmgray-800">{yen(other)}</span>
        </div>
      )}

      {/* Note */}
      {noteVal && (
        <div className="text-sm text-warmgray-500 italic">
          {noteF?.label ?? '備考'}：{noteVal}
        </div>
      )}
    </div>
  );
}

// ── Totals Grid ───────────────────────────────────────────────────────────────

function TotalsGrid({ data }: { data: TransportFormData }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="bg-warmgray-50 border border-warmgray-200 rounded-lg p-3 text-center">
        <div className="text-xs text-warmgray-500 mb-1">交通費合計</div>
        <div className="font-semibold text-warmgray-900">{yen(data.transport_total ?? 0)}</div>
      </div>
      <div className="bg-warmgray-50 border border-warmgray-200 rounded-lg p-3 text-center">
        <div className="text-xs text-warmgray-500 mb-1">日当合計</div>
        <div className="font-semibold text-warmgray-900">{yen(data.allowance_total ?? 0)}</div>
      </div>
      <div className="bg-warmgray-50 border border-warmgray-200 rounded-lg p-3 text-center">
        <div className="text-xs text-warmgray-500 mb-1">その他合計</div>
        <div className="font-semibold text-warmgray-900">{yen(data.other_total ?? 0)}</div>
      </div>
      <div className="bg-ringo-50 border border-ringo-200 rounded-lg p-3 text-center">
        <div className="text-xs text-ringo-600 mb-1 font-medium">申請合計</div>
        <div className="font-bold text-ringo-700 text-lg">{yen(data.grand_total ?? 0)}</div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function TransportationDetail({
  formData,
  dailyAllowanceRate,
  compact = false,
  schema,
}: TransportationDetailProps) {
  const { lang } = useLang();
  const data = asFormData(formData);

  if (!data) {
    return (
      <div className="text-sm text-warmgray-500 italic">
        {lang === 'ja' ? '申請データを読み込めませんでした。' : 'Could not load application data.'}
      </div>
    );
  }

  const rate = dailyAllowanceRate ?? null;
  const entries: TransportEntry[] = data.entries ?? [];
  const entryFields = getEntryFields(schema);

  // Compact mode: totals only (used in approval list rows, email previews)
  if (compact) {
    return <TotalsGrid data={data} />;
  }

  return (
    <div className="space-y-5">
      {/* Title */}
      {data.title && (
        <div className="text-sm text-warmgray-500">
          {lang === 'ja' ? '対象期間：' : 'Period: '}
          <span className="font-medium text-warmgray-700">{data.title}</span>
        </div>
      )}

      {/* Totals */}
      <TotalsGrid data={data} />

      {/* Entries */}
      {entries.length === 0 ? (
        <div className="text-sm text-warmgray-400 text-center py-6">
          {lang === 'ja' ? '明細がありません。' : 'No entries found.'}
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-warmgray-600">
            {lang === 'ja' ? `明細一覧（${entries.length}件）` : `Entries (${entries.length})`}
          </h3>
          {entries.map((entry: TransportEntry, i: number) => (
            <EntryCard key={entry.id} entry={entry} rate={rate} index={i} entryFields={entryFields} />
          ))}
        </div>
      )}
    </div>
  );
}
