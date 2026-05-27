import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useScrollEnd } from '../hooks/useScrollEnd';
import { useScrollLock } from '../hooks/useScrollLock';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import { ROLE_MAP, Role } from '../config/permissions';
import InlineConfirm from '../components/common/InlineConfirm';
import AdminAppDetailModal from '../components/admin/AdminAppDetailModal';
import FormsTab                    from '../components/admin/FormsTab';
import NotificationTemplatesTab   from '../components/admin/NotificationTemplatesTab';
import RingoLoader from '../components/common/RingoLoader';
import { Sk } from '../components/common/Skeleton';
import Toast, { useToast } from '../components/common/Toast';
import CustomSelect from '../components/forms/CustomSelect';
import { useLang } from '../context/LanguageContext';
import UserAvatar from '../components/common/UserAvatar';

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_admin: boolean;
  is_active: boolean;
  department_name?: string;
  department_id?: string;
  avatar_url?: string | null;
  // Notification preferences — included in GET /admin/users since schema fix
  notify_email:      boolean;
  notify_gchat:      boolean;
  gchat_webhook_url: string | null;
}

interface Department { id: string; name: string; code: string }

interface RouteStep {
  id: string;
  step_order: number;
  label: string;
  action_type: string;
  approver_name?: string;
  approver_id?: string;
  approver_avatar?: string | null;
}

interface ApprovalRoute {
  id: string;
  name: string;
  stage: string;
  is_active: boolean;
  template_name: string;
  template_code: string;
  template_id: string;
  department_name: string;
  department_id: string;
  steps: RouteStep[];
}

interface Template { id: string; code: string; title_ja: string }

const ROLES = [
  'SHITSUCHO', 'GM', 'SENIOR_MANAGER', 'MANAGER', 'SUB_MANAGER',
  'SUB_MANAGER_TSUKI', 'LEADER', 'SUB_LEADER', 'CHIEF', 'MEMBER',
  'SENMU', 'PRESIDENT',
];

