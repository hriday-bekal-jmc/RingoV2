import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import Layout from '../components/common/Layout';
import PatternBadge from '../components/common/PatternBadge';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { usePermissions } from '../hooks/usePermissions';
import { templateLabel } from '../config/templateLabels';
import apiClient from '../services/apiClient';
import RingoLoader from '../components/common/RingoLoader';
import { useScrollEnd } from '../hooks/useScrollEnd';
import { useDelayedLoading } from '../hooks/useDelayedLoading';

interface TemplateTile {
  id: string; code: string; title: string; title_ja: string;
  pattern_id: number; icon: string | null; gradient: string | null;
  description_ja: string | null; description_en: string | null;
}

interface DashboardSummary {
  status_counts: {
    DRAFT: number; PENDING_APPROVAL: number; RETURNED: number; APPROVED: number;
    PENDING_SETTLEMENT: number; SETTLEMENT_APPROVED: number; COMPLETED: number; REJECTED: number;
  };
  settlement_returned?: number;
  recent_apps: Array<{ id: string; template_code: string; template_name: string; template_title_en?: string | null; status: string; created_at: string }>;
  pending_approvals?: { items: PendingItem[]; total: number; proxy_total: number; confirm_count?: number };
}

interface PendingItem {
  id: string; application_id: string; application_number: string | null;
  template_name: string; template_title_en?: string | null; template_code: string;
  applicant_name: string; created_at: string; action_type?: string;
}

interface UnsettledApp {
  id: string; application_number: string | null; template_name: string;
  template_title_en?: string | null; template_code?: string;
  status: string; created_at: string; row_preview?: { text?: { value: string } | null; numbers?: Array<{ value: number | null }> } | null;
}

// ── Action tile — card-style with icon, gradient accent, count badge ──────────
const TILE_ACCENT: Record<string, { bg: string; icon: string }> = {
  // approve group
  '未処理':        { bg: 'from-amber-400 to-orange-400',   icon: '⏳' },
  'Pending':       { bg: 'from-amber-400 to-orange-400',   icon: '⏳' },
  '代理承認':      { bg: 'from-violet-400 to-purple-500',  icon: '↔' },
  'Proxy Approval':{ bg: 'from-violet-400 to-purple-500',  icon: '↔' },
  '承認履歴':      { bg: 'from-slate-400 to-slate-500',    icon: '📋' },
  'Approval History':{ bg: 'from-slate-400 to-slate-500',  icon: '📋' },
  '回付予定':      { bg: 'from-amber-300 to-yellow-400',   icon: '🔁' },
  'Confirm':       { bg: 'from-amber-300 to-yellow-400',   icon: '🔁' },
  // submit group
  '作成':          { bg: 'from-ringo-400 to-rose-500',     icon: '✏️' },
  'New':           { bg: 'from-ringo-400 to-rose-500',     icon: '✏️' },
  '下書き':        { bg: 'from-warmgray-400 to-warmgray-500', icon: '📄' },
  'Drafts':        { bg: 'from-warmgray-400 to-warmgray-500', icon: '📄' },
  '差し戻し':      { bg: 'from-rose-400 to-red-500',       icon: '↩️' },
  'Returned':      { bg: 'from-rose-400 to-red-500',       icon: '↩️' },
  '未精算':        { bg: 'from-teal-400 to-emerald-500',   icon: '💴' },
  'Unsettled':     { bg: 'from-teal-400 to-emerald-500',   icon: '💴' },
  '申請中':        { bg: 'from-sky-400 to-blue-500',       icon: '🔄' },
  'In Progress':   { bg: 'from-sky-400 to-blue-500',       icon: '🔄' },
  // search group
  '検索':          { bg: 'from-ringo-400 to-rose-500',     icon: '🔍' },
  'Search':        { bg: 'from-ringo-400 to-rose-500',     icon: '🔍' },
  '申請履歴':      { bg: 'from-slate-400 to-slate-500',    icon: '🗂️' },
  'Application History': { bg: 'from-slate-400 to-slate-500', icon: '🗂️' },
  // admin group
  '全体承認待ち':  { bg: 'from-amber-400 to-orange-400',   icon: '⏳' },
  'All Pending':   { bg: 'from-amber-400 to-orange-400',   icon: '⏳' },
  '精算承認中':    { bg: 'from-teal-400 to-emerald-500',   icon: '💴' },
  'In Settlement': { bg: 'from-teal-400 to-emerald-500',   icon: '💴' },
  '管理パネル':    { bg: 'from-indigo-400 to-violet-500',  icon: '⚙️' },
  'Admin Panel':   { bg: 'from-indigo-400 to-violet-500',  icon: '⚙️' },
  '精算管理':      { bg: 'from-teal-400 to-emerald-500',   icon: '💴' },
  'Accounting':    { bg: 'from-teal-400 to-emerald-500',   icon: '💴' },
  '全申請一覧':    { bg: 'from-slate-400 to-slate-500',    icon: '📁' },
  'All Applications':{ bg: 'from-slate-400 to-slate-500',  icon: '📁' },
};
const DEFAULT_ACCENT = { bg: 'from-warmgray-400 to-warmgray-500', icon: '📌' };

// Compact badge text. Alert badges cap at 99+ (a large actionable backlog only
// needs to read "many"). Muted totals grow unbounded over months, so show
// magnitude compactly: 1.2k, 12k, 1.5M — never overflows the pill.
function badgeText(count: number, tone: 'alert' | 'muted'): string {
  if (tone === 'alert') return count > 99 ? '99+' : String(count);
  if (count < 1000) return String(count);
  if (count < 1_000_000) {
    const k = count / 1000;
    return (k < 10 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)) + 'k';
  }
  const m = count / 1_000_000;
  return (m < 10 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)) + 'M';
}

