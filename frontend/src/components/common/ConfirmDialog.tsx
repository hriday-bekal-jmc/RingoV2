interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmClass?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra actions rendered between Cancel and Confirm (e.g. soft-delete) */
  extraActions?: React.ReactNode;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = '確認',
  confirmClass = 'btn-danger',
  cancelLabel = 'キャンセル',
  onConfirm,
  onCancel,
  extraActions,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-warmgray-900/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative glass rounded-3xl shadow-2xl w-full max-w-sm p-7 space-y-5 animate-scale-in">
        {/* Icon + title */}
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-2xl bg-red-100 flex items-center justify-center text-xl shrink-0">
            ⚠️
          </div>
          <div>
            <h3 className="text-base font-bold text-warmgray-800">{title}</h3>
            <p className="text-sm text-warmgray-500 mt-1 leading-relaxed">{message}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pt-1">
          <button className={confirmClass} onClick={onConfirm}>
            {confirmLabel}
          </button>
          {extraActions}
          <button className="btn-ghost text-warmgray-500" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
