import { useState, useRef, useCallback, useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useScrollEnd } from '../hooks/useScrollEnd';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import RingoLoader from '../components/common/RingoLoader';
import { useLang } from '../context/LanguageContext';

// File URLs are same-origin (vite proxy /api in dev, reverse proxy in prod) — no base prefix needed

// ── Types ─────────────────────────────────────────────────────────────────────
interface Settlement {
  settlement_id: string;
  application_id: string;
  application_number: string | null;
  app_status: string;
  settlement_status: string;
  expected_amount: number;
  actual_amount: number;
  currency: string;
  transfer_date: string | null;
  transfer_proof_url: string | null;
  accounting_note: string | null;
  processed_at: string | null;
  created_at: string;
  settlement_submitted_at: string | null;
  template_name: string;
  applicant_name: string;
  department_name: string;
  can_approve: boolean;   // legacy — no longer used in UI
  can_close: boolean;     // true when app_status = SETTLEMENT_APPROVED
  pending_step_id: string | null;
  pending_step_label: string | null;
  pending_approver_name: string | null;
}

// ── Status badge ──────────────────────────────────────────────────────────────
const APP_STATUS_CLS: Record<string, string> = {
  PENDING_SETTLEMENT: 'badge-mustard',
  SETTLEMENT_APPROVED: 'badge-approved',
  COMPLETED: 'badge-approved',
};

