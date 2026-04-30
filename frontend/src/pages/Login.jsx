export default function Login() {
  const handleGoogleLogin = () => {
    window.location.href = '/api/auth/google';
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-cream-100 to-ringo-100 px-4">
      <div className="card w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-ringo-500 text-white text-3xl font-bold mb-4">
            R
          </div>
          <h1 className="text-3xl font-bold text-ringo-700 tracking-wide">RINGO</h1>
          <p className="text-warmgray-600 mt-2 text-sm">稟議・精算ワークフロー</p>
        </div>
        <button onClick={handleGoogleLogin} className="btn-primary w-full">
          Googleアカウントでログイン
        </button>
        <p className="text-xs text-warmgray-600 mt-6 text-center">
          会社のGoogle Workspaceアカウントでサインインしてください。
        </p>
      </div>
    </div>
  );
}
