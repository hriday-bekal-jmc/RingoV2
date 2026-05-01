import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import ConfirmDialog from '../components/common/ConfirmDialog';

interface Application {
  id: string;
  application_number: string | null;
  status: string;
  template_name: string;
  template_code?: string;
  has_settlement?: boolean;
  created_at: string;
  form_data: Record<string, any>;
}

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  DRAFT:              { label: '下書き',    cls: 'badge-draft' },
  PENDING_APPROVAL:   { label: '承認待ち',  cls: 'badge-pending' },
  APPROVED:           { label: '承認済み',  cls: 'badge-approved' },
  REJECTED:           { label: '却下',      cls: 'badge-rejected' },
  RETURNED:           { label: '差し戻し',  cls: 'badge-returned' },
  PENDING_SETTLEMENT: { label: '精算中',    cls: 'badge-mustard' },
  SETTLEMENT_APPROVED:{ label: '精算承認済', cls: 'badge-approved' },
  COMPLETED:          { label: '完了',      cls: 'badge-approved' },
  CANCELLED:          { label: 'キャンセル', cls: 'badge-draft' },
};

const ALL_STATUSES = ['全て', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PENDING_SETTLEMENT', 'REJECTED', 'RETURNED', 'COMPLETED'];

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div className={`fixed top-6 right-6 z-50 animate-scale-in flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-lg text-sm font-semibold
      ${type === 'success' ? 'bg-emerald-500 text-white' : 'bg-ringo-500 text-white'}`}>
      <span className="text-base">{type === 'success' ? '✓' : '✕'}</span>
      {message}
    </div>
  );
}

