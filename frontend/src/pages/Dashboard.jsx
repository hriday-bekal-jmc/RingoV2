import Layout from '../components/common/Layout.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const stats = [
  { label: '私の承認待ち', value: 4, badge: '4' },
  { label: '私の提出状況', value: '12件中アクティブ', badge: '12' },
  { label: '今月の精算', value: 6, badge: '6' },
  { label: '下書き', value: 2, badge: '2' },
];

const templates = [
  { code: 'INQUIRY', label: '伺書', desc: '一般稟議書' },
  { code: 'BUSINESS_TRIP', label: '出張伺い', desc: '出張前申請' },
  { code: 'OFFICE_OVERTIME', label: '事務所閉鎖時・早出・作業延長', desc: '' },
  { code: 'EQUIPMENT_PURCHASE', label: '備品／消耗品購入申請', desc: '備品・消耗品を購入する際に申請してください' },
  { code: 'PC_TAKEOUT', label: 'PC持ち出し', desc: '社外へPCを持ち出す際に申請してください' },
  { code: 'LEAVE', label: '有休・代休・特別休暇', desc: '' },
  { code: 'TARDINESS', label: '遅刻・早退', desc: '※控除対象' },
  { code: 'INCIDENT_REPORT', label: '始末書', desc: '' },
];

export default function Dashboard() {
  const { user, loading } = useAuth();
  const greeting = user?.full_name ? `Welcome back, ${user.full_name}!` : 'Welcome back!';

  return (
    <Layout title="ダッシュボード">
      {loading ? (
        <div className="text-warmgray-600">読み込み中...</div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-warmgray-800">{greeting}</h2>
            <button className="btn-secondary">＋ 新規申請を作成</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {stats.map((s) => (
              <div key={s.label} className="stat-card">
                <div className="flex items-start justify-between mb-2">
                  <span className="text-sm text-warmgray-600">{s.label}</span>
                  <span className="px-2 py-0.5 text-xs font-bold rounded bg-ringo-500 text-white">
                    {s.badge}
                  </span>
                </div>
                <div className="text-2xl font-bold text-warmgray-800">{s.value}</div>
              </div>
            ))}
          </div>

          <h3 className="text-lg font-bold text-warmgray-800 mb-3">利用可能なフォームテンプレート</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {templates.map((t) => (
              <div
                key={t.code}
                className="card hover:shadow-card-hover cursor-pointer transition-shadow group"
              >
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-bold text-warmgray-800 group-hover:text-ringo-600">
                    {t.label}
                  </h4>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-mustard-500 text-white font-semibold">
                    新規
                  </span>
                </div>
                {t.desc && <p className="text-xs text-warmgray-600 mb-3">{t.desc}</p>}
                <button className="text-sm font-semibold text-ringo-600 hover:text-ringo-700 flex items-center gap-1">
                  新規作成 <span>›</span>
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </Layout>
  );
}
