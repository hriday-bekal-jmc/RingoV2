import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import CustomSelect from '../forms/CustomSelect';

interface User { id: string; full_name: string; department_name?: string; is_active: boolean }
interface ApprovalSlot { id: string; slot_code: string; label_ja: string; slot_type: string; sort_order: number }
interface SlotAssignment { slot_id: string; approver_id: string | null }

export default function SlotsTab({ showToast }: {
  showToast: (m: string, t?: 'success' | 'error' | 'info') => void;
}) {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [copyFromUserId, setCopyFromUserId] = useState('');
  const [showCopyFrom, setShowCopyFrom] = useState(false);
  const [dirty, setDirty] = useState<Record<string, string | null>>({});

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['admin', 'users'],
    queryFn: async () => (await apiClient.get('/admin/users')).data,
    staleTime: 5 * 60_000,
  });

  const { data: slots = [] } = useQuery<ApprovalSlot[]>({
    queryKey: ['admin', 'approval-slots'],
    queryFn: async () => (await apiClient.get('/admin/approval-slots')).data,
    staleTime: 30 * 60_000,
  });

  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery<SlotAssignment[]>({
    queryKey: ['admin', 'user-slots', selectedUserId],
    queryFn: async () => (await apiClient.get(`/admin/users/${selectedUserId}/approval-slots`)).data,
    enabled: !!selectedUserId,
    staleTime: 60_000,
  });

  const assignmentMap = Object.fromEntries(assignments.map(a => [a.slot_id, a.approver_id]));
  const effectiveMap: Record<string, string | null> = { ...assignmentMap, ...dirty };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const slotsPayload = slots.map(s => ({
        slot_id: s.id,
        approver_id: effectiveMap[s.id] ?? null,
      }));
      await apiClient.put(`/admin/users/${selectedUserId}/approval-slots`, { slots: slotsPayload });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'user-slots', selectedUserId] });
      setDirty({});
      showToast('スロットを保存しました');
    },
    onError: (err: any) => showToast(`保存失敗: ${err.message}`, 'error'),
  });

  const copyMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post(`/admin/users/${selectedUserId}/approval-slots/copy-from`, {
        source_user_id: copyFromUserId,
        force: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'user-slots', selectedUserId] });
      setDirty({});
      setShowCopyFrom(false);
      setCopyFromUserId('');
      showToast('スロットをコピーしました');
    },
    onError: (err: any) => showToast(`コピー失敗: ${err.message}`, 'error'),
  });

  const activeUsers = users.filter(u => u.is_active);
  const userOptions = activeUsers.map(u => ({
    value: u.id,
    label: `${u.full_name}${u.department_name ? ` (${u.department_name})` : ''}`,
  }));
  const approverOptions = [
    { value: '', label: '─ 未設定 ─' },
    ...activeUsers.map(u => ({ value: u.id, label: u.full_name })),
  ];

  const ringiSlots  = slots.filter(s => s.slot_type === 'RINGI');
  const settleSlots = slots.filter(s => s.slot_type === 'SETTLEMENT');
  const confirmSlots = slots.filter(s => s.slot_type === 'CONFIRM');
  const isDirty = Object.keys(dirty).length > 0;

  return (
    <div className="space-y-5">
      <div className="card space-y-4">
        <div>
          <p className="section-title">承認スロット管理</p>
          <p className="text-xs text-warmgray-500 mt-0.5">ユーザーごとに18スロットの承認者を設定します。未設定スロットは自動でスキップされます。</p>
        </div>

        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="label">ユーザーを選択</label>
            <CustomSelect
              options={[{ value: '', label: '─ ユーザーを選択 ─' }, ...userOptions]}
              value={selectedUserId}
              onChange={(v) => { setSelectedUserId(v); setDirty({}); }}
            />
          </div>
          {selectedUserId && (
            <button
              onClick={() => setShowCopyFrom(s => !s)}
              className="btn-ghost text-sm border border-warmgray-200"
            >
              他ユーザーからコピー
            </button>
          )}
        </div>

        {showCopyFrom && selectedUserId && (
          <div className="flex items-end gap-3 p-3 bg-amber-50/60 border border-amber-200/60 rounded-xl flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="label">コピー元ユーザー</label>
              <CustomSelect
                options={[{ value: '', label: '─ 選択 ─' }, ...userOptions.filter(u => u.value !== selectedUserId)]}
                value={copyFromUserId}
                onChange={setCopyFromUserId}
              />
            </div>
            <button
              disabled={!copyFromUserId || copyMutation.isPending}
              onClick={() => copyMutation.mutate()}
              className="btn-primary text-sm"
            >
              {copyMutation.isPending ? 'コピー中...' : 'コピー実行'}
            </button>
            <button
              onClick={() => { setShowCopyFrom(false); setCopyFromUserId(''); }}
              className="btn-ghost text-sm text-warmgray-500"
            >
              キャンセル
            </button>
          </div>
        )}
      </div>

      {selectedUserId ? (
        <div className="card space-y-5">
          {assignmentsLoading ? (
            <div className="text-center text-warmgray-400 text-sm py-8">読み込み中...</div>
          ) : (
            <>
              <SlotGroup
                title="稟議フェーズ"
                slots={ringiSlots}
                effectiveMap={effectiveMap}
                approverOptions={approverOptions}
                dirty={dirty}
                setDirty={setDirty}
              />
              <SlotGroup
                title="精算フェーズ"
                slots={settleSlots}
                effectiveMap={effectiveMap}
                approverOptions={approverOptions}
                dirty={dirty}
                setDirty={setDirty}
              />
              {confirmSlots.length > 0 && (
                <SlotGroup
                  title="確認フェーズ"
                  slots={confirmSlots}
                  effectiveMap={effectiveMap}
                  approverOptions={approverOptions}
                  dirty={dirty}
                  setDirty={setDirty}
                />
              )}

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/40">
                {isDirty && <span className="text-xs text-amber-600">未保存の変更があります</span>}
                <button
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                  className="btn-primary"
                >
                  {saveMutation.isPending ? '保存中...' : '保存'}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="card text-center py-12 text-warmgray-400 text-sm">
          ユーザーを選択してスロットを設定してください
        </div>
      )}
    </div>
  );
}

function SlotGroup({ title, slots, effectiveMap, approverOptions, dirty, setDirty }: {
  title: string;
  slots: ApprovalSlot[];
  effectiveMap: Record<string, string | null>;
  approverOptions: { value: string; label: string }[];
  dirty: Record<string, string | null>;
  setDirty: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
}) {
  if (slots.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-widest text-warmgray-400">{title}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {slots.map(slot => {
          const current = effectiveMap[slot.id] ?? null;
          const isChanged = dirty[slot.id] !== undefined;
          return (
            <div
              key={slot.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                isChanged ? 'border-amber-300 bg-amber-50/40' : 'border-warmgray-100 bg-white/40'
              }`}
            >
              <div className="w-28 shrink-0">
                <p className="text-xs font-semibold text-warmgray-700">{slot.label_ja}</p>
                <p className="text-[10px] text-warmgray-400">{slot.slot_code}</p>
              </div>
              <div className="flex-1 min-w-0">
                <CustomSelect
                  options={approverOptions}
                  value={current ?? ''}
                  onChange={(v) => setDirty(prev => ({ ...prev, [slot.id]: v || null }))}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
