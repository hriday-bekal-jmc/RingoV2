// ── RINGO i18n dictionary ─────────────────────────────────────────────────────
// Add keys here. useT() returns string for current language.
//
// DEV-ONLY OVERRIDES: i18n.overrides.json is written by the /dev/i18n page.
// Production cleanup = delete i18n.overrides.json + the 3 lines below marked
// with `DEV-OVERRIDES`. Safe: if file is empty {ja:{},en:{}} nothing changes.

// DEV-OVERRIDES (line 1/3)
import overridesRaw from './i18n.overrides.json';

import nav from './i18n/nav';
import status from './i18n/status';
import buttons from './i18n/buttons';
import admin from './i18n/admin';
import forms from './i18n/forms';
import approvals from './i18n/approvals';
import common from './i18n/common';

export type Lang = 'ja' | 'en';

// Field label resolver — picks label_en when lang=en AND label_en is set,
// otherwise falls back to legacy `label` (Japanese). Used across all places
// that render a schema field name to keep behavior identical.
export function fieldLabel(
  f: { label: string; label_en?: string | null } | undefined,
  lang: Lang,
): string {
  if (!f) return '';
  return lang === 'en' && f.label_en ? f.label_en : f.label;
}

// Resolve raw stored value to human-readable label for select/checkbox fields.
// Option `value` is now an opaque auto-generated key (opt_xxx) — viewers must
// look up the corresponding label_ja/label_en, otherwise users see the key.
// Single value (string) or multi-select (array of strings) supported. Falls
// back to raw value when no options array or no match (legacy data, deleted
// option, etc.).
export function optionLabel(
  f: { type?: string; options?: { value: string; label_ja?: string; label_en?: string }[] } | undefined,
  val: unknown,
  lang: Lang,
): string {
  if (val == null || val === '') return '';
  if (!f) return String(val);
  const opts = Array.isArray(f.options) ? f.options : null;
  if (!opts || (f.type !== 'select' && f.type !== 'checkbox')) return String(val);
  const pick = (v: string): string => {
    const o = opts.find((x) => x.value === v);
    if (!o) return v;
    return (lang === 'en' && o.label_en) ? o.label_en : (o.label_ja ?? v);
  };
  if (Array.isArray(val)) return val.map((v) => pick(String(v))).join('、');
  return pick(String(val));
}

// ponytail: domain files live in ./i18n/ — edit keys there, not here
const dict = {
  ja: { ...nav.ja, ...status.ja, ...buttons.ja, ...admin.ja, ...forms.ja, ...approvals.ja, ...common.ja },
  en: { ...nav.en, ...status.en, ...buttons.en, ...admin.en, ...forms.en, ...approvals.en, ...common.en },
} as const;

// DEV-OVERRIDES (line 2/3): merge override JSON into both langs at module init.
// Safe in prod: empty {} = no-op. Delete this block + import + json file on prod cleanup.
const overrides = overridesRaw as { ja?: Record<string, string>; en?: Record<string, string> };
Object.assign((dict as any).ja, overrides.ja ?? {});
Object.assign((dict as any).en, overrides.en ?? {});

// DEV-OVERRIDES (line 3/3): DictKey union widened so override-added keys typecheck.
// On prod cleanup, revert to: `export type DictKey = keyof typeof dict['ja'];`
export type DictKey = keyof typeof dict['ja'] | string;
export type Dict = typeof dict['ja'];
export { dict };
