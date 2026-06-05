// ─────────────────────────────────────────────────────────────────────────────
// Properties panel (right column of FormBuilderV2).
//
// Full field property surface organised into three plain-language tabs —
// Basic / Logic / Display — with `?` help tooltips and an auto-managed field ID
// (snake_case hidden behind a disclosure). Reuses OptionsEditor from FormsTab.
// Group/table child fields are managed in the canvas, not here.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLang } from '../../../context/LanguageContext';
import { OptionsEditor } from '../FormsTab';
import { catalogFor, fieldGlyph, FIELD_CATALOG } from './fieldCatalog';
import { DEFAULT_REPEAT_MAX_ROWS, type FormField } from './types';
import { COL_SPAN_OPTIONS } from '../../forms/fieldLayout';

type Tab = 'basic' | 'logic' | 'appearance';

// ── Small UI helpers ───────────────────────────────────────────────────────────
// Hover/tap popover. Native `title` is unreliable; the bubble is rendered via a
// portal with FIXED positioning so it is never clipped by a scrolling column or
// hidden behind a higher stacking context.
function Hint({ text }: { text: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.top });
  };
  const hide = () => setPos(null);
  return (
    <span className="inline-flex align-middle ml-1">
      <button
        ref={ref}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => { e.preventDefault(); pos ? hide() : show(); }}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-warmgray-200 text-warmgray-500
                   hover:bg-ringo-200 hover:text-ringo-700 text-[9px] font-bold cursor-help select-none"
        aria-label="help"
      >
        ?
      </button>
      {pos && createPortal(
        <span
          style={{ position: 'fixed', left: pos.x, top: pos.y - 8, transform: 'translate(-50%, -100%)', zIndex: 9999 }}
          className="w-48 px-2.5 py-1.5 rounded-lg bg-warmgray-800 text-white text-[10px] font-medium leading-snug
                     shadow-xl pointer-events-none normal-case tracking-normal"
        >
          {text}
          <span className="absolute left-1/2 -translate-x-1/2 top-full -mt-px border-4 border-transparent border-t-warmgray-800" />
        </span>,
        document.body,
      )}
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 flex items-center">
        {label}{hint && <Hint text={hint} />}
      </label>
      {children}
    </div>
  );
}

// Static class maps — Tailwind JIT cannot see interpolated class names, so every
// variant must appear as a complete literal string somewhere in the source.
type Tone = 'warmgray' | 'teal' | 'sky' | 'emerald' | 'violet' | 'amber' | 'slate';
const TONE: Record<Tone, { box: string; title: string }> = {
  warmgray: { box: 'bg-warmgray-50/60 border-warmgray-200/60', title: 'text-warmgray-600' },
  teal:     { box: 'bg-teal-50/50 border-teal-200/50',         title: 'text-teal-700' },
  sky:      { box: 'bg-sky-50/50 border-sky-200/50',           title: 'text-sky-700' },
  emerald:  { box: 'bg-emerald-50/50 border-emerald-200/50',   title: 'text-emerald-700' },
  violet:   { box: 'bg-violet-50/50 border-violet-200/50',     title: 'text-violet-700' },
  amber:    { box: 'bg-amber-50/50 border-amber-200/50',       title: 'text-amber-700' },
  slate:    { box: 'bg-slate-50/60 border-slate-200/60',       title: 'text-slate-600' },
};
type Accent = 'ringo' | 'teal' | 'sky' | 'emerald' | 'violet' | 'amber' | 'slate';
const ACCENT: Record<Accent, string> = {
  ringo: 'accent-ringo-500', teal: 'accent-teal-500', sky: 'accent-sky-500',
  emerald: 'accent-emerald-500', violet: 'accent-violet-500', amber: 'accent-amber-500', slate: 'accent-slate-500',
};

function Toggle({ checked, onChange, label, hint, accent = 'ringo' }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; accent?: Accent;
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-semibold text-warmgray-700 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className={`w-4 h-4 ${ACCENT[accent]}`} />
      <span className="flex items-center">{label}{hint && <Hint text={hint} />}</span>
    </label>
  );
}

function Box({ tone = 'warmgray', title, children }: { tone?: Tone; title?: string; children: React.ReactNode }) {
  return (
    <div className={`${TONE[tone].box} border rounded-xl p-3 space-y-2`}>
      {title && <p className={`text-[10px] font-bold uppercase tracking-widest ${TONE[tone].title}`}>{title}</p>}
      {children}
    </div>
  );
}

