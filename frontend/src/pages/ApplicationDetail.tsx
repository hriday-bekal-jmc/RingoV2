import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import DynamicForm from '../components/forms/DynamicForm';
import Toast, { useToast } from '../components/common/Toast';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Step {
  step_order: number;
  label: string;
  status: string;
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
  status: string;
  form_data: Record<string, any>;
  schema_definition: { fields: any[] };
  settlement_schema: { fields: any[] };
  steps: Step[];
  created_at: string;
}

// ── UI Components ─────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  PENDING_APPROVAL: 'badge-pending',
  APPROVED: 'badge-approved',
  REJECTED: 'badge-rejected',
  RETURNED: 'badge-returned',
  DRAFT: 'badge-draft',
  CANCELLED: 'badge-draft',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: '承認待ち',
  APPROVED: '承認済み',
  REJECTED: '却下',
  RETURNED: '差し戻し',
  DRAFT: '下書き',
  CANCELLED: 'キャンセル',
};

function ChevronRight() {
  return (
    <svg className="w-3.5 h-3.5 text-surface-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

// ── View Mode: 申請データを綺麗に表示するコンポーネント ──
function FormDataViewer({ app }: { app: ApplicationDetail }) {
  const fields = app.schema_definition?.fields ?? [];
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
      {fields.map((f) => {
        const val = app.form_data[f.name];
        const isLong = f.type === 'textarea' || (typeof val === 'string' && val.length > 40);
        return (
          <div key={f.name} className={isLong ? 'col-span-full' : ''}>
            <dt className="text-[11px] font-bold uppercase tracking-widest text-warmgray-400 mb-1">{f.label}</dt>
            <dd className="text-sm font-medium text-warmgray-800 bg-white/60 border border-white/80 px-3.5 py-2.5 rounded-xl break-words min-h-[42px]">
              {val != null && val !== '' ? String(val) : <span className="text-warmgray-300">—</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

// ── Draft Editor: 下書きを編集・提出するコンポーネント ──
function DraftEditor({ app, onSuccess }: { app: ApplicationDetail; onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const [selectedRouteId, setSelectedRouteId] = useState<string>('');
  const { toast, show, dismiss } = useToast();

  const { data: routePreview, isLoading: routeLoading } = useQuery({
    queryKey: ['route-preview', app.template_id],
    queryFn: async () => (await apiClient.get(`/applications/route-preview?template_id=${app.template_id}`)).data,
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

  const handleFormSubmit = async (payload: any) => {
    try {
      await updateDraft.mutateAsync(payload);
      await submitApp.mutateAsync();
      queryClient.invalidateQueries({ queryKey: ['application', app.id] });
      queryClient.invalidateQueries({ queryKey: ['myApplications'] });
      onSuccess();
    } catch (err: any) {
      show(`エラー: ${err.message}`, 'error');
    }
  };

  const handleDraftSave = async (payload: any) => {
    try {
      await updateDraft.mutateAsync(payload);
      queryClient.invalidateQueries({ queryKey: ['application', app.id] });
      queryClient.invalidateQueries({ queryKey: ['myApplications'] });
      show('下書きを更新しました', 'success');
    } catch (err: any) {
      show(`エラー: ${err.message}`, 'error');
    }
  };

  const template = {
    id: app.template_id,
    title_ja: app.template_name,
    schema_definition: app.schema_definition,
    settlement_schema: app.settlement_schema,
  };

  const selectedRoute = routePreview?.routes?.find((r: any) => r.id === selectedRouteId) ?? routePreview?.routes?.[0];

  return (
    <div className="space-y-5 animate-fade-up">
      {toast && <Toast {...toast} onDismiss={dismiss} />}
      
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="section-title mb-0">承認ルートを選択</p>
            {selectedRoute?.name && <p className="text-xs text-warmgray-500 mt-0.5">{selectedRoute.name}</p>}
          </div>
          {routeLoading && <span className="text-xs text-warmgray-400">読み込み中...</span>}
        </div>

        {routePreview && !routePreview.department_has_route && (
          <div className="flex items-start gap-2.5 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <span>⚠️</span>
            <p>このテンプレートの承認ルートが部署に設定されていません。管理者に連絡してください。</p>
          </div>
        )}

        {routePreview?.routes?.length > 1 && (
          <select className="input" value={selectedRouteId} onChange={(e) => setSelectedRouteId(e.target.value)}>
            {routePreview.routes.map((r: any) => (
              <option key={r.id} value={r.id}>{r.name}{r.is_default ? '（デフォルト）' : ''}</option>
            ))}
          </select>
        )}

        {/* ── ★修正箇所：承認者の名前が正しく表示されるように変更しました ── */}
        {selectedRoute && (
          <div className="bg-surface-50 rounded-xl p-4 flex items-center gap-2 flex-wrap">
            <div className="flex flex-col items-center gap-1">
              <div className="w-9 h-9 rounded-full bg-surface-100 border-2 border-surface-200 flex items-center justify-center text-xs font-bold text-warmgray-600">申</div>
              <span className="text-[10px] text-warmgray-400">申請者</span>
            </div>
            
            {selectedRoute.steps.map((step: any) => (
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

            <div className="flex items-center gap-2">
              <ChevronRight />
              <div className="flex flex-col items-center gap-1">
                <div className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center text-white text-sm shadow-xs">✓</div>
                <span className="text-[10px] text-warmgray-400">完了</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <DynamicForm
        template={template}
        defaultValues={app.form_data}
        onSubmit={handleFormSubmit}
        onDraft={handleDraftSave}
        disabled={routePreview?.department_has_route === false}
      />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: app, isLoading } = useQuery<ApplicationDetail>({
    queryKey: ['application', id],
    queryFn: async () => (await apiClient.get(`/applications/${id}`)).data,
  });

  if (isLoading) return <Layout title="読み込み中..."><div className="p-8 text-warmgray-500">Loading...</div></Layout>;
  if (!app) return <Layout title="エラー"><div className="p-8 text-ringo-500 font-bold">申請が見つかりません。</div></Layout>;

  if (app.status === 'DRAFT') {
    return (
      <Layout title={`下書き: ${app.template_name}`}>
        <div className="max-w-3xl mx-auto">
          <DraftEditor app={app} onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['application', id] });
            navigate('/history');
          }} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="申請詳細">
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-up">
        
        <div className="lg:col-span-2 space-y-6">
          <div className="card space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-white/40 pb-5">
              <div>
                <span className={STATUS_BADGE[app.status] ?? 'badge-draft'}>
                  {STATUS_LABEL[app.status] ?? app.status}
                </span>
                <h2 className="text-2xl font-bold text-warmgray-800 mt-3">{app.template_name}</h2>
                <div className="flex items-center gap-3 mt-2 text-xs font-medium text-warmgray-500">
                  <span className="font-mono">{app.application_number ?? '申請番号未発行'}</span>
                  <span>•</span>
                  <span>申請日: {new Date(app.created_at).toLocaleDateString('ja-JP')}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-widest text-warmgray-400 mb-1">申請者</p>
                <p className="font-bold text-warmgray-800">{app.applicant_name}</p>
              </div>
            </div>

            <div>
              <p className="section-title mb-4">申請内容</p>
              <FormDataViewer app={app} />
            </div>
          </div>

          {app.status === 'APPROVED' && app.settlement_schema && (
            <div className="card bg-teal-accent/10 border-teal-accent flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-teal-900 flex items-center gap-2">
                  <span className="bg-teal-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">✓</span>
                  稟議が承認されました
                </h3>
                <p className="text-xs text-teal-800 mt-1">出張や立替が終わりましたら、領収書を添付して精算を行ってください。</p>
              </div>
              <button className="btn bg-teal-600 text-white hover:bg-teal-700 shadow-sm shrink-0 whitespace-nowrap">
                精算書を作成する
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <p className="section-title ml-2">承認タイムライン</p>
          <div className="card pt-6 pb-2">
            <div className="relative border-l-2 border-ringo-200 ml-4 space-y-8 pb-4">
              {app.steps.map((step) => (
                <div key={step.step_order} className="relative pl-6">
                  <div className={`absolute -left-[11px] top-0 w-5 h-5 rounded-full border-4 border-[#F4F2EF] shadow-sm ${
                    step.status === 'APPROVED' ? 'bg-emerald-500' : 
                    step.status === 'REJECTED' || step.status === 'RETURNED' ? 'bg-ringo-500' :
                    step.status === 'PENDING' ? 'bg-mustard-500 ring-2 ring-mustard-300 animate-pulse' : 'bg-warmgray-300'
                  }`} />
                  
                  <div className="-mt-1">
                    <div className="font-bold text-sm text-warmgray-800">{step.label}</div>
                    <div className="text-xs font-medium text-warmgray-500 mt-0.5">
                      {step.approver_name || '(未割当)'}
                    </div>
                    {step.acted_at && (
                      <div className="text-[10px] text-warmgray-400 mt-1">
                        {new Date(step.acted_at).toLocaleString('ja-JP')}
                      </div>
                    )}
                    {step.comment && (
                      <div className="mt-2 text-xs bg-white/60 border border-white/80 p-2.5 rounded-lg text-warmgray-700">
                        <span className="font-bold mr-1">コメント:</span>
                        {step.comment}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </Layout>
  );
}