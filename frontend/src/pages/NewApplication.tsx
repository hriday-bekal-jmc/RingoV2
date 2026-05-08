import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import DynamicForm from '../components/forms/DynamicForm';
import { useLang } from '../context/LanguageContext';
import CustomSelect from '../components/forms/CustomSelect';
import RouteTimeline from '../components/common/RouteTimeline';

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

// RoutePreviewCard and ChevronRight replaced by RouteTimeline component

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NewApplication() {
  const { templateCode } = useParams<{ templateCode: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useLang();
  const [selectedRouteId, setSelectedRouteId] = useState<string>('');

  const { data: template, isLoading: templateLoading, isError: templateError } = useQuery({
    queryKey: ['template', templateCode],
    queryFn: async () => {
      const res = await apiClient.get(`/templates/${templateCode}`);
      return res.data;
    },
    enabled: !!templateCode,
  });

  const { data: routePreview, isLoading: routeLoading } = useQuery<RoutePreview>({
    queryKey: ['route-preview', template?.id],
    queryFn: async (): Promise<RoutePreview> => {
      const res = await apiClient.get(`/applications/route-preview?template_id=${template.id}`);
      return res.data as RoutePreview;
    },
    enabled: !!template?.id,
  });

  useEffect(() => {
    if (!routePreview) return;
    const def = routePreview.routes.find((r) => r.is_default) ?? routePreview.routes[0];
    if (def) setSelectedRouteId(def.id);
  }, [routePreview]);

  const selectedRoute = routePreview?.routes.find((r) => r.id === selectedRouteId)
    ?? routePreview?.routes[0];

  const handleFormSubmit = async (payload: any) => {
    try {
      await apiClient.post('/applications', {
        ...payload,
        route_id: selectedRouteId || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['myApplications'] });
      navigate('/history?submitted=1');
    } catch (error: any) {
      console.error('Submit error:', error);
      alert(`${t('toast_submit_error')}: ${error.message}`);
    }
  };

  const handleDraft = async (payload: any) => {
    try {
      await apiClient.post('/applications/draft', payload);
      queryClient.invalidateQueries({ queryKey: ['myApplications'] });
      navigate('/history?drafted=1');
    } catch (error: any) {
      alert(`${t('toast_draft_updated')}: ${error.message}`);
    }
  };

  return (
    <Layout title={t('title_new_app')}>
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Loading / Error */}
        {templateLoading && (
          <div className="card flex items-center gap-3 text-warmgray-400 py-10 justify-center">
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            {t('form_loading')}
          </div>
        )}
        {templateError && (
          <div className="card text-ringo-600 text-sm text-center py-8">
            {t('form_load_error')}
          </div>
        )}

        {/* Route preview panel */}
        {template && (
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="section-title mb-0">{t('route_approval')}</p>
                {routePreview?.routes.find(r => r.id === selectedRouteId)?.name && (
                  <p className="text-xs text-warmgray-500 mt-0.5">
                    {routePreview?.routes.find(r => r.id === selectedRouteId)?.name}
                  </p>
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
                <p>{t('route_no_route_warn')}</p>
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
                  accent="ringo"
                />
              </div>
            )}
          </div>
        )}

        {/* Two-stage flow banner for 立替精算申請 */}
        {template?.settlement_schema && (
          <div className="card !py-3 !px-4 border border-teal-200/60 bg-teal-50/40 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-teal-600">{t('two_stage_flow_label')}</span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 border border-teal-200/60">💴 {t('two_stage_badge')}</span>
            </div>
            {/* Visual 3-phase chain */}
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-warmgray-600">
              {/* Phase 1: RINGI */}
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-ringo-500 flex items-center justify-center text-white text-[9px] font-bold shrink-0">1</span>
                <span className="font-medium">{t('phase_ringi')}</span>
              </div>
              <svg className="w-3 h-3 text-warmgray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              {/* Phase 2: 精算入力 (user action) */}
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center text-white text-[9px] font-bold shrink-0">2</span>
                <span className="font-medium">{t('phase_waiting_settle')}</span>
              </div>
              <svg className="w-3 h-3 text-warmgray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              {/* Phase 3: Settlement approval */}
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center text-white text-[9px] font-bold shrink-0">3</span>
                <span className="font-medium">{t('phase_settlement')}</span>
              </div>
              <svg className="w-3 h-3 text-warmgray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[10px] shrink-0">✓</span>
                <span className="font-medium">{t('route_done_node')}</span>
              </div>
            </div>
            <p className="text-[11px] text-teal-700">{t('two_stage_hint')}</p>
          </div>
        )}

        {template && (
          <DynamicForm
            template={template}
            onSubmit={handleFormSubmit}
            onDraft={handleDraft}
            isSettlementPhase={false}
            disabled={routePreview?.department_has_route === false}
          />
        )}
      </div>
    </Layout>
  );
}