// ── Validation presets (text fields) ────────────────────────────────────────────
const REGEX_PRESETS: { key: string; ja: string; en: string; regex: string }[] = [
  { key: 'phone_jp',  ja: '電話番号',     en: 'Phone (JP)',   regex: '^0\\d{1,4}-?\\d{1,4}-?\\d{3,4}$' },
  { key: 'email',     ja: 'メール',       en: 'Email',        regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
  { key: 'postal_jp', ja: '郵便番号',     en: 'Postal (JP)',  regex: '^\\d{3}-?\\d{4}$' },
  { key: 'katakana',  ja: 'カタカナ',     en: 'Katakana',     regex: '^[ァ-ヶー　 ]+$' },
  { key: 'number',    ja: '数字のみ',     en: 'Digits only',  regex: '^\\d+$' },
];

// ── Auto field-ID helpers ────────────────────────────────────────────────────────
function isAutoName(name: string): boolean {
  return name === '' || /^field_\d+$/.test(name) || /_copy(\d+)?$/.test(name);
}
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

// ─────────────────────────────────────────────────────────────────────────────
export default function PropertiesPanel({
  field, index, total, siblingNames, siblingFields, computedFieldNames, otherSchemaFields,
  isCustomRenderer, isChild, onUpdate, onRemove, onMove, onDuplicate,
}: {
  field: FormField;
  index: number;
  total: number;
  siblingNames: string[];
  siblingFields: FormField[];
  computedFieldNames: string[];
  otherSchemaFields: FormField[];
  isCustomRenderer?: boolean;
  isChild?: boolean;
  onUpdate: (patch: Partial<FormField>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
}) {
  const { lang } = useLang();
  const en = lang === 'en';
  const [tab, setTab] = useState<Tab>('basic');
  const [showId, setShowId] = useState(false);
  const formulaRef = useRef<HTMLInputElement>(null);

  const cat = catalogFor(field.type);
  const typeName = cat ? (en ? cat.label_en : cat.label_ja) : field.type;

  const isHeader = field.type === 'header';
  const isText = ['text', 'textarea'].includes(field.type);
  const isNumber = field.type === 'number';
  const isTime = field.type === 'time';
  const isDate = field.type === 'date';
  const isSelect = field.type === 'select';
  const isCheckbox = field.type === 'checkbox';
  const isRepeatGroup = field.type === 'repeat_group';
  const isGroup = field.type === 'field_group';
  const dupName = siblingNames.includes(field.name);

  // Children stay leaves — don't offer container types when editing inside a box.
  const typeOptions = isChild
    ? FIELD_CATALOG.filter((c) => c.type !== 'field_group' && c.type !== 'repeat_group')
    : FIELD_CATALOG;

  // Dropdown of sibling fields — used wherever a field used to be typed by name.
  const FieldRef = ({ value, onChange, placeholder, only }: {
    value?: string; onChange: (v: string | undefined) => void; placeholder: string; only?: (f: FormField) => boolean;
  }) => {
    const opts = only ? siblingFields.filter(only) : siblingFields;
    return (
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className="select text-xs w-full">
        <option value="">{placeholder}</option>
        {opts.map((f) => <option key={f.name} value={f.name}>{f.label || f.name}</option>)}
      </select>
    );
  };

  // Label change → also auto-set the field ID while the ID is still auto-managed.
  const onLabelChange = (label: string) => {
    const patch: Partial<FormField> = { label };
    if (isAutoName(field.name)) {
      const slug = slugify(field.label_en || label);
      if (slug && !siblingNames.includes(slug)) patch.name = slug;
    }
    onUpdate(patch);
  };

  const updateType = (type: string) => {
    if (type === 'repeat_group') {
      onUpdate({ type, fields: field.fields ?? [], min_rows: field.min_rows ?? 0, max_rows: field.max_rows ?? DEFAULT_REPEAT_MAX_ROWS, multiple: undefined, computed: undefined, sum_target: undefined });
      return;
    }
    if (type === 'field_group') {
      onUpdate({ type, fields: field.fields ?? [], min_rows: undefined, max_rows: undefined, options: undefined, multiple: undefined, computed: undefined, sum_target: undefined });
      return;
    }
    onUpdate({ type, fields: undefined, min_rows: undefined, max_rows: undefined, add_label: undefined, add_label_en: undefined,
      options: (type === 'select' || type === 'checkbox') ? (field.options ?? []) : undefined });
  };

  const setVal = (patch: Partial<FormField['validation']>) =>
    onUpdate({ validation: { ...field.validation, ...patch } });

  return (
    <div className="space-y-0">
      {/* Field header */}
      <div className="flex items-center gap-2 pb-3 border-b border-white/50">
        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-ringo-100 text-ringo-600 text-sm font-bold shrink-0">
          {fieldGlyph(field.type)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-warmgray-800 truncate">{field.label || (en ? '(untitled)' : '（無題）')}</p>
          <p className="text-[10px] text-warmgray-400">{typeName} · #{index + 1}</p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => onMove(-1)} disabled={index === 0} className="btn-ghost px-2 py-1.5 text-xs disabled:opacity-30" title={en ? 'Move up' : '上へ'}>▲</button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} className="btn-ghost px-2 py-1.5 text-xs disabled:opacity-30" title={en ? 'Move down' : '下へ'}>▼</button>
          <button onClick={onDuplicate} className="btn-ghost px-2 py-1.5 text-xs" title={en ? 'Duplicate' : '複製'}>⧉</button>
          <button onClick={onRemove} className="text-red-400 hover:text-red-600 px-2 py-1.5 text-sm rounded-lg hover:bg-red-50" title={en ? 'Delete' : '削除'}>✕</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 py-2 sticky -top-3 bg-surface-50/95 backdrop-blur-sm z-10 -mx-1 px-1">
        {([
          { k: 'basic' as Tab, ja: '基本', en: 'Basic' },
          { k: 'logic' as Tab, ja: 'ロジック', en: 'Logic' },
          { k: 'appearance' as Tab, ja: '表示', en: 'Display' },
        ]).map(({ k, ja, en: e }) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors ${
              tab === k ? 'bg-ringo-500 text-white' : 'text-warmgray-500 hover:bg-warmgray-100'}`}>
            {en ? e : ja}
          </button>
        ))}
      </div>

      <div className="space-y-3 pt-2 pb-4">
        {/* ════════════════════ BASIC ════════════════════ */}
        {tab === 'basic' && (
          <>
            <Field label={isHeader ? (en ? 'Heading text' : '見出しテキスト') : (en ? 'Label' : 'ラベル')}
                   hint={en ? 'The text shown to the user above this field.' : 'ユーザーに表示される項目名。'}>
              <input type="text" value={field.label} onChange={(e) => onLabelChange(e.target.value)}
                className="input text-sm w-full" placeholder={en ? 'e.g. Destination' : '例）出張先'} autoFocus />
            </Field>

            {/* Change type */}
            <Field label={en ? 'Field type' : '項目タイプ'}>
              <select value={field.type} onChange={(e) => updateType(e.target.value)} className="select text-xs w-full">
                {typeOptions.map((c) => (
                  <option key={c.type} value={c.type}>{en ? c.label_en : c.label_ja}</option>
                ))}
              </select>
            </Field>

            {/* Required */}
            {!isHeader && !isGroup && (
              <Toggle checked={field.required ?? false} onChange={(v) => onUpdate({ required: v })}
                label={en ? 'Required' : '必須項目'} hint={en ? 'User must fill this in before submitting.' : '未入力では送信できません。'} />
            )}

            {/* Field group — box title + subtitle; child fields managed in the canvas */}
            {isGroup && (
              <Box tone="warmgray" title={en ? 'Field group' : 'グループ'}>
                <Field label={en ? 'Box subtitle (optional)' : 'ボックスの補足（任意）'}>
                  <input type="text" value={field.helper_text ?? ''} onChange={(e) => onUpdate({ helper_text: e.target.value })}
                    className="input text-xs w-full" placeholder={en ? 'Small text under the box title' : '枠タイトル下の補足'} />
                </Field>
                <p className="text-[11px] text-warmgray-600">
                  {en ? '➕ Add fields to this box from the panel on the left while the box is selected.' : '➕ このボックスを選択した状態で、左パネルから項目を追加できます。'}
                </p>
              </Box>
            )}

            {/* Header subtitle */}
            {isHeader && (
              <Field label={en ? 'Subtitle (optional)' : 'サブタイトル（任意）'}>
                <input type="text" value={field.helper_text ?? ''} onChange={(e) => onUpdate({ helper_text: e.target.value })}
                  className="input text-xs w-full" placeholder={en ? 'Small text under the heading' : '見出し下の補足'} />
              </Field>
            )}

            {/* Options */}
            {(isSelect || isCheckbox) && (
              <OptionsEditor options={field.options ?? []} onChange={(opts) => onUpdate({ options: opts })}
                hint={isCheckbox ? (en ? 'Empty = single yes/no. Add options for multi-select.' : '空＝単一チェック。選択肢追加で複数選択。') : undefined} />
            )}

            {/* number core */}
            {isNumber && (
              <Box tone="teal" title={en ? 'Number options' : '数値の設定'}>
                <Toggle checked={field.computed ?? false} accent="teal"
                  onChange={(v) => onUpdate({ computed: v, sum_target: undefined, formula: undefined })}
                  label={en ? 'Auto-calculated (read-only)' : '自動計算（読取専用）'}
                  hint={en ? 'Value is computed by a formula or summed from other fields. User cannot type it.' : '計算式や他項目の合計で自動入力。手入力不可。'} />
                <Field label={en ? 'Formula' : '計算式'} hint={en ? 'Tap a field or function below to insert it. The result is calculated automatically.' : '下の項目や関数をタップして挿入。結果は自動計算されます。'}>
                  <input ref={formulaRef} type="text" value={field.formula ?? ''}
                    onChange={(e) => onUpdate({ formula: e.target.value || undefined, computed: e.target.value ? true : field.computed })}
                    placeholder={en ? 'e.g. participant_count * 2000' : '例）participant_count * 2000'}
                    className="input text-xs font-mono w-full" />
                  {/* Click-to-insert builder — keeps caret + scroll at the end */}
                  {(() => {
                    const numericSiblings = siblingFields.filter((f) => f.type === 'number');
                    const insert = (token: string, joiner = ' ') => {
                      const cur = (field.formula ?? '').trimEnd();
                      const next = (cur ? `${cur}${joiner}${token}` : token).trimStart();
                      onUpdate({ formula: next, computed: true });
                      // After React re-renders the controlled input, refocus + jump to end.
                      requestAnimationFrame(() => {
                        const el = formulaRef.current;
                        if (!el) return;
                        el.focus();
                        const end = el.value.length;
                        el.setSelectionRange(end, end);
                        el.scrollLeft = el.scrollWidth;
                      });
                    };
                    const FNS: { ja: string; en: string; token: string }[] = [
                      { ja: '最小', en: 'min', token: 'Math.min(' },
                      { ja: '最大', en: 'max', token: 'Math.max(' },
                      { ja: '四捨五入', en: 'round', token: 'Math.round(' },
                      { ja: '絶対値', en: 'abs', token: 'Math.abs(' },
                      { ja: '切捨', en: 'floor', token: 'Math.floor(' },
                      { ja: '切上', en: 'ceil', token: 'Math.ceil(' },
                    ];
                    return (
                      <div className="space-y-1.5 pt-1.5">
                        {numericSiblings.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {numericSiblings.map((f) => (
                              <button key={f.name} type="button" onClick={() => insert(f.name)} title={f.name}
                                className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-teal-100 text-teal-700 border border-teal-200/70 hover:bg-teal-200 transition-colors">
                                {f.label || f.name}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1">
                          {['+', '-', '*', '/', '%', '(', ')'].map((op) => (
                            <button key={op} type="button" onClick={() => insert(op)}
                              className="text-xs font-mono w-6 h-6 flex items-center justify-center rounded-md bg-white border border-warmgray-200 text-warmgray-600 hover:bg-warmgray-50 transition-colors"
                              title={op === '%' ? (en ? 'remainder' : '余り') : undefined}>
                              {op === '*' ? '×' : op === '/' ? '÷' : op}
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {FNS.map((fn) => (
                            <button key={fn.en} type="button" onClick={() => insert(fn.token, ' ')}
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-700 border border-violet-200/70 hover:bg-violet-200 transition-colors"
                              title={fn.token.replace('(', '()')}>
                              {en ? fn.en : fn.ja}
                            </button>
                          ))}
                          {field.formula && (
                            <button type="button" onClick={() => onUpdate({ formula: undefined })}
                              className="text-[10px] px-2 h-6 rounded-md text-red-500 hover:bg-red-50 transition-colors ml-auto">
                              {en ? 'Clear' : 'クリア'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </Field>
                <Field label={en ? 'Unit suffix (optional)' : '単位（任意）'}>
                  <input type="text" value={field.unit ?? ''} onChange={(e) => onUpdate({ unit: e.target.value || undefined })}
                    className="input text-xs w-24" placeholder={en ? 'e.g. 人, km' : '例）人'} />
                </Field>
              </Box>
            )}

            {/* file core */}
            {field.type === 'file' && (
              <Box tone="slate" title={en ? 'File settings' : 'ファイル設定'}>
                <Toggle checked={field.multiple ?? false} accent="slate" onChange={(v) => onUpdate({ multiple: v || undefined })}
                  label={en ? 'Allow multiple files' : '複数ファイルを許可'} />
                <Field label={en ? 'Drive folder' : 'Driveフォルダ'}>
                  <FileCategorySelect value={field.file_category} onChange={(v) => onUpdate({ file_category: v })} en={en} />
                </Field>
              </Box>
            )}

            {/* repeat group — rows config; child fields are managed in the canvas */}
            {isRepeatGroup && (
              <Box tone="teal" title={en ? 'Repeatable table' : '繰り返し表'}>
                <div className="grid grid-cols-2 gap-2">
                  <Field label={en ? 'Min rows' : '最小行数'}>
                    <input type="number" min={0} value={field.min_rows ?? 0}
                      onChange={(e) => onUpdate({ min_rows: Math.max(0, Number(e.target.value) || 0) })} className="input text-xs" />
                  </Field>
                  <Field label={en ? 'Max rows' : '最大行数'}>
                    <input type="number" min={1} max={DEFAULT_REPEAT_MAX_ROWS} value={field.max_rows ?? DEFAULT_REPEAT_MAX_ROWS}
                      onChange={(e) => onUpdate({ max_rows: Math.max(1, Math.min(DEFAULT_REPEAT_MAX_ROWS, Number(e.target.value) || DEFAULT_REPEAT_MAX_ROWS)) })} className="input text-xs" />
                  </Field>
                </div>
                <Field label={en ? '"Add row" button text' : '「行を追加」ボタン名'}>
                  <input type="text" value={field.add_label ?? ''} onChange={(e) => onUpdate({ add_label: e.target.value || undefined })}
                    className="input text-xs w-full" placeholder={en ? 'Add row' : '行を追加'} />
                </Field>
                <p className="text-[11px] text-teal-700">
                  {en ? '➕ Add the row’s fields from the panel on the left while this table is selected.' : '➕ この表を選択した状態で、左パネルから行の項目を追加できます。'}
                </p>
              </Box>
            )}

            {/* allowance_days */}
            {field.type === 'allowance_days' && (
              <Box tone="sky" title={en ? 'Allowance settings' : '日当設定'}>
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-1.5 text-xs text-sky-800 cursor-pointer">
                    <input type="radio" name={`rate_${field.name}`} checked={!field.rate_source || field.rate_source === 'user_role'}
                      onChange={() => onUpdate({ rate_source: 'user_role', custom_rate: undefined })} />
                    {en ? "User's role rate" : 'ユーザー役職レート'}
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-sky-800 cursor-pointer">
                    <input type="radio" name={`rate_${field.name}`} checked={field.rate_source === 'custom'}
                      onChange={() => onUpdate({ rate_source: 'custom' })} />
                    {en ? 'Custom flat rate' : 'カスタムレート（固定）'}
                  </label>
                  {field.rate_source === 'custom' && (
                    <div className="flex items-center gap-2 pl-5">
                      <div className="relative w-32">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-sky-400">¥</span>
                        <input type="number" min={0} value={field.custom_rate ?? ''} placeholder="3000"
                          onChange={(e) => onUpdate({ custom_rate: e.target.value ? Number(e.target.value) : undefined })} className="input pl-6 text-xs" />
                      </div>
                      <span className="text-xs text-sky-600">/{en ? 'day' : '日'}</span>
                    </div>
                  )}
                </div>
                <Field label={en ? 'Selectable steps' : '選択ステップ'} hint={en ? 'Label = button text, value = multiplier (0.5 = half day). Empty = 0/0.5/1.' : 'ラベル＝ボタン、値＝倍率（0.5＝半日）。空＝0/0.5/1。'}>
                  <OptionsEditor options={field.options ?? []} onChange={(opts) => onUpdate({ options: opts })} />
                </Field>
              </Box>
            )}

            {/* route_entry */}
            {field.type === 'route_entry' && (
              <Box tone="emerald" title={en ? 'Route options' : 'ルートオプション'}>
                <Toggle checked={field.show_copy_return !== false} accent="emerald"
                  onChange={(v) => onUpdate({ show_copy_return: v ? undefined : false })}
                  label={en ? 'Show "copy return route" button' : '「復路コピー」ボタン'} />
                <Toggle checked={!!field.show_mode} accent="emerald"
                  onChange={(v) => onUpdate({ show_mode: v || undefined })}
                  label={en ? 'Transport mode per row' : '各経路に交通手段'} />
                {field.show_mode && (
                  <Field label={en ? 'Selectable modes' : '交通手段の選択肢'}>
                    <OptionsEditor options={field.options ?? []} onChange={(opts) => onUpdate({ options: opts })} />
                  </Field>
                )}
              </Box>
            )}

            {/* ai_file_reader */}
            {field.type === 'ai_file_reader' && (
              <Box tone="violet" title={en ? 'AI reader settings' : 'AI読み取り設定'}>
                <p className="text-[10px] text-violet-600">
                  {en ? 'After upload, "Auto-fill" runs OCR and fills the target fields.' : 'アップロード後「自動入力」でOCRが対象項目を埋めます。'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label={en ? 'Fill date into' : '日付の入力先'}>
                    <FieldRef value={field.target_date_field} onChange={(v) => onUpdate({ target_date_field: v })}
                      placeholder={en ? '— choose field —' : '— 項目を選択 —'} only={(f) => f.type === 'date'} />
                  </Field>
                  <Field label={en ? 'Fill amount into' : '金額の入力先'}>
                    <FieldRef value={field.target_amount_field} onChange={(v) => onUpdate({ target_amount_field: v })}
                      placeholder={en ? '— choose field —' : '— 項目を選択 —'} only={(f) => f.type === 'number'} />
                  </Field>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-violet-700">{en ? 'Custom AI fields' : 'カスタムAI抽出'}</span>
                    <button type="button" onClick={() => onUpdate({ extract_fields: [...(field.extract_fields ?? []), { target: '', hint: '' }] })}
                      className="text-[11px] font-semibold text-violet-700 hover:text-violet-900">+ {en ? 'Add' : '追加'}</button>
                  </div>
                  {(field.extract_fields ?? []).map((ef, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <select value={ef.target}
                        onChange={(e) => { const next = [...(field.extract_fields ?? [])]; next[i] = { ...ef, target: e.target.value }; onUpdate({ extract_fields: next }); }}
                        className="select text-xs flex-1 min-w-0">
                        <option value="">{en ? '— field —' : '— 項目 —'}</option>
                        {siblingFields.map((f) => <option key={f.name} value={f.name}>{f.label || f.name}</option>)}
                      </select>
                      <input type="text" value={ef.hint} placeholder={en ? 'what to find' : '探す内容'}
                        onChange={(e) => { const next = [...(field.extract_fields ?? [])]; next[i] = { ...ef, hint: e.target.value }; onUpdate({ extract_fields: next }); }}
                        className="input text-xs flex-1 min-w-0" />
                      <button type="button" onClick={() => onUpdate({ extract_fields: (field.extract_fields ?? []).filter((_, j) => j !== i) })}
                        className="text-red-400 hover:text-red-600 text-sm shrink-0">×</button>
                    </div>
                  ))}
                </div>
                <Field label={en ? 'Drive folder' : 'Driveフォルダ'}>
                  <FileCategorySelect value={field.file_category} onChange={(v) => onUpdate({ file_category: v })} en={en} />
                </Field>
              </Box>
            )}

            {/* user_picker */}
            {field.type === 'user_picker' && (
              <Box tone="violet" title={en ? 'People picker' : '参加者選択'}>
                <Field label={en ? 'Write headcount into' : '人数の入力先'}
                       hint={en ? 'The number of selected people is written into this field automatically.' : '選択人数がこの項目に自動入力されます。'}>
                  <FieldRef value={field.count_field} onChange={(v) => onUpdate({ count_field: v })}
                    placeholder={en ? '— choose number field —' : '— 数値項目を選択 —'} only={(f) => f.type === 'number'} />
                </Field>
              </Box>
            )}

            {/* placeholder + helper (non-header) */}
            {!isHeader && (isText || isNumber || isDate || isTime) && (
              <Field label={en ? 'Placeholder' : 'プレースホルダー'} hint={en ? 'Faint example text shown inside the empty field.' : '空欄に薄く表示される例。'}>
                <input type="text" value={field.placeholder ?? ''} onChange={(e) => onUpdate({ placeholder: e.target.value })} className="input text-xs w-full" />
              </Field>
            )}
            {!isHeader && !isGroup && (
              <Field label={en ? 'Helper text' : '補足説明'} hint={en ? 'Small grey description under the field.' : '項目下の小さな説明。'}>
                <input type="text" value={field.helper_text ?? ''} onChange={(e) => onUpdate({ helper_text: e.target.value })} className="input text-xs w-full" />
              </Field>
            )}

            {/* Field ID disclosure */}
            <div className="pt-1">
              <button onClick={() => setShowId((s) => !s)} className="text-[10px] font-semibold text-warmgray-400 hover:text-warmgray-600">
                {showId ? '▾' : '▸'} {en ? 'Field ID (advanced)' : 'フィールドID（詳細設定）'}
              </button>
              {showId && (
                <div className="mt-1.5">
                  <input type="text" value={field.name}
                    onChange={(e) => onUpdate({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                    className={`input text-xs font-mono w-full ${dupName ? 'border-red-400 ring-1 ring-red-300' : ''}`} placeholder="field_id" />
                  <p className={`text-[10px] mt-0.5 ${dupName ? 'text-red-500' : 'text-warmgray-400'}`}>
                    {dupName ? (en ? '⚠ Duplicate ID — must be unique' : '⚠ ID重複 — 一意にしてください')
                      : (en ? 'Stored key. Auto-set from label; change only if needed.' : '保存キー。ラベルから自動生成。通常変更不要。')}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {/* ════════════════════ LOGIC ════════════════════ */}
        {tab === 'logic' && (
          <>
            {/* Conditional visibility */}
            <Box tone="amber" title={en ? 'Conditional display' : '条件付き表示'}>
              <p className="text-[11px] text-warmgray-600">
                {en ? 'Show this field only when…' : 'この項目を表示する条件…'}
              </p>
              <div className="flex flex-col gap-2">
                <select value={field.conditional_on?.field ?? ''}
                  onChange={(e) => {
                    if (!e.target.value) { onUpdate({ conditional_on: undefined }); return; }
                    onUpdate({ conditional_on: { field: e.target.value, equals: field.conditional_on?.equals ?? '' } });
                  }} className="input text-xs">
                  <option value="">— {en ? 'always show' : '常に表示'} —</option>
                  {siblingNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                {field.conditional_on?.field && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-warmgray-500 shrink-0">{en ? 'equals' : 'が次と等しい'}</span>
                    <input type="text" value={String(field.conditional_on?.equals ?? '')}
                      onChange={(e) => onUpdate({ conditional_on: { field: field.conditional_on!.field, equals: e.target.value } })}
                      className="input text-xs flex-1" placeholder={en ? 'value' : '値'} />
                  </div>
                )}
              </div>
            </Box>

            {/* Validation — text */}
            {isText && (
              <Box tone="warmgray" title={en ? 'Validation' : '入力チェック'}>
                <Field label={en ? 'Input format' : '入力形式'}>
                  <select className="select text-xs w-full"
                    value={REGEX_PRESETS.find((p) => p.regex === field.validation?.regex)?.key ?? (field.validation?.regex ? 'custom' : '')}
                    onChange={(e) => {
                      const p = REGEX_PRESETS.find((x) => x.key === e.target.value);
                      if (e.target.value === '') setVal({ regex: undefined });
                      else if (e.target.value === 'custom') setVal({ regex: field.validation?.regex || '' });
                      else if (p) setVal({ regex: p.regex });
                    }}>
                    <option value="">{en ? 'No restriction' : '制限なし'}</option>
                    {REGEX_PRESETS.map((p) => <option key={p.key} value={p.key}>{en ? p.en : p.ja}</option>)}
                    <option value="custom">{en ? 'Custom pattern…' : 'カスタム…'}</option>
                  </select>
                </Field>
                {field.validation?.regex !== undefined && !REGEX_PRESETS.some((p) => p.regex === field.validation?.regex) && (
                  <Field label={en ? 'Custom regex' : 'カスタム正規表現'}>
                    <input type="text" value={field.validation?.regex ?? ''} onChange={(e) => setVal({ regex: e.target.value || undefined })}
                      className="input text-xs font-mono w-full" placeholder="^\\d+$" />
                  </Field>
                )}
                <Field label={en ? 'Max length' : '最大文字数'}>
                  <input type="number" value={field.validation?.maxlength ?? ''} onChange={(e) => setVal({ maxlength: e.target.value ? Number(e.target.value) : undefined })} className="input text-xs w-28" />
                </Field>
              </Box>
            )}

            {/* Validation — number */}
            {isNumber && (
              <Box tone="warmgray" title={en ? 'Number limits' : '数値の制限'}>
                <div className="grid grid-cols-2 gap-2">
                  <Field label={en ? 'Min' : '最小'}>
                    <input type="number" value={field.validation?.min ?? ''} onChange={(e) => setVal({ min: e.target.value ? Number(e.target.value) : undefined })} className="input text-xs" />
                  </Field>
                  <Field label={en ? 'Max' : '最大'}>
                    <input type="number" value={field.validation?.max ?? ''} onChange={(e) => setVal({ max: e.target.value ? Number(e.target.value) : undefined })} className="input text-xs" />
                  </Field>
                </div>
                {(() => {
                  const numFields = siblingFields.filter((f) => f.type === 'number' || f.type === 'date_diff_from');
                  if (!numFields.length) return null;
                  return (
                    <Field label={en ? 'Max limited by field' : '上限を別項目から取得'}>
                      <select value={field.validation?.max_from_field ?? ''} onChange={(e) => setVal({ max_from_field: e.target.value || undefined })} className="select text-xs w-full">
                        <option value="">— {en ? 'none' : '設定しない'} —</option>
                        {numFields.map((f) => <option key={f.name} value={f.name}>{f.label} ({f.name})</option>)}
                      </select>
                    </Field>
                  );
                })()}
                {field.computed && (() => {
                  const dateFields = siblingFields.filter((f) => f.type === 'date');
                  return (
                    <Field label={en ? 'Compute days between dates' : '日数を自動計算'}>
                      <div className="grid grid-cols-2 gap-2">
                        {(['date_diff_from', 'date_diff_to'] as const).map((prop) => (
                          <select key={prop} value={(field[prop] as string | undefined) ?? ''} onChange={(e) => onUpdate({ [prop]: e.target.value || undefined })} className="select text-xs">
                            <option value="">{prop === 'date_diff_from' ? (en ? 'start date' : '開始日') : (en ? 'end date' : '終了日')}</option>
                            {dateFields.map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
                          </select>
                        ))}
                      </div>
                    </Field>
                  );
                })()}
                {/* Add to total */}
                {!field.computed && computedFieldNames.length > 0 && (
                  <Field label={en ? 'Add to total' : '合計に加算'} hint={en ? 'This value is summed into the chosen auto-calculated total field.' : 'この値が選択した自動合計項目に加算されます。'}>
                    <select value={field.sum_target ?? ''} onChange={(e) => onUpdate({ sum_target: e.target.value || undefined })} className="select text-xs w-full">
                      <option value="">— {en ? 'not a sum source' : '加算しない'} —</option>
                      {computedFieldNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </Field>
                )}
              </Box>
            )}

            {/* Validation — date */}
            {isDate && (() => {
              const dateFields = siblingFields.filter((f) => f.type === 'date');
              if (!dateFields.length) return <p className="text-[11px] text-warmgray-400">{en ? 'No date rules available (needs another date field).' : '日付ルールなし（他の日付項目が必要）。'}</p>;
              return (
                <Box tone="warmgray" title={en ? 'Date rule' : '日付ルール'}>
                  <Field label={en ? 'Must be on or after' : 'この日付以降'}>
                    <select value={field.validation?.date_after_or_equal ?? ''} onChange={(e) => setVal({ date_after_or_equal: e.target.value || undefined })} className="select text-xs w-full">
                      <option value="">— {en ? 'none' : '設定しない'} —</option>
                      {dateFields.map((f) => <option key={f.name} value={f.name}>{f.label} ({f.name})</option>)}
                    </select>
                  </Field>
                </Box>
              );
            })()}

            {/* Validation — time */}
            {isTime && (
              <Box tone="sky" title={en ? 'Time constraints' : '時刻制約'}>
                <div className="grid grid-cols-2 gap-2">
                  <Field label={en ? 'Earliest' : '最早'}>
                    <input type="time" value={field.validation?.min_time ?? ''} onChange={(e) => setVal({ min_time: e.target.value || undefined })} className="input-time text-xs w-full" />
                  </Field>
                  <Field label={en ? 'Latest' : '最遅'}>
                    <input type="time" value={field.validation?.max_time ?? ''} onChange={(e) => setVal({ max_time: e.target.value || undefined })} className="input-time text-xs w-full" />
                  </Field>
                </div>
                <Field label={en ? 'Minute step' : '分単位'}>
                  <select value={field.validation?.step ?? 1} onChange={(e) => setVal({ step: Number(e.target.value) })} className="select text-xs">
                    <option value={1}>{en ? 'Any (1)' : '任意（1分）'}</option>
                    {[5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} {en ? 'min' : '分'}</option>)}
                    <option value={60}>{en ? '1 hour' : '1時間'}</option>
                  </select>
                </Field>
              </Box>
            )}

            {!isText && !isNumber && !isDate && !isTime && !isHeader && (
              <p className="text-[11px] text-warmgray-400 text-center py-4">{en ? 'No extra validation for this field type.' : 'このタイプに追加の入力チェックはありません。'}</p>
            )}
          </>
        )}

        {/* ════════════════════ APPEARANCE ════════════════════ */}
        {tab === 'appearance' && (
          <>
            {/* Width */}
            {!isRepeatGroup && !isHeader && !isGroup ? (
              <Field label={en ? 'Width' : '幅'} hint={en ? '12-column grid. Auto = full for long text/file, half otherwise.' : '12カラムグリッド。自動＝長文/ファイルは全幅、他は半幅。'}>
                <div className="grid grid-cols-7 gap-1">
                  {COL_SPAN_OPTIONS.map(({ value, ja, en: e, frac }) => (
                    <button key={String(value ?? 'auto')} type="button" onClick={() => onUpdate({ col_span: value })}
                      title={en ? e : ja}
                      className={`flex flex-col items-center justify-center py-1.5 rounded-lg border text-[10px] font-semibold transition-colors ${
                        (field.col_span ?? undefined) === value
                          ? 'bg-ringo-500 text-white border-ringo-500'
                          : 'text-warmgray-600 border-warmgray-200 hover:bg-warmgray-50'}`}>
                      <span className="text-xs leading-none">{frac}</span>
                      <span className="leading-none mt-0.5">{en ? e : ja}</span>
                    </button>
                  ))}
                </div>
              </Field>
            ) : (
              <p className="text-[11px] text-warmgray-400">{en ? 'This field always spans the full width.' : 'この項目は常に全幅で表示されます。'}</p>
            )}

            {/* List row + accounting */}
            {!isHeader && !isGroup && (
              <Box tone="warmgray" title={en ? 'List & accounting' : '一覧・会計'}>
                <Toggle checked={field.show_in_row ?? false} onChange={(v) => onUpdate({ show_in_row: v || undefined })}
                  label={en ? 'Show in list row' : '一覧行に表示'} hint={en ? 'Value appears in the Approvals / History list rows.' : '承認・履歴の一覧行に値を表示。'} />
                {isNumber && (
                  <Toggle checked={field.amount_field ?? false} accent="emerald" onChange={(v) => onUpdate({ amount_field: v || undefined })}
                    label={en ? 'Use as accounting amount' : '精算金額として使用'} hint={en ? 'Marks this as the headline amount on the accounting/settlements page.' : '会計・精算ページの金額として使用。'} />
                )}
                {field.show_in_row && isNumber && otherSchemaFields.filter((x) => x.type === 'number').length > 0 && (
                  <Field label={en ? 'Compare with' : '比較対象'} hint={en ? 'Highlights the row amber when this value differs from the matching field in the other phase.' : '他フェーズの該当項目と値が異なると行が黄色で強調。'}>
                    <select value={field.row_compare_with ?? ''} onChange={(e) => onUpdate({ row_compare_with: e.target.value || undefined })} className="select text-xs w-full">
                      <option value="">— {en ? 'none' : 'なし'} —</option>
                      {otherSchemaFields.filter((x) => x.type === 'number').map((x) => (
                        <option key={x.name} value={x.name}>{x.label}{x.label_en ? ` / ${x.label_en}` : ''}</option>
                      ))}
                    </select>
                  </Field>
                )}
              </Box>
            )}

            {/* Custom renderer: entry field */}
            {isCustomRenderer && (
              <Box tone="amber">
                <Toggle checked={field.entry_field ?? false} accent="amber" onChange={(v) => onUpdate({ entry_field: v || undefined })}
                  label={en ? 'Per-entry field' : '明細フィールド'} hint={en ? 'Renders inside each daily entry row instead of the header section.' : '1日ごとの入力行に表示（ヘッダーではなく）。'} />
              </Box>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Drive folder category select (shared) ────────────────────────────────────────
function FileCategorySelect({ value, onChange, en }: {
  value: FormField['file_category']; onChange: (v: FormField['file_category']) => void; en: boolean;
}) {
  return (
    <select className="select text-xs w-full" value={value ?? ''} onChange={(e) => onChange((e.target.value || undefined) as FormField['file_category'])}>
      <option value="">{en ? 'Default (root)' : 'デフォルト（ルート）'}</option>
      <option value="receipts">{en ? 'Receipts' : '領収書'}</option>
      <option value="invoices">{en ? 'Invoices / Bills' : '請求書・明細'}</option>
      <option value="transportation">{en ? 'Transportation' : '交通費'}</option>
      <option value="other">{en ? 'Other' : 'その他'}</option>
    </select>
  );
}
