import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import CustomSelect from '../forms/CustomSelect';
import { ROLE_MAP, type Role } from '../../config/permissions';
import type { Department, User } from './adminTypes';

interface PatternSlot { slot_id: string; slot_code: string; label_ja: string; slot_type: string }
interface Pattern { id: string; name: string; description: string | null; is_active: boolean; slots: PatternSlot[] }
interface Template { id: string; code: string; title_ja: string }
interface ApprovalSlot { id: string; slot_code: string; label_ja: string; slot_type: string; sort_order: number }
interface TemplatePattern { pattern_id: string; pattern_name: string; is_default: boolean; priority: number }
interface Condition {
  id?: string;
  pattern_id: string;
  user_id?: string | null;
  condition_type: 'AMOUNT_LT' | 'AMOUNT_GTE' | 'DEPT_IN' | 'DEPT_NOT_IN' | 'ROLE_IN' | 'ROLE_NOT_IN';
  condition_value: string;
  stop_at_slot_id: string;
}

// System slot codes that cannot be deleted (mirrors backend SYSTEM_SLOT_CODES).
const SYSTEM_SLOT_CODES = new Set([
  'ringi_1','ringi_2','ringi_2_5','ringi_3','ringi_4','ringi_5','ringi_6',
  'settle_1','settle_2','settle_3','settle_4','settle_5','settle_6','settle_mgr',
  'confirm_1','confirm_2','confirm_3',
]);

