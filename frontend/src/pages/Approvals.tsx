import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useScrollEnd } from '../hooks/useScrollEnd';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import Toast, { useToast } from '../components/common/Toast';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { useLang } from '../context/LanguageContext';
import PatternBadge from '../components/common/PatternBadge';
import { useAuth } from '../context/AuthContext';
import RingoLoader from '../components/common/RingoLoader';
import { Sk } from '../components/common/Skeleton';
import RepeatGroupDisplay from '../components/forms/RepeatGroupDisplay';
import TransportationDetail from '../components/forms/TransportationDetail';
import { FieldValueContent, isLongField } from '../components/forms/FieldValueDisplay';
import CollapsibleComment from '../components/common/CollapsibleComment';
import UserAvatar from '../components/common/UserAvatar';

// File URLs are same-origin (vite proxy /api in dev, reverse proxy in prod)

// ── Types ─────────────────────────────────────────────────────────────────────
interface FormField {
  name: string;
  label: string;
  label_en?: string | null;
  type: string;
  required?: boolean;
  fields?: FormField[];
}

interface RowTextPreview { label: string; label_en: string; value: string }
interface RowNumberPreview {
  label: string; label_en: string; value: number | null;
  compare_label?: string; compare_label_en?: string; compare_value?: number | null;
  is_different: boolean;
}
interface RowPreview { text: RowTextPreview | null; numbers: RowNumberPreview[] }

interface Application {
  id: string;
  application_number: string | null;
  status: string;
  row_preview?: RowPreview | null;
  created_at: string;
  template_name: string;
  pattern_id?: number;
  applicant_name?: string;
  applicant_avatar?: string | null;
  department_name?: string;
  current_step_id: string;
  current_step: number;
  current_stage?: string;
  total_steps: number;
  current_step_label?: string;
  current_step_action?: string;
  current_approver_name?: string;
  current_approver_avatar?: string | null;
}

