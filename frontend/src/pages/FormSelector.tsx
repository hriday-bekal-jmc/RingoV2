/**
 * Form selector page — shown when user clicks "作成" on dashboard.
 * Lists all active application forms as cards; click navigates to the
 * dedicated form entry page at /applications/new/:templateCode.
 */

import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import Layout from '../components/common/Layout';
import PatternBadge from '../components/common/PatternBadge';
import { templateLabel } from '../config/templateLabels';
import apiClient from '../services/apiClient';
import RingoLoader from '../components/common/RingoLoader';

interface TemplateTile {
  id:             string;
  code:           string;
  title:          string;
  title_ja:       string;
  pattern_id:     number;
  icon:           string | null;
  gradient:       string | null;
  description_ja: string | null;
  description_en: string | null;
}

const DEFAULT_GRADIENTS: Record<string, string> = {
  BUSINESS_TRIP:    'from-amber-400  to-orange-500',
  RECREATION:       'from-pink-400   to-rose-500',
  ADDRESS_CHANGE:   'from-violet-400 to-purple-500',
  TRANSPORT_EXPENSE:'from-sky-400    to-blue-500',
  SALARY_BANK:      'from-emerald-400 to-teal-600',
};

export default function FormSelector() {
  const { loading } = useAuth();
  const { lang } = useLang();
  const navigate = useNavigate();

  const { data: templates, isLoading } = useQuery<TemplateTile[]>({
    queryKey: ['templates', 'active'],
    queryFn: async () => (await apiClient.get('/templates')).data,
    enabled: !loading,
    staleTime: 300_000,
  });

  return (
    <Layout title={lang === 'en' ? 'New Application' : '申請フォーム'}>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="animate-fade-up">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-1.5 text-xs font-semibold text-warmgray-400 hover:text-warmgray-700 transition-colors mb-4"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            {lang === 'en' ? 'Back to dashboard' : 'ダッシュボードに戻る'}
          </button>
          <p className="section-title mb-0">{lang === 'en' ? 'Select form' : '申請フォームを選択'}</p>
          <h2 className="text-2xl font-bold text-warmgray-800 mt-1">
            {lang === 'en' ? 'New Application' : '新規申請'}
          </h2>
          <p className="text-sm text-warmgray-400 mt-1">
            {lang === 'en' ? 'Choose the form type that matches your request.' : '申請内容に合ったフォームを選んでください。'}
          </p>
        </div>

        {/* Template grid */}
        {isLoading ? (
          <RingoLoader.Block />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-up">
            {(templates ?? []).map((tmpl, i) => {
                          const label = templateLabel(tmpl.code, lang, tmpl.title_ja, tmpl.title);
              const gradient = tmpl.gradient ?? DEFAULT_GRADIENTS[tmpl.code] ?? 'from-warmgray-400 to-warmgray-600';
              const desc = lang === 'en' ? (tmpl.description_en ?? tmpl.description_ja) : tmpl.description_ja;

              return (
                <button
                  key={tmpl.id}
                  onClick={() => navigate(`/applications/new/${tmpl.code}`)}
                  className="card text-left group hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 animate-fade-up cursor-pointer"
                  style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon pill */}
                    <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-xl shrink-0 shadow-sm border border-white/40`}>
                      {tmpl.icon ?? '📄'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-warmgray-800 group-hover:text-ringo-600 transition-colors leading-tight">
                          {label}
                        </p>
                        <PatternBadge patternId={tmpl.pattern_id} size="sm" />
                      </div>
                      {desc && (
                        <p className="text-[11px] text-warmgray-400 mt-1 leading-relaxed line-clamp-2">
                          {desc}
                        </p>
                      )}
                    </div>

                    <svg className="w-4 h-4 text-warmgray-300 group-hover:text-ringo-400 shrink-0 mt-0.5 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
