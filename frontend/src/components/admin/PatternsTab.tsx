import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import CustomSelect from '../forms/CustomSelect';

interface PatternSlot { slot_id: string; slot_code: string; label_ja: string; slot_type: string }
interface Pattern { id: string; name: string; description: string | null; is_active: boolean; slots: PatternSlot[] }
interface Template { id: string; code: string; title_ja: string }
interface ApprovalSlot { id: string; slot_code: string; label_ja: string; slot_type: string; sort_order: number }
interface TemplatePattern { pattern_id: string; pattern_name: string; is_default: boolean; priority: number }
interface Condition {
  id?: string;
  pattern_id: string;
  user_id?: string | null;
  condition_type: 'AMOUNT_LT' | 'AMOUNT_GTE' | 'DEPT_IN' | 'DEPT_NOT_IN';
  condition_value: string;
  stop_at_slot_id: string;
}

const SLOT_TYPE_COLOR: Record<string, string> = {
  RINGI:      'bg-ringo-50 text-ringo-700 border-ringo-200/60',
  SETTLEMENT: 'bg-teal-50 text-teal-700 border-teal-200/60',
  CONFIRM:    'bg-violet-50 text-violet-700 border-violet-200/60',
};

// ── Pattern editor (create / edit) ───────────────────────────────────────────

