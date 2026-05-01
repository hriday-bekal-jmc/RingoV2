import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';

interface FormField {
  name: string;
  label: string;
  type: string;
}

interface Application {
  id: string;
  application_number: string | null;
  status: string;
  form_data: Record<string, any>;
  schema_definition: { fields: FormField[] } | null;
  created_at: string;
  template_name: string;
  applicant_name?: string;
  applicant_avatar?: string | null;
  current_step_id: string;
  current_step: number;
  total_steps: number;
  current_step_label?: string;
  current_step_action?: string;
  current_approver_name?: string;
  current_approver_avatar?: string | null;
}

// ── Avatar ─────────────────────────────────────────────────────────────────────
function UserAvatar({ name, avatarUrl, size = 8 }: { name: string; avatarUrl?: string | null; size?: number }) {
  const colors = ['from-ringo-400 to-ringo-600', 'from-mustard-400 to-mustard-600', 'from-teal-500 to-teal-700', 'from-indigo-400 to-violet-600'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  const grad = colors[h % colors.length];

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={`w-${size} h-${size} rounded-full object-cover ring-2 ring-white/60 shrink-0`}
      />
    );
  }
  return (
    <div className={`w-${size} h-${size} rounded-full bg-gradient-to-br ${grad} flex items-center justify-center text-white text-xs font-bold shrink-0 ring-2 ring-white/60`}>
      {name.slice(0, 1)}
    </div>
  );
}

// ── Step dots ──────────────────────────────────────────────────────────────────
function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: Number(total) }).map((_, i) => {
        const n = i + 1;
        if (n < current) return <span key={i} className="step-dot-done" />;
        if (n === current) return <span key={i} className="step-dot-active" />;
        return <span key={i} className="step-dot-waiting" />;
      })}
      <span className="text-[11px] text-warmgray-400 ml-1 font-medium">{current}/{total}</span>
    </div>
  );
}