interface SlotUsage { label_ja: string; is_system: boolean; user_assignments: number; pattern_count: number; condition_count: number }

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
  const [slotToDelete, setSlotToDelete] = useState<ApprovalSlot | null>(null);
  const [slotUsage, setSlotUsage] = useState<SlotUsage | null>(null);

  const isCreate = !pattern;

  const handleNewSlot = async (slotType: string, label: string) => {
    try {
      const res = await apiClient.post('/admin/approval-slots', { label_ja: label, slot_type: slotType });
      const newSlot: ApprovalSlot = res.data;
      // Add to local list + auto-activate in this pattern
      setLocalSlots(prev => [...prev, newSlot]);
      setActiveSlotIds(prev => new Set([...prev, newSlot.id]));
      // Invalidate global slots cache so other views see it too
      queryClient.invalidateQueries({ queryKey: ['admin', 'approval-slots'] });
    } catch (err: any) {
      showToast(`スロット作成失敗: ${err.message}`, 'error');
      throw err;
    }
  };

  const handleDeleteSlot = async (slot: ApprovalSlot) => {
    try {
      const res = await apiClient.get(`/admin/approval-slots/${slot.id}/usage`);
      setSlotUsage(res.data as SlotUsage);
      setSlotToDelete(slot);
    } catch (err: any) {
      showToast(`使用状況の取得失敗: ${err.message}`, 'error');
    }
  };

  const confirmDeleteSlot = async () => {
    if (!slotToDelete) return;
    try {
      await apiClient.delete(`/admin/approval-slots/${slotToDelete.id}`);
      setLocalSlots(prev => prev.filter(s => s.id !== slotToDelete.id));
      setActiveSlotIds(prev => { const next = new Set(prev); next.delete(slotToDelete.id); return next; });
      queryClient.invalidateQueries({ queryKey: ['admin', 'approval-slots'] });
      showToast('スロットを削除しました');
    } catch (err: any) {
      showToast(`削除失敗: ${err.message}`, 'error');
    } finally {
      setSlotToDelete(null);
      setSlotUsage(null);
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
    <>
      {slotToDelete && slotUsage && (
        <SlotDeleteConfirm
          usage={slotUsage}
          onConfirm={confirmDeleteSlot}
          onCancel={() => { setSlotToDelete(null); setSlotUsage(null); }}
        />
      )}

      {/* Slide-over panel — right side, page stays bright */}
      <div className="fixed inset-0 z-50 flex justify-end">
        {/* Subtle scrim — barely dims, just signals focus */}
        <div
          className="absolute inset-0 bg-warmgray-900/20"
          onClick={onClose}
        />

        {/* Panel */}
        <div className="relative w-full sm:w-[460px] h-full flex flex-col bg-white/95 backdrop-blur-xl border-l border-warmgray-200/60 shadow-[−8px_0_40px_rgba(60,40,20,0.10)] animate-slide-right">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-warmgray-100">
            <div>
              <p className="text-base font-bold text-warmgray-800">
                {isCreate ? '新規パターン作成' : 'パターン編集'}
              </p>
              <p className="text-xs text-warmgray-400 mt-0.5">
                {isCreate ? 'スロットを選択してパターンを定義します' : 'スロット構成を変更できます'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-warmgray-400 hover:text-warmgray-700 hover:bg-warmgray-100 transition-colors text-lg leading-none"
            >
              ×
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
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

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="label mb-0">有効スロット（承認ポジション）</label>
                <span className="text-xs text-warmgray-400">{activeSlotIds.size} 件選択</span>
              </div>
              <SlotToggleGroup title="稟議フェーズ"  slotType="RINGI"      slots={ringiSlots}   active={activeSlotIds} onToggle={toggleSlot} onNewSlot={handleNewSlot} onDeleteSlot={handleDeleteSlot} />
              <SlotToggleGroup title="精算フェーズ"  slotType="SETTLEMENT" slots={settleSlots}  active={activeSlotIds} onToggle={toggleSlot} onNewSlot={handleNewSlot} onDeleteSlot={handleDeleteSlot} />
              <SlotToggleGroup title="確認フェーズ"  slotType="CONFIRM"    slots={confirmSlots} active={activeSlotIds} onToggle={toggleSlot} onNewSlot={handleNewSlot} onDeleteSlot={handleDeleteSlot} />
            </div>
          </div>

          {/* Sticky footer */}
          <div className="px-6 py-4 border-t border-warmgray-100 bg-white/80 flex gap-2">
            <button
              disabled={!name.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              className="btn-primary flex-1"
            >
              {saveMutation.isPending ? '保存中...' : isCreate ? '作成する' : '変更を保存'}
            </button>
            <button onClick={onClose} className="btn-ghost text-warmgray-500 px-4">
              キャンセル
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function SlotDeleteConfirm({ usage, onConfirm, onCancel }: {
  usage: SlotUsage;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const hasImpact = usage.user_assignments > 0 || usage.pattern_count > 0 || usage.condition_count > 0;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-warmgray-900/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative glass rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4 animate-scale-in">
        <p className="text-base font-bold text-warmgray-800">スロットを削除しますか？</p>
        <p className="text-sm text-warmgray-600">
          「<span className="font-semibold">{usage.label_ja}</span>」を完全に削除します。この操作は取り消せません。
        </p>
        {hasImpact && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1 text-xs text-amber-800">
            <p className="font-bold">影響範囲：</p>
            {usage.user_assignments > 0 && <p>・ユーザースロット割り当て {usage.user_assignments} 件が削除されます</p>}
            {usage.pattern_count > 0    && <p>・パターンから除外されます（{usage.pattern_count} パターン）</p>}
            {usage.condition_count > 0  && <p>・条件設定 {usage.condition_count} 件が削除されます</p>}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={onConfirm} className="flex-1 text-sm font-bold px-4 py-2 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors">
            削除する
          </button>
          <button onClick={onCancel} className="btn-ghost text-warmgray-500">キャンセル</button>
        </div>
      </div>
    </div>
  );
}

function SlotToggleGroup({ title, slotType, slots, active, onToggle, onNewSlot, onDeleteSlot }: {
  title: string;
  slotType: string;
  slots: ApprovalSlot[];
  active: Set<string>;
  onToggle: (id: string) => void;
  onNewSlot: (slotType: string, label: string) => Promise<void>;
  onDeleteSlot: (slot: ApprovalSlot) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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
          const isSystem = SYSTEM_SLOT_CODES.has(s.slot_code);
          const hovered = hoveredId === s.id;
          return (
            <div
              key={s.id}
              className="relative inline-flex"
              onMouseEnter={() => setHoveredId(s.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <button
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
              {!isSystem && hovered && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onDeleteSlot(s); }}
                  title="スロットを削除"
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center hover:bg-red-600 shadow-sm transition-colors leading-none"
                >
                  ×
                </button>
              )}
            </div>
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

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['admin', 'departments'],
    queryFn: async () => (await apiClient.get('/admin/departments')).data,
    staleTime: 10 * 60_000,
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['admin', 'users'],
    queryFn: async () => (await apiClient.get('/admin/users')).data,
    staleTime: 5 * 60_000,
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
                departments={departments}
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

      {/* Approver replacement — retirement / transfer handling */}
      <ReplaceApproverSection users={users.filter(u => u.is_active)} showToast={showToast} />
    </div>
  );
}

// ── Approver replacement section ──────────────────────────────────────────────

interface ReplaceImpact { slot_count: number; pending_step_count: number }

function ReplaceApproverSection({ users, showToast }: {
  users: User[];
  showToast: (m: string, t?: 'success' | 'error' | 'info') => void;
}) {
  const queryClient = useQueryClient();
  const [fromUserId, setFromUserId] = useState('');
  const [toUserId, setToUserId] = useState('__null__');
  const [impact, setImpact] = useState<ReplaceImpact | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  const fromUser = users.find(u => u.id === fromUserId);
  const toUser   = toUserId === '__null__' ? null : users.find(u => u.id === toUserId);
  const isNull   = toUserId === '__null__';

  const userOptions = users.map(u => ({ value: u.id, label: `${u.full_name}${u.department_name ? ` (${u.department_name})` : ''}` }));
  const toOptions = [{ value: '__null__', label: '─ 空き（スキップ）にする ─' }, ...userOptions];

  // Dry-run: fetch impact counts whenever the source user changes.
  const loadImpact = async (uid: string) => {
    setImpact(null);
    if (!uid) return;
    try {
      const res = await apiClient.post('/admin/approval-slots/replace-approver', { from_user_id: uid, to_user_id: null, dry_run: true });
      setImpact(res.data as ReplaceImpact);
    } catch { /* preview is best-effort; execute still guards */ }
  };

  const execute = async () => {
    if (!fromUserId) return;
    setLoading(true);
    try {
      const res = await apiClient.post('/admin/approval-slots/replace-approver', {
        from_user_id: fromUserId,
        to_user_id:   isNull ? null : toUserId,
      });
      // Chain previews for affected applicants changed — drop cached user-slot queries.
      queryClient.invalidateQueries({ queryKey: ['admin', 'user-slots'] });
      showToast(`${res.data.updated_count} 件のスロットを置き換えました`);
      setConfirming(false);
      setFromUserId('');
      setToUserId('__null__');
      setImpact(null);
    } catch (e: any) {
      showToast(`置き換え失敗: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card space-y-5">
      <div>
        <p className="section-title">承認者一括置き換え</p>
        <p className="text-xs text-warmgray-500 mt-0.5">
          退職・異動時に、ある承認者が担当するすべてのユーザースロットを一括で別の人に変更します。
          空きを選ぶとそのスロットはスキップされます。
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">置き換え元（退職者・異動者）</label>
          <CustomSelect
            options={[{ value: '', label: '─ 選択 ─' }, ...userOptions]}
            value={fromUserId}
            onChange={v => { setFromUserId(v); void loadImpact(v); }}
          />
        </div>
        <div>
          <label className="label">置き換え先（後任者）</label>
          <CustomSelect
            options={toOptions.filter(o => o.value !== fromUserId)}
            value={toUserId}
            onChange={setToUserId}
          />
        </div>
      </div>

      {fromUserId && impact && (
        <div className="rounded-xl border border-warmgray-200 bg-white/50 p-3 text-xs space-y-1.5">
          <p className="text-warmgray-700">
            <span className="font-bold">{impact.slot_count}</span> 件のスロットが変更されます（今後の申請に反映）。
          </p>
          {impact.pending_step_count > 0 && (
            <p className="text-amber-700">
              ⚠️ 現在承認待ちの <span className="font-bold">{impact.pending_step_count}</span> 件は変更されません（進行中の承認は元の承認者のまま）。
            </p>
          )}
          {impact.slot_count === 0 && (
            <p className="text-warmgray-400">このユーザーは承認者として割り当てられていません。</p>
          )}
        </div>
      )}

      <button
        disabled={!fromUserId || !impact || impact.slot_count === 0}
        onClick={() => setConfirming(true)}
        className="btn-primary"
      >
        一括置き換え
      </button>

      {confirming && fromUser && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-warmgray-900/50 backdrop-blur-sm" onClick={() => !loading && setConfirming(false)} />
          <div className="relative glass rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4 animate-scale-in">
            <p className="text-base font-bold text-warmgray-800">承認者を置き換えますか？</p>
            <div className={`rounded-xl border p-3 text-sm ${isNull ? 'border-amber-200 bg-amber-50/60 text-amber-800' : 'border-teal-200 bg-teal-50/60 text-teal-800'}`}>
              {isNull
                ? <><span className="font-semibold">{fromUser.full_name}</span> が担当する全スロットを「未設定（スキップ）」にします。</>
                : <><span className="font-semibold">{fromUser.full_name}</span> → <span className="font-semibold">{toUser?.full_name}</span> に全スロットを置き換えます。</>}
            </div>
            <ul className="text-xs text-warmgray-600 space-y-1 list-disc pl-4">
              <li><span className="font-bold text-warmgray-800">{impact?.slot_count ?? 0}</span> 件のスロットが変更され、今後の申請に反映されます。</li>
              {(impact?.pending_step_count ?? 0) > 0 && (
                <li className="text-amber-700">現在承認待ちの <span className="font-bold">{impact!.pending_step_count}</span> 件は変更されません。進行中の承認は個別に対応してください。</li>
              )}
              <li>この操作は元に戻せません。</li>
            </ul>
            <div className="flex gap-2 pt-1">
              <button onClick={execute} disabled={loading} className="btn-primary flex-1">
                {loading ? '処理中...' : '置き換える'}
              </button>
              <button onClick={() => setConfirming(false)} disabled={loading} className="btn-ghost text-warmgray-500">
                キャンセル
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
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
  ROLE_IN:     '役職が含まれる',
  ROLE_NOT_IN: '役職が含まれない',
};

const ALL_ROLES = Object.keys(ROLE_MAP) as Role[];

// Multi-select pill toggle for roles — stores comma-separated role codes in condition_value
function RoleMultiSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const selected = new Set(value ? value.split(',').map(s => s.trim()).filter(Boolean) : []);
  const toggle = (role: string) => {
    const next = new Set(selected);
    next.has(role) ? next.delete(role) : next.add(role);
    onChange([...next].join(','));
  };
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {ALL_ROLES.map(role => {
        const on = selected.has(role);
        return (
          <button
            key={role}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(role)}
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors ${
              on
                ? 'bg-ringo-500 text-white border-ringo-500'
                : 'bg-white text-warmgray-500 border-warmgray-200 hover:border-ringo-300'
            }`}
          >
            {ROLE_MAP[role].label}
          </button>
        );
      })}
    </div>
  );
}

function DeptMultiSelect({ value, onChange, departments }: {
  value: string;
  onChange: (v: string) => void;
  departments: Department[];
}) {
  const selected = new Set(value ? value.split(',').map(s => s.trim()).filter(Boolean) : []);
  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange([...next].join(','));
  };
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {departments.map(dept => {
        const on = selected.has(dept.id);
        return (
          <button
            key={dept.id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(dept.id)}
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors ${
              on
                ? 'bg-teal-500 text-white border-teal-500'
                : 'bg-white text-warmgray-500 border-warmgray-200 hover:border-teal-300'
            }`}
          >
            {dept.name}
          </button>
        );
      })}
      {departments.length === 0 && (
        <span className="text-[10px] text-warmgray-400">部署を読み込み中...</span>
      )}
    </div>
  );
}

function ConditionsSection({ conditions, patterns, slots, departments, onChange, loading, dirty, onSave, saving }: {
  conditions: Condition[];
  patterns: Pattern[];
  slots: ApprovalSlot[];
  departments: Department[];
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
            <div className={c.condition_type.startsWith('ROLE') || c.condition_type.startsWith('DEPT') ? 'col-span-2' : ''}>
              <label className="label">値</label>
              {c.condition_type.startsWith('ROLE') ? (
                <RoleMultiSelect value={c.condition_value} onChange={v => update(idx, { condition_value: v })} />
              ) : c.condition_type.startsWith('DEPT') ? (
                <DeptMultiSelect value={c.condition_value} onChange={v => update(idx, { condition_value: v })} departments={departments} />
              ) : (
                <input
                  type="text"
                  value={c.condition_value}
                  onChange={e => update(idx, { condition_value: e.target.value })}
                  placeholder="例: 10000"
                  className="input"
                />
              )}
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
