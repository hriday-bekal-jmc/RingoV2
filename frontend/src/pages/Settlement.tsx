import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import RingoLoader from '../components/common/RingoLoader';
import DynamicForm from '../components/forms/DynamicForm';
import { useLang } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import CustomSelect from '../components/forms/CustomSelect';
import RouteTimeline from '../components/common/RouteTimeline';
import RepeatGroupDisplay from '../components/forms/RepeatGroupDisplay';
import { FieldValueContent, type DisplayField } from '../components/forms/FieldValueDisplay';

interface FormField {
  name: string;
  label: string;
  label_en?: string | null;
  type: string;
  required?: boolean;
  multiple?: boolean;
  computed?: boolean;
  computes?: string;
  sum_target?: string;
  fields?: FormField[];
  min_rows?: number;
  max_rows?: number;
  add_label?: string;
  add_label_en?: string;
}

interface AppDetail {
  id: string;
  template_id: string;
  application_number: string | null;
  status: string;
  form_data: Record<string, any>;
  template_name: string;
  template_code: string;
  has_settlement: boolean;
  settlement_schema: { fields: FormField[] } | null;
  schema_definition: { fields: FormField[] };
  steps: Array<{ step_order: number; stage: string; status: string; label: string; approver_name?: string; acted_at?: string; comment?: string }>;
}

// ── Read-only field display ────────────────────────────────────────────────────
function formatReadValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join('\n');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value, null, 2);
  return String(value);
}

function shouldSpanSummary(value: unknown, type?: string): boolean {
  const text = value == null ? '' : formatReadValue(value);
  return type === 'repeat_group' || type === 'textarea' || type === 'file' || text.length > 80 || text.includes('\n');
}

const RICH_TYPES = new Set(['user_picker', 'route_entry', 'allowance_days', 'file', 'ai_file_reader']);

function ReadField({
  label,
  value,
  field,
  fullWidth = false,
}: {
  label: string;
  value: unknown;
  field?: DisplayField;
  fullWidth?: boolean;
}) {
  if (value == null || value === '') return null;

  // Rich types: delegate to FieldValueContent for proper rendering
  if (field && RICH_TYPES.has(field.type)) {
    return (
      <div className={`min-w-0 ${fullWidth ? 'md:col-span-2' : ''}`}>
        <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-0.5 break-words [overflow-wrap:anywhere]">
          {label}
        </dt>
        <dd className="text-sm leading-relaxed text-warmgray-800 break-words [overflow-wrap:anywhere]">
          <FieldValueContent
            field={field}
            value={value}
            renderRepeat={(f, v) => <RepeatGroupDisplay field={f as FormField} value={v} compact />}
          />
        </dd>
      </div>
    );
  }

  const text = formatReadValue(value);
  return (
    <div className={`min-w-0 ${fullWidth ? 'md:col-span-2' : ''}`}>
      <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-0.5 break-words [overflow-wrap:anywhere]">
        {label}
      </dt>
      <dd className="text-sm leading-relaxed text-warmgray-800 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
        {text}
      </dd>
    </div>
  );
}

// ── Original RINGI summary ─────────────────────────────────────────────────────
function RingiSummary({ app, badge }: { app: AppDetail; badge: string }) {
  const fields = app.schema_definition?.fields ?? [];
  const data = app.form_data ?? {};
  return (
    <div className="card space-y-3">
      <div className="flex items-start gap-2 mb-2 min-w-0 flex-wrap">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        <h4 className="min-w-0 text-xs font-bold uppercase tracking-widest text-warmgray-500 break-words [overflow-wrap:anywhere]">
          {badge}
        </h4>
        {app.application_number && (
          <span className="ml-auto max-w-full text-[11px] font-mono text-warmgray-400 break-all">{app.application_number}</span>
        )}
      </div>
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
        {fields.length > 0
          ? fields.map((f) => {
              if (f.type === 'repeat_group') {
                return (
                  <div key={f.name} className="min-w-0 md:col-span-2">
                    <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-1 break-words [overflow-wrap:anywhere]">
                      {f.label}
                    </dt>
                    <dd className="text-sm leading-relaxed text-warmgray-800">
                      <RepeatGroupDisplay field={f} value={data[f.name]} compact />
                    </dd>
                  </div>
                );
              }
              return (
                <ReadField
                  key={f.name}
                  label={f.label}
                  value={data[f.name]}
                  field={f as DisplayField}
                  fullWidth={shouldSpanSummary(data[f.name], f.type)}
                />
              );
            })
          : Object.entries(data).map(([k, v]) => (
              <ReadField key={k} label={k} value={v} fullWidth={shouldSpanSummary(v)} />
            ))
        }
      </dl>
    </div>
  );
}

