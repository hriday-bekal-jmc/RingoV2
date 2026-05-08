// Inline confirmation pattern for row-level destructive actions.
//
// Why this exists:
//   Modal/popover dialogs for "delete this row" feel out of place — they
//   pull the user's eye away from the row, require backdrop dimming, and
//   need scroll/positioning math. For admin row actions where the user is
//   already intentional, inline confirmation is faster and cleaner.
//
// Pattern (used by GitHub, Linear, Notion):
//   Default state:    [削除]
//   Active state:     ⚠️ 削除? [削除する] [×]
//
// State management:
//   Caller stores a single `confirmingId: string | null` and compares
//   against each row's id. Only one row can be in confirm state at a time.
//
// Usage:
//   <InlineConfirm
//     isActive={confirmingId === row.id}
//     onTrigger={() => setConfirmingId(row.id)}
//     onConfirm={() => { mutate(row.id); setConfirmingId(null); }}
//     onCancel={() => setConfirmingId(null)}
//     message="ルートを削除"
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

  if (!isActive) {
    return (
      <button
        type="button"
        className={triggerClass}
        onClick={onTrigger}
        disabled={disabled}
      >
        {triggerLabel}
      </button>
    );
  }

  return (
    <div
      ref={rootRef}
      className="inline-flex items-center gap-1.5 animate-fade-up"
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
  );
}
