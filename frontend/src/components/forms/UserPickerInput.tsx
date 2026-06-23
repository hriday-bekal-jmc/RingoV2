// UserPickerInput — multi-select employees with dept-filter tile grid + infinite scroll.
//
// Stores value as JSON array: [{ id?, name, email?, avatar_url?, department_name? }]
// Serialized to form field as JSON string (react-hook-form stores as string).
//
// Field config:
//   count_field — sibling field name to auto-set with array.length

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseFormSetValue } from 'react-hook-form';
import apiClient from '../../services/apiClient';
import { useLang } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { useScrollEnd } from '../../hooks/useScrollEnd';

export interface PickedUser {
  id?:             string;
  name:            string;
  email?:          string;
  avatar_url?:     string;
  department_name?: string;
}

interface UserPickerField {
  name:         string;
  count_field?: string;
  required?:    boolean;
}

interface Props {
  field:         UserPickerField;
  setValue:      UseFormSetValue<Record<string, unknown>>;
  currentValue?: string;
  error?:        string;
  disabled?:     boolean;
}

interface SystemUser {
  id:              string;
  full_name:       string;
  email:           string;
  avatar_url?:     string;
  department_name?: string;
}

interface Department { id: string; name: string; }

const PAGE       = 20;
const ALL_DEPTS  = '__all__';

function UserAvatar({ name, avatarUrl, size = 'sm' }: { name: string; avatarUrl?: string; size?: 'sm' | 'lg' }) {
  const initials = name.slice(0, 2).toUpperCase();
  const cls = size === 'lg' ? 'w-9 h-9 text-sm' : 'w-6 h-6 text-[10px]';
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className={`${cls} rounded-full object-cover shrink-0`} />;
  }
  return (
    <span className={`${cls} rounded-full bg-violet-100 text-violet-700 font-bold flex items-center justify-center shrink-0`}>
      {initials}
    </span>
  );
}

