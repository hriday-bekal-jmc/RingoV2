import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../services/apiClient';

// ── Floating orb for background animation ───────────────────────────────────
function Orb({
  size,
  top,
  left,
  delay,
  opacity,
}: {
  size: number;
  top: string;
  left: string;
  delay: number;
  opacity: number;
}) {
  return (
    <div
      className="absolute rounded-full pointer-events-none"
      style={{
        width: size,
        height: size,
        top,
        left,
        background: 'radial-gradient(circle, rgba(224,80,70,1) 0%, rgba(224,80,70,0) 70%)',
        opacity,
        animation: `float ${6 + delay}s ease-in-out ${delay}s infinite alternate`,
      }}
    />
  );
}

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
    <>
      {/* Inject keyframe animations */}
      <style>{`
        @keyframes float {
          0%   { transform: translateY(0px) scale(1); }
          100% { transform: translateY(-28px) scale(1.06); }
        }
        @keyframes logo-breathe {
          0%, 100% { transform: scale(1); filter: drop-shadow(0 0 0px rgba(224,80,70,0)); }
          50%       { transform: scale(1.04); filter: drop-shadow(0 0 18px rgba(224,80,70,0.35)); }
        }
        @keyframes dash-in {
          from { stroke-dashoffset: 600; opacity: 0; }
          to   { stroke-dashoffset: 0;   opacity: 1; }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .logo-animate {
          animation: logo-breathe 4s ease-in-out infinite;
        }
        .form-fade {
          animation: fade-up 0.6s ease both;
        }
        .form-fade-1 { animation-delay: 0.05s; }
        .form-fade-2 { animation-delay: 0.12s; }
        .form-fade-3 { animation-delay: 0.19s; }
        .form-fade-4 { animation-delay: 0.26s; }
        .form-fade-5 { animation-delay: 0.33s; }
      `}</style>

      <div className="min-h-screen flex">

        {/* ── Left panel: animated branding ─────────────────────── */}
        <div className="hidden lg:flex lg:w-[460px] xl:w-[500px] shrink-0 relative overflow-hidden flex-col items-center justify-center"
          style={{ background: 'linear-gradient(145deg, #2a1512 0%, #4a1e18 40%, #7a2d24 100%)' }}
        >
          {/* Animated background orbs */}
          <Orb size={320} top="-80px"  left="-80px"   delay={0}   opacity={0.18} />
          <Orb size={240} top="55%"    left="60%"     delay={2}   opacity={0.14} />
          <Orb size={180} top="70%"    left="-40px"   delay={1}   opacity={0.12} />
          <Orb size={140} top="15%"    left="65%"     delay={3}   opacity={0.10} />
          <Orb size={100} top="40%"    left="80%"     delay={1.5} opacity={0.08} />

          {/* Subtle grid overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          />

          {/* Center content */}
          <div className="relative z-10 flex flex-col items-center text-center px-10 select-none">
            {/*
              Brand logo — official mark (apple + arrow-leaf). Tinted via
              mask-image so we control color from one source SVG. Light pink
              on the dark login background keeps it legible without clashing.
            */}
            <div className="logo-animate mb-6">
              <span
                className="block"
                style={{
                  width:              96,
                  height:             96,
                  backgroundColor:    '#f5e8e6',
                  WebkitMaskImage:    'url(/ringo-mark.svg)',
                  maskImage:          'url(/ringo-mark.svg)',
                  WebkitMaskRepeat:   'no-repeat',
                  maskRepeat:         'no-repeat',
                  WebkitMaskPosition: 'center',
                  maskPosition:       'center',
                  WebkitMaskSize:     'contain',
                  maskSize:           'contain',
                }}
                aria-label="RINGO"
              />
            </div>

            {/* Wordmark */}
            <div className="mb-8">
              <div
                className="text-4xl font-black tracking-[0.18em] mb-1"
                style={{ color: '#f5e8e6', letterSpacing: '0.22em' }}
              >
                RINGO
              </div>
              <div
                className="text-sm font-medium tracking-widest"
                style={{ color: 'rgba(245,232,230,0.55)', letterSpacing: '0.25em' }}
              >
                稟議・精算
              </div>
            </div>

            {/* Thin divider */}
            <div className="w-16 h-px mb-8" style={{ background: 'rgba(224,80,70,0.5)' }} />

            {/* Tagline */}
            <p
              className="text-lg font-semibold leading-relaxed mb-2"
              style={{ color: 'rgba(245,232,230,0.88)' }}
            >
              稟議・精算を<br />もっとスムーズに。
            </p>
            <p
              className="text-xs leading-relaxed max-w-[260px]"
              style={{ color: 'rgba(245,232,230,0.42)' }}
            >
              社内承認フローと経費精算を<br />ひとつのシステムで管理
            </p>
          </div>

          {/* Bottom copyright */}
          <div
            className="absolute bottom-6 text-[11px] tracking-widest"
            style={{ color: 'rgba(245,232,230,0.25)' }}
          >
            © 2026 JMC Ltd.
          </div>
        </div>

        {/* ── Right panel: login form ─────────────────────────────── */}
        <div className="flex-1 flex items-center justify-center px-6 py-12"
          style={{ background: '#FAF8F5' }}
        >
          <div className="w-full max-w-[380px]">

            {/* Logo — mobile only. Tinted brand red via mask-image on light bg. */}
            <div className="flex flex-col items-center mb-10 lg:hidden form-fade form-fade-1">
              <span
                className="block"
                style={{
                  width:              56,
                  height:             56,
                  backgroundColor:    '#D23F3F',
                  WebkitMaskImage:    'url(/ringo-mark.svg)',
                  maskImage:          'url(/ringo-mark.svg)',
                  WebkitMaskRepeat:   'no-repeat',
                  maskRepeat:         'no-repeat',
                  WebkitMaskPosition: 'center',
                  maskPosition:       'center',
                  WebkitMaskSize:     'contain',
                  maskSize:           'contain',
                }}
                aria-label="RINGO"
              />
              <div className="mt-3 text-xl font-black tracking-[0.2em] text-warmgray-800">RINGO</div>
              <div className="text-[11px] tracking-widest text-warmgray-400 mt-0.5">稟議・精算</div>
            </div>

            {/* Heading */}
            <div className="mb-8 form-fade form-fade-1">
              <h1 className="text-2xl font-bold text-warmgray-800 mb-1">おかえりなさい</h1>
              <p className="text-sm text-warmgray-500">アカウントにサインインしてください</p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 bg-ringo-50 border border-ringo-200 text-ringo-700 text-sm rounded-xl px-4 py-3 mb-5 form-fade">
                <span className="shrink-0 mt-0.5">⚠</span>
                <span>{error}</span>
              </div>
            )}

            {/* Google SSO */}
            <div className="form-fade form-fade-2">
              <button
                type="button"
                onClick={() => { window.location.href = '/api/auth/google'; }}
                className="w-full flex items-center justify-center gap-3 bg-white border border-surface-200 rounded-xl px-4 py-3.5 text-sm font-semibold text-warmgray-800 hover:bg-surface-50 hover:border-surface-300 hover:shadow-sm transition-all duration-150"
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Googleアカウントでログイン
              </button>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-4 my-6 form-fade form-fade-3">
              <div className="flex-1 h-px bg-surface-200" />
              <span className="text-xs text-warmgray-400 font-medium">または</span>
              <div className="flex-1 h-px bg-surface-200" />
            </div>

            {/* Email + password */}
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div className="form-fade form-fade-3">
                <label className="block text-xs font-bold uppercase tracking-widest text-warmgray-400 mb-1.5">
                  メールアドレス
                </label>
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

              <div className="form-fade form-fade-4">
                <label className="block text-xs font-bold uppercase tracking-widest text-warmgray-400 mb-1.5">
                  パスワード
                </label>
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

              <div className="form-fade form-fade-5 pt-1">
                <button
                  type="submit"
                  className="btn-primary w-full py-3.5 text-base font-bold rounded-xl"
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
              </div>
            </form>

            <p className="text-[11px] text-warmgray-400 text-center mt-8 form-fade form-fade-5">
              ログインに問題がある場合は管理者にお問い合わせください。
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
