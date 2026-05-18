import { useState } from 'react';
import { useLang } from '../../context/LanguageContext';

interface CollapsibleCommentProps {
  text: string;
  /** Character threshold before collapsing. Default 150. */
  charLimit?: number;
  className?: string;
}

/**
 * Renders comment text. Collapses to 3 lines when text exceeds `charLimit`
 * chars or contains 3+ newlines. "Read more" toggle expands fully.
 * Uses char count — no DOM measurement, works inside portals/modals.
 */
export default function CollapsibleComment({ text, charLimit = 150, className }: CollapsibleCommentProps) {
  const { lang } = useLang();
  const [expanded, setExpanded] = useState(false);

  const newlineCount = (text.match(/\n/g) ?? []).length;
  const isLong = text.length > charLimit || newlineCount >= 3;

  return (
    <span className={`block ${className ?? ''}`}>
      <span className={`break-all ${!expanded && isLong ? 'line-clamp-3' : 'block'}`}>
        {text}
      </span>
      {isLong && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
          className="mt-1 text-[10px] font-semibold underline underline-offset-2 opacity-60 hover:opacity-100 transition-opacity"
        >
          {expanded
            ? (lang === 'en' ? 'Show less' : '閉じる')
            : (lang === 'en' ? 'Read more' : 'もっと見る')}
        </button>
      )}
    </span>
  );
}
