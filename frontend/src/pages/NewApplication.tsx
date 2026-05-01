import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import DynamicForm from '../components/forms/DynamicForm';

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

// ── Approval chain visual ─────────────────────────────────────────────────────

function ChevronRight() {
  return (
    <svg className="w-3.5 h-3.5 text-surface-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function RoutePreviewCard({ route }: { route: ApprovalRoute }) {
  if (route.steps.length === 0) {
    return (
      <p className="text-xs text-ringo-500">ステップが設定されていません。管理者に連絡してください。</p>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Applicant node */}
      <div className="flex flex-col items-center gap-1">
        <div className="w-9 h-9 rounded-full bg-surface-100 border-2 border-surface-200 flex items-center justify-center text-xs font-bold text-warmgray-600">
          申
        </div>
        <span className="text-[10px] text-warmgray-400">申請者</span>
      </div>

      {route.steps.map((step) => (
        <div key={step.step_order} className="flex items-center gap-2">
          <ChevronRight />
          <div className="flex flex-col items-center gap-1">
            <div className="w-9 h-9 rounded-full bg-ringo-500 flex items-center justify-center text-white text-xs font-bold shadow-xs">
              {step.step_order}
            </div>
            <span className="text-[10px] text-warmgray-700 text-center max-w-[72px] leading-tight font-medium">
              {step.approver_name ?? step.approver_role ?? step.label}
            </span>
            <span className="text-[9px] text-warmgray-400">{step.label}</span>
          </div>
        </div>
      ))}

      {/* Completion node */}
      <div className="flex items-center gap-2">
        <ChevronRight />
        <div className="flex flex-col items-center gap-1">
          <div className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center text-white text-sm shadow-xs">✓</div>
          <span className="text-[10px] text-warmgray-400">完了</span>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NewApplication() {
  const { templateCode } = useParams<{ templateCode: string }>();
  const navigate = useNavigate();
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
      navigate('/history?submitted=1');
    } catch (error: any) {
      console.error('送信エラー:', error);
      alert(`申請に失敗しました: ${error.message}`);
    }
  };

  const handleDraft = async (payload: any) => {
    try {
      await apiClient.post('/applications/draft', payload);
      navigate('/history?drafted=1');
    } catch (error: any) {
      alert(`下書き保存に失敗しました: ${error.message}`);
    }
  };

  return (
    <Layout title="新規申請">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Loading / Error */}
        {templateLoading && (
          <div className="card flex items-center gap-3 text-warmgray-400 py-10 justify-center">
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            フォームを読み込み中...
          </div>
        )}
        {templateError && (
          <div className="card text-ringo-600 text-sm text-center py-8">
            フォームの読み込みに失敗しました。ページをリロードしてください。
          </div>
        )}

        {/* Route preview panel */}
        {template && (
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="section-title mb-0">承認ルート</p>
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
                  読み込み中
                </span>
              )}
            </div>

            {routePreview && !routePreview.department_has_route && (
              <div className="flex items-start gap-2.5 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <span className="text-base">⚠️</span>
                <p>あなたの部署にはこのテンプレートの承認ルートが設定されていません。管理者にお問い合わせください。</p>
              </div>
            )}

            {routePreview && routePreview.routes.length > 1 && (
              <div>
                <label className="label">ルート選択</label>
                <select
                  className="input"
                  value={selectedRouteId}
                  onChange={(e) => setSelectedRouteId(e.target.value)}
                >
                  {routePreview.routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}{r.is_default ? '（デフォルト）' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selectedRoute && (
              <div className="bg-surface-50 rounded-xl p-4">
                <RoutePreviewCard route={selectedRoute} />
              </div>
            )}
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