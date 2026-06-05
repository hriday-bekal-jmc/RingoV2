// A single placed field as it appears in the middle canvas.
//
// Sortable (drag handle on the left), selectable (click anywhere to open it in
// the Properties panel), with quick duplicate / delete actions. Shows a compact
// summary: glyph, label, friendly type name, required marker, and a width hint.

import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLang } from '../../../context/LanguageContext';
import { catalogFor, fieldGlyph } from './fieldCatalog';
import { COL_SPAN_OPTIONS } from '../../forms/fieldLayout';
import type { FormField } from './types';

function CanvasField({
  id, field, isSelected, onSelect, onDuplicate, onDelete, nested = false,
}: {
  id:          string;
  field:       FormField;
  isSelected:  boolean;
  onSelect:    () => void;
  onDuplicate?: () => void;
  onDelete:    () => void;
  /** Nested container child — no drag handle, no duplicate, compact. */
  nested?:     boolean;
}) {
  const { lang } = useLang();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  const cat = catalogFor(field.type);
  const typeName = cat ? (lang === 'en' ? cat.label_en : cat.label_ja) : field.type;
  const isHeader = field.type === 'header';
  const label = field.label || (lang === 'en' ? '(untitled)' : '（無題）');
  const widthHint = field.col_span ? (COL_SPAN_OPTIONS.find((o) => o.value === field.col_span)?.frac ?? null) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`group relative flex items-center gap-2 rounded-xl border px-2.5 py-2 cursor-pointer
                  transition-all duration-150
                  ${isHeader ? 'bg-warmgray-50/80' : 'bg-white/70'}
                  ${isSelected
                    ? 'border-ringo-400 ring-2 ring-ringo-200 shadow-sm'
                    : 'border-white/70 hover:border-ringo-200 hover:bg-white'}
                  ${isDragging ? 'opacity-80 shadow-lg' : ''}`}
    >
      {/* Drag handle — drag to reorder or move in/out of a group */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className={`shrink-0 cursor-grab active:cursor-grabbing text-warmgray-300 hover:text-warmgray-500 touch-none ${nested ? 'px-0 text-[10px]' : 'px-0.5'}`}
        title={lang === 'en' ? 'Drag to reorder or move in/out of a box' : 'ドラッグで並び替え・ボックス出し入れ'}
        aria-label="drag handle"
      >
        ⠿
      </button>

      {/* Glyph */}
      <span className={`flex items-center justify-center w-7 h-7 rounded-lg text-sm font-bold shrink-0
                        ${isSelected ? 'bg-ringo-100 text-ringo-600' : 'bg-warmgray-100 text-warmgray-500'}`}>
        {fieldGlyph(field.type)}
      </span>

      {/* Label + type */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`truncate text-xs font-semibold ${isHeader ? 'text-warmgray-600' : 'text-warmgray-800'}`}>
            {label}
          </span>
          {field.required && <span className="text-ringo-500 text-xs font-bold shrink-0" title="required">*</span>}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-warmgray-400">
          <span className="truncate">{typeName}</span>
          {widthHint && <span className="shrink-0" title="width">· {widthHint}</span>}
          {field.show_in_row && <span className="shrink-0" title={lang === 'en' ? 'shown in list row' : '一覧に表示'}>· 👁</span>}
          {field.conditional_on?.field && <span className="shrink-0" title={lang === 'en' ? 'conditional' : '条件付き'}>· ⚡</span>}
        </div>
      </div>

      {/* Quick actions — appear on hover / when selected */}
      <div className={`flex items-center gap-0.5 shrink-0 transition-opacity
                       ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        {onDuplicate && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            className="text-warmgray-400 hover:text-ringo-600 px-1.5 py-1 rounded-md hover:bg-ringo-50 transition-colors text-xs"
            title={lang === 'en' ? 'Duplicate' : '複製'}
          >
            ⧉
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="text-warmgray-400 hover:text-red-600 px-1.5 py-1 rounded-md hover:bg-red-50 transition-colors text-sm"
          title={lang === 'en' ? 'Delete' : '削除'}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default memo(CanvasField);
