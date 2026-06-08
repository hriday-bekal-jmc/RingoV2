// RingoLoader — branded line-drawing loading animation.
//
// SVG path stroke is animated via stroke-dasharray + stroke-dashoffset so the
// apple + leaf + arrow appear to be "drawn" by an invisible pen, then fade
// and restart. Five paths animate in sequence:
//   1. Apple left lobe
//   2. Apple right lobe
//   3. Leaf
//   4. Arrow stem
//   5. Arrow head
//
// Reusable everywhere — pass `size` (px) and optional `color` (CSS color or
// Tailwind class via parent text-*). When inside a coloured parent, use
// color="currentColor" and set the wrapper's text-* class.
//
// Usage:
//   <RingoLoader size={64} />                      // default ringo red
//   <RingoLoader size={32} color="currentColor" /> // inherits parent color
//   <RingoLoader.Inline />                         // small inline w/ text
//   <RingoLoader.Page />                           // full-page centered

import { useEffect, useState, type CSSProperties } from 'react';

interface Props {
  /** Pixel size of the square SVG. Default 64. */
  size?:  number;
  /** Stroke color. Default brand red. Pass "currentColor" to inherit. */
  color?: string;
  /** Stroke thickness as a fraction of viewBox (default 5 of 110-unit space). */
  strokeWidth?: number;
  /** Loop duration in seconds (full draw + hold + erase). Default 2.4. */
  duration?: number;
  /** Optional aria-label for screen readers. */
  label?: string;
  /** Extra wrapper class. */
  className?: string;
}

export default function RingoLoader({
  size        = 64,
  color       = 'var(--ringo-500)',
  strokeWidth = 5,
  duration    = 2.4,
  label       = '読み込み中',
  className   = '',
}: Props) {
  // Each path animated w/ stroke-dasharray = its length. Hardcoded approximate
  // path lengths (computed once via getTotalLength on similar paths). They
  // don't need to be pixel-perfect — being slightly larger than actual length
  // is fine (just means the stroke draws a tiny bit beyond visible).
  const lens = { apple1: 170, apple2: 170, leaf: 40, stem: 70, arrow: 40 };

  // Total animation timeline:
  //   0–55%  draw paths sequentially (overlap a bit for smooth feel)
  //   55–75% hold complete
  //   75–95% erase backward (reverses by dashoffset overshoot)
  //   95–100% pause before loop
  // Each path gets its own keyframes scaled to duration.
  const wrapStyle: CSSProperties = {
    width:  size,
    height: size,
    color,                            // child SVG uses currentColor → stroke
  };

  // Per-path inline styles — sets initial dasharray + dashoffset + animation
  const pathStyle = (len: number, delay: number): CSSProperties => ({
    strokeDasharray:  len,
    strokeDashoffset: len,
    animation:        `ringo-draw-${len} ${duration}s ease-in-out ${delay}s infinite`,
  });

  return (
    <div className={`inline-flex items-center justify-center ${className}`} style={wrapStyle} role="status" aria-label={label}>
      <style>{`
        @keyframes ringo-draw-${lens.apple1} {
          0%   { stroke-dashoffset: ${lens.apple1}; opacity: 1; }
          40%  { stroke-dashoffset: 0; opacity: 1; }
          75%  { stroke-dashoffset: 0; opacity: 1; }
          90%  { stroke-dashoffset: 0; opacity: 0; }
          100% { stroke-dashoffset: ${lens.apple1}; opacity: 0; }
        }
        @keyframes ringo-draw-${lens.apple2} {
          0%   { stroke-dashoffset: ${lens.apple2}; opacity: 1; }
          40%  { stroke-dashoffset: 0; opacity: 1; }
          75%  { stroke-dashoffset: 0; opacity: 1; }
          90%  { stroke-dashoffset: 0; opacity: 0; }
          100% { stroke-dashoffset: ${lens.apple2}; opacity: 0; }
        }
        @keyframes ringo-draw-${lens.leaf} {
          0%   { stroke-dashoffset: ${lens.leaf}; opacity: 1; }
          40%  { stroke-dashoffset: 0; opacity: 1; }
          75%  { stroke-dashoffset: 0; opacity: 1; }
          90%  { stroke-dashoffset: 0; opacity: 0; }
          100% { stroke-dashoffset: ${lens.leaf}; opacity: 0; }
        }
        @keyframes ringo-draw-${lens.stem} {
          0%   { stroke-dashoffset: ${lens.stem}; opacity: 1; }
          40%  { stroke-dashoffset: 0; opacity: 1; }
          75%  { stroke-dashoffset: 0; opacity: 1; }
          90%  { stroke-dashoffset: 0; opacity: 0; }
          100% { stroke-dashoffset: ${lens.stem}; opacity: 0; }
        }
        @keyframes ringo-draw-${lens.arrow} {
          0%   { stroke-dashoffset: ${lens.arrow}; opacity: 1; }
          40%  { stroke-dashoffset: 0; opacity: 1; }
          75%  { stroke-dashoffset: 0; opacity: 1; }
          90%  { stroke-dashoffset: 0; opacity: 0; }
          100% { stroke-dashoffset: ${lens.arrow}; opacity: 0; }
        }
      `}</style>

      <svg
        viewBox="0 0 110 100"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={size}
        height={size}
        aria-hidden="true"
      >
        {/* Apple left lobe — drawn first */}
        <path
          d="M 55 52 C 53 34 39 22 23 26 C 7 30 5 52 15 65 C 23 76 39 82 55 78"
          style={pathStyle(lens.apple1, 0)}
        />
        {/* Apple right lobe — staggered 0.1s after */}
        <path
          d="M 55 52 C 57 34 71 22 87 26 C 103 30 105 52 95 65 C 87 76 71 82 55 78"
          style={pathStyle(lens.apple2, 0.15)}
        />
        {/* Leaf — left of stem */}
        <path
          d="M 55 30 C 48 22 38 18 38 18 C 38 18 45 26 49 32"
          style={pathStyle(lens.leaf, 0.45)}
        />
        {/* Arrow stem rising up-right */}
        <path
          d="M 57 28 C 63 18 75 10 85 5"
          style={pathStyle(lens.stem, 0.55)}
        />
        {/* Arrow head */}
        <path
          d="M 85 5 L 77 10 M 85 5 L 91 12"
          style={pathStyle(lens.arrow, 0.7)}
        />
      </svg>
    </div>
  );
}

