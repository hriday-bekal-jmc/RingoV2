/**
 * RouteTimeline — shared route visualization component.
 * Renders a horizontal timeline with nodes + arrows for any approval route.
 */

interface RouteStep {
  step_order:   number;
  label?:        string;
  approver_name?: string;
  approver_role?: string;
  action_type?:  string;   // 'APPROVE' (default) | 'CONFIRM'
}

interface RouteTimelineProps {
  steps: RouteStep[];
  /** Label for the origin (申) node */
  originLabel?: string;
  /** Label for the terminal (✓) node */
  doneLabel?: string;
  /** Colour accent for approver nodes: 'ringo' (default) or 'teal' */
  accent?: 'ringo' | 'teal';
  /** Show no-steps message */
  emptyMessage?: string;
}

function ArrowIcon() {
  return (
    <div className="flex items-center self-start mt-[22px] shrink-0 px-1">
      <svg className="w-5 h-5 text-surface-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
      </svg>
    </div>
  );
}

function Node({
  label,
  name,
  variant,
  index,
  accent = 'ringo',
  actionType = 'APPROVE',
}: {
  label?: string;
  name: string;
  variant: 'origin' | 'approver' | 'done';
  index?: number;
  accent?: 'ringo' | 'teal';
  actionType?: string;
}) {
  const isOrigin  = variant === 'origin';
  const isDone    = variant === 'done';
  const isConfirm = !isOrigin && !isDone && actionType === 'CONFIRM';

  // Confirm steps use amber/mustard palette regardless of accent prop
  const approverCircle = isConfirm
    ? 'bg-gradient-to-br from-amber-400 to-mustard-500 shadow-[0_3px_12px_rgba(217,153,52,0.38)]'
    : accent === 'teal'
      ? 'bg-gradient-to-br from-teal-400 to-teal-600 shadow-[0_3px_12px_rgba(20,184,166,0.38)]'
      : 'bg-gradient-to-br from-ringo-400 to-ringo-600 shadow-[0_3px_12px_rgba(199,91,71,0.38)]';

  const badgeBg = isConfirm
    ? 'bg-amber-100 text-amber-700 ring-amber-200/60'
    : accent === 'teal'
      ? 'bg-teal-100 text-teal-600 ring-teal-200/60'
      : 'bg-ringo-100 text-ringo-600 ring-ringo-200/60';

  return (
    <div className="relative flex flex-col items-center" style={{ minWidth: 76 }}>
      {/* Step number badge */}
      {!isOrigin && !isDone ? (
        <span className={`mb-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-black ring-1 ${badgeBg}`}>
          {index}
        </span>
      ) : (
        <div className="mb-1.5 h-4" />
      )}

      {/* Circle */}
      <div className={`
        relative z-10 w-9 h-9 rounded-full flex items-center justify-center
        transition-transform duration-150 hover:scale-110
        ${isOrigin
          ? 'bg-white border-2 border-surface-300 text-warmgray-500 shadow-sm'
          : isDone
          ? 'bg-gradient-to-br from-teal-400 to-emerald-500 text-white shadow-[0_3px_12px_rgba(20,184,166,0.40)]'
          : `text-white ${approverCircle}`
        }
      `}>
        {isOrigin ? (
          <span className="text-[11px] font-black text-warmgray-500">申</span>
        ) : isDone ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        ) : isConfirm ? (
          /* Eye icon for CONFIRM steps */
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ) : (
          <span className="text-xs font-bold">{index}</span>
        )}
      </div>

      {/* Name */}
      <span className={`mt-2 text-[10px] font-semibold text-center leading-tight max-w-[72px] ${
        isOrigin ? 'text-warmgray-400' : isDone ? 'text-teal-600' : 'text-warmgray-700'
      }`}>
        {name}
      </span>

      {/* Role sub-label */}
      {label && !isOrigin && !isDone && (
        <span className="text-[9px] text-warmgray-400 text-center leading-tight max-w-[72px] mt-0.5">
          {label}
        </span>
      )}

      {/* CONFIRM type pill */}
      {isConfirm && (
        <span className="mt-1 inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[8px] font-bold ring-1 ring-amber-200/60 leading-none">
          確認
        </span>
      )}
    </div>
  );
}

export default function RouteTimeline({
  steps,
  originLabel = '申請者',
  doneLabel = '完了',
  accent = 'ringo',
  emptyMessage = '承認ステップなし',
}: RouteTimelineProps) {
  if (steps.length === 0) {
    return <p className="text-xs text-ringo-500">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="flex items-start gap-0 min-w-max py-2">
        <Node name={originLabel} variant="origin" />

        {steps.map((step, i) => (
          <div key={step.step_order} className="flex items-start">
            <ArrowIcon />
            <Node
              label={step.label ?? ''}
              name={step.approver_name ?? step.approver_role ?? step.label ?? `Step ${i + 1}`}
              variant="approver"
              index={i + 1}
              accent={accent}
              actionType={step.action_type ?? 'APPROVE'}
            />
          </div>
        ))}

        <ArrowIcon />
        <Node name={doneLabel} variant="done" />
      </div>
    </div>
  );
}
