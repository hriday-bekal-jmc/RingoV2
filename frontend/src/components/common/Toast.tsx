import { useState, useCallback, useRef } from 'react';

export interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastProps extends ToastState {
  onDismiss?: () => void;
}

const ICONS = { success: '✓', error: '✕', info: 'ℹ' };
const COLORS = {
  success: 'bg-emerald-500 text-white',
  error:   'bg-ringo-500 text-white',
  info:    'bg-warmgray-800 text-white',
};

export default function Toast({ message, type, onDismiss }: ToastProps) {
  return (
    <div
      className={`fixed top-6 right-6 z-[70] animate-scale-in flex items-center gap-3
        px-5 py-3.5 rounded-2xl shadow-xl text-sm font-semibold max-w-sm cursor-pointer
        ${COLORS[type]}`}
      onClick={onDismiss}
    >
      <span className="text-base leading-none">{ICONS[type]}</span>
      <span>{message}</span>
    </div>
  );
}

/** Reusable toast hook */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, type: ToastState['type'] = 'success', ms = 3500) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, type });
    timerRef.current = setTimeout(() => setToast(null), ms);
  }, []);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  return { toast, show, dismiss };
}