function PatternEditor({ pattern, slots: initialSlots, onClose, showToast }: {
  pattern: Pattern | null;   // null = create new
  slots: ApprovalSlot[];
  onClose: () => void;
  showToast: (m: string, t?: 'success' | 'error' | 'info') => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(pattern?.name ?? '');
  const [description, setDescription] = useState(pattern?.description ?? '');
  const [activeSlotIds, setActiveSlotIds] = useState<Set<string>>(
    new Set(pattern?.slots.map(s => s.slot_id) ?? []),
  );
  // Local slots list — grows when user adds new slots via "+"
  const [localSlots, setLocalSlots] = useState<ApprovalSlot[]>(initialSlots);

  const isCreate = !pattern;

  const handleNewSlot = async (slotType: string, label: string) => {
    try {
      const res = await apiClient.post('/admin/approval-slots', { label_ja: label, slot_type: slotType });
      const newSlot: ApprovalSlot = res.data;
      // Add to local list + auto-activate in this pattern
      setLocalSlots(prev => [...prev, newSlot]);
      setActiveSlotIds(prev => new Set([...prev, newSlot.id]));
      // Invalidate global slots cache so SlotsTab sees it too
      queryClient.invalidateQueries({ queryKey: ['admin', 'approval-slots'] });
    } catch (err: any) {
      showToast(`スロット作成失敗: ${err.message}`, 'error');
      throw err;
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), description: description.trim() || null, slot_ids: [...activeSlotIds] };
      if (isCreate) {
        await apiClient.post('/admin/approval-patterns', body);
      } else {
        await apiClient.put(`/admin/approval-patterns/${pattern.id}`, body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'approval-patterns'] });
      showToast(isCreate ? 'パターンを作成しました' : 'パターンを更新しました');
      onClose();
    },
    onError: (err: any) => showToast(`失敗: ${err.message}`, 'error'),
  });

  const toggleSlot = (id: string) => {
    setActiveSlotIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const ringiSlots   = localSlots.filter(s => s.slot_type === 'RINGI');
  const settleSlots  = localSlots.filter(s => s.slot_type === 'SETTLEMENT');
  const confirmSlots = localSlots.filter(s => s.slot_type === 'CONFIRM');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-warmgray-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 space-y-4 animate-scale-in">
        <div className="flex items-center justify-between">
          <p className="text-base font-bold text-warmgray-800">
            {isCreate ? '新規パターン作成' : 'パターン編集'}
          </p>
          <button onClick={onClose} className="text-warmgray-400 hover:text-warmgray-700 text-xl leading-none">×</button>
        </div>

        {/* Name */}
        <div>
          <label className="label">パターン名 <span className="text-ringo-500">*</span></label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例：稟議→精算（購入）"
            className="input"
          />
        </div>

        {/* Description */}
        <div>
          <label className="label">説明（任意）</label>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="このパターンの用途"
            className="input"
          />
        </div>

        {/* Slot toggles */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="label mb-0">有効スロット（承認ポジション）</label>
            <span className="text-xs text-warmgray-400">{activeSlotIds.size} 件選択</span>
          </div>

          <SlotToggleGroup title="稟議フェーズ"  slotType="RINGI"      slots={ringiSlots}   active={activeSlotIds} onToggle={toggleSlot} onNewSlot={handleNewSlot} />
          <SlotToggleGroup title="精算フェーズ"  slotType="SETTLEMENT" slots={settleSlots}  active={activeSlotIds} onToggle={toggleSlot} onNewSlot={handleNewSlot} />
          <SlotToggleGroup title="確認フェーズ"  slotType="CONFIRM"    slots={confirmSlots} active={activeSlotIds} onToggle={toggleSlot} onNewSlot={handleNewSlot} />
        </div>

        <div className="flex gap-2 pt-2 border-t border-white/40">
          <button
            disabled={!name.trim() || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            className="btn-primary flex-1"
          >
            {saveMutation.isPending ? '保存中...' : isCreate ? '作成' : '更新'}
          </button>
          <button onClick={onClose} className="btn-ghost text-warmgray-500">キャンセル</button>
        </div>
      </div>
    </div>
  );
}

function SlotToggleGroup({ title, slotType, slots, active, onToggle, onNewSlot }: {
  title: string;
  slotType: string;
  slots: ApprovalSlot[];
  active: Set<string>;
  onToggle: (id: string) => void;
  onNewSlot: (slotType: string, label: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!newLabel.trim()) return;
    setSaving(true);
    try {
      await onNewSlot(slotType, newLabel.trim());
      setNewLabel('');
      setAdding(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400">{title}</p>
      <div className="flex flex-wrap gap-2 items-center">
        {slots.map(s => {
          const on = active.has(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onToggle(s.id)}
              className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-all ${
                on
                  ? SLOT_TYPE_COLOR[s.slot_type] + ' border opacity-100 shadow-sm'
                  : 'bg-warmgray-50 text-warmgray-400 border-warmgray-200 opacity-60'
              }`}
            >
              {on ? '✓ ' : ''}{s.label_ja}
            </button>
          );
        })}

        {/* Inline add */}
        {adding ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              type="text"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setAdding(false); setNewLabel(''); } }}
              placeholder="名前を入力"
              className="text-xs border border-warmgray-300 rounded-full px-2.5 py-1 outline-none focus:border-ringo-400 w-28"
            />
            <button
              type="button"
              disabled={!newLabel.trim() || saving}
              onClick={submit}
              className="text-xs font-bold text-ringo-600 hover:text-ringo-700 disabled:opacity-40"
            >
              {saving ? '…' : '追加'}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setNewLabel(''); }}
              className="text-xs text-warmgray-400 hover:text-warmgray-600"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs font-bold px-2 py-0.5 rounded-full border border-dashed border-warmgray-300 text-warmgray-400 hover:border-ringo-400 hover:text-ringo-500 transition-colors"
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function PatternsTab({ showToast }: {
  showToast: (m: string, t?: 'success' | 'error' | 'info') => void;
}) {
  const queryClient = useQueryClient();
  const [editingPattern, setEditingPattern] = useState<Pattern | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [activeSection, setActiveSection] = useState<'assignments' | 'conditions'>('assignments');
  const [pendingAssignments, setPendingAssignments] = useState<TemplatePattern[] | null>(null);
  const [pendingConditions, setPendingConditions] = useState<Condition[] | null>(null);

  const { data: patterns = [] } = useQuery<Pattern[]>({
    queryKey: ['admin', 'approval-patterns'],
    queryFn: async () => (await apiClient.get('/admin/approval-patterns')).data,
    staleTime: 5 * 60_000,
  });

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['admin', 'templates'],
    queryFn: async () => (await apiClient.get('/admin/templates')).data,
    staleTime: 10 * 60_000,
  });

  const { data: slots = [] } = useQuery<ApprovalSlot[]>({
    queryKey: ['admin', 'approval-slots'],
    queryFn: async () => (await apiClient.get('/admin/approval-slots')).data,
    staleTime: 30 * 60_000,
  });

  const { data: templatePatterns = [], isLoading: tpLoading } = useQuery<TemplatePattern[]>({
    queryKey: ['admin', 'template-patterns', selectedTemplateId],
    queryFn: async () => (await apiClient.get(`/admin/templates/${selectedTemplateId}/patterns`)).data,
    enabled: !!selectedTemplateId,
    staleTime: 60_000,
  });

  const { data: conditions = [], isLoading: condLoading } = useQuery<Condition[]>({
    queryKey: ['admin', 'template-conditions', selectedTemplateId],
    queryFn: async () => (await apiClient.get(`/admin/templates/${selectedTemplateId}/conditions`)).data,
    enabled: !!selectedTemplateId,
    staleTime: 60_000,
  });

  const effectiveAssignments = pendingAssignments ?? templatePatterns;
  const effectiveConditions  = pendingConditions  ?? conditions;

  const saveAssignmentsMutation = useMutation({
    mutationFn: async () => {
      await apiClient.put(`/admin/templates/${selectedTemplateId}/patterns`, {
        patterns: effectiveAssignments.map(({ pattern_id, is_default, priority }) => ({
          pattern_id, is_default, priority,
        })),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'template-patterns', selectedTemplateId] });
      setPendingAssignments(null);
      showToast('パターン割り当てを保存しました');
    },
    onError: (err: any) => showToast(`保存失敗: ${err.message}`, 'error'),
  });

  const saveConditionsMutation = useMutation({
    mutationFn: async () => {
      await apiClient.put(`/admin/templates/${selectedTemplateId}/conditions`, {
        conditions: effectiveConditions.map(({ pattern_id, user_id, condition_type, condition_value, stop_at_slot_id }) => ({
          pattern_id, user_id: user_id ?? null, condition_type, condition_value, stop_at_slot_id,
        })),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'template-conditions', selectedTemplateId] });
      setPendingConditions(null);
      showToast('条件を保存しました');
    },
    onError: (err: any) => showToast(`保存失敗: ${err.message}`, 'error'),
  });

  const openCreate = () => { setEditingPattern(null); setEditorOpen(true); };
  const openEdit   = (p: Pattern) => { setEditingPattern(p); setEditorOpen(true); };
  const closeEditor = () => setEditorOpen(false);

  const templateOptions = [
    { value: '', label: '─ フォームを選択 ─' },
    ...templates.map(t => ({ value: t.id, label: t.title_ja })),
  ];

  return (
    <div className="space-y-5">
      {/* Pattern editor modal */}
      {editorOpen && (
        <PatternEditor
          pattern={editingPattern as Pattern | null}
          slots={slots}
          onClose={closeEditor}
          showToast={showToast}
        />
      )}

      {/* Pattern catalog */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="section-title">承認パターン一覧</p>
            <p className="text-xs text-warmgray-500 mt-0.5">パターン = 承認ポジションの組み合わせ。フォームごとに割り当てます。</p>
          </div>
          <button onClick={openCreate} className="btn-primary text-sm shrink-0">
            + 新規パターン
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {patterns.filter(p => p.is_active).map(p => (
            <div key={p.id} className="rounded-xl border border-warmgray-100 bg-white/40 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-warmgray-800 truncate">{p.name}</p>
                  {p.description && <p className="text-xs text-warmgray-500 mt-0.5 line-clamp-2">{p.description}</p>}
                </div>
                <button
                  onClick={() => openEdit(p)}
                  className="text-xs text-warmgray-400 hover:text-ringo-500 shrink-0 border border-warmgray-200 rounded-lg px-2 py-0.5 transition-colors"
                >
                  編集
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {p.slots.length === 0 ? (
                  <span className="text-[10px] text-warmgray-400">スロットなし</span>
                ) : (
                  p.slots.map(s => (
                    <span
                      key={s.slot_id}
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${SLOT_TYPE_COLOR[s.slot_type] ?? 'bg-warmgray-50 text-warmgray-500 border-warmgray-200'}`}
                    >
                      {s.label_ja}
                    </span>
                  ))
                )}
              </div>
              <p className="text-[10px] text-warmgray-400">{p.slots.length} スロット有効</p>
            </div>
          ))}
        </div>
      </div>

      {/* Template-level settings */}
      <div className="card space-y-4">
        <div>
          <p className="section-title">フォーム設定</p>
          <p className="text-xs text-warmgray-500 mt-0.5">フォームにパターンを割り当て、条件を設定します。</p>
        </div>

        <div className="max-w-sm">
          <label className="label">フォームを選択</label>
          <CustomSelect
            options={templateOptions}
            value={selectedTemplateId}
            onChange={(v) => { setSelectedTemplateId(v); setPendingAssignments(null); setPendingConditions(null); }}
          />
        </div>

        {selectedTemplateId ? (
          <>
            <div className="flex gap-2 border-b border-warmgray-100">
              {(['assignments', 'conditions'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setActiveSection(s)}
                  className={`text-sm font-semibold pb-2 px-1 border-b-2 transition-colors ${
                    activeSection === s
                      ? 'border-warmgray-800 text-warmgray-800'
                      : 'border-transparent text-warmgray-400 hover:text-warmgray-600'
                  }`}
                >
                  {s === 'assignments' ? 'パターン割り当て' : '条件設定'}
                </button>
              ))}
            </div>

            {activeSection === 'assignments' && (
              <AssignmentsSection
                patterns={patterns}
                assignments={effectiveAssignments}
                onChange={setPendingAssignments}
                loading={tpLoading}
                dirty={pendingAssignments !== null}
                onSave={() => saveAssignmentsMutation.mutate()}
                saving={saveAssignmentsMutation.isPending}
              />
            )}
            {activeSection === 'conditions' && (
              <ConditionsSection
                conditions={effectiveConditions}
                patterns={patterns}
                slots={slots}
                onChange={setPendingConditions}
                loading={condLoading}
                dirty={pendingConditions !== null}
                onSave={() => saveConditionsMutation.mutate()}
                saving={saveConditionsMutation.isPending}
              />
            )}
          </>
        ) : (
          <div className="text-center py-10 text-warmgray-400 text-sm">フォームを選択してください</div>
        )}
      </div>
    </div>
  );
}