// ── Route preview types + visual (shared pattern with NewApplication) ─────────
interface RouteStep {
  step_order: number;
  label: string;
  action_type: string;
  approver_name?: string;
  approver_role?: string;
}

interface ApprovalRoute {
  id: string;
  name: string;
  is_default: boolean;
  steps: RouteStep[];
}

interface RoutePreview {
  routes: ApprovalRoute[];
  department_has_route: boolean;
}

// ChevronRight and SettlementRoutePreviewCard replaced by RouteTimeline component

// ── Expected amount reference card ────────────────────────────────────────────
function ExpectedAmountCard({ app, t }: { app: AppDetail; t: (k: any) => string }) {
  const expected = Number(app.form_data?.expected_amount);
  if (!expected) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50/80 border border-amber-200/60 min-w-0 flex-wrap">
      <span className="text-xl shrink-0">📋</span>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700 break-words [overflow-wrap:anywhere]">{t('settle_expected_label')}</p>
        <p className="text-lg font-bold text-amber-800">¥{expected.toLocaleString('ja-JP')}</p>
      </div>
      <p className="ml-auto min-w-0 text-xs text-amber-600 break-words [overflow-wrap:anywhere]">{t('settle_expected_hint')}</p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Settlement() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useLang();
  const { user: authUser } = useAuth();

  const [selectedRouteId, setSelectedRouteId] = useState<string>('');

  const { data: app, isLoading, isError } = useQuery<AppDetail>({
    queryKey: ['application', id],
    queryFn: async () => (await apiClient.get(`/applications/${id}`)).data,
    enabled: !!id,
    staleTime: 60_000,
  });

  // Fetch SETTLEMENT routes for this template
  const { data: routePreview, isLoading: routeLoading } = useQuery<RoutePreview>({
    queryKey: ['settle-route-preview', app?.template_id],
    queryFn: async (): Promise<RoutePreview> => {
      const res = await apiClient.get(
        `/applications/route-preview?template_id=${app!.template_id}&stage=SETTLEMENT`,
      );
      return res.data as RoutePreview;
    },
    enabled: !!app?.template_id && app.status === 'APPROVED' && app.has_settlement,
  });

  useEffect(() => {
    if (!routePreview) return;
    const def = routePreview.routes.find((r) => r.is_default) ?? routePreview.routes[0];
    if (def) setSelectedRouteId(def.id);
  }, [routePreview]);

  const selectedRoute = routePreview?.routes.find((r) => r.id === selectedRouteId) ?? routePreview?.routes[0];

  const mutation = useMutation({
    mutationFn: async (settlement_data: Record<string, unknown>) =>
      (await apiClient.post(`/applications/${id}/start-settlement`, {
        settlement_data,
        route_id: selectedRouteId || undefined,
      })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myApplications'] });
      queryClient.invalidateQueries({ queryKey: ['application', id] });
      navigate('/history?settled=1');
    },
  });

  if (isLoading) {
    return (
      <Layout title={t('title_settlement')}>
        <RingoLoader.Block />
      </Layout>
    );
  }

  if (isError || !app) {
    return (
      <Layout title={t('title_settlement')}>
        <div className="card text-center py-12 text-ringo-500 text-sm">
          {t('settle_not_found')}
          <Link to="/history" className="block mt-3 text-xs text-ringo-400 hover:text-ringo-600">← {t('settle_back')}</Link>
        </div>
      </Layout>
    );
  }

  // Guard: only APPROVED + has settlement_schema
  if (app.status !== 'APPROVED' || !app.has_settlement || !app.settlement_schema) {
    return (
      <Layout title={t('title_settlement')}>
        <div className="card text-center py-12 text-warmgray-500 text-sm">
          {t('settle_not_available')}
          <Link to="/history" className="block mt-3 text-xs text-ringo-400 hover:text-ringo-600">← {t('settle_back')}</Link>
        </div>
      </Layout>
    );
  }

  // Build a pseudo-template object for DynamicForm
  const pseudoTemplate = {
    id: app.id,
    title_ja: app.template_name,
    schema_definition: app.schema_definition,
    settlement_schema: app.settlement_schema,
  };

  return (
    <Layout title={t('title_settlement')}>
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="animate-fade-up">
          <Link to="/history" className="text-xs text-warmgray-400 hover:text-ringo-500 transition-colors mb-3 inline-flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            {t('settle_back')}
          </Link>
          <div className="flex items-start gap-3 mt-1 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center text-xl shrink-0">💴</div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-warmgray-800 break-words [overflow-wrap:anywhere]">{app.template_name} — {t('settle_suffix')}</h2>
              <p className="text-xs text-warmgray-400 mt-0.5 break-words [overflow-wrap:anywhere]">{t('settle_subtitle')}</p>
            </div>
          </div>
        </div>

        {/* Settlement route preview panel */}
        <div className="animate-fade-up card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="section-title mb-0">{t('settle_route_title')}</p>
              {selectedRoute?.name && (
                <p className="text-xs text-warmgray-500 mt-0.5">{selectedRoute.name}</p>
              )}
            </div>
            {routeLoading && (
              <span className="text-xs text-warmgray-400 flex items-center gap-1">
                <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                {t('route_loading')}
              </span>
            )}
          </div>

          {routePreview && !routePreview.department_has_route && (
            <div className="flex items-start gap-2.5 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <span className="text-base">⚠️</span>
              <p>{t('settle_no_route_warn')}</p>
            </div>
          )}

          {routePreview && routePreview.routes.length > 1 && (
            <div className="space-y-1.5">
              <label className="label">{t('route_select')}</label>
              <CustomSelect
                options={routePreview.routes.map((r) => ({
                  value: r.id,
                  label: `${r.name}${r.is_default ? t('route_default_suffix') : ''}`,
                }))}
                value={selectedRouteId}
                onChange={setSelectedRouteId}
              />
            </div>
          )}

          {selectedRoute && (
            <div className="bg-white/40 backdrop-blur-sm rounded-xl border border-white/60 p-4">
              <RouteTimeline
                steps={selectedRoute.steps}
                originLabel={t('route_applicant_node')}
                doneLabel={t('route_done_node')}
                emptyMessage={t('route_no_steps')}
                accent="teal"
              />
            </div>
          )}
        </div>

        {/* Original RINGI summary */}
        <div className="animate-fade-up">
          <p className="section-title mb-3">{t('settle_original')}</p>
          <RingiSummary app={app} badge={t('settle_original_badge')} />
        </div>

        {/* Settlement form */}
        <div className="animate-fade-up">
          <p className="section-title mb-3">{t('settle_form_title')}</p>
          {mutation.isError && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-red-50/80 border border-red-200/60 text-red-600 text-sm">
              {(mutation.error as any)?.response?.data?.error ?? t('toast_submit_error')}
            </div>
          )}
          <ExpectedAmountCard app={app} t={t} />
          <div className="mt-4">
            <DynamicForm
              template={pseudoTemplate as any}
              isSettlementPhase={true}
              externalValues={{ _daily_rate: authUser?.daily_allowance_rate ?? 3000 }}
              onSubmit={async (data) => {
                const settlementData = (data?.form_data ?? data) as Record<string, unknown>;
                await mutation.mutateAsync(settlementData);
              }}
              disabled={mutation.isPending || routePreview?.department_has_route === false}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}
