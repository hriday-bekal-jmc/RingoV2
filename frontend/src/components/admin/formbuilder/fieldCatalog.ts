// Visual palette catalog for the form builder.
//
// Maps each field `type` to a friendly card: icon, plain-language name, a
// one-line description, and a category for grouping in the palette. This is
// presentation metadata only — the canonical type list lives in FIELD_TYPES
// (types.ts). Every FIELD_TYPES value MUST have an entry here.

export type FieldCategory = 'basic' | 'choice' | 'smart' | 'layout';

export interface CatalogEntry {
  type:     string;
  icon:     string;       // emoji glyph for the palette card
  label_ja: string;       // friendly name (plain language, not jargon)
  label_en: string;
  desc_ja:  string;       // one-line "what it does"
  desc_en:  string;
  category: FieldCategory;
}

export const CATEGORY_LABELS: Record<FieldCategory, { ja: string; en: string }> = {
  basic:  { ja: '基本',     en: 'Basic' },
  choice: { ja: '選択',     en: 'Choices' },
  smart:  { ja: 'スマート', en: 'Smart' },
  layout: { ja: 'レイアウト', en: 'Layout' },
};

export const CATEGORY_ORDER: FieldCategory[] = ['basic', 'choice', 'smart', 'layout'];

export const FIELD_CATALOG: CatalogEntry[] = [
  // ── Basic inputs ──
  { type: 'text',     icon: 'Aa', label_ja: '短文',     label_en: 'Short text',
    desc_ja: '1行の文字入力', desc_en: 'Single line of text', category: 'basic' },
  { type: 'textarea', icon: '¶',  label_ja: '長文',     label_en: 'Long text',
    desc_ja: '複数行の文章',   desc_en: 'Multi-line paragraph', category: 'basic' },
  { type: 'number',   icon: '#',  label_ja: '数値',     label_en: 'Number',
    desc_ja: '金額・数量など', desc_en: 'Amount, quantity, etc.', category: 'basic' },
  { type: 'date',     icon: '📅', label_ja: '日付',     label_en: 'Date',
    desc_ja: 'カレンダー選択', desc_en: 'Calendar picker', category: 'basic' },
  { type: 'time',     icon: '🕐', label_ja: '時刻',     label_en: 'Time',
    desc_ja: '時:分の入力',   desc_en: 'Hour : minute', category: 'basic' },
  { type: 'file',     icon: '📎', label_ja: 'ファイル', label_en: 'File',
    desc_ja: 'PDF・画像の添付', desc_en: 'Attach PDF or image', category: 'basic' },

  // ── Choices ──
  { type: 'select',   icon: '▼',  label_ja: 'プルダウン', label_en: 'Dropdown',
    desc_ja: '選択肢から1つ', desc_en: 'Pick one from a list', category: 'choice' },
  { type: 'checkbox', icon: '☑',  label_ja: 'チェック',  label_en: 'Checkbox',
    desc_ja: 'はい/いいえ・複数選択', desc_en: 'Yes/no or multi-pick', category: 'choice' },

  // ── Smart (special renderers) ──
  { type: 'repeat_group',  icon: '⊞', label_ja: '繰り返し表', label_en: 'Repeatable table',
    desc_ja: '行を追加できる明細表', desc_en: 'Add-row line-item table', category: 'smart' },
  { type: 'allowance_days', icon: '💴', label_ja: '日当日数', label_en: 'Allowance days',
    desc_ja: '0 / 半日 / 1日の支給', desc_en: '0 / half / full day pay', category: 'smart' },
  { type: 'route_entry',    icon: '🚃', label_ja: '交通経路', label_en: 'Transit route',
    desc_ja: '乗車駅→降車駅・運賃', desc_en: 'From / to / fare', category: 'smart' },
  { type: 'ai_file_reader', icon: '🤖', label_ja: 'AI読み取り', label_en: 'AI receipt',
    desc_ja: '領収書を撮って自動入力', desc_en: 'Scan receipt, auto-fill', category: 'smart' },
  { type: 'user_picker',    icon: '👥', label_ja: '参加者選択', label_en: 'People picker',
    desc_ja: '社員を選択・人数自動', desc_en: 'Pick staff, auto-count', category: 'smart' },

  // ── Layout ──
  { type: 'header', icon: '⊟', label_ja: '見出し', label_en: 'Section heading',
    desc_ja: 'セクションの区切り線', desc_en: 'Section divider title', category: 'layout' },
  { type: 'field_group', icon: '▢', label_ja: 'グループ', label_en: 'Field group',
    desc_ja: '複数項目を枠で囲む', desc_en: 'Box around several fields', category: 'layout' },
];

const CATALOG_BY_TYPE: Record<string, CatalogEntry> = Object.fromEntries(
  FIELD_CATALOG.map((e) => [e.type, e]),
);

export function catalogFor(type: string): CatalogEntry | undefined {
  return CATALOG_BY_TYPE[type];
}

// Friendly glyph + name for an arbitrary field type (falls back gracefully).
export function fieldGlyph(type: string): string {
  return CATALOG_BY_TYPE[type]?.icon ?? '◻';
}
