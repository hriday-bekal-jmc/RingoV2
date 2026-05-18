import { useState, useRef, useEffect } from 'react';
import { useLang } from '../../context/LanguageContext';

interface SelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function CustomSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  className = '',
}: CustomSelectProps) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const effectivePlaceholder = placeholder ?? t('select_placeholder');
  const selectedLabel = options.find(o => o.value === value)?.label;

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

  function select(v: string) {
    onChange(v);
    setOpen(false);
  }

  return (
    // dropdown-open sentinel: CSS :has(.dropdown-open) elevates the parent card's
    // stacking context above sibling cards when this dropdown is open.
    <div ref={containerRef} className={`relative ${open ? 'dropdown-open' : ''} ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={`input flex items-center gap-2 text-left w-full transition-all duration-150 ${
          open ? 'ring-2 ring-ringo-400/40 border-ringo-300 bg-white shadow-[0_0_0_3px_rgba(199,91,71,0.10)]' : 'hover:border-warmgray-300 hover:bg-white/90'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={`flex-1 text-sm truncate ${value ? 'text-warmgray-800 font-medium' : 'text-warmgray-400'}`}>
          {selectedLabel ?? effectivePlaceholder}
        </span>

        <svg
          className={`w-4 h-4 text-warmgray-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180 text-ringo-500' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1.5 left-0 right-0
          bg-white/85 backdrop-blur-2xl border border-warmgray-200/60
          rounded-xl shadow-[0_8px_28px_rgba(60,40,20,0.16),0_2px_8px_rgba(60,40,20,0.08)]
          py-1 animate-scale-in origin-top overflow-hidden">
          <div className="max-h-52 overflow-y-auto overscroll-contain dropdown-scroll">
            {options.length === 0 && (
              <div className="px-3.5 py-3 text-sm text-warmgray-500 text-center">
                {t('select_empty')}
              </div>
            )}

            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => select(opt.value)}
                  className={`
                    w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-left
                    transition-colors duration-100
                    ${isSelected
                      ? 'bg-ringo-50/80 text-ringo-700 font-semibold'
                      : 'text-warmgray-800 hover:bg-white/60 hover:text-warmgray-900'
                    }
                  `}
                >
                  {/* Check mark for selected */}
                  <span className={`w-4 h-4 shrink-0 flex items-center justify-center transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0'}`}>
                    <svg className="w-3.5 h-3.5 text-ringo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </span>

                  <span className="flex-1 truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
