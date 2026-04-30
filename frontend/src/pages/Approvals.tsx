import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';

interface Application {
  id: string;
  application_number: string | null;
  status: string;
  form_data: Record<string, any>;
  created_at: string;
  template_name: string;
  applicant_name?: string;
  current_step: number;
  total_steps: number;
  current_step_label?: string;
  current_step_action?: string;
  current_approver_name?: string;
}

export default function Approvals() {
  const queryClient = useQueryClient();

  const { data: applications, isLoading, isError } = useQuery<Application[]>({
    queryKey: ['pendingApprovals'],
    queryFn: async () => {
      const res = await apiClient.get('/approvals/pending');
      return res.data;
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post(`/approvals/${id}/approve`);
      return res.data;
    },
    onSuccess: (data) => {
      if (data.final) {
        alert(`✅ 最終承認しました — 申請番号: ${data.application?.application_number}`);
      } else {
        const nextStep = data.application?.advanced_to_step;
        alert(`✅ 承認しました — ステップ ${nextStep} の承認者に送付しました`);
      }
      queryClient.invalidateQueries({ queryKey: ['pendingApprovals'] });
    },
    onError: (err: any) => {
      alert(`承認に失敗: ${err.message}`);
    },
  });

  const returnMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post(`/approvals/${id}/return`);
      return res.data;
    },
    onSuccess: () => {
      alert('差し戻しました');
      queryClient.invalidateQueries({ queryKey: ['pendingApprovals'] });
    },
    onError: (err: any) => {
      alert(`差し戻し失敗: ${err.message}`);
    },
  });

  return (
    <Layout title="承認待ち一覧">
      <div className="max-w-5xl mx-auto">
        {isLoading && <p className="text-warmgray-600">データを読み込み中...</p>}
        {isError && <p className="text-ringo-500">データの取得に失敗しました。</p>}

        {applications?.length === 0 && (
          <div className="card text-center text-warmgray-600 py-12">
            現在、承認待ち申請はありません。
          </div>
        )}

        {applications && applications.length > 0 && (
          <div className="grid gap-4">
            {applications.map((app) => (
              <div
                key={app.id}
                className="card flex flex-col md:flex-row md:items-center justify-between gap-4 hover:shadow-card-hover transition-shadow"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <span className="bg-mustard-500 text-white text-xs font-bold px-2 py-1 rounded">
                      承認待ち
                    </span>
                    <h3 className="text-lg font-bold text-warmgray-800">{app.template_name}</h3>
                    {app.application_number && (
                      <span className="text-xs text-warmgray-600">#{app.application_number}</span>
                    )}
                    {/* Step progress badge */}
                    <span className="ml-auto text-xs font-semibold px-2 py-1 rounded bg-ringo-100 text-ringo-700">
                      ステップ {app.current_step} / {app.total_steps}
                    </span>
                  </div>

                  {app.applicant_name && (
                    <p className="text-sm text-warmgray-600">
                      申請者: <span className="font-semibold">{app.applicant_name}</span>
                    </p>
                  )}

                  {app.current_step_label && (
                    <p className="text-sm text-warmgray-600">
                      現在の承認段階: <span className="font-semibold text-ringo-600">{app.current_step_label}</span>
                      {app.current_approver_name && (
                        <span className="ml-2 text-warmgray-600">({app.current_approver_name})</span>
                      )}
                    </p>
                  )}

                  <p className="text-sm text-warmgray-600 mt-1">
                    出張先: <span className="font-semibold">{app.form_data?.destination || '—'}</span>
                    {' | '}期間: {app.form_data?.start_date || '—'} 〜 {app.form_data?.end_date || '—'}
                  </p>
                  {app.form_data?.expected_amount && (
                    <p className="text-sm text-warmgray-600">
                      予定金額: ¥{Number(app.form_data.expected_amount).toLocaleString()}
                    </p>
                  )}
                  <p className="text-xs text-warmgray-600 mt-1 opacity-70">
                    申請日時: {new Date(app.created_at).toLocaleString('ja-JP')}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-tertiary"
                    onClick={() => returnMutation.mutate(app.id)}
                    disabled={returnMutation.isPending}
                  >
                    差し戻し
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => approveMutation.mutate(app.id)}
                    disabled={approveMutation.isPending}
                  >
                    {approveMutation.isPending
                      ? '処理中...'
                      : app.current_step === Number(app.total_steps)
                        ? '最終承認'
                        : '承認する'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