export default function History() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('全て');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Application | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState<Application | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (searchParams.get('submitted') === '1') showToast('申請が完了しました 🎉');
    if (searchParams.get('drafted') === '1') showToast('下書きを保存しました 📝');
    if (searchParams.get('settled') === '1') showToast('精算申請を提出しました 💴 承認フローが開始されました');
  }, [searchParams]);

  const { data: applications = [], isLoading } = useQuery<Application[]>({
    queryKey: ['myApplications'],
    queryFn: async () => (await apiClient.get('/applications')).data,
  });

  const deleteDraft = useMutation({
    mutationFn: async (id: string) => (await apiClient.delete(`/applications/${id}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myApplications'] });
      showToast('下書きを削除しました');
    },
    onError: () => showToast('削除に失敗しました', 'error'),
  });

  const submitDraft = useMutation({
    mutationFn: async (id: string) => (await apiClient.post(`/applications/${id}/submit`, {})).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myApplications'] });
      showToast('申請が完了しました 🎉');
    },
    onError: (err: any) => showToast(`申請に失敗しました: ${err.message}`, 'error'),
  });

  const filtered = statusFilter === '全て'
    ? applications
    : applications.filter((a) => a.status === statusFilter);

  const sorted = [...filtered].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const draftCount = applications.filter((a) => a.status === 'DRAFT').length;

  return (
    <Layout title="申請履歴">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Confirm dialogs */}
      <ConfirmDialog
        isOpen={!!confirmDelete}
        title="下書きを削除"
        message={`「${confirmDelete?.template_name}」の下書きを削除します。この操作は元に戻せません。`}
        confirmLabel="削除する"
        confirmClass="btn-danger"
        onConfirm={() => { if (confirmDelete) { deleteDraft.mutate(confirmDelete.id); setConfirmDelete(null); } }}
        onCancel={() => setConfirmDelete(null)}
      />
      <ConfirmDialog
        isOpen={!!confirmSubmit}
        title="申請を提出"
        message={`「${confirmSubmit?.template_name}」を申請します。提出後は承認フローが開始されます。`}
        confirmLabel="申請する"
        confirmClass="btn-primary"
        onConfirm={() => { if (confirmSubmit) { submitDraft.mutate(confirmSubmit.id); setConfirmSubmit(null); } }}
        onCancel={() => setConfirmSubmit(null)}
      />

      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header row */}
        <div className="animate-fade-up flex items-end justify-between">
          <div>
            <p className="section-title mb-0">申請履歴</p>
            <p className="text-2xl font-bold text-warmgray-800 mt-1">
              {applications.length} 件
              {draftCount > 0 && (
                <span className="ml-2 text-sm font-normal text-warmgray-400">
                  （下書き {draftCount} 件）
                </span>
              )}
            </p>
          </div>
          <Link to="/dashboard" className="btn-outline text-xs">
            ＋ 新規申請
          </Link>
        </div>

        {/* Filter pills */}
        <div className="animate-fade-up flex gap-2 flex-wrap">
          {ALL_STATUSES.map((s) => {
            const isActive = statusFilter === s;
            const cfg = STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-150
                  ${isActive
                    ? 'bg-warmgray-800 text-white shadow-sm'
                    : 'bg-white/60 text-warmgray-500 hover:bg-white/90 border border-white/80 backdrop-blur-sm'
                  }`}
              >
                {cfg?.label ?? s}
              </button>
            );
          })}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="card flex items-center justify-center gap-3 py-16 text-warmgray-400">
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            読み込み中...
          </div>
        ) : sorted.length === 0 ? (
          <div className="card flex flex-col items-center justify-center py-20 gap-4 text-warmgray-400 animate-fade-up">
            <span className="text-5xl">📭</span>
            <p className="text-sm font-medium">該当する申請がありません</p>
            {statusFilter !== '全て' && (
              <button onClick={() => setStatusFilter('全て')} className="text-xs text-ringo-500 hover:text-ringo-600 font-semibold">
                フィルターを解除する
              </button>
            )}
          </div>
        ) : (
          <div className="card !p-0 overflow-hidden animate-fade-up">
            <ul className="divide-y divide-white/30">
              {sorted.map((app, idx) => {
                const cfg = STATUS_CONFIG[app.status] ?? { label: app.status, cls: 'badge-draft' };
                const isDraft = app.status === 'DRAFT';
                const isReturned = app.status === 'RETURNED';

                const isSettleable = app.status === 'APPROVED' && app.has_settlement;

                return (
                  <li
                    key={app.id}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-white/40 transition-colors duration-100"
                    style={{ animationDelay: `${idx * 0.03}s` }}
                  >
                    {/* Status dot */}
                    <div className={`w-2 h-2 rounded-full shrink-0 ${
                      isDraft ? 'bg-warmgray-400' :
                      app.status === 'PENDING_APPROVAL' ? 'bg-amber-400' :
                      app.status === 'PENDING_SETTLEMENT' ? 'bg-teal-400' :
                      app.status === 'APPROVED' || app.status === 'COMPLETED' ? 'bg-emerald-400' :
                      app.status === 'REJECTED' ? 'bg-red-400' :
                      app.status === 'RETURNED' ? 'bg-orange-400' :
                      'bg-warmgray-300'
                    }`} />

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-warmgray-800 truncate">{app.template_name}</p>
                        <span className={cfg.cls}>{cfg.label}</span>
                        {(isDraft || isReturned) && (
                          <span className="text-[10px] text-warmgray-400 font-medium">編集可能</span>
                        )}
                      </div>
                      <p className="text-[11px] text-warmgray-400 mt-0.5">
                        {app.application_number ? (
                          <span className="font-mono mr-2">{app.application_number}</span>
                        ) : null}
                        {new Date(app.created_at).toLocaleDateString('ja-JP', {
                          year: 'numeric', month: 'long', day: 'numeric',
                        })}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {isDraft && (
                        <>
                          <button
                            className="btn-primary text-xs px-3 py-1.5 rounded-lg"
                            disabled={submitDraft.isPending}
                            onClick={() => setConfirmSubmit(app)}
                          >
                            申請する
                          </button>
                          <Link
                            to={`/applications/${app.id}`}
                            className="btn-outline text-xs px-3 py-1.5 rounded-lg"
                          >
                            編集
                          </Link>
                          <button
                            className="text-[11px] text-warmgray-400 hover:text-red-500 transition-colors font-medium"
                            onClick={() => setConfirmDelete(app)}
                          >
                            削除
                          </button>
                        </>
                      )}
                      {/* 精算入力 — APPROVED + has settlement template */}
                      {isSettleable && (
                        <button
                          className="btn-primary text-xs px-3 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 border-teal-500 hover:border-teal-600"
                          onClick={() => navigate(`/applications/${app.id}/settlement`)}
                        >
                          💴 精算入力
                        </button>
                      )}
                      {!isDraft && (
                        <Link
                          to={`/applications/${app.id}`}
                          className="text-xs font-semibold text-ringo-500 hover:text-ringo-600 transition-colors flex items-center gap-0.5"
                        >
                          詳細
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Layout>
  );
}
