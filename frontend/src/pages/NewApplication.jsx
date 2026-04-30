import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import apiClient from '../services/apiClient.js';
import Layout from '../components/common/Layout.jsx';
import DynamicForm from '../components/forms/DynamicForm.jsx';

export default function NewApplication() {
  // URLからテンプレートのコード（BUSINESS_TRIPなど）を取得
  const { templateCode } = useParams();

  // バックエンドAPIからテンプレートのJSON定義を取得
  const { data: template, isLoading, isError } = useQuery({
    queryKey: ['template', templateCode],
    queryFn: async () => {
      const res = await apiClient.get(`/templates/${templateCode}`);
      return res.data;
    },
  });

  const handleFormSubmit = async (payload) => {
    try {
      // バックエンドの /api/applications にデータをPOST送信
      const res = await apiClient.post('/applications', payload);
      
      console.log('保存完了:', res.data);
      alert('🎉 申請が成功しました！データベースに保存されました。');
      
      // ※本来はここでダッシュボード画面などに自動で戻る処理を入れます
      
    } catch (error) {
      console.error('送信エラー:', error);
      alert('申請に失敗しました。必須項目が入力されているか確認してください。');
    }
  };

  return (
    <Layout title="新規申請">
      <div className="max-w-3xl mx-auto">
        {isLoading && <p className="text-warmgray-600">フォームを読み込み中...</p>}
        {isError && <p className="text-ringo-500">フォームの読み込みに失敗しました。</p>}
        
        {template && (
          <DynamicForm 
            template={template} 
            onSubmit={handleFormSubmit} 
            isSettlementPhase={false} // 今回は稟議フェーズ（出張前）として表示
          />
        )}
      </div>
    </Layout>
  );
}