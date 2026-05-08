import { useState, useEffect, useCallback } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useScrollEnd } from '../hooks/useScrollEnd';
import { useScrollLock } from '../hooks/useScrollLock';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import { ROLE_MAP, Role } from '../config/permissions';
import InlineConfirm from '../components/common/InlineConfirm';
import Toast, { useToast } from '../components/common/Toast';
import CustomSelect from '../components/forms/CustomSelect';
import { useLang } from '../context/LanguageContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  department_name?: string;
  department_id?: string;
  avatar_url?: string | null;
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

// ACCOUNTING is kept in DB for backward compat but 総務部 handles financial tasks now
const ROLES = ['EMPLOYEE', 'MANAGER', 'GM', 'SOUMU', 'SENMU', 'PRESIDENT', 'ADMIN'];

// ─── Shared helpers ───────────────────────────────────────────────────────────

function nameToGradient(name: string): string {
  const opts = [
    'from-ringo-400 to-ringo-600', 'from-mustard-400 to-mustard-600',
    'from-teal-500 to-teal-700', 'from-indigo-400 to-violet-600', 'from-emerald-400 to-teal-600',
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return opts[h % opts.length];
}

function UserAvatar({ name, avatarUrl, size = 8 }: { name: string; avatarUrl?: string | null; size?: number }) {
  const grad = nameToGradient(name);
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={`w-${size} h-${size} rounded-full object-cover ring-2 ring-white/60 shrink-0`}
      />
    );
  }
  return (
    <div className={`w-${size} h-${size} rounded-full bg-gradient-to-br ${grad} flex items-center justify-center text-white text-xs font-bold shrink-0 ring-2 ring-white/60`}>
      {name.slice(0, 1)}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    ADMIN:      'bg-ringo-500 text-white',
    PRESIDENT:  'bg-warmgray-800 text-white',
    SENMU:      'bg-indigo-500 text-white',
    GM:         'bg-violet-500 text-white',
    MANAGER:    'bg-sky-500 text-white',
    ACCOUNTING: 'bg-mustard-500 text-white',
    SOUMU:      'bg-teal-500 text-white',
    EMPLOYEE:   'bg-surface-200 text-warmgray-600',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${colors[role] ?? 'bg-surface-200 text-warmgray-500'}`}>
      {role}
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
  const { t } = useLang();

  // Lock page scroll while this modal is open — same reason as ConfirmDialog
  useScrollLock(true);
  const [form, setForm] = useState({
    full_name:     user?.full_name ?? '',
    email:         user?.email ?? '',
    password:      '',
    role:          user?.role ?? 'EMPLOYEE',
    department_id: user?.department_id ?? '',
    is_active:     user?.is_active ?? true,
  });

  const set = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));

  const handleSave = () => {
    const payload: Record<string, any> = { ...form, department_id: form.department_id || null };
    if (!payload.password) delete payload.password;
    onSave(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-warmgray-900/50 backdrop-blur-sm px-4">
      <div className="glass rounded-3xl w-full max-w-lg p-8 space-y-5 shadow-2xl animate-scale-in">
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
              options={ROLES.map((r) => ({ value: r, label: r }))}
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
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const queryClient = useQueryClient();
  const { t } = useLang();
  const [editUser, setEditUser] = useState<User | null | 'new'>(null);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  // Inline confirm — only one row can be in confirm state at a time
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['admin', 'users'],
    queryFn: async () => (await apiClient.get('/admin/users')).data,
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['admin', 'departments'],
    queryFn: async () => (await apiClient.get('/admin/departments')).data,
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
    mutationFn: async ({ id, ...patch }: { id: string } & Record<string, any>) =>
      (await apiClient.patch(`/admin/users/${id}`, patch)).data,
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setConfirmingId(null);
      showToast(data.message);
    },
    onError: (err: any) => showToast(`削除失敗: ${err.message}`, 'error'),
  });

  const filtered = users.filter((u) => {
    if (search && !u.full_name.toLowerCase().includes(search.toLowerCase()) &&
        !u.email.toLowerCase().includes(search.toLowerCase()) &&
        !u.role.includes(search.toUpperCase())) return false;
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

      {/* Filters */}
      <div className="space-y-3 mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            className="input max-w-xs"
            placeholder="氏名 / メール / ロールで検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <CustomSelect
            className="w-40"
            options={[
              { value: '', label: t('admin_filter_all_dept') },
              ...departments.map((d) => ({ value: d.id, label: d.name })),
            ]}
            value={deptFilter}
            onChange={setDeptFilter}
          />
          <CustomSelect
            className="w-36"
            options={[
              { value: '', label: t('admin_filter_all_role') },
              ...ROLES.filter((r) => r !== 'ACCOUNTING').map((r) => ({ value: r, label: r })),
            ]}
            value={roleFilter}
            onChange={setRoleFilter}
          />
          <div className="flex rounded-xl overflow-hidden border border-white/70">
            {(['all', 'active', 'inactive'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setActiveFilter(v)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${activeFilter === v ? 'bg-warmgray-800 text-white' : 'bg-white/60 text-warmgray-500 hover:bg-white/90'}`}
              >
                {v === 'all' ? t('admin_filter_all_people') : v === 'active' ? t('admin_filter_active') : t('admin_filter_inactive')}
              </button>
            ))}
          </div>
          <span className="text-sm text-warmgray-400">{filtered.length} {t('admin_users_count')}</span>
          <div className="flex-1" />
          <button className="btn-primary" onClick={() => setEditUser('new')}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {t('admin_add_user')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-warmgray-400 text-sm py-8 text-center">読み込み中...</div>
      ) : (
        <div className="card !p-0 overflow-hidden">
          <table className="table-base">
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
                  <td>
                    <div className="flex items-center gap-3">
                      <UserAvatar name={u.full_name} avatarUrl={u.avatar_url} />
                      <div>
                        <p className="font-semibold text-warmgray-800">{u.full_name}</p>
                        <p className="text-[11px] text-warmgray-400">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td><RoleBadge role={u.role} /></td>
                  <td className="text-warmgray-500 text-xs">{u.department_name ?? '—'}</td>
                  <td>
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
                    <div className="flex items-center gap-3 justify-end">
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
            ...ROLES.filter((r) => r !== 'ACCOUNTING').map((r) => ({ value: r, label: r })),
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
                      ? 'border-ringo-400/70 bg-ringo-50/80 shadow-[0_0_0_2px_rgba(199,91,71,0.15)] scale-[1.02]'
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
  return (
    <svg className="w-4 h-4 text-warmgray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
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
    queryFn: async () => (await apiClient.get('/admin/routes')).data,
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['admin', 'users'],
    queryFn: async () => (await apiClient.get('/admin/users')).data,
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['admin', 'departments'],
    queryFn: async () => (await apiClient.get('/admin/departments')).data,
  });

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['admin', 'templates'],
    queryFn: async () => (await apiClient.get('/admin/templates')).data,
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

  if (isLoading) return <div className="text-warmgray-400 text-sm py-8 text-center">読み込み中...</div>;

  return (
    <div className="space-y-4">
      {/* No modal dialogs — delete confirmations are inline on the row itself */}

      {/* Route filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <CustomSelect
          className="w-40"
          options={[
            { value: '', label: t('admin_filter_all_dept') },
            ...departments.map((d) => ({ value: d.id, label: d.name })),
          ]}
          value={routeDeptFilter}
          onChange={setRouteDeptFilter}
        />
        <CustomSelect
          className="w-44"
          options={[
            { value: '', label: t('admin_filter_all_form') },
            ...templates.map((tmpl) => ({ value: tmpl.id, label: tmpl.title_ja })),
          ]}
          value={routeTemplateFilter}
          onChange={setRouteTemplateFilter}
        />
        <div className="flex rounded-xl overflow-hidden border border-white/70">
          {([
            { v: '', label: t('admin_stage_all') },
            { v: 'RINGI', label: t('admin_stage_ringi') },
            { v: 'SETTLEMENT', label: t('admin_stage_settle') },
          ]).map(({ v, label }) => (
            <button key={v} onClick={() => setRouteStageFilter(v)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${routeStageFilter === v ? 'bg-warmgray-800 text-white' : 'bg-white/60 text-warmgray-500 hover:bg-white/90'}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="text-sm text-warmgray-400">{filteredRoutes.length} {t('admin_routes_count')}</span>
        <div className="flex-1" />
        <button className="btn-primary" onClick={() => setShowNewRoute(true)}>
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
            <div className="flex items-center gap-3 flex-wrap">
              {/* Applicant node */}
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-10 h-10 rounded-full bg-surface-200 border-2 border-surface-300 flex items-center justify-center text-sm font-bold text-warmgray-600">申</div>
                <span className="text-[10px] text-warmgray-400">{lang === 'en' ? 'Applicant' : '申請者'}</span>
              </div>

              {route.steps.length === 0 ? (
                <p className="text-xs text-warmgray-400 italic ml-2">{t('admin_no_steps')}</p>
              ) : (
                route.steps.map((step) => (
                  <div key={step.id} className="flex items-center gap-3">
                    <ChainArrow />
                    <div className="flex flex-col items-center gap-1 group/step relative">
                      {/* Avatar or step number */}
                      <div className="relative">
                        {step.approver_avatar ? (
                          <img
                            src={step.approver_avatar}
                            alt={step.approver_name ?? ''}
                            className="w-10 h-10 rounded-full object-cover ring-2 ring-white shadow-sm"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-ringo-400 to-ringo-600 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                            {step.approver_name ? step.approver_name.slice(0, 1) : step.step_order}
                          </div>
                        )}
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
                              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] items-center justify-center hidden group-hover/step:flex shadow-sm"
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
                      </div>
                    </div>
                  </div>
                ))
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
                      { value: 'APPROVE', label: 'APPROVE' },
                      { value: 'CONFIRM', label: 'CONFIRM' },
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
}

const STATUS_BADGE: Record<string, string> = {
  PENDING_APPROVAL: 'badge-pending',
  APPROVED:         'badge-approved',
  REJECTED:         'badge-rejected',
  RETURNED:         'badge-returned',
  DRAFT:            'badge-draft',
  CANCELLED:        'badge-draft',
};

// STATUS_LABEL now computed dynamically in ApplicationsTab using t() for language support

const PAGE_APPS = 30;

function ApplicationsTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const queryClient = useQueryClient();
  const { t } = useLang();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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
  } = useInfiniteQuery<{ items: AppRecord[]; hasMore: boolean; offset: number }>({
    queryKey: ['admin', 'applications', debouncedSearch, deptFilter, statusFilter],
    queryFn: async ({ pageParam = 0 }) => (await apiClient.get(
      `/admin/applications?search=${encodeURIComponent(debouncedSearch)}&dept=${encodeURIComponent(deptFilter)}&status=${encodeURIComponent(statusFilter)}&limit=${PAGE_APPS}&offset=${pageParam}`
    )).data,
    initialPageParam: 0,
    getNextPageParam: (last, all) => last.hasMore ? all.length * PAGE_APPS : undefined,
    staleTime: 30_000,
  });

  const apps = data?.pages.flatMap(p => p.items) ?? [];

  const sentinelRef = useScrollEnd(
    useCallback(() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }, [hasNextPage, isFetchingNextPage, fetchNextPage]),
    hasNextPage ?? false,
  );

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['admin', 'departments'],
    queryFn: async () => (await apiClient.get('/admin/departments')).data,
  });

  const deleteApp = useMutation({
    mutationFn: async (id: string) => (await apiClient.delete(`/admin/applications/${id}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'applications'] });
      setConfirmingId(null);
      showToast('申請を削除しました');
    },
    onError: (err: any) => showToast(`削除失敗: ${err.message}`, 'error'),
  });

  // Language-aware status labels (reuses status_* keys already in i18n)
  const statusLabels: Record<string, string> = {
    PENDING_APPROVAL: t('status_pending'),
    APPROVED:         t('status_approved'),
    REJECTED:         t('status_rejected'),
    RETURNED:         t('status_returned'),
    DRAFT:            t('status_draft'),
    CANCELLED:        t('status_cancelled'),
  };

  const hasActiveFilter = !!(search || deptFilter || statusFilter);

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          className="input max-w-xs"
          placeholder={t('admin_apps_search_ph')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <CustomSelect
          className="w-40"
          options={[
            { value: '', label: t('admin_filter_all_dept') },
            ...departments.map((d) => ({ value: d.name, label: d.name })),
          ]}
          value={deptFilter}
          onChange={setDeptFilter}
        />
        <CustomSelect
          className="w-36"
          options={[
            { value: '', label: t('admin_filter_all_status') },
            ...Object.entries(statusLabels).map(([k, v]) => ({ value: k, label: v })),
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <span className="text-sm text-warmgray-400">
          {apps.length}{hasNextPage ? '+' : ''} {t('admin_apps_count')}
        </span>
        {hasActiveFilter && (
          <button
            className="text-xs text-ringo-500 hover:text-ringo-700 font-semibold"
            onClick={() => { setSearch(''); setDeptFilter(''); setStatusFilter(''); }}
          >
            {t('admin_clear_filter')}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="text-warmgray-400 text-sm py-8 text-center">読み込み中...</div>
      ) : (
        <div className="card !p-0 overflow-hidden">
          <table className="table-base">
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
                  className="animate-fade-up"
                  style={{ animationDelay: `${Math.min(i, 14) * 35}ms` }}
                >
                  <td><span className="font-mono text-[11px] text-warmgray-500">{a.application_number ?? '—'}</span></td>
                  <td className="font-semibold text-warmgray-800">{a.template_name}</td>
                  <td>
                    <div>
                      <p className="text-sm font-medium text-warmgray-800">{a.applicant_name}</p>
                      <p className="text-[10px] text-warmgray-400">{a.applicant_email}</p>
                    </div>
                  </td>
                  <td className="text-warmgray-500 text-xs">{a.department_name ?? '—'}</td>
                  <td>
                    <span className={STATUS_BADGE[a.status] ?? 'badge-draft'}>
                      {statusLabels[a.status] ?? a.status}
                    </span>
                  </td>
                  <td className="text-[11px] text-warmgray-400">{new Date(a.created_at).toLocaleDateString('ja-JP')}</td>
                  <td>
                    <InlineConfirm
                      isActive={confirmingId === a.id}
                      onTrigger={() => setConfirmingId(a.id)}
                      onConfirm={() => deleteApp.mutate(a.id)}
                      onCancel={() => setConfirmingId(null)}
                      message="完全削除しますか？"
                      confirmLabel="完全削除"
                      triggerClass="text-xs text-warmgray-400 hover:text-red-500 transition-colors font-medium"
                      disabled={deleteApp.isPending}
                    />
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
                <>
                  <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  読み込み中...
                </>
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

function PermissionsTab() {
  const { t, lang } = useLang();

  const check = (v: boolean) =>
    v ? (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 text-xs font-bold">✓</span>
    ) : (
      <span className="text-surface-300 text-lg font-light">—</span>
    );

  return (
    <div className="space-y-6">
      {/* Hint banner */}
      <div className="animate-fade-up flex items-start gap-3 bg-mustard-400/10 border border-mustard-400/30 rounded-2xl px-5 py-4">
        <span className="text-xl">💡</span>
        <p className="text-sm text-warmgray-700">{t('admin_perms_hint')}</p>
      </div>

      {/* Permissions table */}
      <div className="card !p-0 overflow-hidden">
        <table className="table-base">
          <thead>
            <tr>
              <th>{t('admin_perms_col_role')}</th>
              <th>{t('admin_perms_col_display')}</th>
              <th className="text-center">{t('admin_perms_col_submit')}</th>
              <th className="text-center">{t('admin_perms_col_approve')}</th>
              <th className="text-center">{t('admin_perms_col_settle')}</th>
              <th className="text-center">{t('admin_perms_col_admin')}</th>
              <th>{t('admin_perms_col_pages')}</th>
            </tr>
          </thead>
          <tbody>
            {(Object.entries(ROLE_MAP) as [Role, typeof ROLE_MAP[Role]][])
              .filter(([, p]) => !p.legacy)
              .map(([role, p], i) => (
              <tr
                key={role}
                className="animate-fade-up"
                style={{ animationDelay: `${i * 45}ms` }}
              >
                {/* Role badge */}
                <td>
                  <RoleBadge role={role} />
                </td>

                {/* Display name + description (bilingual) */}
                <td>
                  <div className="font-semibold text-warmgray-800 text-sm">
                    {lang === 'en' ? p.label_en : p.label}
                  </div>
                  <div className="text-[11px] text-warmgray-400 mt-0.5 max-w-xs">
                    {lang === 'en' ? p.description_en : p.description}
                  </div>
                </td>

                {/* Permission flags */}
                <td className="text-center">{check(p.canSubmit)}</td>
                <td className="text-center">{check(p.canApprove)}</td>
                <td className="text-center">{check(p.canSettle)}</td>
                <td className="text-center">{check(p.canAdmin)}</td>

                {/* Accessible pages */}
                <td>
                  <div className="flex flex-wrap gap-1">
                    {p.navItems.map((nav) => (
                      <span
                        key={nav.to}
                        className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-surface-100/80 text-warmgray-600 border border-surface-200/80"
                      >
                        <span className="text-[10px] leading-none">{nav.icon}</span>
                        {nav.label}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

// ─── Main ─────────────────────────────────────────────────────────────────────

type Tab = 'routes' | 'users' | 'applications' | 'permissions';

export default function Admin() {
  const [tab, setTab] = useState<Tab>('routes');
  const { t } = useLang();
  const { toast, show: showToast, dismiss } = useToast();

  const TAB_CONFIG: { key: Tab; label: string; icon: string }[] = [
    { key: 'routes',       label: t('admin_routes_tab'),  icon: '🔀' },
    { key: 'users',        label: t('admin_users_tab'),   icon: '👥' },
    { key: 'applications', label: t('admin_apps_tab'),    icon: '📋' },
    { key: 'permissions',  label: t('admin_perms_tab'),   icon: '🛡️' },
  ];

  return (
    <Layout title={t('title_admin')}>
      {toast && <Toast {...toast} onDismiss={dismiss} />}

      <div className="max-w-5xl mx-auto space-y-6">
        {/* Pill tab bar */}
        <div className="animate-fade-up inline-flex items-center gap-1 bg-white/50 backdrop-blur-sm border border-white/70 rounded-2xl p-1.5 shadow-sm">
          {TAB_CONFIG.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-150 ${
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

        <div key={tab} className="animate-fade-up">
          {tab === 'routes'       && <RoutesTab showToast={showToast} />}
          {tab === 'users'        && <UsersTab showToast={showToast} />}
          {tab === 'applications' && <ApplicationsTab showToast={showToast} />}
          {tab === 'permissions'  && <PermissionsTab />}
        </div>
      </div>
    </Layout>
  );
}