// ── Preset variants ─────────────────────────────────────────────────────────

/** Small inline loader — pairs with a label like "読み込み中..." */
RingoLoader.Inline = function RingoLoaderInline({ label = '読み込み中...' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-warmgray-400 text-sm">
      <RingoLoader size={24} strokeWidth={6} color="currentColor" />
      {label}
    </span>
  );
};

/** Full-page centered loader — use for route-level Suspense fallbacks */
RingoLoader.Page = function RingoLoaderPage({ label = '読み込み中...' }: { label?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-cream-100">
      <RingoLoader size={88} color="var(--ringo-500)" strokeWidth={4} />
      <p className="text-warmgray-500 text-sm font-medium">{label}</p>
    </div>
  );
};

/** Block-level centered loader for cards / list bodies */
RingoLoader.Block = function RingoLoaderBlock({ label = '読み込み中...', size = 56 }: { label?: string; size?: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-warmgray-400">
      <RingoLoader size={size} color="var(--ringo-500)" />
      <p className="text-xs font-medium">{label}</p>
    </div>
  );
};

/**
 * Delayed block loader — renders nothing for `delay` ms, then the Block.
 * Use as a Suspense fallback: a lazy chunk that resolves within `delay`
 * unmounts the fallback before it ever paints, so the user sees no loader
 * flash on fast (cached / preloaded) chunk loads.
 */
RingoLoader.DelayedBlock = function RingoLoaderDelayedBlock({
  delay = 220,
  label = '読み込み中...',
  size = 56,
}: { delay?: number; label?: string; size?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  if (!show) return null;
  return <RingoLoader.Block label={label} size={size} />;
};