function RoleBadge({ role }: { role: string }) {
  const { t } = useLang();
  const colors: Record<string, string> = {
    ADMIN:              'bg-ringo-500 text-white',
    PRESIDENT:          'bg-warmgray-800 text-white',
    SENMU:              'bg-indigo-500 text-white',
    SHITSUCHO:          'bg-violet-600 text-white',
    GM:                 'bg-violet-500 text-white',
    SENIOR_MANAGER:     'bg-sky-600 text-white',
    MANAGER:            'bg-sky-500 text-white',
    SUB_MANAGER:        'bg-sky-400 text-white',
    SUB_MANAGER_TSUKI:  'bg-teal-500 text-white',
    LEADER:             'bg-teal-400 text-white',
    SUB_LEADER:         'bg-emerald-400 text-white',
    CHIEF:              'bg-emerald-300 text-emerald-900',
    MEMBER:             'bg-surface-200 text-warmgray-600',
  };
  const label = t(`role_${role}`) !== `role_${role}` ? t(`role_${role}`) : (ROLE_MAP[role as Role]?.label ?? role);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${colors[role] ?? 'bg-surface-200 text-warmgray-500'}`}>
      {label}
    </span>
  );
}

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
    const payload: Record<string, any> = { ...form, department_id: form.department_id || null };
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
              options={ROLES.map((r) => ({ value: r, label: t(`role_${r}`) !== `role_${r}` ? t(`role_${r}`) : (ROLE_MAP[r as Role]?.label ?? r) }))}
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

function UsersTab({ showToast, onGoToRoutes }: {
  showToast: (m: string, t?: 'success' | 'error' | 'info') => void;
  onGoToRoutes: () => void;
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
  const [routeConflict, setRouteConflict] = useState<{ userId: string; routes: { id: string; name: string }[] } | null>(null);

  // Admin reference data — changes rarely (few times/month). Cache aggressively.
  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['admin', 'users'],
    queryFn:  async () => (await apiClient.get('/admin/users')).data,
    staleTime: 5 * 60_000,
    gcTime:    10 * 60_000,
  });

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
    mutationFn: async ({ id, notify_email, notify_gchat, gchat_webhook_url, ...patch }: { id: string } & Record<string, any>) => {
      // Send core user fields and notification settings in parallel
      await Promise.all([
        apiClient.patch(`/admin/users/${id}`, patch),
        apiClient.patch(`/admin/users/${id}/notifications`, {
          notify_email,
          notify_gchat,
          gchat_webhook_url: gchat_webhook_url || null,
        }),
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
                <p className="text-xs text-warmgray-600 mt-1">このユーザーは以下の承認ルートに設定されています。先にルートから外してください。</p>
                <ul className="mt-2.5 space-y-1">
                  {routeConflict.routes.map((r) => (
                    <li key={r.id} className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200/70 rounded-lg px-2.5 py-1">
                      {r.name}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-white/40">
              <button
                onClick={() => { setRouteConflict(null); onGoToRoutes(); }}
                className="btn-primary flex-1 text-xs"
              >
                ルート設定を開く →
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

      {isLoading ? (
        <RingoLoader.Block label="読み込み中..." />
      ) : (
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

// ─── Approver Picker ─────────────────────────────────────────────────────────

interface ApproverPickerProps {
  users: User[];
  departments: Department[];
  value: string;
  onChange: (id: string) => void;
}

function ApproverPicker({ users, departments, value, onChange }: ApproverPickerProps) {
  const { t, lang } = useLang();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const selectedUser = users.find((u) => u.id === value);

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
              const isSelected = u.id === value;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => onChange(isSelected ? '' : u.id)}
                  className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl text-center
                    transition-all duration-150 border
                    ${isSelected
                      ? 'border-ringo-400/70 bg-ringo-50/80 shadow-[0_0_0_2px_rgba(154,46,34,0.18)] scale-[1.02]'
                      : 'border-warmgray-200/50 bg-white/50 hover:bg-white/80 hover:border-warmgray-300/60 hover:scale-[1.01]'
                    }`}
                >
                  {/* Selected checkmark */}
                  {isSelected && (
                    <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-ringo-500 flex items-center justify-center shadow-sm">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
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

      {/* Selected summary pill */}
      {selectedUser && (
        <div className="flex items-center gap-2.5 px-3 py-2 bg-ringo-50/60 rounded-xl border border-ringo-200/50">
          <UserAvatar name={selectedUser.full_name} avatarUrl={selectedUser.avatar_url} size={6} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-ringo-700 truncate">{selectedUser.full_name}</p>
            <p className="text-[10px] text-warmgray-500 truncate">{selectedUser.department_name ?? '—'}</p>
          </div>
          <RoleBadge role={selectedUser.role} />
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-warmgray-400 hover:text-warmgray-600 transition-colors ml-1"
            title={lang === 'en' ? 'Clear' : 'クリア'}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Routes Tab ───────────────────────────────────────────────────────────────

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

function RoutesTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const queryClient = useQueryClient();
  const { lang, t } = useLang();
  const [addingStepToRoute, setAddingStepToRoute] = useState<string | null>(null);
  const [newStep, setNewStep] = useState({ approver_id: '', label: '', action_type: 'APPROVE' });
  const [showNewRoute, setShowNewRoute] = useState(false);
  const [newRoute, setNewRoute] = useState({ template_id: '', department_id: '', name: '', stage: 'RINGI' });
  // Inline confirm — track id of the row currently in confirm state
  const [confirmingRouteId, setConfirmingRouteId] = useState<string | null>(null);
  const [confirmingStepId,  setConfirmingStepId]  = useState<string | null>(null);
  const [routeDeptFilter, setRouteDeptFilter] = useState('');
  const [routeTemplateFilter, setRouteTemplateFilter] = useState('');
  const [routeStageFilter, setRouteStageFilter] = useState('');

  const { data: routes = [], isLoading } = useQuery<ApprovalRoute[]>({
    queryKey: ['admin', 'routes'],
    queryFn:  async () => (await apiClient.get('/admin/routes')).data,
    staleTime: 5 * 60_000,
  });

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
    mutationFn: async ({ routeId, ...step }: { routeId: string; approver_id: string; label: string; action_type: string }) =>
      (await apiClient.post(`/admin/routes/${routeId}/steps`, step)).data,
    onSuccess: () => {
      refetch();
      setAddingStepToRoute(null);
      setNewStep({ approver_id: '', label: '', action_type: 'APPROVE' });
      showToast('ステップを追加しました');
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

  if (isLoading) return <RingoLoader.Block label="読み込み中..." />;

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

          {/* Visual chain with avatars — vertical on mobile, horizontal on md+ */}
          <div className="bg-surface-50/60 rounded-2xl p-4">
            <div className="flex flex-col items-center md:flex-row md:items-center gap-3 md:flex-wrap">
              {/* Applicant node */}
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-10 h-10 rounded-full bg-surface-200 border-2 border-surface-300 flex items-center justify-center text-sm font-bold text-warmgray-600">申</div>
                <span className="text-[10px] text-warmgray-400">{lang === 'en' ? 'Applicant' : '申請者'}</span>
              </div>

              {route.steps.length === 0 ? (
                <p className="text-xs text-warmgray-400 italic ml-2">{t('admin_no_steps')}</p>
              ) : (
                route.steps.map((step) => (
                  <div key={step.id} className="flex flex-col items-center md:flex-row gap-3">
                    <ChainArrow />
                    <div className="flex flex-col items-center gap-1 group/step relative">
                      {/* Avatar or step number */}
                      <div className="relative">
                        <UserAvatar
                          name={step.approver_name ?? String(step.step_order)}
                          avatarUrl={step.approver_avatar}
                          size={10}
                          className="shadow-sm"
                        />
                        {/* Delete badge — first click arms, second confirms.
                            Inline-on-avatar to keep chain layout compact. */}
                        {step.step_order > 1 && (
                          confirmingStepId === step.id ? (
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
                              /* Always-visible on touch (md:hidden+md:group-hover trick) so phones can tap it.
                                 Desktop hides until step avatar hovered. */
                              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center md:hidden md:group-hover/step:flex shadow-sm"
                              onClick={() => setConfirmingStepId(step.id)}
                              title="削除"
                            >
                              ×
                            </button>
                          )
                        )}
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
                ))
              )}

              {/* End node */}
              <div className="flex flex-col items-center md:flex-row gap-3">
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
                  value={newStep.approver_id}
                  onChange={(v) => setNewStep({ ...newStep, approver_id: v })}
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
                <button className="btn-ghost text-xs" onClick={() => setAddingStepToRoute(null)}>{t('btn_cancel')}</button>
                <button
                  className="btn-primary text-xs"
                  disabled={!newStep.approver_id || addStep.isPending}
                  onClick={() => addStep.mutate({ routeId: route.id, ...newStep })}
                >
                  {addStep.isPending ? t('admin_adding') : t('admin_step_form_title')}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="w-full py-2 text-xs font-semibold text-warmgray-400 hover:text-ringo-600 hover:bg-ringo-50/50 rounded-xl transition-all duration-150 border border-dashed border-warmgray-200 hover:border-ringo-200 flex items-center justify-center gap-1"
              onClick={() => setAddingStepToRoute(route.id)}
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

// ─── Applications Tab ─────────────────────────────────────────────────────────

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

function ApplicationsTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error' | 'info') => void }) {
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

      {isLoading ? (
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
      ) : (
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

// ─── Role Permissions Tab ─────────────────────────────────────────────────────

interface PermRowDraft {
  canSubmit: boolean;
  canApprove: boolean;
  canSettle: boolean;
  canAdmin: boolean;
  navPages: string[];
}

const NAV_ROUTE_LABELS: Record<string, string> = {
  '/dashboard':        'ダッシュ',
  '/approvals':        '承認待ち',
  '/approval-history': '承認履歴',
  '/accounting':       '精算管理',
  '/history':          '申請履歴',
  '/admin':            '管理画面',
};

const ALL_NAV_ROUTES = [
  '/dashboard',
  '/approvals',
  '/approval-history',
  '/accounting',
  '/history',
  '/admin',
];

function PermissionsTab({ showToast }: { showToast: (msg: string, type?: 'success' | 'error' | 'info') => void }) {
  const { t, lang } = useLang();
  const queryClient = useQueryClient();

  const { data: dbPerms, isLoading } = useQuery<Record<string, PermRowDraft>>({
    queryKey: ['admin-role-permissions'],
    queryFn: async () => (await apiClient.get('/admin/role-permissions')).data,
    staleTime: 0,
  });

  const [draft, setDraft] = useState<Record<string, PermRowDraft>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});

  // Sync draft when DB data loads
  useEffect(() => {
    if (dbPerms) {
      setDraft(dbPerms);
      setDirty({});
    }
  }, [dbPerms]);

  const saveMutation = useMutation({
    mutationFn: (payload: { role: string; data: PermRowDraft }) =>
      apiClient.patch(`/admin/role-permissions/${payload.role}`, payload.data),
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries({ queryKey: ['permissions'] });
      queryClient.invalidateQueries({ queryKey: ['admin-role-permissions'] });
      setDirty((d) => { const n = { ...d }; delete n[payload.role]; return n; });
      showToast('保存しました', 'success');
    },
    onError: (err: unknown) => {
      const msg = (err as { data?: { error?: string } })?.data?.error ?? '保存に失敗しました';
      showToast(msg, 'error');
    },
  });

  const toggleBool = (role: string, field: keyof Omit<PermRowDraft, 'navPages'>, value: boolean) => {
    setDraft((prev) => ({ ...prev, [role]: { ...prev[role], [field]: value } }));
    setDirty((prev) => ({ ...prev, [role]: true }));
  };

  const toggleNav = (role: string, route: string, checked: boolean) => {
    setDraft((prev) => {
      const cur = prev[role];
      const pages = checked
        ? [...cur.navPages, route]
        : cur.navPages.filter((p) => p !== route);
      // Keep canonical order
      const ordered = ALL_NAV_ROUTES.filter((r) => pages.includes(r));
      return { ...prev, [role]: { ...cur, navPages: ordered } };
    });
    setDirty((prev) => ({ ...prev, [role]: true }));
  };

  const PERM_ROLES = Object.keys(ROLE_MAP) as Role[];

  if (isLoading) {
    return <RingoLoader.Block />;
  }

  return (
    <div className="space-y-6">
      {/* Hint banner */}
      <div className="animate-fade-up flex items-start gap-3 bg-mustard-400/10 border border-mustard-400/30 rounded-2xl px-5 py-4">
        <span className="text-xl">💡</span>
        <p className="text-sm text-warmgray-700">{t('admin_perms_hint')}</p>
      </div>

      {/* Permissions table — desktop */}
      <div className="card !p-0 overflow-x-auto [scrollbar-gutter:stable] hidden md:block">
        <table className="table-base w-full text-sm">
          <thead>
            <tr>
              <th className="whitespace-nowrap">{t('admin_perms_col_role')}</th>
              <th className="whitespace-nowrap text-center">{t('admin_perms_col_submit')}</th>
              <th className="whitespace-nowrap text-center">{t('admin_perms_col_approve')}</th>
              <th className="whitespace-nowrap text-center">{t('admin_perms_col_settle')}</th>
              <th className="whitespace-nowrap text-center">{t('admin_perms_col_admin')}</th>
              <th className="whitespace-nowrap">{t('admin_perms_col_pages')}</th>
              <th className="whitespace-nowrap text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {PERM_ROLES.map((role, i) => {
              const row = draft[role];
              const isAdminRole = role === 'ADMIN';
              const isDirty = !!dirty[role];
              const saving = saveMutation.isPending && (saveMutation.variables as { role: string } | undefined)?.role === role;

              return (
                <tr
                  key={role}
                  className={`animate-fade-up ${isAdminRole ? 'opacity-70' : ''}`}
                  style={{ animationDelay: `${i * 45}ms` }}
                >
                  <td className="whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <RoleBadge role={role} />
                      {isAdminRole && (
                        <span className="text-warmgray-400 text-xs" title="システム管理者の権限は変更できません">🔒</span>
                      )}
                    </div>
                    <div className="text-[10px] text-warmgray-400 mt-0.5">
                      {t(`role_${role}`) !== `role_${role}` ? t(`role_${role}`) : (lang === 'en' ? ROLE_MAP[role as Role]?.label_en : ROLE_MAP[role as Role]?.label)}
                    </div>
                  </td>

                  {(['canSubmit', 'canApprove', 'canSettle', 'canAdmin'] as const).map((field) => (
                    <td key={field} className="text-center">
                      <input
                        type="checkbox"
                        checked={row?.[field] ?? false}
                        disabled={isAdminRole}
                        onChange={(e) => toggleBool(role, field, e.target.checked)}
                        className="w-4 h-4 accent-ringo-500 cursor-pointer disabled:cursor-not-allowed"
                      />
                    </td>
                  ))}

                  <td>
                    <div className="flex flex-wrap gap-1">
                      {ALL_NAV_ROUTES.map((route) => (
                        <label
                          key={route}
                          className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-md border cursor-pointer select-none
                            ${row?.navPages?.includes(route)
                              ? 'bg-ringo-50 text-ringo-700 border-ringo-200'
                              : 'bg-surface-100/80 text-warmgray-400 border-surface-200/80'
                            }
                            ${isAdminRole ? 'cursor-not-allowed opacity-60' : ''}
                          `}
                        >
                          <input
                            type="checkbox"
                            checked={row?.navPages?.includes(route) ?? false}
                            disabled={isAdminRole}
                            onChange={(e) => toggleNav(role, route, e.target.checked)}
                            className="sr-only"
                          />
                          {NAV_ROUTE_LABELS[route] ?? route}
                        </label>
                      ))}
                    </div>
                  </td>

                  <td className="text-center">
                    <button
                      disabled={isAdminRole || !isDirty || saving}
                      onClick={() => row && saveMutation.mutate({ role, data: row })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150
                        ${isAdminRole || !isDirty
                          ? 'bg-surface-100 text-warmgray-300 cursor-not-allowed'
                          : saving
                            ? 'bg-ringo-100 text-ringo-400 cursor-wait'
                            : 'bg-ringo-500 text-white hover:bg-ringo-600 shadow-sm'
                        }`}
                    >
                      {saving ? '保存中…' : '保存'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Permissions cards — mobile */}
      <div className="space-y-3 md:hidden">
        {PERM_ROLES.map((role, i) => {
          const row = draft[role];
          const isAdminRole = role === 'ADMIN';
          const isDirty = !!dirty[role];
          const saving = saveMutation.isPending && (saveMutation.variables as { role: string } | undefined)?.role === role;

          return (
            <div
              key={role}
              className={`card !p-4 space-y-3 animate-fade-up ${isAdminRole ? 'opacity-70' : ''}`}
              style={{ animationDelay: `${i * 45}ms` }}
            >
              {/* Header: role + save button */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <RoleBadge role={role} />
                    {isAdminRole && (
                      <span className="text-warmgray-400 text-xs" title="システム管理者の権限は変更できません">🔒</span>
                    )}
                  </div>
                  <div className="text-[10px] text-warmgray-400 mt-0.5">
                    {lang === 'en' ? ROLE_MAP[role].label_en : ROLE_MAP[role].label}
                  </div>
                </div>
                <button
                  disabled={isAdminRole || !isDirty || saving}
                  onClick={() => row && saveMutation.mutate({ role, data: row })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 shrink-0
                    ${isAdminRole || !isDirty
                      ? 'bg-surface-100 text-warmgray-300 cursor-not-allowed'
                      : saving
                        ? 'bg-ringo-100 text-ringo-400 cursor-wait'
                        : 'bg-ringo-500 text-white hover:bg-ringo-600 shadow-sm'
                    }`}
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>

              {/* Capability toggles */}
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['canSubmit',  t('admin_perms_col_submit')],
                  ['canApprove', t('admin_perms_col_approve')],
                  ['canSettle',  t('admin_perms_col_settle')],
                  ['canAdmin',   t('admin_perms_col_admin')],
                ] as const).map(([field, label]) => (
                  <label
                    key={field}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium cursor-pointer select-none transition-colors
                      ${row?.[field]
                        ? 'bg-ringo-50 text-ringo-700 border-ringo-200/80'
                        : 'bg-white/60 text-warmgray-500 border-white/80'
                      }
                      ${isAdminRole ? 'cursor-not-allowed' : ''}
                    `}
                  >
                    <input
                      type="checkbox"
                      checked={row?.[field] ?? false}
                      disabled={isAdminRole}
                      onChange={(e) => toggleBool(role, field, e.target.checked)}
                      className="w-4 h-4 accent-ringo-500 shrink-0 disabled:cursor-not-allowed"
                    />
                    {label}
                  </label>
                ))}
              </div>

              {/* Nav pages */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-1.5">
                  {t('admin_perms_col_pages')}
                </p>
                <div className="flex flex-wrap gap-1">
                  {ALL_NAV_ROUTES.map((route) => (
                    <label
                      key={route}
                      className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-2 py-1 rounded-md border cursor-pointer select-none
                        ${row?.navPages?.includes(route)
                          ? 'bg-ringo-50 text-ringo-700 border-ringo-200'
                          : 'bg-surface-100/80 text-warmgray-400 border-surface-200/80'
                        }
                        ${isAdminRole ? 'cursor-not-allowed opacity-60' : ''}
                      `}
                    >
                      <input
                        type="checkbox"
                        checked={row?.navPages?.includes(route) ?? false}
                        disabled={isAdminRole}
                        onChange={(e) => toggleNav(role, route, e.target.checked)}
                        className="sr-only"
                      />
                      {NAV_ROUTE_LABELS[route] ?? route}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info cards — updated to reflect current system */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { icon: '🔑', title: t('admin_perm_google_title'),  body: t('admin_perm_google_body') },
          { icon: '⚡', title: t('admin_perm_role_title'),    body: t('admin_perm_role_body') },
          { icon: '📋', title: t('admin_perm_route_title'),   body: t('admin_perm_route_body') },
          { icon: '🛡️', title: t('admin_perm_admin_title'),  body: t('admin_perm_admin_body') },
          { icon: '🔒', title: t('admin_perm_token_title'),   body: t('admin_perm_token_body') },
        ].map((item, i) => (
          <div
            key={item.title}
            className="card-sm flex items-start gap-3 animate-fade-up"
            style={{ animationDelay: `${150 + i * 60}ms` }}
          >
            <span className="text-xl">{item.icon}</span>
            <div>
              <p className="text-sm font-semibold text-warmgray-800">{item.title}</p>
              <p className="text-xs text-warmgray-500 mt-0.5">{item.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── AllowanceTab ─────────────────────────────────────────────────────────────

interface AllowanceRate {
  role: string;
  daily_rate_yen: number;
}

function AllowanceTab({ showToast }: { showToast: (msg: string, type?: 'success' | 'error') => void }) {
  const { lang, t } = useLang();
  const queryClient = useQueryClient();
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editVal, setEditVal] = useState<string>('');

  const { data, isLoading } = useQuery<{ rates: AllowanceRate[]; user_daily_rate: number | null }>({
    queryKey: ['allowance-rates'],
    queryFn: async () => (await apiClient.get('/allowance-rates')).data,
    staleTime: 5 * 60_000,
  });

  const patchRate = useMutation({
    mutationFn: async ({ role, daily_rate_yen }: { role: string; daily_rate_yen: number }) =>
      apiClient.patch(`/allowance-rates/${encodeURIComponent(role)}`, { daily_rate_yen }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allowance-rates'] });
      showToast(lang === 'ja' ? '日当レートを更新しました' : 'Allowance rate updated', 'success');
      setEditingRole(null);
    },
    onError: (err: any) => {
      showToast(err?.data?.error ?? err?.message ?? (lang === 'ja' ? '更新に失敗しました' : 'Update failed'), 'error');
    },
  });

  const startEdit = (rate: AllowanceRate) => {
    setEditingRole(rate.role);
    setEditVal(String(rate.daily_rate_yen));
  };

  const saveEdit = (role: string) => {
    const val = parseInt(editVal, 10);
    if (isNaN(val) || val < 0) {
      showToast(lang === 'ja' ? '有効な金額を入力してください' : 'Enter a valid amount', 'error');
      return;
    }
    patchRate.mutate({ role, daily_rate_yen: val });
  };

  const ROLE_LABELS: Record<string, string> = {
    SHITSUCHO:         lang === 'ja' ? '室長'             : 'Division Chief',
    GM:                lang === 'ja' ? 'ゼネラルマネージャー' : 'General Manager',
    SENIOR_MANAGER:    lang === 'ja' ? 'シニアマネージャー'   : 'Senior Manager',
    MANAGER:           lang === 'ja' ? 'マネージャー'        : 'Manager',
    SUB_MANAGER:       lang === 'ja' ? 'サブマネージャー'     : 'Sub Manager',
    SUB_MANAGER_TSUKI: lang === 'ja' ? 'サブマネージャー付'   : 'Associate Sub Manager',
    LEADER:            lang === 'ja' ? 'リーダー'           : 'Leader',
    SUB_LEADER:        lang === 'ja' ? 'サブリーダー'        : 'Sub Leader',
    CHIEF:             lang === 'ja' ? 'チーフ'             : 'Chief',
    MEMBER:            lang === 'ja' ? 'メンバー'           : 'Member',
    SENMU:             lang === 'ja' ? '専務'              : 'Managing Director',
    PRESIDENT:         lang === 'ja' ? '社長'              : 'President',
  };

  if (isLoading) return <div className="card flex justify-center py-12"><RingoLoader.Block /></div>;

  return (
    <div className="card space-y-5">
      <div className="flex items-center gap-3 pb-4 border-b border-white/40">
        <span className="text-xl">💴</span>
        <div>
          <h3 className="font-bold text-warmgray-800">
            {lang === 'ja' ? '日当レート管理' : 'Daily Allowance Rates'}
          </h3>
          <p className="text-xs text-warmgray-500 mt-0.5">
            {lang === 'ja'
              ? '役割ごとの日当単価を設定します。変更は次回ログイン時に適用されます。'
              : 'Set daily allowance rates per role. Changes apply on next login.'}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {(data?.rates ?? []).map((rate) => (
          <div
            key={rate.role}
            className="flex items-center gap-3 px-4 py-3 bg-white/60 border border-white/80 rounded-xl"
          >
            {/* Role badge */}
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-warmgray-100 text-warmgray-700 shrink-0 min-w-[80px] justify-center">
              {t(`role_${rate.role}`) !== `role_${rate.role}` ? t(`role_${rate.role}`) : (ROLE_LABELS[rate.role] ?? rate.role)}
            </span>

            {/* Rate display or edit */}
            {editingRole === rate.role ? (
              <div className="flex items-center gap-2 flex-1">
                <span className="text-warmgray-500 text-sm">¥</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={editVal}
                  onChange={(e) => setEditVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit(rate.role);
                    if (e.key === 'Escape') setEditingRole(null);
                  }}
                  className="input w-32 text-sm py-1.5"
                  autoFocus
                />
                <span className="text-warmgray-400 text-xs">{lang === 'ja' ? '円/日' : 'JPY/day'}</span>
                <button
                  onClick={() => saveEdit(rate.role)}
                  disabled={patchRate.isPending}
                  className="btn-primary text-xs py-1.5 px-3 ml-auto"
                >
                  {lang === 'ja' ? '保存' : 'Save'}
                </button>
                <button
                  onClick={() => setEditingRole(null)}
                  className="btn-ghost text-xs py-1.5 px-3"
                >
                  {lang === 'ja' ? 'キャンセル' : 'Cancel'}
                </button>
              </div>
            ) : (
              <>
                <span className="text-warmgray-800 font-semibold flex-1">
                  ¥{rate.daily_rate_yen.toLocaleString('ja-JP')}
                  <span className="text-xs font-normal text-warmgray-400 ml-1">{lang === 'ja' ? '/ 日' : '/ day'}</span>
                </span>
                <button
                  onClick={() => startEdit(rate)}
                  className="text-xs font-medium text-warmgray-500 hover:text-warmgray-800 transition-colors"
                >
                  {lang === 'ja' ? '編集' : 'Edit'}
                </button>
              </>
            )}
          </div>
        ))}

        {(data?.rates ?? []).length === 0 && (
          <p className="text-sm text-warmgray-400 text-center py-8">
            {lang === 'ja' ? 'レートが設定されていません。' : 'No rates configured.'}
          </p>
        )}
      </div>

      <p className="text-xs text-warmgray-400">
        {lang === 'ja'
          ? '* 日当レートを変更すると、その役割に所属する全員の日当単価が自動更新されます。'
          : '* Updating a rate automatically backfills all users with that role.'}
      </p>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Tab = 'routes' | 'users' | 'applications' | 'permissions' | 'forms' | 'allowance' | 'notifications';

export default function Admin() {
  const [tab, setTab] = useState<Tab>('routes');
  const { t, lang } = useLang();
  const { toast, show: showToast, dismiss } = useToast();

  const TAB_CONFIG: { key: Tab; label: string; icon: string }[] = [
    { key: 'routes',       label: t('admin_routes_tab'),  icon: '🔀' },
    { key: 'users',        label: t('admin_users_tab'),   icon: '👥' },
    { key: 'applications', label: t('admin_apps_tab'),    icon: '📋' },
    { key: 'forms',        label: t('admin_forms_tab'),   icon: '📝' },
    { key: 'allowance',    label: '日当レート',             icon: '💴' },
    { key: 'permissions',  label: t('admin_perms_tab'),   icon: '🛡️' },
    { key: 'notifications', label: lang === 'ja' ? '通知テンプレート' : 'Notifications', icon: '🔔' },
  ];

  return (
    <Layout title={t('title_admin')}>
      {toast && <Toast {...toast} onDismiss={dismiss} />}

      <div className="max-w-5xl mx-auto space-y-6">
        {/* Pill tab bar — scrolls horizontally on narrow viewports if too wide to fit */}
        <div className="animate-fade-up overflow-x-auto -mx-4 md:mx-0 px-4 md:px-0">
          <div className="inline-flex items-center gap-1 bg-white/50 backdrop-blur-sm border border-white/70 rounded-2xl p-1.5 shadow-sm whitespace-nowrap">
            {TAB_CONFIG.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all duration-150 ${
                  tab === t.key
                    ? 'bg-warmgray-800 text-white shadow-sm'
                    : 'text-warmgray-500 hover:text-warmgray-800 hover:bg-white/60'
                }`}
              >
                <span className="text-base leading-none">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div key={tab} className="animate-fade-up min-h-[60vh]">
          {tab === 'routes'       && <RoutesTab showToast={showToast} />}
          {tab === 'users'        && <UsersTab showToast={showToast} onGoToRoutes={() => setTab('routes')} />}
          {tab === 'applications' && <ApplicationsTab showToast={showToast} />}
          {tab === 'forms'        && <FormsTab showToast={showToast} />}
          {tab === 'permissions'  && <PermissionsTab showToast={showToast} />}
          {tab === 'allowance'     && <AllowanceTab showToast={showToast} />}
          {tab === 'notifications' && <NotificationTemplatesTab showToast={showToast} />}
        </div>
      </div>
    </Layout>
  );
}