// ── Assignments section ───────────────────────────────────────────────────────

function AssignmentsSection({ patterns, assignments, onChange, loading, dirty, onSave, saving }: {
  patterns: Pattern[];
  assignments: TemplatePattern[];
  onChange: (a: TemplatePattern[]) => void;
  loading: boolean;
  dirty: boolean;
  onSave: () => void;
  saving: boolean;
}) {
  if (loading) return <div className="text-center text-warmgray-400 text-sm py-6">読み込み中...</div>;

  const assignedIds = new Set(assignments.map(a => a.pattern_id));
  const defaultId   = assignments.find(a => a.is_default)?.pattern_id;

  const toggle = (p: Pattern) => {
    if (assignedIds.has(p.id)) {
      const next = assignments.filter(a => a.pattern_id !== p.id);
      if (p.id === defaultId && next.length > 0) next[0] = { ...next[0], is_default: true };
      onChange(next);
    } else {
      onChange([...assignments, { pattern_id: p.id, pattern_name: p.name, is_default: assignments.length === 0, priority: assignments.length }]);
    }
  };

  const setDefault = (patternId: string) => {
    onChange(assignments.map(a => ({ ...a, is_default: a.pattern_id === patternId })));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-warmgray-500">チェックでパターンを有効化。デフォルトは申請時に最初に選択されるパターンです。</p>
      <div className="space-y-2">
        {patterns.filter(p => p.is_active).map(p => {
          const assigned  = assignedIds.has(p.id);
          const isDefault = p.id === defaultId;
          return (
            <div
              key={p.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                assigned ? 'border-ringo-200 bg-ringo-50/30' : 'border-warmgray-100 bg-white/30'
              }`}
            >
              <input type="checkbox" checked={assigned} onChange={() => toggle(p)} className="w-4 h-4 accent-ringo-500" />
              <p className="flex-1 text-sm font-semibold text-warmgray-800">{p.name}</p>
              {assigned && (
                <button
                  onClick={() => setDefault(p.id)}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors ${
                    isDefault
                      ? 'bg-ringo-500 text-white border-ringo-500'
                      : 'bg-white text-warmgray-500 border-warmgray-200 hover:border-ringo-300'
                  }`}
                >
                  {isDefault ? 'デフォルト ✓' : 'デフォルトに設定'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        {dirty && <span className="text-xs text-amber-600 self-center">未保存</span>}
        <button disabled={saving} onClick={onSave} className="btn-primary">
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}

// ── Conditions section ────────────────────────────────────────────────────────

const CONDITION_TYPE_LABELS: Record<string, string> = {
  AMOUNT_LT:   '金額 <',
  AMOUNT_GTE:  '金額 ≥',
  DEPT_IN:     '部署が含まれる',
  DEPT_NOT_IN: '部署が含まれない',
};

function ConditionsSection({ conditions, patterns, slots, onChange, loading, dirty, onSave, saving }: {
  conditions: Condition[];
  patterns: Pattern[];
  slots: ApprovalSlot[];
  onChange: (c: Condition[]) => void;
  loading: boolean;
  dirty: boolean;
  onSave: () => void;
  saving: boolean;
}) {
  if (loading) return <div className="text-center text-warmgray-400 text-sm py-6">読み込み中...</div>;

  const patternOptions = patterns.filter(p => p.is_active).map(p => ({ value: p.id, label: p.name }));
  const slotOptions    = slots.map(s => ({ value: s.id, label: `${s.label_ja} (${s.slot_code})` }));
  const typeOptions    = Object.entries(CONDITION_TYPE_LABELS).map(([value, label]) => ({ value, label }));

  const add = () => {
    onChange([...conditions, {
      pattern_id:      patterns.find(p => p.is_active)?.id ?? '',
      user_id:         null,
      condition_type:  'AMOUNT_LT',
      condition_value: '',
      stop_at_slot_id: slots[0]?.id ?? '',
    }]);
  };

  const update = (idx: number, patch: Partial<Condition>) => {
    onChange(conditions.map((c, i) => i === idx ? { ...c, ...patch } : c));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-warmgray-500">
        条件に一致した場合、指定スロットで承認チェーンを打ち切ります（そのスロットまで承認、以降スキップ）。
      </p>
      {conditions.length === 0 && (
        <div className="text-center text-warmgray-400 text-sm py-6">条件が設定されていません</div>
      )}
      {conditions.map((c, idx) => (
        <div key={idx} className="rounded-xl border border-warmgray-100 bg-white/40 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-warmgray-600">条件 {idx + 1}</span>
            <button onClick={() => onChange(conditions.filter((_, i) => i !== idx))} className="text-warmgray-400 hover:text-ringo-500 text-xs">削除</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">対象パターン</label>
              <CustomSelect options={patternOptions} value={c.pattern_id} onChange={v => update(idx, { pattern_id: v })} />
            </div>
            <div>
              <label className="label">条件タイプ</label>
              <CustomSelect options={typeOptions} value={c.condition_type} onChange={v => update(idx, { condition_type: v as Condition['condition_type'] })} />
            </div>
            <div>
              <label className="label">値</label>
              <input
                type="text"
                value={c.condition_value}
                onChange={e => update(idx, { condition_value: e.target.value })}
                placeholder={c.condition_type.startsWith('AMOUNT') ? '例: 10000' : '部署ID（カンマ区切り）'}
                className="input"
              />
            </div>
            <div>
              <label className="label">このスロットで停止</label>
              <CustomSelect options={slotOptions} value={c.stop_at_slot_id} onChange={v => update(idx, { stop_at_slot_id: v })} />
            </div>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1">
        <button onClick={add} className="btn-ghost text-sm border border-warmgray-200">+ 条件を追加</button>
        <div className="flex gap-2 items-center">
          {dirty && <span className="text-xs text-amber-600">未保存</span>}
          <button disabled={saving} onClick={onSave} className="btn-primary">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
