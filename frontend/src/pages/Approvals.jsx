import { useQuery } from '@tanstack/react-query';
import apiClient from '../services/apiClient.js';
import Layout from '../components/common/Layout.jsx';

export default function Approvals() {
  // バックエンドから承認待ちのデータを取得
  const { data: applications, isLoading, isError } = useQuery({
    queryKey: ['pendingApprovals'],
    queryFn: async () => {
      const res = await apiClient.get('/approvals/pending');
      return res.data;
    },
  });

  return (
    <Layout title="承認待ち一覧">
      <div className="max-w-5xl mx-auto">
        {isLoading && <p className="text-warmgray-600">データを読み込み中...</p>}
        {isError && <p className="text-ringo-500">データの取得に失敗しました。</p>}

        {/* データが0件の場合 */}
        {applications?.length === 0 && (
          <div className="card text-center text-warmgray-600 py-12">
            現在、あなたの承認待ち申請はありません。
          </div>
        )}

        {/* データがある場合、リスト表示 */}
        {applications?.length > 0 && (
          <div className="grid gap-4">
            {applications.map((app) => (
              <div key={app.id} className="card flex flex-col md:flex-row md:items-center justify-between gap-4 hover:shadow-card-hover transition-shadow">
                
                {/* 左側：申請の概要 */}
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="bg-mustard-500 text-white text-xs font-bold px-2 py-1 rounded">
                      承認待ち
                    </span>
                    <h3 className="text-lg font-bold text-warmgray-800">{app.template_name}</h3>
                  </div>
                  
                  {/* JSONBの中に保存された出張先や期間を取り出して表示 */}
                  <p className="text-sm text-warmgray-600">
                    出張先: <span className="font-semibold">{app.form_data?.destination || '未入力'}</span> | 
                    期間: {app.form_data?.start_date} 〜 {app.form_data?.end_date}
                  </p>
                  <p className="text-xs text-warmgray-400 mt-1">
                    申請日時: {new Date(app.created_at).toLocaleString('ja-JP')}
                  </p>
                </div>

                {/* 右側：アクションボタン（今は見た目だけです） */}
                <div className="flex gap-2">
                  <button className="btn-tertiary">詳細を見る</button>
                  <button className="btn-primary bg-teal-accent hover:bg-teal-700">承認する</button>
                </div>
                
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}