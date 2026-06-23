import { useState, useMemo, useCallback } from 'react';
import { useInfiniteQuery, useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useScrollEnd } from '../hooks/useScrollEnd';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import Layout from '../components/common/Layout';
import apiClient from '../services/apiClient';
import { useLang } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import CalendarPicker from '../components/forms/CalendarPicker';
import CustomSelect from '../components/forms/CustomSelect';
import RingoLoader from '../components/common/RingoLoader';
import { Sk } from '../components/common/Skeleton';
import UserAvatar from '../components/common/UserAvatar';

// ── Types ─────────────────────────────────────────────────────────────────────

interface HistoryItem {
  step_id: string;
  application_id: string;
  application_number: string | null;
  template_name: string;
  template_id: string;
  stage: string;
  step_label: string;
  action_type: string;
  action: 'APPROVED' | 'REJECTED' | 'RETURNED';
  comment: string | null;
  acted_at: string;
  applicant_name: string | null;
  applicant_avatar: string | null;
  approver_name: string | null;
  app_status: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTION_STYLES: Record<string, { badge: string; label_ja: string; label_en: string; icon: string }> = {
  APPROVED: { badge: 'badge-approved', label_ja: '承認',     label_en: 'Approved', icon: '✓' },
  REJECTED: { badge: 'badge-rejected', label_ja: '却下',     label_en: 'Rejected', icon: '✕' },
  RETURNED: { badge: 'badge-returned', label_ja: '差し戻し', label_en: 'Returned', icon: '↩' },
};
// Fallback for any action not in the map (SKIPPED/CANCELLED/etc.) — never crash.
const ACTION_STYLE_FALLBACK = { badge: 'badge-draft', label_ja: '—', label_en: '—', icon: '•' };

const APP_STATUS_BADGE: Record<string, string> = {
  PENDING_APPROVAL:  'badge-pending',
  APPROVED:          'badge-approved',
  REJECTED:          'badge-rejected',
  RETURNED:          'badge-returned',
  PENDING_SETTLEMENT:'badge-teal',
  SETTLEMENT_APPROVED:'badge-approved',
  COMPLETED:         'badge-approved',
  DRAFT:             'badge-draft',
  CANCELLED:         'badge-draft',
};

const APP_STATUS_LABEL: Record<string, { ja: string; en: string }> = {
  PENDING_APPROVAL:   { ja: '承認待ち',   en: 'Pending' },
  APPROVED:           { ja: '承認済み',   en: 'Approved' },
  REJECTED:           { ja: '却下',       en: 'Rejected' },
  RETURNED:           { ja: '差し戻し',   en: 'Returned' },
  PENDING_SETTLEMENT: { ja: '精算中',     en: 'In Settlement' },
  SETTLEMENT_APPROVED:{ ja: '精算承認済', en: 'Settlement OK' },
  COMPLETED:          { ja: '完了',       en: 'Completed' },
  DRAFT:              { ja: '下書き',     en: 'Draft' },
  CANCELLED:          { ja: 'キャンセル', en: 'Cancelled' },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ApprovalHistory() {
  const { t, lang } = useLang();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const dateLocale = lang === 'en' ? 'en-US' : 'ja-JP';

  // Company-wide toggle (admin only) — query not sent until toggled
  const [systemView, setSystemView] = useState(false);

  // Filters
  const [templateId, setTemplateId]       = useState('ALL');
  const [dateFrom, setDateFrom]           = useState('');
  const [dateTo, setDateTo]               = useState('');
  const [applicant, setApplicant]         = useState('');
  const [applicantInput, setApplicantInput] = useState('');
  const [keyword, setKeyword]             = useState('');
  const [keywordInput, setKeywordInput]   = useState('');
  const [completion, setCompletion]       = useState('ALL');
  const [actionType, setActionType]       = useState('ALL');
  // System-view only: filter by approver name
  const [approver, setApprover]           = useState('');
  const [approverInput, setApproverInput] = useState('');

  // All templates for dropdown — fetched once, independent of active filter
  const { data: allTemplates } = useQuery<Array<{ id: string; title_ja: string }>>({
    queryKey: ['templates'],
    queryFn:  async () => (await apiClient.get('/templates')).data,
    staleTime: 5 * 60_000,
  });

  // Stable query string — primitive in queryKey guarantees fresh fetch on every change
  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (templateId !== 'ALL')   p.set('template_id', templateId);
    if (dateFrom)               p.set('date_from', dateFrom);
    if (dateTo)                 p.set('date_to', dateTo);
    if (applicant)              p.set('applicant', applicant);
    if (keyword)                p.set('keyword', keyword);
    if (completion !== 'ALL')   p.set('completion', completion);
    if (actionType !== 'ALL')   p.set('action_type', actionType);
    if (systemView)             p.set('all', 'true');
    if (systemView && approver) p.set('approver', approver);
    return p.toString();
  }, [templateId, dateFrom, dateTo, applicant, keyword, completion, actionType, systemView, approver]);

