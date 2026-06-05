import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import RingoLoader from '../components/common/RingoLoader';
import DynamicForm from '../components/forms/DynamicForm';
import TransportationForm from '../components/forms/TransportationForm';
import TransportationDetail from '../components/forms/TransportationDetail';
import type { TransportFormData } from '../components/forms/TransportationForm';
import Toast, { useToast } from '../components/common/Toast';
import { useLang } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { fieldLabel } from '../i18n';
import { FieldValueContent, isLongField } from '../components/forms/FieldValueDisplay';
import { fieldColSpanClass, flattenFieldGroups } from '../components/forms/fieldLayout';
import PatternBadge from '../components/common/PatternBadge';
import CustomSelect from '../components/forms/CustomSelect';
import RouteTimeline from '../components/common/RouteTimeline';
import RepeatGroupDisplay from '../components/forms/RepeatGroupDisplay';
import CollapsibleComment from '../components/common/CollapsibleComment';
import UserAvatar from '../components/common/UserAvatar';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Step {
  step_order: number;
  stage: string;
  label: string;
  status: string;
  approver_id: string | null;
  approver_name: string | null;
  comment: string | null;
  acted_at: string | null;
}

interface ApplicationDetail {
  id: string;
  application_number: string | null;
  template_id: string;
  template_name: string;
  applicant_name: string;
  applicant_avatar?: string | null;
  status: string;
  has_settlement: boolean;
  can_approve: boolean;
  pattern_id?: number;
  form_data: Record<string, any>;
  settlement_data: Record<string, any> | null;
  schema_definition: { fields: any[] };
  settlement_schema: { fields: any[] } | null;
  steps: Step[];
  created_at: string;
  component_type?: string | null;
  applicant_daily_rate?: number | null;
  // Accounting fields (from settlements JOIN)
  transfer_date: string | null;
  transfer_proof_url: string | null;
  accounting_note: string | null;
  settlement_processed_at: string | null;
  settlement_status: string | null;
}

// ── UI Components ─────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  PENDING_APPROVAL:    'badge-pending',
  APPROVED:            'badge-approved',
  REJECTED:            'badge-rejected',
  RETURNED:            'badge-returned',
  DRAFT:               'badge-draft',
  CANCELLED:           'badge-draft',
  COMPLETED:           'badge-indigo',
  PENDING_SETTLEMENT:  'badge-mustard',
  SETTLEMENT_APPROVED: 'badge-teal',
};


