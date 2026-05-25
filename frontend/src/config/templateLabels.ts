// Template label map (JP + EN).
//
// The DB only stores `form_templates.title_ja`, so when the user's language is
// English, applications would show Japanese template names everywhere — bad UX.
// This client-side map covers that gap until we add `title_en` to the DB.
//
// Pattern: lookup by template_code with fallback to the server-supplied
// Japanese name. New templates added in admin will fall back gracefully.

export type Lang = 'ja' | 'en';

interface TemplateLabel { ja: string; en: string; desc_ja?: string; desc_en?: string; icon?: string; gradient?: string; twoStage?: boolean; }

export const TEMPLATE_LABELS: Record<string, TemplateLabel> = {
  INQUIRY:            { ja: '伺書',               en: 'Inquiry',                    desc_ja: '一般稟議・伺い書',     desc_en: 'General ringi / inquiry',           icon: '📋', gradient: 'from-ringo-400/20 to-ringo-600/10' },
  BUSINESS_TRIP:      { ja: '出張伺い',           en: 'Business Trip Request',      desc_ja: '出張前申請',           desc_en: 'Pre-trip approval',                 icon: '✈️', gradient: 'from-sky-400/20 to-blue-500/10' },
  OFFICE_OVERTIME:    { ja: '早出・延長申請',     en: 'Early/Overtime Request',     desc_ja: '早出・事務所閉鎖・延長', desc_en: 'Early start / office close / overtime', icon: '🕐', gradient: 'from-amber-400/20 to-mustard-500/10' },
  EQUIPMENT_PURCHASE: { ja: '備品・消耗品購入',   en: 'Equipment Purchase',         desc_ja: '備品・消耗品の購入申請', desc_en: 'Purchase request for supplies',          icon: '🛒', gradient: 'from-emerald-400/20 to-green-500/10' },
  PC_TAKEOUT:         { ja: 'PC持ち出し',         en: 'PC Takeout',                 desc_ja: '社外へのPC持ち出し申請', desc_en: 'Take laptop off-site',                   icon: '💻', gradient: 'from-indigo-400/20 to-violet-500/10' },
  LEAVE:              { ja: '有休・代休・特別休暇', en: 'Leave Request',            desc_ja: '休暇の申請',           desc_en: 'Time-off request',                   icon: '📅', gradient: 'from-violet-400/20 to-purple-500/10' },
  TARDINESS:          { ja: '遅刻・早退',         en: 'Late/Early-Leave',           desc_ja: '控除対象の勤怠申請',   desc_en: 'Attendance deduction notice',        icon: '⏰', gradient: 'from-amber-400/20 to-ringo-500/10' },
  INCIDENT_REPORT:    { ja: '始末書',             en: 'Incident Report',            desc_ja: '事故・インシデント報告', desc_en: 'Accident / incident report',             icon: '⚠️', gradient: 'from-red-400/20 to-ringo-600/10' },
  EXPENSE_CLAIM:      { ja: '立替精算申請',       en: 'Expense Reimbursement',      desc_ja: '稟議→精算入力→精算承認', desc_en: 'Ringi → Expense input → Settlement',  icon: '💴', gradient: 'from-teal-400/20 to-emerald-500/10', twoStage: true },
  TRANSPORT_EXPENSE:  { ja: '交通費精算（出張日除く）', en: 'Travel expense reimbursement (excluding business trip days)', desc_ja: '月次交通費精算（出張日除く）', desc_en: 'Monthly transportation expense (excl. business trips)', icon: '🚃', gradient: 'from-blue-400/20 to-indigo-500/10', twoStage: true },
  RECREATION:         { ja: 'レクリエーション費',      en: 'Recreation Expense',                                      desc_ja: 'レクリエーション費補助申請',   desc_en: 'Recreation expense subsidy application',           icon: '🎉', gradient: 'from-pink-400/20 to-rose-500/10',   twoStage: true },
};

/**
 * Resolve a template's display label for the active language.
 * Falls back to the server-supplied Japanese title if the code is unknown
 * (e.g. a custom template added via admin).
 */
export function templateLabel(
  code:          string | undefined,
  lang:          Lang,
  fallbackTitle: string,
  titleEn?:      string | null, // DB title field (English) — preferred over hardcoded map
): string {
  if (lang === 'en') {
    if (titleEn) return titleEn;
    if (!code) return fallbackTitle;
    return TEMPLATE_LABELS[code]?.en ?? fallbackTitle;
  }
  if (!code) return fallbackTitle;
  return TEMPLATE_LABELS[code]?.ja ?? fallbackTitle;
}

export function templateDesc(code: string | undefined, lang: Lang): string {
  if (!code) return '';
  const entry = TEMPLATE_LABELS[code];
  if (!entry) return '';
  return (lang === 'en' ? entry.desc_en : entry.desc_ja) ?? '';
}
