import { useState, useMemo, useCallback } from 'react';
import { useLang } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import CalendarPicker from './CalendarPicker';
import CustomSelect from './CustomSelect';

// ── Exported types ─────────────────────────────────────────────────────────────

export interface TransportRoute {
  id: string;
  mode?: string;        // transport mode value (e.g. 'train', 'taxi') — optional
  mode_custom?: string; // free-text label when mode === 'other'
  from_station: string;
  to_station: string;
  fare: number;
}

export const TRANSPORT_MODE_OPTIONS = [
  { value: 'train',    label_ja: '電車・地下鉄', label_en: 'Train / Subway' },
  { value: 'bus',      label_ja: 'バス',          label_en: 'Bus' },
  { value: 'taxi',     label_ja: 'タクシー',      label_en: 'Taxi' },
  { value: 'car',      label_ja: '自家用車',      label_en: 'Private Car' },
  { value: 'airplane', label_ja: '飛行機',        label_en: 'Airplane' },
  { value: 'other',    label_ja: 'その他',        label_en: 'Other' },
];

/**
 * A single daily expense entry.
 * Named fields preserved for backward-compat with existing saved applications.
 * Index signature allows schema-driven fields with any name.
 */
export interface TransportEntry {
  id: string;
  // Known field names — kept for backward compat with existing saved data
  date?: string;
  destination?: string;
  purpose?: string;
  routes?: TransportRoute[];
  allowance_days?: number;
  other_expense?: number;
  note?: string;
  // Dynamic schema-defined fields
  [key: string]: unknown;
}

export interface TransportFormData {
  title: string;
  entries: TransportEntry[];
  transport_total: number;
  allowance_total: number;
  other_total: number;
  grand_total: number;
}

// ── Props — matches DynamicForm interface shape ────────────────────────────────

interface SchemaField {
  name: string;
  label: string;
  label_en?: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  /** True = renders inside per-day entry section */
  entry_field?: boolean;
  validation?: { min?: number; max?: number; maxlength?: number };
  options?: { value: string; label_ja: string; label_en: string }[];
  /** allowance_days: 'user_role' (default) = from allowance_rates table; 'custom' = custom_rate ¥/day */
  rate_source?: 'user_role' | 'custom';
  custom_rate?: number;
  /** route_entry: show copy-return button. Default true when undefined */
  show_copy_return?: boolean;
  /** route_entry: show mode selector per route row. Options array defines choices */
  show_mode?: boolean;
}

interface Template {
  id: string;
  title_ja: string;
  schema_definition?: { fields: SchemaField[] };
}

interface TransportationFormProps {
  template: Template;
  onSubmit: (data: { template_id: string; stage: string; form_data: TransportFormData }) => Promise<void>;
  onDraft?: (data: { template_id: string; stage: string; form_data: TransportFormData }) => Promise<void>;
  disabled?: boolean;
  defaultValues?: Partial<TransportFormData>;
}

// ── Fallback entry fields (used when migration 036 hasn't run yet) ─────────────

const FALLBACK_ALLOWANCE_OPTIONS = [
  { value: '0',   label_ja: '0',   label_en: '0' },
  { value: '0.5', label_ja: '0.5', label_en: '0.5' },
  { value: '1',   label_ja: '1',   label_en: '1' },
];

