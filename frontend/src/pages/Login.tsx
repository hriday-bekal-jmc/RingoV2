import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../services/apiClient';

const features = [
  { icon: '📋', label: '稟議フロー管理', desc: '部門別の承認ルートを自動で回付' },
  { icon: '🧾', label: '精算・領収書管理', desc: '出張精算から領収書アップロードまで' },
  { icon: '✅', label: '多段階承認チェーン', desc: '上長→部門長→専務→社長の承認フロー' },
  { icon: '📊', label: '経理ダッシュボード', desc: '精算状況の一覧確認とCSV出力' },
];

export default function Login() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePasswordLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiClient.post('/auth/login', { email, password });
      setUser(res.data.user);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setError(err.message || 'ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel: RINGO branding ─────────────────────────── */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[520px] flex-col justify-between bg-ringo-700 text-cream-50 px-12 py-14 shrink-0">
        {/* Logo */}
        <div>
          <div className="flex items-center gap-3 mb-12">
            <div className="w-12 h-12 rounded-xl bg-ringo-500 flex items-center justify-center text-2xl font-bold shadow-lg">
              R
            </div>
            <div>
              <div className="text-2xl font-bold tracking-wide">リンゴ</div>
              <div className="text-xs text-cream-200 tracking-widest">RINGO</div>
            </div>
          </div>

          <h2 className="text-3xl font-bold leading-snug mb-4 text-cream-50">
            稟議・精算を<br />もっとスムーズに。
          </h2>
          <p className="text-cream-200 text-sm leading-relaxed mb-12">
            社内の承認フローと経費精算をひとつのシステムで管理。
            紙とメールによるやり取りをゼロに。
          </p>

          {/* Features */}
          <div className="space-y-5">
            {features.map((f) => (
              <div key={f.label} className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-lg bg-ringo-800/60 flex items-center justify-center text-lg shrink-0">
                  {f.icon}
                </div>
                <div>
                  <div className="text-sm font-semibold text-cream-50">{f.label}</div>
                  <div className="text-xs text-cream-200 mt-0.5">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="text-xs text-cream-200/60 mt-8">
          © 2026 JMC Ltd. — RINGO v0.1
        </div>
      </div>

      {/* ── Right panel: login form ─────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-cream-100 px-6 py-12">
        <div className="w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div className="w-10 h-10 rounded-xl bg-ringo-500 flex items-center justify-center text-xl font-bold text-white">R</div>
            <div className="text-xl font-bold text-ringo-700 tracking-wide">RINGO</div>
          </div>

          <h1 className="text-2xl font-bold text-warmgray-800 mb-1">ログイン</h1>
          <p className="text-sm text-warmgray-600 mb-8">アカウントにサインインしてください</p>

          {/* Google button */}
          <button
            type="button"
            onClick={() => { window.location.href = '/api/auth/google'; }}
            className="w-full flex items-center justify-center gap-3 bg-cream-50 border border-ringo-200 rounded-lg px-4 py-3 text-sm font-semibold text-warmgray-800 hover:bg-white hover:border-ringo-300 hover:shadow-sm transition-all mb-6"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Googleアカウントでログイン
          </button>

          {/* Divider */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 h-px bg-ringo-200" />
            <span className="text-xs text-warmgray-600 font-medium">または</span>
            <div className="flex-1 h-px bg-ringo-200" />
          </div>

          {/* Email + password form */}
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 bg-ringo-50 border border-ringo-200 text-ringo-700 text-sm rounded-lg px-4 py-3">
                <span className="mt-0.5 shrink-0">⚠</span>
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="label">メールアドレス</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="yourname@jmc-ltd.co.jp"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="label">パスワード</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              className="btn-primary w-full py-3 text-base"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  ログイン中...
                </span>
              ) : 'ログイン'}
            </button>
          </form>

          <p className="text-xs text-warmgray-600/70 text-center mt-8">
            ログインに問題がある場合は管理者にお問い合わせください。
          </p>
        </div>
      </div>
    </div>
  );
}
