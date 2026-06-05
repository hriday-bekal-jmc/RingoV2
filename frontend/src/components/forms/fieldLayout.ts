// Shared field-width system — single source of truth for column spans.
//
// Every surface that lays out form fields (the live DynamicForm, the builder
// preview, and all read-only viewers: ApplicationDetail, Settlement,
// AdminAppDetailModal) imports from here so a field's width renders identically
// everywhere. Grid is 12 columns at `md`; single column below.
//
// Backward compatible: legacy schemas use 'half'/'full' strings; both map in.

export type ColSpan =
  | 'quarter'        // 1/4
  | 'third'          // 1/3
  | 'half'           // 1/2
  | 'twothirds'      // 2/3
  | 'threequarters'  // 3/4
  | 'full';          // 1/1

interface LayoutField {
  type: string;
  col_span?: string;
}

const SPAN_N: Record<string, number> = {
  quarter: 3,
  third: 4,
  half: 6,
  twothirds: 8,
  threequarters: 9,
  full: 12,
};

// Static literals so Tailwind JIT keeps them (never build these dynamically).
const SPAN_CLASS: Record<number, string> = {
  3: 'md:col-span-3',
  4: 'md:col-span-4',
  6: 'md:col-span-6',
  8: 'md:col-span-8',
  9: 'md:col-span-9',
  12: 'md:col-span-12',
};

// Types that always want the full row when width is "auto" (undefined).
const AUTO_FULL_TYPES = new Set([
  'textarea', 'file', 'ai_file_reader', 'repeat_group', 'route_entry',
  'checkbox', 'user_picker', 'header', 'field_group',
]);

// Width picker options for the builder (label + value).
export const COL_SPAN_OPTIONS: { value: ColSpan | undefined; ja: string; en: string; frac: string }[] = [
  { value: undefined,        ja: '自動',  en: 'Auto', frac: 'A' },
  { value: 'quarter',        ja: '¼',     en: '1/4',  frac: '¼' },
  { value: 'third',          ja: '⅓',     en: '1/3',  frac: '⅓' },
  { value: 'half',           ja: '½',     en: '1/2',  frac: '½' },
  { value: 'twothirds',      ja: '⅔',     en: '2/3',  frac: '⅔' },
  { value: 'threequarters',  ja: '¾',     en: '3/4',  frac: '¾' },
  { value: 'full',           ja: '全幅',  en: 'Full', frac: '█' },
];

/**
 * field_group is a VISUAL-ONLY container — its children store values flat at the
 * top level. Expand groups into their children for any logic that needs a flat
 * field list (defaults, conditional sources, sums, read-display). A group-level
 * conditional_on is pushed down to children lacking their own.
 */
export function flattenFieldGroups<
  T extends { type: string; fields?: T[]; conditional_on?: unknown },
>(fields: T[], inherited?: unknown): T[] {
  const out: T[] = [];
  for (const f of fields) {
    if (f.type === 'field_group' && Array.isArray(f.fields)) {
      out.push(...flattenFieldGroups(f.fields, f.conditional_on ?? inherited));
    } else if (inherited && !f.conditional_on) {
      out.push({ ...f, conditional_on: inherited });
    } else {
      out.push(f);
    }
  }
  return out;
}

/** Numeric column span (1–12) for a field, resolving 'auto' by type. */
export function fieldColSpanN(field: LayoutField): number {
  const cs = field.col_span;
  if (cs && SPAN_N[cs] != null) return SPAN_N[cs];
  return AUTO_FULL_TYPES.has(field.type) ? 12 : 6;
}

/** Full grid-item class: single column on mobile, resolved span at md+. */
export function fieldColSpanClass(field: LayoutField): string {
  return `col-span-1 ${SPAN_CLASS[fieldColSpanN(field)]}`;
}