function ActionTile({
  label, count, onClick, to, disabled, countTone = 'alert',
}: {
  label: string; count?: number; onClick?: () => void; to?: string; disabled?: boolean;
  /** 'alert' = red badge (actionable / needs attention). 'muted' = neutral
      total (informational, e.g. terminal statuses like Completed) — avoids
      the false urgency of a red badge on counts that only ever grow. */
  countTone?: 'alert' | 'muted';
}) {
  const { bg, icon } = TILE_ACCENT[label] ?? DEFAULT_ACCENT;
  const cls = `relative flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border text-center select-none
    transition-all duration-150 group
    ${disabled
      ? 'bg-warmgray-50/60 border-warmgray-100/60 cursor-default opacity-50'
      : 'bg-white/90 border-warmgray-100/80 shadow-sm hover:shadow-md hover:bg-white hover:border-ringo-200/60 cursor-pointer'
    }`;

  const badgeCls = countTone === 'muted'
    ? 'bg-warmgray-100 text-warmgray-500 ring-1 ring-warmgray-200/70'
    : 'bg-ringo-500 text-white ring-2 ring-white';

  const inner = (
    <>
      {count !== undefined && count > 0 && (
        <span className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center shadow-sm z-10 tabular-nums ${badgeCls}`}>
          {badgeText(count, countTone)}
        </span>
      )}
      <span className={`w-8 h-8 rounded-lg bg-gradient-to-br ${bg} flex items-center justify-center text-sm shadow-sm group-hover:shadow-md transition-all duration-150 shrink-0`}>
        {icon}
      </span>
      <span className="text-[10px] font-semibold text-warmgray-600 group-hover:text-ringo-600 transition-colors leading-tight w-full break-words">{label}</span>
    </>
  );

  if (to && !disabled) return <Link to={to} className={cls}>{inner}</Link>;
  return <button className={cls} onClick={onClick} disabled={disabled}>{inner}</button>;
}

// ── Section block ─────────────────────────────────────────────────────────────
function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="animate-fade-up">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base leading-none">{icon}</span>
        <h3 className="text-xs font-bold uppercase tracking-widest text-warmgray-400">{title}</h3>
        <div className="flex-1 h-px bg-warmgray-100/80" />
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 min-w-0">
        {children}
      </div>
    </div>
  );
}

// ── Pending approvals drawer ──────────────────────────────────────────────────
function PendingApprovalsDrawer({ total, onClose }: { total: number; onClose: () => void }) {
  const { lang } = useLang();
  const dateLocale = lang === 'en' ? 'en-US' : 'ja-JP';

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteQuery<{ items: PendingItem[]; nextCursor: string | null }>({
      queryKey: ['pendingApprovalsFull'],
      queryFn: async ({ pageParam }) => {
        const qs = pageParam ? `?limit=25&cursor=${encodeURIComponent(pageParam as string)}` : '?limit=25';
        return (await apiClient.get(`/dashboard/pending-approvals${qs}`)).data;
      },
      initialPageParam: undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      staleTime: 30_000,
    });

  const showLoader = useDelayedLoading(isLoading);
  const sentinelRef = useScrollEnd(() => fetchNextPage(), !!hasNextPage && !isFetchingNextPage);
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-10 w-full sm:max-w-xl bg-surface-50 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col" style={{ maxHeight: '85dvh' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-white/40 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base">🔔</span>
            <h2 className="text-sm font-bold text-warmgray-800">{lang === 'en' ? 'Pending Approvals' : '未処理の承認'}</h2>
            <span className="badge-pending text-xs">{total}{lang === 'en' ? ' items' : '件'}</span>
          </div>
          <button onClick={onClose} className="text-warmgray-400 hover:text-warmgray-700 transition-colors text-lg px-1">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {showLoader ? <RingoLoader.Block /> : isLoading ? null : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-warmgray-400">
              <span className="text-3xl mb-2">✅</span>
              <p className="text-sm">{lang === 'en' ? 'All caught up!' : '承認待ちはありません'}</p>
            </div>
          ) : (
            <ul className="divide-y divide-white/30">
              {items.map((item, i) => (
                <li key={item.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                  <Link
                    to={`/applications/${item.application_id}`}
                    onClick={onClose}
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-white/40 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-warmgray-800 truncate">
                        {templateLabel(item.template_code, lang, item.template_name, item.template_title_en)}
                      </p>
                      <p className="text-[11px] text-warmgray-400 mt-0.5">
                        {item.applicant_name}
                        {item.application_number && <span className="ml-1.5 font-mono text-warmgray-300">#{item.application_number}</span>}
                        {' · '}{new Date(item.created_at).toLocaleDateString(dateLocale)}
                      </p>
                    </div>
                    <svg className="w-3.5 h-3.5 text-warmgray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                  </Link>
                </li>
              ))}
              {isFetchingNextPage && <li className="flex justify-center py-4"><span className="text-xs text-warmgray-400">{lang === 'en' ? 'Loading…' : '読込中…'}</span></li>}
            </ul>
          )}
          <div ref={sentinelRef} className="h-1" />
        </div>
        <div className="px-5 py-3 border-t border-white/40 shrink-0 flex items-center justify-between">
          <span className="text-[10px] text-warmgray-400">{lang === 'en' ? `${items.length} of ${total}` : `${items.length} / ${total} 件`}</span>
          <Link to="/approvals" onClick={onClose} className="text-xs font-semibold text-ringo-500 hover:text-ringo-600 transition-colors">
            {lang === 'en' ? 'Open approvals →' : '承認ページを開く →'}
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Unsettled apps drawer (image 4) ──────────────────────────────────────────
function UnsettledDrawer({ onClose }: { onClose: () => void }) {
  const { lang } = useLang();
  const navigate = useNavigate();
  const dateLocale = lang === 'en' ? 'en-US' : 'ja-JP';

  const { data, isLoading } = useQuery<{ items: UnsettledApp[] }>({
    queryKey: ['unsettledApps'],
    // UNSETTLED = APPROVED (awaiting first settlement) + settlement-phase returns (edit & resend).
    queryFn: async () => (await apiClient.get('/applications?status=UNSETTLED&limit=50')).data,
    staleTime: 30_000,
  });

  const showLoader = useDelayedLoading(isLoading);
  const items = data?.items ?? [];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-10 w-full sm:max-w-xl bg-surface-50 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col" style={{ maxHeight: '85dvh' }} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-white/40 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base">💴</span>
            <h2 className="text-sm font-bold text-warmgray-800">{lang === 'en' ? 'Awaiting Settlement' : '精算待ち一覧'}</h2>
            {items.length > 0 && <span className="badge-mustard text-xs">{items.length}{lang === 'en' ? ' items' : '件'}</span>}
          </div>
          <button onClick={onClose} className="text-warmgray-400 hover:text-warmgray-700 transition-colors text-lg px-1">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {showLoader ? <RingoLoader.Block /> : isLoading ? null : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-warmgray-400">
              <span className="text-3xl mb-2">✅</span>
              <p className="text-sm">{lang === 'en' ? 'No unsettled applications' : '精算待ちはありません'}</p>
            </div>
          ) : (
            <ul className="divide-y divide-white/30">
              {items.map((app, i) => {
                const nums = app.row_preview?.numbers ?? [];
                const mainNum = nums[0]?.value;
                const subNum = nums[1]?.value;
                // Settlement-phase return → edit-in-place + resend (opens detail → SettlementReturnEditor).
                // APPROVED → first-time settlement entry (settlement page).
                const isReturned = app.status === 'RETURNED';
                return (
                  <li
                    key={app.id}
                    className="animate-fade-up px-5 py-4 cursor-pointer hover:bg-white/40 transition-colors"
                    style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
                    onClick={() => { onClose(); navigate(`/applications/${app.id}`); }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="text-sm font-bold text-warmgray-800 truncate">
                            {templateLabel(app.template_code, lang, app.template_name, app.template_title_en)}
                          </p>
                          {isReturned ? (
                            <span className="badge-returned">↩ {lang === 'en' ? 'Settlement returned' : '精算差し戻し'}</span>
                          ) : (
                            <>
                              <span className="badge-approved">{lang === 'en' ? 'Approved' : '承認済み'}</span>
                              <span className="badge-mustard">{lang === 'en' ? 'Awaiting settlement' : '精算待ち'}</span>
                            </>
                          )}
                        </div>
                        {app.row_preview?.text && (
                          <p className="text-[11px] text-warmgray-600 truncate font-medium">
                            {app.row_preview.text.value}
                          </p>
                        )}
                        <p className="text-[11px] text-warmgray-400 mt-0.5 font-mono">
                          {app.application_number ?? '—'} · {new Date(app.created_at).toLocaleDateString(dateLocale)}
                        </p>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5" onClick={(e) => e.stopPropagation()}>
                        {mainNum != null && <p className="text-sm font-bold text-warmgray-800 tabular-nums">{mainNum.toLocaleString()}</p>}
                        {subNum != null && <p className="text-[11px] text-warmgray-400 tabular-nums">{subNum.toLocaleString()}</p>}
                        {isReturned ? (
                          <button
                            onClick={() => { onClose(); navigate(`/applications/${app.id}`); }}
                            className="mt-1 px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold transition-colors whitespace-nowrap"
                          >
                            ↩ {lang === 'en' ? 'Correct & resend' : '訂正して再送信'}
                          </button>
                        ) : (
                          <button
                            onClick={() => { onClose(); navigate(`/applications/${app.id}/settlement`); }}
                            className="mt-1 px-3 py-1 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-[11px] font-bold transition-colors"
                          >
                            💴 {lang === 'en' ? 'Submit' : '精算入力'}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Shared recent apps list ───────────────────────────────────────────────────
interface RecentApp {
  id: string; template_code?: string; template_name: string; template_title_en?: string | null;
  status: string; created_at: string; application_number?: string | null;
  has_settlement?: boolean; pattern_id?: number;
  current_step?: number | null; total_steps?: number;
  row_preview?: { text?: { label: string; label_en?: string | null; value: string } | null; numbers?: Array<{ value: number | null; compare_value?: number | null; is_different?: boolean }> } | null;
}

function RecentAppsList({ apps, lang, dateLocale, t }: {
  apps: RecentApp[];
  lang: 'en' | 'ja'; dateLocale: string; t: (k: any) => string;
}) {
  const [phaseFilter, setPhaseFilter] = useState<'ALL' | 'RINGI' | 'SETTLEMENT'>('ALL');
  const isSettlementPhase = (status: string) =>
    status === 'PENDING_SETTLEMENT' || status === 'SETTLEMENT_APPROVED';
  const filtered = phaseFilter === 'ALL' ? apps
    : apps.filter(a => phaseFilter === 'SETTLEMENT' ? isSettlementPhase(a.status) : !isSettlementPhase(a.status));
  const STATUS_CLS: Record<string, string> = {
    DRAFT: 'badge-draft', PENDING_APPROVAL: 'badge-pending', APPROVED: 'badge-approved',
    REJECTED: 'badge-rejected', RETURNED: 'badge-returned',
    PENDING_SETTLEMENT: 'badge-mustard', SETTLEMENT_APPROVED: 'badge-teal', COMPLETED: 'badge-approved',
    CANCELLED: 'badge-draft',
  };
  const STATUS_LABEL_MAP = (s: string): string => ({
    DRAFT: t('status_draft'), PENDING_APPROVAL: t('status_pending'), APPROVED: t('status_approved'),
    REJECTED: t('status_rejected'), RETURNED: t('status_returned'),
    PENDING_SETTLEMENT: t('status_pending_settle'), SETTLEMENT_APPROVED: t('status_settle_approved'),
    COMPLETED: t('status_completed'), CANCELLED: t('status_cancelled'),
  }[s] ?? s);

  const STATUS_DOT: Record<string, string> = {
    DRAFT: 'bg-warmgray-400', PENDING_APPROVAL: 'bg-amber-400',
    PENDING_SETTLEMENT: 'bg-teal-400', APPROVED: 'bg-emerald-400',
    COMPLETED: 'bg-emerald-400', REJECTED: 'bg-red-400', RETURNED: 'bg-amber-500',
    CANCELLED: 'bg-warmgray-400',
  };

  const phaseBadge = (app: RecentApp): { text: string; cls: string } | null => {
    if (!app.has_settlement) return null;
    if (app.status === 'PENDING_APPROVAL')  return { text: t('phase_ringi'),          cls: 'bg-ringo-50 text-ringo-600 border border-ringo-200/60' };
    if (app.status === 'APPROVED')           return { text: t('phase_waiting_settle'), cls: 'bg-amber-50 text-amber-600 border border-amber-200/60' };
    if (app.status === 'PENDING_SETTLEMENT') return { text: t('phase_settlement'),     cls: 'bg-teal-50 text-teal-600 border border-teal-200/60' };
    return null;
  };

  return (
    <div className="card !p-0 overflow-hidden">
      {/* Phase toggle */}
      <div className="flex gap-1.5 px-4 pt-3 pb-2 border-b border-white/20">
        {(['ALL', 'RINGI', 'SETTLEMENT'] as const).map((p) => {
          const label = p === 'ALL'
            ? (lang === 'en' ? 'All' : 'すべて')
            : p === 'RINGI' ? '稟議' : '精算';
          const isActive = phaseFilter === p;
          const cls = isActive
            ? p === 'RINGI'      ? 'bg-ringo-500 text-white'
            : p === 'SETTLEMENT' ? 'bg-teal-500 text-white'
            : 'bg-warmgray-800 text-white'
            : 'bg-surface-100 text-warmgray-500 hover:bg-surface-200';
          return (
            <button key={p} onClick={() => setPhaseFilter(p)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all duration-150 ${cls}`}>
              {label}
            </button>
          );
        })}
      </div>
      <ul className="divide-y divide-white/30">
        {filtered.slice(0, 5).map((app, i) => {
          const phase = phaseBadge(app);
          const isPending = app.status === 'PENDING_APPROVAL' || app.status === 'PENDING_SETTLEMENT';
          return (
            <li key={app.id} className="animate-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
              <Link to={`/applications/${app.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-white/40 transition-colors">
                {/* Status dot — mirrors History.tsx */}
                <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[app.status] ?? 'bg-warmgray-300'}`} />

                <div className="flex-1 min-w-0">
                  {/* Row 1: name + badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-warmgray-800 truncate">
                      {templateLabel(app.template_code, lang, app.template_name, app.template_title_en)}
                    </p>
                    <PatternBadge patternId={app.pattern_id} />
                    <span className={STATUS_CLS[app.status] ?? 'badge-draft'}>{STATUS_LABEL_MAP(app.status)}</span>
                    {phase && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${phase.cls}`}>{phase.text}</span>}
                  </div>
                  {/* Row 2: show_in_row subject */}
                  {app.row_preview?.text && (
                    <p className="text-[11px] text-warmgray-600 mt-0.5 truncate font-medium">
                      {lang === 'en' ? (app.row_preview.text.label_en ?? app.row_preview.text.label) : app.row_preview.text.label}
                      {': '}{app.row_preview.text.value}
                    </p>
                  )}
                  {/* Row 3: step dots for pending, else app number + date */}
                  {isPending && app.current_step != null && app.total_steps ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      {(() => {
                        const cur = app.current_step!; const total = app.total_steps!;
                        const MAX_DOTS = 7;
                        if (total <= MAX_DOTS) {
                          return Array.from({ length: total }).map((_, idx) => {
                            const n = idx + 1;
                            return <span key={n} className={`w-2 h-2 rounded-full ${n < cur ? 'bg-emerald-400' : n === cur ? 'bg-ringo-500 ring-2 ring-ringo-200' : 'bg-surface-200'}`} />;
                          });
                        }
                        const dots: React.ReactNode[] = [];
                        for (let i = 1; i <= 3; i++) {
                          dots.push(<span key={i} className={`w-2 h-2 rounded-full ${i < cur ? 'bg-emerald-400' : i === cur ? 'bg-ringo-500 ring-2 ring-ringo-200' : 'bg-surface-200'}`} />);
                        }
                        dots.push(<span key="ell" className="text-[9px] text-warmgray-300 leading-none">···</span>);
                        dots.push(<span key={total} className={`w-2 h-2 rounded-full ${total < cur ? 'bg-emerald-400' : total === cur ? 'bg-ringo-500 ring-2 ring-ringo-200' : 'bg-surface-200'}`} />);
                        return dots;
                      })()}
                      <span className="text-[10px] text-warmgray-400 ml-1">{app.current_step}/{app.total_steps}</span>
                    </div>
                  ) : (
                    <p className="text-[11px] text-warmgray-400 mt-0.5">
                      {app.application_number && <span className="font-mono mr-2">{app.application_number}</span>}
                      {new Date(app.created_at).toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                  )}
                </div>

                {/* Amounts */}
                {app.row_preview?.numbers && app.row_preview.numbers.length > 0 && (
                  <div className="hidden sm:flex flex-col items-end gap-0.5 shrink-0">
                    {app.row_preview.numbers.map((n, ni) => (
                      <div key={ni} className="flex items-baseline gap-1">
                        {n.compare_value != null && (
                          <span className={`text-[10px] tabular-nums ${n.is_different ? 'text-amber-500' : 'text-warmgray-400'}`}>
                            {n.compare_value.toLocaleString()} →
                          </span>
                        )}
                        <span className={`text-xs font-bold tabular-nums ${n.is_different ? 'text-amber-600' : 'text-warmgray-700'}`}>
                          {n.value !== null ? n.value.toLocaleString() : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <svg className="w-3.5 h-3.5 text-warmgray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Stat card (original admin view component) ────────────────────────────────
function StatCard({ label, value, icon, color, to }: {
  label: string; value: number | string; icon: string; color: string; to?: string;
}) {
  const inner = (
    <div className={`card animate-fade-up relative overflow-hidden ${to ? 'cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200' : ''}`}>
      <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-40 rounded-2xl`} />
      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <span className="text-[11px] font-bold uppercase tracking-widest text-warmgray-500">{label}</span>
          <span className="text-xl">{icon}</span>
        </div>
        <p className="text-3xl font-bold text-warmgray-800">{value}</p>
      </div>
    </div>
  );
  if (to) return <Link to={to} className="block">{inner}</Link>;
  return inner;
}

// ── Search drawer ─────────────────────────────────────────────────────────────
function SearchDrawer({ onClose }: { onClose: () => void }) {
  const { lang } = useLang();
  const navigate = useNavigate();
  const dateLocale = lang === 'en' ? 'en-US' : 'ja-JP';
  const [input, setInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (input.trim().length < 2) { setDebouncedQ(''); return; }
    const timer = setTimeout(() => setDebouncedQ(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const { data, isFetching } = useQuery<{ items: Array<{ id: string; application_number: string | null; template_name: string; template_title_en?: string | null; template_code?: string; status: string; created_at: string; row_preview?: { text?: { value: string } | null } | null }> }>({
    queryKey: ['search', debouncedQ],
    queryFn: async () => (await apiClient.get(`/applications?q=${encodeURIComponent(debouncedQ)}&limit=30`)).data,
    enabled: debouncedQ.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const STATUS_CLS: Record<string, string> = {
    DRAFT: 'badge-draft', PENDING_APPROVAL: 'badge-pending',
    APPROVED: 'badge-approved', REJECTED: 'badge-rejected',
    RETURNED: 'badge-returned', PENDING_SETTLEMENT: 'badge-mustard',
    SETTLEMENT_APPROVED: 'badge-teal', COMPLETED: 'badge-approved',
    CANCELLED: 'badge-draft',
  };

  const STATUS_LABEL: Record<string, string> = lang === 'en'
    ? { DRAFT: 'Draft', PENDING_APPROVAL: 'Pending Approval', APPROVED: 'Approved',
        REJECTED: 'Rejected', RETURNED: 'Returned', PENDING_SETTLEMENT: 'Pending Settlement',
        SETTLEMENT_APPROVED: 'Settlement Approved', COMPLETED: 'Completed', CANCELLED: 'Cancelled' }
    : { DRAFT: '下書き', PENDING_APPROVAL: '承認待ち', APPROVED: '承認済み',
        REJECTED: '却下', RETURNED: '差し戻し', PENDING_SETTLEMENT: '未精算',
        SETTLEMENT_APPROVED: '精算承認済み', COMPLETED: '完了', CANCELLED: 'キャンセル' };

  // Filter chips — clicking with no search text navigates directly to filtered history
  const FILTER_CHIPS = lang === 'en'
    ? [
        { key: 'PENDING_APPROVAL', label: 'Pending',   cls: 'badge-pending'  },
        { key: 'DRAFT',            label: 'Draft',     cls: 'badge-draft'    },
        { key: 'RETURNED',         label: 'Returned',  cls: 'badge-returned' },
        { key: 'APPROVED',         label: 'Approved',  cls: 'badge-approved' },
        { key: 'PENDING_SETTLEMENT', label: 'Unsettled', cls: 'badge-mustard' },
        { key: 'COMPLETED',        label: 'Done',      cls: 'badge-approved' },
      ]
    : [
        { key: 'PENDING_APPROVAL', label: '承認待ち',  cls: 'badge-pending'  },
        { key: 'DRAFT',            label: '下書き',    cls: 'badge-draft'    },
        { key: 'RETURNED',         label: '差し戻し',  cls: 'badge-returned' },
        { key: 'APPROVED',         label: '承認済み',  cls: 'badge-approved' },
        { key: 'PENDING_SETTLEMENT', label: '未精算',  cls: 'badge-mustard'  },
        { key: 'COMPLETED',        label: '完了',      cls: 'badge-approved' },
      ];

  const allResults = data?.items ?? [];
  const results = statusFilter ? allResults.filter(a => a.status === statusFilter) : allResults;
  const showEmpty = debouncedQ.length >= 2 && !isFetching && results.length === 0;

  const handleFilterChip = (key: string) => {
    if (statusFilter === key) { setStatusFilter(null); return; }
    setStatusFilter(key);
    // If no search query, navigate directly to filtered history
    if (input.trim().length < 2) { onClose(); navigate(`/history?filter=${key}`); }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-2xl bg-surface-50 rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '76dvh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input row */}
        <div className="px-4 pt-4 pb-3 flex items-center gap-3">
          {isFetching
            ? <svg className="w-5 h-5 text-ringo-500 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            : <svg className="w-5 h-5 text-warmgray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z"/></svg>
          }
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={lang === 'en' ? 'Search by number, subject, form name…' : '番号・件名・フォーム名で検索…'}
            className="flex-1 bg-transparent outline-none text-sm text-warmgray-800 placeholder-warmgray-400 font-medium"
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
          />
          {input && (
            <button onClick={() => setInput('')} className="w-7 h-7 rounded-full flex items-center justify-center text-warmgray-400 hover:text-warmgray-700 hover:bg-warmgray-100 transition-all text-xs">✕</button>
          )}
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center text-warmgray-400 hover:text-warmgray-700 hover:bg-warmgray-100 transition-all text-xs ml-1">✕</button>
        </div>

        {/* Filter chips */}
        <div className="px-4 pb-3 flex flex-wrap gap-1.5 border-b border-white/40">
          {FILTER_CHIPS.map(({ key, label, cls }) => (
            <button
              key={key}
              onClick={() => handleFilterChip(key)}
              className={`${cls} transition-all duration-150 text-[11px] cursor-pointer select-none
                ${statusFilter === key ? 'ring-2 ring-offset-1 ring-current opacity-100 scale-105' : 'opacity-70 hover:opacity-100'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {input.length < 2 && !statusFilter ? (
            <div className="flex flex-col items-center justify-center py-12 text-warmgray-400 text-sm gap-2">
              <svg className="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z"/></svg>
              <p className="font-medium">{lang === 'en' ? 'Type to search or select a filter' : '検索するか絞り込みを選んでください'}</p>
            </div>
          ) : showEmpty ? (
            <div className="flex flex-col items-center justify-center py-12 text-warmgray-400 text-sm gap-2">
              <span className="text-3xl">📭</span>
              <p>{lang === 'en' ? 'No results found' : '該当する申請はありません'}</p>
            </div>
          ) : (
            <ul className="divide-y divide-white/30">
              {results.map((app, i) => (
                <li key={app.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i, 8) * 20}ms` }}>
                  <button
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-white/40 transition-colors text-left"
                    onClick={() => { onClose(); navigate(`/applications/${app.id}`); }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-warmgray-800 truncate">
                          {templateLabel(app.template_code, lang, app.template_name, app.template_title_en)}
                        </p>
                        <span className={STATUS_CLS[app.status] ?? 'badge-draft'}>{STATUS_LABEL[app.status] ?? app.status.replace(/_/g, ' ')}</span>
                      </div>
                      {app.row_preview?.text && (
                        <p className="text-[11px] text-warmgray-500 truncate mt-0.5">{app.row_preview.text.value}</p>
                      )}
                      <p className="text-[11px] text-warmgray-400 font-mono mt-0.5">
                        {app.application_number ?? '—'} · {new Date(app.created_at).toLocaleDateString(dateLocale)}
                      </p>
                    </div>
                    <svg className="w-3.5 h-3.5 text-warmgray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-2 border-t border-white/30 text-[10px] text-warmgray-400 text-center">
          {lang === 'en' ? 'Esc to close · filters navigate to History' : 'Escで閉じる · フィルターで申請履歴に移動'}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Admin company overview ─────────────────────────────────────────────────────
interface AdminOverview {
  status_counts: Record<string, number>;
  dept_breakdown: { dept_name: string; total: number; pending: number; in_settlement: number; completed: number }[];
  pending_by_approver: { approver_name: string; pending_count: number }[];
  recent_activity: any[];
  settlement_overview: { awaiting_approval: number; awaiting_transfer: number; completed: number };
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user, loading, isAdmin } = useAuth();
  const { t, lang } = useLang();
  const dateLocale = lang === 'en' ? 'en-US' : 'ja-JP';
  const perms = usePermissions(user?.role, user?.is_admin);
  const navigate = useNavigate();

  const [showAllPending, setShowAllPending]   = useState(false);
  const [showUnsettled, setShowUnsettled]     = useState(false);
  const [showSearch, setShowSearch]           = useState(false);
  const [adminView, setAdminView]             = useState(false);

  const { data: summary } = useQuery<DashboardSummary>({
    queryKey: ['dashboard', 'summary'],
    queryFn: async () => (await apiClient.get('/dashboard/summary')).data,
    enabled: !loading,
    staleTime: 60_000,
  });

  const { data: templates } = useQuery<TemplateTile[]>({
    queryKey: ['templates', 'active'],
    queryFn: async () => (await apiClient.get('/templates')).data,
    enabled: !loading,
    staleTime: 300_000,
  });

  const { data: overview } = useQuery<AdminOverview>({
    queryKey: ['dashboard', 'admin-overview'],
    queryFn: async () => (await apiClient.get('/dashboard/admin-overview')).data,
    enabled: !loading && isAdmin && adminView,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });

  const counts = summary?.status_counts;
  const pendingApprovalsTotal = summary?.pending_approvals?.total ?? 0;
  const scheduledReviewTotal  = summary?.pending_approvals?.proxy_total ?? 0;
  const confirmTotal          = summary?.pending_approvals?.confirm_count ?? 0;
  const draftCount            = counts?.DRAFT ?? 0;
  // Settlement-phase returns are surfaced in the unsettled area (edit & resend),
  // not the ringi 差し戻し bucket. Split the raw RETURNED count accordingly.
  const settlementReturned    = summary?.settlement_returned ?? 0;
  const returnedCount         = Math.max(0, (counts?.RETURNED ?? 0) - settlementReturned); // ringi-only
  const approvedCount         = (counts?.APPROVED ?? 0) + settlementReturned;  // awaiting settlement + returns to fix
  const pendingCount          = counts?.PENDING_APPROVAL ?? 0;
  const recentApps            = summary?.recent_apps ?? [];
  const firstName = user?.full_name?.split(' ')[0] ?? 'ゲスト';
  const hour      = new Date().getHours();
  const greeting  = hour < 12 ? t('greeting_morning') : hour < 18 ? t('greeting_day') : t('greeting_evening');

  // Recent 4 unique templates from recent applications
  const recentTemplateCodes = [...new Set(recentApps.map(a => a.template_code))].slice(0, 4);
  const recentTemplates = recentTemplateCodes
    .map(code => templates?.find(t => t.code === code))
    .filter(Boolean) as TemplateTile[];

  const isEmptyState = !!summary && recentApps.length === 0 && pendingCount === 0 && draftCount === 0 && returnedCount === 0 && approvedCount === 0;

  const companyTotal   = overview ? Object.values(overview.status_counts).reduce((s, n) => s + n, 0) : 0;
  const companyPending = overview?.status_counts.PENDING_APPROVAL ?? 0;
  const companySettle  = (overview?.status_counts.PENDING_SETTLEMENT ?? 0) + (overview?.status_counts.SETTLEMENT_APPROVED ?? 0);
  const companyDone    = overview?.status_counts.COMPLETED ?? 0;

  const DEFAULT_GRADIENTS: Record<string, string> = {
    BUSINESS_TRIP:    'from-amber-400  to-orange-500',
    RECREATION:       'from-pink-400   to-rose-500',
    ADDRESS_CHANGE:   'from-violet-400 to-purple-500',
    TRANSPORT_EXPENSE:'from-sky-400    to-blue-500',
    SALARY_BANK:      'from-emerald-400 to-teal-600',
  };

  return (
    <Layout title={t('title_dashboard')}>
      {loading ? <RingoLoader.Block /> : (
        <div className="max-w-[1800px] mx-auto space-y-5">

          {/* Greeting — hidden in empty state (shown inside empty state layout) */}
          {!isEmptyState && (
          <div className="flex items-start justify-between gap-4 animate-fade-up">
            <div>
              <p className="text-xs font-semibold text-warmgray-400 mb-0.5">
                {new Date().toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
              </p>
              <h2 className="text-xl font-bold text-warmgray-800">{greeting}、{firstName}さん</h2>
            </div>
            {isAdmin && (
              <button
                onClick={() => setAdminView(v => !v)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all duration-200 ${adminView ? 'bg-ringo-500 text-white border-ringo-600 shadow-md' : 'bg-white/60 text-warmgray-600 border-white/80 hover:bg-white/80'}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3h16.5M3.75 9h16.5M3.75 15h8.25M3.75 21h8.25" />
                </svg>
                {adminView ? (lang === 'en' ? 'My Dashboard' : 'マイ') : (lang === 'en' ? 'Company View' : '全社ビュー')}
              </button>
            )}
          </div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              ADMIN COMPANY VIEW
              Layout: notice → admin tiles → stat cards → by dept → recent activity → pending list
          ══════════════════════════════════════════════════════════════════ */}
          {isAdmin && adminView ? (
            <div className="space-y-6">

              {/* Admin notice */}
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-ringo-500/10 border border-ringo-200/60 text-ringo-700 text-xs font-semibold animate-fade-up">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" /></svg>
                {lang === 'en' ? 'Admin — Company-wide overview' : '管理者ビュー — 全社統計'}
                <button onClick={() => setAdminView(false)} className="ml-auto text-ringo-400 hover:text-ringo-600 transition-colors">✕</button>
              </div>

              {/* Admin-specific action tiles */}
              <div className="card !p-4 sm:!p-6 space-y-5 animate-fade-up">
                <div className="flex items-center justify-between -mb-1">
                  <span className="text-xs font-bold uppercase tracking-widest text-warmgray-400">{lang === 'en' ? 'Quick Actions' : 'クイックアクション'}</span>
                  <button
                    onClick={() => setShowSearch(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-ringo-50 border border-ringo-200/60 text-ringo-500 hover:bg-ringo-100 hover:text-ringo-600 transition-all duration-150 text-xs font-semibold"
                    title={lang === 'en' ? 'Search' : '検索'}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z"/></svg>
                    {lang === 'en' ? 'Search' : '検索'}
                  </button>
                </div>
                <Section icon="📊" title={lang === 'en' ? 'Monitor' : '監視'}>
                  <ActionTile label={lang === 'en' ? 'All Pending' : '全体承認待ち'} count={companyPending} to="/approvals?system=1" />
                  <ActionTile label={lang === 'en' ? 'In Settlement' : '精算承認中'} count={companySettle} to="/accounting" />
                </Section>
                <Section icon="⚙️" title={lang === 'en' ? 'Admin' : '管理'}>
                  <ActionTile label={lang === 'en' ? 'Admin Panel' : '管理パネル'} to="/admin" />
                  <ActionTile label={lang === 'en' ? 'Accounting' : '精算管理'} to="/accounting" />
                  <ActionTile label={lang === 'en' ? 'All Applications' : '全申請一覧'} to="/admin?tab=applications" />
                </Section>
              </div>

              {/* Stat cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger animate-fade-up">
                <StatCard label={lang === 'en' ? 'Total Apps' : '総申請数'} value={companyTotal} icon="📁" color="from-indigo-200/40 to-transparent" to="/admin" />
                <StatCard label={lang === 'en' ? 'Pending Approval' : '承認待ち'} value={companyPending} icon="⏳" color="from-amber-200/50 to-transparent" to="/approvals" />
                <StatCard label={lang === 'en' ? 'In Settlement' : '精算中'} value={companySettle} icon="💴" color="from-teal-200/40 to-transparent" to="/accounting" />
                <StatCard label={lang === 'en' ? 'Completed' : '完了'} value={companyDone} icon="✅" color="from-emerald-200/40 to-transparent" to="/admin" />
              </div>

              {/* Settlement sub-stats */}
              {overview?.settlement_overview && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 animate-fade-up">
                  {[
                    { label: lang === 'en' ? 'Awaiting settle approval' : '精算承認待ち', val: overview.settlement_overview.awaiting_approval, cls: 'badge-mustard' },
                    { label: lang === 'en' ? 'Awaiting transfer' : '振込待ち', val: overview.settlement_overview.awaiting_transfer, cls: 'badge-teal' },
                    { label: lang === 'en' ? 'Fully completed' : '全完了', val: overview.settlement_overview.completed, cls: 'badge-indigo' },
                  ].map(({ label, val, cls }) => (
                    <div key={label} className="card !p-4 flex items-center gap-3">
                      <span className={`${cls} text-base`}>{val}</span>
                      <span className="text-[11px] text-warmgray-500 font-medium leading-tight">{label}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* By Department */}
              {!!overview?.dept_breakdown?.length && (
                <div className="space-y-3 animate-fade-up">
                  <h3 className="section-title">{lang === 'en' ? 'By Department' : '部署別申請状況'}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {overview.dept_breakdown.map((d, i) => (
                      <div key={i} className="card !p-4 space-y-3" style={{ animationDelay: `${i * 40}ms` }}>
                        <p className="text-sm font-bold text-warmgray-800 truncate">{d.dept_name}</p>
                        <div className="flex items-end gap-3">
                          <div className="flex-1 text-center"><p className="text-xl font-bold text-amber-600">{d.pending}</p><p className="text-[9px] font-bold uppercase tracking-widest text-warmgray-400 mt-0.5">{lang === 'en' ? 'PENDING' : '承認待ち'}</p></div>
                          <div className="flex-1 text-center"><p className="text-xl font-bold text-teal-600">{d.in_settlement}</p><p className="text-[9px] font-bold uppercase tracking-widest text-warmgray-400 mt-0.5">{lang === 'en' ? 'SETTLE' : '精算中'}</p></div>
                          <div className="flex-1 text-center"><p className="text-xl font-bold text-indigo-600">{d.completed}</p><p className="text-[9px] font-bold uppercase tracking-widest text-warmgray-400 mt-0.5">{lang === 'en' ? 'DONE' : '完了'}</p></div>
                          <div className="flex-none bg-warmgray-100/80 border border-warmgray-200/60 rounded-xl px-3 py-1.5 text-center min-w-[52px]"><p className="text-xl font-bold text-warmgray-800">{d.total}</p><p className="text-[9px] font-bold uppercase tracking-widest text-warmgray-500 mt-0.5">TOTAL</p></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent activity (my own) */}
              {recentApps.length > 0 && (
                <div className="space-y-3 animate-fade-up">
                  <div className="flex items-center justify-between">
                    <h3 className="section-title">{lang === 'en' ? 'Recent applications' : '最近の申請'}</h3>
                    <Link to="/history" className="text-xs font-semibold text-ringo-500 hover:text-ringo-600 transition-colors">{lang === 'en' ? 'All →' : 'すべて見る →'}</Link>
                  </div>
                  <RecentAppsList apps={recentApps} lang={lang} dateLocale={dateLocale} t={t} />
                </div>
              )}

              {/* Pending approvals list (inline, not drawer) */}
              {(summary?.pending_approvals?.items?.length ?? 0) > 0 && (
                <div className="space-y-3 animate-fade-up">
                  <div className="flex items-center justify-between">
                    <h3 className="section-title">{lang === 'en' ? 'Pending approvals' : '承認待ち一覧'}</h3>
                    <Link to="/approvals" className="text-xs font-semibold text-ringo-500 hover:text-ringo-600 transition-colors">{lang === 'en' ? `${pendingApprovalsTotal} total →` : `全${pendingApprovalsTotal}件 →`}</Link>
                  </div>
                  <div className="card !p-0 overflow-hidden">
                    <ul className="divide-y divide-white/30">
                      {(summary?.pending_approvals?.items ?? []).slice(0, 8).map((item: PendingItem, i: number) => (
                        <li key={item.id} className="animate-fade-up" style={{ animationDelay: `${i * 30}ms` }}>
                          <Link to={`/applications/${item.application_id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-white/40 transition-colors">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-warmgray-800 truncate">
                                {templateLabel(item.template_code, lang, item.template_name, item.template_title_en)}
                              </p>
                              <p className="text-[11px] text-warmgray-400 mt-0.5">
                                {item.applicant_name}
                                {item.application_number && <span className="ml-1.5 font-mono text-warmgray-300">#{item.application_number}</span>}
                              </p>
                            </div>
                            {item.action_type === 'CONFIRM'
                              ? <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 ring-1 ring-amber-200/60">{lang === 'en' ? 'Confirm' : '確認'}</span>
                              : <span className="badge-pending shrink-0">{lang === 'en' ? 'Pending' : '承認待ち'}</span>
                            }
                            <svg className="w-3.5 h-3.5 text-warmgray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

            </div>

          ) : isEmptyState ? (
            /* ══════════════════════════════════════════════════════════════
               EMPTY STATE — no applications yet
            ════════════════════════════════════════════════════════════════ */
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-14rem)] text-center animate-fade-up">
              {/* Icon */}
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-ringo-400 to-ringo-600 flex items-center justify-center text-4xl mb-6 shadow-lg border border-white/40">
                🍎
              </div>
              {/* Welcome text */}
              <h2 className="text-2xl font-bold text-warmgray-800 mb-2">
                {greeting}、{firstName}さん
              </h2>
              <p className="text-warmgray-400 text-sm mb-8 max-w-xs">
                {lang === 'en' ? 'No applications yet. Start by submitting your first form below.' : 'まだ申請がありません。下のフォームから最初の申請を始めましょう。'}
              </p>
              {/* Primary CTA */}
              <button
                onClick={() => navigate('/applications/new')}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-ringo-500 text-white font-bold text-sm shadow-md hover:bg-ringo-600 hover:-translate-y-0.5 transition-all duration-200 mb-10"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                {lang === 'en' ? 'New Application' : '新規申請'}
              </button>
              {/* All templates grid */}
              {(templates?.length ?? 0) > 0 && (
                <div className="w-full max-w-4xl">
                  <p className="text-xs font-bold uppercase tracking-widest text-warmgray-400 mb-4">
                    {lang === 'en' ? 'Available forms' : '利用可能なフォーム'}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {(templates ?? []).map((tmpl, i) => {
                      const label = templateLabel(tmpl.code, lang, tmpl.title_ja, tmpl.title);
                      const gradient = tmpl.gradient ?? DEFAULT_GRADIENTS[tmpl.code] ?? 'from-warmgray-400 to-warmgray-600';
                      return (
                        <button
                          key={tmpl.id}
                          onClick={() => navigate(`/applications/new/${tmpl.code}`)}
                          className="card !p-4 text-left group hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 animate-fade-up"
                          style={{ animationDelay: `${i * 40}ms` }}
                        >
                          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-lg mb-3 border border-white/40`}>
                            {tmpl.icon ?? '📄'}
                          </div>
                          <p className="text-xs font-bold text-warmgray-800 group-hover:text-ringo-600 transition-colors leading-tight line-clamp-2">{label}</p>
                          <PatternBadge patternId={tmpl.pattern_id} size="sm" className="mt-1.5" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

          ) : (
            /* ══════════════════════════════════════════════════════════════
               PERSONAL VIEW
            ════════════════════════════════════════════════════════════════ */
            <>
              {/* ── Alert bar — action required ─────────────────────────── */}
              {(returnedCount > 0 || pendingApprovalsTotal > 0 || confirmTotal > 0) && (
                <div className="animate-fade-up flex flex-wrap items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 text-xs font-semibold">
                  <span className="text-amber-700 shrink-0">{lang === 'en' ? '⚠ Action required' : '⚠ 要対応'}</span>
                  {pendingApprovalsTotal > 0 && (
                    <Link to="/approvals" className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-amber-200 text-amber-800 hover:bg-amber-100 transition-colors">
                      {lang === 'en' ? 'Approvals' : '承認待ち'} <span className="font-bold">{pendingApprovalsTotal}</span>
                    </Link>
                  )}
                  {confirmTotal > 0 && (
                    <Link to="/approvals?action=confirm" className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-yellow-200 text-yellow-800 hover:bg-yellow-100 transition-colors">
                      {lang === 'en' ? 'Confirm' : '回付確認'} <span className="font-bold">{confirmTotal}</span>
                    </Link>
                  )}
                  {returnedCount > 0 && (
                    <Link to="/history?filter=RETURNED" className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-rose-200 text-rose-700 hover:bg-rose-100 transition-colors">
                      {lang === 'en' ? '↩ Returned' : '↩ 差し戻し'} <span className="font-bold">{returnedCount}</span>
                    </Link>
                  )}
                </div>
              )}

              {/* ── Main 2-column layout ────────────────────────────────── */}
              <div className="grid lg:grid-cols-[3fr_2fr] gap-5 items-start">

                {/* LEFT: Action tiles */}
                <div className="space-y-4">
                  <div className="card !p-4 sm:!p-6 space-y-5 animate-fade-up">
                    <div className="flex items-center justify-between -mb-1">
                      <span className="text-xs font-bold uppercase tracking-widest text-warmgray-400">{lang === 'en' ? 'Quick Actions' : 'クイックアクション'}</span>
                      <button
                        onClick={() => setShowSearch(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-ringo-50 border border-ringo-200/60 text-ringo-500 hover:bg-ringo-100 hover:text-ringo-600 transition-all duration-150 text-xs font-semibold"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z"/></svg>
                        {lang === 'en' ? 'Search' : '検索'}
                      </button>
                    </div>
                    <Section icon="📝" title={lang === 'en' ? 'Submit' : '申請する'}>
                      <ActionTile label={lang === 'en' ? 'New' : '作成'} onClick={() => navigate('/applications/new')} />
                      <ActionTile label={lang === 'en' ? 'Drafts' : '下書き'} count={draftCount} to="/history?filter=DRAFT" />
                      <ActionTile label={lang === 'en' ? 'In Progress' : '申請中'} count={pendingCount} to="/history?filter=PENDING_APPROVAL" />
                      <ActionTile label={lang === 'en' ? 'Unsettled' : '未精算'} count={approvedCount} onClick={() => setShowUnsettled(true)} />
                      <ActionTile label={lang === 'en' ? 'Returned' : '差し戻し'} count={returnedCount} to="/history?filter=RETURNED" />
                    </Section>
                    {perms.canApprove && (
                      <Section icon="✅" title={lang === 'en' ? 'Approve' : '承認する'}>
                        <ActionTile label={lang === 'en' ? 'Pending' : '未処理'} count={pendingApprovalsTotal} onClick={() => setShowAllPending(true)} />
                        <ActionTile label={lang === 'en' ? 'Confirm' : '回付予定'} count={confirmTotal} to="/approvals?action=confirm" />
                        <ActionTile label={lang === 'en' ? 'Proxy Approval' : '代理承認'} count={scheduledReviewTotal} to="/approvals?proxy=1" />
                      </Section>
                    )}
                    <Section icon="🔍" title={lang === 'en' ? 'Search' : '探す'}>
                      <ActionTile label={lang === 'en' ? 'Search' : '検索'} onClick={() => setShowSearch(true)} />
                      <ActionTile label={lang === 'en' ? 'Application History' : '申請履歴'} to="/history" />
                      {perms.canApprove && (
                        <ActionTile label={lang === 'en' ? 'Approval History' : '承認履歴'} to="/approval-history" />
                      )}
                    </Section>
                  </div>

                  {/* Recent forms — compact grid */}
                  {recentTemplates.length > 0 && (
                    <div className="animate-fade-up space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="section-title">{lang === 'en' ? 'Recently used forms' : 'よく使うフォーム'}</h3>
                        <button onClick={() => navigate('/applications/new')} className="text-xs font-semibold text-ringo-500 hover:text-ringo-600 transition-colors">{lang === 'en' ? 'All forms →' : 'すべて見る →'}</button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {recentTemplates.map((tmpl, i) => {
                          const label = templateLabel(tmpl.code, lang, tmpl.title_ja, tmpl.title);
                          const gradient = tmpl.gradient ?? DEFAULT_GRADIENTS[tmpl.code] ?? 'from-warmgray-400 to-warmgray-600';
                          return (
                            <button key={tmpl.id} onClick={() => navigate(`/applications/new/${tmpl.code}`)} className="card !p-4 text-left group hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
                              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-lg mb-3 border border-white/40`}>{tmpl.icon ?? '📄'}</div>
                              <p className="text-xs font-bold text-warmgray-800 group-hover:text-ringo-600 transition-colors leading-tight line-clamp-2">{label}</p>
                              <PatternBadge patternId={tmpl.pattern_id} size="sm" className="mt-1.5" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* RIGHT: Live data */}
                <div className="space-y-4">
                  {/* Pending approvals — inline */}
                  {perms.canApprove && pendingApprovalsTotal > 0 && (
                    <div className="animate-fade-up space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="section-title">{lang === 'en' ? 'Pending approvals' : '承認待ち一覧'}</h3>
                        <Link to="/approvals" className="text-xs font-semibold text-ringo-500 hover:text-ringo-600 transition-colors">{lang === 'en' ? `${pendingApprovalsTotal} total →` : `全${pendingApprovalsTotal}件 →`}</Link>
                      </div>
                      <div className="card !p-0 overflow-hidden">
                        <ul className="divide-y divide-white/30">
                          {(summary?.pending_approvals?.items ?? []).slice(0, 5).map((item: PendingItem, i: number) => (
                            <li key={item.id} className="animate-fade-up" style={{ animationDelay: `${i * 30}ms` }}>
                              <Link to={`/applications/${item.application_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/40 transition-colors">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-warmgray-800 truncate">
                                    {templateLabel(item.template_code, lang, item.template_name, item.template_title_en)}
                                  </p>
                                  <p className="text-[11px] text-warmgray-400 mt-0.5">
                                    {item.applicant_name}
                                    {item.application_number && <span className="ml-1.5 font-mono text-warmgray-300">#{item.application_number}</span>}
                                  </p>
                                </div>
                                {item.action_type === 'CONFIRM'
                                  ? <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 ring-1 ring-amber-200/60">{lang === 'en' ? 'Confirm' : '確認'}</span>
                                  : <span className="badge-pending shrink-0 text-[10px]">{lang === 'en' ? 'Pending' : '承認待ち'}</span>
                                }
                                <svg className="w-3.5 h-3.5 text-warmgray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                              </Link>
                            </li>
                          ))}
                        </ul>
                        {pendingApprovalsTotal > 5 && (
                          <div className="px-4 py-2.5 border-t border-white/30">
                            <Link to="/approvals" className="text-xs text-ringo-500 font-semibold hover:text-ringo-600 transition-colors">
                              {lang === 'en' ? `View all ${pendingApprovalsTotal} →` : `残り${pendingApprovalsTotal - 5}件を見る →`}
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Recent applications */}
                  {recentApps.length > 0 && (
                    <div className="animate-fade-up space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="section-title">{lang === 'en' ? 'Recent applications' : '最近の申請'}</h3>
                        <Link to="/history" className="text-xs font-semibold text-ringo-500 hover:text-ringo-600 transition-colors">{lang === 'en' ? 'All →' : 'すべて見る →'}</Link>
                      </div>
                      <RecentAppsList apps={recentApps} lang={lang} dateLocale={dateLocale} t={t} />
                    </div>
                  )}
                </div>
              </div>

            </>
          )}

        </div>
      )}

      {/* Drawers */}
      {showAllPending && <PendingApprovalsDrawer total={pendingApprovalsTotal} onClose={() => setShowAllPending(false)} />}
      {showUnsettled  && <UnsettledDrawer onClose={() => setShowUnsettled(false)} />}
      {showSearch     && <SearchDrawer onClose={() => setShowSearch(false)} />}
    </Layout>
  );
}
