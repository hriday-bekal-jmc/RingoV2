import { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import Layout from '../components/common/Layout';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { usePermissions } from '../hooks/usePermissions';
import apiClient from '../services/apiClient';
import type { Lang } from '../i18n';

function nameToColor(name: string): string {
  const colors = ['from-ringo-400 to-ringo-600', 'from-mustard-400 to-mustard-600', 'from-teal-500 to-teal-700', 'from-warmgray-500 to-warmgray-700'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return colors[h % colors.length];
}

export default function Profile() {
  const { user, setUser } = useAuth();
  const { lang, setLang, t } = useLang();
  const perms = usePermissions(user?.role, user?.is_admin);

  const [name, setName] = useState(user?.full_name ?? '');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [avatarStatus, setAvatarStatus] = useState<'idle' | 'uploading' | 'saved' | 'error'>('idle');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: async (full_name: string) =>
      (await apiClient.patch('/auth/me', { full_name })).data,
    onSuccess: (data) => {
      setUser((prev) => prev ? { ...prev, full_name: data.user.full_name } : prev);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    },
    onError: () => {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    },
  });

  const gradient = nameToColor(name || user?.full_name || '?');
  const initial = (name || user?.full_name || '?').slice(0, 1);

  const avatarMutation = useMutation({
    mutationFn: async (avatar_url: string) =>
      (await apiClient.post('/auth/me/avatar', { avatar_url })).data,
    onSuccess: (data) => {
      setUser((prev) => prev ? { ...prev, avatar_url: data.avatar_url } : prev);
      setAvatarStatus('saved');
      setAvatarPreview(null);
      setTimeout(() => setAvatarStatus('idle'), 3000);
    },
    onError: () => { setAvatarStatus('error'); setTimeout(() => setAvatarStatus('idle'), 3000); },
  });

  const removeAvatarMutation = useMutation({
    mutationFn: async () => (await apiClient.delete('/auth/me/avatar')).data,
    onSuccess: () => {
      setUser((prev) => prev ? { ...prev, avatar_url: null } : prev);
      setAvatarPreview(null);
      setAvatarStatus('saved');
      setTimeout(() => setAvatarStatus('idle'), 3000);
    },
    onError: () => { setAvatarStatus('error'); setTimeout(() => setAvatarStatus('idle'), 3000); },
  });

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setAvatarStatus('error'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      // Resize to 300×300 using Canvas before storing
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const SIZE = 300;
        canvas.width = SIZE; canvas.height = SIZE;
        const ctx = canvas.getContext('2d')!;
        // crop to square from center
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, SIZE, SIZE);
        setAvatarPreview(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  }

  const LANG_OPTIONS: { value: Lang; label: string; flag: string }[] = [
    { value: 'ja', label: '日本語', flag: '🇯🇵' },
    { value: 'en', label: 'English', flag: '🇺🇸' },
  ];

  return (
    <Layout title={t('title_profile')}>
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="animate-fade-up">
          <p className="section-title mb-0">{t('title_profile')}</p>
          <h2 className="text-2xl font-bold text-warmgray-800 mt-1">{t('nav_profile')}</h2>
        </div>

        {/* Avatar + basic info */}
        <div className="card animate-fade-up">
          <div className="flex items-center gap-5 mb-5">
            {/* Avatar display */}
            <div className="relative group shrink-0">
              {(avatarPreview ?? user?.avatar_url) ? (
                <img
                  src={avatarPreview ?? user!.avatar_url!}
                  alt={user?.full_name}
                  className="w-20 h-20 rounded-2xl object-cover ring-2 ring-white/60"
                />
              ) : (
                <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-3xl font-bold shadow-lg`}>
                  {initial}
                </div>
              )}
              {/* Overlay camera icon */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 rounded-2xl bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                title="画像を変更"
              >
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="text-lg font-bold text-warmgray-800 truncate">{user?.full_name}</div>
              <div className="text-sm text-warmgray-400 truncate">{user?.email}</div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="badge-ringo">{perms.label}</span>
                {user?.department_name && (
                  <span className="text-xs text-warmgray-400">{user.department_name}</span>
                )}
              </div>
            </div>
          </div>

          {/* Avatar controls */}
          <div className="flex items-center gap-2 flex-wrap">
            {avatarPreview ? (
              <>
                <button
                  className="btn-primary btn-sm"
                  disabled={avatarMutation.isPending}
                  onClick={() => avatarMutation.mutate(avatarPreview)}
                >
                  {avatarMutation.isPending ? '保存中...' : '✓ この画像を保存'}
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setAvatarPreview(null)}>
                  キャンセル
                </button>
              </>
            ) : (
              <>
                <button className="btn-outline btn-sm" onClick={() => fileInputRef.current?.click()}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  画像をアップロード
                </button>
                {user?.avatar_url && (
                  <button
                    className="btn-ghost btn-sm text-red-500 hover:text-red-600"
                    disabled={removeAvatarMutation.isPending}
                    onClick={() => removeAvatarMutation.mutate()}
                  >
                    {removeAvatarMutation.isPending ? '削除中...' : '画像を削除'}
                  </button>
                )}
              </>
            )}
            <span className={`text-xs font-semibold ml-auto transition-all ${
              avatarStatus === 'saved' ? 'text-emerald-600' :
              avatarStatus === 'error' ? 'text-ringo-600' : 'text-transparent'
            }`}>
              {avatarStatus === 'saved' ? '✓ 保存しました' :
               avatarStatus === 'error' ? 'エラーが発生しました' : '・'}
            </span>
          </div>
          <p className="text-[11px] text-warmgray-400 mt-2">
            JPG・PNG・GIF対応。アップロード後、300×300pxに自動リサイズされます。
          </p>
        </div>

        {/* Edit name */}
        <div className="card animate-fade-up space-y-4">
          <div>
            <p className="section-title mb-0">{t('profile_name_label')}</p>
            <h3 className="text-base font-bold text-warmgray-800 mt-0.5">表示名の変更</h3>
          </div>
          <div>
            <label className="label">{t('profile_name_label')}</label>
            <input
              type="text"
              className="input"
              value={name}
              onChange={(e) => { setName(e.target.value); setSaveStatus('idle'); }}
              placeholder={user?.full_name ?? '名前を入力'}
              maxLength={64}
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className={`text-xs font-semibold transition-all ${
              saveStatus === 'saved' ? 'text-emerald-600' :
              saveStatus === 'error' ? 'text-ringo-600' : 'text-transparent'
            }`}>
              {saveStatus === 'saved' ? `✓ ${t('profile_save_success')}` :
               saveStatus === 'error' ? '保存に失敗しました' : ''}
            </span>
            <button
              className="btn-primary"
              disabled={mutation.isPending || !name.trim() || name.trim() === user?.full_name}
              onClick={() => mutation.mutate(name.trim())}
            >
              {mutation.isPending ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  保存中...
                </span>
              ) : t('btn_save')}
            </button>
          </div>
        </div>

        {/* Language selector */}
        <div className="card animate-fade-up space-y-4">
          <div>
            <p className="section-title mb-0">{t('profile_lang_label')}</p>
            <h3 className="text-base font-bold text-warmgray-800 mt-0.5">{t('profile_lang_label')}</h3>
            <p className="text-xs text-warmgray-400 mt-1">{t('profile_lang_hint')}</p>
          </div>
          <div className="flex gap-3">
            {LANG_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setLang(opt.value)}
                className={`flex-1 flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all duration-150 ${
                  lang === opt.value
                    ? 'border-ringo-500 bg-ringo-50/60 text-ringo-700 shadow-sm'
                    : 'border-white/60 bg-white/40 text-warmgray-600 hover:border-warmgray-300 hover:bg-white/70'
                }`}
              >
                <span className="text-lg">{opt.flag}</span>
                {opt.label}
                {lang === opt.value && (
                  <svg className="w-4 h-4 text-ringo-500 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Read-only info */}
        <div className="card animate-fade-up">
          <p className="section-title mb-4">アカウント情報</p>
          <dl className="space-y-3">
            <div className="flex justify-between text-sm">
              <dt className="text-warmgray-400 font-medium">{t('profile_email_label')}</dt>
              <dd className="text-warmgray-800 font-semibold">{user?.email}</dd>
            </div>
            <div className="flex justify-between text-sm">
              <dt className="text-warmgray-400 font-medium">{t('profile_role_label')}</dt>
              <dd><span className="badge-ringo">{perms.label}</span></dd>
            </div>
            {user?.department_name && (
              <div className="flex justify-between text-sm">
                <dt className="text-warmgray-400 font-medium">{t('profile_dept_label')}</dt>
                <dd className="text-warmgray-800 font-semibold">{user.department_name}</dd>
              </div>
            )}
          </dl>
        </div>

      </div>
    </Layout>
  );
}
