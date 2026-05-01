import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import { ROLE_MAP, Role } from '../config/permissions';
import ConfirmDialog from '../components/common/ConfirmDialog';
import Toast, { useToast } from '../components/common/Toast';

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
  department_name: string;
  steps: RouteStep[];
}

interface Template { id: string; code: string; title_ja: string }

const ROLES = ['EMPLOYEE', 'MANAGER', 'GM', 'SOUMU', 'SENMU', 'PRESIDENT', 'ACCOUNTING', 'ADMIN'];

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
              {isNew ? 'ユーザー新規作成' : 'プロフィール編集'}
            </h3>
            {!isNew && <p className="text-xs text-warmgray-400">{user?.email}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">氏名 *</label>
            <input className="input" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="label">メールアドレス *</label>
            <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="label">{isNew ? 'パスワード' : '新しいパスワード (変更する場合のみ)'}</label>
            <input className="input" type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="••••••••" />
          </div>
          <div>
            <label className="label">ロール</label>
            <select className="input" value={form.role} onChange={(e) => set('role', e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="label">部署</label>
            <select className="input" value={form.department_id} onChange={(e) => set('department_id', e.target.value)}>
              <option value="">— 未設定 —</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
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
              <label htmlFor="is_active" className="text-sm font-medium text-warmgray-700">アカウント有効</label>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button className="btn-outline" onClick={onClose}>キャンセル</button>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={isSaving || !form.full_name || !form.email}
          >
            {isSaving ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const queryClient = useQueryClient();
  const [editUser, setEditUser] = useState<User | null | 'new'>(null);
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

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
      setDeleteTarget(null);
      showToast(data.message);
    },
    onError: (err: any) => showToast(`削除失敗: ${err.message}`, 'error'),
  });

  const filtered = search
    ? users.filter((u) =>
        u.full_name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        u.role.includes(search.toUpperCase())
      )
    : users;

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

      {/* Delete confirm — 3 options: hard delete / disable / cancel */}
      {deleteTarget && (
        <ConfirmDialog
          isOpen={true}
          title={`「${deleteTarget.full_name}」を削除`}
          message="完全削除するとユーザーのデータが失われます。無効化の場合はログインできなくなりますが、データは保持されます。"
          confirmLabel="完全削除する"
          confirmClass="btn-danger"
          cancelLabel="キャンセル"
          onConfirm={() => deleteUser.mutate({ id: deleteTarget.id, hard: true })}
          onCancel={() => setDeleteTarget(null)}
          extraActions={
            <button
              className="btn-outline w-full"
              onClick={() => deleteUser.mutate({ id: deleteTarget.id, hard: false })}
            >
              無効化のみ（データ保持）
            </button>
          }
        />
      )}

      <div className="flex items-center gap-3 mb-5">
        <input
          className="input max-w-xs"
          placeholder="氏名 / メール / ロールで検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-sm text-warmgray-400">{filtered.length} 名</span>
        <div className="flex-1" />
        <button className="btn-primary" onClick={() => setEditUser('new')}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          ユーザー追加
        </button>
      </div>

      {isLoading ? (
        <div className="text-warmgray-400 text-sm py-8 text-center">読み込み中...</div>
      ) : (
        <div className="card !p-0 overflow-hidden">
          <table className="table-base">
            <thead>
              <tr>
                <th>ユーザー</th>
                <th>ロール</th>
                <th>部署</th>
                <th>状態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
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
                      {u.is_active ? '有効' : '無効'}
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
                      <button
                        className="text-xs text-warmgray-400 hover:text-red-500 transition-colors"
                        onClick={() => setDeleteTarget(u)}
                      >
                        削除
                      </button>
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
  const [addingStepToRoute, setAddingStepToRoute] = useState<string | null>(null);
  const [newStep, setNewStep] = useState({ approver_id: '', label: '', action_type: 'APPROVE' });
  const [showNewRoute, setShowNewRoute] = useState(false);
  const [newRoute, setNewRoute] = useState({ template_id: '', department_id: '', name: '', stage: 'RINGI' });
  const [deleteRouteTarget, setDeleteRouteTarget] = useState<ApprovalRoute | null>(null);
  const [deleteStepTarget, setDeleteStepTarget] = useState<{ id: string; label: string } | null>(null);

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
    onSuccess: () => { refetch(); setDeleteStepTarget(null); showToast('ステップを削除しました'); },
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
    onSuccess: () => { refetch(); setDeleteRouteTarget(null); showToast('ルートを削除しました'); },
    onError: (err: any) => showToast(`削除失敗: ${err.message}`, 'error'),
  });

  if (isLoading) return <div className="text-warmgray-400 text-sm py-8 text-center">読み込み中...</div>;

  return (
    <div className="space-y-4">
      {/* Confirm dialogs */}
      {deleteRouteTarget && (
        <ConfirmDialog
          isOpen={true}
          title={`ルート「${deleteRouteTarget.name}」を削除`}
          message="このルートとすべてのステップが完全に削除されます。この操作は元に戻せません。"
          confirmLabel="削除する"
          onConfirm={() => deleteRoute.mutate(deleteRouteTarget.id)}
          onCancel={() => setDeleteRouteTarget(null)}
        />
      )}
      {deleteStepTarget && (
        <ConfirmDialog
          isOpen={true}
          title="ステップを削除"
          message={`「${deleteStepTarget.label}」を承認ルートから削除します。`}
          confirmLabel="削除する"
          onConfirm={() => deleteStep.mutate(deleteStepTarget.id)}
          onCancel={() => setDeleteStepTarget(null)}
        />
      )}

      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setShowNewRoute(true)}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          ルート追加
        </button>
      </div>

      {/* New route form */}
      {showNewRoute && (
        <div className="card border-2 border-ringo-300/50 space-y-4 animate-scale-in">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 rounded-full bg-gradient-to-b from-ringo-400 to-mustard-500" />
            <h4 className="font-bold text-warmgray-800">新規承認ルート</h4>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">テンプレート</label>
              <select className="input" value={newRoute.template_id} onChange={(e) => setNewRoute({ ...newRoute, template_id: e.target.value })}>
                <option value="">選択...</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.title_ja}</option>)}
              </select>
            </div>
            <div>
              <label className="label">部署</label>
              <select className="input" value={newRoute.department_id} onChange={(e) => setNewRoute({ ...newRoute, department_id: e.target.value })}>
                <option value="">選択...</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">ステージ</label>
              <select className="input" value={newRoute.stage} onChange={(e) => setNewRoute({ ...newRoute, stage: e.target.value })}>
                <option value="RINGI">RINGI（稟議）</option>
                <option value="SETTLEMENT">SETTLEMENT（精算）</option>
              </select>
            </div>
            <div>
              <label className="label">ルート名</label>
              <input className="input" placeholder="例: 総務部 出張稟議" value={newRoute.name} onChange={(e) => setNewRoute({ ...newRoute, name: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-ghost" onClick={() => setShowNewRoute(false)}>キャンセル</button>
            <button
              className="btn-primary"
              onClick={() => createRoute.mutate(newRoute)}
              disabled={!newRoute.template_id || !newRoute.department_id || !newRoute.name || createRoute.isPending}
            >
              {createRoute.isPending ? '作成中...' : '作成する'}
            </button>
          </div>
        </div>
      )}

      {/* Route cards */}
      {routes.map((route) => (
        <div key={route.id} className="card space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${route.stage === 'RINGI' ? 'bg-ringo-500 text-white' : 'bg-mustard-500 text-white'}`}>
                  {route.stage}
                </span>
                <h4 className="font-bold text-warmgray-800">{route.name}</h4>
                {!route.is_active && (
                  <span className="text-[10px] text-warmgray-500 bg-surface-100 border border-surface-200 px-2 py-0.5 rounded-full">無効</span>
                )}
              </div>
              <p className="text-[11px] text-warmgray-400">{route.template_name} · {route.department_name}</p>
            </div>
            <button
              className="text-[11px] text-warmgray-400 hover:text-red-500 transition-colors font-medium"
              onClick={() => setDeleteRouteTarget(route)}
            >
              削除
            </button>
          </div>

          {/* Visual chain with avatars */}
          <div className="bg-surface-50/60 rounded-2xl p-4">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Applicant node */}
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-10 h-10 rounded-full bg-surface-200 border-2 border-surface-300 flex items-center justify-center text-sm font-bold text-warmgray-600">申</div>
                <span className="text-[10px] text-warmgray-400">申請者</span>
              </div>

              {route.steps.length === 0 ? (
                <p className="text-xs text-warmgray-400 italic ml-2">ステップが未設定です</p>
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
                        {/* Delete button (hover) */}
                        {step.step_order > 1 && (
                          <button
                            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] items-center justify-center hidden group-hover/step:flex shadow-sm"
                            onClick={() => setDeleteStepTarget({ id: step.id, label: step.label })}
                            title="削除"
                          >
                            ×
                          </button>
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
                  <span className="text-[10px] text-warmgray-400">完了</span>
                </div>
              </div>
            </div>
          </div>

          {/* Add step */}
          {addingStepToRoute === route.id ? (
            <div className="bg-surface-50/60 rounded-2xl p-4 space-y-3 border-2 border-dashed border-ringo-200">
              <p className="text-xs font-bold text-warmgray-700 uppercase tracking-wide">ステップ追加</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">承認者</label>
                  <select className="input text-xs py-2" value={newStep.approver_id} onChange={(e) => setNewStep({ ...newStep, approver_id: e.target.value })}>
                    <option value="">選択...</option>
                    {users.filter((u) => u.is_active).map((u) => (
                      <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">ステップ名</label>
                  <input className="input text-xs py-2" placeholder="例: 総務承認" value={newStep.label} onChange={(e) => setNewStep({ ...newStep, label: e.target.value })} />
                </div>
                <div>
                  <label className="label">アクション</label>
                  <select className="input text-xs py-2" value={newStep.action_type} onChange={(e) => setNewStep({ ...newStep, action_type: e.target.value })}>
                    <option value="APPROVE">APPROVE</option>
                    <option value="CONFIRM">CONFIRM</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button className="btn-ghost text-xs" onClick={() => setAddingStepToRoute(null)}>キャンセル</button>
                <button
                  className="btn-primary text-xs"
                  disabled={!newStep.approver_id || addStep.isPending}
                  onClick={() => addStep.mutate({ routeId: route.id, ...newStep })}
                >
                  {addStep.isPending ? '追加中...' : 'ステップ追加'}
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
              ステップを追加する
            </button>
          )}
        </div>
      ))}

      {routes.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-20 gap-4 text-warmgray-400">
          <span className="text-5xl">🗂️</span>
          <p className="text-sm">承認ルートがまだありません</p>
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

const STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: '承認待ち',
  APPROVED:         '承認済み',
  REJECTED:         '却下',
  RETURNED:         '差し戻し',
  DRAFT:            '下書き',
  CANCELLED:        'キャンセル',
};

function ApplicationsTab({ showToast }: { showToast: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AppRecord | null>(null);

  const { data: apps = [], isLoading } = useQuery<AppRecord[]>({
    queryKey: ['admin', 'applications'],
    queryFn: async () => (await apiClient.get('/admin/applications')).data,
  });

  const deleteApp = useMutation({
    mutationFn: async (id: string) => (await apiClient.delete(`/admin/applications/${id}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'applications'] });
      setDeleteTarget(null);
      showToast('申請を削除しました');
    },
    onError: (err: any) => showToast(`削除失敗: ${err.message}`, 'error'),
  });

  const filtered = filter
    ? apps.filter((a) =>
        a.applicant_name?.includes(filter) ||
        a.template_name?.includes(filter) ||
        a.application_number?.includes(filter) ||
        a.status?.includes(filter.toUpperCase()),
      )
    : apps;

  return (
    <div className="space-y-5">
      {deleteTarget && (
        <ConfirmDialog
          isOpen={true}
          title={`申請「${deleteTarget.template_name}」を削除`}
          message={`${deleteTarget.applicant_name} の申請を完全削除します。この操作は元に戻せません。`}
          confirmLabel="完全削除する"
          onConfirm={() => deleteApp.mutate(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <div className="flex items-center gap-3">
        <input
          className="input max-w-sm"
          placeholder="氏名 / テンプレート / 申請番号で検索..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="text-sm text-warmgray-400">{filtered.length} 件</span>
      </div>

      {isLoading ? (
        <div className="text-warmgray-400 text-sm py-8 text-center">読み込み中...</div>
      ) : (
        <div className="card !p-0 overflow-hidden">
          <table className="table-base">
            <thead>
              <tr>
                <th>申請番号</th>
                <th>テンプレート</th>
                <th>申請者</th>
                <th>部署</th>
                <th>ステータス</th>
                <th>申請日</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
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
                      {STATUS_LABEL[a.status] ?? a.status}
                    </span>
                  </td>
                  <td className="text-[11px] text-warmgray-400">{new Date(a.created_at).toLocaleDateString('ja-JP')}</td>
                  <td>
                    <button
                      className="text-xs text-warmgray-400 hover:text-red-500 transition-colors font-medium"
                      onClick={() => setDeleteTarget(a)}
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-warmgray-400 text-sm">申請データがありません</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Role Permissions Tab ─────────────────────────────────────────────────────

function PermissionsTab() {
  const check = (v: boolean) =>
    v ? (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 text-xs font-bold">✓</span>
    ) : (
      <span className="text-surface-300 text-lg font-light">—</span>
    );

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 bg-mustard-400/10 border border-mustard-400/30 rounded-2xl px-5 py-4">
        <span className="text-xl">💡</span>
        <p className="text-sm text-warmgray-700">
          ロールは<strong>ユーザー管理</strong>タブで個別に変更できます。変更後、対象ユーザーは再ログインが必要です。
        </p>
      </div>

      <div className="card !p-0 overflow-hidden">
        <table className="table-base">
          <thead>
            <tr>
              <th>ロール</th>
              <th>表示名 / 説明</th>
              <th className="text-center">申請</th>
              <th className="text-center">承認</th>
              <th className="text-center">経理</th>
              <th className="text-center">管理</th>
            </tr>
          </thead>
          <tbody>
            {(Object.entries(ROLE_MAP) as [Role, typeof ROLE_MAP[Role]][]).map(([role, p]) => (
              <tr key={role}>
                <td><RoleBadge role={role} /></td>
                <td>
                  <div className="font-semibold text-warmgray-800 text-sm">{p.label}</div>
                  <div className="text-[11px] text-warmgray-400 mt-0.5">{p.description}</div>
                </td>
                <td className="text-center">{check(p.canSubmit)}</td>
                <td className="text-center">{check(p.canApprove)}</td>
                <td className="text-center">{check(p.canSettle)}</td>
                <td className="text-center">{check(p.canAdmin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { icon: '🔑', title: 'Google ログイン', body: '初回サインインユーザーは EMPLOYEE に自動設定されます' },
          { icon: '🔄', title: 'ロール変更', body: '次回ログイン時に反映（JWT 再発行が必要）' },
          { icon: '📋', title: '承認ルート', body: '各ステップには特定ユーザーを割り当て（管理者が設定）' },
          { icon: '🛡️', title: 'ADMIN 特権', body: '全ステップを代理承認できます' },
        ].map((item) => (
          <div key={item.title} className="card-sm flex items-start gap-3">
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

const TAB_CONFIG: { key: Tab; label: string; icon: string }[] = [
  { key: 'routes',       label: '承認ルート', icon: '🔀' },
  { key: 'users',        label: 'ユーザー管理', icon: '👥' },
  { key: 'applications', label: '申請管理',   icon: '📋' },
  { key: 'permissions',  label: 'ロール権限', icon: '🛡️' },
];

export default function Admin() {
  const [tab, setTab] = useState<Tab>('routes');
  const { toast, show: showToast, dismiss } = useToast();

  return (
    <Layout title="管理画面">
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

        <div className="animate-fade-up">
          {tab === 'routes'       && <RoutesTab showToast={showToast} />}
          {tab === 'users'        && <UsersTab showToast={showToast} />}
          {tab === 'applications' && <ApplicationsTab showToast={showToast} />}
          {tab === 'permissions'  && <PermissionsTab />}
        </div>
      </div>
    </Layout>
  );
}