// ── View Mode: 申請データを綺麗に表示するコンポーネント ──
function FormDataViewer({ app }: { app: ApplicationDetail }) {
  const { lang } = useLang();
  const fields = flattenFieldGroups(app.schema_definition?.fields ?? []);
  return (
    <dl className="grid grid-cols-1 md:grid-cols-12 gap-x-6 gap-y-4">
      {fields.map((f) => {
        const val = app.form_data[f.name];
        const isLong = isLongField(f, val);
        return (
          <div key={f.name} className={isLong ? 'col-span-1 md:col-span-12' : fieldColSpanClass(f)}>
            <dt className="text-[11px] font-bold uppercase tracking-widest text-warmgray-400 mb-1">{fieldLabel(f, lang)}</dt>
            <dd className="text-sm font-medium text-warmgray-800 bg-white/60 border border-white/80 px-3.5 py-2.5 rounded-xl break-words min-h-[42px]">
              <FieldValueContent
                field={f}
                value={val}
                renderRepeat={(field, value) => <RepeatGroupDisplay field={field} value={value} />}
              />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

// (optionLabel moved to ../i18n for reuse across viewers)

// ── Settlement Data Viewer ─────────────────────────────────────────────────────
function SettlementDataViewer({ app, t }: { app: ApplicationDetail; t: (k: any) => string }) {
  const { lang } = useLang();
  const fields = flattenFieldGroups(app.settlement_schema?.fields ?? []);
  const data = app.settlement_data ?? {};

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-1 md:grid-cols-12 gap-x-6 gap-y-4">
        {fields.map((f) => {
          const val = data[f.name];
          const long = isLongField(f, val);
          return (
            <div key={f.name} className={long ? 'col-span-1 md:col-span-12' : fieldColSpanClass(f)}>
              <dt className="text-[11px] font-bold uppercase tracking-widest text-warmgray-400 mb-1">{fieldLabel(f, lang)}</dt>
              <dd className={`text-sm font-medium text-warmgray-800 bg-white/60 border border-white/80 px-3.5 py-2.5 rounded-xl break-words min-h-[42px] ${
                f.computed ? 'border-teal-200/60 bg-teal-50/40 text-teal-800 font-bold' : ''
              }`}>
                <FieldValueContent
                  field={f}
                  value={val}
                  renderRepeat={(field, value) => <RepeatGroupDisplay field={field} value={value} />}
                />
              </dd>
            </div>
          );
        })}
      </dl>

      {/* Accounting result — transfer date / proof / note */}
      {(app.transfer_date || app.transfer_proof_url || app.accounting_note) && (
        <div className="mt-5 pt-4 border-t border-teal-100 space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-teal-600">{t('accounting_result_title')}</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            {app.transfer_date && (
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-1">{t('accounting_col_transfer')}</dt>
                <dd className="text-sm font-semibold text-warmgray-800">
                  {new Date(app.transfer_date).toLocaleDateString('ja-JP')}
                </dd>
              </div>
            )}
            {app.accounting_note && (
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-1">{t('accounting_col_proof')}</dt>
                <dd className="text-sm text-warmgray-700">{app.accounting_note}</dd>
              </div>
            )}
            {app.transfer_proof_url && (
              <div className="col-span-full">
                <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-1">{t('accounting_proof_view')}</dt>
                <dd>
                  <a
                    href={app.transfer_proof_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-600 hover:text-teal-700 bg-teal-50 border border-teal-200/60 px-3 py-1.5 rounded-lg"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    {t('accounting_proof_view')}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}

// ── Shared route preview card ─────────────────────────────────────────────────
// RouteNode / RouteArrow replaced by RouteTimeline shared component

function RoutePreviewCard({
  selectedRouteId,
  setSelectedRouteId,
  routePreview,
  routeLoading,
  t,
}: {
  selectedRouteId: string;
  setSelectedRouteId: (id: string) => void;
  routePreview: any;
  routeLoading: boolean;
  t: (k: any) => string;
}) {
  const selectedRoute = routePreview?.routes?.find((r: any) => r.id === selectedRouteId) ?? routePreview?.routes?.[0];

  // Build options for CustomSelect
  const routeOptions = (routePreview?.routes ?? []).map((r: any) => ({
    value: r.id,
    label: `${r.name}${r.is_default ? t('route_default_suffix') : ''}`,
  }));

  return (
    <div className="card space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-full bg-gradient-to-b from-ringo-400 to-ringo-600" />
          <p className="text-xs font-bold text-warmgray-700 tracking-tight">{t('detail_route_select')}</p>
        </div>
        {routeLoading && (
          <div className="flex items-center gap-1.5 text-[11px] text-warmgray-400">
            <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            {t('loading')}
          </div>
        )}
      </div>

      {/* No route warning */}
      {routePreview && !routePreview.department_has_route && (
        <div className="flex items-start gap-2.5 text-sm text-amber-700 bg-amber-50/80 border border-amber-200/60 rounded-xl px-4 py-3 backdrop-blur-sm">
          <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <p className="text-sm">{t('detail_no_route_warn')}</p>
        </div>
      )}

      {/* Route selector — only shown when multiple routes */}
      {routePreview?.routes?.length > 1 && (
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">承認ルート</label>
          <CustomSelect
            options={routeOptions}
            value={selectedRouteId || (routePreview?.routes?.[0]?.id ?? '')}
            onChange={setSelectedRouteId}
          />
        </div>
      )}

      {/* Route visualization */}
      {selectedRoute && (
        <RouteTimeline
          steps={selectedRoute.steps}
          originLabel={t('route_applicant_node')}
          doneLabel={t('route_done_node')}
          emptyMessage={t('route_no_steps') ?? 'ステップなし'}
          accent="ringo"
        />
      )}
    </div>
  );
}

// ── Settlement Return Editor — resubmit settlement phase after it was returned ──
function SettlementReturnEditor({ app, onSuccess }: { app: ApplicationDetail; onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const { toast, show, dismiss } = useToast();
  const { t } = useLang();
  // Same as TransportationForm: read rate from auth context (current logged-in user),
  // not from app.applicant_daily_rate (which may be stale/null from cached DB column).
  const { user: authUser } = useAuth();
  const [selectedRouteId, setSelectedRouteId] = useState<string>('');

  const { data: routePreview, isLoading: routeLoading } = useQuery({
    queryKey: ['route-preview-settle', app.template_id],
    queryFn: async () =>
      (await apiClient.get(`/applications/route-preview?template_id=${app.template_id}&stage=SETTLEMENT`)).data,
  });

  useEffect(() => {
    if (routePreview?.routes) {
      const def = routePreview.routes.find((r: any) => r.is_default) ?? routePreview.routes[0];
      if (def) setSelectedRouteId(def.id);
    }
  }, [routePreview]);

  const resubmitSettlement = useMutation({
    mutationFn: async ({ settlement_data, route_id }: { settlement_data: Record<string, unknown>; route_id?: string }) =>
      apiClient.post(`/applications/${app.id}/resubmit-settlement`, { settlement_data, route_id }),
  });

  const handleSubmit = async (payload: any) => {
    try {
      const settlementData = (payload?.form_data ?? payload) as Record<string, unknown>;
      // Pass route_id in mutation args (not closure) — prevents stale-closure bug when user changes route
      await resubmitSettlement.mutateAsync({ settlement_data: settlementData, route_id: selectedRouteId || undefined });
      queryClient.invalidateQueries({ queryKey: ['application', app.id] });
      queryClient.invalidateQueries({ queryKey: ['myApplications'] });
      onSuccess();
    } catch (err: any) {
      show(err?.data?.error ?? err?.message ?? t('error_load'), 'error');
    }
  };

  const isTransport       = app.component_type === 'transportation';
  // pattern_id=2 (direct settlement, transport OR admin-built) stores data in form_data,
  // not settlement_data. Editor must default to form_data so user can edit what they sent.
  const isDirectSettlement = app.pattern_id === 2;

  const template = {
    id: app.template_id,
    title_ja: app.template_name,
    // For direct-settlement, settlement schema = the form schema (same fields user filled)
    schema_definition: app.schema_definition,
    settlement_schema: isDirectSettlement
      ? app.schema_definition
      : (app.settlement_schema ?? { fields: [] }),
    component_type: app.component_type,
  };

  const settlementDefaults = isDirectSettlement
    ? (app.form_data as unknown as Partial<TransportFormData>)
    : (app.settlement_data ?? {}) as Record<string, unknown>;

  // Injected externally so DynamicForm always has the fresh role-based rate
  // even when settlement_data is empty (first-time start) or stale.
  // Use auth context rate (same as TransportationForm) — available immediately at render,
  // no API timing issues. Falls back to app.applicant_daily_rate then 3000.
  const settlementExternalValues = isDirectSettlement ? undefined
    : { _daily_rate: authUser?.daily_allowance_rate ?? app.applicant_daily_rate ?? 3000 };

  return (
    <div className="space-y-5 animate-fade-up">
      {toast && <Toast {...toast} onDismiss={dismiss} />}

      {/* Route preview (settlement route) */}
      {routePreview?.routes?.length > 0 && (
        <RoutePreviewCard
          selectedRouteId={selectedRouteId}
          setSelectedRouteId={setSelectedRouteId}
          routePreview={routePreview}
          routeLoading={routeLoading}
          t={t}
        />
      )}

      {isTransport ? (
        <TransportationForm
          template={template}
          defaultValues={settlementDefaults}
          onSubmit={handleSubmit}
          disabled={resubmitSettlement.isPending}
        />
      ) : (
        <DynamicForm
          template={template}
          defaultValues={settlementDefaults}
          externalValues={settlementExternalValues}
          isSettlementPhase={true}
          onSubmit={handleSubmit}
          disabled={resubmitSettlement.isPending}
          submitLabel={t('btn_resubmit')}
        />
      )}
    </div>
  );
}

// ── Draft / Returned Editor ────────────────────────────────────────────────────
// mode='draft'     → PATCH form_data + POST /submit
// mode='resubmit'  → POST /resubmit (single atomic call)
function DraftEditor({
  app,
  mode = 'draft',
  onSuccess,
}: {
  app: ApplicationDetail;
  mode?: 'draft' | 'resubmit';
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedRouteId, setSelectedRouteId] = useState<string>('');
  const { toast, show, dismiss } = useToast();
  const { t } = useLang();

  // pattern_id=2 (direct settlement) needs SETTLEMENT routes, not RINGI.
  // Same logic as NewApplication.tsx so draft/returned editors mirror new-form UX.
  const draftRouteStage = app.pattern_id === 2 ? 'SETTLEMENT' : 'RINGI';
  const { data: routePreview, isLoading: routeLoading } = useQuery({
    queryKey: ['route-preview', app.template_id, draftRouteStage],
    queryFn: async () =>
      (await apiClient.get(`/applications/route-preview?template_id=${app.template_id}&stage=${draftRouteStage}`)).data,
  });

  useEffect(() => {
    if (routePreview?.routes) {
      const def = routePreview.routes.find((r: any) => r.is_default) ?? routePreview.routes[0];
      if (def) setSelectedRouteId(def.id);
    }
  }, [routePreview]);

  const updateDraft = useMutation({
    mutationFn: async (payload: any) => apiClient.patch(`/applications/${app.id}`, { form_data: payload.form_data }),
  });

  const submitApp = useMutation({
    mutationFn: async () => apiClient.post(`/applications/${app.id}/submit`, { route_id: selectedRouteId }),
  });

  const resubmitApp = useMutation({
    mutationFn: async ({ form_data, route_id }: { form_data: Record<string, unknown>; route_id?: string }) =>
      apiClient.post(`/applications/${app.id}/resubmit`, { form_data, route_id }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['application', app.id] });
    queryClient.invalidateQueries({ queryKey: ['myApplications'] });
  };

  const handleFormSubmit = async (payload: any) => {
    try {
      if (mode === 'resubmit') {
        // Pass route_id in args — avoids stale closure when user changes route selector
        await resubmitApp.mutateAsync({ form_data: payload.form_data ?? payload, route_id: selectedRouteId || undefined });
      } else {
        await updateDraft.mutateAsync(payload);
        await submitApp.mutateAsync();
      }
      invalidate();
      onSuccess();
    } catch (err: any) {
      const msg = err?.data?.error ?? err?.message ?? t('error_load');
      show(msg, 'error');
    }
  };

  const handleDraftSave = async (payload: any) => {
    try {
      await updateDraft.mutateAsync(payload);
      invalidate();
      show(t('toast_draft_updated'), 'success');
    } catch (err: any) {
      show(`${t('error_load')}: ${err.message}`, 'error');
    }
  };

  const isDraftTransport = app.component_type === 'transportation';

  const template = {
    id: app.template_id,
    title_ja: app.template_name,
    schema_definition: app.schema_definition,
    settlement_schema: app.settlement_schema ?? { fields: [] },
    component_type: app.component_type,
  };

  return (
    <div className="space-y-5 animate-fade-up">
      {toast && <Toast {...toast} onDismiss={dismiss} />}

      <RoutePreviewCard
        selectedRouteId={selectedRouteId}
        setSelectedRouteId={setSelectedRouteId}
        routePreview={routePreview}
        routeLoading={routeLoading}
        t={t}
      />

      {isDraftTransport ? (
        <TransportationForm
          template={template}
          defaultValues={app.form_data as unknown as Partial<TransportFormData>}
          onSubmit={handleFormSubmit}
          onDraft={mode === 'draft' ? handleDraftSave : undefined}
          disabled={routePreview?.department_has_route === false}
        />
      ) : (
        <DynamicForm
          template={template}
          defaultValues={app.form_data}
          onSubmit={handleFormSubmit}
          onDraft={mode === 'draft' ? handleDraftSave : undefined}
          disabled={routePreview?.department_has_route === false}
          submitLabel={mode === 'resubmit' ? t('btn_resubmit') : undefined}
        />
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t, lang } = useLang();
  const dateLocale = lang === 'en' ? 'en-US' : 'ja-JP';

  const { data: app, isLoading } = useQuery<ApplicationDetail>({
    queryKey: ['application', id],
    queryFn: async () => (await apiClient.get(`/applications/${id}`)).data,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  // Approval actions (visible when current user is a pending approver)
  const [approvalComment, setApprovalComment] = useState('');
  const [approvalAction, setApprovalAction] = useState<'approve' | 'return' | 'reject' | null>(null);
  const { toast: approvalToast, show: showToast, dismiss: dismissApprovalToast } = useToast();

  const invalidateApp = () => queryClient.invalidateQueries({ queryKey: ['application', id] });

  const approveMutation = useMutation({
    mutationFn: async (comment: string) => (await apiClient.post(`/approvals/${id}/approve`, { comment })).data,
    onSuccess: (data) => {
      showToast(data.completed ? `🎉 ${t('status_completed')}` : data.final ? `✅ ${t('approvals_final_btn')}` : `✅ ${t('toast_approved')}`);
      setApprovalAction(null); setApprovalComment(''); invalidateApp();
    },
    onError: (err: any) => showToast(`${t('toast_approve_fail')}: ${err.message}`, 'error'),
  });
  const returnMutation = useMutation({
    mutationFn: async (comment: string) => (await apiClient.post(`/approvals/${id}/return`, { comment })).data,
    onSuccess: () => { showToast(`↩ ${t('toast_returned')}`); setApprovalAction(null); setApprovalComment(''); invalidateApp(); },
    onError: (err: any) => showToast(`${t('toast_return_fail')}: ${err.message}`, 'error'),
  });
  const rejectMutation = useMutation({
    mutationFn: async (comment: string) => (await apiClient.post(`/approvals/${id}/reject`, { comment })).data,
    onSuccess: () => { showToast(`✕ ${t('toast_rejected')}`); setApprovalAction(null); setApprovalComment(''); invalidateApp(); },
    onError: (err: any) => showToast(`${t('toast_reject_fail')}: ${err.message}`, 'error'),
  });
  const isMutating = approveMutation.isPending || returnMutation.isPending || rejectMutation.isPending;

  const handleApprovalSubmit = () => {
    if (!approvalAction) return;
    if (approvalAction === 'approve') approveMutation.mutate(approvalComment);
    else if (approvalAction === 'return') returnMutation.mutate(approvalComment);
    else rejectMutation.mutate(approvalComment);
  };

  const STATUS_LABEL: Record<string, string> = {
    PENDING_APPROVAL: t('status_pending'),
    APPROVED:         t('status_approved'),
    REJECTED:         t('status_rejected'),
    RETURNED:         t('status_returned'),
    DRAFT:            t('status_draft'),
    CANCELLED:        t('status_cancelled'),
    COMPLETED:           t('status_completed'),
    PENDING_SETTLEMENT:  t('status_pending_settle'),
    SETTLEMENT_APPROVED: t('status_settle_approved'),
  };

  if (isLoading) return <Layout title={t('loading')}><RingoLoader.Block /></Layout>;
  if (!app) return <Layout title={t('error_load')}><div className="p-8 text-ringo-500 font-bold">{t('settle_not_found')}</div></Layout>;

  if (app.status === 'DRAFT') {
    return (
      <Layout title={`${t('detail_draft_prefix')}: ${app.template_name}`}>
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="md:hidden flex items-center gap-1.5 text-sm font-semibold text-warmgray-500 hover:text-warmgray-800 transition-colors mb-4"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            {lang === 'en' ? 'Back' : '戻る'}
          </button>
          <DraftEditor app={app} onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['application', id] });
            navigate('/history');
          }} />
        </div>
      </Layout>
    );
  }

  // ── Shared helpers ────────────────────────────────────────────────────────────

  // Filter out CANCELLED steps — dead branches from return+resubmit, no display value
  const ringiSteps  = app.steps.filter((s) => (s.stage === 'RINGI' || !s.stage) && s.status !== 'CANCELLED');
  const settleSteps = app.steps.filter((s) => s.stage === 'SETTLEMENT' && s.status !== 'CANCELLED');
  const hasSettlementData = app.settlement_data && Object.keys(app.settlement_data).length > 0;

  const stepDot = (step: Step) =>
    `absolute -left-[11px] top-0 w-5 h-5 rounded-full border-4 border-[#F4F2EF] shadow-sm ${
      step.status === 'APPROVED' ? 'bg-emerald-500' :
      step.status === 'REJECTED' || step.status === 'RETURNED' ? 'bg-ringo-500' :
      step.status === 'PENDING' ? 'bg-mustard-500 ring-2 ring-mustard-300 animate-pulse' : 'bg-warmgray-300'
    }`;

  const renderStep = (step: Step) => (
    <div key={`${step.stage}-${step.step_order}`} className="relative pl-6">
      <div className={stepDot(step)} />
      <div className="-mt-1">
        <div className="font-bold text-sm text-warmgray-800">{step.label}</div>
        <div className="text-xs font-medium text-warmgray-500 mt-0.5">
          {step.approver_name || t('detail_unassigned')}
        </div>
        {step.acted_at && (
          <div className="text-[10px] text-warmgray-400 mt-1">
            {new Date(step.acted_at).toLocaleString(dateLocale)}
          </div>
        )}
        {step.comment && (
          <div className={`mt-2 text-xs p-2.5 rounded-lg min-w-0 overflow-hidden ${
            step.status === 'RETURNED'
              ? 'bg-amber-50 border border-amber-200 text-amber-800'
              : 'bg-white/60 border border-white/80 text-warmgray-700'
          }`}>
            <span className="font-bold">{t('detail_comment')}:</span>
            <CollapsibleComment text={step.comment} className="mt-0.5" />
          </div>
        )}
      </div>
    </div>
  );

  // Render steps with round dividers (round = floor(step_order / 100))
  // Round 0 = original submission, round 1+ = resubmissions
  const renderStepsWithDividers = (steps: Step[]) => {
    const sorted = [...steps].sort((a, b) => a.step_order - b.step_order);
    const nodes: React.ReactNode[] = [];
    let prevRound = -1;

    sorted.forEach((step) => {
      const round = Math.floor(step.step_order / 100);
      if (round !== prevRound) {
        if (prevRound >= 0) {
          // Insert divider between rounds
          nodes.push(
            <div key={`divider-${round}`} className="relative pl-6 my-2">
              <div className="absolute -left-[1px] top-0 bottom-0 border-l-2 border-dashed border-amber-300" />
              <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 w-fit -ml-4 z-10 relative">
                <svg className="w-3 h-3 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
                <span className="text-[10px] font-bold text-amber-700">{t('round_resubmit')}{round}</span>
              </div>
            </div>,
          );
        }
        prevRound = round;
      }
      nodes.push(renderStep(step));
    });
    return nodes;
  };

  // ── RETURNED: detect which phase was returned ────────────────────────────────
  if (app.status === 'RETURNED') {
    // Settlement return: there are SETTLEMENT steps with status = RETURNED
    const isSettlementReturned = settleSteps.some((s) => s.status === 'RETURNED');

    // Find the specific returned step (most recent) for the return-reason banner
    const allSteps = isSettlementReturned ? settleSteps : ringiSteps;
    const returnedStep = [...allSteps]
      .sort((a, b) => b.step_order - a.step_order)
      .find((s) => s.status === 'RETURNED');

    const onResubmitSuccess = () => {
      queryClient.invalidateQueries({ queryKey: ['application', id] });
      navigate('/history');
    };

    return (
      <Layout title={app.template_name}>
        <div className="max-w-5xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="md:hidden flex items-center gap-1.5 text-sm font-semibold text-warmgray-500 hover:text-warmgray-800 transition-colors mb-4"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          {lang === 'en' ? 'Back' : '戻る'}
        </button>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-up">

          {/* Left: return notice + editor */}
          <div className="lg:col-span-2 space-y-5">

            {/* Phase indicator */}
            {isSettlementReturned && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-teal-50/80 border border-teal-200/60 text-teal-700 text-xs font-semibold">
                <span>💴</span>
                {t('phase_settlement')} — {t('returned_reason_title')}
              </div>
            )}

            {/* Return reason banner */}
            {returnedStep && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-5 py-4 space-y-2">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                  <p className="text-sm font-bold text-amber-800">{t('returned_reason_title')}</p>
                  {returnedStep.approver_name && (
                    <span className="ml-auto text-[11px] text-amber-600 font-medium">{t('returned_by')}: {returnedStep.approver_name}</span>
                  )}
                </div>
                {returnedStep.comment ? (
                  <div className="pl-6 min-w-0 overflow-hidden">
                    <CollapsibleComment
                      text={returnedStep.comment}
                      className="text-sm text-amber-900 font-medium leading-relaxed"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-amber-600 pl-6">{t('not_entered')}</p>
                )}
                <p className="text-xs text-amber-600 pl-6">{t('returned_edit_hint')}</p>
              </div>
            )}

            {/* Settlement resubmit editor */}
            {isSettlementReturned ? (
              <SettlementReturnEditor app={app} onSuccess={onResubmitSuccess} />
            ) : (
              <DraftEditor app={app} mode="resubmit" onSuccess={onResubmitSuccess} />
            )}
          </div>

          {/* Right: full history timeline (both RINGI + SETTLEMENT) */}
          <div className="space-y-4">
            <p className="section-title ml-2">{t('detail_timeline')}</p>

            <div className="card pt-6 pb-2">
              {app.has_settlement && (
                <p className="text-[10px] font-bold uppercase tracking-widest text-ringo-400 mb-4 ml-4">{t('phase_ringi')}</p>
              )}
              <div className="relative border-l-2 border-ringo-200 ml-4 space-y-8 pb-4">
                {renderStepsWithDividers(ringiSteps)}
              </div>
            </div>

            {settleSteps.length > 0 && (
              <div className="card pt-6 pb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-teal-500 mb-4 ml-4">{t('phase_settlement')}</p>
                <div className="relative border-l-2 border-teal-200 ml-4 space-y-8 pb-4">
                  {renderStepsWithDividers(settleSteps)}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
      </Layout>
    );
  }

  return (
    <Layout title={t('title_history')}>
      {approvalToast && <Toast {...approvalToast} onDismiss={dismissApprovalToast} />}
      <button
        onClick={() => navigate(-1)}
        className="md:hidden flex items-center gap-1.5 text-sm font-semibold text-warmgray-500 hover:text-warmgray-800 transition-colors mb-4"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        {lang === 'en' ? 'Back' : '戻る'}
      </button>
      <div className="max-w-[1800px] mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-up">

        {/* Left: main content */}
        <div className="lg:col-span-2 space-y-6">

          {/* RINGI application data */}
          <div className="card space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-white/40 pb-5">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={STATUS_BADGE[app.status] ?? 'badge-draft'}>
                    {STATUS_LABEL[app.status] ?? app.status}
                  </span>
                  <PatternBadge patternId={app.pattern_id} size="sm" />
                </div>
                <h2 className="text-2xl font-bold text-warmgray-800 mt-3">{app.template_name}</h2>
                <div className="flex items-center gap-3 mt-2 text-xs font-medium text-warmgray-500">
                  <span className="font-mono">{app.application_number ?? t('detail_no_number')}</span>
                  <span>•</span>
                  <span>{t('detail_submitted_lbl')}: {new Date(app.created_at).toLocaleDateString(dateLocale)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <UserAvatar name={app.applicant_name} avatarUrl={app.applicant_avatar} size={9} />
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-widest text-warmgray-400 mb-0.5">{t('detail_applicant_lbl')}</p>
                  <p className="font-bold text-warmgray-800 text-sm">{app.applicant_name}</p>
                </div>
              </div>
            </div>

            <div>
              <p className="section-title mb-4">{t('detail_content')}</p>
              {app.component_type === 'transportation' ? (
                <TransportationDetail
                  formData={app.form_data}
                  dailyAllowanceRate={app.applicant_daily_rate}
                  schema={app.schema_definition ?? undefined}
                />
              ) : (
                <FormDataViewer app={app} />
              )}
            </div>
          </div>

          {/* Approval action panel — shown when current user is pending approver */}
          {app.can_approve && (
            <div className="card border border-amber-200/70 bg-amber-50/40 space-y-4 animate-fade-up">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs font-bold shrink-0">✓</span>
                <p className="font-bold text-amber-900 text-sm">{lang === 'en' ? 'Your approval is required' : 'あなたの承認が必要です'}</p>
              </div>
              {approvalAction ? (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-warmgray-600">
                    {approvalAction === 'approve' && (lang === 'en' ? 'Comment (optional)' : 'コメント（任意）')}
                    {approvalAction === 'return'  && (lang === 'en' ? 'Return reason (required)' : '差し戻し理由（必須）')}
                    {approvalAction === 'reject'  && (lang === 'en' ? 'Rejection reason (required)' : '却下理由（必須）')}
                  </p>
                  <textarea
                    value={approvalComment}
                    onChange={(e) => setApprovalComment(e.target.value)}
                    rows={3}
                    className="input w-full resize-none text-sm"
                    placeholder={approvalAction === 'approve' ? (lang === 'en' ? 'Add a comment…' : 'コメントを入力…') : (lang === 'en' ? 'Please provide a reason…' : '理由を入力してください…')}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleApprovalSubmit}
                      disabled={isMutating || ((approvalAction === 'return' || approvalAction === 'reject') && !approvalComment.trim())}
                      className={`btn text-white text-sm ${approvalAction === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : approvalAction === 'return' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-red-600 hover:bg-red-700'} disabled:opacity-50`}
                    >
                      {isMutating ? '…' : approvalAction === 'approve' ? (lang === 'en' ? '✓ Approve' : '✓ 承認') : approvalAction === 'return' ? (lang === 'en' ? '↩ Return' : '↩ 差し戻し') : (lang === 'en' ? '✕ Reject' : '✕ 却下')}
                    </button>
                    <button onClick={() => { setApprovalAction(null); setApprovalComment(''); }} className="btn btn-ghost text-sm">{lang === 'en' ? 'Cancel' : 'キャンセル'}</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setApprovalAction('approve')} className="btn bg-emerald-600 text-white hover:bg-emerald-700 text-sm">✓ {lang === 'en' ? 'Approve' : '承認'}</button>
                  <button onClick={() => setApprovalAction('return')}  className="btn bg-amber-500  text-white hover:bg-amber-600  text-sm">↩ {lang === 'en' ? 'Return' : '差し戻し'}</button>
                  <button onClick={() => setApprovalAction('reject')}  className="btn bg-red-600    text-white hover:bg-red-700    text-sm">✕ {lang === 'en' ? 'Reject' : '却下'}</button>
                </div>
              )}
            </div>
          )}

          {/* Settlement prompt (APPROVED + not yet settled) */}
          {app.status === 'APPROVED' && app.settlement_schema && !hasSettlementData && (
            <div className="card border border-teal-200/60 bg-teal-50/40 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-teal-900 flex items-center gap-2">
                  <span className="bg-teal-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">✓</span>
                  {t('detail_ringi_approved')}
                </h3>
                <p className="text-xs text-teal-800 mt-1">{t('detail_settle_hint')}</p>
              </div>
              <button
                onClick={() => navigate(`/applications/${app.id}/settlement`)}
                className="btn bg-teal-600 text-white hover:bg-teal-700 shadow-sm shrink-0 whitespace-nowrap"
              >
                💴 {t('detail_create_settle')}
              </button>
            </div>
          )}

          {/* Settlement data (filled after PENDING_SETTLEMENT / COMPLETED) */}
          {hasSettlementData && app.settlement_schema && (
            <div className="card space-y-4 border border-teal-200/40">
              <div className="flex items-center gap-2 pb-3 border-b border-white/30">
                <span className="w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">💴</span>
                <p className="text-sm font-bold text-teal-800 uppercase tracking-widest">{t('detail_settle_data_title')}</p>
              </div>
              <SettlementDataViewer app={app} t={t} />
            </div>
          )}
        </div>

        {/* Right: timeline */}
        <div className="space-y-4">
          <p className="section-title ml-2">{t('detail_timeline')}</p>

          {/* RINGI steps — hidden for pattern_id=2 (direct settlement, no ringi phase) */}
          {ringiSteps.length > 0 && (
            <div className="card pt-6 pb-2">
              {app.has_settlement && (
                <p className="text-[10px] font-bold uppercase tracking-widest text-ringo-400 mb-4 ml-4">{t('phase_ringi')}</p>
              )}
              <div className="relative border-l-2 border-ringo-200 ml-4 space-y-8 pb-4">
                {renderStepsWithDividers(ringiSteps)}
              </div>
            </div>
          )}

          {/* SETTLEMENT steps (only shown if they exist) */}
          {settleSteps.length > 0 && (
            <div className="card pt-6 pb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-teal-500 mb-4 ml-4">{t('phase_settlement')}</p>
              <div className="relative border-l-2 border-teal-200 ml-4 space-y-8 pb-4">
                {renderStepsWithDividers(settleSteps)}
              </div>
            </div>
          )}

          {/* Fallback: transportation apps with no steps yet (auto-approved edge case) */}
          {ringiSteps.length === 0 && settleSteps.length === 0 && (
            <div className="card pt-6 pb-2">
              <div className="relative border-l-2 border-warmgray-200 ml-4 pb-4 text-sm text-warmgray-400">
                {lang === 'ja' ? 'ステップなし（自動承認）' : 'No steps (auto-approved)'}
              </div>
            </div>
          )}
        </div>

      </div>
    </Layout>
  );
}
