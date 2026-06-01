import { useState, useMemo, useCallback } from 'react';
import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom'; // used inside DetailPanel
import { useScrollEnd } from '../hooks/useScrollEnd';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import Layout from '../components/common/Layout';
import apiClient from '../services/apiClient';
import { useLang } from '../context/LanguageContext';
import CalendarPicker from '../components/forms/CalendarPicker';
import CustomSelect from '../components/forms/CustomSelect';
import RepeatGroupDisplay from '../components/forms/RepeatGroupDisplay';
import CollapsibleComment from '../components/common/CollapsibleComment';
import RingoLoader from '../components/common/RingoLoader';
import { Sk } from '../components/common/Skeleton';
import UserAvatar from '../components/common/UserAvatar';

// ── File helpers ──────────────────────────────────────────────────────────────
function isFileValue(v: unknown): boolean {
  if (typeof v !== 'string' || !v) return false;
  return v.split(',').some((s) => s.trim().startsWith('/api/files/'));
}
function renderFileLinks(val: unknown, lang: string) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-0.5">
      {String(val).split(',').filter(Boolean).map((url, i) => (
        <a key={i} href={url.trim()} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-ringo-600 hover:text-ringo-700 bg-ringo-50/60 border border-ringo-200/60 px-2 py-0.5 rounded-lg font-medium transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
          {lang === 'en' ? 'File' : 'ファイル'} {i + 1}
        </a>
      ))}
    </div>
  );
}

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
  app_status: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Application Detail Types ───────────────────────────────────────────────────

interface AppStep {
  step_order: number;
  stage: string;
  label: string;
  status: string;
  approver_name: string | null;
  comment: string | null;
  acted_at: string | null;
}

