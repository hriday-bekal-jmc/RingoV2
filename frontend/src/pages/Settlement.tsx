import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import DynamicForm from '../components/forms/DynamicForm';

interface AppDetail {
  id: string;
  application_number: string | null;
  status: string;
  form_data: Record<string, any>;
  template_name: string;
  template_code: string;
  has_settlement: boolean;
  settlement_schema: { fields: Array<{ name: string; label: string; type: string; required?: boolean; multiple?: boolean }> } | null;
  schema_definition: { fields: Array<{ name: string; label: string; type: string; required?: boolean }> };
  steps: Array<{ step_order: number; stage: string; status: string; label: string; approver_name?: string; acted_at?: string; comment?: string }>;
}

// ── Read-only field display ────────────────────────────────────────────────────
function ReadField({ label, value }: { label: string; value: unknown }) {
  if (value == null || value === '') return null;
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-0.5">{label}</dt>
      <dd className="text-sm text-warmgray-800">{String(value)}</dd>
    </div>
  );
}

// ── Original RINGI summary ─────────────────────────────────────────────────────
function RingiSummary({ app }: { app: AppDetail }) {
  const fields = app.schema_definition?.fields ?? [];
  const data = app.form_data ?? {};
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        <h4 className="text-xs font-bold uppercase tracking-widest text-warmgray-500">稟議内容（承認済）</h4>
        {app.application_number && (
          <span className="ml-auto text-[11px] font-mono text-warmgray-400">{app.application_number}</span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
        {fields.length > 0
          ? fields.map((f) => (
              <ReadField key={f.name} label={f.label} value={data[f.name]} />
            ))
          : Object.entries(data).map(([k, v]) => (
              <ReadField key={k} label={k} value={v} />
            ))
        }
      </dl>
    </div>
  );
}

// ── Settlement route preview ──────────────────────────────────────────────────
function SettlementRouteHint() {
  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px] text-warmgray-500">
      <span className="px-2 py-0.5 rounded-full bg-surface-100 font-medium">申請者</span>
      {['承認', '承認', '専務/社長', '総務（精算確認）'].map((label, i) => (
        <span key={i} className="flex items-center gap-2">
          <svg className="w-3 h-3 text-surface-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className={`px-2 py-0.5 rounded-full font-medium ${
            label.includes('総務') ? 'bg-teal-100 text-teal-700' : 'bg-ringo-50 text-ringo-600'
          }`}>{label}</span>
        </span>
      ))}
      <span className="flex items-center gap-2">
        <svg className="w-3 h-3 text-surface-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">完了</span>
      </span>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Settlement() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: app, isLoading, isError } = useQuery<AppDetail>({
    queryKey: ['appDetail', id],
    queryFn: async () => (await apiClient.get(`/applications/${id}`)).data,
    enabled: !!id,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: async (settlement_data: Record<string, unknown>) =>
      (await apiClient.post(`/applications/${id}/start-settlement`, { settlement_data })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myApplications'] });
      queryClient.invalidateQueries({ queryKey: ['appDetail', id] });
      navigate('/history?settled=1');
    },
  });

  if (isLoading) {
    return (
      <Layout title="精算入力">
        <div className="flex items-center justify-center h-32 text-warmgray-400 text-sm gap-2">
          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          読み込み中...
        </div>
      </Layout>
    );
  }

  if (isError || !app) {
    return (
      <Layout title="精算入力">
        <div className="card text-center py-12 text-ringo-500 text-sm">
          申請が見つかりません。
          <Link to="/history" className="block mt-3 text-xs text-ringo-400 hover:text-ringo-600">← 申請履歴に戻る</Link>
        </div>
      </Layout>
    );
  }

  // Guard: only APPROVED + has settlement_schema
  if (app.status !== 'APPROVED' || !app.has_settlement || !app.settlement_schema) {
    return (
      <Layout title="精算入力">
        <div className="card text-center py-12 text-warmgray-500 text-sm">
          この申請は精算入力できません。（承認済みかつ精算対応テンプレートのみ）
          <Link to="/history" className="block mt-3 text-xs text-ringo-400 hover:text-ringo-600">← 申請履歴に戻る</Link>
        </div>
      </Layout>
    );
  }

  // Build a pseudo-template object for DynamicForm
  const pseudoTemplate = {
    id: app.id,
    title_ja: app.template_name,
    schema_definition: app.schema_definition,
    settlement_schema: app.settlement_schema,
  };

  return (
    <Layout title="精算入力">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="animate-fade-up">
          <Link to="/history" className="text-xs text-warmgray-400 hover:text-ringo-500 transition-colors mb-3 inline-flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            申請履歴に戻る
          </Link>
          <div className="flex items-center gap-3 mt-1">
            <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center text-xl shrink-0">💴</div>
            <div>
              <h2 className="text-xl font-bold text-warmgray-800">{app.template_name} — 精算入力</h2>
              <p className="text-xs text-warmgray-400 mt-0.5">稟議承認後の実費・領収書を入力して精算フローを開始します</p>
            </div>
          </div>
        </div>

        {/* Settlement flow hint */}
        <div className="animate-fade-up card !py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-2">精算承認フロー</p>
          <SettlementRouteHint />
          <p className="text-[11px] text-warmgray-400 mt-2">精算ルートは管理者が設定した承認経路に従います。最後に総務部が精算確認して完了となります。</p>
        </div>

        {/* Original RINGI summary */}
        <div className="animate-fade-up">
          <p className="section-title mb-3">元の稟議内容</p>
          <RingiSummary app={app} />
        </div>

        {/* Settlement form */}
        <div className="animate-fade-up">
          <p className="section-title mb-3">精算情報の入力</p>
          {mutation.isError && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-red-50/80 border border-red-200/60 text-red-600 text-sm">
              {(mutation.error as any)?.response?.data?.error ?? '精算申請に失敗しました。もう一度お試しください。'}
            </div>
          )}
          <DynamicForm
            template={pseudoTemplate as any}
            isSettlementPhase={true}
            onSubmit={async (data) => { await mutation.mutateAsync(data); }}
            disabled={mutation.isPending}
          />
        </div>
      </div>
    </Layout>
  );
}
