import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Layout from '../components/common/Layout';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { getPermissions } from '../config/permissions';
import { TEMPLATE_LABELS, templateLabel, templateDesc } from '../config/templateLabels';
import apiClient from '../services/apiClient';

// Order matters — this is also the display order on the Dashboard grid
const TEMPLATE_CODES = [
  'INQUIRY', 'BUSINESS_TRIP', 'OFFICE_OVERTIME', 'EQUIPMENT_PURCHASE',
  'PC_TAKEOUT', 'LEAVE', 'TARDINESS', 'INCIDENT_REPORT', 'EXPENSE_CLAIM',
] as const;

function StatusBadge({ status, t }: { status: string; t: (k: any) => string }): JSX.Element {
  const map: Record<string, { cls: string; key: string }> = {
    PENDING_APPROVAL:   { cls: 'badge-pending',  key: 'status_pending' },
    APPROVED:           { cls: 'badge-approved', key: 'status_approved' },
    REJECTED:           { cls: 'badge-rejected', key: 'status_rejected' },
    RETURNED:           { cls: 'badge-returned', key: 'status_returned' },
    DRAFT:              { cls: 'badge-draft',    key: 'status_draft' },
    COMPLETED:          { cls: 'badge-indigo',   key: 'status_completed' },
    CANCELLED:          { cls: 'badge-draft',    key: 'status_cancelled' },
    PENDING_SETTLEMENT: { cls: 'badge-mustard',  key: 'status_pending_settle' },
    SETTLEMENT_APPROVED:{ cls: 'badge-teal',     key: 'status_settle_approved' },
  };
  const s = map[status];
  if (s) return <span className={s.cls}>{t(s.key as any)}</span>;
  return <span className="badge-draft">{status}</span>;
}

function MiniStepDots({ current, total }: { current: number | null; total: number }) {
  if (!current || !total || total === 0 || current > total) return null;
  return (
    <div className="flex items-center gap-1 mt-1">
      {Array.from({ length: Number(total) }).map((_, i) => {
        const n = i + 1;
        if (n < current) return <span key={i} className="w-1.5 h-1.5 rounded-full bg-emerald-400" />;
        if (n === current) return <span key={i} className="w-1.5 h-1.5 rounded-full bg-ringo-500 ring-1 ring-ringo-300" />;
        return <span key={i} className="w-1.5 h-1.5 rounded-full bg-surface-300" />;
      })}
      <span className="text-[10px] text-warmgray-400 ml-0.5">{current}/{total} ステップ</span>
    </div>
  );
}