export default function UserPickerInput({ field, setValue, currentValue, error, disabled }: Props) {
  const { lang }          = useLang();
  const { user: authUser } = useAuth();

  const [picked, setPicked] = useState<PickedUser[]>(() => {
    try { return currentValue ? (JSON.parse(currentValue) as PickedUser[]) : []; }
    catch { return []; }
  });

  // Resync when parent pushes new currentValue via reset (e.g. copy from ringi)
  const lastSyncedValueRef = useRef(currentValue);
  useEffect(() => {
    if (currentValue === lastSyncedValueRef.current) return;
    lastSyncedValueRef.current = currentValue;
    try {
      const incoming = currentValue ? (JSON.parse(currentValue) as PickedUser[]) : [];
      setPicked(incoming);
    } catch { /* ignore malformed */ }
  }, [currentValue]);

  // Default to logged-in user's own department
  const myDeptId   = authUser?.department_id ?? null;
  const myDeptName = authUser?.department_name;

  const [deptId, setDeptId]       = useState<string>(myDeptId ?? ALL_DEPTS);
  const [departments, setDepts]   = useState<Department[]>([]);
  const [query, setQuery]         = useState('');
  const [users, setUsers]         = useState<SystemUser[]>([]);
  const [offset, setOffset]       = useState(0);
  const [hasMore, setHasMore]     = useState(true);
  const [loading, setLoading]     = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showFree, setShowFree]   = useState(false);
  const [freeAdd, setFreeAdd]     = useState('');

  const containerRef  = useRef<HTMLDivElement>(null);
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offsetRef     = useRef(offset); offsetRef.current = offset;
  const queryRef      = useRef(query);  queryRef.current  = query;
  const deptIdRef     = useRef(deptId); deptIdRef.current = deptId;

  // ── Sync picked users up to react-hook-form ──────────────────────────────
  const sync = useCallback((users: PickedUser[]) => {
    setValue(field.name as never, JSON.stringify(users) as never);
    if (field.count_field) setValue(field.count_field as never, users.length as never);
  }, [field.name, field.count_field, setValue]);

  // ── Fetch departments (once when panel first opens) ───────────────────────
  useEffect(() => {
    if (!panelOpen || departments.length > 0) return;
    apiClient.get('/users/departments')
      .then((r) => setDepts(r.data as Department[]))
      .catch(() => {});
  }, [panelOpen, departments.length]);

  // ── Fetch user page ───────────────────────────────────────────────────────
  const fetchPage = useCallback(async (
    q: string, dept: string, off: number, append: boolean,
  ) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, limit: String(PAGE), offset: String(off) });
      if (dept !== ALL_DEPTS) params.set('dept_id', dept);
      const res  = await apiClient.get(`/users/search?${params}`);
      const data = res.data as SystemUser[];
      setHasMore(data.length === PAGE);
      setUsers(prev => append ? [...prev, ...data] : data);
      setOffset(off + data.length);
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload when panel opens or dept filter changes (immediate)
  useEffect(() => {
    if (!panelOpen) return;
    setUsers([]);
    setOffset(0);
    setHasMore(true);
    void fetchPage(query, deptId, 0, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, deptId]);

  // Reload when query changes (debounced)
  useEffect(() => {
    if (!panelOpen) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setUsers([]);
      setOffset(0);
      setHasMore(true);
      void fetchPage(queryRef.current, deptIdRef.current, 0, false);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Infinite scroll sentinel
  const sentinelRef = useScrollEnd(
    () => { void fetchPage(queryRef.current, deptIdRef.current, offsetRef.current, true); },
    hasMore && !loading && panelOpen,
  );

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
        setShowFree(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pickedIds = new Set(picked.filter(p => p.id).map(p => p.id));

  const toggleUser = (u: SystemUser) => {
    const updated = pickedIds.has(u.id)
      ? picked.filter(p => p.id !== u.id)
      : [...picked, { id: u.id, name: u.full_name, email: u.email, avatar_url: u.avatar_url, department_name: u.department_name }];
    setPicked(updated);
    sync(updated);
  };

  const remove = (idx: number) => {
    const updated = picked.filter((_, i) => i !== idx);
    setPicked(updated);
    sync(updated);
  };

  const addFree = () => {
    const name = freeAdd.trim();
    if (!name) return;
    const updated = [...picked, { name }];
    setPicked(updated);
    sync(updated);
    setFreeAdd('');
    setShowFree(false);
  };

  const changeDept = (id: string) => {
    if (id === deptId) return;
    setDeptId(id);
    setQuery('');
  };

  const gridUsers = users.filter(u => !pickedIds.has(u.id));

  // Build the dept select label shown on the button
  const activeDeptLabel = deptId === ALL_DEPTS
    ? (lang === 'en' ? 'All Employees' : '全社員')
    : (departments.find(d => d.id === deptId)?.name ?? (myDeptName ?? '...'));

  return (
    <div ref={containerRef} className="space-y-2">

      {/* ── Selected chips ──────────────────────────────────────────────── */}
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picked.map((u, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 bg-violet-50 border border-violet-200/70 rounded-full pl-1 pr-2 py-0.5 text-xs font-medium text-violet-800"
            >
              <UserAvatar name={u.name} avatarUrl={u.avatar_url} size="sm" />
              {u.name}
              {!disabled && (
                <button type="button" onClick={() => remove(i)} className="text-violet-400 hover:text-red-500 leading-none ml-0.5">×</button>
              )}
            </span>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="flex gap-2">
          {/* Open panel */}
          <button
            type="button"
            onClick={() => setPanelOpen(v => !v)}
            className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border text-xs transition-colors text-left
              ${error ? 'border-red-300' : 'border-warmgray-200 hover:border-violet-400'}
              ${panelOpen ? 'bg-violet-50/60 border-violet-400' : 'bg-white/80'}`}
          >
            <svg className="w-4 h-4 text-warmgray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className={picked.length > 0 ? 'text-warmgray-600' : 'text-warmgray-400'}>
              {lang === 'en' ? 'Select participants…' : '参加者を選択…'}
            </span>
          </button>

          {/* Free-add external */}
          <button
            type="button"
            onClick={() => setShowFree(v => !v)}
            className="shrink-0 rounded-xl border border-dashed border-warmgray-300 px-3 py-2 text-xs text-warmgray-500 hover:border-violet-400 hover:text-violet-600 transition-colors whitespace-nowrap"
          >
            {lang === 'en' ? '+ External' : '+ 外部追加'}
          </button>
        </div>
      )}

      {/* Free-add row */}
      {showFree && !disabled && (
        <div className="flex gap-1.5">
          <input
            type="text"
            value={freeAdd}
            onChange={(e) => setFreeAdd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFree(); } }}
            placeholder={lang === 'en' ? 'External name' : '外部参加者名'}
            className="flex-1 rounded-xl border border-violet-300 px-3 py-2 text-xs outline-none focus:border-violet-500 bg-white/80"
          />
          <button type="button" onClick={addFree} className="rounded-xl bg-violet-600 text-white px-3 py-2 text-xs font-bold hover:bg-violet-700 transition-colors">
            {lang === 'en' ? 'Add' : '追加'}
          </button>
          <button type="button" onClick={() => setShowFree(false)} className="rounded-xl border border-warmgray-200 text-warmgray-500 px-2.5 py-2 text-xs hover:bg-warmgray-50 transition-colors">×</button>
        </div>
      )}

      {/* ── Picker panel ────────────────────────────────────────────────── */}
      {panelOpen && (
        <div className="rounded-2xl border border-warmgray-200/80 bg-white/95 shadow-xl overflow-hidden">

          {/* Department filter + search */}
          <div className="p-3 border-b border-warmgray-100 space-y-2">
            {/* Dept select */}
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-warmgray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
              </svg>
              <div className="flex-1 relative">
                <select
                  value={deptId}
                  onChange={(e) => changeDept(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-warmgray-200 bg-white px-3 py-1.5 pr-7 text-xs font-semibold text-warmgray-700 outline-none focus:border-violet-400 cursor-pointer"
                >
                  {myDeptId && myDeptName && (
                    <option value={myDeptId}>
                      {lang === 'en' ? `My Department (${myDeptName})` : `所属部署（${myDeptName}）`}
                    </option>
                  )}
                  <option value={ALL_DEPTS}>
                    {lang === 'en' ? 'All Employees' : '全社員'}
                  </option>
                  {departments
                    .filter(d => d.id !== myDeptId)
                    .map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                </select>
                <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-warmgray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </div>
              <span className="text-[10px] text-warmgray-400 shrink-0 whitespace-nowrap">
                {activeDeptLabel}
              </span>
            </div>

            {/* Search */}
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-warmgray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M16.65 16.65A7.5 7.5 0 104.5 4.5a7.5 7.5 0 0012.15 12.15z" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={lang === 'en' ? 'Search by name…' : '名前で検索…'}
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-warmgray-200 text-xs bg-white outline-none focus:border-violet-400"
              />
            </div>
          </div>

          {/* User grid */}
          <div className="max-h-64 overflow-y-auto dropdown-scroll">
            {loading && gridUsers.length === 0 ? (
              <div className="flex justify-center items-center py-10">
                <svg className="w-5 h-5 animate-spin text-violet-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              </div>
            ) : gridUsers.length === 0 && !loading ? (
              <div className="flex flex-col items-center gap-2 py-10 text-warmgray-400">
                <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
                <p className="text-xs">
                  {lang === 'en' ? 'No employees found' : '社員が見つかりません'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 p-3">
                {gridUsers.map((u) => {
                  const isSelected = pickedIds.has(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => toggleUser(u)}
                      className={`relative flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all duration-100
                        ${isSelected
                          ? 'border-violet-300 bg-violet-50 shadow-sm'
                          : 'border-warmgray-200/60 bg-white/50 hover:bg-white hover:border-warmgray-300 hover:shadow-sm'
                        }`}
                    >
                      {isSelected && (
                        <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-violet-500 flex items-center justify-center">
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        </span>
                      )}
                      <UserAvatar name={u.full_name} avatarUrl={u.avatar_url} size="lg" />
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs font-semibold truncate leading-snug ${isSelected ? 'text-violet-700' : 'text-warmgray-800'}`}>
                          {u.full_name}
                        </p>
                        {u.department_name && (
                          <p className="text-[10px] text-warmgray-400 truncate">{u.department_name}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-px" />

            {loading && gridUsers.length > 0 && (
              <div className="flex justify-center py-3">
                <svg className="w-4 h-4 animate-spin text-violet-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-warmgray-100 flex items-center justify-between">
            <span className="text-[10px] text-warmgray-400">
              {lang === 'en' ? `${picked.length} selected` : `${picked.length}名選択中`}
            </span>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="text-xs font-semibold text-violet-600 hover:text-violet-700 transition-colors"
            >
              {lang === 'en' ? 'Done' : '完了'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500">⚠ {error}</p>}

      {picked.length > 0 && (
        <p className="text-[10px] text-warmgray-400">
          {lang === 'en' ? `${picked.length} person(s) selected` : `${picked.length}名選択中`}
        </p>
      )}
    </div>
  );
}
