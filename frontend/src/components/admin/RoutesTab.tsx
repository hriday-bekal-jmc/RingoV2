import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import apiClient from '../../services/apiClient';
import { ROLE_MAP, type Role } from '../../config/permissions';
import InlineConfirm from '../common/InlineConfirm';
import RingoLoader from '../common/RingoLoader';
import CustomSelect from '../forms/CustomSelect';
import { useLang } from '../../context/LanguageContext';
import UserAvatar from '../common/UserAvatar';
import { RoleBadge } from './RoleBadge';
import type { User, Department, ApprovalRoute, Template } from './adminTypes';

const ROLES = [
  'SHITSUCHO', 'GM', 'SENIOR_MANAGER', 'MANAGER', 'SUB_MANAGER',
  'SUB_MANAGER_TSUKI', 'LEADER', 'SUB_LEADER', 'CHIEF', 'MEMBER',
  'SENMU', 'PRESIDENT',
];

// ─── Approver Picker ─────────────────────────────────────────────────────────

interface ApproverPickerProps {
  users: User[];
  departments: Department[];
  /** Ordered list of selected approver IDs — selection order = step order. */
  value: string[];
  onChange: (ids: string[]) => void;
}

function ApproverPicker({ users, departments, value, onChange }: ApproverPickerProps) {
  const { t, lang } = useLang();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  // Toggle a user: append to the end if new (preserves click order), remove otherwise.
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  // Selected users in selection order (for the ordered summary list).
  const selectedUsers = value
    .map((id) => users.find((u) => u.id === id))
    .filter(Boolean) as User[];

  const filtered = users.filter((u) => {
    if (!u.is_active) return false;
    if (search && !u.full_name.toLowerCase().includes(search.toLowerCase()) &&
        !(u.department_name ?? '').toLowerCase().includes(search.toLowerCase())) return false;
    if (deptFilter && u.department_id !== deptFilter) return false;
    if (roleFilter && u.role !== roleFilter) return false;
    return true;
  });

  return (
    <div className="space-y-2.5">
      {/* Search + filters row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[140px]">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-warmgray-400 pointer-events-none"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 104.5 4.5a7.5 7.5 0 0012.15 12.15z" />
          </svg>
          <input
            className="input pl-8 text-xs py-1.5"
            placeholder={lang === 'en' ? 'Search by name…' : '名前で検索…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <CustomSelect
          className="w-36"
          options={[
            { value: '', label: t('admin_filter_all_dept') },
            ...departments.map((d) => ({ value: d.id, label: d.name })),
          ]}
          value={deptFilter}
          onChange={setDeptFilter}
        />
        <CustomSelect
          className="w-32"
          options={[
            { value: '', label: t('admin_filter_all_role') },
            ...ROLES.map((r) => ({ value: r, label: ROLE_MAP[r as Role]?.label ?? r })),
          ]}
          value={roleFilter}
          onChange={setRoleFilter}
        />
        <span className="text-[11px] text-warmgray-400 shrink-0">{filtered.length} {t('admin_users_count')}</span>
      </div>

      {/* Tile grid */}
      <div className="max-h-56 overflow-y-auto dropdown-scroll rounded-xl">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-warmgray-400">
            <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
            <p className="text-xs">{t('admin_no_users')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 p-0.5">
            {filtered.map((u) => {
              const order = value.indexOf(u.id);
              const isSelected = order !== -1;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggle(u.id)}
                  className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl text-center
                    transition-all duration-150 border
                    ${isSelected
                      ? 'border-ringo-400/70 bg-ringo-50/80 shadow-[0_0_0_2px_rgba(154,46,34,0.18)] scale-[1.02]'
                      : 'border-warmgray-200/50 bg-white/50 hover:bg-white/80 hover:border-warmgray-300/60 hover:scale-[1.01]'
                    }`}
                >
                  {/* Selection order badge — the number = its position in the route */}
                  {isSelected && (
                    <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-ringo-500 flex items-center justify-center shadow-sm text-white text-[10px] font-bold tabular-nums">
                      {order + 1}
                    </span>
                  )}

                  <UserAvatar name={u.full_name} avatarUrl={u.avatar_url} size={9} />

                  <div className="w-full min-w-0 space-y-0.5">
                    <p className={`text-xs font-semibold truncate leading-tight ${isSelected ? 'text-ringo-700' : 'text-warmgray-800'}`}>
                      {u.full_name}
                    </p>
                    {u.department_name && (
                      <p className="text-[10px] text-warmgray-400 truncate">{u.department_name}</p>
                    )}
                    <div className="flex justify-center">
                      <RoleBadge role={u.role} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected summary — ordered list. Position = step order in the route. */}
      {selectedUsers.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-0.5">
            <p className="text-[11px] font-bold text-warmgray-500 uppercase tracking-wide">
              {lang === 'en'
                ? `${selectedUsers.length} selected — added in this order`
                : `${selectedUsers.length}名選択 — この順で追加されます`}
            </p>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[11px] text-warmgray-400 hover:text-ringo-600 transition-colors"
            >
              {lang === 'en' ? 'Clear all' : 'すべて解除'}
            </button>
          </div>
          {selectedUsers.map((su, i) => (
            <div key={su.id} className="flex items-center gap-2.5 px-3 py-2 bg-ringo-50/60 rounded-xl border border-ringo-200/50">
              <span className="w-5 h-5 rounded-full bg-ringo-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0 tabular-nums">
                {i + 1}
              </span>
              <UserAvatar name={su.full_name} avatarUrl={su.avatar_url} size={6} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-ringo-700 truncate">{su.full_name}</p>
                <p className="text-[10px] text-warmgray-500 truncate">{su.department_name ?? '—'}</p>
              </div>
              <RoleBadge role={su.role} />
              {/* Reorder up/down */}
              <div className="flex flex-col">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => {
                    const next = [...value];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    onChange(next);
                  }}
                  className="text-warmgray-400 hover:text-ringo-600 disabled:opacity-25 disabled:hover:text-warmgray-400 transition-colors"
                  title={lang === 'en' ? 'Move up' : '上へ'}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                  </svg>
                </button>
                <button
                  type="button"
                  disabled={i === selectedUsers.length - 1}
                  onClick={() => {
                    const next = [...value];
                    [next[i + 1], next[i]] = [next[i], next[i + 1]];
                    onChange(next);
                  }}
                  className="text-warmgray-400 hover:text-ringo-600 disabled:opacity-25 disabled:hover:text-warmgray-400 transition-colors"
                  title={lang === 'en' ? 'Move down' : '下へ'}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
              </div>
              <button
                type="button"
                onClick={() => toggle(su.id)}
                className="text-warmgray-400 hover:text-warmgray-600 transition-colors"
                title={lang === 'en' ? 'Remove' : '削除'}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Chain Arrow ─────────────────────────────────────────────────────────────

function ChainArrow() {
  // Rotate 90° on mobile so the chain reads top-down. On md+ stays horizontal.
  return (
    <svg
      className="w-4 h-4 text-warmgray-300 shrink-0 rotate-90 md:rotate-0"
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

// ─── Routes Tab ───────────────────────────────────────────────────────────────

export function RoutesTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const queryClient = useQueryClient();
  const { lang, t } = useLang();
  const [addingStepToRoute, setAddingStepToRoute] = useState<string | null>(null);
  const [insertAfterOrder, setInsertAfterOrder] = useState<number | null>(null);
  const [newStep, setNewStep] = useState<{ approver_ids: string[]; label: string; action_type: string }>({ approver_ids: [], label: '', action_type: 'APPROVE' });
  const [showNewRoute, setShowNewRoute] = useState(false);
  const [newRoute, setNewRoute] = useState({ template_id: '', department_id: '', name: '', stage: 'RINGI' });
  // Inline confirm — track id of the row currently in confirm state
  const [confirmingRouteId, setConfirmingRouteId] = useState<string | null>(null);
  const [confirmingStepId,  setConfirmingStepId]  = useState<string | null>(null);
  const [expandedRouteSteps, setExpandedRouteSteps] = useState<Set<string>>(new Set());
  const MOBILE_STEP_COLLAPSE = 4;
  const [routeDeptFilter, setRouteDeptFilter] = useState('');
  const [routeTemplateFilter, setRouteTemplateFilter] = useState('');
  const [routeStageFilter, setRouteStageFilter] = useState('');

  const { data: routes = [], isLoading } = useQuery<ApprovalRoute[]>({
    queryKey: ['admin', 'routes'],
    queryFn:  async () => (await apiClient.get('/admin/routes')).data,
    staleTime: 5 * 60_000,
  });

  const showLoader = useDelayedLoading(isLoading);

  // Shared cache w/ UsersTab — same key = single fetch across tabs
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['admin', 'users'],
    queryFn:  async () => (await apiClient.get('/admin/users')).data,
    staleTime: 5 * 60_000,
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['admin', 'departments'],
    queryFn:  async () => (await apiClient.get('/admin/departments')).data,
    staleTime: 10 * 60_000,
  });

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['admin', 'templates'],
    queryFn:  async () => (await apiClient.get('/admin/templates')).data,
    staleTime: 10 * 60_000,
  });

  const refetch = () => queryClient.invalidateQueries({ queryKey: ['admin', 'routes'] });

  const addStep = useMutation({
    // Adds one step per selected approver, IN SELECTION ORDER. Posts run
    // sequentially (not Promise.all) so step_order is deterministic:
    //  - append mode: each lands at MAX+1 → preserves order
    //  - insert_after mode: bump the anchor by 1 each iteration so the batch
    //    keeps its order right after the insertion point
    mutationFn: async ({ routeId, approver_ids, label, action_type, insert_after }:
      { routeId: string; approver_ids: string[]; label: string; action_type: string; insert_after?: number }) => {
      let anchor = insert_after;
      for (const approver_id of approver_ids) {
        const body = anchor !== undefined
          ? { approver_id, label, action_type, insert_after: anchor }
          : { approver_id, label, action_type };
        await apiClient.post(`/admin/routes/${routeId}/steps`, body);
        if (anchor !== undefined) anchor += 1;
      }
    },
    onSuccess: (_d, vars) => {
      refetch();
      setAddingStepToRoute(null);
      setInsertAfterOrder(null);
      setNewStep({ approver_ids: [], label: '', action_type: 'APPROVE' });
      showToast(vars.approver_ids.length > 1 ? `${vars.approver_ids.length}件のステップを追加しました` : 'ステップを追加しました');
    },
    onError: (err: any) => showToast(`ステップ追加失敗: ${err.message}`, 'error'),
  });

  const deleteStep = useMutation({
    mutationFn: async (stepId: string) => (await apiClient.delete(`/admin/route-steps/${stepId}`)).data,
    onSuccess: () => { refetch(); setConfirmingStepId(null); showToast('ステップを削除しました'); },
    onError: (err: any) => showToast(`削除失敗: ${err.message}`, 'error'),
  });

  const createRoute = useMutation({
    mutationFn: async (route: typeof newRoute) => (await apiClient.post('/admin/routes', route)).data,
    onSuccess: () => {
      refetch();
      setShowNewRoute(false);
      setNewRoute({ template_id: '', department_id: '', name: '', stage: 'RINGI' });
      showToast('ルートを作成しました');
    },
    onError: (err: any) => showToast(`ルート作成失敗: ${err.message}`, 'error'),
  });

  const deleteRoute = useMutation({
    mutationFn: async (id: string) => (await apiClient.delete(`/admin/routes/${id}`)).data,
    onSuccess: () => { refetch(); setConfirmingRouteId(null); showToast('ルートを削除しました'); },
    onError: (err: any) => showToast(`削除失敗: ${err.message}`, 'error'),
  });

  const filteredRoutes = routes.filter((r) => {
    if (routeDeptFilter && r.department_id !== routeDeptFilter) return false;
    if (routeTemplateFilter && r.template_id !== routeTemplateFilter) return false;
    if (routeStageFilter && r.stage !== routeStageFilter) return false;
    return true;
  });

  if (showLoader) return <RingoLoader.Block label="読み込み中..." />;
  if (isLoading) return null; // loader-delay window — blank, never flash empty UI while fetching

  return (
    <div className="space-y-4">
      {/* No modal dialogs — delete confirmations are inline on the row itself */}

      {/* Route filters */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <CustomSelect
          className="w-full sm:w-40"
          options={[
            { value: '', label: t('admin_filter_all_dept') },
            ...departments.map((d) => ({ value: d.id, label: d.name })),
          ]}
          value={routeDeptFilter}
          onChange={setRouteDeptFilter}
        />
        <CustomSelect
          className="w-full sm:w-44"
          options={[
            { value: '', label: t('admin_filter_all_form') },
            ...templates.map((tmpl) => ({ value: tmpl.id, label: tmpl.title_ja })),
          ]}
          value={routeTemplateFilter}
          onChange={setRouteTemplateFilter}
        />
        <div className="flex rounded-xl overflow-hidden border border-white/70 w-full sm:w-auto">
          {([
            { v: '', label: t('admin_stage_all') },
            { v: 'RINGI', label: t('admin_stage_ringi') },
            { v: 'SETTLEMENT', label: t('admin_stage_settle') },
          ]).map(({ v, label }) => (
            <button key={v} onClick={() => setRouteStageFilter(v)}
              className={`flex-1 sm:flex-initial px-3 py-1.5 text-xs font-semibold transition-colors ${routeStageFilter === v ? 'bg-warmgray-800 text-white' : 'bg-white/60 text-warmgray-500 hover:bg-white/90'}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="text-sm text-warmgray-400">{filteredRoutes.length} {t('admin_routes_count')}</span>
        <div className="flex-1 hidden sm:block" />
        <button className="btn-primary w-full sm:w-auto" onClick={() => setShowNewRoute(true)}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {t('admin_add_route')}
        </button>
      </div>

      {/* New route form */}
      {showNewRoute && (
        <div className="card border-2 border-ringo-300/50 space-y-4 animate-scale-in relative z-10">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 rounded-full bg-gradient-to-b from-ringo-400 to-mustard-500" />
            <h4 className="font-bold text-warmgray-800">{t('admin_new_route_title')}</h4>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('admin_field_template')}</label>
              <CustomSelect
                options={[
                  { value: '', label: '選択...' },
                  ...templates.map((tmpl) => ({ value: tmpl.id, label: tmpl.title_ja })),
                ]}
                value={newRoute.template_id}
                onChange={(v) => setNewRoute({ ...newRoute, template_id: v })}
              />
            </div>
            <div>
              <label className="label">{t('admin_field_dept')}</label>
              <CustomSelect
                options={[
                  { value: '', label: '選択...' },
                  ...departments.map((d) => ({ value: d.id, label: d.name })),
                ]}
                value={newRoute.department_id}
                onChange={(v) => setNewRoute({ ...newRoute, department_id: v })}
              />
            </div>
            <div>
              <label className="label">{t('admin_field_stage')}</label>
              <CustomSelect
                options={[
                  { value: 'RINGI', label: `RINGI — ${t('admin_stage_ringi')}` },
                  { value: 'SETTLEMENT', label: `SETTLEMENT — ${t('admin_stage_settle')}` },
                ]}
                value={newRoute.stage}
                onChange={(v) => setNewRoute({ ...newRoute, stage: v })}
              />
            </div>
            <div>
              <label className="label">{t('admin_field_route_name')}</label>
              <input className="input" placeholder={t('admin_route_name_ph')} value={newRoute.name} onChange={(e) => setNewRoute({ ...newRoute, name: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-ghost" onClick={() => setShowNewRoute(false)}>キャンセル</button>
            <button
              className="btn-primary"
              onClick={() => createRoute.mutate(newRoute)}
              disabled={!newRoute.template_id || !newRoute.department_id || !newRoute.name || createRoute.isPending}
            >
              {createRoute.isPending ? t('admin_creating') : t('btn_save')}
            </button>
          </div>
        </div>
      )}

      {/* Route cards */}
      {filteredRoutes.map((route, i) => (
        <div
          key={route.id}
          className={`card space-y-4 relative animate-fade-up ${addingStepToRoute === route.id ? 'z-10' : ''}`}
          style={{ animationDelay: `${Math.min(i, 10) * 50}ms` }}
        >
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                  route.stage === 'RINGI' ? 'bg-ringo-500 text-white' : 'bg-mustard-500 text-white'
                }`}>
                  {route.stage === 'RINGI' ? `RINGI — ${t('admin_stage_ringi')}` : `SETTLEMENT — ${t('admin_stage_settle')}`}
                </span>
                <h4 className="font-bold text-warmgray-800">{route.name}</h4>
                {!route.is_active && (
                  <span className="text-[10px] text-warmgray-500 bg-surface-100 border border-surface-200 px-2 py-0.5 rounded-full">無効</span>
                )}
              </div>
              <p className="text-[11px] text-warmgray-400">{route.template_name} · {route.department_name}</p>
            </div>
            <InlineConfirm
              isActive={confirmingRouteId === route.id}
              onTrigger={() => setConfirmingRouteId(route.id)}
              onConfirm={() => deleteRoute.mutate(route.id)}
              onCancel={() => setConfirmingRouteId(null)}
              message="ルートを削除？"
              triggerClass="text-[11px] text-warmgray-400 hover:text-red-500 transition-colors font-medium"
              disabled={deleteRoute.isPending}
            />
          </div>

          {/* Visual chain with avatars */}
          <div className="bg-surface-50/60 rounded-2xl p-4">

            {/* ── Compact list (mobile / small screens up to md) ── */}
            {(() => {
              const mobileExpanded = expandedRouteSteps.has(route.id);
              const shouldCollapseMobile = !mobileExpanded && route.steps.length > MOBILE_STEP_COLLAPSE;
              const visibleMobileSteps = shouldCollapseMobile ? route.steps.slice(0, MOBILE_STEP_COLLAPSE) : route.steps;
              const hiddenMobileCount = shouldCollapseMobile ? route.steps.length - MOBILE_STEP_COLLAPSE : 0;
              return (
                <div className="md:hidden space-y-0.5">
                  {/* Origin row */}
                  <div className="flex items-center gap-2.5 px-2 py-1.5">
                    <span className="w-6 h-6 rounded-full bg-surface-200 border-2 border-surface-300 flex items-center justify-center text-[10px] font-black text-warmgray-600 shrink-0">申</span>
                    <span className="text-xs text-warmgray-400">{lang === 'en' ? 'Applicant' : '申請者'}</span>
                  </div>
                  {route.steps.length === 0 ? (
                    <p className="text-xs text-warmgray-400 italic px-2 py-1">{t('admin_no_steps')}</p>
                  ) : (
                    visibleMobileSteps.map((step, stepIdx) => {
                      const prevOrder = stepIdx === 0 ? 0 : route.steps[stepIdx - 1].step_order;
                      return (
                        <div key={step.id}>
                          {/* Insert-before row */}
                          <div className="flex items-center gap-2 pl-3.5 py-0.5 group/insert">
                            <div className="w-px h-3 bg-surface-300 mx-1.5" />
                            <button
                              className="hidden group-hover/insert:flex text-[9px] text-ringo-500 font-bold items-center gap-0.5"
                              onClick={() => { setAddingStepToRoute(route.id); setInsertAfterOrder(prevOrder); }}
                            >＋ 挿入</button>
                          </div>
                          {/* Step row */}
                          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg group/step">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 ${
                              step.action_type === 'CONFIRM' ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-200' : 'bg-ringo-100 text-ringo-600 ring-1 ring-ringo-200'
                            }`}>{stepIdx + 1}</span>
                            <UserAvatar name={step.approver_name ?? String(step.step_order)} avatarUrl={step.approver_avatar} size={6} className="shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-warmgray-700 truncate">{step.approver_name ?? '(未割当)'}</p>
                              {step.label && <p className="text-[9px] text-warmgray-400 truncate">{step.label}</p>}
                            </div>
                            {step.action_type === 'CONFIRM' && (
                              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 ring-1 ring-amber-200/60 shrink-0">確認</span>
                            )}
                            {confirmingStepId === step.id ? (
                              <button
                                className="px-1.5 h-5 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center shadow-md ring-2 ring-white animate-scale-in shrink-0"
                                onClick={() => deleteStep.mutate(step.id)}
                                onBlur={() => setConfirmingStepId(null)}
                                autoFocus
                              >削除？</button>
                            ) : (
                              <button
                                className="w-5 h-5 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center shrink-0"
                                onClick={() => setConfirmingStepId(step.id)}
                              >×</button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  {/* Collapse/expand toggle */}
                  {hiddenMobileCount > 0 && (
                    <button
                      className="ml-8 text-[10px] text-ringo-400 hover:text-ringo-600 font-semibold transition-colors py-1"
                      onClick={() => setExpandedRouteSteps(prev => { const s = new Set(prev); s.add(route.id); return s; })}
                    >+ {hiddenMobileCount} ステップを表示</button>
                  )}
                  {mobileExpanded && route.steps.length > MOBILE_STEP_COLLAPSE && (
                    <button
                      className="ml-8 text-[10px] text-ringo-400 hover:text-ringo-600 font-semibold transition-colors py-1"
                      onClick={() => setExpandedRouteSteps(prev => { const s = new Set(prev); s.delete(route.id); return s; })}
                    >▲ 折りたたむ</button>
                  )}
                  {/* End row */}
                  <div className="flex items-center gap-2 pl-3.5 py-0.5">
                    <div className="w-px h-3 bg-surface-300 mx-1.5" />
                  </div>
                  <div className="flex items-center gap-2.5 px-2 py-1.5">
                    <span className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[10px] shrink-0">✓</span>
                    <span className="text-xs text-warmgray-400">{t('admin_done_node')}</span>
                  </div>
                </div>
              );
            })()}

            {/* ── Wide visual chain (md+) ── */}
            <div className="hidden md:flex md:items-center gap-3 md:flex-wrap">
              {/* Applicant node */}
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-10 h-10 rounded-full bg-surface-200 border-2 border-surface-300 flex items-center justify-center text-sm font-bold text-warmgray-600">申</div>
                <span className="text-[10px] text-warmgray-400">{lang === 'en' ? 'Applicant' : '申請者'}</span>
              </div>

              {route.steps.length === 0 ? (
                <p className="text-xs text-warmgray-400 italic ml-2">{t('admin_no_steps')}</p>
              ) : (
                route.steps.map((step, stepIdx) => {
                  const prevOrder = stepIdx === 0 ? 0 : route.steps[stepIdx - 1].step_order;
                  return (
                  <div key={step.id} className="flex items-center gap-3">
                    {/* Insert-before arrow — shows + badge on hover */}
                    <div className="relative group/insert flex items-center justify-center shrink-0">
                      <ChainArrow />
                      <button
                        className="absolute hidden group-hover/insert:flex w-4 h-4 rounded-full bg-ringo-500 text-white text-[9px] items-center justify-center shadow-md hover:bg-ringo-600 transition-colors z-10 font-bold"
                        onClick={() => { setAddingStepToRoute(route.id); setInsertAfterOrder(prevOrder); }}
                        title="ここにステップを挿入"
                      >+</button>
                    </div>
                    <div className="flex flex-col items-center gap-1 group/step relative">
                      <div className="relative">
                        <UserAvatar
                          name={step.approver_name ?? String(step.step_order)}
                          avatarUrl={step.approver_avatar}
                          size={10}
                          className="shadow-sm"
                        />
                        {confirmingStepId === step.id ? (
                            <button
                              className="absolute -top-1.5 -right-1.5 px-1.5 h-4 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center shadow-md ring-2 ring-white animate-scale-in"
                              onClick={() => deleteStep.mutate(step.id)}
                              onBlur={() => setConfirmingStepId(null)}
                              autoFocus
                              title="もう一度クリックで削除"
                            >
                              削除？
                            </button>
                          ) : (
                            <button
                              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] hidden group-hover/step:flex items-center justify-center shadow-sm"
                              onClick={() => setConfirmingStepId(step.id)}
                              title="削除"
                            >
                              ×
                            </button>
                          )
                        }
                      </div>
                      <div className="text-center max-w-[72px]">
                        <p className="text-[10px] font-semibold text-warmgray-700 leading-tight truncate">
                          {step.approver_name ?? '(未割当)'}
                        </p>
                        <p className="text-[9px] text-warmgray-400">{step.label}</p>
                        {step.action_type === 'CONFIRM' && (
                          <span className="mt-1 inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[8px] font-bold ring-1 ring-amber-200/60 leading-none">
                            確認
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  );
                })
              )}

              {/* End node */}
              <div className="flex items-center gap-3">
                <ChainArrow />
                <div className="flex flex-col items-center gap-1.5">
                  <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-white text-sm shadow-sm">✓</div>
                  <span className="text-[10px] text-warmgray-400">{t('admin_done_node')}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Add step */}
          {addingStepToRoute === route.id ? (
            <div className="bg-surface-50/60 rounded-2xl p-4 space-y-4 border-2 border-dashed border-ringo-200">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 rounded-full bg-gradient-to-b from-ringo-400 to-mustard-500" />
                <p className="text-xs font-bold text-warmgray-700 uppercase tracking-wide">{t('admin_step_form_title')}</p>
              </div>

              {/* Approver picker — full width */}
              <div>
                <label className="label">{t('admin_step_approver')}</label>
                <ApproverPicker
                  users={users}
                  departments={departments}
                  value={newStep.approver_ids}
                  onChange={(ids) => setNewStep({ ...newStep, approver_ids: ids })}
                />
              </div>

              {/* Step name + action — 2 columns */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('admin_step_label')}</label>
                  <input
                    className="input"
                    placeholder={t('admin_step_label_ph')}
                    value={newStep.label}
                    onChange={(e) => setNewStep({ ...newStep, label: e.target.value })}
                  />
                  {newStep.approver_ids.length > 1 && (
                    <p className="text-[10px] text-warmgray-400 mt-1">
                      {newStep.label
                        ? (lang === 'en' ? 'Applied to all added steps.' : '追加する全ステップに適用されます。')
                        : (lang === 'en' ? 'Left blank → auto-numbered per step.' : '空欄の場合、各ステップに自動採番されます。')}
                    </p>
                  )}
                </div>
                <div>
                  <label className="label">{t('admin_step_action')}</label>
                  <CustomSelect
                    options={[
                      { value: 'APPROVE', label: lang === 'en' ? 'Approve (can reject/return)' : '承認（差戻・却下あり）' },
                      { value: 'CONFIRM', label: lang === 'en' ? 'Confirm (acknowledgment only)' : '確認のみ（差戻・却下なし）' },
                    ]}
                    value={newStep.action_type}
                    onChange={(v) => setNewStep({ ...newStep, action_type: v })}
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-1">
                <button className="btn-ghost text-xs" onClick={() => { setAddingStepToRoute(null); setInsertAfterOrder(null); }}>{t('btn_cancel')}</button>
                <button
                  className="btn-primary text-xs"
                  disabled={newStep.approver_ids.length === 0 || addStep.isPending}
                  onClick={() => addStep.mutate({
                    routeId: route.id,
                    ...newStep,
                    ...(insertAfterOrder !== null ? { insert_after: insertAfterOrder } : {}),
                  })}
                >
                  {addStep.isPending
                    ? t('admin_adding')
                    : newStep.approver_ids.length > 1
                      ? (lang === 'en' ? `Add ${newStep.approver_ids.length} steps` : `${newStep.approver_ids.length}件を追加`)
                      : t('admin_step_form_title')}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="w-full py-2 text-xs font-semibold text-warmgray-400 hover:text-ringo-600 hover:bg-ringo-50/50 rounded-xl transition-all duration-150 border border-dashed border-warmgray-200 hover:border-ringo-200 flex items-center justify-center gap-1"
              onClick={() => { setAddingStepToRoute(route.id); setInsertAfterOrder(null); }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {t('admin_add_step_btn')}
            </button>
          )}
        </div>
      ))}

      {filteredRoutes.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-20 gap-4 text-warmgray-400">
          <span className="text-5xl">🗂️</span>
          <p className="text-sm">{t('admin_no_routes')}</p>
        </div>
      )}
    </div>
  );
}
