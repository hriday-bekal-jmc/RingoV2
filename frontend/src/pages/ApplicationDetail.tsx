import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';

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
  template_name: string;
  applicant_name: string;
  status: string;
  form_data: Record<string, any>;
  steps: Step[];
}

// ↓↓↓ この「export default」が無いと今回のようなエラーが出ます ↓↓↓
export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: app, isLoading } = useQuery<ApplicationDetail>({
    queryKey: ['application', id],
    queryFn: async () => (await apiClient.get(`/applications/${id}`)).data,
  });

  if (isLoading) return <Layout title="読み込み中..."><p className="text-warmgray-600">Loading...</p></Layout>;
  if (!app) return <Layout title="エラー"><p className="text-ringo-500">申請が見つかりません。</p></Layout>;

  return (
    <Layout title={`${app.template_name} の詳細`}>
      <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* 左側: 申請内容の要約 */}
        <div className="md:col-span-2 space-y-6">
          <div className="card">
            <h3 className="text-lg font-bold border-b border-ringo-100 pb-2 mb-4 text-warmgray-800">申請情報</h3>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-warmgray-500 mb-1">申請者</dt>
                <dd className="font-semibold text-warmgray-800">{app.applicant_name}</dd>
              </div>
              <div>
                <dt className="text-warmgray-500 mb-1">ステータス</dt>
                <dd className="font-bold text-ringo-600">{app.status}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-warmgray-500 mb-1">内容</dt>
                <dd className="bg-cream-100 p-3 rounded mt-1 whitespace-pre-wrap font-mono text-warmgray-800">
                  {JSON.stringify(app.form_data, null, 2)}
                </dd>
              </div>
            </dl>
          </div>

          {/* 承認後に表示される「精算する」ボタン */}
          {app.status === 'APPROVED' && (
            <div className="card bg-teal-accent/10 border-teal-accent">
              <h3 className="font-bold text-teal-900 mb-2">稟議が承認されました！</h3>
              <p className="text-sm text-teal-800 mb-4">出張や立替が終わりましたら、以下のボタンから精算（領収書の提出）を行ってください。</p>
              <button className="btn-primary bg-teal-accent hover:bg-teal-700 border-none w-full">
                精算書を作成する
              </button>
            </div>
          )}
        </div>

        {/* 右側: 承認タイムライン */}
        <div className="space-y-4">
          <h3 className="font-bold text-warmgray-800">承認状況</h3>
          <div className="relative border-l-2 border-ringo-200 ml-3 space-y-8 pb-4">
            {app.steps.map((step) => (
              <div key={step.step_order} className="relative pl-6">
                <div className={`absolute -left-[11px] top-0 w-5 h-5 rounded-full border-4 border-cream-100 ${
                  step.status === 'APPROVED' ? 'bg-green-500' : 
                  step.status === 'PENDING' ? 'bg-mustard-500 animate-pulse' : 'bg-warmgray-300'
                }`} />
                <div className="text-sm">
                  <div className="font-bold text-warmgray-800">{step.label}</div>
                  <div className="text-warmgray-500">{step.approver_name || '(未定)'}</div>
                  {step.acted_at && (
                    <div className="text-[10px] text-warmgray-400 mt-0.5">
                      {new Date(step.acted_at).toLocaleString('ja-JP')}
                    </div>
                  )}
                  {step.comment && (
                    <div className="mt-2 text-xs bg-cream-200 p-2 rounded italic text-warmgray-600">
                      "{step.comment}"
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </Layout>
  );
}