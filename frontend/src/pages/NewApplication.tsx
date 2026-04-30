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

function RoutePreviewCard({ route }: { route: ApprovalRoute }) {
  return (
    <div className="space-y-2">
      {route.steps.length === 0 ? (
        <p className="text-xs text-ringo-500">ステップが設定されていません。管理者に連絡してください。</p>
      ) : (
        <div className="flex items-center gap-1 flex-wrap">
          {/* Applicant */}
          <div className="flex flex-col items-center">
            <div className="w-8 h-8 rounded-full bg-cream-300 border-2 border-ringo-200 flex items-center justify-center text-xs font-bold text-warmgray-700">
              申
            </div>
            <span className="text-[10px] text-warmgray-600 mt-1">申請者</span>
          </div>

          {route.steps.map((step) => (
            <div key={step.step_order} className="flex items-center gap-1">
              <svg className="w-4 h-4 text-ringo-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <div className="flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-ringo-500 flex items-center justify-center text-white text-xs font-bold">
                  {step.step_order}
                </div>
                <span className="text-[10px] text-warmgray-800 mt-1 text-center max-w-[64px] leading-tight">
                  {step.approver_name ?? step.approver_role ?? step.label}
                </span>
                <span className="text-[9px] text-warmgray-500">{step.label}</span>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-1">
            <svg className="w-4 h-4 text-ringo-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold">✓</div>
              <span className="text-[10px] text-warmgray-600 mt-1">承認完了</span>
            </div>
          </div>
        </div>
      )}
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
      const res = await apiClient.post('/applications', {
        ...payload,
        route_id: selectedRouteId || undefined,
      });
      console.log('保存完了:', res.data);
      alert('🎉 申請が成功しました！');
      navigate('/dashboard');
    } catch (error: any) {
      console.error('送信エラー:', error);
      alert(`申請に失敗しました: ${error.message}`);
    }
  };

  return (
    <Layout title="新規申請">
      <div className="max-w-3xl mx-auto space-y-4">
        {templateLoading && <p className="text-warmgray-600">フォームを読み込み中...</p>}
        {templateError && <p className="text-ringo-500">フォームの読み込みに失敗しました。</p>}

        {/* Route preview panel */}
        {template && (
          <div className="card bg-cream-50 border border-ringo-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-warmgray-800">承認ルート</h3>
              {routeLoading && <span className="text-xs text-warmgray-600">読み込み中...</span>}
            </div>

            {routePreview && !routePreview.department_has_route && (
              <div className="text-sm text-ringo-600 bg-ringo-50 border border-ringo-200 rounded px-3 py-2">
                ⚠ あなたの部署にはこのテンプレートの承認ルートが設定されていません。管理者にお問い合わせください。
              </div>
            )}

            {routePreview && routePreview.routes.length > 1 && (
              <div className="mb-4">
                <label className="label text-xs">ルート選択（複数あります）</label>
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

            {selectedRoute && <RoutePreviewCard route={selectedRoute} />}
          </div>
        )}

        {template && (
          <DynamicForm
            template={template}
            onSubmit={handleFormSubmit}
            isSettlementPhase={false}
            disabled={routePreview?.department_has_route === false}
          />
        )}
      </div>
    </Layout>
  );
}
