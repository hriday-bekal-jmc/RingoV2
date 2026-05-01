import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import { useSSE } from '../hooks/useSSE';
import Toast, { useToast } from '../components/common/Toast';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000/api';

// ── Types ─────────────────────────────────────────────────────────────────────
interface FormField { name: string; label: string; type: string; required?: boolean }

interface Application {
  id: string;
  application_number: string | null;
  status: string;
  form_data: Record<string, unknown>;
  settlement_data?: Record<string, unknown> | null;
  schema_definition: { fields: FormField[] } | null;
  settlement_schema?: { fields: FormField[] } | null;
  created_at: string;
  template_name: string;
  applicant_name?: string;
  applicant_avatar?: string | null;
  current_step_id: string;
  current_step: number;
  current_stage?: string;
  total_steps: number;
  current_step_label?: string;
  current_step_action?: string;
  current_approver_name?: string;
  current_approver_avatar?: string | null;
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function UserAvatar({ name, avatarUrl, size = 8 }: { name: string; avatarUrl?: string | null; size?: number }) {
  const colors = ['from-ringo-400 to-ringo-600', 'from-mustard-400 to-mustard-600', 'from-teal-500 to-teal-700', 'from-indigo-400 to-violet-600'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  const grad = colors[h % colors.length];
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className={`w-${size} h-${size} rounded-full object-cover ring-2 ring-white/60 shrink-0`} />;
  }
  return (
    <div className={`w-${size} h-${size} rounded-full bg-gradient-to-br ${grad} flex items-center justify-center text-white text-xs font-bold shrink-0 ring-2 ring-white/60`}>
      {name.slice(0, 1)}
    </div>
  );
}

// ── Step progress bar ─────────────────────────────────────────────────────────
function StepBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round(((current - 1) / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {Array.from({ length: Number(total) }).map((_, i) => {
          const n = i + 1;
          return (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                n < current ? 'bg-emerald-500 text-white' :
                n === current ? 'bg-ringo-500 text-white ring-2 ring-ringo-200' :
                'bg-surface-200 text-warmgray-400'
              }`}>
                {n < current ? '✓' : n}
              </div>
              {i < Number(total) - 1 && (
                <div className={`h-0.5 w-6 rounded-full ${n < current ? 'bg-emerald-400' : 'bg-surface-200'}`} />
              )}
            </div>
          );
        })}
        <span className="text-xs text-warmgray-400 ml-1 font-medium">({current}/{total})</span>
      </div>
      <div className="h-1 bg-surface-100 rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-ringo-400 to-mustard-400 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Form data viewer ──────────────────────────────────────────────────────────
function FormDataViewer({ formData, schema }: { formData: Record<string, unknown>; schema: { fields: FormField[] } | null }) {
  const fields = schema?.fields ?? [];

  if (fields.length === 0) {
    return (
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        {Object.entries(formData).map(([k, v]) => (
          <div key={k} className={String(v ?? '').length > 40 ? 'col-span-full' : ''}>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-0.5">{k}</dt>
            <dd className="text-sm text-warmgray-800 break-words">{String(v ?? '—')}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
      {fields.map((f) => {
        const val = formData[f.name];
        const isFile = f.type === 'file';
        const isLong = f.type === 'textarea' || (typeof val === 'string' && val.length > 60);

        return (
          <div key={f.name} className={isLong ? 'col-span-full' : ''}>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-0.5">{f.label}</dt>
            <dd className="text-sm text-warmgray-800 break-words">
              {isFile && val ? (
                <div className="flex flex-wrap gap-2 mt-1">
                  {String(val).split(',').filter(Boolean).map((url, i) => {
                    const fullUrl = url.startsWith('http') ? url : `${API_BASE.replace('/api', '')}${url}`;
                    return (
                      <a key={i} href={fullUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-ringo-600 hover:text-ringo-700 bg-ringo-50/60 border border-ringo-200/60 px-2.5 py-1 rounded-lg font-medium transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                        添付 {i + 1}
                      </a>
                    );
                  })}
                </div>
              ) : val != null && val !== '' ? (
                <span className={isLong ? 'block whitespace-pre-wrap leading-relaxed' : ''}>{String(val)}</span>
              ) : (
                <span className="text-warmgray-300 text-xs">未入力</span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

// ── Application Detail Modal ──────────────────────────────────────────────────
interface DetailModalProps {
  app: Application;
  onClose: () => void;
  onAction: (id: string, action: 'approve' | 'return' | 'reject', comment: string) => void;
  isMutating: boolean;
}

function DetailModal({ app, onClose, onAction, isMutating }: DetailModalProps) {
  const [activeAction, setActiveAction] = useState<'approve' | 'return' | 'reject' | null>(null);
  const [comment, setComment] = useState('');

  const actionConfig = {
    approve: { title: '承認する', btnClass: 'btn-primary',  require: false, icon: '✓', iconBg: 'bg-emerald-100 text-emerald-600' },
    return:  { title: '差し戻し', btnClass: 'btn-outline',  require: true,  icon: '↩', iconBg: 'bg-amber-100 text-amber-600'   },
    reject:  { title: '却下する', btnClass: 'btn-danger',   require: true,  icon: '✕', iconBg: 'bg-red-100 text-red-600'       },
  };

  const isFinal = activeAction === 'approve' && Number(app.current_step) === Number(app.total_steps);
  const cfg = activeAction ? actionConfig[activeAction] : null;
  const canSubmit = !cfg?.require || comment.trim().length > 0;

  const handleSubmit = () => {
    if (!activeAction || !canSubmit) return;
    onAction(app.id, activeAction, comment);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-warmgray-900/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative glass rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col animate-scale-in overflow-hidden">

        {/* Header */}
        <div className="px-7 pt-7 pb-5 border-b border-white/30 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <UserAvatar name={app.applicant_name ?? '?'} avatarUrl={app.applicant_avatar} size={10} />
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-warmgray-800 leading-tight">{app.template_name}</h3>
                {app.applicant_name && (
                  <p className="text-xs text-warmgray-500 mt-0.5">申請者: {app.applicant_name}</p>
                )}
                <p className="text-[11px] text-warmgray-400 mt-0.5">
                  {new Date(app.created_at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 w-8 h-8 rounded-xl bg-surface-100/80 hover:bg-surface-200/80 flex items-center justify-center text-warmgray-500 hover:text-warmgray-800 transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Step progress */}
          <div className="mt-4">
            <StepBar current={Number(app.current_step)} total={Number(app.total_steps)} />
            {app.current_step_label && (
              <p className="text-[11px] text-warmgray-400 mt-2">現在: {app.current_step_label}</p>
            )}
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-7 py-5 space-y-6">

            {/* Settlement stage badge */}
            {app.current_stage === 'SETTLEMENT' && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-teal-50/80 border border-teal-200/60 text-teal-700 text-xs font-semibold">
                <span>💴</span>
                精算承認フェーズ — 実費の確認・精算承認を行ってください
              </div>
            )}

            {/* Settlement data (if SETTLEMENT stage) */}
            {app.current_stage === 'SETTLEMENT' && app.settlement_data && (
              <div>
                <p className="section-title mb-4">精算内容</p>
                <FormDataViewer formData={app.settlement_data} schema={app.settlement_schema ?? null} />
              </div>
            )}

            {/* Original RINGI content */}
            <div>
              <p className="section-title mb-4">
                {app.current_stage === 'SETTLEMENT' ? '元の稟議内容' : '申請内容'}
              </p>
              <FormDataViewer formData={app.form_data} schema={app.schema_definition} />
            </div>
          </div>
        </div>

        {/* Footer — action area */}
        <div className="px-7 py-5 border-t border-white/30 bg-surface-50/40 shrink-0">
          {activeAction ? (
            <div className="space-y-3 animate-scale-in">
              {/* Action header */}
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-sm ${cfg!.iconBg}`}>
                  {cfg!.icon}
                </div>
                <div>
                  <p className="text-sm font-bold text-warmgray-800">{cfg!.title}</p>
                  {isFinal && (
                    <p className="text-xs text-emerald-600 font-medium">最終承認 — 申請番号を発行します</p>
                  )}
                </div>
              </div>

              {/* Comment field */}
              <div>
                <label className="label-normal text-xs">
                  コメント
                  {cfg!.require
                    ? <span className="text-ringo-500 ml-1">*必須</span>
                    : <span className="text-warmgray-400 ml-1 font-normal">(任意)</span>
                  }
                </label>
                <textarea
                  className={`input resize-none text-sm ${cfg!.require && !comment.trim() ? 'border-amber-300/80 focus:ring-amber-400/50' : ''}`}
                  rows={2}
                  placeholder={activeAction === 'approve' ? '承認コメント（任意）' : '理由を入力してください（必須）'}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  autoFocus
                />
                {cfg!.require && !comment.trim() && (
                  <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                    <span>⚠</span>理由を入力するとボタンが有効になります
                  </p>
                )}
              </div>

              {/* Submit / cancel */}
              <div className="flex gap-2">
                <button className="btn-ghost text-xs" onClick={() => { setActiveAction(null); setComment(''); }}>
                  戻る
                </button>
                <div className="flex-1" />
                <button
                  className={`${cfg!.btnClass} text-sm`}
                  disabled={isMutating || !canSubmit}
                  onClick={handleSubmit}
                >
                  {isMutating ? '処理中...' : cfg!.title}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 justify-end">
              <button className="btn-ghost text-sm" onClick={onClose}>閉じる</button>
              <button className="btn-outline text-sm" onClick={() => { setActiveAction('return'); setComment(''); }} disabled={isMutating}>
                ↩ 差し戻し
              </button>
              <button className="btn-danger text-sm" onClick={() => { setActiveAction('reject'); setComment(''); }} disabled={isMutating}>
                ✕ 却下
              </button>
              <button className="btn-primary text-sm" onClick={() => { setActiveAction('approve'); setComment(''); }} disabled={isMutating}>
                {Number(app.current_step) === Number(app.total_steps) ? '✓ 最終承認' : '✓ 承認する'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Approvals() {
  const queryClient = useQueryClient();
  const { toast, show: showToast, dismiss } = useToast();
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);

  // Real-time updates via SSE
  useSSE();

  const { data: applications = [], isLoading, isError } = useQuery<Application[]>({
    queryKey: ['pendingApprovals'],
    queryFn: async () => (await apiClient.get('/approvals/pending')).data,
    // No refetchInterval needed — SSE handles real-time invalidation
    staleTime: 30_000,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['pendingApprovals'] });
    queryClient.invalidateQueries({ queryKey: ['myApplications'] });
    setSelectedApp(null);
  }, [queryClient]);

  const approveMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) =>
      (await apiClient.post(`/approvals/${id}/approve`, { comment })).data,
    onSuccess: (data) => {
      showToast(
        data.completed ? '🎉 精算完了 — 申請が完了しました' :
        data.final ? `✅ 最終承認 — ${data.application?.application_number}` :
        '✅ 承認しました — 次の承認者へ'
      );
      invalidate();
    },
    onError: (err: any) => showToast(`承認失敗: ${err.message}`, 'error'),
  });

