import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import UserAvatar from './UserAvatar';

interface HeaderProps { title: string }

export default function Header({ title }: HeaderProps) {
  const { user, logout } = useAuth();
  const { t } = useLang();
  const displayName = user?.full_name || 'Guest';
  const dept = user?.department_name || '';

  return (
    <header className="glass border-b border-white/40 px-4 md:px-6 py-0 flex items-center justify-between h-14 shrink-0 sticky top-0 z-30">
      {/* Title */}
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        <div className="accent-bar shrink-0 hidden md:block" />
        <h1 className="text-sm font-bold text-warmgray-800 truncate">{title}</h1>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        {dept && (
          <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full
                           bg-white/50 backdrop-blur-sm text-[11px] font-medium text-warmgray-500
                           border border-white/60">
            {dept}
          </span>
        )}

        {/* Avatar → links to profile */}
        <Link to="/profile" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity" title={t('nav_profile')}>
          <UserAvatar
            name={displayName}
            avatarUrl={user?.avatar_url}
            size={8}
            ring="ring-2 ring-white/60"
            className="shadow-sm"
          />
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
