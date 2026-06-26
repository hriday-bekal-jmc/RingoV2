import { useState, useEffect, useCallback } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useScrollEnd } from '../../hooks/useScrollEnd';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import apiClient from '../../services/apiClient';
import AdminAppDetailModal from './AdminAppDetailModal';
import RingoLoader from '../common/RingoLoader';
import { Sk } from '../common/Skeleton';
import CustomSelect from '../forms/CustomSelect';
import { useLang } from '../../context/LanguageContext';
import type { Department } from './adminTypes';

interface AppRecord {
  id: string;
  application_number: string | null;
  status: string;
  template_name: string;
  applicant_name: string;
  applicant_email: string;
  department_name: string;
  created_at: string;
  archived_at?: string | null;
  archive_reason?: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  PENDING_APPROVAL:    'badge-pending',
  APPROVED:            'badge-approved',
  REJECTED:            'badge-rejected',
  RETURNED:            'badge-returned',
  DRAFT:               'badge-draft',
  CANCELLED:           'badge-draft',
  COMPLETED:           'badge-indigo',
  PENDING_SETTLEMENT:  'badge-mustard',
  SETTLEMENT_APPROVED: 'badge-teal',
};

// STATUS_LABEL now computed dynamically in ApplicationsTab using t() for language support

const PAGE_APPS = 30;
const ARCHIVABLE_STATUSES = new Set(['COMPLETED', 'REJECTED', 'CANCELLED']);

