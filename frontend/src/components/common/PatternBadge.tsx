// Shared pattern badge — surfaces what flow an application uses.
//   pattern_id = 1 → 稟議 only      (RINGI)
//   pattern_id = 2 → 精算 only      (SETTLEMENT) — direct settlement
//   pattern_id = 3 → 稟議＋精算     (RINGI + SETTLEMENT) — two-phase
//
// Used in Dashboard tiles, History rows, Approvals inbox, ApplicationDetail.
// Single source of truth so palette + labels stay consistent.

import { useLang } from '../../context/LanguageContext';

type Size = 'xs' | 'sm';

interface Props {
  patternId: number | null | undefined;
  size?: Size;
  className?: string;
}

const STYLES = {
  1: {
    cls:    'bg-ringo-100/80 text-ringo-700 border-ringo-200/70',
    icon:   '📝',
    ja:     '稟議',
    en:     'Ringi',
  },
  2: {
    cls:    'bg-teal-100/80 text-teal-700 border-teal-200/70',
    icon:   '💴',
    ja:     '精算',
    en:     'Settlement',
  },
  3: {
    cls:    'bg-mustard-100 text-mustard-700 border-mustard-300/70',
    icon:   '🔁',
    ja:     '稟議＋精算',
    en:     'Ringi + Settlement',
  },
} as const;

export default function PatternBadge({ patternId, size = 'xs', className = '' }: Props) {
  const { lang } = useLang();
  const style = STYLES[patternId as 1 | 2 | 3];
  if (!style) return null;

  const sizeCls = size === 'sm'
    ? 'text-[11px] px-2 py-0.5'
    : 'text-[10px] px-1.5 py-0.5';

  return (
    <span className={`inline-flex items-center gap-1 font-bold rounded-full border backdrop-blur-sm ${style.cls} ${sizeCls} ${className}`}>
      <span aria-hidden>{style.icon}</span>
      {lang === 'en' ? style.en : style.ja}
    </span>
  );
}
