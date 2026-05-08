// Lock the page scroll while a modal is open.
//
// Why this is needed:
//   Layout.tsx puts the scrollable area on <main className="overflow-y-auto">,
//   NOT the body. So setting `body { overflow: hidden }` does nothing.
//   We have to find the actual scrolling element and lock it.
//
// Why a hook (not just inline useEffect):
//   - Multiple modals can stack (ConfirmDialog inside UserModal flow). Hook
//     uses a counter on a global symbol so we only release when ALL locks
//     are gone — last-out wins.
//   - Restores the original overflow string verbatim, so we don't clobber
//     other code that might want to set it.

import { useEffect } from 'react';

const LOCK_KEY = '__ringoScrollLockCount';

interface LockedWindow extends Window {
  [LOCK_KEY]?: { count: number; prev: string; el: HTMLElement };
}

export function useScrollLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const w = window as unknown as LockedWindow;
    const main = document.querySelector('main') as HTMLElement | null;
    if (!main) return;

    if (!w[LOCK_KEY]) {
      w[LOCK_KEY] = {
        count: 0,
        prev:  main.style.overflow,
        el:    main,
      };
    }
    const lock = w[LOCK_KEY]!;
    lock.count += 1;
    lock.el.style.overflow = 'hidden';

    return () => {
      lock.count -= 1;
      if (lock.count <= 0) {
        lock.el.style.overflow = lock.prev;
        delete w[LOCK_KEY];
      }
    };
  }, [enabled]);
}
