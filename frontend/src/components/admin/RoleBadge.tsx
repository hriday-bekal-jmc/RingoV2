import { ROLE_MAP, type Role } from '../../config/permissions';
import { useLang } from '../../context/LanguageContext';

export function RoleBadge({ role }: { role: string }) {
  const { t } = useLang();
  const colors: Record<string, string> = {
    ADMIN:              'bg-ringo-500 text-white',
    PRESIDENT:          'bg-warmgray-800 text-white',
    SENMU:              'bg-indigo-500 text-white',
    SHITSUCHO:          'bg-violet-600 text-white',
    GM:                 'bg-violet-500 text-white',
    SENIOR_MANAGER:     'bg-sky-600 text-white',
    MANAGER:            'bg-sky-500 text-white',
    SUB_MANAGER:        'bg-sky-400 text-white',
    SUB_MANAGER_TSUKI:  'bg-teal-500 text-white',
    LEADER:             'bg-teal-400 text-white',
    SUB_LEADER:         'bg-emerald-400 text-white',
    CHIEF:              'bg-emerald-300 text-emerald-900',
    MEMBER:             'bg-surface-200 text-warmgray-600',
  };
  const label = t(`role_${role}`) !== `role_${role}` ? t(`role_${role}`) : (ROLE_MAP[role as Role]?.label ?? role);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${colors[role] ?? 'bg-surface-200 text-warmgray-500'}`}>
      {label}
    </span>
  );
}
