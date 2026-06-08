// Left panel of the form builder — visual field-type palette.
//
// Click a card to append a field of that type, OR drag a card onto the canvas
// to drop it at a specific spot (top level, or inside a group/table box). Cards
// are grouped by category (Basic / Choices / Smart / Layout) with plain-language
// names + one-line descriptions so a non-technical admin understands each type.

import { useDraggable } from '@dnd-kit/core';
import { useLang } from '../../../context/LanguageContext';
import {
  FIELD_CATALOG, CATEGORY_LABELS, CATEGORY_ORDER, type FieldCategory, type CatalogEntry,
} from './fieldCatalog';

function PaletteCard({ entry, onAdd }: { entry: CatalogEntry; onAdd: (type: string) => void }) {
  const { lang } = useLang();
  // id `new:<type>` marks a palette-origin drag; canvas onDragEnd inserts a new field.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `new:${entry.type}` });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => onAdd(entry.type)}
      title={lang === 'en' ? entry.desc_en : entry.desc_ja}
      className={`group flex flex-col items-start gap-1 rounded-xl border border-white/70 bg-white/60
                  px-2.5 py-2 text-left transition-all duration-150 touch-none cursor-grab active:cursor-grabbing
                  hover:border-ringo-300 hover:bg-white hover:shadow-sm hover:-translate-y-px
                  active:scale-[0.98] ${isDragging ? 'opacity-40' : ''}`}
    >
      <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br
                       from-warmgray-100 to-warmgray-200 text-sm font-bold text-warmgray-600
                       group-hover:from-ringo-100 group-hover:to-ringo-200 group-hover:text-ringo-600
                       transition-colors shrink-0">
        {entry.icon}
      </span>
      <span className="text-[11px] font-semibold text-warmgray-700 leading-tight">
        {lang === 'en' ? entry.label_en : entry.label_ja}
      </span>
      <span className="text-[9px] text-warmgray-400 leading-tight line-clamp-2">
        {lang === 'en' ? entry.desc_en : entry.desc_ja}
      </span>
    </button>
  );
}

export default function FieldPalette({
  onAdd,
  disabledTypes,
}: {
  onAdd: (type: string) => void;
  /** Types to hide (e.g. group/table while adding inside a container). */
  disabledTypes?: Set<string>;
}) {
  const { lang } = useLang();

  const byCategory = (cat: FieldCategory): CatalogEntry[] =>
    FIELD_CATALOG.filter((e) => e.category === cat && !disabledTypes?.has(e.type));

  return (
    <div className="space-y-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">
        {lang === 'en' ? 'Add a field — click or drag' : '項目を追加 — クリックまたはドラッグ'}
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
                <PaletteCard key={e.type} entry={e} onAdd={onAdd} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
