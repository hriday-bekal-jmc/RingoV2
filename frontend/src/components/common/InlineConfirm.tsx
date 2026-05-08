// Inline confirmation pattern for row-level destructive actions.
//
// Why this exists:
//   Modal/popover dialogs for "delete this row" feel out of place — they
//   pull the user's eye away from the row, require backdrop dimming, and
//   need scroll/positioning math. For admin row actions where the user is
//   already intentional, inline confirmation is faster and cleaner.
//
// Layout-stability:
//   Both the trigger and the active confirm strip render inside a wrapper
//   that always reserves `reservedWidth` of horizontal space — passed by
//   the caller per-tab so it fits the widest active state. This means the
//   table column does NOT reflow when toggling between trigger and confirm;
//   no other rows shift, no flicker, no layout chop.
//
// Usage:
//   <InlineConfirm
//     isActive={confirmingId === row.id}
//     onTrigger={() => setConfirmingId(row.id)}
//     onConfirm={() => { mutate(row.id); setConfirmingId(null); }}
//     onCancel={() => setConfirmingId(null)}
//     reservedWidth={210}             // px — wider than the confirm strip
//   />

import { useEffect, useRef } from 'react';

interface Props {
  isActive: boolean;
  onTrigger: () => void;
  onConfirm: () => void;
  onCancel:  () => void;
  /** Short message shown next to confirm button. Keep under 12 chars. */
  message?: string;
  /** Default trigger label; usually "削除". */
  triggerLabel?: string;
  /** Confirm button label; defaults to "削除する". */
  confirmLabel?: string;
  /** Tailwind classes for the trigger (inactive) button. */
  triggerClass?: string;
  /** Optional extra actions rendered between confirm and cancel (e.g. "無効化"). */
  extraActions?: React.ReactNode;
  /** Disable confirm/trigger while a mutation is in-flight. */
  disabled?: boolean;
  /**
   * Pixel width reserved for the action area in BOTH states (trigger + active).
   * Set wider than the active confirm strip to prevent column reflow when
   * swapping. Default 210px fits the simple "削除しますか？ [削除する] [×]" strip.
   * Bump to ~280 when extraActions are passed.
   */
  reservedWidth?: number;
}

export default function InlineConfirm({
  isActive,
  onTrigger,
  onConfirm,
  onCancel,
  message      = '削除しますか？',
  triggerLabel = '削除',
  confirmLabel = '削除する',
  triggerClass = 'text-xs font-medium text-warmgray-400 hover:text-red-500 transition-colors',
  extraActions,
  disabled,
  reservedWidth = 210,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Click-outside dismisses the active confirm
  useEffect(() => {
    if (!isActive) return;
    const onDocClick = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onCancel();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [isActive, onCancel]);

  // Wrapper reserves the same horizontal space in both states.
  // - inline-flex right-aligned so the trigger sits flush right (matches the
  //   old layout where the delete button was at row's right edge).
  // - inline-style width: caller-tunable via `reservedWidth`.
  return (
    <div
      ref={rootRef}
      className="inline-flex items-center justify-end gap-1.5"
      style={{ width: reservedWidth }}
    >
      {!isActive ? (
        <button
          type="button"
          className={triggerClass}
          onClick={onTrigger}
          disabled={disabled}
        >
          {triggerLabel}
        </button>
      ) : (
        <div
          className="inline-flex items-center gap-1.5 animate-fade-in"
          role="alert"
        >
          <span className="text-[10px] text-red-600 font-semibold whitespace-nowrap">
            {message}
          </span>
          <button
            type="button"
            onClick={onConfirm}
            disabled={disabled}
            className="text-[11px] font-bold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-md px-2 py-0.5 transition-colors"
          >
            {confirmLabel}
          </button>
          {extraActions}
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            aria-label="キャンセル"
            className="text-warmgray-400 hover:text-warmgray-600 disabled:opacity-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
