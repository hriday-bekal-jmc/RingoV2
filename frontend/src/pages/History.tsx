import { useState, useEffect, useCallback, useRef } from 'react';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import CustomSelect from '../components/forms/CustomSelect';
import { useScrollEnd } from '../hooks/useScrollEnd';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { useLang } from '../context/LanguageContext';
import { templateLabel } from '../config/templateLabels';
import RingoLoader from '../components/common/RingoLoader';
import PatternBadge from '../components/common/PatternBadge';
import { Sk } from '../components/common/Skeleton';

interface RowTextPreview { label: string; label_en: string; value: string }
interface RowNumberPreview {
  label: string; label_en: string; value: number | null;
  compare_label?: string; compare_label_en?: string; compare_value?: number | null;
  is_different: boolean;
}
interface RowPreview { text: RowTextPreview | null; numbers: RowNumberPreview[] }

interface Application {
  id: string;
  application_number: string | null;
  status: string;
  template_name: string;
  template_title_en?: string | null;
  template_code?: string;
  has_settlement?: boolean;
  pattern_id?: number;
  created_at: string;
  current_step?: number | null;
  total_steps?: number;
  row_preview?: RowPreview | null;
  archived_at?: string | null;
  /** RETURNED app whose returned step was in the SETTLEMENT phase → belongs in
      the settlement-pending bucket (edit & resend), not the ringi返し戻し bucket. */
  settlement_returned?: boolean;
}

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div className={`fixed top-6 right-6 z-50 animate-scale-in flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-lg text-sm font-semibold
      ${type === 'success' ? 'bg-emerald-500 text-white' : 'bg-ringo-500 text-white'}`}>
      <span className="text-base">{type === 'success' ? '✓' : '✕'}</span>
      {message}
    </div>
  );
}

const STATUS_CLS: Record<string, string> = {
  DRAFT:              'badge-draft',
  PENDING_APPROVAL:   'badge-pending',
  APPROVED:           'badge-approved',
  REJECTED:           'badge-rejected',
  RETURNED:           'badge-returned',
  PENDING_SETTLEMENT: 'badge-mustard',
  SETTLEMENT_APPROVED:'badge-approved',
  COMPLETED:          'badge-approved',
  CANCELLED:          'badge-draft',
};

const ALL_STATUS_KEYS = ['ALL', 'DRAFT', 'PENDING_APPROVAL', 'RETURNED', 'PENDING_SETTLEMENT', 'SETTLEMENT_APPROVED', 'COMPLETED'];

