import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../services/apiClient';
import Layout from '../components/common/Layout';
import { ROLE_MAP, Role } from '../config/permissions';

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  department_name?: string;
  department_id?: string;
}

interface Department {
  id: string;
  name: string;
  code: string;
}

interface RouteStep {
  id: string;
  step_order: number;
  label: string;
  action_type: string;
  approver_name?: string;
  approver_id?: string;
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

interface Template {
  id: string;
  code: string;
  title_ja: string;
}

const ROLES = ['EMPLOYEE', 'MANAGER', 'GM', 'SOUMU', 'SENMU', 'PRESIDENT', 'ACCOUNTING', 'ADMIN'];

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
    full_name: user?.full_name ?? '',
    email: user?.email ?? '',
    password: '',
    role: user?.role ?? 'EMPLOYEE',
    department_id: user?.department_id ?? '',
    is_active: user?.is_active ?? true,
  });

  const set = (k: string, v: any) => setForm((p) => ({ ...p, [k]: v }));

  const handleSave = () => {
    const payload: Record<string, any> = { ...form, department_id: form.department_id || null };
    if (!payload.password) delete payload.password;
    onSave(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-warmgray-900/40 px-4">
      <div className="card w-full max-w-lg space-y-4">
        <h3 className="text-lg font-bold text-warmgray-800">{isNew ? 'ユーザー新規作成' : 'プロフィール編集'}</h3>

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
            <div className="col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={form.is_active}
                onChange={(e) => set('is_active', e.target.checked)}
                className="w-4 h-4 accent-ringo-500"
              />
              <label htmlFor="is_active" className="text-sm text-warmgray-800">アカウント有効</label>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-tertiary" onClick={onClose}>キャンセル</button>
          <button className="btn-primary" onClick={handleSave} disabled={isSaving || !form.full_name || !form.email}>
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  const queryClient = useQueryClient();
  const [editUser, setEditUser] = useState<User | null | 'new'>( null);

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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }); setEditUser(null); },
    onError: (err: any) => alert(`作成失敗: ${err.message}`),
  });

  const deleteUser = useMutation({
    mutationFn: async ({ id, hard }: { id: string; hard: boolean }) =>
      (await apiClient.delete(`/admin/users/${id}${hard ? '?hard=true' : ''}`)).data,
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }); alert(data.message); },
    onError: (err: any) => alert(`削除失敗: ${err.message}`),
  });

  const updateUser = useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Record<string, any>) =>
      (await apiClient.patch(`/admin/users/${id}`, patch)).data,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }); setEditUser(null); },
    onError: (err: any) => alert(`更新失敗: ${err.message}`),
  });

  if (isLoading) return <p className="text-warmgray-600">読み込み中...</p>;

  return (
    <>
      {(editUser === 'new') && (
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

      <div className="flex justify-end mb-4">
        <button className="btn-primary" onClick={() => setEditUser('new')}>＋ ユーザー追加</button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ringo-200 text-left text-warmgray-600">
              <th className="pb-3 pr-4">氏名</th>
              <th className="pb-3 pr-4">メール</th>
              <th className="pb-3 pr-4">ロール</th>
              <th className="pb-3 pr-4">部署</th>
              <th className="pb-3 pr-4">状態</th>
              <th className="pb-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ringo-200">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-cream-100">
                <td className="py-3 pr-4 font-semibold text-warmgray-800">{u.full_name}</td>
                <td className="py-3 pr-4 text-warmgray-600 text-xs">{u.email}</td>
                <td className="py-3 pr-4">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-ringo-100 text-ringo-700">{u.role}</span>
                </td>
                <td className="py-3 pr-4 text-warmgray-600">{u.department_name ?? '—'}</td>
                <td className="py-3 pr-4">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-warmgray-200 text-warmgray-600'}`}>
                    {u.is_active ? '有効' : '無効'}
                  </span>
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-3">
                    <button className="text-xs text-ringo-600 hover:text-ringo-700 font-semibold" onClick={() => setEditUser(u)}>
                      編集
                    </button>
                    <button
                      className="text-xs text-ringo-400 hover:text-ringo-600"
                      onClick={() => {
                        const hard = confirm(`「${u.full_name}」を完全削除しますか？\n\n「キャンセル」で無効化のみ行います。`);
                        deleteUser.mutate({ id: u.id, hard });
                      }}
                    >
                      削除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Routes Tab ───────────────────────────────────────────────────────────────

function RoutesTab() {
  const queryClient = useQueryClient();
  const [addingStepToRoute, setAddingStepToRoute] = useState<string | null>(null);
  const [newStep, setNewStep] = useState({ approver_id: '', label: '', action_type: 'APPROVE' });
  const [showNewRoute, setShowNewRoute] = useState(false);
  const [newRoute, setNewRoute] = useState({ template_id: '', department_id: '', name: '', stage: 'RINGI' });

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

  const addStep = useMutation({
    mutationFn: async ({ routeId, ...step }: { routeId: string; approver_id: string; label: string; action_type: string }) =>
      (await apiClient.post(`/admin/routes/${routeId}/steps`, step)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'routes'] });
      setAddingStepToRoute(null);
      setNewStep({ approver_id: '', label: '', action_type: 'APPROVE' });
    },
    onError: (err: any) => alert(`ステップ追加失敗: ${err.message}`),
  });

  const deleteStep = useMutation({
    mutationFn: async (stepId: string) => (await apiClient.delete(`/admin/route-steps/${stepId}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'routes'] }),
    onError: (err: any) => alert(`削除失敗: ${err.message}`),
  });

  const createRoute = useMutation({
    mutationFn: async (route: typeof newRoute) => (await apiClient.post('/admin/routes', route)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'routes'] });
      setShowNewRoute(false);
      setNewRoute({ template_id: '', department_id: '', name: '', stage: 'RINGI' });
    },
    onError: (err: any) => alert(`ルート作成失敗: ${err.message}`),
  });

  const deleteRoute = useMutation({
    mutationFn: async (id: string) => (await apiClient.delete(`/admin/routes/${id}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'routes'] }),
    onError: (err: any) => alert(`削除失敗: ${err.message}`),
  });

  if (isLoading) return <p className="text-warmgray-600">読み込み中...</p>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setShowNewRoute(true)}>＋ ルート追加</button>
      </div>

      {showNewRoute && (
        <div className="card border-2 border-ringo-500 space-y-3">
          <h4 className="font-bold text-warmgray-800">新規承認ルート</h4>
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
                <option value="RINGI">RINGI (稟議)</option>
                <option value="SETTLEMENT">SETTLEMENT (精算)</option>
              </select>
            </div>
            <div>
              <label className="label">ルート名</label>
              <input className="input" placeholder="例: 出張伺い / DX / 稟議" value={newRoute.name} onChange={(e) => setNewRoute({ ...newRoute, name: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-tertiary" onClick={() => setShowNewRoute(false)}>キャンセル</button>
            <button
              className="btn-primary"
              onClick={() => createRoute.mutate(newRoute)}
              disabled={!newRoute.template_id || !newRoute.department_id || !newRoute.name || createRoute.isPending}
            >
              作成
            </button>
          </div>
        </div>
      )}

      {routes.map((route) => (
        <div key={route.id} className="card space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${route.stage === 'RINGI' ? 'bg-ringo-500 text-white' : 'bg-mustard-500 text-white'}`}>
                  {route.stage}
                </span>
                <h4 className="font-bold text-warmgray-800">{route.name}</h4>
                {!route.is_active && <span className="text-xs text-warmgray-600 bg-cream-300 px-2 py-0.5 rounded">無効</span>}
              </div>
              <p className="text-xs text-warmgray-600 mt-0.5">{route.template_name} / {route.department_name}</p>
            </div>
            <button
              className="text-xs text-ringo-500 hover:text-ringo-700"
              onClick={() => { if (confirm('このルートを削除しますか？')) deleteRoute.mutate(route.id); }}
            >
              削除
            </button>
          </div>

          <div className="space-y-2">
            {route.steps.map((step, i) => (
              <div key={step.id} className="flex items-center gap-3 bg-cream-100 rounded px-3 py-2">
                <span className="w-6 h-6 rounded-full bg-ringo-500 text-white text-xs flex items-center justify-center font-bold shrink-0">
                  {step.step_order}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-warmgray-800 truncate">{step.label}</p>
                  <p className="text-xs text-warmgray-600">{step.approver_name ?? '(未割当)'} · {step.action_type}</p>
                </div>
                {i > 0 && (
                  <button className="text-xs text-ringo-500 hover:text-ringo-700 shrink-0" onClick={() => deleteStep.mutate(step.id)}>
                    削除
                  </button>
                )}
              </div>
            ))}
          </div>

          {addingStepToRoute === route.id ? (
            <div className="bg-cream-100 rounded p-3 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="label text-xs">承認者</label>
                  <select className="input text-xs py-1" value={newStep.approver_id} onChange={(e) => setNewStep({ ...newStep, approver_id: e.target.value })}>
                    <option value="">選択...</option>
                    {users.filter((u) => u.is_active).map((u) => (
                      <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label text-xs">ステップ名</label>
                  <input className="input text-xs py-1" placeholder="例: 総務承認" value={newStep.label} onChange={(e) => setNewStep({ ...newStep, label: e.target.value })} />
                </div>
                <div>
                  <label className="label text-xs">アクション</label>
                  <select className="input text-xs py-1" value={newStep.action_type} onChange={(e) => setNewStep({ ...newStep, action_type: e.target.value })}>
                    <option value="APPROVE">APPROVE</option>
                    <option value="CONFIRM">CONFIRM</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button className="btn-tertiary text-xs" onClick={() => setAddingStepToRoute(null)}>キャンセル</button>
                <button
                  className="btn-primary text-xs"
                  disabled={!newStep.approver_id || addStep.isPending}
                  onClick={() => addStep.mutate({ routeId: route.id, ...newStep })}
                >
                  追加
                </button>
              </div>
            </div>
          ) : (
            <button className="text-xs text-ringo-600 hover:text-ringo-700 font-semibold" onClick={() => setAddingStepToRoute(route.id)}>
              ＋ ステップ追加
            </button>
          )}
        </div>
      ))}

      {routes.length === 0 && (
        <div className="card text-center text-warmgray-600 py-8">
          承認ルートがまだありません。「＋ ルート追加」から作成してください。
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
  form_data: Record<string, any>;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING_APPROVAL: 'bg-mustard-500 text-white',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-ringo-100 text-ringo-700',
  RETURNED: 'bg-orange-100 text-orange-700',
  DRAFT: 'bg-cream-300 text-warmgray-600',
  CANCELLED: 'bg-warmgray-200 text-warmgray-500',
};

function ApplicationsTab() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');

  const { data: apps = [], isLoading } = useQuery<AppRecord[]>({
    queryKey: ['admin', 'applications'],
    queryFn: async () => (await apiClient.get('/admin/applications')).data,
  });

  const deleteApp = useMutation({
    mutationFn: async (id: string) => (await apiClient.delete(`/admin/applications/${id}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'applications'] }),
    onError: (err: any) => alert(`削除失敗: ${err.message}`),
  });

  const filtered = filter
    ? apps.filter((a) =>
        a.applicant_name?.includes(filter) ||
        a.template_name?.includes(filter) ||
        a.application_number?.includes(filter) ||
        a.status?.includes(filter.toUpperCase()),
      )
    : apps;

  if (isLoading) return <p className="text-warmgray-600">読み込み中...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          className="input max-w-xs"
          placeholder="氏名 / テンプレート / 申請番号で検索..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="text-sm text-warmgray-600">{filtered.length} 件</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ringo-200 text-left text-warmgray-600">
              <th className="pb-3 pr-3">申請番号</th>
              <th className="pb-3 pr-3">テンプレート</th>
              <th className="pb-3 pr-3">申請者</th>
              <th className="pb-3 pr-3">部署</th>
              <th className="pb-3 pr-3">ステータス</th>
              <th className="pb-3 pr-3">申請日</th>
              <th className="pb-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ringo-200">
            {filtered.map((a) => (
              <tr key={a.id} className="hover:bg-cream-100">
                <td className="py-2.5 pr-3 font-mono text-xs text-warmgray-600">
                  {a.application_number ?? '—'}
                </td>
                <td className="py-2.5 pr-3 font-semibold text-warmgray-800">{a.template_name}</td>
                <td className="py-2.5 pr-3">
                  <div className="text-warmgray-800">{a.applicant_name}</div>
                  <div className="text-xs text-warmgray-600">{a.applicant_email}</div>
                </td>
                <td className="py-2.5 pr-3 text-warmgray-600">{a.department_name ?? '—'}</td>
                <td className="py-2.5 pr-3">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${STATUS_COLORS[a.status] ?? 'bg-cream-300 text-warmgray-600'}`}>
                    {a.status}
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-xs text-warmgray-600">
                  {new Date(a.created_at).toLocaleDateString('ja-JP')}
                </td>
                <td className="py-2.5">
                  <button
                    className="text-xs text-ringo-500 hover:text-ringo-700 font-semibold"
                    onClick={() => {
                      if (confirm(`申請「${a.template_name}」を完全削除しますか？この操作は元に戻せません。`)) {
                        deleteApp.mutate(a.id);
                      }
                    }}
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center text-warmgray-600 py-8">申請データがありません</div>
        )}
      </div>
    </div>
  );
}

// ─── Role Permissions Tab ─────────────────────────────────────────────────────

function PermissionsTab() {
  const check = (v: boolean) => v
    ? <span className="text-green-600 font-bold">✓</span>
    : <span className="text-warmgray-400">—</span>;

  return (
    <div className="space-y-6">
      <p className="text-sm text-warmgray-600">
        ロールはユーザー管理タブで個別に変更できます。ロールを変更後、対象ユーザーは再ログインが必要です。
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-ringo-700 text-cream-50">
              <th className="text-left px-4 py-3 rounded-tl-lg">ロール</th>
              <th className="text-left px-4 py-3">表示名</th>
              <th className="px-4 py-3 text-center">申請</th>
              <th className="px-4 py-3 text-center">承認</th>
              <th className="px-4 py-3 text-center">経理</th>
              <th className="px-4 py-3 text-center rounded-tr-lg">管理</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ringo-200">
            {(Object.entries(ROLE_MAP) as [Role, typeof ROLE_MAP[Role]][]).map(([role, p]) => (
              <tr key={role} className="hover:bg-cream-100">
                <td className="px-4 py-3 font-mono text-xs font-bold text-ringo-700 bg-cream-50">{role}</td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-warmgray-800">{p.label}</div>
                  <div className="text-xs text-warmgray-600 mt-0.5">{p.description}</div>
                </td>
                <td className="px-4 py-3 text-center">{check(p.canSubmit)}</td>
                <td className="px-4 py-3 text-center">{check(p.canApprove)}</td>
                <td className="px-4 py-3 text-center">{check(p.canSettle)}</td>
                <td className="px-4 py-3 text-center">{check(p.canAdmin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card bg-mustard-400/10 border-mustard-500">
        <h4 className="font-bold text-warmgray-800 mb-2 text-sm">ロール割り当てルール</h4>
        <ul className="text-xs text-warmgray-600 space-y-1 list-disc list-inside">
          <li>Googleログインで初回サインインしたユーザーは <strong>EMPLOYEE</strong> に自動設定されます</li>
          <li>管理者がユーザー管理タブでロールを変更します</li>
          <li>ロール変更は次回ログイン時に反映されます（JWT再発行が必要）</li>
          <li>承認ルートの各ステップには特定ユーザーを割り当てます（管理者が設定）</li>
          <li><strong>ADMIN</strong> は全ステップを代理承認できます</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Tab = 'routes' | 'users' | 'applications' | 'permissions';

export default function Admin() {
  const [tab, setTab] = useState<Tab>('routes');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'routes',       label: '承認ルート' },
    { key: 'users',        label: 'ユーザー管理' },
    { key: 'applications', label: '申請管理' },
    { key: 'permissions',  label: 'ロール権限' },
  ];

  return (
    <Layout title="管理画面">
      <div className="max-w-5xl mx-auto">
        <div className="flex gap-1 mb-6 border-b border-ringo-200">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                tab === t.key ? 'border-ringo-500 text-ringo-600' : 'border-transparent text-warmgray-600 hover:text-warmgray-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'routes'       && <RoutesTab />}
        {tab === 'users'        && <UsersTab />}
        {tab === 'applications' && <ApplicationsTab />}
        {tab === 'permissions'  && <PermissionsTab />}
      </div>
    </Layout>
  );
}
