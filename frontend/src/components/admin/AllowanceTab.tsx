import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import apiClient from '../../services/apiClient';
import RingoLoader from '../common/RingoLoader';
import { useLang } from '../../context/LanguageContext';

interface AllowanceRate {
  role: string;
  daily_rate_yen: number;
}

export default function AllowanceTab({ showToast }: { showToast: (msg: string, type?: 'success' | 'error') => void }) {
  const { lang, t } = useLang();
  const queryClient = useQueryClient();
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editVal, setEditVal] = useState<string>('');

  const { data, isLoading } = useQuery<{ rates: AllowanceRate[]; user_daily_rate: number | null }>({
    queryKey: ['allowance-rates'],
    queryFn: async () => (await apiClient.get('/allowance-rates')).data,
    staleTime: 5 * 60_000,
  });

  const showLoader = useDelayedLoading(isLoading);

  const patchRate = useMutation({
    mutationFn: async ({ role, daily_rate_yen }: { role: string; daily_rate_yen: number }) =>
      apiClient.patch(`/allowance-rates/${encodeURIComponent(role)}`, { daily_rate_yen }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allowance-rates'] });
      showToast(lang === 'ja' ? '日当レートを更新しました' : 'Allowance rate updated', 'success');
      setEditingRole(null);
    },
    onError: (err: any) => {
      showToast(err?.data?.error ?? err?.message ?? (lang === 'ja' ? '更新に失敗しました' : 'Update failed'), 'error');
    },
  });

  const startEdit = (rate: AllowanceRate) => {
    setEditingRole(rate.role);
    setEditVal(String(rate.daily_rate_yen));
  };

  const saveEdit = (role: string) => {
    const val = parseInt(editVal, 10);
    if (isNaN(val) || val < 0) {
      showToast(lang === 'ja' ? '有効な金額を入力してください' : 'Enter a valid amount', 'error');
      return;
    }
    patchRate.mutate({ role, daily_rate_yen: val });
  };

  const ROLE_LABELS: Record<string, string> = {
    SHITSUCHO:         lang === 'ja' ? '室長'             : 'Division Chief',
    GM:                lang === 'ja' ? 'ゼネラルマネージャー' : 'General Manager',
    SENIOR_MANAGER:    lang === 'ja' ? 'シニアマネージャー'   : 'Senior Manager',
    MANAGER:           lang === 'ja' ? 'マネージャー'        : 'Manager',
    SUB_MANAGER:       lang === 'ja' ? 'サブマネージャー'     : 'Sub Manager',
    SUB_MANAGER_TSUKI: lang === 'ja' ? 'サブマネージャー付'   : 'Associate Sub Manager',
    LEADER:            lang === 'ja' ? 'リーダー'           : 'Leader',
    SUB_LEADER:        lang === 'ja' ? 'サブリーダー'        : 'Sub Leader',
    CHIEF:             lang === 'ja' ? 'チーフ'             : 'Chief',
    MEMBER:            lang === 'ja' ? 'メンバー'           : 'Member',
    SENMU:             lang === 'ja' ? '専務'              : 'Managing Director',
    PRESIDENT:         lang === 'ja' ? '社長'              : 'President',
  };

  if (showLoader) return <div className="card flex justify-center py-12"><RingoLoader.Block /></div>;
  if (isLoading) return null; // loader-delay window — blank, never flash empty UI while fetching

  return (
    <div className="card space-y-5">
      <div className="flex items-center gap-3 pb-4 border-b border-white/40">
        <span className="text-xl">💴</span>
        <div>
          <h3 className="font-bold text-warmgray-800">
            {lang === 'ja' ? '日当レート管理' : 'Daily Allowance Rates'}
          </h3>
          <p className="text-xs text-warmgray-500 mt-0.5">
            {lang === 'ja'
              ? '役割ごとの日当単価を設定します。変更は次回ログイン時に適用されます。'
              : 'Set daily allowance rates per role. Changes apply on next login.'}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {(data?.rates ?? []).map((rate) => (
          <div
            key={rate.role}
            className="flex items-center gap-3 px-4 py-3 bg-white/60 border border-white/80 rounded-xl"
          >
            {/* Role badge */}
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-warmgray-100 text-warmgray-700 shrink-0 min-w-[80px] justify-center">
              {t(`role_${rate.role}`) !== `role_${rate.role}` ? t(`role_${rate.role}`) : (ROLE_LABELS[rate.role] ?? rate.role)}
            </span>

            {/* Rate display or edit */}
            {editingRole === rate.role ? (
              <div className="flex items-center gap-2 flex-1">
                <span className="text-warmgray-500 text-sm">¥</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={editVal}
                  onChange={(e) => setEditVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit(rate.role);
                    if (e.key === 'Escape') setEditingRole(null);
                  }}
                  className="input w-32 text-sm py-1.5"
                  autoFocus
                />
                <span className="text-warmgray-400 text-xs">{lang === 'ja' ? '円/日' : 'JPY/day'}</span>
                <button
                  onClick={() => saveEdit(rate.role)}
                  disabled={patchRate.isPending}
                  className="btn-primary text-xs py-1.5 px-3 ml-auto"
                >
                  {lang === 'ja' ? '保存' : 'Save'}
                </button>
                <button
                  onClick={() => setEditingRole(null)}
                  className="btn-ghost text-xs py-1.5 px-3"
                >
                  {lang === 'ja' ? 'キャンセル' : 'Cancel'}
                </button>
              </div>
            ) : (
              <>
                <span className="text-warmgray-800 font-semibold flex-1">
                  ¥{rate.daily_rate_yen.toLocaleString('ja-JP')}
                  <span className="text-xs font-normal text-warmgray-400 ml-1">{lang === 'ja' ? '/ 日' : '/ day'}</span>
                </span>
                <button
                  onClick={() => startEdit(rate)}
                  className="text-xs font-medium text-warmgray-500 hover:text-warmgray-800 transition-colors"
                >
                  {lang === 'ja' ? '編集' : 'Edit'}
                </button>
              </>
            )}
          </div>
        ))}

        {(data?.rates ?? []).length === 0 && (
          <p className="text-sm text-warmgray-400 text-center py-8">
            {lang === 'ja' ? 'レートが設定されていません。' : 'No rates configured.'}
          </p>
        )}
      </div>

      <p className="text-xs text-warmgray-400">
        {lang === 'ja'
          ? '* 日当レートを変更すると、その役割に所属する全員の日当単価が自動更新されます。'
          : '* Updating a rate automatically backfills all users with that role.'}
      </p>
    </div>
  );
}
