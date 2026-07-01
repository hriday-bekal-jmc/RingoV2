import { useState, useRef, useEffect, useMemo } from 'react';
import { ROLE_MAP, type Role } from '../../config/permissions';
import UserAvatar from '../common/UserAvatar';
import { RoleBadge } from './RoleBadge';
import type { User, Department } from './adminTypes';

// Approver picker — browsable people list with dept + role filters, search, and
// avatars. Scales to hundreds of users without a search-only bottleneck. All data
// is client-cached upstream (react-query), so filtering/grouping is pure compute.
export default function ApproverPicker({
  users,
  departments,
  value,
  onChange,
}: {
  users: User[];          // full set (incl. inactive) — inactive shown only if currently selected
  departments: Department[];
  value: string;          // '' = unset
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const selected = value ? byId.get(value) : undefined;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Reset transient filters each time the panel opens.
  useEffect(() => { if (open) { setSearch(''); setDeptFilter(''); setRoleFilter(''); } }, [open]);

  // Selectable set: active users, plus the currently-selected user even if inactive
  // (so an existing assignment stays visible and isn't silently dropped).
  const selectable = useMemo(
    () => users.filter((u) => u.is_active || u.id === value),
    [users, value],
  );

  // Role filter options — only roles actually present, labelled via ROLE_MAP.
  const roleOptions = useMemo(() => {
    const present = [...new Set(selectable.map((u) => u.role))];
    return present
      .map((r) => ({ value: r, label: ROLE_MAP[r as Role]?.label ?? r }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ja'));
  }, [selectable]);

  // Apply filters + search, then group by department.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = selectable.filter((u) => {
      if (deptFilter && u.department_id !== deptFilter) return false;
      if (roleFilter && u.role !== roleFilter) return false;
      if (q && !u.full_name.toLowerCase().includes(q)) return false;
      return true;
    });
    // Preserve department display order; unassigned users go last.
    const order = new Map(departments.map((d, i) => [d.id, i]));
    const buckets = new Map<string, { name: string; users: User[] }>();
    for (const u of filtered) {
      const key = u.department_id ?? '__none__';
      const name = u.department_name ?? '未所属';
      if (!buckets.has(key)) buckets.set(key, { name, users: [] });
      buckets.get(key)!.users.push(u);
    }
    return [...buckets.entries()]
      .sort((a, b) => (order.get(a[0]) ?? 9999) - (order.get(b[0]) ?? 9999))
      .map(([, g]) => ({ ...g, users: g.users.sort((x, y) => x.full_name.localeCompare(y.full_name, 'ja')) }));
  }, [selectable, departments, deptFilter, roleFilter, search]);

  const totalShown = groups.reduce((n, g) => n + g.users.length, 0);

  const pick = (id: string) => { onChange(id); setOpen(false); };

  return (
    <div ref={containerRef} className={`relative ${open ? 'dropdown-open' : ''}`}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`input flex items-center gap-2 text-left w-full transition-all duration-150 ${
          open ? 'ring-2 ring-ringo-400/40 border-ringo-300 bg-white' : 'hover:border-warmgray-300 hover:bg-white/90'
        }`}
      >
        {selected ? (
          <>
            <UserAvatar name={selected.full_name} avatarUrl={selected.avatar_url} size={6} ring="" />
            <span className="flex-1 text-sm truncate text-warmgray-800 font-medium">
              {selected.full_name}{!selected.is_active && '（無効）'}
            </span>
          </>
        ) : (
          <span className="flex-1 text-sm text-warmgray-400">─ 未設定 ─</span>
        )}
        <svg
          className={`w-4 h-4 text-warmgray-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180 text-ringo-500' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute z-50 mt-1.5 left-0 w-[min(340px,calc(100vw-24px))]
          bg-white/90 backdrop-blur-2xl border border-warmgray-200/60
          rounded-xl shadow-[0_8px_28px_rgba(60,40,20,0.16),0_2px_8px_rgba(60,40,20,0.08)]
          animate-scale-in origin-top overflow-hidden">

          {/* Search */}
          <div className="p-2 border-b border-warmgray-100">
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="名前で検索..."
              className="w-full text-sm px-3 py-2 rounded-lg border border-warmgray-200 outline-none focus:border-ringo-400 bg-white"
            />
            {/* Filters */}
            <div className="flex gap-2 mt-2">
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-lg border border-warmgray-200 bg-white text-warmgray-700 outline-none focus:border-ringo-400"
              >
                <option value="">全部署</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-lg border border-warmgray-200 bg-white text-warmgray-700 outline-none focus:border-ringo-400"
              >
                <option value="">全役職</option>
                {roleOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>

          {/* List */}
          <div className="max-h-64 overflow-y-auto overscroll-contain dropdown-scroll py-1">
            {/* Unset */}
            <button
              type="button"
              onClick={() => pick('')}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                value === '' ? 'bg-ringo-50/80 text-ringo-700 font-semibold' : 'text-warmgray-500 hover:bg-white/60'
              }`}
            >
              <span className="w-6 h-6 shrink-0 rounded-full border border-dashed border-warmgray-300 flex items-center justify-center text-warmgray-300">×</span>
              <span className="flex-1">─ 未設定 ─</span>
            </button>

            {totalShown === 0 && (
              <div className="px-3 py-4 text-sm text-warmgray-400 text-center">該当するユーザーがいません</div>
            )}

            {groups.map((g) => (
              <div key={g.name}>
                <p className="sticky top-0 bg-white/95 backdrop-blur px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-warmgray-400">
                  {g.name}
                </p>
                {g.users.map((u) => {
                  const isSelected = u.id === value;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => pick(u.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                        isSelected ? 'bg-ringo-50/80' : 'hover:bg-white/60'
                      }`}
                    >
                      <UserAvatar name={u.full_name} avatarUrl={u.avatar_url} size={7} ring="" />
                      <span className={`flex-1 min-w-0 truncate ${isSelected ? 'text-ringo-700 font-semibold' : 'text-warmgray-800'}`}>
                        {u.full_name}{!u.is_active && <span className="text-warmgray-400">（無効）</span>}
                      </span>
                      <RoleBadge role={u.role} />
                      {isSelected && (
                        <svg className="w-4 h-4 text-ringo-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
