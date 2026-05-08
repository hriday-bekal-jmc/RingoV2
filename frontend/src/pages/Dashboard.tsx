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
    PENDING_APPROVAL: { cls: 'badge-pending',  key: 'status_pending' },
    APPROVED:         { cls: 'badge-approved', key: 'status_approved' },
    REJECTED:         { cls: 'badge-rejected', key: 'status_rejected' },
    RETURNED:         { cls: 'badge-returned', key: 'status_returned' },
    DRAFT:            { cls: 'badge-draft',    key: 'status_draft' },
    COMPLETED:        { cls: 'badge-approved', key: 'status_completed' },
    CANCELLED:        { cls: 'badge-draft',    key: 'status_cancelled' },
    PENDING_SETTLEMENT: { cls: 'badge-mustard', key: 'status_pending_settle' },
  };
  const s = map[status];
  if (s) return <span className={s.cls}>{t(s.key as any)}</span>;
  return <span className="badge-draft">{status}</span>;
}

function MiniStepDots({ current, total }: { current: number | null; total: number }) {
  if (!current || !total || total === 0) return null;
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
  const { user, loading } = useAuth();
  const { t, lang } = useLang();
  const dateLocale = lang === 'en' ? 'en-US' : 'ja-JP';
  const perms = getPermissions(user?.role);

  // Dashboard: fetch up to 100 own apps for stat counts + recent list.
  // Separate key suffix ('dashboard') avoids cache conflict with History's infinite query.
  const { data: myAppsRes } = useQuery<{ items: any[]; hasMore: boolean }>({
    queryKey: ['myApplications', 'dashboard'],
    queryFn: async () => (await apiClient.get('/applications?limit=100&offset=0&status=ALL')).data,
    enabled: !loading,
    staleTime: 30_000,
  });
  const myApps = myAppsRes?.items ?? [];

  // Pending approvals: need total (accurate count via window fn) + first few for mini-list.
  const { data: pendingRes } = useQuery<{ items: any[]; hasMore: boolean; total: number }>({
    queryKey: ['pendingApprovals', 'dashboard'],
    queryFn: async () => (await apiClient.get('/approvals/pending?limit=5&offset=0')).data,
    enabled: !loading && perms.canApprove,
    staleTime: 30_000,
  });
  const pendingApprovals      = pendingRes?.items ?? [];
  const pendingApprovalsTotal = pendingRes?.total  ?? 0;

  const pendingCount  = myApps.filter((a) => a.status === 'PENDING_APPROVAL').length;
  const draftCount    = myApps.filter((a) => a.status === 'DRAFT').length;
  const returnedCount = myApps.filter((a) => a.status === 'RETURNED').length;
  const recentApps    = myApps.slice(0, 5);   // already sorted DESC by server
  const firstName = user?.full_name?.split(' ')[0] ?? 'ゲスト';

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('greeting_morning') : hour < 18 ? t('greeting_day') : t('greeting_evening');

  return (
    <Layout title={t('title_dashboard')}>
      {loading ? (
        <div className="flex items-center justify-center h-32 text-warmgray-400 text-sm">読み込み中...</div>
      ) : (
        <div className="max-w-6xl mx-auto space-y-8">

          {/* Greeting */}
          <div className="animate-fade-up">
            <p className="text-xs font-semibold uppercase tracking-widest text-warmgray-400 mb-1">{greeting}</p>
            <h2 className="text-2xl font-bold text-warmgray-800">{firstName}さん 👋</h2>
            <p className="text-sm text-warmgray-400 mt-1">
              {new Date().toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
            </p>
          </div>

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
              : <StatCard label={t('dash_stat_total')} value={myApps.length} icon="📁" color="from-indigo-200/30 to-transparent" to="/history" />
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

              {/* Recent applications — each item links directly to application */}
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
                        <li
                          key={app.id}
                          className="animate-fade-up"
                          style={{ animationDelay: `${i * 55}ms` }}
                        >
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
    </Layout>
  );
}
