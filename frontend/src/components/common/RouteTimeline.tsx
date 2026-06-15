/**
 * RouteTimeline — shared route visualization component.
 * Renders a horizontal timeline with nodes + arrows for any approval route.
 * For routes > COLLAPSE_AFTER steps, collapses the middle with an expand toggle.
 */

import { useState } from 'react';
import UserAvatar from './UserAvatar';

const COLLAPSE_AFTER = 5; // show this many steps before collapsing

interface RouteStep {
  step_order:      number;
  label?:          string;
  approver_name?:  string;
  approver_role?:  string;
  approver_avatar?: string | null;
  action_type?:    string;   // 'APPROVE' (default) | 'CONFIRM'
}

interface RouteTimelineProps {
  steps: RouteStep[];
  /** 1-based index of the currently active step (highlights that node) */
  currentStep?: number;
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
  avatarUrl,
  variant,
  index,
  accent = 'ringo',
  actionType = 'APPROVE',
  isCurrent = false,
  isDone: isCompleted = false,
}: {
  label?: string;
  name: string;
  avatarUrl?: string | null;
  variant: 'origin' | 'approver' | 'done';
  index?: number;
  accent?: 'ringo' | 'teal';
  actionType?: string;
  isCurrent?: boolean;
  isDone?: boolean;
}) {
  const isOrigin  = variant === 'origin';
  const isDoneNode = variant === 'done';
  const isConfirm = !isOrigin && !isDoneNode && actionType === 'CONFIRM';

  const badgeBg = isConfirm
    ? 'bg-amber-100 text-amber-700 ring-amber-200/60'
    : accent === 'teal'
      ? 'bg-teal-100 text-teal-600 ring-teal-200/60'
      : 'bg-ringo-100 text-ringo-600 ring-ringo-200/60';

  return (
    <div className="relative flex flex-col items-center" style={{ minWidth: 76 }}>
      {/* Step number badge */}
      {!isOrigin && !isDoneNode ? (
        <span className={`mb-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-black ring-1 ${badgeBg}`}>
          {index}
        </span>
      ) : (
        <div className="mb-1.5 h-4" />
      )}

      {/* Circle — avatar for approver nodes, icon for origin/done */}
      <div className={`relative z-10 transition-transform duration-150 hover:scale-110 ${isCurrent ? 'scale-110' : ''}`}>
        {isOrigin ? (
          <div className="w-9 h-9 rounded-full bg-white border-2 border-surface-300 flex items-center justify-center shadow-sm">
            <span className="text-[11px] font-black text-warmgray-500">申</span>
          </div>
        ) : isDoneNode ? (
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center text-white shadow-[0_3px_12px_rgba(20,184,166,0.40)]">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
        ) : (
          <div className="relative">
            <UserAvatar
              name={name}
              avatarUrl={avatarUrl}
              size={9}
              ring={
                isCurrent
                  ? 'ring-2 ring-offset-1 ring-ringo-500'
                  : isCompleted
                    ? 'ring-2 ring-emerald-400/70'
                    : isConfirm
                      ? 'ring-2 ring-amber-300/70'
                      : accent === 'teal'
                        ? 'ring-2 ring-teal-300/70'
                        : 'ring-2 ring-ringo-300/70'
              }
              className={`shadow-[0_3px_10px_rgba(0,0,0,0.15)] ${isCompleted ? 'opacity-60' : ''}`}
            />
            {/* Current step pulse ring */}
            {isCurrent && (
              <span className="absolute inset-0 rounded-full animate-ping opacity-30 bg-ringo-400" />
            )}
            {/* Done checkmark overlay */}
            {isCompleted && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 flex items-center justify-center ring-1 ring-white">
                <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </span>
            )}
            {/* CONFIRM eye overlay */}
            {isConfirm && !isCompleted && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-amber-400 flex items-center justify-center ring-1 ring-white">
                <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Name */}
      <span className={`mt-2 text-[10px] font-semibold text-center leading-tight max-w-[72px] ${
        isOrigin ? 'text-warmgray-400' : isDoneNode ? 'text-teal-600' : isCurrent ? 'text-ringo-600' : 'text-warmgray-700'
      }`}>
        {name}
      </span>

      {/* Role sub-label */}
      {label && !isOrigin && !isDoneNode && (
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

      {/* Current step indicator */}
      {isCurrent && (
        <span className="mt-1 inline-flex items-center px-1.5 py-0.5 rounded-full bg-ringo-100 text-ringo-700 text-[8px] font-bold ring-1 ring-ringo-200/60 leading-none">
          ▶ 現在
        </span>
      )}
    </div>
  );
}

/** Collapsed middle placeholder showing how many steps are hidden */
function CollapsedSteps({ count, onExpand }: { count: number; onExpand: () => void }) {
  return (
    <div className="flex items-start">
      <ArrowIcon />
      <button
        onClick={onExpand}
        className="flex flex-col items-center mt-[22px] px-2 group"
        title={`${count}ステップ表示`}
      >
        <div className="flex gap-1 items-center">
          {[0, 1, 2].map(i => (
            <span key={i} className="w-1.5 h-1.5 rounded-full bg-surface-300 group-hover:bg-ringo-300 transition-colors" />
          ))}
        </div>
        <span className="mt-1.5 text-[9px] text-warmgray-400 group-hover:text-ringo-500 font-semibold transition-colors whitespace-nowrap">
          +{count}ステップ
        </span>
      </button>
    </div>
  );
}

export default function RouteTimeline({
  steps,
  currentStep,
  originLabel = '申請者',
  doneLabel = '完了',
  accent = 'ringo',
  emptyMessage = '承認ステップなし',
}: RouteTimelineProps) {
  const [expanded, setExpanded] = useState(false);

  if (steps.length === 0) {
    return <p className="text-xs text-ringo-500">{emptyMessage}</p>;
  }

  const shouldCollapse = !expanded && steps.length > COLLAPSE_AFTER;
  // When collapsed: show first 3, collapse middle, show last 1
  const HEAD = 3;
  const visibleSteps = shouldCollapse
    ? [...steps.slice(0, HEAD), ...steps.slice(-1)]
    : steps;
  const hiddenCount = shouldCollapse ? steps.length - HEAD - 1 : 0;

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="flex items-start gap-0 min-w-max py-2">
        <Node name={originLabel} variant="origin" />

        {visibleSteps.map((step, i) => {
          const realIndex = shouldCollapse && i >= HEAD ? steps.length : i + 1;
          const isStepCurrent = currentStep !== undefined && step.step_order === currentStep;
          const isStepDone    = currentStep !== undefined && step.step_order < currentStep;

          return (
            <div key={step.step_order} className="flex items-start">
              {/* Inject collapsed placeholder before last step when collapsed */}
              {shouldCollapse && i === HEAD && hiddenCount > 0 && (
                <CollapsedSteps count={hiddenCount} onExpand={() => setExpanded(true)} />
              )}
              <ArrowIcon />
              <Node
                label={step.label ?? ''}
                name={step.approver_name ?? step.approver_role ?? step.label ?? `Step ${realIndex}`}
                avatarUrl={step.approver_avatar}
                variant="approver"
                index={realIndex}
                accent={accent}
                actionType={step.action_type ?? 'APPROVE'}
                isCurrent={isStepCurrent}
                isDone={isStepDone}
              />
            </div>
          );
        })}

        <ArrowIcon />
        <Node name={doneLabel} variant="done" />
      </div>

      {/* Expand / collapse controls */}
      {steps.length > COLLAPSE_AFTER && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-1 text-[10px] text-ringo-400 hover:text-ringo-600 font-semibold transition-colors"
        >
          {expanded ? `▲ 折りたたむ` : `▼ すべて表示 (${steps.length}ステップ)`}
        </button>
      )}
    </div>
  );
}
