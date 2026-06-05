// Left panel of the form builder — visual field-type palette.
//
// Click a card to append a new field of that type to the canvas. Cards are
// grouped by category (Basic / Choices / Smart / Layout) with plain-language
// names + one-line descriptions so a non-technical admin understands each type
// at a glance.

import { useLang } from '../../../context/LanguageContext';
import {
  FIELD_CATALOG, CATEGORY_LABELS, CATEGORY_ORDER, type FieldCategory, type CatalogEntry,
} from './fieldCatalog';

export default function FieldPalette({
  onAdd,
  disabledTypes,
}: {
  onAdd: (type: string) => void;
  /** Types to hide (e.g. repeat_group inside a repeat group — not Phase 1, reserved). */
  disabledTypes?: Set<string>;
}) {
  const { lang } = useLang();

  const byCategory = (cat: FieldCategory): CatalogEntry[] =>
    FIELD_CATALOG.filter((e) => e.category === cat && !disabledTypes?.has(e.type));

  return (
    <div className="space-y-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">
        {lang === 'en' ? 'Add a field' : '項目を追加'}
      </p>
      {CATEGORY_ORDER.map((cat) => {
        const entries = byCategory(cat);
        if (entries.length === 0) return null;
        return (
          <div key={cat} className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-warmgray-400 px-0.5">
              {lang === 'en' ? CATEGORY_LABELS[cat].en : CATEGORY_LABELS[cat].ja}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {entries.map((e) => (
                <button
                  key={e.type}
                  type="button"
                  onClick={() => onAdd(e.type)}
                  title={lang === 'en' ? e.desc_en : e.desc_ja}
                  className="group flex flex-col items-start gap-1 rounded-xl border border-white/70 bg-white/60
                             px-2.5 py-2 text-left transition-all duration-150
                             hover:border-ringo-300 hover:bg-white hover:shadow-sm hover:-translate-y-px
                             active:scale-[0.98]"
                >
                  <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br
                                   from-warmgray-100 to-warmgray-200 text-sm font-bold text-warmgray-600
                                   group-hover:from-ringo-100 group-hover:to-ringo-200 group-hover:text-ringo-600
                                   transition-colors shrink-0">
                    {e.icon}
                  </span>
                  <span className="text-[11px] font-semibold text-warmgray-700 leading-tight">
                    {lang === 'en' ? e.label_en : e.label_ja}
                  </span>
                  <span className="text-[9px] text-warmgray-400 leading-tight line-clamp-2">
                    {lang === 'en' ? e.desc_en : e.desc_ja}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
