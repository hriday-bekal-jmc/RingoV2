import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';

interface HeaderProps { title: string }

function nameToColor(name: string): string {
  const colors = ['from-ringo-400 to-ringo-600', 'from-mustard-400 to-mustard-600', 'from-teal-500 to-teal-700', 'from-warmgray-500 to-warmgray-700'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return colors[h % colors.length];
}

export default function Header({ title }: HeaderProps) {
  const { user, logout } = useAuth();
  const { t } = useLang();
  const displayName = user?.full_name || 'Guest';
  const dept = user?.department_name || '';
  const gradient = nameToColor(displayName);

  return (
    <header className="glass border-b border-white/40 px-6 py-0 flex items-center justify-between h-14 shrink-0 sticky top-0 z-30">
      {/* Title */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="accent-bar shrink-0" />
        <h1 className="text-sm font-bold text-warmgray-800 truncate">{title}</h1>
      </div>

      {/* Right */}
      <div className="flex items-center gap-3 shrink-0">
        {dept && (
          <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full
                           bg-white/50 backdrop-blur-sm text-[11px] font-medium text-warmgray-500
                           border border-white/60">
            {dept}
          </span>
        )}

        {/* Avatar → links to profile */}
        <Link to="/profile" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity" title={t('nav_profile')}>
          {user?.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={displayName}
              className="w-8 h-8 rounded-full object-cover ring-2 ring-white/60 shrink-0"
            />
          ) : (
            <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-xs font-bold shadow-sm shrink-0`}>
              {displayName.slice(0, 1)}
            </div>
          )}
          <span className="hidden md:block text-sm font-medium text-warmgray-700">{displayName}</span>
        </Link>

        <div className="h-4 w-px bg-warmgray-200" />

        <button
          onClick={logout}
          className="flex items-center gap-1.5 text-xs text-warmgray-400 hover:text-ringo-600
                     transition-colors duration-150 font-medium"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
          </svg>
          <span className="hidden sm:inline">{t('btn_logout')}</span>
        </button>
      </div>
    </header>
  );
}
