import { useState, useRef, useEffect } from 'react';
import { useLang } from '../../context/LanguageContext';

interface CalendarPickerProps {
  value?: string;           // "YYYY-MM-DD"
  onChange: (val: string) => void;
  disabled?: boolean;
  required?: boolean;
}

const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
const DAYS_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function firstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}
function parseDate(s?: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function formatDisplay(s?: string) {
  if (!s) return null;
  const d = parseDate(s);
  if (!d) return null;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}年${m}月${day}日`;
}

export default function CalendarPicker({
  value,
  onChange,
  disabled = false,
}: CalendarPickerProps) {
  const { t, lang } = useLang();
  const today = new Date();
  const selected = parseDate(value);

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(selected?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected?.getMonth() ?? today.getMonth());

  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // When value changes externally, sync view
  useEffect(() => {
    if (selected) {
      setViewYear(selected.getFullYear());
      setViewMonth(selected.getMonth());
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }
  function selectDay(day: number) {
    const d = new Date(viewYear, viewMonth, day);
    onChange(toISO(d));
    setOpen(false);
  }
  function clearDate(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
  }

  const totalDays = daysInMonth(viewYear, viewMonth);
  const firstDay = firstDayOfMonth(viewYear, viewMonth);

  // Build grid cells
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    // dropdown-open sentinel: CSS :has(.dropdown-open) elevates the parent card's
    // stacking context above sibling cards when the calendar is open.
    <div ref={containerRef} className={`relative ${open ? 'dropdown-open' : ''}`}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={`input flex items-center gap-2 text-left transition-all duration-150 ${
          open ? 'ring-2 ring-ringo-400/40 border-ringo-300 bg-white shadow-[0_0_0_3px_rgba(199,91,71,0.10)]' : 'hover:border-warmgray-300 hover:bg-white/90'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {/* Calendar icon */}
        <svg className={`w-4 h-4 shrink-0 transition-colors ${value ? 'text-ringo-500' : 'text-warmgray-400'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>

        <span className={`flex-1 text-sm ${value ? 'text-warmgray-800 font-medium' : 'text-warmgray-400'}`}>
          {formatDisplay(value) ?? t('date_placeholder')}
        </span>

        {/* Clear button */}
        {value && !disabled && (
          <span
            role="button"
            tabIndex={0}
            onClick={clearDate}
            onKeyDown={(e) => e.key === 'Enter' && clearDate(e as never)}
            className="p-0.5 rounded-full text-warmgray-400 hover:text-warmgray-700 hover:bg-surface-200/60 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </span>
        )}

        {/* Chevron */}
        <svg className={`w-4 h-4 text-warmgray-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown calendar */}
      {open && (
        <div className="absolute z-50 mt-1.5 left-0 w-[280px]
          bg-white/85 backdrop-blur-2xl border border-warmgray-200/60
          rounded-2xl shadow-[0_8px_28px_rgba(60,40,20,0.16),0_2px_8px_rgba(60,40,20,0.08)]
          p-3 animate-scale-in origin-top-left">

          {/* Month navigation */}
          <div className="flex items-center justify-between mb-3 px-1">
            <button type="button" onClick={prevMonth}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-warmgray-500
                hover:bg-ringo-50 hover:text-ringo-600 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <span className="text-sm font-bold text-warmgray-900 tracking-wide">
              {lang === 'en'
                ? `${new Date(viewYear, viewMonth).toLocaleString('en-US', { month: 'long' })} ${viewYear}`
                : `${viewYear}年${viewMonth + 1}月`}
            </span>

            <button type="button" onClick={nextMonth}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-warmgray-500
                hover:bg-ringo-50 hover:text-ringo-600 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-1">
            {(lang === 'en' ? DAYS_EN : DAYS_JA).map((d, i) => (
              <div key={d} className={`text-center text-[10px] font-bold pb-1.5 ${
                i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-warmgray-500'
              }`}>
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, idx) => {
              if (!day) return <div key={`empty-${idx}`} />;

              const thisDate = new Date(viewYear, viewMonth, day);
              const isSelected = selected && toISO(thisDate) === toISO(selected);
              const isToday = toISO(thisDate) === toISO(today);
              const dow = thisDate.getDay();

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => selectDay(day)}
                  className={`
                    w-full aspect-square rounded-lg text-xs font-medium
                    flex items-center justify-center
                    transition-all duration-100
                    ${isSelected
                      ? 'bg-ringo-500 text-white shadow-[0_2px_8px_rgba(199,91,71,0.40)] font-bold scale-105'
                      : isToday
                      ? 'ring-2 ring-ringo-200 text-ringo-600 font-semibold hover:bg-ringo-50'
                      : dow === 0
                      ? 'text-red-500 hover:bg-red-50'
                      : dow === 6
                      ? 'text-blue-500 hover:bg-blue-50'
                      : 'text-warmgray-800 hover:bg-warmgray-100'
                    }
                  `}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Today shortcut */}
          <div className="mt-3 pt-2.5 border-t border-surface-200/60 flex justify-between items-center">
            <button
              type="button"
              onClick={() => { onChange(toISO(today)); setOpen(false); }}
              className="text-[11px] font-semibold text-ringo-500 hover:text-ringo-600 transition-colors px-1"
            >
              {t('date_today')}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                className="text-[11px] text-warmgray-400 hover:text-warmgray-600 transition-colors px-1"
              >
                {t('date_clear')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
