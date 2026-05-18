import { useState, useRef, useLayoutEffect } from 'react';
import { useLang } from '../../context/LanguageContext';

interface CollapsibleCommentProps {
  text: string;
  /** Max visible lines before collapse. Default 3. */
  lines?: number;
  className?: string;
}

/**
 * Renders comment text clamped to `lines` lines.
 * "Read more" toggle only appears when text actually overflows — determined
 * by measuring scrollHeight > clientHeight with clamp active.
 */
export default function CollapsibleComment({ text, lines = 3, className }: CollapsibleCommentProps) {
  const { lang } = useLang();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Measure overflow AFTER clamp is painted
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, lines]);

  return (
    <span className={`block ${className ?? ''}`}>
      <span
        ref={ref}
        className={`block break-words overflow-wrap-anywhere ${expanded ? '' : `line-clamp-${lines}`}`}
      >
        {text}
      </span>
      {(overflows || expanded) && (
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