// ── Form data viewer ───────────────────────────────────────────────────────────
function FormDataViewer({ formData, schema }: {
  formData: Record<string, any>;
  schema: { fields: FormField[] } | null;
}) {
  const fields = schema?.fields ?? [];

  if (fields.length === 0) {
    // Fallback: render raw key-value pairs
    return (
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
        {Object.entries(formData).map(([k, v]) => (
          <div key={k} className={String(v).length > 40 ? 'col-span-2' : ''}>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">{k}</dt>
            <dd className="text-sm text-warmgray-800 mt-0.5 break-words">{String(v ?? '—')}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
      {fields.map((f) => {
        const val = formData[f.name];
        const isFile = f.type === 'file';
        const isLong = f.type === 'textarea' || (typeof val === 'string' && val.length > 60);

        return (
          <div key={f.name} className={isLong ? 'col-span-full' : ''}>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">{f.label}</dt>
            <dd className="text-sm text-warmgray-800 mt-0.5 break-words">
              {isFile && val ? (
                <div className="flex flex-wrap gap-2 mt-1">
                  {String(val).split(',').filter(Boolean).map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-ringo-600 hover:text-ringo-700 bg-ringo-50/60 border border-ringo-200/60 px-2.5 py-1 rounded-lg font-medium transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                      </svg>
                      添付ファイル {i + 1}
                    </a>
                  ))}
                </div>
              ) : val != null && val !== '' ? (
                <span className={isLong ? 'block whitespace-pre-wrap' : ''}>{String(val)}</span>
              ) : (
                <span className="text-warmgray-300">—</span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

// ── Action modal ──────────────────────────────────────────────────────────────
interface ActionModalProps {
  app: Application;
  action: 'approve' | 'return' | 'reject';
  onClose: () => void;
  onConfirm: (id: string, comment: string) => void;
  isLoading: boolean;
}

function ActionModal({ app, action, onClose, onConfirm, isLoading }: ActionModalProps) {
  const [comment, setComment] = useState('');

  const config = {
    approve: { title: '承認する',   desc: '申請を承認します。',                             btnClass: 'btn-primary',  btnLabel: '承認する', require: false },
    return:  { title: '差し戻し',   desc: '申請者へ差し戻します。理由を入力してください。', btnClass: 'btn-outline',  btnLabel: '差し戻す', require: true },
    reject:  { title: '却下する',   desc: '申請を却下します。理由を入力してください。',     btnClass: 'btn-danger',   btnLabel: '却下する', require: true },
  }[action];

  const isFinal = action === 'approve' && app.current_step === Number(app.total_steps);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-warmgray-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass rounded-3xl shadow-2xl w-full max-w-md p-7 space-y-5 animate-scale-in">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-xl ${
            action === 'approve' ? 'bg-emerald-100' :
            action === 'return' ? 'bg-amber-100' : 'bg-red-100'
          }`}>
            {action === 'approve' ? '✓' : action === 'return' ? '↩' : '✕'}
          </div>
          <div>
            <h3 className="text-base font-bold text-warmgray-800">{config.title}</h3>
            <p className="text-xs text-warmgray-500">{config.desc}</p>
          </div>
        </div>

        {isFinal && (
          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <span>✓</span>
            <span className="font-medium">最終承認 — 申請番号を発行します</span>
          </div>
        )}

        {/* App info */}
        <div className="bg-surface-50/60 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <UserAvatar name={app.applicant_name ?? '?'} avatarUrl={app.applicant_avatar} size={7} />
            <div>
              <p className="text-sm font-semibold text-warmgray-800">{app.template_name}</p>
              {app.applicant_name && (
                <p className="text-xs text-warmgray-500">申請者: {app.applicant_name}</p>
              )}
            </div>
          </div>
          <StepDots current={app.current_step} total={Number(app.total_steps)} />
        </div>

        {/* Comment */}
        <div>
          <label className="label-normal">
            コメント {config.require
              ? <span className="text-ringo-500">*</span>
              : <span className="text-warmgray-400 font-normal text-[11px]">(任意)</span>
            }
          </label>
          <textarea
            className="input resize-none"
            rows={3}
            placeholder={action === 'approve' ? '承認コメントを入力（任意）' : '理由を入力してください'}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="btn-outline flex-1" disabled={isLoading}>
            キャンセル
          </button>
          <button
            className={`${config.btnClass} flex-1`}
            disabled={isLoading || (config.require && !comment.trim())}
            onClick={() => onConfirm(app.id, comment)}
          >
            {isLoading ? '処理中...' : config.btnLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Application row (expandable) ──────────────────────────────────────────────
function AppRow({
  app,
  onAction,
  isMutating,
}: {
  app: Application;
  onAction: (app: Application, action: 'approve' | 'return' | 'reject') => void;
  isMutating: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-white/50 transition-colors duration-100"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Applicant */}
        <td className="px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <UserAvatar name={app.applicant_name ?? '?'} avatarUrl={app.applicant_avatar} size={8} />
            <div>
              <p className="text-sm font-semibold text-warmgray-800">{app.template_name}</p>
              <p className="text-[11px] text-warmgray-400 mt-0.5">{app.applicant_name}</p>
            </div>
          </div>
        </td>

        {/* Date */}
        <td className="px-4 py-3.5 hidden md:table-cell text-[11px] text-warmgray-400">
          {new Date(app.created_at).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
        </td>

        {/* Step progress */}
        <td className="px-4 py-3.5">
          <StepDots current={app.current_step} total={Number(app.total_steps)} />
          {app.current_step_label && (
            <p className="text-[10px] text-warmgray-400 mt-1">{app.current_step_label}</p>
          )}
        </td>

        {/* Expand toggle */}
        <td className="px-4 py-3.5 w-6">
          <svg
            className={`w-4 h-4 text-warmgray-400 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </td>

        {/* Action buttons */}
        <td className="px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1.5">
            <button className="btn-outline btn-sm text-xs" onClick={() => onAction(app, 'return')} disabled={isMutating}>差し戻し</button>
            <button className="btn-danger btn-sm text-xs" onClick={() => onAction(app, 'reject')} disabled={isMutating}>却下</button>
            <button className="btn-primary btn-sm text-xs" onClick={() => onAction(app, 'approve')} disabled={isMutating}>
              {app.current_step === Number(app.total_steps) ? '最終承認' : '承認する'}
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded detail row */}
      {expanded && (
        <tr>
          <td colSpan={5} className="px-4 pb-4 pt-0">
            <div className="bg-surface-50/60 rounded-2xl p-5 border border-white/50">
              <p className="section-title mb-3">申請内容</p>
              <FormDataViewer formData={app.form_data} schema={app.schema_definition} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Approvals() {
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<{ app: Application; action: 'approve' | 'return' | 'reject' } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data: applications = [], isLoading, isError } = useQuery<Application[]>({
    queryKey: ['pendingApprovals'],
    queryFn: async () => (await apiClient.get('/approvals/pending')).data,
    refetchInterval: 30_000, // poll every 30s for real-time feel
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['pendingApprovals'] });
    queryClient.invalidateQueries({ queryKey: ['myApplications'] });
    setModal(null);
  };

  const approveMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) =>
      (await apiClient.post(`/approvals/${id}/approve`, { comment })).data,
    onSuccess: (data) => {
      showToast(data.final ? `✅ 最終承認しました — ${data.application?.application_number}` : '✅ 承認しました — 次の承認者へ送付');
      invalidate();
    },
    onError: (err: any) => showToast(`承認に失敗しました: ${err.message}`, 'error'),
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

  const handleConfirm = (id: string, comment: string) => {
    if (!modal) return;
    const payload = { id, comment };
    if (modal.action === 'approve') approveMutation.mutate(payload);
    else if (modal.action === 'return') returnMutation.mutate(payload);
    else rejectMutation.mutate(payload);
  };

  const isMutating = approveMutation.isPending || returnMutation.isPending || rejectMutation.isPending;

  return (
    <Layout title="承認待ち一覧">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 animate-scale-in flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-lg text-sm font-semibold
          ${toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-ringo-500 text-white'}`}>
          {toast.message}
        </div>
      )}

      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="animate-fade-up flex items-end justify-between">
          <div>
            <p className="section-title mb-0">承認インボックス</p>
            <h2 className="text-2xl font-bold text-warmgray-800 mt-1">承認待ち一覧</h2>
            <p className="text-sm text-warmgray-400 mt-1">クリックで申請内容を展開できます</p>
          </div>
          {applications.length > 0 && (
            <span className="badge-pending text-sm px-3 py-1.5">{applications.length} 件 保留中</span>
          )}
        </div>

        {/* States */}
        {isLoading && (
          <div className="card flex items-center justify-center gap-3 py-16 text-warmgray-400">
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            読み込み中...
          </div>
        )}
        {isError && (
          <div className="card text-ringo-600 text-sm text-center py-8">
            データの取得に失敗しました。ページをリロードしてください。
          </div>
        )}
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
                  <th className="px-4 py-3.5 text-[11px] font-bold uppercase tracking-widest text-warmgray-400">申請 / 申請者</th>
                  <th className="px-4 py-3.5 text-[11px] font-bold uppercase tracking-widest text-warmgray-400 hidden md:table-cell">申請日</th>
                  <th className="px-4 py-3.5 text-[11px] font-bold uppercase tracking-widest text-warmgray-400">承認ステップ</th>
                  <th className="px-4 py-3.5 w-6"></th>
                  <th className="px-4 py-3.5 text-[11px] font-bold uppercase tracking-widest text-warmgray-400 text-right">アクション</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/30">
                {applications.map((app) => (
                  <AppRow
                    key={app.id}
                    app={app}
                    onAction={(a, action) => setModal({ app: a, action })}
                    isMutating={isMutating}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <ActionModal
          app={modal.app}
          action={modal.action}
          onClose={() => setModal(null)}
          onConfirm={handleConfirm}
          isLoading={isMutating}
        />
      )}
    </Layout>
  );
}
