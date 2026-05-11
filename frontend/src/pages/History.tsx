import { useState, useEffect, useCallback } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useScrollEnd } from '../hooks/useScrollEnd';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { useLang } from '../context/LanguageContext';
import { templateLabel } from '../config/templateLabels';

interface Application {
  id: string;
  application_number: string | null;
  status: string;
  template_name: string;
  template_code?: string;
  has_settlement?: boolean;
  created_at: string;
  form_data: Record<string, any>;
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

const ALL_STATUS_KEYS = ['ALL', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PENDING_SETTLEMENT', 'REJECTED', 'RETURNED', 'COMPLETED'];

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

  const [statusFilter, setStatusFilter] = useState('ALL');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Application | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState<Application | null>(null);

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
  } = useInfiniteQuery<{ items: Application[]; hasMore: boolean; offset: number }>({
    queryKey: ['myApplications', statusFilter],
    queryFn: async ({ pageParam = 0 }) => (await apiClient.get(
      `/applications?limit=${PAGE}&offset=${pageParam}&status=${statusFilter}`
    )).data,
    initialPageParam: 0,
    getNextPageParam: (last, all) => last.hasMore ? all.length * PAGE : undefined,
    staleTime: 30_000,
    // Heavy paginated list — free pages quickly when user navigates away
    gcTime:    60_000,
  });

  const applications = data?.pages.flatMap(p => p.items) ?? [];

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

  // Server handles status filter + sort — just alias locally
  const sorted = applications;
  const draftCount = applications.filter((a) => a.status === 'DRAFT').length;

  return (
    <Layout title={t('title_history')}>
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Confirm dialogs — language-aware quotes (「」 in JP, "..." in EN) */}
      {(() => {
        const open  = lang === 'en' ? '"' : '「';
        const close = lang === 'en' ? '"' : '」';
        const dName = templateLabel(confirmDelete?.template_code, lang, confirmDelete?.template_name ?? '');
        const sName = templateLabel(confirmSubmit?.template_code, lang, confirmSubmit?.template_name ?? '');
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

      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header row */}
        <div className="animate-fade-up flex items-end justify-between">
          <div>
            <p className="section-title mb-0">{t('title_history')}</p>
            <p className="text-2xl font-bold text-warmgray-800 mt-1">
              {applications.length} {t('history_items_suffix')}
              {draftCount > 0 && (
                <span className="ml-2 text-sm font-normal text-warmgray-400">
                  {lang === 'en'
                    ? `(${draftCount} ${t('history_draft_suffix')})`
                    : `（${t('history_draft_suffix')} ${draftCount} ${t('history_items_suffix')}）`}
                </span>
              )}
            </p>
          </div>
          <Link to="/dashboard" className="btn-outline text-xs">
            {t('history_new_app')}
          </Link>
        </div>

        {/* Filter pills */}
        <div className="animate-fade-up flex gap-2 flex-wrap">
          {ALL_STATUS_KEYS.map((s) => {
            const isActive = statusFilter === s;
            const label = s === 'ALL' ? t('history_filter_all') : (STATUS_LABEL[s] ?? s);
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-150
                  ${isActive
                    ? 'bg-warmgray-800 text-white shadow-sm'
                    : 'bg-white/60 text-warmgray-500 hover:bg-white/90 border border-white/80 backdrop-blur-sm'
                  }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="card flex items-center justify-center gap-3 py-16 text-warmgray-400">
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            {t('loading')}
          </div>
        ) : sorted.length === 0 ? (
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
          <div className="card !p-0 overflow-hidden">
            {/*
              key={statusFilter} forces React to remount the list when the
              filter pill changes. That triggers the fade-up animation on
              every <li> below, giving a smooth filter transition instead
              of a choppy in-place swap.
            */}
            <ul key={statusFilter} className="divide-y divide-white/30">
              {sorted.map((app, idx) => {
                const cls = STATUS_CLS[app.status] ?? 'badge-draft';
                const label = STATUS_LABEL[app.status] ?? app.status;
                const isDraft = app.status === 'DRAFT';
                const isReturned = app.status === 'RETURNED';
                const isSettleable = app.status === 'APPROVED' && app.has_settlement;

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
                    className="list-virt flex items-center gap-4 px-5 py-4 hover:bg-white/40 transition-colors duration-100 animate-fade-up"
                    style={{ animationDelay: `${Math.min(idx, 12) * 30}ms` }}
                  >
                    {/* Status dot */}
                    <div className={`w-2 h-2 rounded-full shrink-0 ${
                      isDraft ? 'bg-warmgray-400' :
                      app.status === 'PENDING_APPROVAL' ? 'bg-amber-400' :
                      app.status === 'PENDING_SETTLEMENT' ? 'bg-teal-400' :
                      app.status === 'APPROVED' || app.status === 'COMPLETED' ? 'bg-emerald-400' :
                      app.status === 'REJECTED' ? 'bg-red-400' :
                      app.status === 'RETURNED' ? 'bg-orange-400' :
                      'bg-warmgray-300'
                    }`} />

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-warmgray-800 truncate">
                          {templateLabel(app.template_code, lang, app.template_name)}
                        </p>
                        <span className={cls}>{label}</span>
                        {phaseBadge && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${phaseBadge.cls}`}>
                            {phaseBadge.text}
                          </span>
                        )}
                        {(isDraft || isReturned) && (
                          <span className="text-[10px] text-warmgray-400 font-medium">{t('history_editable')}</span>
                        )}
                      </div>
                      <p className="text-[11px] text-warmgray-400 mt-0.5">
                        {app.application_number ? (
                          <span className="font-mono mr-2">{app.application_number}</span>
                        ) : null}
                        {new Date(app.created_at).toLocaleDateString(dateLocale, {
                          year: 'numeric', month: 'long', day: 'numeric',
                        })}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {isDraft && (
                        <>
                          <button
                            className="btn-primary text-xs px-3 py-1.5 rounded-lg"
                            disabled={submitDraft.isPending}
                            onClick={() => setConfirmSubmit(app)}
                          >
                            {t('btn_submit')}
                          </button>
                          <Link
                            to={`/applications/${app.id}`}
                            className="btn-outline text-xs px-3 py-1.5 rounded-lg"
                          >
                            {t('history_edit')}
                          </Link>
                          <button
                            className="text-[11px] text-warmgray-400 hover:text-red-500 transition-colors font-medium"
                            onClick={() => setConfirmDelete(app)}
                          >
                            {t('history_delete')}
                          </button>
                        </>
                      )}
                      {isSettleable && (
                        <button
                          className="btn-primary text-xs px-3 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 border-teal-500 hover:border-teal-600"
                          onClick={() => navigate(`/applications/${app.id}/settlement`)}
                        >
                          💴 {t('btn_settle')}
                        </button>
                      )}
                      {!isDraft && (
                        <Link
                          to={`/applications/${app.id}`}
                          className="text-xs font-semibold text-ringo-500 hover:text-ringo-600 transition-colors flex items-center gap-0.5"
                        >
                          {t('history_detail')}
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Sentinel — h-px keeps it invisible; IntersectionObserver fires 200px early */}
            <div ref={sentinelRef} className="h-px" />
            {(isFetchingNextPage || (!hasNextPage && sorted.length >= PAGE)) && (
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
                  <span className="text-warmgray-300">{lang === 'en' ? 'All records loaded' : '全件表示済み'}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
