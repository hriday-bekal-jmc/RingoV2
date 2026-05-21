// ── DEV-ONLY i18n editor page ────────────────────────────────────────────────
// Visible only when logged-in user email === DEV_EMAIL. Two tabs:
//   1. Dict overrides  — UI strings (buttons, labels in code) via i18n.overrides.json
//   2. DB strings      — form_templates JA/EN pairs (titles, field labels, options)
//                        edited in-place on form_templates + active version row
//
// Production cleanup = delete this file + DevI18n route in App.tsx + devRoutes.ts
// + i18n.overrides.json + the 3 DEV-OVERRIDES blocks in i18n.ts. All marked.

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Layout from '../components/common/Layout';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { dict } from '../i18n';

export const DEV_EMAIL = 'h-bekal@jmc-ltd.co.jp';

interface Overrides {
  ja: Record<string, string>;
  en: Record<string, string>;
}
interface DbStringItem { path: string; ja: string; en: string }
interface DbStringTemplate { template_id: string; code: string; items: DbStringItem[] }

export default function DevI18n() {
  const { user } = useAuth();
  if (!user || user.email?.toLowerCase() !== DEV_EMAIL) {
    return <Navigate to="/dashboard" replace />;
  }

  const [tab, setTab] = useState<'dict' | 'db'>('dict');

  return (
    <Layout title="DEV — i18n editor">
      <div className="max-w-6xl mx-auto space-y-4">

        {/* Banner */}
        <div className="card !p-4 bg-amber-50/60 border border-amber-300/60">
          <p className="text-xs font-bold text-amber-800 uppercase tracking-widest">DEV-ONLY PAGE</p>
          <p className="text-xs text-amber-700 mt-1">
            Edit translations missing in app. Two scopes — <b>Dict</b>: code-side UI
            strings via <code className="bg-white/60 px-1.5 py-0.5 rounded">i18n.overrides.json</code>.
            {' '}<b>DB</b>: form_templates titles, descriptions, field labels, options —
            updates the DB row + active version. Save then reload to see effects.
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex gap-2 border-b border-warmgray-200">
          <TabBtn active={tab === 'dict'} onClick={() => setTab('dict')}>Dict overrides (code UI)</TabBtn>
          <TabBtn active={tab === 'db'} onClick={() => setTab('db')}>DB strings (forms)</TabBtn>
        </div>

        {tab === 'dict' ? <DictTab /> : <DbTab />}
      </div>
    </Layout>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors ${
        active ? 'bg-white text-ringo-700 border-x border-t border-warmgray-200'
               : 'text-warmgray-500 hover:text-warmgray-800'
      }`}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1: Dict overrides
// ─────────────────────────────────────────────────────────────────────────────
interface Row {
  key: string;
  ja: string;
  en: string;
  source: 'builtin' | 'override' | 'new';
}

function DictTab() {
  const qc = useQueryClient();
  const { data: overrides, isLoading } = useQuery<Overrides>({
    queryKey: ['dev-i18n'],
    queryFn: async () => (await apiClient.get('/dev/i18n')).data,
    staleTime: 30_000,
  });

  const [working, setWorking] = useState<Overrides>({ ja: {}, en: {} });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'missing_en' | 'missing_ja' | 'overrides' | 'new'>('all');
  const [newKey, setNewKey] = useState('');
  const [newJa, setNewJa] = useState('');
  const [newEn, setNewEn] = useState('');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (overrides) setWorking({ ja: { ...overrides.ja }, en: { ...overrides.en } });
  }, [overrides]);

  const rows: Row[] = useMemo(() => {
    const builtinJa = dict.ja as Record<string, string>;
    const builtinEn = dict.en as Record<string, string>;
    const allKeys = new Set<string>([
      ...Object.keys(builtinJa),
      ...Object.keys(builtinEn),
      ...Object.keys(working.ja),
      ...Object.keys(working.en),
    ]);
    return Array.from(allKeys).sort().map((k): Row => {
      const overrideJa = working.ja[k];
      const overrideEn = working.en[k];
      const builtinHasKey = k in builtinJa || k in builtinEn;
      const isOverride = overrideJa !== undefined || overrideEn !== undefined;
      return {
        key: k,
        ja: overrideJa ?? builtinJa[k] ?? '',
        en: overrideEn ?? builtinEn[k] ?? '',
        source: !builtinHasKey ? 'new' : (isOverride ? 'override' : 'builtin'),
      };
    });
  }, [working]);

  const filtered = rows.filter((r) => {
    if (search && !r.key.toLowerCase().includes(search.toLowerCase())
                && !r.ja.toLowerCase().includes(search.toLowerCase())
                && !r.en.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'missing_en') return !r.en.trim();
    if (filter === 'missing_ja') return !r.ja.trim();
    if (filter === 'overrides')  return r.source === 'override';
    if (filter === 'new')        return r.source === 'new';
    return true;
  });

  const counts = useMemo(() => ({
    total:      rows.length,
    missing_en: rows.filter((r) => !r.en.trim()).length,
    missing_ja: rows.filter((r) => !r.ja.trim()).length,
    overrides:  rows.filter((r) => r.source === 'override').length,
    new_keys:   rows.filter((r) => r.source === 'new').length,
  }), [rows]);

  const editCell = (key: string, lang: 'ja' | 'en', value: string) =>
    setWorking((p) => ({ ...p, [lang]: { ...p[lang], [key]: value } }));

  const removeOverride = (key: string) => setWorking((p) => {
    const ja = { ...p.ja }; delete ja[key];
    const en = { ...p.en }; delete en[key];
    return { ja, en };
  });

  const addNew = () => {
    const k = newKey.trim();
    if (!k) { setToast({ msg: 'Key required', ok: false }); return; }
    setWorking((p) => ({
      ja: { ...p.ja, [k]: newJa.trim() },
      en: { ...p.en, [k]: newEn.trim() },
    }));
    setNewKey(''); setNewJa(''); setNewEn('');
  };

  const save = useMutation({
    mutationFn: async () => (await apiClient.put('/dev/i18n', working)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dev-i18n'] });
      setToast({ msg: 'Saved. Reload page to see changes apply.', ok: true });
    },
    onError: (e: any) => setToast({ msg: e?.response?.data?.error ?? e.message, ok: false }),
  });

  const reset = () => { if (overrides) setWorking({ ja: { ...overrides.ja }, en: { ...overrides.en } }); };

  return (
    <div className="space-y-4">
      <StatGrid stats={[
        { label: 'Total keys',     value: counts.total },
        { label: 'Overrides',      value: counts.overrides, accent: 'emerald' },
        { label: 'New (not in dict)', value: counts.new_keys, accent: 'ringo' },
        { label: 'Missing EN',     value: counts.missing_en, accent: 'amber' },
        { label: 'Missing JA',     value: counts.missing_ja, accent: 'amber' },
      ]} />

      <div className="card !p-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-warmgray-500">+ Add new key</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input className="input text-sm font-mono" placeholder="key_name (snake_case)"
            value={newKey} onChange={(e) => setNewKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
          <input className="input text-sm" placeholder="日本語" value={newJa} onChange={(e) => setNewJa(e.target.value)} />
          <input className="input text-sm" placeholder="English (blank OK)" value={newEn} onChange={(e) => setNewEn(e.target.value)} />
          <button onClick={addNew} className="btn-primary text-sm">+ Add</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input className="input text-sm flex-1 min-w-[200px]" placeholder="Search key / JA / EN…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input text-sm w-auto" value={filter} onChange={(e) => setFilter(e.target.value as any)}>
          <option value="all">All ({counts.total})</option>
          <option value="overrides">Overrides ({counts.overrides})</option>
          <option value="new">New keys ({counts.new_keys})</option>
          <option value="missing_en">Missing EN ({counts.missing_en})</option>
          <option value="missing_ja">Missing JA ({counts.missing_ja})</option>
        </select>
        <button onClick={reset} className="btn-ghost text-sm">Reset</button>
        <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary text-sm">
          {save.isPending ? 'Saving…' : 'Save overrides'}
        </button>
      </div>

      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      {isLoading ? <Loading /> : (
        <div className="card !p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-warmgray-50 border-b border-warmgray-200">
              <tr>
                <th className="px-3 py-2 text-left font-bold text-[10px] uppercase tracking-widest text-warmgray-500 w-12">#</th>
                <th className="px-3 py-2 text-left font-bold text-[10px] uppercase tracking-widest text-warmgray-500">Key</th>
                <th className="px-3 py-2 text-left font-bold text-[10px] uppercase tracking-widest text-warmgray-500">日本語</th>
                <th className="px-3 py-2 text-left font-bold text-[10px] uppercase tracking-widest text-warmgray-500">English</th>
                <th className="px-3 py-2 text-left font-bold text-[10px] uppercase tracking-widest text-warmgray-500 w-24">Source</th>
                <th className="px-3 py-2 w-12" />
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map((r, i) => (
                <tr key={r.key} className="border-b border-warmgray-100 hover:bg-warmgray-50/40">
                  <td className="px-3 py-1.5 text-[10px] text-warmgray-400 tabular-nums">{i + 1}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-warmgray-700 break-all">{r.key}</td>
                  <td className="px-3 py-1.5">
                    <input className="input text-xs w-full" value={r.ja}
                      onChange={(e) => editCell(r.key, 'ja', e.target.value)} />
                  </td>
                  <td className="px-3 py-1.5">
                    <input className="input text-xs w-full" value={r.en}
                      onChange={(e) => editCell(r.key, 'en', e.target.value)} />
                  </td>
                  <td className="px-3 py-1.5">
                    <SourceBadge source={r.source} />
                  </td>
                  <td className="px-3 py-1.5">
                    {r.source !== 'builtin' && (
                      <button onClick={() => removeOverride(r.key)} className="text-red-400 hover:text-red-600 text-sm">×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 500 && (
            <div className="px-3 py-2 text-xs text-warmgray-400 text-center bg-warmgray-50 border-t border-warmgray-100">
              Showing first 500 of {filtered.length}. Use search to narrow.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2: DB strings (form_templates)
// ─────────────────────────────────────────────────────────────────────────────
function DbTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ templates: DbStringTemplate[] }>({
    queryKey: ['dev-db-strings'],
    queryFn: async () => (await apiClient.get('/dev/db-strings')).data,
    staleTime: 30_000,
  });

  // working overrides keyed by `${template_id}::${path}` → new EN value
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const setEnFor = (templateId: string, path: string, val: string) =>
    setEdits((p) => ({ ...p, [`${templateId}::${path}`]: val }));

  const enFor = (templateId: string, path: string, fallback: string): string => {
    const k = `${templateId}::${path}`;
    return edits[k] !== undefined ? edits[k] : fallback;
  };

  const totalCount = useMemo(
    () => (data?.templates ?? []).reduce((s, t) => s + t.items.length, 0),
    [data],
  );

  const missingCount = useMemo(() => {
    if (!data) return 0;
    return data.templates.reduce((s, t) =>
      s + t.items.filter((it) => {
        const en = enFor(t.template_id, it.path, it.en);
        return !en.trim();
      }).length, 0);
  }, [data, edits]);

  const filteredTemplates: DbStringTemplate[] = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    return data.templates.map((t) => ({
      ...t,
      items: t.items.filter((it) => {
        const en = enFor(t.template_id, it.path, it.en);
        if (missingOnly && en.trim()) return false;
        if (!q) return true;
        return it.path.toLowerCase().includes(q)
            || it.ja.toLowerCase().includes(q)
            || en.toLowerCase().includes(q)
            || t.code.toLowerCase().includes(q);
      }),
    })).filter((t) => t.items.length > 0);
  }, [data, edits, search, missingOnly]);

  const save = useMutation({
    mutationFn: async () => {
      const updates = Object.entries(edits).map(([k, en]) => {
        const [template_id, ...rest] = k.split('::');
        return { template_id, path: rest.join('::'), en };
      });
      return (await apiClient.put('/dev/db-strings', { updates })).data;
    },
    onSuccess: (r: { applied: number; templates: number }) => {
      qc.invalidateQueries({ queryKey: ['dev-db-strings'] });
      qc.invalidateQueries({ queryKey: ['templates', 'active'] });
      qc.invalidateQueries({ queryKey: ['form-templates'] });
      setEdits({});
      setToast({ msg: `Saved ${r.applied} update(s) across ${r.templates} template(s).`, ok: true });
    },
    onError: (e: any) => setToast({ msg: e?.response?.data?.error ?? e.message, ok: false }),
  });

  const reset = () => setEdits({});

  return (
    <div className="space-y-4">
      <StatGrid stats={[
        { label: 'Total strings', value: totalCount },
        { label: 'Missing EN',    value: missingCount, accent: 'amber' },
        { label: 'Pending edits', value: Object.keys(edits).length, accent: 'ringo' },
      ]} />

      <div className="flex flex-wrap gap-2 items-center">
        <input className="input text-sm flex-1 min-w-[200px]" placeholder="Search code / path / JA / EN…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-1.5 text-xs font-semibold text-warmgray-600 px-2 py-1.5 rounded-md cursor-pointer">
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />
          Missing EN only
        </label>
        <button onClick={reset} className="btn-ghost text-sm" disabled={Object.keys(edits).length === 0}>Reset</button>
        <button onClick={() => save.mutate()} disabled={save.isPending || Object.keys(edits).length === 0} className="btn-primary text-sm">
          {save.isPending ? 'Saving…' : `Save (${Object.keys(edits).length})`}
        </button>
      </div>

      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />

      {isLoading ? <Loading /> : (
        <div className="space-y-4">
          {filteredTemplates.length === 0 && (
            <div className="card !p-6 text-center text-sm text-warmgray-400">
              {missingOnly ? 'No missing-EN strings.' : 'No matches.'}
            </div>
          )}
          {filteredTemplates.map((t) => (
            <div key={t.template_id} className="card !p-0 overflow-hidden">
              <div className="px-4 py-2 bg-warmgray-50 border-b border-warmgray-200 flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-warmgray-800">{t.code}</span>
                <span className="text-[10px] text-warmgray-400">{t.items.length} strings</span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-warmgray-50/50 border-b border-warmgray-100">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-bold text-[10px] uppercase tracking-widest text-warmgray-500 w-1/3">Path</th>
                    <th className="px-3 py-1.5 text-left font-bold text-[10px] uppercase tracking-widest text-warmgray-500">日本語</th>
                    <th className="px-3 py-1.5 text-left font-bold text-[10px] uppercase tracking-widest text-warmgray-500">English</th>
                  </tr>
                </thead>
                <tbody>
                  {t.items.map((it) => {
                    const en = enFor(t.template_id, it.path, it.en);
                    const edited = edits[`${t.template_id}::${it.path}`] !== undefined;
                    const missing = !en.trim();
                    return (
                      <tr key={it.path} className="border-b border-warmgray-100 hover:bg-warmgray-50/40">
                        <td className="px-3 py-1.5 font-mono text-[10px] text-warmgray-500 break-all">{it.path}</td>
                        <td className="px-3 py-1.5 text-xs">{it.ja || <span className="text-warmgray-300">—</span>}</td>
                        <td className="px-3 py-1.5">
                          <input
                            className={`input text-xs w-full ${missing ? 'border-amber-300' : edited ? 'border-emerald-300' : ''}`}
                            value={en}
                            placeholder="(missing)"
                            onChange={(e) => setEnFor(t.template_id, it.path, e.target.value)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared
// ─────────────────────────────────────────────────────────────────────────────
function Loading() {
  return <div className="card !p-8 text-center text-warmgray-400 text-sm">Loading…</div>;
}
function ToastBanner({ toast, onDismiss }: { toast: { msg: string; ok: boolean } | null; onDismiss: () => void }) {
  if (!toast) return null;
  return (
    <div className={`card !p-3 text-sm ${toast.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
      {toast.msg}
      <button onClick={onDismiss} className="float-right text-xs underline">×</button>
    </div>
  );
}
function StatGrid({ stats }: { stats: { label: string; value: number; accent?: 'ringo' | 'amber' | 'emerald' }[] }) {
  return (
    <div className="card !p-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
      {stats.map((s) => {
        const color = s.accent === 'ringo' ? 'text-ringo-700' :
                      s.accent === 'amber' ? 'text-amber-700' :
                      s.accent === 'emerald' ? 'text-emerald-700' : 'text-warmgray-800';
        return (
          <div key={s.label}>
            <p className={`text-2xl font-bold tabular-nums ${color}`}>{s.value}</p>
            <p className="text-[10px] uppercase tracking-widest text-warmgray-500 mt-0.5">{s.label}</p>
          </div>
        );
      })}
    </div>
  );
}
function SourceBadge({ source }: { source: 'builtin' | 'override' | 'new' }) {
  const cls = source === 'override' ? 'bg-emerald-100 text-emerald-700' :
              source === 'new'      ? 'bg-ringo-100 text-ringo-700' :
                                      'bg-warmgray-100 text-warmgray-600';
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cls}`}>{source}</span>;
}
