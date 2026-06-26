import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import apiClient from '../../services/apiClient';
import { ROLE_MAP, type Role } from '../../config/permissions';
import RingoLoader from '../common/RingoLoader';
import { useLang } from '../../context/LanguageContext';
import { RoleBadge } from './RoleBadge';

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

export default function PermissionsTab({ showToast }: { showToast: (msg: string, type?: 'success' | 'error' | 'info') => void }) {
  const { t, lang } = useLang();
  const queryClient = useQueryClient();

  const { data: dbPerms, isLoading } = useQuery<Record<string, PermRowDraft>>({
    queryKey: ['admin-role-permissions'],
    queryFn: async () => (await apiClient.get('/admin/role-permissions')).data,
    staleTime: 0,
  });

  const showLoader = useDelayedLoading(isLoading);

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

  if (showLoader) {
    return <RingoLoader.Block />;
  }
  if (isLoading) return null; // loader-delay window — blank, never flash empty UI while fetching

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