const FALLBACK_ENTRY_FIELDS: SchemaField[] = [
  { name: 'date',           label: '日付',          label_en: 'Date',           type: 'date',          required: true,  entry_field: true },
  { name: 'destination',    label: '出張先',        label_en: 'Destination',    type: 'text',          required: true,  entry_field: true },
  { name: 'purpose',        label: '訪問先（用務）', label_en: 'Purpose',        type: 'text',          required: false, entry_field: true },
  { name: 'routes',         label: '交通費',        label_en: 'Routes',         type: 'route_entry',   required: false, entry_field: true, show_mode: true, options: TRANSPORT_MODE_OPTIONS },
  { name: 'allowance_days', label: '日当支給日数',  label_en: 'Allowance Days', type: 'allowance_days',required: false, entry_field: true, options: FALLBACK_ALLOWANCE_OPTIONS },
  { name: 'other_expense',  label: 'その他費用',    label_en: 'Other Expenses', type: 'number',        required: false, entry_field: true, validation: { min: 0 } },
  { name: 'note',           label: '備考',          label_en: 'Note',           type: 'text',          required: false, entry_field: true },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function autoTitle(): string {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月分`;
}

function newRoute(): TransportRoute {
  return { id: crypto.randomUUID(), mode: '', from_station: '', to_station: '', fare: 0 };
}

function newEntry(entryFields: SchemaField[]): TransportEntry {
  const e: TransportEntry = { id: crypto.randomUUID() };
  for (const f of entryFields) {
    switch (f.type) {
      case 'date':          e[f.name] = todayStr(); break;
      case 'route_entry':   e[f.name] = [newRoute()]; break;
      case 'allowance_days':e[f.name] = 0; break;
      case 'number':        e[f.name] = 0; break;
      default:              e[f.name] = ''; break;
    }
  }
  return e;
}

function findFieldByType(fields: SchemaField[], type: string): SchemaField | undefined {
  return fields.find((f) => f.type === type);
}

function entryRoutes(e: TransportEntry, entryFields: SchemaField[]): TransportRoute[] {
  const rf = findFieldByType(entryFields, 'route_entry');
  if (!rf) return [];
  return (e[rf.name] as TransportRoute[] | undefined) ?? [];
}

function entryFare(e: TransportEntry, entryFields: SchemaField[]): number {
  // Sum fares as entered — no automatic doubling.
  // Use the copy-return button to add return routes explicitly.
  return entryRoutes(e, entryFields).reduce((s, r) => s + (Number(r.fare) || 0), 0);
}

function getAllowanceRate(field: SchemaField, userDailyRate: number | null): number {
  if (field.rate_source === 'custom' && field.custom_rate != null) return field.custom_rate;
  return userDailyRate ?? 0;
}

function entryAllowanceAmt(e: TransportEntry, entryFields: SchemaField[], userDailyRate: number | null): number {
  const af = findFieldByType(entryFields, 'allowance_days');
  if (!af) return 0;
  return Number(e[af.name] ?? 0) * getAllowanceRate(af, userDailyRate);
}

function entryOtherAmt(e: TransportEntry, entryFields: SchemaField[]): number {
  // Find first number field that is not computed/sum_target
  const nf = entryFields.find((f) => f.type === 'number');
  if (!nf) return 0;
  return Math.max(0, Number(e[nf.name] ?? 0) || 0);
}

function calcTotals(
  entries: TransportEntry[],
  entryFields: SchemaField[],
  dailyRate: number | null,
): { transport_total: number; allowance_total: number; other_total: number; grand_total: number } {
  let transport_total = 0;
  let allowance_total = 0;
  let other_total = 0;
  for (const e of entries) {
    transport_total += entryFare(e, entryFields);
    allowance_total += entryAllowanceAmt(e, entryFields, dailyRate);
    other_total     += entryOtherAmt(e, entryFields);
  }
  return { transport_total, allowance_total, other_total, grand_total: transport_total + allowance_total + other_total };
}

function entrySubtotal(e: TransportEntry, entryFields: SchemaField[], rate: number | null): number {
  return entryFare(e, entryFields) + entryAllowanceAmt(e, entryFields, rate) + entryOtherAmt(e, entryFields);
}

function yen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`;
}

// ── Validation ─────────────────────────────────────────────────────────────────

interface EntryErrors {
  [fieldName: string]: string;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function TransportationForm({
  template,
  onSubmit,
  onDraft,
  disabled = false,
  defaultValues,
}: TransportationFormProps) {
  const { lang } = useLang();
  const { user } = useAuth();

  const dailyRate = user?.daily_allowance_rate ?? null;

  // ── Schema field split ────────────────────────────────────────────────────
  const allSchemaFields = template.schema_definition?.fields ?? [];
  const headerFields = useMemo(
    () => {
      const hf = allSchemaFields.filter((f) => !f.entry_field);
      // If no header fields in schema, fall back to title-only
      return hf.length > 0 ? hf : [
        { name: 'title', label: '件名', label_en: 'Subject', type: 'text', required: true, placeholder: '例）2025年5月分' } as SchemaField,
      ];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [template.schema_definition],
  );

  const entryFields = useMemo(
    () => {
      const ef = allSchemaFields.filter((f) => !!f.entry_field);
      // Fall back to hardcoded defaults if migration 036 hasn't run yet
      return ef.length > 0 ? ef : FALLBACK_ENTRY_FIELDS;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [template.schema_definition],
  );

  // Find named fields by type for UI rendering
  const routeField     = useMemo(() => findFieldByType(entryFields, 'route_entry'),   [entryFields]);
  const allowanceField = useMemo(() => findFieldByType(entryFields, 'allowance_days'),[entryFields]);
  const dateField      = useMemo(() => entryFields.find((f) => f.type === 'date'),    [entryFields]);
  const destField      = useMemo(
    () => entryFields.find((f) => f.name === 'destination') ??
          entryFields.find((f) => f.type === 'text'),
    [entryFields],
  );

  // ── State ─────────────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<TransportEntry[]>(
    defaultValues?.entries ?? [],
  );
  const [currentEntry, setCurrentEntry] = useState<TransportEntry>(() => newEntry(entryFields));
  const [headerData, setHeaderData] = useState<Record<string, string>>(() => {
    const hd: Record<string, string> = {};
    if (defaultValues?.title) hd['title'] = defaultValues.title;
    return hd;
  });
  const [errors, setErrors] = useState<EntryErrors>({});
  const [isDrafting, setIsDrafting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const busy = disabled || isDrafting || isSubmitting;

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentRoutes = useMemo(
    () => routeField ? (currentEntry[routeField.name] as TransportRoute[] | undefined) ?? [] : [],
    [currentEntry, routeField],
  );

  const currentTransportFare = useMemo(
    () => currentRoutes.reduce((s, r) => s + (Number(r.fare) || 0), 0),
    [currentRoutes],
  );

  const currentAllowanceDays = useMemo(
    () => allowanceField ? Number(currentEntry[allowanceField.name] ?? 0) : 0,
    [currentEntry, allowanceField],
  );

  const totals = useMemo(() => calcTotals(entries, entryFields, dailyRate), [entries, entryFields, dailyRate]);

  const hasDuplicateDate = useMemo(() => {
    if (!dateField) return false;
    const d = currentEntry[dateField.name] as string | undefined;
    return !!d && entries.some((e) => (e[dateField.name] as string) === d);
  }, [entries, currentEntry, dateField]);

  // ── Payload builder ───────────────────────────────────────────────────────
  const buildPayload = useCallback(
    (ents: TransportEntry[]): { template_id: string; stage: string; form_data: TransportFormData } => {
      const t = calcTotals(ents, entryFields, dailyRate);
      return {
        template_id: template.id,
        stage: 'SETTLEMENT',
        form_data: {
          title: (headerData['title'] as string | undefined) ?? autoTitle(),
          entries: ents,
          ...t,
        },
      };
    },
    [template.id, dailyRate, headerData, entryFields],
  );

  // ── Validate current entry ────────────────────────────────────────────────
  const validateEntry = useCallback((): boolean => {
    const errs: EntryErrors = {};
    for (const f of entryFields) {
      if (!f.required) continue;
      const val = currentEntry[f.name];
      if (f.type === 'date' || f.type === 'text') {
        if (!val || !(val as string).trim()) {
          errs[f.name] = lang === 'ja' ? `${f.label}は必須です` : `${f.label_en ?? f.label} is required`;
        }
      }
    }
    // At least one route with from+to if route_entry field present
    if (routeField) {
      const routes = (currentEntry[routeField.name] as TransportRoute[] | undefined) ?? [];
      const hasRoute = routes.some((r) => r.from_station.trim() && r.to_station.trim());
      if (!hasRoute) {
        errs[routeField.name] = lang === 'ja' ? '乗車駅・降車駅を1つ以上入力してください' : 'Enter at least one route';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [currentEntry, entryFields, routeField, lang]);

  // ── 一時保存 (save today's entry to list) ────────────────────────────────
  const handleSaveEntry = useCallback(async () => {
    if (!validateEntry()) return;
    const newEntries = [...entries, currentEntry];
    setEntries(newEntries);
    setCurrentEntry(newEntry(entryFields));
    setErrors({});
    if (onDraft) {
      setIsDrafting(true);
      try { await onDraft(buildPayload(newEntries)); } finally { setIsDrafting(false); }
    }
  }, [currentEntry, entries, entryFields, validateEntry, onDraft, buildPayload]);

  // ── Delete saved entry ────────────────────────────────────────────────────
  const handleDeleteEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // ── 下書き保存 (save all as draft) ───────────────────────────────────────
  const handleDraftAll = useCallback(async () => {
    if (!onDraft) return;
    setIsDrafting(true);
    try { await onDraft(buildPayload(entries)); } finally { setIsDrafting(false); }
  }, [onDraft, entries, buildPayload]);

  // ── 申請する (submit all) ─────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (entries.length === 0) return;
    setIsSubmitting(true);
    try { await onSubmit(buildPayload(entries)); } finally { setIsSubmitting(false); }
  }, [entries, onSubmit, buildPayload]);

  // ── Route row helpers ─────────────────────────────────────────────────────
  const updateRoute = useCallback((ri: number, updated: TransportRoute) => {
    if (!routeField) return;
    const name = routeField.name;
    setCurrentEntry((p) => ({
      ...p,
      [name]: (p[name] as TransportRoute[]).map((r, i) => (i === ri ? updated : r)),
    }));
  }, [routeField]);

  const deleteRoute = useCallback((ri: number) => {
    if (!routeField) return;
    const name = routeField.name;
    setCurrentEntry((p) => {
      const routes = p[name] as TransportRoute[];
      if (routes.length <= 1) return p;
      return { ...p, [name]: routes.filter((_, i) => i !== ri) };
    });
  }, [routeField]);

  const addRoute = useCallback(() => {
    if (!routeField) return;
    const name = routeField.name;
    setCurrentEntry((p) => ({ ...p, [name]: [...(p[name] as TransportRoute[]), newRoute()] }));
  }, [routeField]);

  const swapRoute = useCallback((ri: number) => {
    if (!routeField) return;
    const name = routeField.name;
    setCurrentEntry((p) => ({
      ...p,
      [name]: (p[name] as TransportRoute[]).map((r, i) =>
        i === ri ? { ...r, from_station: r.to_station, to_station: r.from_station } : r,
      ),
    }));
  }, [routeField]);

  const copyReturnRoute = useCallback(() => {
    if (!routeField) return;
    const name = routeField.name;
    setCurrentEntry((p) => {
      const routes = p[name] as TransportRoute[];
      const last = routes[routes.length - 1];
      if (!last) return p;
      return {
        ...p,
        [name]: [
          ...routes,
          { id: crypto.randomUUID(), mode: last.mode, mode_custom: last.mode_custom, from_station: last.to_station, to_station: last.from_station, fare: last.fare },
        ],
      };
    });
  }, [routeField]);

  // ── Field change helper ───────────────────────────────────────────────────
  const setEntryField = useCallback((name: string, value: unknown) => {
    setCurrentEntry((p) => ({ ...p, [name]: value }));
  }, []);

  // ── Render entry field ────────────────────────────────────────────────────
  const renderEntryField = (f: SchemaField) => {
    const fieldLabel = (lang === 'en' && f.label_en) ? f.label_en : f.label;
    const hasError = !!errors[f.name];

    switch (f.type) {

      case 'route_entry': {
        return (
          <div key={f.name}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-warmgray-700 uppercase tracking-wider">
                {fieldLabel}
                {f.required && <span className="text-red-500 ml-0.5">*</span>}
              </span>
              <span className="text-xs font-semibold text-ringo-600 tabular-nums">
                {lang === 'ja' ? '交通費計:' : 'Total:'} {yen(currentTransportFare)}
              </span>
            </div>
            <div className="space-y-2.5 rounded-xl border border-ringo-100 bg-ringo-50/40 p-3">
              {currentRoutes.map((route, ri) => (
                <div key={route.id} className="flex flex-col gap-1.5">
                  {/* Mode selector row (only when show_mode: true; falls back to TRANSPORT_MODE_OPTIONS) */}
                  {f.show_mode && (
                    <div className="flex items-center gap-2">
                      <CustomSelect
                        value={route.mode ?? ''}
                        onChange={(val) => updateRoute(ri, { ...route, mode: val, mode_custom: val !== 'other' ? undefined : route.mode_custom })}
                        disabled={busy}
                        placeholder={lang === 'en' ? 'Mode' : '交通手段'}
                        options={(f.options && f.options.length > 0 ? f.options : TRANSPORT_MODE_OPTIONS)
                          .map((o) => ({ value: o.value, label: (lang === 'en' ? o.label_en : o.label_ja) ?? o.value }))}
                        className="text-xs w-full sm:w-auto sm:max-w-[180px]"
                      />
                      {route.mode === 'other' && (
                        <input
                          type="text"
                          value={route.mode_custom ?? ''}
                          onChange={(e) => updateRoute(ri, { ...route, mode_custom: e.target.value })}
                          placeholder={lang === 'en' ? 'Specify transport' : '交通手段を入力'}
                          disabled={busy}
                          className="input flex-1 text-xs"
                        />
                      )}
                    </div>
                  )}
                  {/* From / swap / to / fare / delete */}
                  <div className="flex items-center gap-1.5 md:gap-2">
                    <input
                      type="text"
                      value={route.from_station}
                      onChange={(e) => updateRoute(ri, { ...route, from_station: e.target.value })}
                      placeholder={lang === 'ja' ? '乗車駅 / 出発地' : 'From'}
                      disabled={busy}
                      className="input flex-1 min-w-0 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => swapRoute(ri)}
                      disabled={busy}
                      title={lang === 'ja' ? '乗降を入替' : 'Swap'}
                      className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-warmgray-300 bg-white text-warmgray-400 hover:text-ringo-600 hover:border-ringo-300 transition-colors disabled:opacity-40"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                    </button>
                    <input
                      type="text"
                      value={route.to_station}
                      onChange={(e) => updateRoute(ri, { ...route, to_station: e.target.value })}
                      placeholder={lang === 'ja' ? '降車駅 / 到着地' : 'To'}
                      disabled={busy}
                      className="input flex-1 min-w-0 text-sm"
                    />
                    <div className="relative shrink-0 w-20 md:w-24">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-warmgray-400 pointer-events-none">¥</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={route.fare === 0 ? '' : route.fare}
                        onChange={(e) =>
                          updateRoute(ri, {
                            ...route,
                            fare: e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0),
                          })
                        }
                        placeholder="0"
                        disabled={busy}
                        className="input pl-6 tabular-nums w-full text-sm"
                      />
                    </div>
                    {currentRoutes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => deleteRoute(ri)}
                        disabled={busy}
                        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-warmgray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {hasError && <p className="text-xs text-red-500">⚠ {errors[f.name]}</p>}

              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <button
                  type="button"
                  onClick={addRoute}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-ringo-300 bg-white px-3 py-1.5 text-xs font-semibold text-ringo-600 hover:bg-ringo-50 disabled:opacity-40 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  {lang === 'ja' ? '経路追加' : 'Add route'}
                </button>
                {f.show_copy_return !== false && (
                  <button
                    type="button"
                    onClick={copyReturnRoute}
                    disabled={busy || currentRoutes.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-amber-400/70 bg-amber-50/60 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-40 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    {lang === 'ja' ? '復路コピー' : 'Copy return'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      }

      case 'allowance_days': {
        const effectiveRate = getAllowanceRate(f, dailyRate);
        const rateLabel = effectiveRate > 0 ? `¥${effectiveRate.toLocaleString('ja-JP')}/日` : null;
        // Use admin-configured options, or fall back to default 0/0.5/1
        const allowOpts = (f.options && f.options.length > 0)
          ? f.options.map((o) => ({ value: parseFloat(o.value), label: lang === 'en' ? o.label_en : o.label_ja }))
          : [{ value: 0, label: '0' }, { value: 0.5, label: '0.5' }, { value: 1, label: '1' }];
        return (
          <div key={f.name} className="flex flex-col gap-1.5">
            <label className="label">
              {fieldLabel}
              {rateLabel && <span className="ml-1.5 text-xs text-warmgray-400 font-normal">({rateLabel})</span>}
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {allowOpts.map(({ value: v, label: lbl }) => (
                <button
                  key={v}
                  type="button"
                  disabled={busy}
                  onClick={() => setEntryField(f.name, v)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                    currentAllowanceDays === v
                      ? 'bg-ringo-500 text-white border-ringo-500'
                      : 'bg-white text-warmgray-600 border-warmgray-300 hover:border-ringo-300 hover:text-ringo-600'
                  } disabled:opacity-40`}
                >
                  {lbl}
                </button>
              ))}
              {currentAllowanceDays > 0 && effectiveRate > 0 && (
                <span className="text-xs text-ringo-600 font-semibold tabular-nums">
                  = {yen(currentAllowanceDays * effectiveRate)}
                </span>
              )}
            </div>
          </div>
        );
      }

      case 'number': {
        const minVal = f.validation?.min;
        return (
          <div key={f.name} className="flex flex-col gap-1.5">
            <label className="label">
              {fieldLabel}
              {f.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            <div className="relative w-36">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-warmgray-400 pointer-events-none">¥</span>
              <input
                type="number"
                min={minVal ?? 0}
                step={1}
                value={Number(currentEntry[f.name] ?? 0) === 0 ? '' : Number(currentEntry[f.name])}
                onChange={(e) =>
                  setEntryField(f.name, e.target.value === '' ? 0 : Math.max(minVal ?? 0, parseInt(e.target.value, 10) || 0))
                }
                placeholder={f.placeholder ?? '0'}
                disabled={busy}
                className={`input pl-6 tabular-nums${hasError ? ' border-red-400' : ''}`}
              />
            </div>
            {hasError && <p className="text-xs text-red-500">⚠ {errors[f.name]}</p>}
          </div>
        );
      }

      case 'date': {
        const dateVal = (currentEntry[f.name] as string | undefined) ?? '';
        return (
          <div key={f.name} className="flex flex-col gap-1.5">
            <label className="label">
              {fieldLabel}
              {f.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            <CalendarPicker
              value={dateVal || undefined}
              onChange={(val) => setEntryField(f.name, val)}
              disabled={busy}
              required={f.required}
            />
            {hasError && <p className="text-xs text-red-500">⚠ {errors[f.name]}</p>}
            {hasDuplicateDate && !hasError && (
              <p className="text-xs text-amber-600">
                ⚠ {lang === 'ja' ? 'この日付はすでに保存されています' : 'An entry for this date already exists'}
              </p>
            )}
          </div>
        );
      }

      case 'select': {
        const opts = f.options ?? [];
        const currentVal = (currentEntry[f.name] as string | undefined) ?? '';
        return (
          <div key={f.name} className="flex flex-col gap-1.5">
            <label className="label">
              {fieldLabel}
              {f.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            <CustomSelect
              value={currentVal}
              onChange={(val) => setEntryField(f.name, val)}
              disabled={busy}
              placeholder={lang === 'en' ? 'Select' : '選択'}
              options={opts.map((o) => ({ value: o.value, label: (lang === 'en' ? o.label_en : o.label_ja) ?? o.value }))}
              className={hasError ? 'border-red-400' : ''}
            />
            {hasError && <p className="text-xs text-red-500">⚠ {errors[f.name]}</p>}
          </div>
        );
      }

      case 'textarea': {
        return (
          <div key={f.name} className="flex flex-col gap-1.5">
            <label className="label">
              {fieldLabel}
              {f.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            <textarea
              value={(currentEntry[f.name] as string | undefined) ?? ''}
              onChange={(e) => setEntryField(f.name, e.target.value)}
              placeholder={f.placeholder ?? ''}
              disabled={busy}
              rows={3}
              className={`input resize-none${hasError ? ' border-red-400' : ''}`}
            />
            {hasError && <p className="text-xs text-red-500">⚠ {errors[f.name]}</p>}
          </div>
        );
      }

      default: {
        // text, and any other type
        return (
          <div key={f.name} className="flex flex-col gap-1.5">
            <label className="label">
              {fieldLabel}
              {f.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            <input
              type="text"
              value={(currentEntry[f.name] as string | undefined) ?? ''}
              onChange={(e) => setEntryField(f.name, e.target.value)}
              placeholder={f.placeholder ?? ''}
              disabled={busy}
              className={`input${hasError ? ' border-red-400' : ''}`}
            />
            {hasError && <p className="text-xs text-red-500">⚠ {errors[f.name]}</p>}
          </div>
        );
      }
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="card space-y-6">

      {/* ── Header: admin-editable schema fields ─────────────────────────── */}
      <div className="space-y-4">
        {headerFields.map((f) => (
          <div key={f.name} className="flex flex-col gap-1.5">
            <label className="label">
              {lang === 'en' && f.label_en ? f.label_en : f.label}
              {f.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            {f.type === 'date' ? (
              <CalendarPicker
                value={(headerData[f.name] as string | undefined) || undefined}
                onChange={(val) => setHeaderData((p) => ({ ...p, [f.name]: val }))}
                disabled={busy}
                required={f.required}
              />
            ) : (
              <input
                type="text"
                value={headerData[f.name] ?? ''}
                onChange={(e) => setHeaderData((p) => ({ ...p, [f.name]: e.target.value }))}
                placeholder={f.placeholder ?? ''}
                disabled={busy}
                className="input"
              />
            )}
          </div>
        ))}
      </div>

      {/* ── Applicant info (read-only) ────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="label">{lang === 'ja' ? '申請者氏名' : 'Applicant Name'}</label>
          <input readOnly value={user?.full_name ?? ''} className="input bg-warmgray-50 cursor-default" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="label">{lang === 'ja' ? '役職・日当基準' : 'Role / Daily Allowance'}</label>
          <input
            readOnly
            value={dailyRate != null ? `${user?.role ?? ''} （日当：${yen(dailyRate)}/日）` : user?.role ?? ''}
            className="input bg-warmgray-50 cursor-default"
          />
        </div>
      </div>

      {/* ── New entry input form ──────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-warmgray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-ringo-50 border-b border-ringo-100">
          <h3 className="text-sm font-bold text-ringo-700">
            {lang === 'ja' ? '＋ 今日の明細を入力' : '+ Enter today\'s entry'}
          </h3>
        </div>

        <div className="p-5 space-y-4">
          {/* Render all entry fields dynamically */}
          {entryFields.map((f) => renderEntryField(f))}

          {/* Entry footer: subtotal + save button */}
          <div className="flex items-center justify-between rounded-xl bg-ringo-50 border border-ringo-100 px-4 py-2.5">
            <span className="text-xs font-semibold text-warmgray-600">
              {lang === 'ja' ? 'この日の小計:' : 'Day subtotal:'}
              {' '}
              <span className="tabular-nums text-ringo-700">
                {yen(entrySubtotal(currentEntry, entryFields, dailyRate))}
              </span>
            </span>
            <button
              type="button"
              onClick={handleSaveEntry}
              disabled={busy}
              className="btn-primary !py-1.5 !px-4 text-sm flex items-center gap-1.5"
            >
              {isDrafting ? (
                <>
                  <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  {lang === 'ja' ? '保存中…' : 'Saving…'}
                </>
              ) : (
                lang === 'ja' ? '一時保存' : 'Save entry'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Saved entries list ────────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-bold text-warmgray-700 mb-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-warmgray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          {lang === 'ja' ? `保存済み明細（${entries.length}件）` : `Saved entries (${entries.length})`}
        </h3>

        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 rounded-xl border border-dashed border-warmgray-300 bg-white text-center gap-2">
            <svg className="w-8 h-8 text-warmgray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm text-warmgray-500 font-medium">
              {lang === 'ja' ? 'まだ保存された明細がありません' : 'No saved entries yet'}
            </p>
            <p className="text-xs text-warmgray-400">
              {lang === 'ja' ? '上のフォームから日々の交通費を入力してください' : 'Enter daily expenses using the form above'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((e) => {
              const sub  = entrySubtotal(e, entryFields, dailyRate);
              const fare = entryFare(e, entryFields);
              const allowAmt = entryAllowanceAmt(e, entryFields, dailyRate);
              const otherAmt = entryOtherAmt(e, entryFields);
              // Read display fields by name (falls back gracefully)
              const displayDate  = dateField     ? (e[dateField.name]     as string | undefined)  ?? '' : '';
              const displayDest  = destField     ? (e[destField.name]     as string | undefined)  ?? '' : '';
              const displayPurp  = entryFields.find(f => f.name === 'purpose')
                ? (e['purpose'] as string | undefined) ?? '' : '';
              return (
                <div
                  key={e.id}
                  className="rounded-xl border border-warmgray-200 bg-white px-4 py-3 flex items-start justify-between gap-3 shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {displayDate && <span className="text-sm font-semibold text-warmgray-800 tabular-nums">{displayDate}</span>}
                      {displayDest && <span className="text-sm text-warmgray-600 truncate">— {displayDest}</span>}
                      {displayPurp && <span className="text-xs text-warmgray-400 truncate">({displayPurp})</span>}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-warmgray-500 flex-wrap">
                      {fare > 0 && <span>交通費: {yen(fare)}</span>}
                      {allowAmt > 0 && <span>日当: {yen(allowAmt)}</span>}
                      {otherAmt > 0 && <span>その他: {yen(otherAmt)}</span>}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <span className="text-sm font-bold text-ringo-700 tabular-nums">{yen(sub)}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteEntry(e.id)}
                      disabled={busy}
                      className="w-6 h-6 flex items-center justify-center rounded-md text-warmgray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30"
                      title={lang === 'ja' ? '削除' : 'Remove'}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Totals summary (only when entries exist) ─────────────────────── */}
      {entries.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: lang === 'ja' ? '交通費合計' : 'Transport', value: totals.transport_total, accent: false },
            { label: lang === 'ja' ? '日当合計' : 'Allowance', value: totals.allowance_total, accent: false },
            { label: lang === 'ja' ? 'その他合計' : 'Other', value: totals.other_total, accent: false },
            { label: lang === 'ja' ? '申請合計' : 'Grand Total', value: totals.grand_total, accent: true },
          ].map(({ label, value, accent }) => (
            <div
              key={label}
              className={`rounded-xl border px-4 py-3 text-center ${
                accent ? 'border-ringo-200 bg-ringo-50' : 'border-warmgray-200 bg-white'
              }`}
            >
              <p className="text-[11px] text-warmgray-500 mb-1">{label}</p>
              <p className={`text-base font-bold tabular-nums ${accent ? 'text-ringo-700' : 'text-warmgray-800'}`}>
                {yen(value)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── Action buttons ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-warmgray-100">
        {onDraft && (
          <button
            type="button"
            onClick={handleDraftAll}
            disabled={busy}
            className="btn-ghost flex items-center gap-1.5"
          >
            {isDrafting ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                {lang === 'ja' ? '保存中…' : 'Saving…'}
              </>
            ) : (
              lang === 'ja' ? '下書き保存' : 'Save draft'
            )}
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy || entries.length === 0}
          className="btn-primary flex items-center gap-1.5"
        >
          {isSubmitting ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              {lang === 'ja' ? '申請中…' : 'Submitting…'}
            </>
          ) : (
            lang === 'ja'
              ? `申請する${entries.length > 0 ? `（${entries.length}件）` : ''}`
              : `Submit${entries.length > 0 ? ` (${entries.length})` : ''}`
          )}
        </button>
      </div>
    </div>
  );
}