// ── Inline transfer date editor ────────────────────────────────────────────────
function DateEditor({
  settlementId,
  currentDate,
  currentNote,
  t,
}: {
  settlementId: string;
  currentDate: string | null;
  currentNote: string | null;
  t: (k: any) => string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(currentDate ?? '');
  const [note, setNote] = useState(currentNote ?? '');

  const mutation = useMutation({
    mutationFn: async () =>
      (
        await apiClient.patch(`/accounting/settlements/${settlementId}`, {
          transfer_date: date || null,
          accounting_note: note,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accountingSettlements'] });
      setEditing(false);
    },
  });

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={`text-xs font-semibold px-2 py-1 rounded-lg transition-colors ${
          currentDate
            ? 'text-teal-700 bg-teal-50 border border-teal-200/60 hover:bg-teal-100'
            : 'text-warmgray-400 hover:text-ringo-500'
        }`}
      >
        {currentDate
          ? new Date(currentDate).toLocaleDateString('ja-JP')
          : '— ' + t('accounting_transfer_date_ph')}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 min-w-[210px] p-3 bg-white/80 rounded-xl border border-white/90 shadow-sm backdrop-blur-sm animate-scale-in">
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">{t('accounting_col_transfer')}</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input-date w-full"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">{t('accounting_col_proof')}</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('accounting_note_ph')}
          className="input text-xs py-1.5 px-2.5"
        />
      </div>
      <div className="flex gap-2 pt-0.5">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="flex-1 btn-primary text-xs py-1.5 px-3 flex items-center justify-center gap-1.5"
        >
          {mutation.isPending ? (
            <><svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>{t('accounting_saving')}</>
          ) : (
            <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>{t('accounting_save_date')}</>
          )}
        </button>
        <button
          onClick={() => { setEditing(false); setDate(currentDate ?? ''); setNote(currentNote ?? ''); }}
          className="btn-ghost text-xs py-1.5 px-2"
        >
          {t('btn_cancel')}
        </button>
      </div>
      {mutation.isError && (
        <p className="text-[11px] text-ringo-500 flex items-center gap-1"><span>⚠</span> 保存に失敗しました</p>
      )}
    </div>
  );
}

// ── Transfer proof uploader ───────────────────────────────────────────────────
function ProofUploader({
  settlementId,
  proofUrl,
  t,
}: {
  settlementId: string;
  proofUrl: string | null;
  t: (k: any) => string;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await apiClient.post(`/accounting/settlements/${settlementId}/transfer-proof`, fd);
      queryClient.invalidateQueries({ queryKey: ['accountingSettlements'] });
    } catch {
      alert('アップロードに失敗しました');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Same-origin URLs (vite proxy in dev, reverse proxy in prod)
  const fullUrl = proofUrl ?? null;

  return (
    <div className="flex items-center gap-2">
      {fullUrl ? (
        <>
          <span className="text-[10px] font-semibold text-teal-600 bg-teal-50 border border-teal-200/60 px-1.5 py-0.5 rounded-full">
            {t('accounting_proof_uploaded')}
          </span>
          <a
            href={fullUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-ringo-500 hover:text-ringo-600 font-semibold"
          >
            {t('accounting_proof_view')}
          </a>
        </>
      ) : null}
      <label className={`text-xs cursor-pointer font-semibold transition-colors ${
        uploading ? 'text-warmgray-400' : 'text-warmgray-400 hover:text-ringo-500'
      }`}>
        <input ref={fileInputRef} type="file" className="sr-only" onChange={handleFile} disabled={uploading} />
        {uploading ? t('accounting_uploading') : (fullUrl ? '↺ 更新' : t('accounting_upload_proof'))}
      </label>
    </div>
  );
}

// ── Settlement close button (Phase 2 — gated on transfer_date + proof) ────────
// Called only when app_status = SETTLEMENT_APPROVED (workflow fully done).
function CloseButton({
  settlementId,
  transferDate,
  proofUrl,
}: {
  settlementId: string;
  transferDate: string | null;
  proofUrl: string | null;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () =>
      (await apiClient.post(`/accounting/settlements/${settlementId}/close`, {})).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accountingSettlements'] });
      queryClient.invalidateQueries({ queryKey: ['myApplications'] });
    },
  });

  const missingDate  = !transferDate;
  const missingProof = !proofUrl;
  const blocked = missingDate || missingProof;

  if (mutation.isSuccess) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200/60">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
        完了
      </span>
    );
  }

  if (blocked) {
    const hints: string[] = [];
    if (missingDate)  hints.push('振込日');
    if (missingProof) hints.push('振込証明');
    return (
      <div className="group relative inline-block">
        <button
          disabled
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-surface-100/60 text-warmgray-400 border border-surface-200/60 cursor-not-allowed flex items-center gap-1.5"
        >
          <svg className="w-3 h-3 text-warmgray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          精算を締める
        </button>
        <div className="pointer-events-none absolute bottom-full left-0 mb-2 w-max max-w-[200px] opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20">
          <div className="bg-warmgray-800 text-white text-[11px] font-medium rounded-lg px-3 py-2 shadow-lg leading-relaxed">
            先に {hints.join('・')} を入力してください
            <div className="absolute top-full left-3 border-4 border-transparent border-t-warmgray-800" />
          </div>
        </div>
      </div>
    );
  }

  if (mutation.isError) {
    const msg = (mutation.error as Error).message;
    return (
      <div className="flex flex-col gap-1">
        <button
          onClick={() => mutation.mutate()}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-500 text-white hover:bg-teal-600 active:scale-[0.98] shadow-sm transition-all duration-150 flex items-center gap-1.5"
        >
          再試行
        </button>
        <p className="text-[10px] text-ringo-500 max-w-[120px]">{msg}</p>
      </div>
    );
  }

  return (
    <button
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-500 text-white hover:bg-teal-600 active:scale-[0.98] shadow-sm transition-all duration-150 disabled:opacity-60 flex items-center gap-1.5"
    >
      {mutation.isPending ? (
        <>
          <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          処理中…
        </>
      ) : (
        <>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          精算を締める
        </>
      )}
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Accounting() {
  const { t, lang } = useLang();
  const dateLocale = lang === 'en' ? 'en-US' : 'ja-JP';

  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'DONE'>('ALL');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const PAGE = 25;
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery<{ items: Settlement[]; hasMore: boolean; offset: number; nextCursor?: string | null }>({
    queryKey: ['accountingSettlements'],                   // always ALL — filter is client-side
    queryFn: async ({ pageParam = null }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : '';
      return (await apiClient.get(
        `/accounting/settlements?filter=ALL&limit=${PAGE}${cursor}`
      )).data;
    },
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const allItems = data?.pages.flatMap(p => p.items) ?? [];
  // Client-side filter — no re-fetch on tab switch
  const filtered = filter === 'ALL' ? allItems
    : filter === 'PENDING' ? allItems.filter(s => s.app_status === 'PENDING_SETTLEMENT')
    : allItems.filter(s => ['COMPLETED', 'SETTLEMENT_APPROVED'].includes(s.app_status));

  const MIN_VISIBLE = 8;
  useEffect(() => {
    if (filter === 'ALL') return;
    if (filtered.length >= MIN_VISIBLE) return;
    if (!hasNextPage || isFetchingNextPage) return;
    fetchNextPage();
  }, [filtered.length, hasNextPage, isFetchingNextPage, filter, fetchNextPage]);

  const sentinelRef = useScrollEnd(
    useCallback(() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }, [hasNextPage, isFetchingNextPage, fetchNextPage]),
    hasNextPage ?? false,
  );

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((s) => s.settlement_id)));
  };

  // CSV export — async via worker. Flow:
  //   1. POST /export → { jobId }
  //   2. Poll GET /:jobId every 1.5s until status=ready (or failed)
  //   3. Trigger browser download via hidden anchor on /download URL
  // Avoids blocking the UI, avoids OOM on big exports.
  const [csvBusy, setCsvBusy] = useState(false);

  const downloadCSV = async () => {
    if (csvBusy) return;
    setCsvBusy(true);

    try {
      const ids = selected.size > 0 ? [...selected] : undefined;
      const enq = await apiClient.post('/accounting/settlements/csv/export', { ids });
      const jobId = enq.data?.jobId as string;
      if (!jobId) throw new Error('jobId missing in response');

      // Poll status — cap at 60 attempts (90s)
      let status = 'queued';
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const s = await apiClient.get(`/accounting/settlements/csv/${jobId}`);
        status = s.data.status;
        if (status === 'ready' || status === 'failed') break;
      }

      if (status !== 'ready') {
        alert(status === 'failed' ? 'CSVエクスポートに失敗しました' : 'CSVの生成がタイムアウトしました');
        return;
      }

      // Trigger download
      const a = document.createElement('a');
      a.href = `/api/accounting/settlements/csv/${jobId}/download`;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error('[CSV] download failed', err);
      alert('CSVエクスポートに失敗しました');
    } finally {
      setCsvBusy(false);
    }
  };

  const STATUS_LABEL: Record<string, string> = {
    PENDING_SETTLEMENT: t('status_pending_settle'),
    SETTLEMENT_APPROVED: t('status_settle_approved'),
    COMPLETED: t('status_completed'),
  };

  const fmt = (n: number | null | undefined) =>
    n != null ? `¥${Number(n).toLocaleString('ja-JP')}` : '—';

  return (
    <Layout title={t('title_accounting')}>
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="animate-fade-up flex items-end justify-between">
          <div>
            <p className="section-title mb-0">{t('title_accounting')}</p>
            <p className="text-sm text-warmgray-400 mt-1">{t('accounting_subtitle')}</p>
          </div>
          <button
            onClick={downloadCSV}
            className="btn-outline text-xs flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {t('accounting_export_csv')}
            {selected.size > 0
              ? ` (${t('accounting_export_selected')} ${selected.size})`
              : ` (${t('accounting_export_all')})`}
          </button>
        </div>

        {/* Filter pills */}
        <div className="animate-fade-up flex gap-2">
          {(['ALL', 'PENDING', 'DONE'] as const).map((f) => {
            const label = f === 'ALL' ? t('accounting_filter_all') : f === 'PENDING' ? t('accounting_filter_pending') : t('accounting_filter_done');
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-150 ${
                  filter === f
                    ? 'bg-warmgray-800 text-white shadow-sm'
                    : 'bg-white/60 text-warmgray-500 hover:bg-white/90 border border-white/80 backdrop-blur-sm'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="card">
            <RingoLoader.Block label={t('loading')} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="card flex flex-col items-center justify-center py-20 gap-4 text-warmgray-400">
            <span className="text-5xl">📭</span>
            <p className="text-sm font-medium">{t('accounting_no_items')}</p>
          </div>
        ) : (
          <div className="card !p-0 md:overflow-hidden animate-fade-up">
            <div className="md:overflow-x-auto">
              <table className="table-base table-responsive">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        checked={selected.size === filtered.length && filtered.length > 0}
                        onChange={toggleAll}
                        className="rounded"
                      />
                    </th>
                    <th>{t('accounting_col_app')}</th>
                    <th>{t('accounting_col_applicant')}</th>
                    <th>{t('accounting_col_template')}</th>
                    <th className="text-right">{t('accounting_col_expected')}</th>
                    <th className="text-right">{t('accounting_col_actual')}</th>
                    <th>{t('accounting_col_transfer')}</th>
                    <th>{t('accounting_col_proof')}</th>
                    <th>{t('accounting_col_status')}</th>
                    <th>精算処理</th>
                    <th>{t('col_detail')}</th>
                  </tr>
                </thead>
                <tbody className="md:divide-y md:divide-white/20">
                  {filtered.map((s) => {
                    const statusCls = APP_STATUS_CLS[s.app_status] ?? 'badge-draft';
                    const delta = s.actual_amount - s.expected_amount;
                    return (
                      <tr
                        key={s.settlement_id}
                        className="hover:bg-white/30 transition-colors duration-100"
                      >
                        <td>
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selected.has(s.settlement_id)}
                              onChange={() => toggleSelect(s.settlement_id)}
                              className="rounded"
                            />
                            <span className="md:hidden text-[10px] uppercase tracking-widest font-bold text-warmgray-400">選択</span>
                          </label>
                        </td>

                        <td data-label={t('accounting_col_app')}>
                          <Link
                            to={`/applications/${s.application_id}`}
                            className="text-xs font-mono text-ringo-500 hover:text-ringo-600 font-semibold"
                          >
                            {s.application_number ?? '—'}
                          </Link>
                          <p className="text-[10px] text-warmgray-400 mt-0.5">
                            {s.settlement_submitted_at
                              ? new Date(s.settlement_submitted_at).toLocaleDateString(dateLocale)
                              : new Date(s.created_at).toLocaleDateString(dateLocale)}
                          </p>
                        </td>

                        <td data-label={t('accounting_col_applicant')}>
                          <div className="md:text-left text-right">
                            <p className="text-sm font-medium text-warmgray-800">{s.applicant_name}</p>
                            <p className="text-[11px] text-warmgray-400">{s.department_name}</p>
                          </div>
                        </td>

                        <td data-label={t('accounting_col_template')}>
                          <p className="text-xs text-warmgray-600 font-medium">{s.template_name}</p>
                        </td>

                        <td data-label={t('accounting_col_expected')} className="md:text-right">
                          <span className="text-sm text-warmgray-500">{fmt(s.expected_amount)}</span>
                        </td>

                        <td data-label={t('accounting_col_actual')} className="md:text-right">
                          <div className="md:text-right">
                            <span className="text-sm font-bold text-warmgray-800">{fmt(s.actual_amount)}</span>
                            {s.actual_amount > 0 && delta !== 0 && (
                              <p className={`text-[10px] font-semibold mt-0.5 ${delta > 0 ? 'text-ringo-500' : 'text-emerald-600'}`}>
                                {delta > 0 ? '+' : ''}{fmt(delta)}
                              </p>
                            )}
                          </div>
                        </td>

                        <td data-label={t('accounting_col_transfer')}>
                          <DateEditor
                            settlementId={s.settlement_id}
                            currentDate={s.transfer_date}
                            currentNote={s.accounting_note}
                            t={t}
                          />
                        </td>

                        <td data-label={t('accounting_col_proof')}>
                          <ProofUploader
                            settlementId={s.settlement_id}
                            proofUrl={s.transfer_proof_url}
                            t={t}
                          />
                        </td>

                        <td data-label={t('accounting_col_status')}>
                          <span className={statusCls}>
                            {STATUS_LABEL[s.app_status] ?? s.app_status}
                          </span>
                        </td>

                        <td data-label="精算処理">
                          {s.app_status === 'SETTLEMENT_APPROVED' ? (
                            <CloseButton
                              settlementId={s.settlement_id}
                              transferDate={s.transfer_date}
                              proofUrl={s.transfer_proof_url}
                            />
                          ) : s.app_status === 'PENDING_SETTLEMENT' ? (
                            <div className="flex flex-col gap-0.5 md:items-start items-end">
                              <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200/60 px-2 py-0.5 rounded-full whitespace-nowrap">
                                承認フロー進行中
                              </span>
                              {s.pending_approver_name && (
                                <span className="text-[10px] text-warmgray-400 truncate md:max-w-[110px]">
                                  次: {s.pending_approver_name}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-full whitespace-nowrap">
                              ✓ {t('status_completed')}
                            </span>
                          )}
                        </td>

                        <td data-label={t('col_detail')}>
                          <Link
                            to={`/applications/${s.application_id}`}
                            className="text-xs font-semibold text-ringo-500 hover:text-ringo-600 whitespace-nowrap"
                          >
                            {t('col_detail')} →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Sentinel — invisible; observer fires early via rootMargin */}
            <div ref={sentinelRef} className="h-px" />
            {(isFetchingNextPage || (!hasNextPage && filtered.length >= PAGE)) && (
              <div className="px-5 py-3 flex items-center justify-center gap-2 text-warmgray-400 text-xs border-t border-white/20">
                {isFetchingNextPage ? (
                  <>
                    <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    {t('loading')}
                  </>
                ) : (
                  <span className="text-warmgray-300">{lang === 'en' ? 'All loaded' : '全件表示済み'}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