export default function ApplicationsTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const queryClient = useQueryClient();
  const { t } = useLang();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [archiveFilter, setArchiveFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  // Clicked-row → opens AdminAppDetailModal with full audit + flow
  const [openAppId, setOpenAppId] = useState<string | null>(null);

  // Debounce search — 300ms
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
  } = useInfiniteQuery<{ items: AppRecord[]; hasMore: boolean; offset: number; nextCursor?: string | null }>({
    queryKey: ['admin', 'applications', debouncedSearch, deptFilter, statusFilter, archiveFilter],
    queryFn: async ({ pageParam = null }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : '';
      return (await apiClient.get(
        `/admin/applications?search=${encodeURIComponent(debouncedSearch)}&dept=${encodeURIComponent(deptFilter)}&status=${encodeURIComponent(statusFilter)}&archive=${archiveFilter}&limit=${PAGE_APPS}${cursor}`
      )).data;
    },
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
    // Drop cached pages quickly when admin leaves the tab — large objects
    gcTime:    60_000,
    // Keep stale data visible while new filter/search fetches — no flash
    placeholderData: keepPreviousData,
  });

  const showLoader = useDelayedLoading(isLoading);

  const apps = data?.pages.flatMap(p => p.items) ?? [];

  const sentinelRef = useScrollEnd(
    useCallback(() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }, [hasNextPage, isFetchingNextPage, fetchNextPage]),
    hasNextPage ?? false,
  );

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['admin', 'departments'],
    queryFn:  async () => (await apiClient.get('/admin/departments')).data,
    staleTime: 10 * 60_000,
  });

  const archiveApp = useMutation({
    mutationFn: async (id: string) => (await apiClient.post(`/admin/applications/${id}/archive`, {})).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'applications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setConfirmingId(null);
      showToast('申請をアーカイブしました');
    },
    onError: (err: any) => showToast(`アーカイブ失敗: ${err.message}`, 'error'),
  });

  const unarchiveApp = useMutation({
    mutationFn: async (id: string) => (await apiClient.post(`/admin/applications/${id}/unarchive`, {})).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'applications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      showToast('アーカイブを解除しました');
    },
    onError: (err: any) => showToast(`解除失敗: ${err.message}`, 'error'),
  });

  const deleteApp = useMutation({
    mutationFn: async (app: AppRecord) => {
      const confirm = encodeURIComponent(app.application_number ?? app.id);
      return (await apiClient.delete(`/admin/applications/${app.id}?hard=true&confirm=${confirm}`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'applications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setConfirmingDeleteId(null);
      showToast('アーカイブ済み申請を削除しました');
    },
    onError: (err: any) => showToast(`削除失敗: ${err.message}`, 'error'),
  });

  // Language-aware status labels (reuses status_* keys already in i18n)
  const statusLabels: Record<string, string> = {
    PENDING_APPROVAL:    t('status_pending'),
    APPROVED:            t('status_approved'),
    REJECTED:            t('status_rejected'),
    RETURNED:            t('status_returned'),
    DRAFT:               t('status_draft'),
    CANCELLED:           t('status_cancelled'),
    COMPLETED:           t('status_completed'),
    PENDING_SETTLEMENT:  t('status_pending_settle'),
    SETTLEMENT_APPROVED: t('status_settle_approved'),
  };

  const hasActiveFilter = !!(search || deptFilter || statusFilter || archiveFilter !== 'active');

  return (
    <div className="space-y-5">
      {/* Admin detail modal — rendered via portal, shows full app data */}
      {openAppId && (
        <AdminAppDetailModal appId={openAppId} onClose={() => setOpenAppId(null)} />
      )}

      {/* Filters — full-width on mobile */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <input
          className="input w-full sm:w-auto sm:max-w-xs"
          placeholder={t('admin_apps_search_ph')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <CustomSelect
          className="w-full sm:w-40"
          options={[
            { value: '', label: t('admin_filter_all_dept') },
            ...departments.map((d) => ({ value: d.name, label: d.name })),
          ]}
          value={deptFilter}
          onChange={setDeptFilter}
        />
        <CustomSelect
          className="w-full sm:w-36"
          options={[
            { value: '', label: t('admin_filter_all_status') },
            ...Object.entries(statusLabels).map(([k, v]) => ({ value: k, label: v })),
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <CustomSelect
          className="w-full sm:w-36"
          options={[
            { value: 'active', label: '通常' },
            { value: 'archived', label: 'アーカイブ' },
            { value: 'all', label: '全て' },
          ]}
          value={archiveFilter}
          onChange={(v) => setArchiveFilter(v as 'active' | 'archived' | 'all')}
        />
        <span className="text-sm text-warmgray-400">
          {apps.length}{hasNextPage ? '+' : ''} {t('admin_apps_count')}
        </span>
        {hasActiveFilter && (
          <button
            className="text-xs text-ringo-500 hover:text-ringo-700 font-semibold"
            onClick={() => { setSearch(''); setDeptFilter(''); setStatusFilter(''); setArchiveFilter('active'); }}
          >
            {t('admin_clear_filter')}
          </button>
        )}
      </div>

      {showLoader ? (
        <div className="card !p-0 md:overflow-hidden">
          <table className="table-base table-responsive">
            <thead>
              <tr>
                <th>{t('admin_col_app_number')}</th>
                <th>{t('admin_field_template')}</th>
                <th>{t('admin_step_approver')}</th>
                <th>{t('admin_field_dept')}</th>
                <th>{t('admin_col_status')}</th>
                <th>{t('admin_col_submitted')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {/* skeleton rows */}
              {[...Array(9)].map((_, i) => (
                <tr key={i}>
                  <td><Sk.Line w="w-20" h="h-2.5" /></td>
                  <td><Sk.Line w={i % 2 === 0 ? 'w-36' : 'w-28'} h="h-3.5" /></td>
                  <td>
                    <div className="space-y-1.5">
                      <Sk.Line w="w-28" h="h-3.5" />
                      <Sk.Line w="w-36" h="h-2.5" />
                    </div>
                  </td>
                  <td><Sk.Line w="w-16" h="h-3" /></td>
                  <td><Sk.Badge w={i % 3 === 0 ? 'w-24' : 'w-20'} /></td>
                  <td><Sk.Line w="w-20" h="h-3" /></td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : isLoading ? null /* loader-delay window — blank, never flash empty table */ : (
        <div className={`card !p-0 md:overflow-hidden transition-opacity duration-200 ${isFetching && !isFetchingNextPage ? 'opacity-60 pointer-events-none' : 'opacity-100'}`}>
          <table className="table-base table-responsive">
            <thead>
              <tr>
                <th>{t('admin_col_app_number')}</th>
                <th>{t('admin_field_template')}</th>
                <th>{t('admin_step_approver')}</th>
                <th>{t('admin_field_dept')}</th>
                <th>{t('admin_col_status')}</th>
                <th>{t('admin_col_submitted')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a, i) => (
                <tr
                  key={a.id}
                  className="animate-fade-up cursor-pointer hover:bg-white/40 transition-colors"
                  style={{ animationDelay: `${Math.min(i, 14) * 35}ms` }}
                  onClick={() => setOpenAppId(a.id)}
                >
                  <td data-label={t('admin_col_app_number')}><span className="font-mono text-[11px] text-warmgray-500">{a.application_number ?? '—'}</span></td>
                  <td data-label={t('admin_field_template')} className="font-semibold text-warmgray-800">{a.template_name}</td>
                  <td data-label={t('admin_step_approver')}>
                    <div className="min-w-0 text-right md:text-left">
                      <p className="text-sm font-medium text-warmgray-800 truncate">{a.applicant_name}</p>
                      <p className="text-[10px] text-warmgray-400 truncate">{a.applicant_email}</p>
                    </div>
                  </td>
                  <td data-label={t('admin_field_dept')} className="text-warmgray-500 text-xs">{a.department_name ?? '—'}</td>
                  <td data-label={t('admin_col_status')}>
                    <div className="flex flex-wrap justify-end md:justify-start gap-1.5">
                      <span className={STATUS_BADGE[a.status] ?? 'badge-draft'}>
                        {statusLabels[a.status] ?? a.status}
                      </span>
                      {a.archived_at && (
                        <span className="badge-draft">アーカイブ</span>
                      )}
                    </div>
                  </td>
                  <td data-label={t('admin_col_submitted')} className="text-[11px] text-warmgray-400">{new Date(a.created_at).toLocaleDateString('ja-JP')}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5 min-w-[148px]">
                      {confirmingId === a.id ? (
                        <div className="inline-flex items-center gap-1.5 rounded-md border border-ringo-200 bg-ringo-50 px-2 py-1">
                          <span className="text-[10px] font-semibold text-ringo-700 whitespace-nowrap">実行?</span>
                          <button
                            type="button"
                            onClick={() => archiveApp.mutate(a.id)}
                            disabled={archiveApp.isPending}
                            className="text-[11px] font-bold text-ringo-700 hover:text-ringo-900 disabled:opacity-50"
                          >
                            はい
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingId(null)}
                            disabled={archiveApp.isPending}
                            className="text-[11px] text-warmgray-400 hover:text-warmgray-600 disabled:opacity-50"
                          >
                            ×
                          </button>
                        </div>
                      ) : a.archived_at ? (
                        <button
                          type="button"
                          onClick={() => unarchiveApp.mutate(a.id)}
                          disabled={unarchiveApp.isPending || deleteApp.isPending}
                          className="inline-flex h-8 items-center rounded-md border border-teal-200 bg-teal-50 px-2.5 text-xs font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50 transition-colors"
                        >
                          解除
                        </button>
                      ) : ARCHIVABLE_STATUSES.has(a.status) ? (
                        <button
                          type="button"
                          onClick={() => setConfirmingId(a.id)}
                          disabled={archiveApp.isPending || deleteApp.isPending}
                          className="inline-flex h-8 items-center rounded-md border border-warmgray-200 bg-white/70 px-2.5 text-xs font-semibold text-warmgray-600 hover:border-ringo-200 hover:bg-ringo-50 hover:text-ringo-700 disabled:opacity-50 transition-colors"
                        >
                          アーカイブ
                        </button>
                      ) : null}
                      {confirmingDeleteId === a.id ? (
                        <div className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1">
                          <span className="text-[10px] font-semibold text-red-700 whitespace-nowrap">削除?</span>
                          <button
                            type="button"
                            onClick={() => deleteApp.mutate(a)}
                            disabled={deleteApp.isPending}
                            className="text-[11px] font-bold text-red-700 hover:text-red-900 disabled:opacity-50"
                          >
                            はい
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(null)}
                            disabled={deleteApp.isPending}
                            className="text-[11px] text-warmgray-400 hover:text-warmgray-600 disabled:opacity-50"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(a.id)}
                          disabled={archiveApp.isPending || deleteApp.isPending}
                          className="inline-flex h-8 items-center rounded-md border border-red-100 bg-white/70 px-2.5 text-xs font-semibold text-red-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 transition-colors"
                        >
                          削除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Sentinel for infinite scroll */}
          <div ref={sentinelRef} className="h-px" />

          {/* Feedback row */}
          {(isFetchingNextPage || (!hasNextPage && apps.length >= PAGE_APPS)) && (
            <div className="px-5 py-3 flex items-center justify-center gap-2 text-warmgray-400 text-xs border-t border-white/20">
              {isFetchingNextPage ? (
                <RingoLoader.Inline />
              ) : (
                <span className="text-warmgray-300">全件表示済み</span>
              )}
            </div>
          )}

          {apps.length === 0 && !isLoading && (
            <div className="py-12 text-center text-warmgray-400 text-sm">{t('admin_no_apps_data')}</div>
          )}
        </div>
      )}
    </div>
  );
}