export default function History() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t, lang } = useLang();
  const dateLocale = lang === 'en' ? 'en-US' : 'ja-JP';

  const STATUS_LABEL: Record<string, string> = {
    DRAFT:              t('status_draft'),
    PENDING_APPROVAL:   t('status_pending'),
    APPROVED:           t('status_approved'),
    REJECTED:           t('status_rejected'),
    RETURNED:           t('status_returned'),
    PENDING_SETTLEMENT: t('status_pending_settle'),
    SETTLEMENT_APPROVED:t('status_settle_approved'),
    COMPLETED:          t('status_completed'),
    CANCELLED:          t('status_cancelled'),
  };

  const initialFilter = searchParams.get('filter') ?? 'ALL';
  const [statusFilter, setStatusFilter] = useState(
    ALL_STATUS_KEYS.includes(initialFilter) ? initialFilter : 'ALL'
  );
  // Re-sync filter when URL changes (e.g. dashboard tile navigation)
  useEffect(() => {
    const f = searchParams.get('filter') ?? 'ALL';
    setStatusFilter(ALL_STATUS_KEYS.includes(f) ? f : 'ALL');
  }, [searchParams]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Application | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState<Application | null>(null);
  // Archived apps are excluded by default (kept out of hot queries). Opt-in
  // toggle re-fetches with include_archived so users can still view old apps.
  const [showArchived, setShowArchived] = useState(false);
  const [phaseFilter, setPhaseFilter] = useState<'ALL' | 'RINGI' | 'SETTLEMENT'>('ALL');
  const [templateCode, setTemplateCode] = useState('ALL');
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [completion, setCompletion] = useState('ALL');

  const { data: templates } = useQuery<Array<{ id: string; code: string; title_ja: string; title: string | null }>>({
    queryKey: ['templates'],
    queryFn: async () => (await apiClient.get('/templates')).data,
    staleTime: 5 * 60_000,
  });
  const templateOptions = [
    { value: 'ALL', label: lang === 'en' ? 'All types' : 'すべての申請区分' },
    ...(templates ?? []).map((t) => ({ value: t.code, label: t.title_ja })),
  ];
  const completionOptions = [
    { value: 'ALL',        label: lang === 'en' ? 'All'              : 'すべて' },
    { value: 'INCOMPLETE', label: lang === 'en' ? 'In Progress'      : '未完了（進行中）' },
    { value: 'COMPLETE',   label: lang === 'en' ? 'Completed/Closed' : '完了・終了' },
  ];
  const hasExtraFilters = templateCode !== 'ALL' || keyword || completion !== 'ALL';
  const clearExtraFilters = () => {
    setTemplateCode('ALL'); setKeyword(''); setKeywordInput(''); setCompletion('ALL');
  };

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (searchParams.get('submitted') === '1') showToast(t('toast_submitted'));
    if (searchParams.get('drafted') === '1') showToast(t('toast_drafted'));
    if (searchParams.get('settled') === '1') showToast(t('toast_settled'));
  }, [searchParams]);

  const PAGE = 25;
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
  } = useInfiniteQuery<{ items: Application[]; hasMore: boolean; offset: number; nextCursor?: string | null }>({
    queryKey: ['myApplications', showArchived],            // status filter is client-side; archived needs a refetch
    queryFn: async ({ pageParam = null }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : '';
      // "Archived" toggle = dedicated archived view (only archived rows), so
      // old archived apps surface immediately instead of being buried on a
      // later page behind newer active ones.
      const archived = showArchived ? '&archived=only' : '';
      return (await apiClient.get(
        `/applications?limit=${PAGE}&status=ALL${archived}${cursor}`
      )).data;
    },
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
    gcTime:    60_000,
    placeholderData: keepPreviousData,
  });

  const showLoader = useDelayedLoading(isLoading);

  const applications = data?.pages.flatMap(p => p.items) ?? [];
  // Client-side filter — no re-fetch on tab switch.
  // Settlement-phase returns (status RETURNED + settlement_returned) belong in the
  // PENDING_SETTLEMENT bucket (edit & resend), NOT the ringi返し戻し bucket.
  const matchesFilter = (a: Application, f: string): boolean => {
    if (f === 'ALL') return true;
    if (f === 'PENDING_SETTLEMENT') return a.status === 'PENDING_SETTLEMENT' || !!a.settlement_returned;
    if (f === 'RETURNED')           return a.status === 'RETURNED' && !a.settlement_returned;
    return a.status === f;
  };
  const matchesPhase = (a: Application, p: string): boolean => {
    if (p === 'ALL') return true;
    const isSettlement = a.status === 'PENDING_SETTLEMENT' || a.status === 'SETTLEMENT_APPROVED' || !!a.settlement_returned;
    return p === 'SETTLEMENT' ? isSettlement : !isSettlement;
  };
  const COMPLETE_STATUSES = new Set(['APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'SETTLEMENT_APPROVED']);
  const matchesCompletion = (a: Application, c: string): boolean => {
    if (c === 'ALL') return true;
    const done = COMPLETE_STATUSES.has(a.status);
    return c === 'COMPLETE' ? done : !done;
  };
  const kw = keyword.toLowerCase();
  const matchesKeyword = (a: Application): boolean => {
    if (!kw) return true;
    return (
      (a.template_name ?? '').toLowerCase().includes(kw) ||
      (a.application_number ?? '').toLowerCase().includes(kw) ||
      (a.row_preview?.text?.value ?? '').toLowerCase().includes(kw)
    );
  };
  const sorted = applications
    .filter(a => matchesFilter(a, statusFilter))
    .filter(a => matchesPhase(a, phaseFilter))
    .filter(a => templateCode === 'ALL' || a.template_code === templateCode)
    .filter(a => matchesCompletion(a, completion))
    .filter(a => matchesKeyword(a));

  // Auto-fetch next pages when active filter yields too few visible results.
  // Keeps fetching (same ALL query, next page) until ≥8 filtered items are
  // visible or all pages are exhausted. Prevents "filter shows 2 items but
  // 10 more exist 3 pages away" problem without adding new query types.
  const MIN_VISIBLE = 8;
  const autoFetchingRef = useRef(false);
  useEffect(() => {
    if (statusFilter === 'ALL') return;           // ALL never needs this
    if (sorted.length >= MIN_VISIBLE) return;     // enough already visible
    if (!hasNextPage || isFetchingNextPage) return;
    autoFetchingRef.current = true;
    fetchNextPage();
  }, [sorted.length, hasNextPage, isFetchingNextPage, statusFilter, fetchNextPage]);

  const sentinelRef = useScrollEnd(
    useCallback(() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }, [hasNextPage, isFetchingNextPage, fetchNextPage]),
    hasNextPage ?? false,
  );

  const deleteDraft = useMutation({
    mutationFn: async (id: string) => (await apiClient.delete(`/applications/${id}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myApplications'] });
      showToast(t('toast_draft_deleted'));
    },
    onError: () => showToast(t('toast_delete_error'), 'error'),
  });

  const submitDraft = useMutation({
    mutationFn: async (id: string) => (await apiClient.post(`/applications/${id}/submit`, {})).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myApplications'] });
      showToast(t('toast_submitted'));
    },
    onError: (err: any) => showToast(`${t('toast_submit_error')}: ${err.message}`, 'error'),
  });

  const draftCount = applications.filter((a) => a.status === 'DRAFT').length;

  return (
    <Layout title={t('title_history')}>
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Confirm dialogs — language-aware quotes (「」 in JP, "..." in EN) */}
      {(() => {
        const open  = lang === 'en' ? '"' : '「';
        const close = lang === 'en' ? '"' : '」';
        const dName = templateLabel(confirmDelete?.template_code, lang, confirmDelete?.template_name ?? '', confirmDelete?.template_title_en);
        const sName = templateLabel(confirmSubmit?.template_code, lang, confirmSubmit?.template_name ?? '', confirmSubmit?.template_title_en);
        return (
          <>
            <ConfirmDialog
              isOpen={!!confirmDelete}
              title={t('confirm_delete_title')}
              message={`${open}${dName}${close} ${t('confirm_delete_body')}`}
              confirmLabel={t('confirm_delete_btn')}
              confirmClass="btn-danger"
              onConfirm={() => { if (confirmDelete) { deleteDraft.mutate(confirmDelete.id); setConfirmDelete(null); } }}
              onCancel={() => setConfirmDelete(null)}
            />
            <ConfirmDialog
              isOpen={!!confirmSubmit}
              title={t('confirm_submit_title')}
              message={`${open}${sName}${close} ${t('confirm_submit_body')}`}
              confirmLabel={t('btn_submit')}
              confirmClass="btn-primary"
              onConfirm={() => { if (confirmSubmit) { submitDraft.mutate(confirmSubmit.id); setConfirmSubmit(null); } }}
              onCancel={() => setConfirmSubmit(null)}
            />
          </>
        );
      })()}

      <div className="max-w-[1800px] mx-auto space-y-6">

        {/* Header row */}
        <div className="animate-fade-up flex items-end justify-between">
          <div>
            <p className="section-title mb-0">{t('title_history')}</p>
            <p className="text-2xl font-bold text-warmgray-800 mt-1">
              {sorted.length}{statusFilter !== 'ALL' && applications.length > sorted.length ? `/${applications.length}` : ''} {t('history_items_suffix')}
              {draftCount > 0 && (
                <span className="ml-2 text-sm font-normal text-warmgray-400">
                  {lang === 'en'
                    ? `(${draftCount} ${t('history_draft_suffix')})`
                    : `（${t('history_draft_suffix')} ${draftCount} ${t('history_items_suffix')}）`}
                </span>
              )}
            </p>
          </div>
          <Link to="/applications/new" className="btn-outline text-xs">
            {t('history_new_app')}
          </Link>
        </div>

        {/* Filter panel */}
        <div className="animate-fade-up card space-y-4 relative z-10">
          <div className="flex items-center justify-between">
            <p className="section-title mb-0">{lang === 'en' ? 'Filters' : '絞り込み'}</p>
            <div className="flex items-center gap-2">
              {hasExtraFilters && (
                <button onClick={clearExtraFilters} className="btn-ghost btn-sm text-ringo-500 hover:text-ringo-600">
                  ✕ {lang === 'en' ? 'Clear' : 'リセット'}
                </button>
              )}
              {/* Archived toggle */}
              <button
                onClick={() => { if (!showArchived) setStatusFilter('ALL'); setShowArchived((v) => !v); }}
                title={lang === 'en' ? 'Show archived applications' : 'アーカイブ済みを表示'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-150
                  ${showArchived ? 'bg-ringo-500 text-white shadow-sm' : 'bg-white/60 text-warmgray-500 hover:bg-white/90 border border-white/80'}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5C21.75 4.254 21.246 3.75 20.625 3.75H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                </svg>
                {lang === 'en' ? 'Archived' : 'アーカイブ'}
              </button>
            </div>
          </div>

          {/* Row 1: phase + status pills */}
          <div className="space-y-2">
            {/* 申請区分（稟議・精算） */}
            <div className="flex gap-1.5 flex-wrap items-center">
              <span className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 w-12 sm:w-16 shrink-0">
                {lang === 'en' ? 'Phase' : 'フェーズ'}
              </span>
              {(['ALL', 'RINGI', 'SETTLEMENT'] as const).map((p) => {
                const label = p === 'ALL' ? (lang === 'en' ? 'All' : 'すべて') : p === 'RINGI' ? '稟議' : '精算';
                const isActive = phaseFilter === p;
                const cls = isActive
                  ? p === 'RINGI' ? 'bg-ringo-500 text-white shadow-sm'
                  : p === 'SETTLEMENT' ? 'bg-teal-500 text-white shadow-sm'
                  : 'bg-warmgray-800 text-white shadow-sm'
                  : 'bg-white/60 text-warmgray-500 hover:bg-white/90 border border-white/80 backdrop-blur-sm';
                return (
                  <button key={p} onClick={() => setPhaseFilter(p)}
                    className={`px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-[11px] sm:text-xs font-semibold transition-all duration-150 ${cls}`}>
                    {label}
                  </button>
                );
              })}
            </div>
            {/* ステータス */}
            <div className="flex gap-1 sm:gap-1.5 flex-wrap items-center">
              <span className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 w-12 sm:w-16 shrink-0">
                {lang === 'en' ? 'Status' : 'ステータス'}
              </span>
              {ALL_STATUS_KEYS.map((s) => {
                const isActive = statusFilter === s;
                const label = s === 'ALL' ? (lang === 'en' ? 'All' : 'すべて') : (STATUS_LABEL[s] ?? s);
                return (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={`px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-[11px] sm:text-xs font-semibold transition-all duration-150
                      ${isActive ? 'bg-warmgray-800 text-white shadow-sm' : 'bg-white/60 text-warmgray-500 hover:bg-white/90 border border-white/80 backdrop-blur-sm'}`}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 2: 申請区分 + キーワード + 未完了・完了 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* 申請区分 */}
            <div>
              <label className="label">{lang === 'en' ? 'Application Type' : '申請区分'}</label>
              <CustomSelect options={templateOptions} value={templateCode} onChange={setTemplateCode} />
            </div>
            {/* キーワード */}
            <div>
              <label className="label">{lang === 'en' ? 'Keyword' : 'キーワード'}</label>
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-warmgray-400 pointer-events-none"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M16.65 16.65A7.5 7.5 0 104.5 4.5a7.5 7.5 0 0012.15 12.15z" />
                </svg>
                <input className="input pl-8 pr-8"
                  placeholder={lang === 'en' ? 'Form name, number…' : '申請名・申請番号で検索'}
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setKeyword(keywordInput.trim()); }}
                />
                {keywordInput && (
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 text-warmgray-400 hover:text-warmgray-600"
                    onClick={() => { setKeywordInput(''); setKeyword(''); }}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              {keywordInput.trim() !== keyword && keywordInput.trim() && (
                <button className="text-[11px] text-ringo-500 hover:text-ringo-600 mt-1 px-0.5"
                  onClick={() => setKeyword(keywordInput.trim())}>
                  {lang === 'en' ? 'Press Enter to search →' : 'Enter で検索 →'}
                </button>
              )}
            </div>
            {/* 未完了・完了 */}
            <div>
              <label className="label">{lang === 'en' ? 'Progress' : '未完了（進行中）・完了'}</label>
              <CustomSelect options={completionOptions} value={completion} onChange={setCompletion} />
            </div>
          </div>
        </div>

        {/* List */}
        {showLoader ? (
          <div className="card !p-0 overflow-hidden">
            <ul className="divide-y divide-white/30">
              {[...Array(9)].map((_, i) => {
                const wTitle = i % 3 === 0 ? 'w-40' : i % 3 === 1 ? 'w-32' : 'w-48';
                return (
                  <li key={i} className="flex items-center gap-4 px-5 py-4">
                    <Sk.Dot />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Sk.Line w={wTitle} h="h-3.5" />
                        <Sk.Badge w="w-14" />
                      </div>
                      <Sk.Line w="w-28" h="h-2.5" />
                    </div>
                    <div className="hidden md:flex items-center gap-3 shrink-0">
                      <Sk.Line w="w-24" h="h-2.5" />
                    </div>
                    <Sk.Box w="w-4" h="h-4" className="rounded" />
                  </li>
                );
              })}
            </ul>
          </div>
        ) : isLoading ? null /* loader-delay window — blank, never flash "no data" while fetching */ : sorted.length === 0 ? (
          <div className="card flex flex-col items-center justify-center py-20 gap-4 text-warmgray-400 animate-fade-up">
            <span className="text-5xl">📭</span>
            <p className="text-sm font-medium">{t('history_no_items')}</p>
            {statusFilter !== 'ALL' && (
              <button onClick={() => setStatusFilter('ALL')} className="text-xs text-ringo-500 hover:text-ringo-600 font-semibold">
                {t('history_clear')}
              </button>
            )}
          </div>
        ) : (
          <div className={`card !p-0 overflow-hidden transition-opacity duration-200 ${isFetching && !isFetchingNextPage ? 'opacity-60 pointer-events-none' : 'opacity-100'}`}>
            {/*
              key={statusFilter} forces React to remount the list when the
              filter pill changes. That triggers the fade-up animation on
              every <li> below, giving a smooth filter transition instead
              of a choppy in-place swap.
            */}
            <ul key={statusFilter} className="divide-y divide-white/30">
              {sorted.map((app, idx) => {
                const isSettlementReturned = !!app.settlement_returned;
                const cls = STATUS_CLS[app.status] ?? 'badge-draft';
                const label = STATUS_LABEL[app.status] ?? app.status;
                const isDraft = app.status === 'DRAFT';
                const isReturned = app.status === 'RETURNED';
                const isSettleable = app.status === 'APPROVED' && app.has_settlement;
                const hasDiff = app.row_preview?.numbers.some((n) => n.is_different) ?? false;

                // Phase badge for 立替精算申請 (two-stage)
                const isTakekai = app.has_settlement;
                const phaseBadge: { text: string; cls: string } | null = isTakekai
                  ? app.status === 'PENDING_APPROVAL'
                    ? { text: t('phase_ringi'),          cls: 'bg-ringo-50 text-ringo-600 border border-ringo-200/60' }
                    : app.status === 'APPROVED'
                    ? { text: t('phase_waiting_settle'), cls: 'bg-amber-50 text-amber-600 border border-amber-200/60' }
                    : app.status === 'PENDING_SETTLEMENT'
                    ? { text: t('phase_settlement'),     cls: 'bg-teal-50 text-teal-600 border border-teal-200/60' }
                    : null
                  : null;

                return (
                  <li
                    key={app.id}
                    className={`list-virt flex items-center gap-4 px-5 py-4 hover:bg-white/40 transition-colors duration-100 animate-fade-up cursor-pointer${hasDiff ? ' border-l-[3px] border-amber-500' : ''}`}
                    style={{ animationDelay: `${Math.min(idx, 12) * 30}ms` }}
                    onClick={() => navigate(`/applications/${app.id}`)}
                  >
                    {/* Status dot */}
                    <div className={`w-2 h-2 rounded-full shrink-0 ${
                      isDraft ? 'bg-warmgray-400' :
                      app.status === 'PENDING_APPROVAL' ? 'bg-amber-400' :
                      app.status === 'PENDING_SETTLEMENT' ? 'bg-teal-400' :
                      app.status === 'APPROVED' || app.status === 'COMPLETED' ? 'bg-emerald-400' :
                      app.status === 'REJECTED' ? 'bg-red-400' :
                      app.status === 'RETURNED' ? 'bg-amber-500' :
                      'bg-warmgray-300'
                    }`} />

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-warmgray-800 truncate">
                          {templateLabel(app.template_code, lang, app.template_name, app.template_title_en)}
                        </p>
                        <PatternBadge patternId={app.pattern_id} />
                        {isSettlementReturned
                          ? <span className="badge-returned">↩ {t('unsettled_returned_badge')}</span>
                          : <span className={cls}>{label}</span>}
                        {phaseBadge && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${phaseBadge.cls}`}>
                            {phaseBadge.text}
                          </span>
                        )}
                        {(isDraft || isReturned) && (
                          <span className="text-[10px] text-warmgray-400 font-medium">{t('history_editable')}</span>
                        )}
                        {app.archived_at && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-warmgray-100 text-warmgray-500 ring-1 ring-warmgray-200/70">
                            {lang === 'en' ? 'Archived' : 'アーカイブ'}
                          </span>
                        )}
                      </div>
                      {app.row_preview?.text && (
                        <p className="text-[11px] text-warmgray-600 mt-0.5 truncate font-medium">
                          {lang === 'en' ? app.row_preview.text.label_en : app.row_preview.text.label}
                          {': '}
                          {app.row_preview.text.value}
                        </p>
                      )}
                      {(app.status === 'PENDING_APPROVAL' || app.status === 'PENDING_SETTLEMENT') && app.current_step != null && app.total_steps ? (
                        <div className="flex items-center gap-1.5 mt-1">
                          {Array.from({ length: app.total_steps }).map((_, idx) => {
                            const n = idx + 1;
                            const cur = app.current_step!;
                            return <span key={idx} className={`w-2 h-2 rounded-full ${n < cur ? 'bg-emerald-400' : n === cur ? 'bg-ringo-500 ring-2 ring-ringo-200' : 'bg-surface-200'}`} />;
                          })}
                          <span className="text-[10px] text-warmgray-400 ml-1">{app.current_step}/{app.total_steps}</span>
                        </div>
                      ) : null}
                      <p className="text-[11px] text-warmgray-400 mt-0.5">
                        {app.application_number ? (
                          <span className="font-mono mr-2">{app.application_number}</span>
                        ) : null}
                        {new Date(app.created_at).toLocaleDateString(dateLocale, {
                          year: 'numeric', month: 'long', day: 'numeric',
                        })}
                      </p>
                    </div>

                    {/* Row preview numbers */}
                    {app.row_preview?.numbers && app.row_preview.numbers.length > 0 && (
                      <div className="hidden sm:flex flex-col items-end gap-0.5 shrink-0">
                        {app.row_preview.numbers.map((n, ni) => (
                          <div key={ni} className="flex items-baseline gap-1">
                            {n.compare_value !== undefined && n.compare_value !== null && (
                              <span className={`text-[10px] tabular-nums ${n.is_different ? 'text-amber-500' : 'text-warmgray-400'}`}>
                                {n.compare_value.toLocaleString()} {'→'}
                              </span>
                            )}
                            <span className={`text-xs font-bold tabular-nums ${n.is_different ? 'text-amber-600' : 'text-warmgray-700'}`}>
                              {n.value !== null ? n.value.toLocaleString() : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0 justify-end">
                      {isDraft && (
                        <>
                          <button
                            className="btn-primary text-xs px-3 py-1.5 rounded-lg"
                            disabled={submitDraft.isPending}
                            onClick={(e) => { e.stopPropagation(); setConfirmSubmit(app); }}
                          >
                            {t('btn_submit')}
                          </button>
                          <Link
                            to={`/applications/${app.id}`}
                            className="btn-outline text-xs px-3 py-1.5 rounded-lg"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {t('history_edit')}
                          </Link>
                          <button
                            className="text-[11px] text-warmgray-400 hover:text-red-500 transition-colors font-medium"
                            onClick={(e) => { e.stopPropagation(); setConfirmDelete(app); }}
                          >
                            {t('history_delete')}
                          </button>
                        </>
                      )}
                      {isSettleable && (
                        <button
                          className="btn-primary text-xs px-3 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 border-teal-500 hover:border-teal-600"
                          onClick={(e) => { e.stopPropagation(); navigate(`/applications/${app.id}/settlement`); }}
                        >
                          💴 {t('btn_settle')}
                        </button>
                      )}
                      {isSettlementReturned && (
                        <button
                          className="btn-primary text-xs px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 border-amber-500 hover:border-amber-600 whitespace-nowrap"
                          onClick={(e) => { e.stopPropagation(); navigate(`/applications/${app.id}`); }}
                        >
                          ↩ {t('btn_correct_resend')}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Sentinel — h-px keeps it invisible; IntersectionObserver fires 200px early */}
            <div ref={sentinelRef} className="h-px" />

            {isFetchingNextPage ? (
              <div className="px-5 py-3 flex items-center justify-center border-t border-white/20">
                <RingoLoader.Inline />
              </div>
            ) : hasNextPage ? (
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
            ) : sorted.length >= PAGE ? (
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