interface AppDetail {
  id: string;
  application_number: string | null;
  template_name: string;
  applicant_name: string;
  applicant_avatar?: string | null;
  status: string;
  form_data: Record<string, any>;
  settlement_data: Record<string, any> | null;
  schema_definition: { fields: any[] };
  settlement_schema: { fields: any[] } | null;
  steps: AppStep[];
  created_at: string;
  submitted_at?: string | null;
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({ applicationId, onClose, lang }: { applicationId: string; onClose: () => void; lang: string }) {
  const dateLocale = lang === 'en' ? 'en-US' : 'ja-JP';

  const { data: app, isLoading, error } = useQuery<AppDetail>({
    queryKey: ['appDetailHistory', applicationId],
    queryFn: async () => (await apiClient.get(`/applications/${applicationId}`)).data,
    staleTime: 60_000,
  });

  const showLoader = useDelayedLoading(isLoading);

  const STEP_STATUS: Record<string, { label: string; cls: string }> = {
    APPROVED: { label: lang === 'en' ? 'Approved' : '承認',     cls: 'text-emerald-600' },
    REJECTED: { label: lang === 'en' ? 'Rejected' : '却下',     cls: 'text-red-500' },
    RETURNED: { label: lang === 'en' ? 'Returned' : '差し戻し', cls: 'text-amber-600' },
    PENDING:  { label: lang === 'en' ? 'Pending'  : '承認待ち', cls: 'text-ringo-500' },
    WAITING:  { label: lang === 'en' ? 'Waiting'  : '待機中',   cls: 'text-warmgray-400' },
    SKIPPED:  { label: lang === 'en' ? 'Skipped'  : 'スキップ', cls: 'text-warmgray-300' },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-warmgray-900/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative glass rounded-none md:rounded-3xl shadow-2xl w-full max-w-3xl max-h-[100dvh] md:max-h-[92vh] flex flex-col animate-scale-in overflow-hidden">

        {/* Header */}
        <div className="px-4 md:px-7 pt-5 md:pt-6 pb-4 md:pb-5 border-b border-white/30 shrink-0 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {app && <UserAvatar name={app.applicant_name ?? '?'} avatarUrl={app.applicant_avatar} size={9} />}
            <div className="min-w-0">
              {app ? (
                <>
                  <h3 className="text-base md:text-lg font-bold text-warmgray-800 leading-tight truncate">{app.template_name}</h3>
                  <p className="text-xs text-warmgray-500 mt-0.5 truncate">{lang === 'en' ? 'Applicant' : '申請者'}: {app.applicant_name}</p>
                  <p className="text-[11px] text-warmgray-400 mt-0.5 font-mono">{app.application_number ?? '—'}</p>
                </>
              ) : (
                <div className="h-5 w-48 bg-warmgray-200/60 rounded animate-pulse" />
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {app && (
              <Link
                to={`/applications/${applicationId}`}
                className="hidden sm:inline-flex btn-outline btn-sm text-xs"
                onClick={onClose}
              >
                {lang === 'en' ? 'Full page →' : '詳細ページ →'}
              </Link>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-surface-100/80 hover:bg-surface-200/80 flex items-center justify-center text-warmgray-500 hover:text-warmgray-800 transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto [overflow-x:clip] [scrollbar-gutter:stable] px-4 md:px-7 py-4 md:py-5 space-y-6">
          {showLoader && (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => <div key={i} className="h-12 rounded-xl bg-white/40 animate-pulse" />)}
            </div>
          )}
          {error && (
            <div className="text-sm text-red-500 text-center py-8">
              {lang === 'en' ? 'Failed to load application' : '申請の読み込みに失敗しました'}
            </div>
          )}
          {app && (
            <>
              {/* Form fields */}
              <div>
                <p className="section-title mb-4">{lang === 'en' ? 'Application Content' : '申請内容'}</p>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                  {(app.schema_definition?.fields ?? []).map((f: any) => {
                    const val = app.form_data[f.name];
                    const isRepeat = f.type === 'repeat_group';
                    const isFile = f.type === 'file' || isFileValue(val);
                    const isLong = isRepeat || f.type === 'textarea' || (typeof val === 'string' && !isFile && val.length > 40);
                    return (
                      <div key={f.name} className={isLong ? 'col-span-full' : ''}>
                        <dt className="text-[11px] font-bold uppercase tracking-widest text-warmgray-400 mb-1">{f.label}</dt>
                        <dd className="text-sm font-medium text-warmgray-800 bg-white/60 border border-white/80 px-3.5 py-2.5 rounded-xl break-words min-h-[42px]">
                          {isRepeat ? (
                            <RepeatGroupDisplay field={f} value={val} compact />
                          ) : isFile && val ? (
                            renderFileLinks(val, lang)
                          ) : val != null && val !== '' ? (
                            String(val)
                          ) : (
                            <span className="text-warmgray-300">—</span>
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>

              {/* Settlement data if present */}
              {app.settlement_data && app.settlement_schema && (
                <div>
                  <p className="section-title mb-4">{lang === 'en' ? 'Settlement Content' : '精算内容'}</p>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                    {(app.settlement_schema.fields ?? []).map((f: any) => {
                      const val = app.settlement_data![f.name];
                      const isRepeat = f.type === 'repeat_group';
                      const isFile = f.type === 'file' || isFileValue(val);
                      const isLong = isRepeat || f.type === 'textarea' || (typeof val === 'string' && !isFile && val.length > 40);
                      return (
                        <div key={f.name} className={isLong ? 'col-span-full' : ''}>
                          <dt className="text-[11px] font-bold uppercase tracking-widest text-warmgray-400 mb-1">{f.label}</dt>
                          <dd className="text-sm font-medium text-warmgray-800 bg-white/60 border border-white/80 px-3.5 py-2.5 rounded-xl break-words min-h-[42px]">
                            {isRepeat ? (
                              <RepeatGroupDisplay field={f} value={val} compact />
                            ) : isFile && val ? (
                              renderFileLinks(val, lang)
                            ) : val != null && val !== '' ? (
                              String(val)
                            ) : (
                              <span className="text-warmgray-300">—</span>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              )}

              {/* Approval timeline */}
              <div>
                <p className="section-title mb-4">{lang === 'en' ? 'Approval Timeline' : '承認フロー'}</p>
                <div className="space-y-2">
                  {app.steps.map((step, i) => {
                    const st = STEP_STATUS[step.status] ?? { label: step.status, cls: 'text-warmgray-500' };
                    return (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-white/40 border border-white/60">
                        {/* Step number */}
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                          step.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                          step.status === 'REJECTED' ? 'bg-red-100 text-red-600' :
                          step.status === 'RETURNED' ? 'bg-amber-100 text-amber-700' :
                          step.status === 'PENDING'  ? 'bg-ringo-100 text-ringo-700 ring-2 ring-ringo-300' :
                          'bg-surface-100 text-warmgray-400'
                        }`}>
                          {step.status === 'APPROVED' ? '✓' : step.status === 'REJECTED' ? '✕' : step.status === 'RETURNED' ? '↩' : step.step_order}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-warmgray-700">{step.label}</span>
                            {step.stage === 'SETTLEMENT' && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700">{lang === 'en' ? 'Settlement' : '精算'}</span>
                            )}
                            <span className={`text-[11px] font-semibold ml-auto ${st.cls}`}>{st.label}</span>
                          </div>
                          {step.approver_name && (
                            <p className="text-[11px] text-warmgray-400 mt-0.5">{step.approver_name}</p>
                          )}
                          {step.acted_at && (
                            <p className="text-[11px] text-warmgray-400">
                              {new Date(step.acted_at).toLocaleDateString(dateLocale)} {new Date(step.acted_at).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                          {step.comment && (
                            <div className="mt-1 text-xs bg-white/60 rounded-lg px-2.5 py-1.5 border border-white/80 min-w-0 overflow-hidden">
                              <CollapsibleComment text={step.comment} className="text-warmgray-600 italic" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTION_STYLES: Record<string, { badge: string; label_ja: string; label_en: string; icon: string }> = {
  APPROVED: { badge: 'badge-approved', label_ja: '承認',     label_en: 'Approved', icon: '✓' },
  REJECTED: { badge: 'badge-rejected', label_ja: '却下',     label_en: 'Rejected', icon: '✕' },
  RETURNED: { badge: 'badge-returned', label_ja: '差し戻し', label_en: 'Returned', icon: '↩' },
};

const APP_STATUS_BADGE: Record<string, string> = {
  PENDING_APPROVAL:  'badge-pending',
  APPROVED:          'badge-approved',
  REJECTED:          'badge-rejected',
  RETURNED:          'badge-returned',
  PENDING_SETTLEMENT:'badge-teal',
  SETTLEMENT_APPROVED:'badge-approved',
  COMPLETED:         'badge-approved',
  DRAFT:             'badge-draft',
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
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ApprovalHistory() {
  const { t, lang } = useLang();
  const dateLocale = lang === 'en' ? 'en-US' : 'ja-JP';

  // Detail panel
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Filters
  const [stage, setStage]         = useState('ALL');
  const [action, setAction]       = useState('ALL');
  const [templateId, setTemplateId] = useState('ALL');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');
  const [applicant, setApplicant] = useState('');
  const [applicantInput, setApplicantInput] = useState('');

  // Build query params
  const params = new URLSearchParams();
  if (stage !== 'ALL')      params.set('stage', stage);
  if (action !== 'ALL')     params.set('status', action);
  if (templateId !== 'ALL') params.set('template_id', templateId);
  if (dateFrom)             params.set('date_from', dateFrom);
  if (dateTo)               params.set('date_to', dateTo);
  if (applicant)            params.set('applicant', applicant);

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
    queryKey: ['approvalHistory', stage, action, templateId, dateFrom, dateTo, applicant],
    queryFn: async ({ pageParam = null }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : '';
      return (await apiClient.get(
        `/approvals/history?${params}&limit=${PAGE}${cursor}`
      )).data;
    },
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
    retry: 1,
    // Keep old data visible while filter params change — no spinner flash between filters
    placeholderData: keepPreviousData,
  });

  const showLoader = useDelayedLoading(isLoading);

  const items = data?.pages.flatMap(p => p.items) ?? [];

  const sentinelRef = useScrollEnd(
    useCallback(() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }, [hasNextPage, isFetchingNextPage, fetchNextPage]),
    hasNextPage ?? false,
  );

  // Unique templates: accumulate from ALL loaded pages (not just latest)
  const templateOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of items) {
      if (!seen.has(item.template_id)) seen.set(item.template_id, item.template_name);
    }
    return [
      { value: 'ALL', label: lang === 'en' ? 'All templates' : '全テンプレート' },
      ...Array.from(seen.entries()).map(([v, l]) => ({ value: v, label: l })),
    ];
  }, [items, lang]);

  const stageOptions = [
    { value: 'ALL',        label: lang === 'en' ? 'All stages'    : '全ステージ' },
    { value: 'RINGI',      label: lang === 'en' ? 'Ringi'         : '稟議' },
    { value: 'SETTLEMENT', label: lang === 'en' ? 'Settlement'    : '精算' },
  ];

  const actionOptions = [
    { value: 'ALL',      label: lang === 'en' ? 'All actions' : '全アクション' },
    { value: 'APPROVED', label: lang === 'en' ? 'Approved'    : '承認' },
    { value: 'REJECTED', label: lang === 'en' ? 'Rejected'    : '却下' },
    { value: 'RETURNED', label: lang === 'en' ? 'Returned'    : '差し戻し' },
  ];

  function clearFilters() {
    setStage('ALL'); setAction('ALL'); setTemplateId('ALL');
    setDateFrom(''); setDateTo(''); setApplicant(''); setApplicantInput('');
  }

  const hasFilters = stage !== 'ALL' || action !== 'ALL' || templateId !== 'ALL' || dateFrom || dateTo || applicant;

  return (
    <Layout title={t('title_approval_history')}>
      {selectedId && (
        <DetailPanel
          applicationId={selectedId}
          onClose={() => setSelectedId(null)}
          lang={lang}
        />
      )}
      <div className="max-w-[1800px] mx-auto space-y-6">

        {/* Header */}
        <div className="animate-fade-up">
          <p className="section-title mb-0">{t('nav_approval_history')}</p>
          <h2 className="text-2xl font-bold text-warmgray-800 mt-1">{t('title_approval_history')}</h2>
        </div>

        {/* Filters — relative z-10 so calendar/select dropdowns escape the results card's stacking context */}
        <div className="card animate-fade-up space-y-4 relative z-10">
          <div className="flex items-center justify-between">
            <p className="section-title mb-0">{lang === 'en' ? 'Filters' : '絞り込み'}</p>
            {hasFilters && (
              <button onClick={clearFilters} className="btn-ghost btn-sm text-ringo-500 hover:text-ringo-600">
                ✕ {lang === 'en' ? 'Clear' : 'リセット'}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Stage */}
            <div>
              <label className="label">{lang === 'en' ? 'Stage' : 'ステージ'}</label>
              <CustomSelect options={stageOptions} value={stage} onChange={setStage} />
            </div>

            {/* Action */}
            <div>
              <label className="label">{lang === 'en' ? 'Action' : 'アクション'}</label>
              <CustomSelect options={actionOptions} value={action} onChange={setAction} />
            </div>

            {/* Template */}
            <div>
              <label className="label">{lang === 'en' ? 'Template' : 'テンプレート'}</label>
              <CustomSelect options={templateOptions} value={templateId} onChange={setTemplateId} />
            </div>

            {/* Date From */}
            <div>
              <label className="label">{lang === 'en' ? 'From' : '開始日'}</label>
              <CalendarPicker value={dateFrom} onChange={setDateFrom} />
            </div>

            {/* Date To */}
            <div>
              <label className="label">{lang === 'en' ? 'To' : '終了日'}</label>
              <CalendarPicker value={dateTo} onChange={setDateTo} />
            </div>

            {/* Applicant search */}
            <div>
              <label className="label">{lang === 'en' ? 'Applicant' : '申請者'}</label>
              <div className="relative">
                <input
                  className="input pr-8"
                  placeholder={lang === 'en' ? 'Search name...' : '氏名で検索'}
                  value={applicantInput}
                  onChange={(e) => setApplicantInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setApplicant(applicantInput); }}
                />
                {applicantInput && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-warmgray-400 hover:text-warmgray-600"
                    onClick={() => { setApplicantInput(''); setApplicant(''); }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              {applicantInput !== applicant && (
                <button
                  className="text-[11px] text-ringo-500 hover:text-ringo-600 mt-1 px-0.5"
                  onClick={() => setApplicant(applicantInput)}
                >
                  Enter で検索 →
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="card animate-fade-up">
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
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{lang === 'en' ? 'Application' : '申請'}</th>
                      <th>{lang === 'en' ? 'Applicant' : '申請者'}</th>
                      <th>{lang === 'en' ? 'Step' : 'ステップ'}</th>
                      <th>{lang === 'en' ? 'Stage' : 'ステージ'}</th>
                      <th>{lang === 'en' ? 'Action' : 'アクション'}</th>
                      <th>{lang === 'en' ? 'App Status' : '申請状態'}</th>
                      <th>{lang === 'en' ? 'Date' : '日時'}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {[...Array(9)].map((_, i) => (
                      <tr key={i}>
                        <td><div className="space-y-1.5"><Sk.Line w={i % 3 === 0 ? 'w-32' : i % 3 === 1 ? 'w-28' : 'w-40'} h="h-3.5" /><Sk.Line w="w-20" h="h-2.5" /></div></td>
                        <td><div className="space-y-1.5"><Sk.Line w={i % 2 === 0 ? 'w-24' : 'w-28'} h="h-3.5" /><Sk.Line w="w-16" h="h-2.5" /></div></td>
                        <td><Sk.Line w={i % 2 === 0 ? 'w-28' : 'w-24'} h="h-3" /></td>
                        <td><Sk.Badge w="w-16" /></td>
                        <td><Sk.Badge w={i % 2 === 0 ? 'w-16' : 'w-20'} /></td>
                        <td><Sk.Badge w="w-20" /></td>
                        <td><Sk.Line w="w-24" h="h-3" /></td>
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : items.length === 0 ? (
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
              <div className="md:hidden space-y-3">
                {items.map((item, i) => {
                  const act = ACTION_STYLES[item.action];
                  const appSt = APP_STATUS_LABEL[item.app_status];
                  return (
                    <div
                      key={item.step_id}
                      className="rounded-2xl border border-white/50 bg-white/40 backdrop-blur-sm px-4 py-3.5 space-y-2.5 cursor-pointer active:bg-white/60 transition-colors animate-fade-up"
                      style={{ animationDelay: `${i * 20}ms` }}
                      onClick={() => setSelectedId(item.application_id)}
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

                      {/* Row 2: applicant */}
                      <div className="flex items-center gap-2">
                        <UserAvatar name={item.applicant_name ?? '?'} avatarUrl={item.applicant_avatar} size={6} />
                        <span className="text-xs text-warmgray-600 truncate">{item.applicant_name ?? '—'}</span>
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
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>{lang === 'en' ? 'Application' : '申請'}</th>
                      <th>{lang === 'en' ? 'Applicant' : '申請者'}</th>
                      <th>{lang === 'en' ? 'Step' : 'ステップ'}</th>
                      <th>{lang === 'en' ? 'Stage' : 'ステージ'}</th>
                      <th>{lang === 'en' ? 'Action' : 'アクション'}</th>
                      <th>{lang === 'en' ? 'App Status' : '申請状態'}</th>
                      <th>{lang === 'en' ? 'Date' : '日時'}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => {
                      const act = ACTION_STYLES[item.action];
                      const appSt = APP_STATUS_LABEL[item.app_status];
                      return (
                        <tr
                          key={item.step_id}
                          className="animate-fade-up cursor-pointer"
                          style={{ animationDelay: `${i * 20}ms` }}
                          onClick={() => setSelectedId(item.application_id)}
                        >
                          <td>
                            <div className="font-semibold text-warmgray-800 text-sm">{item.template_name}</div>
                            <div className="font-mono text-xs text-warmgray-400">{item.application_number ?? '—'}</div>
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <UserAvatar name={item.applicant_name ?? '?'} avatarUrl={item.applicant_avatar} size={7} />
                              <span className="text-sm text-warmgray-700">{item.applicant_name ?? '—'}</span>
                            </div>
                          </td>
                          <td><span className="text-sm text-warmgray-600">{item.step_label}</span></td>
                          <td>
                            {item.stage === 'SETTLEMENT' ? (
                              <span className="badge-teal">{lang === 'en' ? 'Settlement' : '精算'}</span>
                            ) : (
                              <span className="badge-ringo">{lang === 'en' ? 'Ringi' : '稟議'}</span>
                            )}
                          </td>
                          <td>
                            <span className={act.badge}>
                              {act.icon} {lang === 'en' ? act.label_en : act.label_ja}
                            </span>
                            {item.comment && (
                              <div className="text-[11px] text-warmgray-400 mt-0.5 max-w-[180px] truncate" title={item.comment}>
                                "{item.comment}"
                              </div>
                            )}
                          </td>
                          <td>
                            <span className={APP_STATUS_BADGE[item.app_status] ?? 'badge-draft'}>
                              {lang === 'en' ? (appSt?.en ?? item.app_status) : (appSt?.ja ?? item.app_status)}
                            </span>
                          </td>
                          <td>
                            <span className="text-xs text-warmgray-500 tabular-nums whitespace-nowrap">
                              {new Date(item.acted_at).toLocaleDateString(dateLocale)}
                            </span>
                            <div className="text-[11px] text-warmgray-400 tabular-nums">
                              {new Date(item.acted_at).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <button
                              className="btn-ghost btn-sm text-ringo-500 hover:text-ringo-600 whitespace-nowrap"
                              onClick={() => setSelectedId(item.application_id)}
                            >
                              {lang === 'en' ? 'View →' : '詳細 →'}
                            </button>
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