// ── Step progress bar ─────────────────────────────────────────────────────────
function StepBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round(((current - 1) / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {Array.from({ length: Number(total) }).map((_, i) => {
          const n = i + 1;
          return (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                n < current ? 'bg-emerald-500 text-white' :
                n === current ? 'bg-ringo-500 text-white ring-2 ring-ringo-200' :
                'bg-surface-200 text-warmgray-400'
              }`}>
                {n < current ? '✓' : n}
              </div>
              {i < Number(total) - 1 && (
                <div className={`h-0.5 w-6 rounded-full ${n < current ? 'bg-emerald-400' : 'bg-surface-200'}`} />
              )}
            </div>
          );
        })}
        <span className="text-xs text-warmgray-400 ml-1 font-medium">({current}/{total})</span>
      </div>
      <div className="h-1 bg-surface-100 rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-ringo-400 to-mustard-400 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Detect file upload values — works even when schema type isn't set to 'file' */
function isFileValue(v: unknown): boolean {
  if (typeof v !== 'string' || !v) return false;
  return v.split(',').some((s) => s.trim().startsWith('/api/files/'));
}

function renderFileLinks(val: unknown, attachLabel: string) {
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {String(val).split(',').filter(Boolean).map((url, i) => (
        <a key={i} href={url.trim()} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-ringo-600 hover:text-ringo-700 bg-ringo-50/60 border border-ringo-200/60 px-2.5 py-1 rounded-lg font-medium transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
          {attachLabel} {i + 1}
        </a>
      ))}
    </div>
  );
}

// ── Form data viewer ──────────────────────────────────────────────────────────
function FormDataViewer({ formData, schema, tFn }: {
  formData: Record<string, unknown>;
  schema: { fields: FormField[] } | null;
  tFn: (k: any) => string;
}) {
  const fields = schema?.fields ?? [];

  if (fields.length === 0) {
    return (
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        {Object.entries(formData).map(([k, v]) => {
          if (v == null || v === '') return null;
          // Attempt JSON parse — catches user_picker arrays stored as JSON strings
          let display: unknown = v;
          if (typeof v === 'string') {
            const trimmed = v.trim();
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
              try { display = JSON.parse(trimmed); } catch { /* keep as string */ }
            }
          }
          const isArray = Array.isArray(display);
          // If it's an array of objects with a "name" field → user list
          const isUserList = isArray && (display as any[]).every((x: any) => x && typeof x === 'object' && 'name' in x);
          const strVal = isUserList ? '' : String(v ?? '');
          const isLong = isUserList || strVal.length > 40;
          return (
            <div key={k} className={isLong ? 'col-span-full' : ''}>
              <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-0.5">{k}</dt>
              <dd className="text-sm text-warmgray-800 break-words">
                {isFileValue(v) ? renderFileLinks(v, tFn('attach_label'))
                  : isUserList ? (
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                      {(display as any[]).map((u: any, i: number) => (
                        <span key={i} className="inline-flex items-center gap-1.5 bg-violet-50 border border-violet-200/60 rounded-full px-2.5 py-0.5 text-xs font-medium text-violet-800">
                          {u.avatar_url
                            ? <img src={u.avatar_url} alt={u.name} className="w-4 h-4 rounded-full object-cover" />
                            : <span className="w-4 h-4 rounded-full bg-violet-200 text-violet-700 font-bold text-[9px] flex items-center justify-center">{String(u.name).slice(0,2).toUpperCase()}</span>
                          }
                          {u.name}
                        </span>
                      ))}
                    </div>
                  ) : (strVal || '—')}
              </dd>
            </div>
          );
        })}
      </dl>
    );
  }

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
      {fields.map((f) => {
        const val = formData[f.name];
        const isLong = isLongField(f, val);
        return (
          <div key={f.name} className={isLong ? 'col-span-full' : ''}>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-0.5">{f.label}</dt>
            <dd className="text-sm text-warmgray-800 break-words">
              <FieldValueContent
                field={f}
                value={val}
                renderRepeat={(field, value) => <RepeatGroupDisplay field={field} value={value} compact />}
              />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

// ── Full application detail panel (opened from DetailModal) ──────────────────
interface AppDetailData {
  id: string;
  application_number: string | null;
  status: string;
  has_settlement?: boolean;
  form_data: Record<string, unknown>;
  settlement_data?: Record<string, unknown> | null;
  schema_definition: { fields: FormField[] } | null;
  settlement_schema?: { fields: FormField[] } | null;
  template_name: string;
  applicant_name: string;
  applicant_avatar?: string | null;
  created_at: string;
  pattern_id?: number | null;
  component_type?: string | null;
  applicant_daily_rate?: number | null;
  transfer_date?: string | null;
  transfer_proof_url?: string | null;
  accounting_note?: string | null;
  steps: Array<{
    step_order: number;
    stage: string;
    status: string;
    label: string;
    comment: string | null;
    acted_at: string | null;
    approver_name: string | null;
  }>;
}

const STATUS_BADGE_PANEL: Record<string, string> = {
  PENDING_APPROVAL:   'badge-pending',
  APPROVED:           'badge-approved',
  REJECTED:           'badge-rejected',
  RETURNED:           'badge-returned',
  DRAFT:              'badge-draft',
  CANCELLED:          'badge-draft',
  COMPLETED:          'badge-approved',
  PENDING_SETTLEMENT: 'badge-mustard',
  SETTLEMENT_APPROVED:'badge-approved',
};

function AppDetailPanel({ appId, onClose, tFn, lang }: {
  appId: string;
  onClose: () => void;
  tFn: (k: any) => string;
  lang: string;
}) {
  const dateLocale = lang === 'en' ? 'en-US' : 'ja-JP';
  const { data, isLoading, isError } = useQuery<AppDetailData>({
    queryKey: ['appDetail', appId],
    queryFn: async () => (await apiClient.get(`/applications/${appId}`)).data,
    staleTime: 60_000,
  });

  // Timeline step dot colour
  const stepDotCls = (status: string) =>
    `absolute -left-[11px] top-0 w-5 h-5 rounded-full border-4 border-white/60 shadow-sm ${
      status === 'APPROVED'            ? 'bg-emerald-500' :
      status === 'REJECTED'            ? 'bg-ringo-500'   :
      status === 'RETURNED'            ? 'bg-amber-500'   :
      status === 'PENDING'             ? 'bg-mustard-500 ring-2 ring-mustard-300 animate-pulse' :
      'bg-warmgray-300'
    }`;

  const renderTimelineStep = (step: AppDetailData['steps'][number], i: number) => (
    <div key={`${step.stage}-${step.step_order}-${i}`} className="relative pl-6">
      <div className={stepDotCls(step.status)} />
      <div className="-mt-1">
        <p className="font-bold text-sm text-warmgray-800 leading-snug">{step.label || `ステップ${step.step_order}`}</p>
        <p className="text-xs text-warmgray-500 mt-0.5">{step.approver_name || tFn('detail_unassigned')}</p>
        {step.acted_at && (
          <p className="text-[10px] text-warmgray-400 mt-0.5">
            {new Date(step.acted_at).toLocaleString(dateLocale)}
          </p>
        )}
        {step.comment && (
          <div className={`mt-2 text-xs px-2.5 py-2 rounded-lg min-w-0 overflow-hidden ${
            step.status === 'RETURNED'
              ? 'bg-amber-50 border border-amber-200 text-amber-800'
              : 'bg-white/60 border border-white/80 text-warmgray-700'
          }`}>
            <span className="font-bold">{tFn('detail_comment')}:</span>
            <CollapsibleComment text={step.comment} className="mt-0.5" />
          </div>
        )}
      </div>
    </div>
  );

  // Styled field box (matches ApplicationDetail.tsx)
  const renderFields = (formData: Record<string, unknown>, schema: { fields: FormField[] } | null | undefined) => {
    const fields = schema?.fields ?? [];
    if (fields.length === 0) {
      return (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          {Object.entries(formData).map(([k, v]) => {
            const strVal = String(v ?? '');
            return (
              <div key={k} className={strVal.length > 40 ? 'col-span-full' : ''}>
                <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-1">{k}</dt>
                <dd className="text-sm font-medium text-warmgray-800 bg-white/60 border border-white/80 px-3 py-2.5 rounded-xl break-words min-h-[38px]">
                  {isFileValue(v) ? renderFileLinks(v, tFn('attach_label')) : (strVal || <span className="text-warmgray-300">—</span>)}
                </dd>
              </div>
            );
          })}
        </dl>
      );
    }
    return (
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        {fields.map((f) => {
          const val = formData[f.name];
          const isLong = isLongField(f, val);
          return (
            <div key={f.name} className={isLong ? 'col-span-full' : ''}>
              <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-1">{f.label}</dt>
              <dd className="text-sm font-medium text-warmgray-800 bg-white/60 border border-white/80 px-3 py-2.5 rounded-xl break-words min-h-[38px]">
                <FieldValueContent
                  field={f}
                  value={val}
                  renderRepeat={(field, value) => <RepeatGroupDisplay field={field} value={value} compact />}
                />
              </dd>
            </div>
          );
        })}
      </dl>
    );
  };

  // Portal to body so backdrop-filter on parent glass doesn't trap the
  // modal's `fixed inset-0` inside a containing block (would cause cutoff).
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 md:p-4">
      <div className="absolute inset-0 bg-warmgray-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass rounded-none md:rounded-3xl shadow-2xl w-full max-w-4xl max-h-[100dvh] md:max-h-[90vh] flex flex-col animate-scale-in overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-white/30 shrink-0 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-ringo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
            </svg>
            <span className="text-sm font-bold text-warmgray-800">{lang === 'en' ? 'Application Detail' : '申請詳細'}</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-xl bg-surface-100/80 hover:bg-surface-200/80 flex items-center justify-center text-warmgray-400 hover:text-warmgray-800 transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {isLoading && <RingoLoader.Block label={tFn('loading')} />}
          {isError && (
            <div className="p-6 text-sm text-ringo-500 text-center">{tFn('approvals_error_msg')}</div>
          )}
          {data && (() => {
            const ringiSteps  = data.steps.filter(s => (s.stage === 'RINGI' || !s.stage) && s.status !== 'CANCELLED');
            const settleSteps = data.steps.filter(s => s.stage === 'SETTLEMENT' && s.status !== 'CANCELLED');
            const hasSettlement = data.has_settlement || settleSteps.length > 0;
            const hasSettlementData = data.settlement_data && Object.keys(data.settlement_data).length > 0;
            const statusLabel: Record<string, string> = {
              PENDING_APPROVAL: tFn('status_pending'), APPROVED: tFn('status_approved'),
              REJECTED: tFn('status_rejected'), RETURNED: tFn('status_returned'),
              DRAFT: tFn('status_draft'), COMPLETED: tFn('status_completed'),
              PENDING_SETTLEMENT: tFn('status_pending_settle'), SETTLEMENT_APPROVED: tFn('status_settle_approved'),
            };

            return (
              <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">

                {/* ── Left: meta + content ── */}
                <div className="lg:col-span-2 space-y-5">

                  {/* Meta card */}
                  <div className="card space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-white/40 pb-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={STATUS_BADGE_PANEL[data.status] ?? 'badge-draft'}>
                            {statusLabel[data.status] ?? data.status}
                          </span>
                          <PatternBadge patternId={data.pattern_id ?? undefined} size="sm" />
                        </div>
                        <h3 className="text-xl font-bold text-warmgray-800 mt-2 leading-tight">{data.template_name}</h3>
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-warmgray-400 flex-wrap">
                          {data.application_number && <span className="font-mono">{data.application_number}</span>}
                          {data.application_number && <span>·</span>}
                          <span>{new Date(data.created_at).toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        <UserAvatar name={data.applicant_name ?? '?'} avatarUrl={data.applicant_avatar} size={9} />
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-widest text-warmgray-400 mb-0.5">{tFn('detail_applicant_lbl')}</p>
                          <p className="font-bold text-warmgray-800 text-sm">{data.applicant_name}</p>
                        </div>
                      </div>
                    </div>

                    {/* RINGI form data */}
                    <div>
                      <p className="section-title mb-3">{tFn('detail_content')}</p>
                      {data.component_type === 'transportation' ? (
                        <TransportationDetail
                          formData={data.form_data}
                          dailyAllowanceRate={data.applicant_daily_rate}
                          schema={data.schema_definition ?? undefined}
                        />
                      ) : renderFields(data.form_data, data.schema_definition)}
                    </div>
                  </div>

                  {/* Settlement data card */}
                  {hasSettlementData && data.settlement_schema && (
                    <div className="card space-y-4 border border-teal-200/40">
                      <div className="flex items-center gap-2 pb-3 border-b border-white/30">
                        <span className="w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">💴</span>
                        <p className="text-sm font-bold text-teal-800 uppercase tracking-widest">{tFn('detail_settle_data_title')}</p>
                      </div>
                      {renderFields(data.settlement_data!, data.settlement_schema)}

                      {/* Accounting result */}
                      {(data.transfer_date || data.transfer_proof_url || data.accounting_note) && (
                        <div className="pt-3 border-t border-teal-100 space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-teal-600">{tFn('accounting_result_title')}</p>
                          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                            {data.transfer_date && (
                              <div>
                                <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-0.5">{tFn('accounting_col_transfer')}</dt>
                                <dd className="font-semibold text-warmgray-800">{new Date(data.transfer_date).toLocaleDateString('ja-JP')}</dd>
                              </div>
                            )}
                            {data.accounting_note && (
                              <div>
                                <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-0.5">{tFn('accounting_col_proof')}</dt>
                                <dd className="text-warmgray-700">{data.accounting_note}</dd>
                              </div>
                            )}
                          </dl>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Right: timeline ── */}
                <div className="space-y-4">
                  <p className="section-title ml-1">{tFn('detail_timeline')}</p>

                  {/* RINGI steps */}
                  {ringiSteps.length > 0 && (
                    <div className="card pt-5 pb-3">
                      {hasSettlement && (
                        <p className="text-[10px] font-bold uppercase tracking-widest text-ringo-400 mb-4 ml-4">{tFn('phase_ringi')}</p>
                      )}
                      <div className="relative border-l-2 border-ringo-200 ml-4 space-y-6 pb-2">
                        {ringiSteps
                          .filter(s => s.status !== 'CANCELLED')
                          .sort((a, b) => a.step_order - b.step_order)
                          .map((s, i) => renderTimelineStep(s, i))}
                      </div>
                    </div>
                  )}

                  {/* SETTLEMENT steps */}
                  {settleSteps.length > 0 && (
                    <div className="card pt-5 pb-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-teal-500 mb-4 ml-4">{tFn('phase_settlement')}</p>
                      <div className="relative border-l-2 border-teal-200 ml-4 space-y-6 pb-2">
                        {settleSteps
                          .sort((a, b) => a.step_order - b.step_order)
                          .map((s, i) => renderTimelineStep(s, i))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Application Detail Modal ──────────────────────────────────────────────────
interface DetailModalProps {
  app: Application;
  onClose: () => void;
  onAction: (id: string, action: 'approve' | 'return' | 'reject', comment: string) => void;
  isMutating: boolean;
  proxyMode?: boolean; // When true: only proxy-approve action available (no return/reject)
}

function DetailModal({ app, onClose, onAction, isMutating, proxyMode = false }: DetailModalProps) {
  const { t, lang } = useLang();
  const dateLocale = lang === 'en' ? 'en-US' : 'ja-JP';
  const [activeAction, setActiveAction] = useState<'approve' | 'return' | 'reject' | null>(null);
  const [comment, setComment] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const {
    data: detail,
    isLoading: isDetailLoading,
    isError: isDetailError,
  } = useQuery<AppDetailData>({
    queryKey: ['appDetail', app.id],
    queryFn: async () => (await apiClient.get(`/applications/${app.id}`)).data,
    staleTime: 60_000,
  });

  const viewApp = { ...app, ...detail } as Application & Partial<AppDetailData>;

  const isConfirmStep = app.current_step_action === 'CONFIRM';

  const actionConfig = {
    approve: {
      title:    proxyMode
        ? (lang === 'en' ? 'Proxy Approve' : '代理承認')
        : isConfirmStep
          ? (lang === 'en' ? 'Confirm' : '確認する')
          : t('approvals_approve_btn'),
      btnClass: 'btn-primary',
      require:  false,
      icon:     proxyMode ? '↔' : '✓',
      iconBg:   proxyMode ? 'bg-violet-100 text-violet-600' : 'bg-emerald-100 text-emerald-600',
    },
    return:  { title: t('btn_return'), btnClass: 'btn-outline', require: true, icon: '↩', iconBg: 'bg-amber-100 text-amber-600' },
    reject:  { title: t('btn_reject'), btnClass: 'btn-danger',  require: true, icon: '✕', iconBg: 'bg-red-100 text-red-600'    },
  };

  const isFinal = activeAction === 'approve' && Number(app.current_step) === Number(app.total_steps);
  const cfg = activeAction ? actionConfig[activeAction] : null;
  const canSubmit = !cfg?.require || comment.trim().length > 0;

  const handleSubmit = () => {
    if (!activeAction || !canSubmit) return;
    onAction(app.id, activeAction, comment);
  };

  // Portal — see AppDetailPanel comment above for rationale.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-warmgray-900/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative glass rounded-none md:rounded-3xl shadow-2xl w-full max-w-3xl max-h-[100dvh] md:max-h-[90vh] flex flex-col animate-scale-in overflow-hidden">

        {/* Header */}
        <div className="px-7 pt-7 pb-5 border-b border-white/30 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <UserAvatar name={app.applicant_name ?? '?'} avatarUrl={app.applicant_avatar} size={10} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg font-bold text-warmgray-800 leading-tight">{app.template_name}</h3>
                  <PatternBadge patternId={app.pattern_id} size="sm" />
                </div>
                {app.applicant_name && (
                  <p className="text-xs text-warmgray-500 mt-0.5">
                    {t('approvals_applicant_lbl')}: {app.applicant_name}
                    {app.department_name && app.department_name !== '—' && (
                      <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-surface-100/80 text-warmgray-500 border border-surface-200/60">
                        {app.department_name}
                      </span>
                    )}
                  </p>
                )}
                <p className="text-[11px] text-warmgray-400 mt-0.5">
                  {new Date(app.created_at).toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </div>
            {/* X close — top right */}
            <button
              onClick={onClose}
              className="shrink-0 w-8 h-8 rounded-xl bg-surface-100/80 hover:bg-surface-200/80 flex items-center justify-center text-warmgray-400 hover:text-warmgray-800 transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Step progress */}
          <div className="mt-4">
            <StepBar current={Number(app.current_step)} total={Number(app.total_steps)} />
            {app.current_step_label && (
              <p className="text-[11px] text-warmgray-400 mt-2">{t('approvals_current_lbl')}: {app.current_step_label}</p>
            )}
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="px-7 py-5 space-y-6">

            {isDetailLoading && <RingoLoader.Block label={t('loading')} />}
            {isDetailError && (
              <div className="text-sm text-ringo-500 text-center py-8">{t('approvals_error_msg')}</div>
            )}

            {/* Settlement stage badge */}
            {app.current_stage === 'SETTLEMENT' && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-teal-50/80 border border-teal-200/60 text-teal-700 text-xs font-semibold">
                <span>💴</span>
                {t('approvals_settle_phase')}
              </div>
            )}

            {/* Settlement data (if SETTLEMENT stage) */}
            {!isDetailLoading && !isDetailError && app.current_stage === 'SETTLEMENT' && viewApp.settlement_data && (
              <div>
                <p className="section-title mb-4">{t('approvals_settle_content')}</p>
                <FormDataViewer formData={viewApp.settlement_data} schema={viewApp.settlement_schema ?? null} tFn={t} />
              </div>
            )}

            {/* Original RINGI content */}
            {!isDetailLoading && !isDetailError && viewApp.form_data && (
            <div>
              <p className="section-title mb-4">
                {app.current_stage === 'SETTLEMENT' ? t('approvals_original') : t('approvals_content')}
              </p>
              {(viewApp as AppDetailData).component_type === 'transportation' ? (
                <TransportationDetail
                  formData={viewApp.form_data as Record<string, unknown>}
                  dailyAllowanceRate={(viewApp as AppDetailData).applicant_daily_rate}
                  schema={(viewApp as AppDetailData).schema_definition ?? undefined}
                />
              ) : (
                <FormDataViewer formData={viewApp.form_data} schema={viewApp.schema_definition ?? null} tFn={t} />
              )}
            </div>
            )}
          </div>
        </div>

        {/* Full detail overlay */}
        {showDetail && (
          <AppDetailPanel appId={app.id} onClose={() => setShowDetail(false)} tFn={t} lang={lang} />
        )}

        {/* Footer — action area */}
        <div className="px-4 sm:px-7 py-4 sm:py-5 border-t border-white/30 bg-surface-50/40 shrink-0">
          {activeAction ? (
            <div className="space-y-3 animate-scale-in">
              {/* Action header */}
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-sm ${cfg!.iconBg}`}>
                  {cfg!.icon}
                </div>
                <div>
                  <p className="text-sm font-bold text-warmgray-800">{cfg!.title}</p>
                  {isFinal && (
                    <p className="text-xs text-emerald-600 font-medium">{t('approvals_final_hint')}</p>
                  )}
                </div>
              </div>

              {/* Comment field */}
              <div>
                <label className="label-normal text-xs">
                  {t('approvals_comment')}
                  {cfg!.require
                    ? <span className="text-ringo-500 ml-1">{t('required')}</span>
                    : <span className="text-warmgray-400 ml-1 font-normal">{t('optional')}</span>
                  }
                </label>
                <textarea
                  className={`input resize-none text-sm ${cfg!.require && !comment.trim() ? 'border-amber-300/80 focus:ring-amber-400/50' : ''}`}
                  rows={2}
                  placeholder={activeAction === 'approve' ? t('approvals_approve_ph') : t('approvals_reason_ph')}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  autoFocus
                />
                {cfg!.require && !comment.trim() && (
                  <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                    <span>⚠</span>{t('action_require_comment')}
                  </p>
                )}
              </div>

              {/* Submit / cancel */}
              <div className="flex gap-2">
                <button className="btn-ghost text-xs" onClick={() => { setActiveAction(null); setComment(''); }}>
                  {t('approvals_back')}
                </button>
                <div className="flex-1" />
                <button
                  className={`${cfg!.btnClass} text-sm`}
                  disabled={isMutating || !canSubmit}
                  onClick={handleSubmit}
                >
                  {isMutating ? t('approvals_processing') : cfg!.title}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              {/* 詳細 — left */}
              <button
                onClick={() => setShowDetail(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-ringo-50/80 hover:bg-ringo-100/80 text-ringo-500 hover:text-ringo-700 text-xs font-bold transition-all border border-ringo-200/60 shrink-0"
              >
                {lang === 'en' ? 'Details' : '詳細'}
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </button>
              {/* Action buttons — right */}
              <div className="flex items-center gap-1.5 shrink-0">
                {!proxyMode && app.current_step_action !== 'CONFIRM' && (
                  <>
                    <button className="btn-outline text-xs sm:text-sm" onClick={() => { setActiveAction('return'); setComment(''); }} disabled={isMutating}>
                      ↩ {t('btn_return')}
                    </button>
                    <button className="btn-danger text-xs sm:text-sm" onClick={() => { setActiveAction('reject'); setComment(''); }} disabled={isMutating}>
                      ✕ {t('btn_reject')}
                    </button>
                  </>
                )}
                <button className="btn-primary text-xs sm:text-sm" onClick={() => { setActiveAction('approve'); setComment(''); }} disabled={isMutating}>
                  {proxyMode
                    ? `↔ ${lang === 'en' ? 'Proxy Approve' : '代理承認'}`
                    : app.current_step_action === 'CONFIRM'
                      ? `✓ ${lang === 'en' ? 'Confirm' : '確認する'}`
                      : Number(app.current_step) === Number(app.total_steps)
                        ? `✓ ${t('approvals_final_btn')}`
                        : `✓ ${t('approvals_approve_btn')}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Approvals() {
  const queryClient = useQueryClient();
  const { toast, show: showToast, dismiss } = useToast();
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [systemView, setSystemView] = useState(false);
  const [proxyView, setProxyView] = useState(false);
  const [selectedProxyApp, setSelectedProxyApp] = useState<Application | null>(null);
  // ── Selection / bulk-approve state ────────────────────────────────────────
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkComment, setBulkComment] = useState('');
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const { t, lang } = useLang();
  const { isAdmin } = useAuth();
  const dateLocale = lang === 'en' ? 'en-US' : 'ja-JP';

  const PAGE = 25;
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
    isError,
  } = useInfiniteQuery<{ items: Application[]; hasMore: boolean; total: number; offset: number; nextCursor?: string | null }>({
    queryKey: ['pendingApprovals', systemView],
    queryFn: async ({ pageParam = null }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : '';
      return (await apiClient.get(
        `/approvals/pending?limit=${PAGE}${systemView ? '&all=true' : ''}${cursor}`
      )).data;
    },
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const applications = data?.pages.flatMap(p => p.items) ?? [];
  const totalCount = data?.pages[0]?.total ?? applications.length;

  // ── Proxy approval queue ───────────────────────────────────────────────────
  const {
    data: proxyData,
    hasNextPage: hasNextProxyPage,
    isFetchingNextPage: isFetchingNextProxyPage,
    isLoading: isProxyLoading,
  } = useInfiniteQuery<{ items: Application[]; hasMore: boolean; total: number; nextCursor?: string | null }>({
    queryKey: ['proxyApprovals'],
    queryFn: async ({ pageParam = null }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : '';
      return (await apiClient.get(`/approvals/pending/proxy?limit=${PAGE}${cursor}`)).data;
    },
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const proxyApplications = proxyData?.pages.flatMap(p => p.items) ?? [];
  const proxyTotalCount = proxyData?.pages[0]?.total ?? proxyApplications.length;

  const proxyApproveMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) =>
      (await apiClient.post(`/approvals/${id}/proxy-approve`, { comment })).data,
    onSuccess: (data) => {
      showToast(data.final ? `↔ 代理承認（最終）しました` : `↔ 代理承認しました`);
      queryClient.invalidateQueries({ queryKey: ['proxyApprovals'] });
      queryClient.invalidateQueries({ queryKey: ['pendingApprovals'] });
      queryClient.invalidateQueries({ queryKey: ['myApplications'] });
      setSelectedProxyApp(null);
    },
    onError: (err: any) => showToast(`代理承認に失敗しました: ${err.response?.data?.error ?? err.message}`, 'error'),
  });

  const sentinelRef = useScrollEnd(
    useCallback(() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }, [hasNextPage, isFetchingNextPage, fetchNextPage]),
    hasNextPage ?? false,
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['pendingApprovals'] });
    queryClient.invalidateQueries({ queryKey: ['proxyApprovals'] });
    queryClient.invalidateQueries({ queryKey: ['myApplications'] });
    setSelectedApp(null);
  }, [queryClient]);

  function toggleSystemView() {
    setSystemView(v => !v);
    setSelectedApp(null);
    exitSelectionMode();
  }

  const approveMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) =>
      (await apiClient.post(`/approvals/${id}/approve`, { comment })).data,
    onSuccess: (data) => {
      showToast(
        data.completed ? `🎉 ${t('status_completed')} — ${t('toast_submitted')}` :
        data.final ? `✅ ${t('approvals_final_btn')} — ${data.application?.application_number}` :
        `✅ ${t('toast_approved')}`
      );
      invalidate();
    },
    onError: (err: any) => showToast(`${t('toast_approve_fail')}: ${err.message}`, 'error'),
  });

  const returnMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) =>
      (await apiClient.post(`/approvals/${id}/return`, { comment })).data,
    onSuccess: () => { showToast(`↩ ${t('toast_returned')}`); invalidate(); },
    onError: (err: any) => showToast(`${t('toast_return_fail')}: ${err.message}`, 'error'),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) =>
      (await apiClient.post(`/approvals/${id}/reject`, { comment })).data,
    onSuccess: () => { showToast(`✕ ${t('toast_rejected')}`); invalidate(); },
    onError: (err: any) => showToast(`${t('toast_reject_fail')}: ${err.message}`, 'error'),
  });

  const handleAction = (id: string, action: 'approve' | 'return' | 'reject', comment: string) => {
    const payload = { id, comment };
    if (action === 'approve') approveMutation.mutate(payload);
    else if (action === 'return') returnMutation.mutate(payload);
    else rejectMutation.mutate(payload);
  };

  const isMutating = approveMutation.isPending || returnMutation.isPending || rejectMutation.isPending || proxyApproveMutation.isPending;

  // ── Bulk approve ──────────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setBulkComment('');
    setShowBulkConfirm(false);
  };

  const selectAll = () => {
    const list = proxyView ? proxyApplications : applications;
    setSelectedIds(new Set(list.map((a) => a.id)));
  };

  const bulkApproveMutation = useMutation({
    mutationFn: async ({ applicationIds, comment }: { applicationIds: string[]; comment?: string }) =>
      (await apiClient.post('/approvals/bulk-approve', { applicationIds, comment })).data,
    onSuccess: (data: { succeeded: number; failed: { applicationId: string; reason: string }[] }) => {
      if (data.failed.length === 0) showToast(`✅ ${data.succeeded}件を承認しました`);
      else showToast(`✅ ${data.succeeded}件承認 / ⚠ ${data.failed.length}件失敗: ${data.failed.map((f) => f.reason).join(', ')}`, 'error');
      exitSelectionMode();
      invalidate();
    },
    onError: (err: any) => showToast(`一括承認に失敗しました: ${err.message}`, 'error'),
  });

  const bulkProxyApproveMutation = useMutation({
    mutationFn: async ({ applicationIds, comment }: { applicationIds: string[]; comment?: string }) =>
      (await apiClient.post('/approvals/bulk-proxy-approve', { applicationIds, comment })).data,
    onSuccess: (data: { succeeded: number; failed: { applicationId: string; reason: string }[] }) => {
      if (data.failed.length === 0) showToast(`↔ ${data.succeeded}件を代理承認しました`);
      else showToast(`↔ ${data.succeeded}件代理承認 / ⚠ ${data.failed.length}件失敗`, 'error');
      exitSelectionMode();
      queryClient.invalidateQueries({ queryKey: ['proxyApprovals'] });
      queryClient.invalidateQueries({ queryKey: ['pendingApprovals'] });
    },
    onError: (err: any) => showToast(`一括代理承認に失敗しました: ${err.message}`, 'error'),
  });

  return (
    <Layout title={t('title_approvals')}>
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={dismiss} />}

      <div className="max-w-[1800px] mx-auto space-y-6">

        {/* Header */}
        <div className="animate-fade-up flex items-start justify-between gap-4">
          <div>
            <p className="section-title mb-0">{t('approvals_inbox')}</p>
            <h2 className="text-2xl font-bold text-warmgray-800 mt-1">{t('title_approvals')}</h2>
            <p className="text-sm text-warmgray-400 mt-1">{t('approvals_subtitle')}</p>
          </div>
          {/* Right: Mine | Select | Approval | Proxy */}
          <div className="flex items-center gap-2 shrink-0 mt-1">
            {/* Admin system-wide toggle */}
            {isAdmin && (
              <button
                onClick={toggleSystemView}
                title={systemView ? (lang === 'en' ? 'Switch to my approvals' : '自分の承認に戻す') : (lang === 'en' ? 'View all system approvals' : 'システム全体を表示')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all duration-150 ${
                  systemView
                    ? 'bg-warmgray-800 text-white border-warmgray-700 shadow-sm'
                    : 'bg-white/60 text-warmgray-500 border-white/80 hover:bg-white/90 hover:text-warmgray-800'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                </svg>
                {systemView ? (lang === 'en' ? 'System' : 'システム') : (lang === 'en' ? 'Mine' : '自分')}
              </button>
            )}
            {/* Bulk-select toggle — always occupies space, invisible when no items */}
            <div className={(proxyView ? proxyApplications : applications).length > 0 ? 'block' : 'hidden'}>
              {selectionMode ? (
                <button
                  onClick={exitSelectionMode}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all duration-150 bg-ringo-500 text-white border-ringo-500 shadow-sm"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  {lang === 'en' ? 'Cancel' : 'キャンセル'}
                </button>
              ) : (
                <button
                  onClick={() => { setSelectionMode(true); setSelectedIds(new Set()); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all duration-150 bg-white/60 text-warmgray-500 border-white/80 hover:bg-white/90 hover:text-warmgray-800"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {lang === 'en' ? 'Select' : '選択'}
                </button>
              )}
            </div>
            {/* Approval / Proxy tabs */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setProxyView(false); setSelectedProxyApp(null); exitSelectionMode(); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all duration-150 ${
                  !proxyView
                    ? 'bg-ringo-500 text-white border-ringo-500 shadow-sm'
                    : 'bg-white/60 text-warmgray-500 border-white/80 hover:bg-white/90'
                }`}
              >
                {lang === 'en' ? 'Approval' : '承認'}
                {totalCount > 0 && <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${!proxyView ? 'bg-white/30' : 'bg-ringo-100 text-ringo-600'}`}>{totalCount}</span>}
              </button>
              <button
                onClick={() => { setProxyView(true); setSelectedApp(null); exitSelectionMode(); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all duration-150 ${
                  proxyView
                    ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                    : 'bg-white/60 text-warmgray-500 border-white/80 hover:bg-white/90'
                }`}
              >
                {lang === 'en' ? 'Proxy' : '代理承認'}
                {proxyTotalCount > 0 && <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${proxyView ? 'bg-white/30' : 'bg-violet-100 text-violet-600'}`}>{proxyTotalCount}</span>}
              </button>
            </div>
          </div>
        </div>

        {/* System-view banner */}
        {isAdmin && systemView && (
          <div className="animate-fade-up flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-warmgray-800/90 text-white text-xs font-semibold">
            <svg className="w-4 h-4 shrink-0 text-mustard-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {lang === 'en' ? 'Admin overview — showing all pending approvals system-wide' : '管理者ビュー — システム全体の承認待ちを表示中'}
            <button onClick={toggleSystemView} className="ml-auto text-white/60 hover:text-white transition-colors">
              {lang === 'en' ? '✕ Back to mine' : '✕ 自分に戻す'}
            </button>
          </div>
        )}

        {/* Regular approvals — hidden when proxy tab active */}
        {/* Loading */}
        {!proxyView && isLoading && (
          <div className="card !p-0 md:overflow-hidden">
            <table className="table-base table-responsive table-fixed w-full">
              <thead>
                <tr>
                  <th>{t('approvals_col_app')}</th>
                  <th>{t('approvals_col_step')}</th>
                  <th>{t('approvals_col_date')}</th>
                  <th className="hidden md:table-cell text-right w-32">{lang === 'en' ? 'Amount' : '金額'}</th>
                </tr>
              </thead>
              <tbody className="md:divide-y md:divide-white/30">
                {[...Array(8)].map((_, i) => (
                  <tr key={i}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Sk.Circle size="md" />
                        <div className="space-y-1.5">
                          <Sk.Line w={i % 2 === 0 ? 'w-36' : 'w-28'} h="h-3.5" />
                          <Sk.Line w="w-20" h="h-2.5" />
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="space-y-1.5">
                        <Sk.Line w="w-24" h="h-3" />
                        <Sk.Line w="w-16" h="h-2.5" />
                      </div>
                    </td>
                    <td><Sk.Line w="w-20" h="h-3" /></td>
                    <td className="hidden md:table-cell" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Error */}
        {!proxyView && isError && (
          <div className="card text-ringo-600 text-sm text-center py-8">
            {t('approvals_error_msg')}
          </div>
        )}

        {/* Empty */}
        {!proxyView && !isLoading && applications.length === 0 && (
          <div className="card flex flex-col items-center justify-center py-20 text-warmgray-400">
            <span className="text-4xl mb-3">✅</span>
            <p className="text-sm font-medium">{t('approvals_no_items')}</p>
            <p className="text-xs mt-1 text-warmgray-300">{t('approvals_all_done')}</p>
          </div>
        )}

        {/* Table */}
        {!proxyView && applications.length > 0 && (
          <div className={`card !p-0 md:overflow-hidden animate-fade-up transition-opacity duration-200 ${isFetching && !isFetchingNextPage ? 'opacity-60 pointer-events-none' : 'opacity-100'}`}>
            <table className="table-base table-responsive table-fixed w-full">
              <thead>
                <tr>
                  <th>{t('approvals_col_app')}</th>
                  <th className="w-48">{t('approvals_col_step')}</th>
                  <th className="w-24">{t('approvals_col_date')}</th>
                  <th className="hidden md:table-cell text-right w-32">{lang === 'en' ? 'Amount' : '金額'}</th>
                </tr>
              </thead>
              <tbody className="md:divide-y md:divide-white/30">
                {applications.map((app, i) => {
                  const hasDiff = app.row_preview?.numbers.some((n) => n.is_different) ?? false;
                  return (
                  <tr
                    key={app.id}
                    className={`cursor-pointer hover:bg-white/50 transition-colors duration-100 group animate-fade-up
                      ${hasDiff && !selectedIds.has(app.id) ? ' bg-amber-50/80' : ''}
                      ${selectedIds.has(app.id) ? ' !bg-ringo-50/80' : ''}`}
                    style={{ animationDelay: `${Math.min(i, 14) * 30}ms` }}
                    onClick={() => selectionMode ? toggleSelect(app.id) : setSelectedApp(app)}
                  >
                    <td data-label={t('approvals_col_app')} className={hasDiff && !selectedIds.has(app.id) ? 'border-l-[3px] border-amber-500' : selectedIds.has(app.id) ? 'border-l-[3px] border-ringo-400' : ''}>
                      <div className="flex items-center gap-3 md:justify-start justify-end min-w-0">
                        {selectionMode ? (
                          <div className="w-8 h-8 flex items-center justify-center shrink-0">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(app.id)}
                              readOnly
                              className="w-5 h-5 accent-ringo-500 pointer-events-none rounded"
                            />
                          </div>
                        ) : (
                          <UserAvatar name={app.applicant_name ?? '?'} avatarUrl={app.applicant_avatar} size={8} />
                        )}
                        <div className="min-w-0 md:text-left text-right">
                          <div className="flex items-center gap-2 md:justify-start justify-end">
                            <p className="text-sm font-semibold text-warmgray-800 truncate">{app.template_name}</p>
                            {app.current_stage === 'SETTLEMENT' && (
                              <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700">{t('approvals_settlement_badge')}</span>
                            )}
                          </div>
                          {app.row_preview?.text && (
                            <p className="text-[11px] text-warmgray-600 mt-0.5 truncate font-medium md:max-w-[200px]">
                              {lang === 'en' ? app.row_preview.text.label_en : app.row_preview.text.label}
                              {': '}
                              {app.row_preview.text.value}
                            </p>
                          )}
                          <p className="text-[11px] text-warmgray-400 mt-0.5 truncate">
                            {app.applicant_name}
                            {app.department_name && app.department_name !== '—' && (
                              <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-surface-100/80 text-warmgray-500 border border-surface-200/60">
                                {app.department_name}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td data-label={t('approvals_col_step')}>
                      <div className="md:text-left text-right">
                        <div className="flex items-center gap-1.5 md:justify-start justify-end">
                          {Array.from({ length: Number(app.total_steps) }).map((_, idx) => {
                            const n = idx + 1;
                            const cur = Number(app.current_step);
                            return (
                              <span key={idx} className={`w-2 h-2 rounded-full ${n < cur ? 'bg-emerald-400' : n === cur ? 'bg-ringo-500 ring-2 ring-ringo-200' : 'bg-surface-200'}`} />
                            );
                          })}
                          <span className="text-[10px] text-warmgray-400 ml-1">{app.current_step}/{app.total_steps}</span>
                        </div>
                        {app.current_step_label && (
                          <p className="text-[10px] text-warmgray-400 mt-1 truncate md:max-w-[120px]">{app.current_step_label}</p>
                        )}
                      </div>
                    </td>
                    <td data-label={t('approvals_col_date')} className="text-[11px] text-warmgray-400 whitespace-nowrap">
                      {new Date(app.created_at).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="hidden md:table-cell text-right w-32 align-middle">
                      {app.row_preview?.numbers && app.row_preview.numbers.length > 0 && (
                        <div className="flex flex-col items-end gap-0.5">
                          {app.row_preview.numbers.map((n, ni) => (
                            <div key={ni} className="flex items-baseline gap-1">
                              {n.compare_value !== undefined && n.compare_value !== null && (
                                <span className={`text-[10px] tabular-nums ${n.is_different ? 'text-amber-500' : 'text-warmgray-400'}`}>
                                  {n.compare_value.toLocaleString()} {'→'}
                                </span>
                              )}
                              <span className={`text-xs font-bold tabular-nums ${n.is_different ? 'text-amber-600' : 'text-warmgray-700'}`}>
                                {n.value !== null ? n.value.toLocaleString() : '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Sentinel — invisible h-px; observer fires 200px before bottom */}
            <div ref={sentinelRef} className="h-px" />
            {(isFetchingNextPage || (!hasNextPage && applications.length >= PAGE)) && (
              <div className="px-5 py-3 flex items-center justify-center gap-2 text-warmgray-400 text-xs border-t border-white/20">
                {isFetchingNextPage ? (
                  <RingoLoader.Inline />
                ) : (
                  <span className="text-warmgray-300">{lang === 'en' ? 'All loaded' : '全件表示済み'}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Proxy approval list */}
        {proxyView && (
        <div className="space-y-4 animate-fade-up">
          {isProxyLoading && <div className="card py-10 flex justify-center"><RingoLoader.Inline /></div>}

          {!isProxyLoading && proxyApplications.length === 0 && (
            <div className="card flex flex-col items-center justify-center py-16 text-warmgray-400">
              <span className="text-3xl mb-3">↔</span>
              <p className="text-sm font-medium">{lang === 'en' ? 'No proxy approvals pending' : '代理承認待ちはありません'}</p>
            </div>
          )}

          {proxyApplications.length > 0 && (
            <div className="card !p-0 md:overflow-hidden">
              <table className="table-base table-responsive table-fixed w-full">
                <thead>
                  <tr>
                    <th>{t('approvals_col_app')}</th>
                    <th className="w-48">{t('approvals_col_step')}</th>
                    <th className="w-24">{t('approvals_col_date')}</th>
                    <th className="hidden md:table-cell text-right w-32">{lang === 'en' ? 'Amount' : '金額'}</th>
                  </tr>
                </thead>
                <tbody className="md:divide-y md:divide-white/30">
                  {proxyApplications.map((app, i) => (
                    <tr
                      key={app.id}
                      className={`cursor-pointer hover:bg-white/50 transition-colors duration-100 group animate-fade-up ${selectedIds.has(app.id) ? '!bg-ringo-50/80' : ''}`}
                      style={{ animationDelay: `${Math.min(i, 14) * 30}ms` }}
                      onClick={() => selectionMode ? toggleSelect(app.id) : setSelectedProxyApp(app)}
                    >
                      <td data-label={t('approvals_col_app')} className={selectedIds.has(app.id) ? 'border-l-[3px] border-ringo-400' : ''}>
                        <div className="flex items-center gap-3 md:justify-start justify-end min-w-0">
                          {selectionMode ? (
                            <div className="w-8 h-8 flex items-center justify-center shrink-0">
                              <input type="checkbox" checked={selectedIds.has(app.id)} readOnly className="w-5 h-5 accent-ringo-500 pointer-events-none rounded" />
                            </div>
                          ) : (
                            <UserAvatar name={app.applicant_name ?? '?'} avatarUrl={app.applicant_avatar} size={8} />
                          )}
                          <div className="min-w-0 md:text-left text-right">
                            <div className="flex items-center gap-2 md:justify-start justify-end">
                              <p className="text-sm font-semibold text-warmgray-800 truncate">{app.template_name}</p>
                              {app.current_stage === 'SETTLEMENT' && (
                                <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700">{t('approvals_settlement_badge')}</span>
                              )}
                            </div>
                            {app.row_preview?.text && (
                              <p className="text-[11px] text-warmgray-600 mt-0.5 truncate font-medium md:max-w-[200px]">
                                {lang === 'en' ? app.row_preview.text.label_en : app.row_preview.text.label}: {app.row_preview.text.value}
                              </p>
                            )}
                            <p className="text-[11px] text-warmgray-400 mt-0.5 truncate">
                              {app.applicant_name}
                              {app.department_name && app.department_name !== '—' && (
                                <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-surface-100/80 text-warmgray-500 border border-surface-200/60">{app.department_name}</span>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td data-label={t('approvals_col_step')}>
                        <div className="md:text-left text-right">
                          <div className="flex items-center gap-1.5 md:justify-start justify-end">
                            {Array.from({ length: Number(app.total_steps) }).map((_, idx) => {
                              const n = idx + 1;
                              const cur = Number(app.current_step);
                              return (
                                <span key={idx} className={`w-2 h-2 rounded-full ${n < cur ? 'bg-emerald-400' : n === cur ? 'bg-amber-400 ring-2 ring-amber-200' : 'bg-violet-200'}`} />
                              );
                            })}
                            <span className="text-[10px] text-warmgray-400 ml-1">{app.current_step}/{app.total_steps}</span>
                          </div>
                          {app.current_approver_name && (
                            <p className="text-[10px] text-warmgray-400 mt-1 truncate md:max-w-[120px]">{app.current_approver_name}</p>
                          )}
                        </div>
                      </td>
                      <td data-label={t('approvals_col_date')} className="text-[11px] text-warmgray-400 whitespace-nowrap">
                        {new Date(app.created_at).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })}
                      </td>
                      <td className="hidden md:table-cell text-right w-32 align-middle">
                        {app.row_preview?.numbers && app.row_preview.numbers.length > 0 && (
                          <div className="flex flex-col items-end gap-0.5">
                            {app.row_preview.numbers.map((n, ni) => (
                              <div key={ni} className="flex items-baseline gap-1">
                                <span className="text-xs font-bold tabular-nums text-warmgray-700">
                                  {n.value !== null ? n.value.toLocaleString() : '—'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(isFetchingNextProxyPage || (!hasNextProxyPage && proxyApplications.length >= PAGE)) && (
                <div className="px-5 py-3 flex items-center justify-center gap-2 text-warmgray-400 text-xs border-t border-white/20">
                  {isFetchingNextProxyPage ? <RingoLoader.Inline /> : <span className="text-warmgray-300">{lang === 'en' ? 'All loaded' : '全件表示済み'}</span>}
                </div>
              )}
            </div>
          )}
        </div>
        )}
      </div>

      {/* Detail modal — regular */}
      {selectedApp && (
        <DetailModal
          app={selectedApp}
          onClose={() => setSelectedApp(null)}
          onAction={handleAction}
          isMutating={isMutating}
        />
      )}

      {/* Detail modal — proxy */}
      {selectedProxyApp && (
        <DetailModal
          app={selectedProxyApp}
          onClose={() => setSelectedProxyApp(null)}
          onAction={(id, _action, comment) =>
            proxyApproveMutation.mutate({ id, comment })
          }
          isMutating={proxyApproveMutation.isPending}
          proxyMode
        />
      )}

      {/* Bulk approve / bulk proxy-approve confirm dialog */}
      <ConfirmDialog
        isOpen={showBulkConfirm}
        title={proxyView ? (lang === 'en' ? 'Bulk Proxy Approve' : '一括代理承認') : (lang === 'en' ? 'Bulk Approve' : '一括承認')}
        message={
          proxyView
            ? (lang === 'en'
                ? `Proxy-approve ${selectedIds.size} application${selectedIds.size > 1 ? 's' : ''} on behalf of the current approver? This cannot be undone.`
                : `${selectedIds.size}件の申請を代理承認します。この操作は取り消せません。`)
            : (lang === 'en'
                ? `Approve ${selectedIds.size} application${selectedIds.size > 1 ? 's' : ''}? This cannot be undone.`
                : `${selectedIds.size}件の申請をまとめて承認します。この操作は取り消せません。`)
        }
        confirmLabel={proxyView
          ? (lang === 'en' ? `↔ Proxy ${selectedIds.size}` : `↔ ${selectedIds.size}件を代理承認`)
          : (lang === 'en' ? `✓ Approve ${selectedIds.size}` : `✓ ${selectedIds.size}件を承認`)}
        confirmClass="btn-primary"
        onConfirm={() => {
          setShowBulkConfirm(false);
          const ids = Array.from(selectedIds);
          const comment = bulkComment.trim() || undefined;
          if (proxyView) bulkProxyApproveMutation.mutate({ applicationIds: ids, comment });
          else bulkApproveMutation.mutate({ applicationIds: ids, comment });
        }}
        onCancel={() => setShowBulkConfirm(false)}
      />

      {/* Bulk-select floating action bar — portal so it overlays everything */}
      {selectionMode && createPortal(
        <div className="fixed bottom-0 left-0 right-0 z-[60] p-3 sm:p-4 pointer-events-none" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px) + 52px)' }}>
          <div className="max-w-2xl mx-auto pointer-events-auto">
            <div className="glass rounded-2xl shadow-2xl border border-white/40 overflow-hidden animate-scale-in">
              {/* Top: count + select-all + close */}
              <div className="flex items-center gap-3 px-4 pt-3 pb-2">
                <span className="text-sm font-bold text-warmgray-800 flex-1">
                  {selectedIds.size > 0
                    ? (lang === 'en' ? `${selectedIds.size} selected` : `${selectedIds.size}件選択中`)
                    : (lang === 'en' ? 'Tap rows to select' : '行をタップして選択')}
                </span>
                {(proxyView ? proxyApplications : applications).length > 0 &&
                  selectedIds.size < (proxyView ? proxyApplications : applications).length && (
                  <button
                    onClick={selectAll}
                    className="text-xs font-semibold text-ringo-500 hover:text-ringo-700 transition-colors"
                  >
                    {lang === 'en' ? 'Select all' : 'すべて選択'}
                  </button>
                )}
                {selectedIds.size > 0 && (
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="text-xs text-warmgray-400 hover:text-warmgray-600 transition-colors"
                  >
                    {lang === 'en' ? 'Clear' : 'クリア'}
                  </button>
                )}
              </div>
              {/* Comment input */}
              <div className="px-4 pb-2">
                <input
                  type="text"
                  value={bulkComment}
                  onChange={(e) => setBulkComment(e.target.value)}
                  placeholder={lang === 'en' ? 'Comment (optional, applied to all)' : 'コメント（任意・全件に適用）'}
                  className="input text-xs w-full"
                />
              </div>
              {/* Action buttons */}
              <div className="flex items-center gap-2 px-4 pb-4">
                <button
                  onClick={exitSelectionMode}
                  className="btn-outline text-xs sm:text-sm"
                >
                  {lang === 'en' ? 'Cancel' : 'キャンセル'}
                </button>
                <button
                  onClick={() => setShowBulkConfirm(true)}
                  disabled={selectedIds.size === 0 || bulkApproveMutation.isPending || bulkProxyApproveMutation.isPending}
                  className="btn-primary text-xs sm:text-sm flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {(bulkApproveMutation.isPending || bulkProxyApproveMutation.isPending) ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      {lang === 'en' ? 'Processing…' : '処理中…'}
                    </span>
                  ) : proxyView ? (
                    `↔ ${selectedIds.size > 0
                      ? (lang === 'en' ? `Proxy ${selectedIds.size}` : `${selectedIds.size}件を代理承認`)
                      : (lang === 'en' ? 'Proxy approve selected' : '選択して代理承認')}`
                  ) : (
                    `✓ ${selectedIds.size > 0
                      ? (lang === 'en' ? `Approve ${selectedIds.size}` : `${selectedIds.size}件を承認`)
                      : (lang === 'en' ? 'Approve selected' : '選択して承認')}`
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </Layout>
  );
}
