import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useScrollEnd } from '../hooks/useScrollEnd';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import { Link } from 'react-router-dom';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import RingoLoader from '../components/common/RingoLoader';
import { Sk } from '../components/common/Skeleton';
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
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-surface-100/60 text-warmgray-400 border border-surface-200/60 cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap"
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
      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-500 text-white hover:bg-teal-600 active:scale-[0.98] shadow-sm transition-all duration-150 disabled:opacity-60 flex items-center gap-1.5 whitespace-nowrap"
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
  // selectAllServer = user confirmed "select ALL server records" for current filters.
  // Bypasses loaded-only limitation — CSV export sends filter params instead of IDs.
  const [selectAllServer, setSelectAllServer] = useState(false);

  // ── Date filters (server-side — changes queryKey → fresh fetch) ──────────────
  type DatePreset = 'ALL' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';
  const [datePreset, setDatePreset] = useState<DatePreset>('ALL');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo,   setCustomTo]   = useState('');

  const { apiDateFrom, apiDateTo } = useMemo(() => {
    const now  = new Date();
    const pad  = (n: number) => String(n).padStart(2, '0');
    const iso  = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    if (datePreset === 'THIS_MONTH') {
      return {
        apiDateFrom: `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`,
        apiDateTo:   iso(now),
      };
    }
    if (datePreset === 'LAST_MONTH') {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last  = new Date(now.getFullYear(), now.getMonth(), 0);
      return { apiDateFrom: iso(first), apiDateTo: iso(last) };
    }
    if (datePreset === 'CUSTOM') {
      return { apiDateFrom: customFrom, apiDateTo: customTo };
    }
    return { apiDateFrom: '', apiDateTo: '' };
  }, [datePreset, customFrom, customTo]);

  const PAGE = 25;
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
  } = useInfiniteQuery<{ items: Settlement[]; hasMore: boolean; offset: number; nextCursor?: string | null }>({
    // Include date params in key — date filter change triggers fresh server fetch.
    // Status filter (ALL/PENDING/DONE) is still client-side on already-loaded pages.
    queryKey: ['accountingSettlements', apiDateFrom, apiDateTo],
    queryFn: async ({ pageParam = null }) => {
      const params = new URLSearchParams({ filter: 'ALL', limit: String(PAGE) });
      if (apiDateFrom) params.set('date_from', apiDateFrom);
      if (apiDateTo)   params.set('date_to',   apiDateTo);
      if (pageParam)   params.set('cursor',     encodeURIComponent(String(pageParam)));
      return (await apiClient.get(`/accounting/settlements?${params}`)).data;
    },
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
    // Keep old data visible while new date/filter fetch runs — no full spinner flash
    placeholderData: keepPreviousData,
  });

  const showLoader = useDelayedLoading(isLoading);

  const allItems = data?.pages.flatMap(p => p.items) ?? [];
  // Client-side filter — no re-fetch on tab switch
  // PENDING = settlement workflow approved, awaiting soumu transfer_date + proof + close
  // DONE    = fully completed by accounting
  // ALL     = all settlement-phase applications (including in-approval ones)
  const filtered = filter === 'ALL' ? allItems
    : filter === 'PENDING' ? allItems.filter(s => s.app_status === 'SETTLEMENT_APPROVED')
    : allItems.filter(s => s.app_status === 'COMPLETED');

  const MIN_VISIBLE = 8;
  useEffect(() => {
    if (filter === 'ALL') return;
    if (filtered.length >= MIN_VISIBLE) return;
    if (!hasNextPage || isFetchingNextPage) return;
    fetchNextPage();
  }, [filtered.length, hasNextPage, isFetchingNextPage, filter, fetchNextPage]);

  // Reset selection whenever active filters change (data set changes → old selection stale)
  useEffect(() => {
    setSelectAllServer(false);
    setSelected(new Set());
  }, [apiDateFrom, apiDateTo, filter]);

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
    if (selectAllServer) {
      // Deselect everything
      setSelectAllServer(false);
      setSelected(new Set());
    } else if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((s) => s.settlement_id)));
    }
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
      // selectAllServer = export all matching current date filter (bypass loaded-only limit)
      const body: Record<string, unknown> = {};
      if (selectAllServer) {
        body.selectAll = true;
        if (apiDateFrom) body.dateFrom = apiDateFrom;
        if (apiDateTo)   body.dateTo   = apiDateTo;
      } else if (selected.size > 0) {
        body.ids = [...selected];
      }
      const enq = await apiClient.post('/accounting/settlements/csv/export', body);
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
      <div className="max-w-[1800px] mx-auto space-y-6">

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
            {selectAllServer
              ? ` (${lang === 'en' ? 'All in period' : '期間内全件'})`
              : selected.size > 0
              ? ` (${t('accounting_export_selected')} ${selected.size})`
              : ` (${t('accounting_export_all')})`}
          </button>
        </div>

        {/* Filter bar */}
        <div className="animate-fade-up space-y-3">

          {/* Row 1: date presets + custom range */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mr-1 shrink-0">
              {lang === 'en' ? 'Period' : '期間'}
            </span>
            {([
              { v: 'ALL',        ja: '全期間',     en: 'All time' },
              { v: 'THIS_MONTH', ja: '今月',       en: 'This month' },
              { v: 'LAST_MONTH', ja: '先月',       en: 'Last month' },
              { v: 'CUSTOM',     ja: 'カスタム',   en: 'Custom' },
            ] as { v: DatePreset; ja: string; en: string }[]).map(({ v, ja, en }) => (
              <button
                key={v}
                onClick={() => setDatePreset(v)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-150 ${
                  datePreset === v
                    ? 'bg-ringo-500 text-white shadow-sm'
                    : 'bg-white/60 text-warmgray-500 hover:bg-white/90 border border-white/80 backdrop-blur-sm'
                }`}
              >
                {lang === 'en' ? en : ja}
              </button>
            ))}

            {/* Custom date inputs — only shown when preset = CUSTOM */}
            {datePreset === 'CUSTOM' && (
              <div className="flex items-center gap-2 ml-1 animate-scale-in">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="input-date text-xs py-1 px-2 h-8"
                />
                <span className="text-warmgray-400 text-xs">—</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="input-date text-xs py-1 px-2 h-8"
                />
                {(customFrom || customTo) && (
                  <button
                    onClick={() => { setCustomFrom(''); setCustomTo(''); }}
                    className="text-warmgray-400 hover:text-warmgray-700 text-xs transition-colors"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Row 2: status pills */}
          <div className="flex gap-2 items-center">
            <span className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mr-1 shrink-0">
              {lang === 'en' ? 'Status' : '状態'}
            </span>
            {([
              { v: 'ALL',     ja: t('accounting_filter_all'),     en: t('accounting_filter_all') },
              { v: 'PENDING', ja: t('accounting_filter_pending'), en: t('accounting_filter_pending') },
              { v: 'DONE',    ja: t('accounting_filter_done'),    en: t('accounting_filter_done') },
            ] as { v: 'ALL' | 'PENDING' | 'DONE'; ja: string; en: string }[]).map(({ v, ja }) => (
              <button
                key={v}
                onClick={() => setFilter(v)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-150 ${
                  filter === v
                    ? 'bg-warmgray-800 text-white shadow-sm'
                    : 'bg-white/60 text-warmgray-500 hover:bg-white/90 border border-white/80 backdrop-blur-sm'
                }`}
              >
                {ja}
              </button>
            ))}

            {/* Active date badge */}
            {datePreset !== 'ALL' && (
              <span className="ml-2 flex items-center gap-1.5 text-[11px] font-semibold text-ringo-600 bg-ringo-50/80 border border-ringo-200/60 px-2.5 py-1 rounded-full">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5" />
                </svg>
                {apiDateFrom && apiDateTo
                  ? `${apiDateFrom} – ${apiDateTo}`
                  : apiDateFrom ? `${lang === 'en' ? 'From' : '以降'} ${apiDateFrom}`
                  : apiDateTo   ? `${lang === 'en' ? 'Until' : '以前'} ${apiDateTo}`
                  : datePreset === 'THIS_MONTH' ? (lang === 'en' ? 'This month' : '今月')
                  : lang === 'en' ? 'Last month' : '先月'}
                <button
                  onClick={() => { setDatePreset('ALL'); setCustomFrom(''); setCustomTo(''); }}
                  className="ml-0.5 text-ringo-400 hover:text-ringo-700 transition-colors"
                >✕</button>
              </span>
            )}
          </div>
        </div>

        {/* Select-all-server banners — shown above table when relevant */}
        {!selectAllServer && !isLoading && hasNextPage && selected.size === filtered.length && filtered.length > 0 && (
          <div className="animate-fade-up flex items-center gap-3 px-4 py-3 rounded-2xl bg-blue-50/90 border border-blue-200/60 text-blue-700 text-xs font-semibold shadow-sm">
            <svg className="w-4 h-4 shrink-0 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              {lang === 'en'
                ? `${filtered.length} loaded records selected — more exist on server.`
                : `読み込み済み${filtered.length}件を選択中。まだ未読み込みの件があります。`}
            </span>
            <button
              onClick={() => setSelectAllServer(true)}
              className="ml-auto whitespace-nowrap underline underline-offset-2 hover:text-blue-900 transition-colors"
            >
              {lang === 'en' ? 'Select ALL in this period →' : 'この期間の全件を選択 →'}
            </button>
          </div>
        )}
        {selectAllServer && (
          <div className="animate-fade-up flex items-center gap-3 px-4 py-3 rounded-2xl bg-blue-600/90 border border-blue-700/60 text-white text-xs font-semibold shadow-sm">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            <span>
              {lang === 'en'
                ? `All records in this period selected (including unloaded)`
                : 'この期間の全件を選択中（未読み込み含む）'}
              {apiDateFrom && apiDateTo ? ` — ${apiDateFrom} – ${apiDateTo}` : ''}
            </span>
            <button
              onClick={() => { setSelectAllServer(false); setSelected(new Set()); }}
              className="ml-auto whitespace-nowrap opacity-80 hover:opacity-100 underline underline-offset-2 transition-opacity"
            >
              {lang === 'en' ? '✕ Clear' : '✕ 解除'}
            </button>
          </div>
        )}

        {/* Table */}
        {showLoader ? (
          <div className="card !p-0 md:overflow-hidden">
            <div className="md:overflow-x-auto">
              <table className="table-base w-full">
                <thead>
                  <tr>
                    <th className="w-8"><Sk.Box w="w-4" h="h-4" className="rounded" /></th>
                    <th>{t('accounting_col_app')}</th>
                    <th>{t('accounting_col_applicant')}</th>
                    <th className="text-right">金額</th>
                    <th>振込情報</th>
                    <th>{t('accounting_col_status')}</th>
                    <th>精算処理</th>
                    <th className="w-10">{t('col_detail')}</th>
                  </tr>
                </thead>
                <tbody className="md:divide-y md:divide-white/20">
                  {[...Array(8)].map((_, i) => (
                    <tr key={i}>
                      <td><Sk.Box w="w-4" h="h-4" className="rounded" /></td>
                      <td>
                        <div className="space-y-1.5">
                          <Sk.Line w={i % 3 === 0 ? 'w-24' : i % 3 === 1 ? 'w-20' : 'w-28'} h="h-3" />
                          <Sk.Line w="w-16" h="h-2.5" />
                          <Sk.Line w="w-12" h="h-2" />
                        </div>
                      </td>
                      <td>
                        <div className="space-y-1.5">
                          <Sk.Line w="w-20" h="h-3" />
                          <Sk.Line w="w-16" h="h-2.5" />
                        </div>
                      </td>
                      <td>
                        <div className="flex flex-col items-end gap-1">
                          <Sk.Line w="w-16" h="h-2.5" />
                          <Sk.Line w="w-20" h="h-3.5" />
                        </div>
                      </td>
                      <td>
                        <div className="space-y-1.5">
                          <Sk.Line w="w-20" h="h-3" />
                          <Sk.Line w="w-24" h="h-3" />
                        </div>
                      </td>
                      <td><Sk.Badge w="w-16" /></td>
                      <td><Sk.Badge w="w-16" /></td>
                      <td><Sk.Line w="w-6" h="h-3" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : isLoading ? null /* loader-delay window — blank, never flash "no data" while fetching */ : filtered.length === 0 ? (
          <div className="card flex flex-col items-center justify-center py-20 gap-4 text-warmgray-400">
            <span className="text-5xl">📭</span>
            <p className="text-sm font-medium">{t('accounting_no_items')}</p>
          </div>
        ) : (
          <div className={`card !p-0 overflow-hidden animate-fade-up transition-opacity duration-200 ${isFetching && !isFetchingNextPage ? 'opacity-60 pointer-events-none' : 'opacity-100'}`}>
            <table className="table-base w-full">
              <thead>
                <tr>
                  <th className="w-8">
                    <input
                      type="checkbox"
                      checked={selectAllServer || (selected.size === filtered.length && filtered.length > 0)}
                      ref={(el) => {
                        if (el) el.indeterminate = !selectAllServer && selected.size > 0 && selected.size < filtered.length;
                      }}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th>{t('accounting_col_app')}</th>
                  <th>{t('accounting_col_applicant')}</th>
                  <th className="text-right">金額</th>
                  <th>振込情報</th>
                  <th>{t('accounting_col_status')}</th>
                  <th>精算処理</th>
                  <th className="w-10">{t('col_detail')}</th>
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
                            className="text-xs font-mono text-ringo-500 hover:text-ringo-600 font-semibold whitespace-nowrap"
                          >
                            {s.application_number ?? '—'}
                          </Link>
                          <p className="text-[10px] text-warmgray-500 truncate mt-0.5">{s.template_name}</p>
                          <p className="text-[10px] text-warmgray-400">
                            {s.settlement_submitted_at
                              ? new Date(s.settlement_submitted_at).toLocaleDateString(dateLocale)
                              : new Date(s.created_at).toLocaleDateString(dateLocale)}
                          </p>
                        </td>

                        <td data-label={t('accounting_col_applicant')}>
                          <p className="text-xs font-medium text-warmgray-800 truncate">{s.applicant_name}</p>
                          <p className="text-[10px] text-warmgray-400 truncate">{s.department_name}</p>
                        </td>

                        {/* Amounts — stacked: est / actual / delta */}
                        <td data-label="金額" className="text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[10px] tabular-nums text-warmgray-400 whitespace-nowrap">概算 {fmt(s.expected_amount)}</span>
                            <span className="text-sm font-bold tabular-nums text-warmgray-800 whitespace-nowrap">{fmt(s.actual_amount)}</span>
                            {(s.expected_amount > 0 || s.actual_amount > 0) && delta !== 0 && (
                              <span className={`text-[10px] font-semibold tabular-nums whitespace-nowrap ${delta > 0 ? 'text-ringo-500' : 'text-emerald-600'}`}>
                                {delta > 0 ? '+' : ''}{fmt(delta)}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Transfer info — date + proof stacked */}
                        <td data-label="振込情報">
                          <div className="space-y-1.5">
                            <DateEditor
                              settlementId={s.settlement_id}
                              currentDate={s.transfer_date}
                              currentNote={s.accounting_note}
                              t={t}
                            />
                            <ProofUploader
                              settlementId={s.settlement_id}
                              proofUrl={s.transfer_proof_url}
                              t={t}
                            />
                          </div>
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

            {/* Sentinel — invisible; observer fires early via rootMargin */}
            <div ref={sentinelRef} className="h-px" />

            {/* Load-more feedback */}
            {isFetchingNextPage ? (
              <div className="px-5 py-3 flex items-center justify-center border-t border-white/20">
                <RingoLoader.Inline />
              </div>
            ) : hasNextPage ? (
              /* More pages exist on server — user may not see all matching rows for current status filter */
              <div className="px-5 py-3 flex items-center gap-2.5 border-t border-amber-200/40 bg-amber-50/60 text-amber-700 text-xs">
                <svg className="w-4 h-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
                <span className="font-semibold">
                  {lang === 'en'
                    ? 'More records not yet loaded — scroll down to load them'
                    : 'まだ読み込まれていない件があります。スクロールして続きを表示'}
                </span>
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="ml-auto text-[11px] font-bold underline underline-offset-2 hover:text-amber-800 transition-colors"
                >
                  {lang === 'en' ? 'Load now' : '今すぐ読み込む'}
                </button>
              </div>
            ) : filtered.length >= PAGE ? (
              <div className="px-5 py-3 flex items-center justify-center text-warmgray-300 text-xs border-t border-white/20">
                {lang === 'en' ? 'All records loaded' : '全件表示済み'}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Layout>
  );
}