  const PAGE = 25;
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
    error,
  } = useInfiniteQuery<{ items: HistoryItem[]; hasMore: boolean; offset: number; nextCursor?: string | null }>({
    queryKey: ['approvalHistory', queryString],
    queryFn: async ({ pageParam = null }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : '';
      return (await apiClient.get(
        `/approvals/history?${queryString}&limit=${PAGE}${cursor}`
      )).data;
    },
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  const showLoader = useDelayedLoading(isLoading);

  const items = data?.pages.flatMap(p => p.items) ?? [];

  const sentinelRef = useScrollEnd(
    useCallback(() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }, [hasNextPage, isFetchingNextPage, fetchNextPage]),
    hasNextPage ?? false,
  );

  const templateOptions = useMemo(() => {
    const all = { value: 'ALL', label: lang === 'en' ? 'All templates' : '全テンプレート' };
    if (!allTemplates?.length) return [all];
    return [all, ...allTemplates.map(t => ({ value: t.id, label: t.title_ja }))];
  }, [allTemplates, lang]);

  const completionOptions = [
    { value: 'ALL',        label: lang === 'en' ? 'All'         : '全て' },
    { value: 'INCOMPLETE', label: lang === 'en' ? 'In Progress' : '未完了（進行中）' },
    { value: 'COMPLETE',   label: lang === 'en' ? 'Completed'   : '完了' },
  ];

  function clearFilters() {
    setTemplateId('ALL'); setCompletion('ALL'); setActionType('ALL');
    setDateFrom(''); setDateTo('');
    setApplicant(''); setApplicantInput('');
    setKeyword(''); setKeywordInput('');
    setApprover(''); setApproverInput('');
  }

  const hasFilters = templateId !== 'ALL' || completion !== 'ALL' || dateFrom || dateTo || applicant || keyword || approver;

  return (
    <Layout title={t('title_approval_history')}>
      <div className="max-w-[1800px] mx-auto space-y-6">

        {/* Header */}
        <div className="animate-fade-up flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <p className="section-title mb-0">{t('nav_approval_history')}</p>
            <h2 className="text-xl sm:text-2xl font-bold text-warmgray-800 mt-1 flex flex-wrap items-center gap-2">
              {t('title_approval_history')}
              {systemView && (
                <span className="text-sm font-semibold text-ringo-500 bg-ringo-50 border border-ringo-200/60 px-2 py-0.5 rounded-lg">
                  {lang === 'en' ? 'Company-wide' : '全社'}
                </span>
              )}
            </h2>
          </div>
          {isAdmin && (
            <button
              onClick={() => { setSystemView((v) => !v); clearFilters(); }}
              className={`self-start sm:self-auto flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl border text-xs font-bold transition-all duration-200 shrink-0
                ${systemView
                  ? 'bg-white/70 text-warmgray-600 border-white/80 hover:border-ringo-200 hover:text-ringo-600'
                  : 'bg-ringo-500 text-white border-ringo-500 shadow-sm hover:bg-ringo-600'
                }`}
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
              </svg>
              <span>
                {systemView
                  ? (lang === 'en' ? 'My View' : 'マイビュー')
                  : (lang === 'en' ? 'Company View' : '全社ビュー')}
              </span>
            </button>
          )}
        </div>

        {/* Filters — relative z-10 so calendar/select dropdowns escape the results card's stacking context */}
        <div className="animate-fade-up card space-y-4 relative z-10" style={{ animationDelay: '60ms' }}>
          <div className="flex items-center justify-between">
            <p className="section-title mb-0">{lang === 'en' ? 'Filters' : '絞り込み'}</p>
            {hasFilters && (
              <button onClick={clearFilters} className="btn-ghost btn-sm text-ringo-500 hover:text-ringo-600">
                ✕ {lang === 'en' ? 'Clear' : 'リセット'}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* 申請区分 */}
            <div>
              <label className="label">{lang === 'en' ? 'Application Type' : '申請区分'}</label>
              <CustomSelect options={templateOptions} value={templateId} onChange={setTemplateId} />
            </div>

            {/* 期間（申請日）From */}
            <div>
              <label className="label">{lang === 'en' ? 'From (application date)' : '期間（申請日）開始'}</label>
              <CalendarPicker value={dateFrom} onChange={setDateFrom} />
            </div>

            {/* 期間（申請日）To */}
            <div>
              <label className="label">{lang === 'en' ? 'To (application date)' : '期間（申請日）終了'}</label>
              <CalendarPicker value={dateTo} onChange={setDateTo} />
            </div>

            {/* 申請者 */}
            <div>
              <label className="label">{lang === 'en' ? 'Applicant' : '申請者'}</label>
              <div className="relative">
                <input
                  className="input pr-8"
                  placeholder={lang === 'en' ? 'Search name…' : '氏名で検索'}
                  value={applicantInput}
                  onChange={(e) => setApplicantInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setApplicant(applicantInput.trim()); }}
                />
                {applicantInput && (
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 text-warmgray-400 hover:text-warmgray-600"
                    onClick={() => { setApplicantInput(''); setApplicant(''); }}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              {applicantInput.trim() !== applicant && applicantInput.trim() && (
                <button className="text-[11px] text-ringo-500 hover:text-ringo-600 mt-1 px-0.5"
                  onClick={() => setApplicant(applicantInput.trim())}>
                  {lang === 'en' ? 'Press Enter to search →' : 'Enter で検索 →'}
                </button>
              )}
            </div>

            {/* キーワード */}
            <div>
              <label className="label">{lang === 'en' ? 'Keyword' : 'キーワード'}</label>
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-warmgray-400 pointer-events-none"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M16.65 16.65A7.5 7.5 0 104.5 4.5a7.5 7.5 0 0012.15 12.15z" />
                </svg>
                <input
                  className="input pl-8 pr-8"
                  placeholder={lang === 'en' ? 'Search form name, number…' : '申請名・申請番号で検索'}
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

            {/* 未完了（進行中）・完了 */}
            <div>
              <label className="label">{lang === 'en' ? 'Status' : '未完了・完了'}</label>
              <CustomSelect options={completionOptions} value={completion} onChange={setCompletion} />
            </div>

            {/* 承認種別 (action_type filter) */}
            <div>
              <label className="label">{lang === 'en' ? 'Action type' : '承認種別'}</label>
              <CustomSelect
                options={[
                  { value: 'ALL',     label: lang === 'en' ? 'All'     : '全て' },
                  { value: 'APPROVE', label: lang === 'en' ? 'Approve' : '承認' },
                  { value: 'CONFIRM', label: lang === 'en' ? 'Confirm' : '回付（確認）' },
                ]}
                value={actionType}
                onChange={setActionType}
              />
            </div>

            {/* Approver search — system view only */}
            {systemView && (
              <div>
                <label className="label">{lang === 'en' ? 'Approver' : '承認者'}</label>
                <div className="relative">
                  <input
                    className="input pr-8"
                    placeholder={lang === 'en' ? 'Search approver…' : '承認者名で検索'}
                    value={approverInput}
                    onChange={(e) => setApproverInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setApprover(approverInput.trim()); }}
                  />
                  {approverInput && (
                    <button className="absolute right-2 top-1/2 -translate-y-1/2 text-warmgray-400 hover:text-warmgray-600"
                      onClick={() => { setApproverInput(''); setApprover(''); }}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                {approverInput.trim() !== approver && approverInput.trim() && (
                  <button className="text-[11px] text-ringo-500 hover:text-ringo-600 mt-1 px-0.5"
                    onClick={() => setApprover(approverInput.trim())}>
                    {lang === 'en' ? 'Press Enter to search →' : 'Enter で検索 →'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="animate-fade-up card" style={{ animationDelay: '120ms' }}>
          <div className="flex items-center justify-between mb-4">
            <p className="section-title mb-0">
              {lang === 'en'
                ? `${items.length} record${items.length !== 1 ? 's' : ''}${hasNextPage ? '+' : ''}`
                : `${items.length}件${hasNextPage ? '以上' : ''}`}
            </p>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-red-50/80 border border-red-200/60 text-sm text-red-700">
              <span className="font-semibold">エラー: </span>
              {(error as Error).message}
            </div>
          )}

          {showLoader ? (
            <>
              {/* Mobile skeleton */}
              <div className="md:hidden space-y-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="rounded-2xl border border-white/40 bg-white/30 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <Sk.Line w={i % 2 === 0 ? 'w-32' : 'w-40'} h="h-3.5" />
                      <Sk.Badge w="w-16" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Sk.Dot /> <Sk.Line w="w-24" h="h-3" />
                    </div>
                    <div className="flex gap-2">
                      <Sk.Badge w="w-14" /> <Sk.Badge w="w-20" />
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop skeleton */}
              <div className="hidden md:block overflow-x-auto [scrollbar-gutter:stable]">
                <table className={`table-base table-fixed ${systemView ? 'min-w-[960px] xl:min-w-[1120px]' : 'min-w-[880px] xl:min-w-[1040px]'}`}>
                  <thead>
                    <tr>
                      <th className="min-w-[180px]">{lang === 'en' ? 'Application' : '申請'}</th>
                      <th className="w-36">{lang === 'en' ? 'Applicant' : '申請者'}</th>
                      {systemView && <th className="w-28">{lang === 'en' ? 'Approver' : '承認者'}</th>}
                      <th className="w-20">{lang === 'en' ? 'Stage' : 'ステージ'}</th>
                      <th className="w-44">{lang === 'en' ? 'Action' : 'アクション'}</th>
                      <th className="hidden xl:table-cell w-44">{lang === 'en' ? 'Comment' : 'コメント'}</th>
                      <th className="w-36">{lang === 'en' ? 'App Status' : '申請状態'}</th>
                      <th className="w-20 sticky right-0 bg-[#FBF9F6] text-right">{lang === 'en' ? 'View' : '詳細'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...Array(9)].map((_, i) => (
                      <tr key={i}>
                        <td><div className="space-y-1.5"><Sk.Line w={i % 3 === 0 ? 'w-32' : i % 3 === 1 ? 'w-28' : 'w-40'} h="h-3.5" /><Sk.Line w="w-20" h="h-2.5" /></div></td>
                        <td><div className="space-y-1.5"><Sk.Line w={i % 2 === 0 ? 'w-24' : 'w-28'} h="h-3.5" /><Sk.Line w="w-16" h="h-2.5" /></div></td>
                        {systemView && <td><Sk.Line w={i % 2 === 0 ? 'w-20' : 'w-24'} h="h-3" /></td>}
                        <td><Sk.Badge w="w-14" /></td>
                        <td><div className="space-y-1.5"><Sk.Badge w={i % 2 === 0 ? 'w-16' : 'w-20'} /><Sk.Line w="w-20" h="h-2.5" /></div></td>
                        <td className="hidden xl:table-cell"><Sk.Line w={i % 2 === 0 ? 'w-28' : 'w-36'} h="h-3" /></td>
                        <td><Sk.Badge w="w-24" /></td>
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : isLoading ? null /* loader-delay window — blank, never flash "no data" while fetching */ : items.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-surface-100/60 flex items-center justify-center">
                <svg className="w-7 h-7 text-warmgray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-warmgray-500">
                {lang === 'en' ? 'No approval records found' : '承認履歴がありません'}
              </p>
              <p className="text-xs text-warmgray-400 mt-1">
                {lang === 'en' ? 'Records appear here after you act on approvals' : '承認・却下・差し戻しを行うと表示されます'}
              </p>
            </div>
          ) : (
            <div className={`transition-opacity duration-200 ${isFetching && !isFetchingNextPage ? 'opacity-60 pointer-events-none' : 'opacity-100'}`}>

              {/* ── Mobile card list ────────────────────────────────────────── */}
              <div className="md:hidden space-y-3 stagger">
                {items.map((item) => {
                  const act = ACTION_STYLES[item.action];
                  const appSt = APP_STATUS_LABEL[item.app_status];
                  return (
                    <div
                      key={item.step_id}
                      className="rounded-2xl border border-white/50 bg-white/40 backdrop-blur-sm px-4 py-3.5 space-y-2.5 cursor-pointer active:bg-white/60 transition-colors animate-fade-up"
                      onClick={() => navigate(`/applications/${item.application_id}`)}
                    >
                      {/* Row 1: template + date */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-warmgray-800 truncate">{item.template_name}</p>
                          <p className="text-[11px] font-mono text-warmgray-400 mt-0.5">{item.application_number ?? '—'}</p>
                        </div>
                        <span className="text-[11px] text-warmgray-400 tabular-nums whitespace-nowrap shrink-0 mt-0.5">
                          {new Date(item.acted_at).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })}
                        </span>
                      </div>

                      {/* Row 2: applicant + optional approver */}
                      <div className="flex items-center gap-2">
                        <UserAvatar name={item.applicant_name ?? '?'} avatarUrl={item.applicant_avatar} size={6} />
                        <span className="text-xs text-warmgray-600 truncate">{item.applicant_name ?? '—'}</span>
                        {systemView && item.approver_name && (
                          <span className="text-[10px] text-ringo-500 font-semibold truncate">← {item.approver_name}</span>
                        )}
                        <span className="text-[10px] text-warmgray-400 ml-auto shrink-0">{item.step_label}</span>
                      </div>

                      {/* Row 3: badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {item.stage === 'SETTLEMENT' ? (
                          <span className="badge-teal text-[10px]">{lang === 'en' ? 'Settlement' : '精算'}</span>
                        ) : (
                          <span className="badge-ringo text-[10px]">{lang === 'en' ? 'Ringi' : '稟議'}</span>
                        )}
                        <span className={`${act.badge} text-[10px]`}>
                          {act.icon} {lang === 'en' ? act.label_en : act.label_ja}
                        </span>
                        {item.action_type === 'CONFIRM' && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                            {lang === 'en' ? 'Confirm' : '確認'}
                          </span>
                        )}
                        <span className={`${APP_STATUS_BADGE[item.app_status] ?? 'badge-draft'} text-[10px] ml-auto`}>
                          {lang === 'en' ? (appSt?.en ?? item.app_status) : (appSt?.ja ?? item.app_status)}
                        </span>
                      </div>

                      {/* Comment if present */}
                      {item.comment && (
                        <p className="text-[11px] text-warmgray-500 italic truncate">"{item.comment}"</p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* ── Desktop table ───────────────────────────────────────────── */}
              <div className="hidden md:block overflow-x-auto [scrollbar-gutter:stable]">
                <table className={`table-base table-fixed ${systemView ? 'min-w-[960px] xl:min-w-[1120px]' : 'min-w-[880px] xl:min-w-[1040px]'}`}>
                  <thead>
                    <tr>
                      <th className="min-w-[180px]">{lang === 'en' ? 'Application' : '申請'}</th>
                      <th className="w-36">{lang === 'en' ? 'Applicant' : '申請者'}</th>
                      {systemView && <th className="w-28">{lang === 'en' ? 'Approver' : '承認者'}</th>}
                      <th className="w-20">{lang === 'en' ? 'Stage' : 'ステージ'}</th>
                      <th className="w-44">{lang === 'en' ? 'Action' : 'アクション'}</th>
                      <th className="hidden xl:table-cell w-44">{lang === 'en' ? 'Comment' : 'コメント'}</th>
                      <th className="w-36">{lang === 'en' ? 'App Status' : '申請状態'}</th>
                      <th className="w-20 sticky right-0 bg-[#FBF9F6] text-right">{lang === 'en' ? 'View' : '詳細'}</th>
                    </tr>
                  </thead>
                  <tbody className="stagger">
                    {items.map((item) => {
                      const act = ACTION_STYLES[item.action] ?? ACTION_STYLE_FALLBACK;
                      const appSt = APP_STATUS_LABEL[item.app_status];
                      return (
                        <tr
                          key={item.step_id}
                          className="cursor-pointer [&>td]:align-top animate-fade-in"
                          onClick={() => navigate(`/applications/${item.application_id}`)}
                        >
                          <td className="align-top">
                            <div className="font-semibold text-warmgray-800 text-sm leading-snug line-clamp-2">{item.template_name}</div>
                            <div className="font-mono text-xs text-warmgray-400 mt-0.5 truncate">{item.application_number ?? '—'}</div>
                          </td>
                          <td>
                            <div className="flex items-center gap-2 max-w-[160px]">
                              <UserAvatar name={item.applicant_name ?? '?'} avatarUrl={item.applicant_avatar} size={7} />
                              <div className="min-w-0">
                                <span className="block text-sm text-warmgray-700 truncate">{item.applicant_name ?? '—'}</span>
                                {!systemView && item.step_label && (
                                  <span className="block text-[11px] text-warmgray-400 truncate">{item.step_label}</span>
                                )}
                              </div>
                            </div>
                          </td>
                          {systemView && (
                            <td>
                              <span className="block text-sm text-warmgray-700 max-w-[140px] truncate">{item.approver_name ?? '—'}</span>
                              {item.step_label && (
                                <span className="block text-[11px] text-warmgray-400 max-w-[140px] truncate">{item.step_label}</span>
                              )}
                            </td>
                          )}
                          <td>
                            {item.stage === 'SETTLEMENT' ? (
                              <span className="badge-teal whitespace-nowrap">{lang === 'en' ? 'Settlement' : '精算'}</span>
                            ) : (
                              <span className="badge-ringo whitespace-nowrap">{lang === 'en' ? 'Ringi' : '稟議'}</span>
                            )}
                          </td>
                          <td className="align-top">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`${act.badge} whitespace-nowrap`}>
                                {act.icon} {lang === 'en' ? act.label_en : act.label_ja}
                              </span>
                              {item.action_type === 'CONFIRM' && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap">
                                  {lang === 'en' ? 'Confirm' : '確認'}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-warmgray-400 tabular-nums whitespace-nowrap mt-1">
                              {new Date(item.acted_at).toLocaleDateString(dateLocale)} {new Date(item.acted_at).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
                            </div>
                            {/* Comment shown inline on <xl; dedicated column on xl+ */}
                            {item.comment && (
                              <div className="xl:hidden text-[11px] text-warmgray-400 mt-0.5 break-words line-clamp-2" title={item.comment}>
                                "{item.comment}"
                              </div>
                            )}
                          </td>
                          {/* Dedicated comment column on xl+ */}
                          <td className="hidden xl:table-cell align-top">
                            {item.comment ? (
                              <span className="text-[11px] text-warmgray-500 italic line-clamp-3 break-words" title={item.comment}>
                                "{item.comment}"
                              </span>
                            ) : (
                              <span className="text-warmgray-200 text-[11px]">—</span>
                            )}
                          </td>
                          <td className="align-top">
                            <span className={`${APP_STATUS_BADGE[item.app_status] ?? 'badge-draft'} whitespace-nowrap`}>
                              {lang === 'en' ? (appSt?.en ?? item.app_status) : (appSt?.ja ?? item.app_status)}
                            </span>
                          </td>
                          <td
                            onClick={(e) => e.stopPropagation()}
                            className="sticky right-0 bg-[#FBF9F6] shadow-[-8px_0_8px_-6px_rgba(60,40,20,0.10)]"
                          >
                            <Link
                              to={`/applications/${item.application_id}`}
                              className="btn-ghost btn-sm text-ringo-500 hover:text-ringo-600 whitespace-nowrap inline-flex"
                            >
                              {lang === 'en' ? 'View →' : '詳細 →'}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Sentinel */}
              <div ref={sentinelRef} className="h-px" />
              {(isFetchingNextPage || (!hasNextPage && items.length >= PAGE)) && (
                <div className="px-5 py-3 flex items-center justify-center gap-2 text-warmgray-400 text-xs border-t border-white/20">
                  {isFetchingNextPage ? (
                    <RingoLoader.Inline />
                  ) : (
                    <span className="text-warmgray-300">{lang === 'en' ? 'All records loaded' : '全件表示済み'}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </Layout>
  );
}
