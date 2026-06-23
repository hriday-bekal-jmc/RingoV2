// ─────────────────────────────────────────────────────────────────────────────
// Properties panel (right column of FormBuilderV2).
//
// Full field property surface organised into three plain-language tabs —
// Basic / Logic / Display — with `?` help tooltips and an auto-managed field ID
// (snake_case hidden behind a disclosure). Reuses OptionsEditor from FormsTab.
// Group/table child fields are managed in the canvas, not here.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLang } from '../../../context/LanguageContext';
import { OptionsEditor } from '../FormsTab';
import { catalogFor, fieldGlyph, FIELD_CATALOG } from './fieldCatalog';
import { DEFAULT_REPEAT_MAX_ROWS, type FormField } from './types';
import { COL_SPAN_OPTIONS } from '../../forms/fieldLayout';

type Tab = 'basic' | 'logic' | 'appearance';

// ── Formula token-stream helpers ──────────────────────────────────────────────
let _ftSeq = 0;
type FTokenBody =
  | { kind: 'field'; name: string }
  | { kind: 'number'; value: string }
  | { kind: 'op'; op: string }
  | { kind: 'paren'; p: '(' | ')' | ',' }
  | { kind: 'fn'; fn: string };
type FToken = FTokenBody & { id: string };

function formulaToTokens(formula: string): FToken[] {
  if (!formula) return [];
  const re = /Math\.\w+\(|\d+(?:\.\d+)?|[a-zA-Z_]\w*|[+\-*/%(),]/g;
  return (formula.match(re) ?? []).map((m): FToken => {
    const id = `ft${++_ftSeq}`;
    if (/^Math\./.test(m)) return { id, kind: 'fn', fn: m };
    if (/^\d/.test(m)) return { id, kind: 'number', value: m };
    if (/^[a-zA-Z_]/.test(m)) return { id, kind: 'field', name: m };
    if (['+', '-', '*', '/', '%'].includes(m)) return { id, kind: 'op', op: m };
    if (m === ',' || m === '(' || m === ')') return { id, kind: 'paren', p: m as '(' | ')' | ',' };
    return { id, kind: 'number', value: m };
  });
}

function tokensToFormula(tokens: FToken[]): string {
  return tokens.map((t) =>
    t.kind === 'field' ? (t.name || '?') :
    t.kind === 'number' ? (t.value || '0') :
    t.kind === 'op' ? t.op :
    t.kind === 'paren' ? t.p :
    t.fn
  ).join(' ');
}

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
  isCustomRenderer, isChild, isSettlementField, onUpdate, onRemove, onMove, onDuplicate,
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
  isSettlementField?: boolean;
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
  const [formulaAdvanced, setFormulaAdvanced] = useState(false);
  const [formulaTokens, setFormulaTokens] = useState<FToken[]>(() => formulaToTokens(field.formula ?? ''));
  const formulaFromTokensRef = useRef<string | undefined>(field.formula);
  useEffect(() => {
    // Re-sync tokens when a different field is selected in the canvas
    formulaFromTokensRef.current = field.formula;
    setFormulaTokens(formulaToTokens(field.formula ?? ''));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.name]);
  const applyTokens = (tokens: FToken[]) => {
    const f = tokensToFormula(tokens) || undefined;
    formulaFromTokensRef.current = f;
    setFormulaTokens(tokens);
    onUpdate({ formula: f, computed: !!f || field.computed });
  };

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
    const numExtras = type === 'number' ? {} : {
      formula: undefined, date_diff_from: undefined, date_diff_to: undefined,
      computed: undefined, sum_target: undefined, unit: undefined,
    };
    onUpdate({ type, fields: undefined, min_rows: undefined, max_rows: undefined, add_label: undefined, add_label_en: undefined,
      options: (type === 'select' || type === 'checkbox') ? (field.options ?? []) : undefined,
      ...numExtras });
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
          { k: 'basic' as Tab, ja: '基本設定', en: 'Basic' },
          { k: 'logic' as Tab, ja: '条件・制約', en: 'Rules' },
          { k: 'appearance' as Tab, ja: 'レイアウト', en: 'Layout' },
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
                {/* Formula token-stream builder */}
                {(() => {
                  const numSiblings = siblingFields.filter((f) => f.type === 'number' || f.type === 'allowance_days');
                  const OPS = [
                    { op: '+', ja: '＋', title: '足す' },
                    { op: '-', ja: '－', title: '引く' },
                    { op: '*', ja: '×', title: 'かける' },
                    { op: '/', ja: '÷', title: '割る' },
                    { op: '%', ja: '％', title: '余り' },
                  ];
                  const FNS = [
                    { fn: 'Math.round(', ja: '四捨五入', enLabel: 'round' },
                    { fn: 'Math.floor(', ja: '切捨', enLabel: 'floor' },
                    { fn: 'Math.ceil(', ja: '切上', enLabel: 'ceil' },
                    { fn: 'Math.abs(', ja: '絶対値', enLabel: 'abs' },
                    { fn: 'Math.min(', ja: '最小値', enLabel: 'min' },
                    { fn: 'Math.max(', ja: '最大値', enLabel: 'max' },
                  ];
                  const addToken = (t: FTokenBody) =>
                    applyTokens([...formulaTokens, { ...t, id: `ft${++_ftSeq}` }]);
                  const removeToken = (idx: number) => applyTokens(formulaTokens.filter((_, i) => i !== idx));
                  const updateToken = (idx: number, patch: Partial<FToken>) =>
                    applyTokens(formulaTokens.map((t, i) => i === idx ? { ...t, ...patch } as FToken : t));
                  const chipBase = 'group flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-lg border text-xs transition-colors';
                  const chipCls = (kind: FToken['kind']) => ({
                    field:  `${chipBase} bg-teal-50 border-teal-300 text-teal-800`,
                    number: `${chipBase} bg-sky-50 border-sky-300 text-sky-800`,
                    op:     `${chipBase} bg-amber-50 border-amber-300 text-amber-700 font-mono font-bold`,
                    paren:  `${chipBase} bg-purple-50 border-purple-300 text-purple-700 font-mono font-bold`,
                    fn:     `${chipBase} bg-violet-50 border-violet-300 text-violet-700`,
                  }[kind]);

                  return formulaAdvanced ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-teal-600">{en ? 'Formula (raw text)' : '計算式（テキスト）'}</p>
                        <button type="button" onClick={() => {
                          setFormulaTokens(formulaToTokens(field.formula ?? ''));
                          setFormulaAdvanced(false);
                        }} className="text-[10px] text-warmgray-400 hover:text-warmgray-600">
                          ← {en ? 'back to builder' : 'ビルダーに戻る'}
                        </button>
                      </div>
                      <input ref={formulaRef} type="text" value={field.formula ?? ''}
                        onChange={(e) => onUpdate({ formula: e.target.value || undefined, computed: e.target.value ? true : field.computed })}
                        placeholder="participant_count * 2000" className="input text-xs font-mono w-full" />
                      <p className="text-[10px] text-warmgray-400">{en ? 'Use field system IDs and + - * / % operators.' : '項目のシステムIDと演算子（+ - * / %）で記述。'}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-teal-600">{en ? 'Formula' : '計算式'}</p>
                        <button type="button" onClick={() => setFormulaAdvanced(true)}
                          className="text-[10px] text-warmgray-400 hover:text-warmgray-600">{en ? 'Type manually…' : 'テキストで入力…'}</button>
                      </div>

                      {/* Token stream */}
                      <div className={`flex flex-wrap gap-1.5 p-2 rounded-xl border min-h-[44px] items-center ${
                        formulaTokens.length > 0 ? 'bg-white/50 border-teal-200' : 'bg-warmgray-50/50 border-warmgray-200 border-dashed'
                      }`}>
                        {formulaTokens.length === 0 && (
                          <span className="text-[11px] text-warmgray-300 select-none">
                            {en ? 'Add items below to build your formula…' : '下のボタンで式を組み立てる…'}
                          </span>
                        )}
                        {formulaTokens.map((t, i) => (
                          <div key={t.id} className={chipCls(t.kind)}>
                            {t.kind === 'field' ? (
                              <select value={t.name} onChange={(e) => updateToken(i, { name: e.target.value })}
                                className="bg-transparent border-none outline-none text-xs font-medium cursor-pointer max-w-[110px]"
                                style={{ WebkitAppearance: 'none' }}>
                                <option value="">— {en ? 'pick field' : '項目を選ぶ'} —</option>
                                {numSiblings.map((f) => <option key={f.name} value={f.name}>{f.label || f.name}</option>)}
                              </select>
                            ) : t.kind === 'number' ? (
                              <input type="number" value={t.value}
                                onChange={(e) => updateToken(i, { value: e.target.value })}
                                className="bg-transparent border-none outline-none text-xs w-14" placeholder="0" />
                            ) : t.kind === 'op' ? (
                              <span className="font-mono text-sm leading-none px-0.5">
                                {t.op === '*' ? '×' : t.op === '/' ? '÷' : t.op}
                              </span>
                            ) : t.kind === 'paren' ? (
                              <span className="font-mono text-sm leading-none px-0.5">
                                {t.p === ',' ? '，' : t.p}
                              </span>
                            ) : (
                              <span className="text-[11px]">{en ? t.fn : FNS.find((f) => f.fn === t.fn)?.ja ?? t.fn}</span>
                            )}
                            <button type="button" onClick={() => removeToken(i)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] leading-none px-0.5 hover:text-red-500 ml-0.5 shrink-0">×</button>
                          </div>
                        ))}
                      </div>

                      {/* Live preview */}
                      {field.formula && (
                        <p className="text-[10px] text-teal-600 bg-teal-50 rounded-lg px-2 py-1 font-mono break-all">{field.formula}</p>
                      )}

                      {/* Add palette */}
                      <div className="space-y-1 pt-0.5">
                        <div className="flex flex-wrap gap-1">
                          <button type="button" onClick={() => addToken({ kind: 'field', name: numSiblings[0]?.name ?? '' })}
                            className="text-[11px] px-2.5 py-1 rounded-lg bg-teal-50 border border-teal-300 text-teal-700 hover:bg-teal-100 transition-colors font-medium">
                            ＋ {en ? 'Field' : '項目'}
                          </button>
                          <button type="button" onClick={() => addToken({ kind: 'number', value: '' })}
                            className="text-[11px] px-2.5 py-1 rounded-lg bg-sky-50 border border-sky-300 text-sky-700 hover:bg-sky-100 transition-colors font-medium">
                            ＋ {en ? 'Number' : '数値'}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {OPS.map(({ op, ja, title }) => (
                            <button key={op} type="button" title={title} onClick={() => addToken({ kind: 'op', op })}
                              className="text-[13px] font-mono w-8 h-7 flex items-center justify-center rounded-lg bg-amber-50 border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors font-bold">
                              {ja}
                            </button>
                          ))}
                          <button type="button" title="開き括弧" onClick={() => addToken({ kind: 'paren', p: '(' })}
                            className="text-[13px] font-mono w-8 h-7 flex items-center justify-center rounded-lg bg-purple-50 border border-purple-300 text-purple-700 hover:bg-purple-100 transition-colors">（</button>
                          <button type="button" title="閉じ括弧" onClick={() => addToken({ kind: 'paren', p: ')' })}
                            className="text-[13px] font-mono w-8 h-7 flex items-center justify-center rounded-lg bg-purple-50 border border-purple-300 text-purple-700 hover:bg-purple-100 transition-colors">）</button>
                          <button type="button" title={en ? 'comma — separate arguments in Math.min/max' : '引数区切り（Math.min/maxで使用）'}
                            onClick={() => addToken({ kind: 'paren', p: ',' })}
                            className="text-[11px] font-mono w-8 h-7 flex items-center justify-center rounded-lg bg-purple-50 border border-purple-300 text-purple-700 hover:bg-purple-100 transition-colors">，</button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {FNS.map(({ fn, ja, enLabel }) => (
                            <button key={fn} type="button" onClick={() => addToken({ kind: 'fn', fn })}
                              className="text-[10px] px-2 py-1 rounded-lg bg-violet-50 border border-violet-300 text-violet-700 hover:bg-violet-100 transition-colors"
                              title={fn}>
                              {en ? enLabel : ja}
                            </button>
                          ))}
                        </div>
                      </div>

                      {field.formula && (
                        <button type="button" onClick={() => applyTokens([])}
                          className="text-[10px] text-red-400 hover:text-red-600 transition-colors">
                          {en ? 'Clear formula' : '式をクリア'}
                        </button>
                      )}
                    </div>
                  );
                })()}
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

            {/* copy_from — settlement fields only */}
            {isSettlementField && (() => {
              // For child fields flatten repeat_group children so user can map to ringi children
              const flatOther: FormField[] = [];
              otherSchemaFields.forEach((f) => {
                if (['header', 'field_group'].includes(f.type)) return;
                if (f.type === 'repeat_group') {
                  if (!isChild) { flatOther.push(f); return; }
                  (f.fields ?? [])
                    .filter((c) => !['header'].includes(c.type))
                    .forEach((c) => flatOther.push(c));
                  return;
                }
                flatOther.push(f);
              });
              const matchedLabel = flatOther.find((f) => f.name === field.copy_from)?.label;
              return (
                <div className="rounded-xl border border-teal-200/60 bg-teal-50/40 p-3 space-y-1.5">
                  <p className="text-[10px] font-bold text-teal-700 uppercase tracking-widest">
                    {en ? 'Copy from application (ringi)' : '申請からのコピー元'}
                  </p>
                  <p className="text-[11px] text-warmgray-500 leading-snug">
                    {en
                      ? 'When user clicks "Copy from application", which ringi field should fill this field?'
                      : '「申請内容をコピー」ボタンで、どの申請フィールドの値をここにコピーしますか？'}
                  </p>
                  <select
                    value={field.copy_from ?? field.name}
                    onChange={(e) => {
                      const v = e.target.value;
                      onUpdate({ copy_from: v === field.name ? undefined : v });
                    }}
                    className="select text-xs w-full"
                  >
                    <option value={field.name}>
                      {en ? `Same name (${field.name})` : `同じ名前 (${field.name})`}
                    </option>
                    {flatOther.map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.label || f.name} ({f.name})
                      </option>
                    ))}
                    <option value="__none__">{en ? '(Do not copy this field)' : '（コピーしない）'}</option>
                  </select>
                  {field.copy_from && field.copy_from !== '__none__' && field.copy_from !== field.name && (
                    <p className="text-[10px] text-teal-600">
                      ← {matchedLabel ?? field.copy_from}
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Field ID disclosure */}
            <div className="pt-1">
              <button onClick={() => setShowId((s) => !s)} className="text-[10px] font-semibold text-warmgray-400 hover:text-warmgray-600">
                {showId ? '▾' : '▸'} {en ? 'System ID (do not change)' : 'システムID（通常変更不要）'}
              </button>
              {showId && (
                <div className="mt-1.5">
                  <input type="text" value={field.name}
                    onChange={(e) => onUpdate({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                    className={`input text-xs font-mono w-full ${dupName ? 'border-red-400 ring-1 ring-red-300' : ''}`} placeholder="field_id" />
                  <p className={`text-[10px] mt-0.5 ${dupName ? 'text-red-500' : 'text-warmgray-400'}`}>
                    {dupName ? (en ? '⚠ Duplicate ID — must be unique' : '⚠ ID重複 — 一意にしてください')
                      : (en ? 'Auto-set from label. Only change if you know what you\'re doing.' : 'ラベルから自動生成。通常は変更しないでください。')}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {/* ════════════════════ LOGIC ════════════════════ */}
        {tab === 'logic' && (
          <>
            {/* Conditional visibility — if-then sentence UI (A+B) */}
            {(() => {
              const condSrcField = field.conditional_on?.field
                ? siblingFields.find((f) => f.name === field.conditional_on?.field)
                : null;
              const condSrcOptions = (condSrcField?.type === 'select' || condSrcField?.type === 'checkbox') && Array.isArray(condSrcField?.options) && condSrcField.options.length > 0
                ? (condSrcField.options as Array<string | { value: string; label_ja?: string; label?: string }>).map((o) =>
                    typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label_ja || o.label || o.value })
                : null;
              const curEquals = String(field.conditional_on?.equals ?? '');
              const condMode: 'filled' | 'empty' | 'value' =
                curEquals === '__filled__' ? 'filled' : curEquals === '__empty__' ? 'empty' : 'value';
              const setCondField = (fName: string) => {
                if (!fName) { onUpdate({ conditional_on: undefined }); return; }
                onUpdate({ conditional_on: { field: fName, equals: '__filled__' } });
              };
              const setCondMode = (mode: 'filled' | 'empty' | 'value') => {
                const f = field.conditional_on?.field;
                if (!f) return;
                if (mode === 'filled') onUpdate({ conditional_on: { field: f, equals: '__filled__' } });
                else if (mode === 'empty') onUpdate({ conditional_on: { field: f, equals: '__empty__' } });
                else onUpdate({ conditional_on: { field: f, equals: '' } });
              };
              const setCondValue = (v: string) => {
                const f = field.conditional_on?.field;
                if (!f) return;
                onUpdate({ conditional_on: { field: f, equals: v } });
              };
              return (
                <Box tone="amber" title={en ? 'Conditional display' : '表示条件'}>
                  {/* Sentence: もし [ field ▼ ] が … なら表示する */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="text-warmgray-500 text-xs font-medium shrink-0">もし</span>
                      <select value={field.conditional_on?.field ?? ''} onChange={(e) => setCondField(e.target.value)}
                        className="select text-xs flex-1 min-w-0">
                        <option value="">— 条件なし（常に表示）—</option>
                        {siblingFields.filter((f) => f.type !== 'header' && f.type !== 'repeat_group' && f.type !== 'field_group').map((f) => (
                          <option key={f.name} value={f.name}>{f.label || f.name}</option>
                        ))}
                      </select>
                      <span className="text-warmgray-500 text-xs font-medium shrink-0">が</span>
                    </div>
                    {field.conditional_on?.field && (
                      <div className="space-y-2 pl-1">
                        {/* Mode radio buttons */}
                        <div className="flex flex-col gap-1">
                          {([
                            { mode: 'filled' as const, label: en ? '✓ Has a value (filled in)' : '✓ 入力されている場合' },
                            { mode: 'empty' as const,  label: en ? '✗ Has no value (blank)'   : '✗ 入力されていない場合' },
                            { mode: 'value' as const,  label: en ? '= Equals a specific value' : '= 特定の値と等しい場合' },
                          ] as const).map(({ mode, label }) => (
                            <label key={mode} className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors text-xs font-medium ${
                              condMode === mode
                                ? 'bg-amber-50 border-amber-400 text-amber-700'
                                : 'bg-white/60 border-warmgray-200 text-warmgray-600 hover:bg-amber-50/40 hover:border-amber-200'
                            }`}>
                              <input type="radio" name={`cond-mode-${field.name}`} checked={condMode === mode}
                                onChange={() => setCondMode(mode)} className="accent-amber-500" />
                              {label}
                            </label>
                          ))}
                        </div>
                        {condMode === 'value' && (
                          condSrcOptions ? (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {condSrcOptions.map((o) => {
                                const isActive = curEquals === o.value;
                                return (
                                  <button key={o.value} type="button" onClick={() => setCondValue(o.value)}
                                    className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                                      isActive ? 'bg-amber-500 text-white border-amber-500' : 'bg-white/80 text-warmgray-700 border-warmgray-200 hover:bg-amber-50 hover:border-amber-300'
                                    }`}>
                                    {o.label}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <input type="text" value={curEquals === '__filled__' || curEquals === '__empty__' ? '' : curEquals}
                              onChange={(e) => setCondValue(e.target.value)}
                              className="input text-xs w-full" placeholder={en ? 'Type the expected value' : '表示条件となる値を入力'} />
                          )
                        )}
                        <p className="text-[10px] text-warmgray-400 pt-0.5">
                          {en ? '→ then show this field.' : '→ このとき、この項目を表示する。'}
                        </p>
                        <button type="button" onClick={() => onUpdate({ conditional_on: undefined })}
                          className="text-[10px] text-warmgray-400 hover:text-red-500 transition-colors">
                          {en ? 'Remove condition (always show)' : '条件を削除（常に表示）'}
                        </button>
                      </div>
                    )}
                  </div>
                </Box>
              );
            })()}

            {/* Validation — text */}
            {isText && (
              <Box tone="warmgray" title={en ? 'Validation' : '入力チェック'}>
                <Field label={en ? 'Input format' : '入力形式'}>
                  <select className="select text-xs w-full"
                    value={
                      // undefined → 制限なし; matches a preset → that preset;
                      // any other string (incl. '') → custom. Treating '' as custom
                      // lets the user switch FROM a preset TO custom without the
                      // dropdown snapping back (the old code kept the preset's regex,
                      // so find() re-matched it and reverted the selection).
                      field.validation?.regex == null
                        ? ''
                        : REGEX_PRESETS.find((p) => p.regex === field.validation?.regex)?.key ?? 'custom'
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      const p = REGEX_PRESETS.find((x) => x.key === v);
                      if (v === '') setVal({ regex: undefined });
                      else if (v === 'custom') {
                        // Keep an existing custom regex; if coming from a preset,
                        // start blank so the dropdown stays on "custom".
                        const cur = field.validation?.regex;
                        const fromPreset = cur != null && REGEX_PRESETS.some((x) => x.regex === cur);
                        setVal({ regex: fromPreset || cur == null ? '' : cur });
                      }
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
                  <Field label={en ? 'Add to total' : '合計欄に加算する'} hint={en ? 'This field\'s value will be added into the selected auto-calculated total.' : 'この項目の値を合計欄に加算します。合計欄は自動計算ON の数値項目です。'}>
                    <select value={field.sum_target ?? ''} onChange={(e) => onUpdate({ sum_target: e.target.value || undefined })} className="select text-xs w-full">
                      <option value="">— {en ? 'do not add to any total' : '加算しない'} —</option>
                      {computedFieldNames.map((n) => {
                        const f = siblingFields.find((x) => x.name === n);
                        return <option key={n} value={n}>{f?.label || n}</option>;
                      })}
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

        {/* ════════════════════ LAYOUT ════════════════════ */}
        {tab === 'appearance' && (
          <>
            {/* Width */}
            {!isRepeatGroup && !isHeader && !isGroup ? (
              <Field label={en ? 'Width on form' : 'フォーム上の幅'} hint={en ? 'How wide this field appears. Auto picks a sensible default.' : '項目の横幅。「自動」はタイプに合った幅を自動選択。'}>
                <div className="grid grid-cols-7 gap-1">
                  {COL_SPAN_OPTIONS.map(({ value, ja, en: e }) => {
                    const pct = value === undefined ? 50 : value === 'quarter' ? 25 : value === 'third' ? 33 : value === 'half' ? 50 : value === 'twothirds' ? 66 : value === 'threequarters' ? 75 : 100;
                    const isActive = (field.col_span ?? undefined) === value;
                    return (
                      <button key={String(value ?? 'auto')} type="button" onClick={() => onUpdate({ col_span: value })}
                        title={en ? e : ja}
                        className={`flex flex-col items-center justify-center gap-1 py-2 rounded-lg border text-[10px] font-semibold transition-colors ${
                          isActive ? 'bg-ringo-500 text-white border-ringo-500' : 'text-warmgray-600 border-warmgray-200 hover:bg-warmgray-50'}`}>
                        <div className="w-8 h-1.5 rounded-full bg-current/20 overflow-hidden">
                          <div className="h-full rounded-full bg-current transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="leading-none">{en ? e : ja}</span>
                      </button>
                    );
                  })}
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
