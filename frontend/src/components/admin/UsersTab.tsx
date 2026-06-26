import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import { useScrollLock } from '../../hooks/useScrollLock';
import apiClient from '../../services/apiClient';
import { ROLE_MAP, type Role } from '../../config/permissions';
import { useAssignableRoles } from '../../hooks/useRoles';
import InlineConfirm from '../common/InlineConfirm';
import RingoLoader from '../common/RingoLoader';
import CustomSelect from '../forms/CustomSelect';
import { useLang } from '../../context/LanguageContext';
import UserAvatar from '../common/UserAvatar';
import { RoleBadge } from './RoleBadge';
import type { User, Department } from './adminTypes';

const ROLES = [
  'SHITSUCHO', 'GM', 'SENIOR_MANAGER', 'MANAGER', 'SUB_MANAGER',
  'SUB_MANAGER_TSUKI', 'LEADER', 'SUB_LEADER', 'CHIEF', 'MEMBER',
  'SENMU', 'PRESIDENT',
];

// ─── User Edit Modal ──────────────────────────────────────────────────────────

interface UserModalProps {
  user?: User;
  departments: Department[];
  onClose: () => void;
  onSave: (data: Record<string, any>) => void;
  isSaving: boolean;
}

function UserModal({ user, departments, onClose, onSave, isSaving }: UserModalProps) {
  const isNew = !user;
  const { t, lang } = useLang();
  const { data: assignableRoles = [] } = useAssignableRoles();
  const roleOptions = (assignableRoles.length > 0
    ? assignableRoles
    : ROLES.map((r) => ({ code: r, label_ja: (ROLE_MAP as any)[r]?.label ?? r, label_en: (ROLE_MAP as any)[r]?.label_en ?? r }))
  ).map((r: any) => ({ value: r.code ?? r, label: lang === 'en' ? (r.label_en ?? r.label_ja ?? r) : (r.label_ja ?? r) }));

  // Per-user capability overrides
  const [capOverrides, setCapOverrides] = useState<string[]>([]);
  const { data: existingOverrides } = useQuery<{ capability: string }[]>({
    queryKey: ['admin', 'user-overrides', user?.id],
    queryFn: async () => (await apiClient.get(`/admin/users/${user!.id}/capability-overrides`)).data,
    enabled: !isNew && !!user?.id,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (existingOverrides) setCapOverrides(existingOverrides.map((o) => o.capability));
  }, [existingOverrides]);
  const toggleCap = (cap: string) =>
    setCapOverrides((prev) => prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]);

  // Lock page scroll while this modal is open — same reason as ConfirmDialog
  useScrollLock(true);
  const [form, setForm] = useState({
    full_name:         user?.full_name ?? '',
    email:             user?.email ?? '',
    password:          '',
    role:              user?.role ?? 'MEMBER',
    is_admin:          user?.is_admin ?? false,
    department_id:     user?.department_id ?? '',
    is_active:         user?.is_active ?? true,
    gchat_webhook_url: user?.gchat_webhook_url ?? '',
    notify_email:      user?.notify_email      ?? true,
    notify_gchat:      user?.notify_gchat      ?? false,
  });

  const set = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));

  const handleSave = () => {
    const payload: Record<string, any> = { ...form, department_id: form.department_id || null, cap_overrides: capOverrides };
    if (!payload.password) delete payload.password;
    onSave(payload);
  };

  // Portal to document.body so the modal escapes any parent's stacking/
  // containing-block context (.glass uses backdrop-filter which would
  // otherwise make `fixed inset-0` resolve against the nearest glass parent
  // instead of the viewport — causing offset placement + no proper scroll).
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-warmgray-900/50 backdrop-blur-sm px-3 md:px-4 overflow-y-auto [scrollbar-gutter:stable] py-6">
      <div className="glass rounded-3xl w-full max-w-lg p-5 md:p-8 space-y-5 shadow-2xl animate-scale-in my-auto">
        <div className="flex items-center gap-3">
          {!isNew && <UserAvatar name={form.full_name || '?'} avatarUrl={user?.avatar_url} size={10} />}
          <div>
            <h3 className="text-lg font-bold text-warmgray-800">
              {isNew ? t('admin_create_user') : t('admin_edit_user')}
            </h3>
            {!isNew && <p className="text-xs text-warmgray-400">{user?.email}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">{t('admin_field_name')} *</label>
            <input className="input" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="label">{t('admin_field_email')} *</label>
            <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="label">{isNew ? t('admin_field_password') : t('admin_field_password_chg')}</label>
            <input className="input" type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="••••••••" />
          </div>
          <div>
            <label className="label">{t('admin_field_role')}</label>
            <CustomSelect
              options={roleOptions}
              value={form.role}
              onChange={(v) => set('role', v)}
            />
          </div>
          <div>
            <label className="label">{t('admin_field_dept')}</label>
            <CustomSelect
              options={[
                { value: '', label: t('admin_unset') },
                ...departments.map((d) => ({ value: d.id, label: d.name })),
              ]}
              value={form.department_id}
              onChange={(v) => set('department_id', v)}
            />
          </div>
          <div className="col-span-2 flex items-center justify-between gap-4 bg-white/60 border border-white/70 rounded-xl px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-warmgray-800">Admin access</p>
              <p className="text-xs text-warmgray-400">Keeps normal role, adds admin panel permissions.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.is_admin}
              onClick={() => set('is_admin', !form.is_admin)}
              className={`relative h-6 w-11 rounded-full transition-colors ${form.is_admin ? 'bg-ringo-500' : 'bg-warmgray-300'}`}
            >
              <span
                className={`absolute top-[3px] left-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 ${form.is_admin ? 'translate-x-[20px]' : 'translate-x-0'}`}
              />
            </button>
          </div>
          {!isNew && (
            <div className="col-span-2 flex items-center gap-3 bg-surface-100/50 rounded-xl px-4 py-3">
              <input
                type="checkbox"
                id="is_active"
                checked={form.is_active}
                onChange={(e) => set('is_active', e.target.checked)}
                className="w-4 h-4 accent-ringo-500"
              />
              <label htmlFor="is_active" className="text-sm font-medium text-warmgray-700">{t('admin_field_active')}</label>
            </div>
          )}
          {/* Notification settings */}
          <div className="col-span-2 space-y-2">
            <p className="text-xs font-semibold text-warmgray-500 uppercase tracking-wider">
              {lang === 'ja' ? '通知設定' : 'Notifications'}
            </p>
            <div>
              <label className="label text-xs">{lang === 'ja' ? 'Google Chat Webhook URL' : 'Google Chat Webhook URL'}</label>
              <input
                className="input text-xs"
                type="url"
                value={form.gchat_webhook_url ?? ''}
                onChange={(e) => set('gchat_webhook_url', e.target.value)}
                placeholder="https://chat.googleapis.com/v1/spaces/..."
              />
              {form.gchat_webhook_url && !form.gchat_webhook_url.startsWith('https://chat.googleapis.com/') && (
                <p className="text-[11px] text-red-500 mt-0.5">{lang === 'ja' ? '無効なURLです' : 'Invalid URL'}</p>
              )}
            </div>
            <div className="flex gap-4">
              {(['notify_email', 'notify_gchat'] as const).map((field) => (
                <label key={field} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(form[field] ?? (field === 'notify_email'))}
                    onChange={(e) => set(field, e.target.checked)}
                    className="w-4 h-4 accent-ringo-500"
                  />
                  <span className="text-xs text-warmgray-700">
                    {field === 'notify_email'
                      ? (lang === 'ja' ? 'メール通知' : 'Email')
                      : (lang === 'ja' ? 'Google Chat通知' : 'Google Chat')}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Additional access — per-user capability overrides (edit only) */}
        {!isNew && (
          <div className="border-t border-white/30 pt-4">
            <p className="text-xs font-bold uppercase tracking-widest text-warmgray-500 mb-3">
              {lang === 'en' ? 'Additional Access' : '追加アクセス権限'}
            </p>
            <p className="text-[11px] text-warmgray-400 mb-3">
              {lang === 'en'
                ? 'Grant specific capabilities beyond this user\'s role. Additive only.'
                : 'ロール以外に個別で付与する権限です。役職変更は不要です。'}
            </p>
            <div className="space-y-2">
              {([
                { cap: 'can_approve', labelJa: '承認権限（承認・差し戻し・却下）', labelEn: 'Approval (approve / return / reject)' },
                { cap: 'can_settle',  labelJa: '精算管理アクセス',                  labelEn: 'Accounting / Settlement access' },
                { cap: 'can_admin',   labelJa: '管理者パネルアクセス',              labelEn: 'Admin panel access' },
              ] as const).map(({ cap, labelJa, labelEn }) => (
                <label key={cap} className="flex items-center gap-3 cursor-pointer select-none group">
                  <div
                    onClick={() => toggleCap(cap)}
                    className={`w-9 h-5 rounded-full transition-colors duration-200 flex items-center px-0.5 ${capOverrides.includes(cap) ? 'bg-ringo-500' : 'bg-warmgray-200'}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${capOverrides.includes(cap) ? 'translate-x-4' : 'translate-x-0'}`} />
                  </div>
                  <span className={`text-xs font-medium transition-colors ${capOverrides.includes(cap) ? 'text-ringo-700' : 'text-warmgray-600'}`}>
                    {lang === 'en' ? labelEn : labelJa}
                  </span>
                  {capOverrides.includes(cap) && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-ringo-50 text-ringo-600 border border-ringo-200/60">
                      {lang === 'en' ? 'GRANTED' : '付与済み'}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button className="btn-outline" onClick={onClose}>{t('btn_cancel')}</button>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={isSaving || !form.full_name || !form.email}
          >
            {isSaving ? t('admin_saving') : t('btn_save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

export default function UsersTab({ showToast, onGoToSlots }: {
  showToast: (m: string, t?: 'success' | 'error' | 'info') => void;
  onGoToSlots: () => void;
}) {
  const queryClient = useQueryClient();
  const { t } = useLang();
  const [editUser, setEditUser] = useState<User | null | 'new'>(null);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  // Inline confirm — only one row can be in confirm state at a time
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [routeConflict, setRouteConflict] = useState<{
    userId: string;
    routes?: { id: string; name: string }[];
    pending_steps?: { application_number: string; label: string; stage: string }[];
    slot_assignments?: { owner_name: string; slot_label: string }[];
  } | null>(null);
  const [replaceToId, setReplaceToId] = useState<string>('__null__');
  const [replacing, setReplacing] = useState(false);

  // Admin reference data — changes rarely (few times/month). Cache aggressively.
  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['admin', 'users'],
    queryFn:  async () => (await apiClient.get('/admin/users')).data,
    staleTime: 5 * 60_000,
    gcTime:    10 * 60_000,
  });

  const showLoader = useDelayedLoading(isLoading);

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['admin', 'departments'],
    queryFn:  async () => (await apiClient.get('/admin/departments')).data,
    staleTime: 10 * 60_000,
    gcTime:    15 * 60_000,
  });

  const createUser = useMutation({
    mutationFn: async (data: Record<string, any>) => (await apiClient.post('/admin/users', data)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setEditUser(null);
      showToast('ユーザーを作成しました');
    },
    onError: (err: any) => showToast(`作成失敗: ${err.message}`, 'error'),
  });

  const updateUser = useMutation({
    mutationFn: async ({ id, notify_email, notify_gchat, gchat_webhook_url, cap_overrides, ...patch }: { id: string } & Record<string, any>) => {
      await Promise.all([
        apiClient.patch(`/admin/users/${id}`, patch),
        apiClient.patch(`/admin/users/${id}/notifications`, { notify_email, notify_gchat, gchat_webhook_url: gchat_webhook_url || null }),
        apiClient.put(`/admin/users/${id}/capability-overrides`, { capabilities: cap_overrides ?? [] }),
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setEditUser(null);
      showToast('ユーザーを更新しました');
    },
    onError: (err: any) => showToast(`更新失敗: ${err.message}`, 'error'),
  });

  const deleteUser = useMutation({
    mutationFn: async ({ id, hard }: { id: string; hard: boolean }) =>
      (await apiClient.delete(`/admin/users/${id}${hard ? '?hard=true' : ''}`)).data,
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setConfirmingId(null);
      if (variables.hard) setRouteConflict(null);
      showToast(data.message);
    },
    onError: (err: any, variables) => {
      const body = err?.data;
      if (variables.hard && body?.error === 'route_assignments' && Array.isArray(body.routes)) {
        setRouteConflict({ userId: variables.id, routes: body.routes });
        setConfirmingId(null);
      } else if (variables.hard && body?.error === 'slot_and_step_assignments') {
        setRouteConflict({ userId: variables.id, pending_steps: body.pending_steps, slot_assignments: body.slot_assignments });
        setConfirmingId(null);
      } else {
        showToast(`削除失敗: ${err.message}`, 'error');
      }
    },
  });

  const filtered = users.filter((u) => {
    if (search && !u.full_name.toLowerCase().includes(search.toLowerCase()) &&
        !u.email.toLowerCase().includes(search.toLowerCase()) &&
        !u.role.includes(search.toUpperCase()) &&
        !(u.is_admin && 'ADMIN'.includes(search.toUpperCase()))) return false;
    if (deptFilter && u.department_id !== deptFilter) return false;
    if (roleFilter && u.role !== roleFilter) return false;
    if (activeFilter === 'active' && !u.is_active) return false;
    if (activeFilter === 'inactive' && u.is_active) return false;
    return true;
  });

  return (
    <>
      {/* User edit modal */}
      {editUser === 'new' && (
        <UserModal
          departments={departments}
          onClose={() => setEditUser(null)}
          onSave={(data) => createUser.mutate(data)}
          isSaving={createUser.isPending}
        />
      )}
      {editUser && editUser !== 'new' && (
        <UserModal
          user={editUser}
          departments={departments}
          onClose={() => setEditUser(null)}
          onSave={(data) => updateUser.mutate({ id: editUser.id, ...data })}
          isSaving={updateUser.isPending}
        />
      )}

      {/* Filters — full-width on mobile, inline on tablet+ */}
      <div className="space-y-3 mb-5">
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <input
            className="input w-full sm:w-auto sm:max-w-xs"
            placeholder="氏名 / メール / ロールで検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <CustomSelect
            className="w-full sm:w-40"
            options={[
              { value: '', label: t('admin_filter_all_dept') },
              ...departments.map((d) => ({ value: d.id, label: d.name })),
            ]}
            value={deptFilter}
            onChange={setDeptFilter}
          />
          <CustomSelect
            className="w-full sm:w-36"
            options={[
              { value: '', label: t('admin_filter_all_role') },
              ...ROLES.map((r) => ({ value: r, label: ROLE_MAP[r as Role]?.label ?? r })),
            ]}
            value={roleFilter}
            onChange={setRoleFilter}
          />
          <div className="flex rounded-xl overflow-hidden border border-white/70 w-full sm:w-auto">
            {(['all', 'active', 'inactive'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setActiveFilter(v)}
                className={`flex-1 sm:flex-initial px-3 py-1.5 text-xs font-semibold transition-colors ${activeFilter === v ? 'bg-warmgray-800 text-white' : 'bg-white/60 text-warmgray-500 hover:bg-white/90'}`}
              >
                {v === 'all' ? t('admin_filter_all_people') : v === 'active' ? t('admin_filter_active') : t('admin_filter_inactive')}
              </button>
            ))}
          </div>
          <span className="text-sm text-warmgray-400">{filtered.length} {t('admin_users_count')}</span>
          <div className="flex-1 hidden sm:block" />
          <button className="btn-primary w-full sm:w-auto" onClick={() => setEditUser('new')}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {t('admin_add_user')}
          </button>
        </div>
      </div>

      {routeConflict && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-warmgray-900/50 backdrop-blur-sm" onClick={() => setRouteConflict(null)} />
          <div className="relative glass rounded-2xl shadow-2xl w-full max-w-sm p-5 animate-scale-in">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-warmgray-800">アーカイブできません</p>
                <p className="text-xs text-warmgray-600 mt-1">このユーザーは以下の承認設定に関連しています。先に解除してください。</p>
                <ul className="mt-2.5 space-y-1">
                  {routeConflict.routes?.map((r) => (
                    <li key={r.id} className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200/70 rounded-lg px-2.5 py-1">
                      {r.name}
                    </li>
                  ))}
                  {routeConflict.pending_steps && routeConflict.pending_steps.length > 0 && (
                    <>
                      <li className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 pt-1">承認待ちステップ</li>
                      {routeConflict.pending_steps.map((s, i) => (
                        <li key={i} className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200/70 rounded-lg px-2.5 py-1">
                          {s.application_number} — {s.label}
                        </li>
                      ))}
                    </>
                  )}
                  {routeConflict.slot_assignments && routeConflict.slot_assignments.length > 0 && (
                    <>
                      <li className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 pt-1">スロット割り当て</li>
                      {routeConflict.slot_assignments.map((s, i) => (
                        <li key={i} className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200/70 rounded-lg px-2.5 py-1">
                          {s.owner_name} の {s.slot_label}
                        </li>
                      ))}
                    </>
                  )}
                </ul>
              </div>
            </div>
            {/* Quick bulk-replace tool — only shown when slot assignments exist */}
            {(routeConflict.slot_assignments?.length ?? 0) > 0 && (
              <div className="mt-3 pt-3 border-t border-white/40 space-y-2">
                <p className="text-xs font-bold text-warmgray-700">スロット一括置き換え</p>
                <p className="text-[10px] text-warmgray-500">このユーザーが担当するスロットを全て別の人に置き換えます。</p>
                <CustomSelect
                  options={[
                    { value: '__null__', label: '─ 空き（スキップ）にする ─' },
                    ...users.filter(u => u.is_active && u.id !== routeConflict.userId)
                      .map(u => ({ value: u.id, label: u.full_name })),
                  ]}
                  value={replaceToId}
                  onChange={setReplaceToId}
                />
                <button
                  disabled={replacing}
                  onClick={async () => {
                    setReplacing(true);
                    try {
                      await apiClient.post('/admin/approval-slots/replace-approver', {
                        from_user_id: routeConflict.userId,
                        to_user_id:   replaceToId === '__null__' ? null : replaceToId,
                      });
                      showToast('スロットを一括置き換えしました');
                      setRouteConflict(null);
                      setReplaceToId('__null__');
                    } catch (e: any) {
                      showToast(`置き換え失敗: ${e.message}`, 'error');
                    } finally {
                      setReplacing(false);
                    }
                  }}
                  className="btn-primary w-full text-xs"
                >
                  {replacing ? '処理中...' : '一括置き換え実行'}
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/40">
              <button
                onClick={() => { setRouteConflict(null); onGoToSlots(); }}
                className="btn-primary flex-1 text-xs"
              >
                スロット設定を開く →
              </button>
              <button
                onClick={() => setRouteConflict(null)}
                className="btn-ghost text-xs text-warmgray-500"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {showLoader ? (
        <RingoLoader.Block label="読み込み中..." />
      ) : isLoading ? null /* loader-delay window — blank, never flash empty table */ : (
        <div className="card !p-0 md:overflow-hidden">
          <table className="table-base table-responsive">
            <thead>
              <tr>
                <th>{t('admin_col_user')}</th>
                <th>{t('admin_field_role')}</th>
                <th>{t('admin_field_dept')}</th>
                <th>{t('admin_col_status')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => (
                <tr
                  key={u.id}
                  className="animate-fade-up"
                  style={{ animationDelay: `${Math.min(i, 14) * 35}ms` }}
                >
                  <td data-label={t('admin_col_user')}>
                    <div className="flex items-center gap-3 min-w-0">
                      <UserAvatar name={u.full_name} avatarUrl={u.avatar_url} />
                      <div className="min-w-0">
                        <p className="font-semibold text-warmgray-800 truncate">{u.full_name}</p>
                        <p className="text-[11px] text-warmgray-400 truncate">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td data-label={t('admin_field_role')}>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <RoleBadge role={u.role} />
                      {u.is_admin && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-ringo-50 text-ringo-700 border border-ringo-200">
                          Admin
                        </span>
                      )}
                    </div>
                  </td>
                  <td data-label={t('admin_field_dept')} className="text-warmgray-500 text-xs">{u.department_name ?? '—'}</td>
                  <td data-label={t('admin_col_status')}>
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      u.is_active
                        ? 'bg-emerald-100/80 text-emerald-700 border border-emerald-200/80'
                        : 'bg-surface-100 text-warmgray-500 border border-surface-200'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${u.is_active ? 'bg-emerald-500' : 'bg-warmgray-400'}`} />
                      {u.is_active ? t('admin_status_active') : t('admin_status_inactive')}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-3 justify-end flex-wrap">
                      <button
                        className="text-xs font-semibold text-ringo-500 hover:text-ringo-700 transition-colors"
                        onClick={() => setEditUser(u)}
                      >
                        編集
                      </button>
                      <InlineConfirm
                        isActive={confirmingId === u.id}
                        onTrigger={() => setConfirmingId(u.id)}
                        onConfirm={() => deleteUser.mutate({ id: u.id, hard: true })}
                        onCancel={() => setConfirmingId(null)}
                        message="完全削除しますか？"
                        confirmLabel="完全削除"
                        triggerClass="text-xs text-warmgray-400 hover:text-red-500 transition-colors"
                        disabled={deleteUser.isPending}
                        reservedWidth={280}
                        extraActions={
                          <button
                            type="button"
                            onClick={() => deleteUser.mutate({ id: u.id, hard: false })}
                            disabled={deleteUser.isPending}
                            className="text-[11px] font-semibold text-warmgray-700 bg-white border border-warmgray-300 hover:bg-surface-100 disabled:opacity-50 rounded-md px-2 py-0.5 transition-colors"
                          >
                            {t('admin_disable_only')}
                          </button>
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-warmgray-400 text-sm">ユーザーが見つかりません</div>
          )}
        </div>
      )}
    </>
  );
}