// ── Stat card (clickable) ────────────────────────────────────────────────────
function StatCard({ label, value, icon, color, to }: {
  label: string; value: number | string; icon: string; color: string; to?: string;
}) {
  const inner = (
    <div className={`stat-card animate-fade-up relative overflow-hidden ${to ? 'cursor-pointer' : ''}`}>
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


export default function Dashboard() {
  const { user, loading, role } = useAuth();
  const { t, lang } = useLang();
  const dateLocale = lang === 'en' ? 'en-US' : 'ja-JP';
  const perms = getPermissions(user?.role);
  const isAdmin = role === 'ADMIN';
  const [adminView, setAdminView] = useState(false);

  // ── Personal summary ───────────────────────────────────────────────────────
  interface DashboardSummary {
    status_counts: {
      DRAFT: number; PENDING_APPROVAL: number; RETURNED: number; APPROVED: number;
      PENDING_SETTLEMENT: number; SETTLEMENT_APPROVED: number; COMPLETED: number; REJECTED: number;
    };
    recent_apps: any[];
    pending_approvals?: { items: any[]; total: number };
  }
  const { data: summary } = useQuery<DashboardSummary>({
    queryKey: ['dashboard', 'summary'],
    queryFn: async () => (await apiClient.get('/dashboard/summary')).data,
    enabled: !loading,
    staleTime: 30_000,
  });

  // ── Admin company-wide overview ────────────────────────────────────────────
  interface AdminOverview {
    status_counts: Record<string, number>;
    dept_breakdown: { dept_name: string; total: number; pending: number; in_settlement: number; completed: number }[];
    pending_by_approver: { approver_name: string; pending_count: number }[];
    recent_activity: any[];
    settlement_overview: { awaiting_approval: number; awaiting_transfer: number; completed: number };
  }
  const { data: overview } = useQuery<AdminOverview>({
    queryKey: ['dashboard', 'admin-overview'],
    queryFn: async () => (await apiClient.get('/dashboard/admin-overview')).data,
    enabled: !loading && isAdmin,   // pre-fetch in background — ready instantly when toggle opens
    staleTime: 120_000,
    refetchOnWindowFocus: false,    // SSE invalidates on real changes — no focus polling needed
  });

  const pendingCount          = summary?.status_counts.PENDING_APPROVAL ?? 0;
  const draftCount            = summary?.status_counts.DRAFT ?? 0;
  const returnedCount         = summary?.status_counts.RETURNED ?? 0;
  const recentApps            = summary?.recent_apps ?? [];
  const pendingApprovals      = summary?.pending_approvals?.items ?? [];
  const pendingApprovalsTotal = summary?.pending_approvals?.total ?? 0;
  const myAppsTotal = summary
    ? Object.values(summary.status_counts).reduce((sum, n) => sum + n, 0)
    : 0;
  const firstName = user?.full_name?.split(' ')[0] ?? 'ゲスト';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('greeting_morning') : hour < 18 ? t('greeting_day') : t('greeting_evening');

  // Company-wide totals for admin stat cards
  const companyTotal    = overview ? Object.values(overview.status_counts).reduce((s, n) => s + n, 0) : 0;
  const companyPending  = overview?.status_counts.PENDING_APPROVAL ?? 0;
  const companySettle   = (overview?.status_counts.PENDING_SETTLEMENT ?? 0) + (overview?.status_counts.SETTLEMENT_APPROVED ?? 0);
  const companyDone     = overview?.status_counts.COMPLETED ?? 0;

  return (
    <Layout title={t('title_dashboard')}>
      {loading ? (
        <div className="flex items-center justify-center h-32 text-warmgray-400 text-sm">読み込み中...</div>
      ) : (
        <div className="max-w-6xl mx-auto space-y-8">

          {/* Header row: greeting + admin toggle */}
          <div className="flex items-start justify-between gap-4 animate-fade-up">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-warmgray-400 mb-1">{greeting}</p>
              <h2 className="text-2xl font-bold text-warmgray-800">{firstName}さん 👋</h2>
              <p className="text-sm text-warmgray-400 mt-1">
                {new Date().toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
              </p>
            </div>
            {isAdmin && (
              <button
                onClick={() => setAdminView(v => !v)}
                title={adminView ? (lang === 'en' ? 'Back to my dashboard' : 'マイダッシュボードに戻す') : (lang === 'en' ? 'Company overview' : '全社ビュー')}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all duration-200 ${
                  adminView
                    ? 'bg-ringo-500 text-white border-ringo-600 shadow-md'
                    : 'bg-white/60 text-warmgray-600 border-white/80 hover:bg-white/80'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3h16.5M3.75 9h16.5M3.75 15h8.25M3.75 21h8.25" />
                </svg>
                {adminView
                  ? (lang === 'en' ? 'My Dashboard' : 'マイ')
                  : (lang === 'en' ? 'Company View' : '全社ビュー')}
              </button>
            )}
          </div>

          {/* ── ADMIN COMPANY OVERVIEW ─────────────────────────────────────── */}
          {isAdmin && adminView && (
            <div className="space-y-6 animate-fade-up">

              {/* Admin banner */}
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-ringo-500/10 border border-ringo-200/60 text-ringo-700 text-xs font-semibold">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
                </svg>
                {lang === 'en' ? 'Admin — Company-wide overview' : '管理者ビュー — 全社統計'}
                <button onClick={() => setAdminView(false)} className="ml-auto text-ringo-400 hover:text-ringo-600 transition-colors">✕</button>
              </div>

              {/* Company stat cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger">
                <StatCard label={lang === 'en' ? 'Total Apps' : '総申請数'} value={companyTotal} icon="📁" color="from-indigo-200/40 to-transparent" to="/admin" />
                <StatCard label={lang === 'en' ? 'Pending Approval' : '承認待ち'} value={companyPending} icon="⏳" color="from-amber-200/50 to-transparent" to="/approvals" />
                <StatCard label={lang === 'en' ? 'In Settlement' : '精算中'} value={companySettle} icon="💴" color="from-teal-200/40 to-transparent" to="/accounting" />
                <StatCard label={lang === 'en' ? 'Completed' : '完了'} value={companyDone} icon="✅" color="from-emerald-200/40 to-transparent" to="/admin" />
              </div>

              {/* Settlement sub-stats */}
              {overview?.settlement_overview && (
                <div className="grid grid-cols-3 gap-3">
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

              {/* Two-column: dept breakdown + pending by approver */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Department breakdown — card tiles */}
                <div className="space-y-3">
                  <h3 className="section-title">{lang === 'en' ? 'By Department' : '部署別申請状況'}</h3>
                  {!overview?.dept_breakdown?.length ? (
                    <div className="card py-8 text-center text-sm text-warmgray-400">データなし</div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {overview.dept_breakdown.map((d, i) => (
                        <div key={i} className="card !p-4 space-y-3 animate-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
                          {/* Dept name */}
                          <p className="text-sm font-bold text-warmgray-800 truncate">{d.dept_name}</p>
                          {/* Stat row */}
                          <div className="flex items-end gap-3">
                            <div className="flex-1 text-center">
                              <p className="text-xl font-bold text-amber-600">{d.pending}</p>
                              <p className="text-[9px] font-bold uppercase tracking-widest text-warmgray-400 mt-0.5">
                                {lang === 'en' ? 'PENDING' : '承認待ち'}
                              </p>
                            </div>
                            <div className="flex-1 text-center">
                              <p className="text-xl font-bold text-teal-600">{d.in_settlement}</p>
                              <p className="text-[9px] font-bold uppercase tracking-widest text-warmgray-400 mt-0.5">
                                {lang === 'en' ? 'SETTLE' : '精算中'}
                              </p>
                            </div>
                            <div className="flex-1 text-center">
                              <p className="text-xl font-bold text-indigo-600">{d.completed}</p>
                              <p className="text-[9px] font-bold uppercase tracking-widest text-warmgray-400 mt-0.5">
                                {lang === 'en' ? 'DONE' : '完了'}
                              </p>
                            </div>
                            {/* Total — highlighted box like reference */}
                            <div className="flex-none bg-warmgray-100/80 border border-warmgray-200/60 rounded-xl px-3 py-1.5 text-center min-w-[52px]">
                              <p className="text-xl font-bold text-warmgray-800">{d.total}</p>
                              <p className="text-[9px] font-bold uppercase tracking-widest text-warmgray-500 mt-0.5">
                                {lang === 'en' ? 'TOTAL' : '総数'}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Pending by approver + recent activity */}
                <div className="space-y-4">

                  {/* Pending steps by approver */}
                  <div className="space-y-2">
                    <h3 className="section-title">{lang === 'en' ? 'Pending by Approver' : '承認者別 未処理'}</h3>
                    <div className="card !p-0 overflow-hidden">
                      {!overview?.pending_by_approver?.length ? (
                        <p className="px-4 py-4 text-sm text-warmgray-400 text-center">{lang === 'en' ? 'No pending approvals' : '承認待ちなし'}</p>
                      ) : (
                        <ul className="divide-y divide-white/20">
                          {overview.pending_by_approver.map((row, i) => (
                            <li key={i} className="flex items-center justify-between px-4 py-2.5">
                              <span className="text-sm font-medium text-warmgray-700 truncate">{row.approver_name}</span>
                              <span className="badge-pending ml-2 shrink-0">{row.pending_count} {lang === 'en' ? 'pending' : '件'}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  {/* Recent company activity */}
                  <div className="space-y-2">
                    <h3 className="section-title">{lang === 'en' ? 'Recent Company Activity' : '最新申請（全社）'}</h3>
                    <div className="card !p-0 overflow-hidden">
                      {!overview?.recent_activity?.length ? (
                        <p className="px-4 py-4 text-sm text-warmgray-400 text-center">データなし</p>
                      ) : (
                        <ul className="divide-y divide-white/20">
                          {overview.recent_activity.map((app: any, i: number) => (
                            <li key={app.id} className="flex items-center gap-3 px-4 py-2.5 animate-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-warmgray-800 truncate">
                                  {templateLabel(app.template_code, lang, app.template_name)}
                                </p>
                                <p className="text-[10px] text-warmgray-400 truncate">
                                  {app.applicant_name} · {app.dept_name} · {new Date(app.created_at).toLocaleDateString(dateLocale)}
                                </p>
                              </div>
                              <div className="shrink-0">
                                <StatusBadge status={app.status} t={t} />
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="px-4 py-2.5 border-t border-white/30">
                        <Link to="/admin" className="text-xs font-semibold text-ringo-500 hover:text-ringo-600 transition-colors">
                          {lang === 'en' ? 'All applications →' : '全申請を見る →'}
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── PERSONAL DASHBOARD (default / non-admin) ──────────────────── */}
          {!adminView && (
            <div className="space-y-8">

              {/* Stats — all clickable */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger">
                <StatCard
                  label={t('dash_stat_pending')} value={pendingCount} icon="📤"
                  color="from-amber-200/50 to-transparent"
                  to="/history?filter=PENDING_APPROVAL"
                />
                <StatCard
                  label={t('dash_stat_returned')} value={returnedCount} icon="↩"
                  color="from-orange-200/50 to-transparent"
                  to="/history?filter=RETURNED"
                />
                <StatCard
                  label={t('dash_stat_draft')} value={draftCount} icon="📝"
                  color="from-surface-200/80 to-transparent"
                  to="/history?filter=DRAFT"
                />
                {perms.canApprove
                  ? <StatCard label={t('dash_stat_approval')} value={pendingApprovalsTotal} icon="🔔" color="from-ringo-200/50 to-transparent" to="/approvals" />
                  : <StatCard label={t('dash_stat_total')} value={myAppsTotal} icon="📁" color="from-indigo-200/30 to-transparent" to="/history" />
                }
              </div>

              {/* Two-column layout */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

                {/* Template grid */}
                <div className="lg:col-span-3 space-y-3">
                  <h3 className="section-title">{t('dash_forms_title')}</h3>
                  <div className="grid grid-cols-2 gap-3 stagger">
                    {TEMPLATE_CODES.map((code) => {
                      const tmpl = TEMPLATE_LABELS[code];
                      return (
                        <Link
                          key={code}
                          to={`/applications/new/${code}`}
                          className="card-hover group !p-4 flex items-start gap-3 animate-fade-up"
                        >
                          <div className={`flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br ${tmpl.gradient} flex items-center justify-center text-xl border border-white/60`}>
                            {tmpl.icon}
                          </div>
                          <div className="min-w-0 pt-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-semibold text-warmgray-800 leading-tight group-hover:text-ringo-600 transition-colors">
                                {templateLabel(code, lang, tmpl.ja)}
                              </p>
                              {tmpl.twoStage && (
                                <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 border border-teal-200/60 leading-none">
                                  {t('two_stage_badge')}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-warmgray-400 mt-0.5 leading-tight">
                              {templateDesc(code, lang)}
                            </p>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>

                {/* Sidebar column */}
                <div className="lg:col-span-2 space-y-4">

                  {/* Recent applications */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="section-title mb-0">{t('dash_recent_title')}</h3>
                      {draftCount > 0 && (
                        <Link to="/history?filter=DRAFT" className="text-[11px] font-semibold text-ringo-500 hover:text-ringo-600 transition-colors">
                          下書き {draftCount}件 →
                        </Link>
                      )}
                    </div>
                    <div className="card !p-0 overflow-hidden">
                      {recentApps.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-warmgray-400">
                          <span className="text-3xl mb-2">📭</span>
                          <p className="text-sm">申請がまだありません</p>
                        </div>
                      ) : (
                        <ul className="divide-y divide-white/30">
                          {recentApps.map((app, i) => (
                            <li key={app.id} className="animate-fade-up" style={{ animationDelay: `${i * 55}ms` }}>
                              <Link
                                to={`/history`}
                                className="flex items-center gap-3 px-4 py-3 hover:bg-white/30 transition-colors"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-warmgray-800 truncate">
                                    {templateLabel(app.template_code, lang, app.template_name)}
                                  </p>
                                  <p className="text-[11px] text-warmgray-400 mt-0.5">
                                    {new Date(app.created_at).toLocaleDateString(dateLocale)}
                                  </p>
                                  {app.status === 'PENDING_APPROVAL' && (
                                    <MiniStepDots
                                      current={app.current_step ? Number(app.current_step) : null}
                                      total={Number(app.total_steps ?? 0)}
                                    />
                                  )}
                                </div>
                                <StatusBadge status={app.status} t={t} />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="px-4 py-3 border-t border-white/30">
                        <Link to="/history" className="text-xs font-semibold text-ringo-500 hover:text-ringo-600 transition-colors">
                          {t('dash_view_history')}
                        </Link>
                      </div>
                    </div>
                  </div>

                  {/* Pending approvals mini-list */}
                  {perms.canApprove && pendingApprovals.length > 0 && (
                    <div>
                      <h3 className="section-title">{t('dash_require_title')}</h3>
                      <div className="card !p-0 overflow-hidden">
                        <ul className="divide-y divide-white/30">
                          {pendingApprovals.slice(0, 3).map((app, i) => (
                            <li key={app.id} className="animate-fade-up" style={{ animationDelay: `${i * 55}ms` }}>
                              <Link
                                to="/approvals"
                                className="block px-4 py-3 hover:bg-white/30 transition-colors"
                              >
                                <p className="text-sm font-semibold text-warmgray-800 truncate">
                                  {templateLabel(app.template_code, lang, app.template_name)}
                                </p>
                                <p className="text-[11px] text-warmgray-400 mt-0.5">{app.applicant_name}</p>
                              </Link>
                            </li>
                          ))}
                        </ul>
                        <div className="px-4 py-3 border-t border-white/30">
                          <Link to="/approvals" className="text-xs font-semibold text-ringo-500 hover:text-ringo-600 transition-colors">
                            {t('dash_view_approvals')}
                          </Link>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </Layout>
  );
}
