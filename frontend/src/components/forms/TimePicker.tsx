/**
 * TimePicker — custom time picker matching CalendarPicker's design language.
 *
 * Desktop: floating dropdown (absolute, origin-top-left, animate-scale-in)
 * Mobile (<640px): bottom sheet (fixed, full-width, slide-up, backdrop)
 *
 * - Same trigger button style (input class, clock icon, clear × , chevron)
 * - Two scrollable columns: Hours (00–23) + Minutes (step-aware)
 * - Selected row = ringo-500 bg (same as CalendarPicker's selected day)
 * - Auto-scrolls to selected values on open
 * - Footer: "現在時刻 / Now" + "完了 / Done"
 * - iOS momentum scrolling on columns
 * - Touch targets: 44px on mobile, 32px on desktop
 *
 * Value stored/emitted as "HH:mm" string.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { useLang } from '../../context/LanguageContext';

interface TimePickerProps {
  value?: string;      // "HH:mm"
  onChange: (val: string) => void;
  disabled?: boolean;
  minTime?: string;    // "HH:mm" — earliest allowed
  maxTime?: string;    // "HH:mm" — latest allowed
  step?: number;       // minute increment (1|5|10|15|30|60), default 1
}

function parseTime(s?: string): { h: number; m: number } | null {
  if (!s) return null;
  const [hStr, mStr] = s.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

function toHHMM(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDisplay(s: string, lang: 'ja' | 'en'): string {
  const t = parseTime(s);
  if (!t) return s;
  const mm = String(t.m).padStart(2, '0');
  return lang === 'ja' ? `${t.h}時${mm}分` : `${String(t.h).padStart(2, '0')}:${mm}`;
}

function snapToStep(raw: number, steps: number[]): number {
  if (steps.length === 0) return 0;
  return steps.reduce((best, m) =>
    Math.abs(m - raw) < Math.abs(best - raw) ? m : best,
    steps[0],
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function TimePicker({
  value,
  onChange,
  disabled = false,
  minTime,
  maxTime,
  step = 1,
}: TimePickerProps) {
  const { lang } = useLang();
  const parsed = parseTime(value);

  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const containerRef  = useRef<HTMLDivElement>(null);
  const hourColRef    = useRef<HTMLDivElement>(null);
  const minColRef     = useRef<HTMLDivElement>(null);
  const hourBtnRefs   = useRef<Map<number, HTMLButtonElement | null>>(new Map());
  const minBtnRefs    = useRef<Map<number, HTMLButtonElement | null>>(new Map());

  // Detect mobile breakpoint, update on resize
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Step-aware minute list
  const validMinutes = useMemo(() => {
    const s = Math.max(1, Math.min(60, step));
    const out: number[] = [];
    for (let m = 0; m < 60; m += s) out.push(m);
    return out;
  }, [step]);

  // Close on outside click — desktop only (mobile uses backdrop tap)
  useEffect(() => {
    if (!open || isMobile) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open, isMobile]);

  // Prevent body scroll when mobile sheet is open
  useEffect(() => {
    if (!isMobile) return;
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open, isMobile]);

  // Scroll both columns to center the selected item on open
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const scrollToCenter = (col: HTMLDivElement | null, el: HTMLButtonElement | null | undefined) => {
        if (!col || !el) return;
        col.scrollTop = el.offsetTop - col.clientHeight / 2 + el.offsetHeight / 2;
      };
      const selH = parsed?.h ?? 0;
      const selM = parsed?.m ?? validMinutes[0] ?? 0;
      const hEl = hourBtnRefs.current.get(selH) ?? hourBtnRefs.current.get(0);
      const mEl = minBtnRefs.current.get(selM) ?? minBtnRefs.current.get(validMinutes[0] ?? 0);
      scrollToCenter(hourColRef.current, hEl);
      scrollToCenter(minColRef.current, mEl);
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function isMinuteDisabled(h: number, m: number): boolean {
    const v = toHHMM(h, m);
    if (minTime && v < minTime) return true;
    if (maxTime && v > maxTime) return true;
    return false;
  }

  function selectHour(h: number) {
    const currentM = parsed?.m ?? 0;
    const snapped = snapToStep(currentM, validMinutes);
    onChange(toHHMM(h, snapped));
  }

  function selectMinute(m: number) {
    onChange(toHHMM(parsed?.h ?? 0, m));
  }

  function setNow() {
    const now = new Date();
    const snapped = snapToStep(now.getMinutes(), validMinutes);
    onChange(toHHMM(now.getHours(), snapped));
    setOpen(false);
  }

  const currentH = parsed?.h;
  const currentM = parsed?.m;

  // Shared column scroll style (momentum scroll on iOS)
  const colScrollStyle: React.CSSProperties = {
    scrollbarWidth: 'none',
    WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
  };

  // ── Column content (shared between mobile and desktop) ──────────────────────
  const colHeight = isMobile ? 'h-[240px]' : 'h-[196px]';
  const rowPy     = isMobile ? 'py-3' : 'py-[7px]';
  const rowText   = isMobile ? 'text-base' : 'text-sm';

  const hourColumn = (
    <div
      ref={hourColRef}
      className={`overflow-y-auto border-r border-warmgray-100/80 py-1 ${colHeight}`}
      style={colScrollStyle}
    >
      {HOURS.map((h) => {
        const isSelected = currentH === h;
        return (
          <button
            key={h}
            type="button"
            ref={(el) => hourBtnRefs.current.set(h, el)}
            onClick={() => selectHour(h)}
            className={`w-full ${rowPy} ${rowText} text-center font-medium
              transition-colors duration-100 select-none
              ${isSelected
                ? 'bg-ringo-500 text-white font-bold shadow-[0_1px_4px_rgba(154,46,34,0.32)]'
                : 'text-warmgray-700 hover:bg-ringo-50 hover:text-ringo-600 active:bg-ringo-100'
              }`}
          >
            {String(h).padStart(2, '0')}
          </button>
        );
      })}
    </div>
  );

  const minuteColumn = (
    <div
      ref={minColRef}
      className={`overflow-y-auto py-1 ${colHeight}`}
      style={colScrollStyle}
    >
      {validMinutes.map((m) => {
        const isSelected = currentM === m;
        const isDisabled = currentH !== undefined && isMinuteDisabled(currentH, m);
        return (
          <button
            key={m}
            type="button"
            ref={(el) => minBtnRefs.current.set(m, el)}
            disabled={isDisabled}
            onClick={() => !isDisabled && selectMinute(m)}
            className={`w-full ${rowPy} ${rowText} text-center font-medium
              transition-colors duration-100 select-none
              ${isSelected
                ? 'bg-ringo-500 text-white font-bold shadow-[0_1px_4px_rgba(154,46,34,0.32)]'
                : isDisabled
                ? 'text-warmgray-300 cursor-not-allowed'
                : 'text-warmgray-700 hover:bg-ringo-50 hover:text-ringo-600 active:bg-ringo-100'
              }`}
          >
            {String(m).padStart(2, '0')}
          </button>
        );
      })}
    </div>
  );

  const columnHeaders = (
    <div className="grid grid-cols-2 bg-warmgray-50/70 border-b border-warmgray-100/80">
      <div className="py-2.5 text-center text-[10px] font-bold uppercase tracking-widest text-warmgray-500 border-r border-warmgray-100/80">
        {lang === 'en' ? 'Hour' : '時'}
      </div>
      <div className="py-2.5 text-center text-[10px] font-bold uppercase tracking-widest text-warmgray-500">
        {lang === 'en' ? 'Min' : '分'}
      </div>
    </div>
  );

  const footer = (
    <div className="border-t border-warmgray-100/80 bg-warmgray-50/40 px-3 py-2.5 flex justify-between items-center"
      style={{ paddingBottom: isMobile ? 'max(0.75rem, env(safe-area-inset-bottom))' : undefined }}>
      <button
        type="button"
        onClick={setNow}
        className="text-[11px] font-semibold text-ringo-500 hover:text-ringo-600 transition-colors px-1 py-1"
      >
        {lang === 'en' ? 'Now' : '現在時刻'}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className={`font-bold text-warmgray-600 hover:text-warmgray-800
          bg-warmgray-100/80 hover:bg-warmgray-200/80
          px-4 rounded-lg transition-colors
          ${isMobile ? 'text-sm py-2' : 'text-[11px] py-1'}`}
      >
        {lang === 'en' ? 'Done' : '完了'}
      </button>
    </div>
  );

  return (
    <div ref={containerRef} className={`relative ${open ? 'dropdown-open' : ''}`}>

      {/* ── Trigger ───────────────────────────────────────────────────────────── */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={`input flex items-center gap-2 text-left transition-all duration-150 ${
          open
            ? 'ring-2 ring-ringo-400/40 border-ringo-300 bg-white shadow-[0_0_0_3px_rgba(199,91,71,0.10)]'
            : 'hover:border-warmgray-300 hover:bg-white/90'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <svg
          className={`w-4 h-4 shrink-0 transition-colors ${value ? 'text-ringo-500' : 'text-warmgray-400'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}
        >
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>

        <span className={`flex-1 text-sm ${value ? 'text-warmgray-800 font-medium' : 'text-warmgray-400'}`}>
          {value ? formatDisplay(value, lang) : (lang === 'en' ? 'Select time' : '時刻を選択')}
        </span>

        {value && !disabled && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onChange(''); } }}
            className="p-0.5 rounded-full text-warmgray-400 hover:text-warmgray-700 hover:bg-surface-200/60 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </span>
        )}

        <svg
          className={`w-4 h-4 text-warmgray-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* ── Mobile: backdrop ──────────────────────────────────────────────────── */}
      {open && isMobile && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] animate-fade-in"
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Mobile: bottom sheet ──────────────────────────────────────────────── */}
      {open && isMobile && (
        <div className="fixed inset-x-0 bottom-0 z-50
          bg-white/97 backdrop-blur-2xl
          rounded-t-3xl border-t border-warmgray-200/60
          shadow-[0_-8px_40px_rgba(60,40,20,0.18)]
          overflow-hidden animate-slide-up">

          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-0.5">
            <div className="w-10 h-1 rounded-full bg-warmgray-300" />
          </div>

          {/* Title bar */}
          <div className="px-5 py-3 flex items-center justify-between">
            <span className="text-sm font-bold text-warmgray-800">
              {lang === 'en' ? 'Select time' : '時刻を選択'}
            </span>
            {/* Current selection preview */}
            {value && (
              <span className="text-sm font-bold text-ringo-500 tabular-nums">
                {formatDisplay(value, lang)}
              </span>
            )}
          </div>

          {columnHeaders}

          <div className="grid grid-cols-2">
            {hourColumn}
            {minuteColumn}
          </div>

          {footer}
        </div>
      )}

      {/* ── Desktop: floating dropdown ────────────────────────────────────────── */}
      {open && !isMobile && (
        <div className="absolute z-50 mt-1.5 left-0 w-52
          bg-white/90 backdrop-blur-2xl border border-warmgray-200/60
          rounded-2xl shadow-[0_8px_28px_rgba(60,40,20,0.16),0_2px_8px_rgba(60,40,20,0.08)]
          overflow-hidden animate-scale-in origin-top-left">

          {columnHeaders}

          <div className="grid grid-cols-2">
            {hourColumn}
            {minuteColumn}
          </div>

          {footer}
        </div>
      )}
    </div>
  );
}