  const returnMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) =>
      (await apiClient.post(`/approvals/${id}/return`, { comment })).data,
    onSuccess: () => { showToast('↩ 差し戻しました'); invalidate(); },
    onError: (err: any) => showToast(`差し戻し失敗: ${err.message}`, 'error'),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) =>
      (await apiClient.post(`/approvals/${id}/reject`, { comment })).data,
    onSuccess: () => { showToast('✕ 却下しました'); invalidate(); },
    onError: (err: any) => showToast(`却下失敗: ${err.message}`, 'error'),
  });

  const handleAction = (id: string, action: 'approve' | 'return' | 'reject', comment: string) => {
    const payload = { id, comment };
    if (action === 'approve') approveMutation.mutate(payload);
    else if (action === 'return') returnMutation.mutate(payload);
    else rejectMutation.mutate(payload);
  };

  const isMutating = approveMutation.isPending || returnMutation.isPending || rejectMutation.isPending;

  return (
    <Layout title="承認待ち一覧">
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={dismiss} />}

      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="animate-fade-up flex items-end justify-between">
          <div>
            <p className="section-title mb-0">承認インボックス</p>
            <h2 className="text-2xl font-bold text-warmgray-800 mt-1">承認待ち一覧</h2>
            <p className="text-sm text-warmgray-400 mt-1">行をクリックして詳細を確認できます</p>
          </div>
          {applications.length > 0 && (
            <span className="badge-pending px-3 py-1.5 text-sm">{applications.length} 件 保留中</span>
          )}
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="card flex items-center justify-center gap-3 py-16 text-warmgray-400">
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            読み込み中...
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="card text-ringo-600 text-sm text-center py-8">
            データ取得に失敗しました。ページをリロードしてください。
          </div>
        )}

        {/* Empty */}
        {!isLoading && applications.length === 0 && (
          <div className="card flex flex-col items-center justify-center py-20 text-warmgray-400">
            <span className="text-4xl mb-3">✅</span>
            <p className="text-sm font-medium">承認待ちはありません</p>
            <p className="text-xs mt-1 text-warmgray-300">全て処理済みです</p>
          </div>
        )}

        {/* Table */}
        {applications.length > 0 && (
          <div className="card !p-0 overflow-hidden animate-fade-up">
            <table className="w-full text-sm text-left">
              <thead className="border-b border-white/40">
                <tr>
                  <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest text-warmgray-400">申請 / 申請者</th>
                  <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest text-warmgray-400">承認ステップ</th>
                  <th className="px-5 py-3.5 text-[11px] font-bold uppercase tracking-widest text-warmgray-400 hidden sm:table-cell">申請日</th>
                  <th className="px-5 py-3.5 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/30">
                {applications.map((app, i) => (
                  <tr
                    key={app.id}
                    className="cursor-pointer hover:bg-white/50 transition-colors duration-100 group animate-fade-up"
                    style={{ animationDelay: `${i * 40}ms` }}
                    onClick={() => setSelectedApp(app)}
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <UserAvatar name={app.applicant_name ?? '?'} avatarUrl={app.applicant_avatar} size={8} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-warmgray-800 truncate">{app.template_name}</p>
                            {app.current_stage === 'SETTLEMENT' && (
                              <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700">精算</span>
                            )}
                          </div>
                          <p className="text-[11px] text-warmgray-400 mt-0.5 truncate">{app.applicant_name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5">
                        {Array.from({ length: Number(app.total_steps) }).map((_, i) => {
                          const n = i + 1;
                          const cur = Number(app.current_step);
                          return (
                            <span key={i} className={`w-2 h-2 rounded-full ${n < cur ? 'bg-emerald-400' : n === cur ? 'bg-ringo-500 ring-2 ring-ringo-200' : 'bg-surface-200'}`} />
                          );
                        })}
                        <span className="text-[10px] text-warmgray-400 ml-1">{app.current_step}/{app.total_steps}</span>
                      </div>
                      {app.current_step_label && (
                        <p className="text-[10px] text-warmgray-400 mt-1 truncate max-w-[120px]">{app.current_step_label}</p>
                      )}
                    </td>
                    <td className="px-5 py-4 hidden sm:table-cell text-[11px] text-warmgray-400 whitespace-nowrap">
                      {new Date(app.created_at).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="px-5 py-4 w-8 text-right">
                      <svg className="w-4 h-4 text-warmgray-300 group-hover:text-ringo-400 transition-colors inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedApp && (
        <DetailModal
          app={selectedApp}
          onClose={() => setSelectedApp(null)}
          onAction={handleAction}
          isMutating={isMutating}
        />
      )}
    </Layout>
  );
}
