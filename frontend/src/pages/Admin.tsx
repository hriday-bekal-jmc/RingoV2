import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/common/Layout';
import Toast, { useToast } from '../components/common/Toast';
import { useLang } from '../context/LanguageContext';
import FormsTab                    from '../components/admin/FormsTab';
import NotificationTemplatesTab   from '../components/admin/NotificationTemplatesTab';
import SlotsTab                   from '../components/admin/SlotsTab';
import PatternsTab                from '../components/admin/PatternsTab';
import UsersTab                   from '../components/admin/UsersTab';
import ApplicationsTab            from '../components/admin/ApplicationsTab';
import PermissionsTab             from '../components/admin/PermissionsTab';
import AllowanceTab               from '../components/admin/AllowanceTab';

// ─── Main ─────────────────────────────────────────────────────────────────────

type Tab = 'slots' | 'patterns' | 'users' | 'applications' | 'permissions' | 'forms' | 'allowance' | 'notifications';

export default function Admin() {
  const [searchParams] = useSearchParams();
  const VALID_TABS: Tab[] = ['slots', 'patterns', 'users', 'applications', 'permissions', 'forms', 'allowance', 'notifications'];
  const initialTab = (searchParams.get('tab') ?? 'slots') as Tab;
  const [tab, setTab] = useState<Tab>(VALID_TABS.includes(initialTab) ? initialTab : 'slots');
  const { t, lang } = useLang();
  const { toast, show: showToast, dismiss } = useToast();

  const TAB_CONFIG: { key: Tab; label: string; icon: string }[] = [
    { key: 'slots',        label: '承認スロット',             icon: '🔲' },
    { key: 'patterns',     label: 'パターン設定',             icon: '🔀' },
    { key: 'users',        label: t('admin_users_tab'),   icon: '👥' },
    { key: 'applications', label: t('admin_apps_tab'),    icon: '📋' },
    { key: 'forms',        label: t('admin_forms_tab'),   icon: '📝' },
    { key: 'allowance',    label: '日当レート',             icon: '💴' },
    { key: 'permissions',  label: t('admin_perms_tab'),   icon: '🛡️' },
    { key: 'notifications', label: lang === 'ja' ? '通知テンプレート' : 'Notifications', icon: '🔔' },
  ];

  return (
    <Layout title={t('title_admin')}>
      {toast && <Toast {...toast} onDismiss={dismiss} />}

      <div className="max-w-[1800px] mx-auto space-y-6">
        {/* Pill tab bar — scrolls horizontally on narrow viewports if too wide to fit */}
        <div className="animate-fade-up overflow-x-auto -mx-4 md:mx-0 px-4 md:px-0">
          <div className="inline-flex items-center gap-1 bg-white/50 backdrop-blur-sm border border-white/70 rounded-2xl p-1.5 shadow-sm whitespace-nowrap">
            {TAB_CONFIG.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition-all duration-150 ${
                  tab === t.key
                    ? 'bg-warmgray-800 text-white shadow-sm'
                    : 'text-warmgray-500 hover:text-warmgray-800 hover:bg-white/60'
                }`}
              >
                <span className="text-base leading-none">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div key={tab} className="animate-fade-up min-h-[60vh]">
          {tab === 'slots'        && <SlotsTab showToast={showToast} />}
          {tab === 'patterns'     && <PatternsTab showToast={showToast} />}
          {tab === 'users'        && <UsersTab showToast={showToast} onGoToSlots={() => setTab('slots')} />}
          {tab === 'applications' && <ApplicationsTab showToast={showToast} />}
          {tab === 'forms'        && <FormsTab showToast={showToast} />}
          {tab === 'permissions'  && <PermissionsTab showToast={showToast} />}
          {tab === 'allowance'     && <AllowanceTab showToast={showToast} />}
          {tab === 'notifications' && <NotificationTemplatesTab showToast={showToast} />}
        </div>
      </div>
    </Layout>
  );
}
