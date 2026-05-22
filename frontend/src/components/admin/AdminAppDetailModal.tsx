// AdminAppDetailModal — full admin view of one application.
//
// Renders ALL admin-relevant data:
//   • Meta header (number, status, version, IDs, timestamps)
//   • Applicant + department + template
//   • Form data (RINGI + SETTLEMENT) with schema-aware labels
//   • Approval timeline (both stages, incl CANCELLED/SKIPPED steps)
//   • Settlement details (expected, actual, transfer, proof, processed_by)
//   • Uploaded files
//   • Audit log (chronological)
//
// Portaled to document.body so .glass parents don't trap fixed positioning.

import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { templateLabel } from '../../config/templateLabels';
import { useLang } from '../../context/LanguageContext';
import RepeatGroupDisplay from '../forms/RepeatGroupDisplay';
import TransportationDetail from '../forms/TransportationDetail';
import { FieldValueContent, isLongField } from '../forms/FieldValueDisplay';
import PatternBadge from '../common/PatternBadge';
import CollapsibleComment from '../common/CollapsibleComment';
import { Sk } from '../common/Skeleton';

interface ApplicationDetail {
  id: string;
  application_number: string | null;
  status: string;
  version: number;
  form_data: Record<string, unknown>;
  settlement_data: Record<string, unknown> | null;
  template_id: string;
  template_version_id: string | null;
  template_version_number: number | null;
  template_code: string;
  template_name: string;
  schema_definition: { fields: FormField[] } | null;
  settlement_schema: { fields: FormField[] } | null;
  has_settlement: boolean;
  pattern_id?: number | null;
  component_type?: string | null;
  route_id: string | null;
  applicant_id: string;
  applicant_name: string | null;
  applicant_email: string | null;
  applicant_avatar: string | null;
  department_id: string | null;
  department_name: string | null;
  created_at: string;
  submitted_at: string | null;
  settlement_submitted_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

interface FormField {
  name:     string;
  label:    string;
  label_en?: string;
  type:     string;
  fields?:  FormField[];
}

interface StepRow {
  id:           string;
  step_order:   number;
  stage:        string;
  label:        string;
  action_type:  string;
  status:       string;
  comment:      string | null;
  acted_at:     string | null;
  acted_by:     string | null;
  approver_name: string | null;
  approver_email: string | null;
  approver_avatar: string | null;
  acted_by_name: string | null;
  created_at:    string;
}

interface FileRow {
  id:            string;
  field_name:    string | null;
  original_name: string;
  file_size:     number;
  mime_type:     string;
  drive_url:     string | null;
  created_at:    string;
  uploader_id:   string;
  stored_path:   string;
}

interface AuditRow {
  id:          string;
  action:      string;
  entity_type: string;
  entity_id:   string;
  metadata:    Record<string, unknown> | null;
  created_at:  string;
}

interface SettlementRow {
  id:                  string;
  expected_amount:     number;
  actual_amount:       number;
  status:              string;
  transfer_date:       string | null;
  transfer_proof_url:  string | null;
  accounting_note:     string | null;
  processed_at:        string | null;
  processed_by:        string | null;
  processed_by_name:   string | null;
  settlement_data:     Record<string, unknown>;
  created_at:          string;
  updated_at:          string;
}

interface AdminAppDetailResponse {
  application: ApplicationDetail;
  steps:       StepRow[];
  files:       FileRow[];
  audit_logs:  AuditRow[];
  settlement:  SettlementRow | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const STATUS_BADGE: Record<string, string> = {
  DRAFT:               'bg-surface-100 text-warmgray-500 border border-surface-200',
  PENDING_APPROVAL:    'bg-amber-100 text-amber-700 border border-amber-200',
  APPROVED:            'bg-emerald-100 text-emerald-700 border border-emerald-200',
  REJECTED:            'bg-red-100 text-red-700 border border-red-200',
  RETURNED:            'bg-amber-100 text-amber-800 border border-amber-300',
  CANCELLED:           'bg-surface-100 text-warmgray-500 border border-surface-200',
  PENDING_SETTLEMENT:  'bg-mustard-100 text-mustard-700 border border-mustard-200',
  SETTLEMENT_APPROVED: 'bg-teal-100 text-teal-700 border border-teal-200',
  COMPLETED:           'bg-emerald-100 text-emerald-700 border border-emerald-200',
};

const STEP_STATUS_DOT: Record<string, string> = {
  APPROVED:  'bg-emerald-500',
  REJECTED:  'bg-red-500',
  RETURNED:  'bg-amber-500',
  PENDING:   'bg-mustard-500 ring-2 ring-mustard-300 animate-pulse',
  WAITING:   'bg-warmgray-300',
  SKIPPED:   'bg-surface-200',
  CANCELLED: 'bg-surface-200 opacity-50',
};

function fmtDate(s: string | null, locale: string): string {
  if (!s) return '—';
  return new Date(s).toLocaleString(locale);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Modal ──────────────────────────────────────────────────────────────────
interface Props {
  appId:   string;
  onClose: () => void;
}

export default function AdminAppDetailModal({ appId, onClose }: Props) {
  const { lang } = useLang();
  const dateLocale = lang === 'en' ? 'en-US' : 'ja-JP';

  const { data, isLoading, isError, error } = useQuery<AdminAppDetailResponse>({
    queryKey: ['admin', 'application', appId],
    queryFn:  async () => (await apiClient.get(`/admin/applications/${appId}`)).data,
    staleTime: 30_000,
  });

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 md:p-4">
      <div className="absolute inset-0 bg-warmgray-900/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative glass rounded-3xl shadow-2xl w-full max-w-5xl max-h-[95vh] md:max-h-[92vh] flex flex-col animate-scale-in overflow-hidden">

        {/* Header */}
        <div className="px-5 md:px-7 pt-5 pb-4 border-b border-white/30 shrink-0 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-4 h-4 text-ringo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" fillRule="evenodd" fill="currentColor" stroke="none" />
            </svg>
            <span className="text-sm font-bold text-warmgray-800 truncate">
              {lang === 'en' ? 'Admin: Application Detail' : '管理者: 申請詳細'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-xl bg-surface-100/80 hover:bg-surface-200/80 flex items-center justify-center text-warmgray-400 hover:text-warmgray-800 transition-all"
            aria-label="閉じる"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {isLoading && (
            <div className="p-4 md:p-5 space-y-5">
              {/* Meta card skeleton */}
              <div className="card space-y-4">
                <div className="flex flex-col gap-3 border-b border-white/40 pb-4">
                  <div className="flex items-center gap-2">
                    <Sk.Badge w="w-24" />
                    <Sk.Badge w="w-16" />
                    <Sk.Badge w="w-8" />
                  </div>
                  <Sk.Line w="w-48" h="h-5" />
                  <div className="flex items-center gap-3">
                    <Sk.Line w="w-28" h="h-2.5" />
                    <Sk.Line w="w-32" h="h-2.5" />
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="space-y-1.5">
                      <Sk.Line w="w-16" h="h-2.5" />
                      <Sk.Line w="w-24" h="h-3.5" />
                    </div>
                  ))}
                </div>
              </div>
              {/* Form data card skeleton */}
              <div className="card space-y-3">
                <Sk.Line w="w-32" h="h-4" />
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex justify-between items-center py-1.5 border-b border-white/30">
                    <Sk.Line w={i % 2 === 0 ? 'w-28' : 'w-24'} h="h-3" />
                    <Sk.Line w={i % 3 === 0 ? 'w-32' : i % 3 === 1 ? 'w-24' : 'w-40'} h="h-3" />
                  </div>
                ))}
              </div>
              {/* Timeline skeleton */}
              <div className="card space-y-3">
                <Sk.Line w="w-28" h="h-4" />
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <Sk.Circle size="md" />
                    <div className="flex-1 space-y-1.5 pt-1">
                      <Sk.Line w={i % 2 === 0 ? 'w-32' : 'w-40'} h="h-3.5" />
                      <Sk.Line w="w-24" h="h-2.5" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {isError && (
            <div className="p-6 text-sm text-red-500 text-center">
              {(error as { message?: string })?.message ?? (lang === 'en' ? 'Failed to load' : '取得に失敗しました')}
            </div>
          )}
          {data && (
            <div className="p-4 md:p-5 space-y-5">
              <MetaCard d={data} lang={lang} dateLocale={dateLocale} />
              {data.application.component_type === 'transportation' ? (
                <div className={`card space-y-3 border border-ringo-200/40`}>
                  <div className="flex items-center gap-2 pb-2 border-b border-white/30">
                    <span className="w-1 h-4 rounded-full bg-ringo-500" />
                    <p className="text-sm font-bold text-warmgray-800">
                      {lang === 'en' ? 'Transportation Form' : '交通費フォーム'}
                    </p>
                  </div>
                  <TransportationDetail
                    formData={data.application.form_data}
                    schema={data.application.schema_definition ?? undefined}
                  />
                </div>
              ) : (
                <FormDataCard
                  title={lang === 'en' ? 'RINGI Form Data' : '稟議フォーム'}
                  accent="ringo"
                  data={data.application.form_data}
                  schema={data.application.schema_definition}
                  files={data.files}
                  lang={lang}
                />
              )}
              {data.application.settlement_data && (
                <FormDataCard
                  title={lang === 'en' ? 'Settlement Form Data' : '精算フォーム'}
                  accent="teal"
                  data={data.application.settlement_data}
                  schema={data.application.settlement_schema}
                  files={data.files}
                  lang={lang}
                />
              )}
              <TimelineCard steps={data.steps} lang={lang} dateLocale={dateLocale} />
              {data.settlement && (
                <SettlementCard s={data.settlement} lang={lang} dateLocale={dateLocale} />
              )}
              <FilesCard files={data.files} lang={lang} />
              <AuditCard logs={data.audit_logs} lang={lang} dateLocale={dateLocale} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Sub-cards ──────────────────────────────────────────────────────────────

function MetaCard({ d, lang, dateLocale }: { d: AdminAppDetailResponse; lang: 'ja' | 'en'; dateLocale: string }) {
  const a = d.application;
  return (
    <div className="card space-y-4">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 border-b border-white/40 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${STATUS_BADGE[a.status] ?? 'bg-surface-100 text-warmgray-500'}`}>
              {a.status}
            </span>
            <PatternBadge patternId={a.pattern_id ?? undefined} size="sm" />
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-surface-100 text-warmgray-500 border border-surface-200">
              v{a.version}
            </span>
          </div>
          <h3 className="text-xl font-bold text-warmgray-800 mt-2 leading-tight">
            {templateLabel(a.template_code, lang, a.template_name)}
          </h3>
          <div className="flex items-center gap-2 mt-1.5 text-xs text-warmgray-400 flex-wrap">
            {a.application_number && <span className="font-mono">{a.application_number}</span>}
            {a.application_number && <span>·</span>}
            <span>{lang === 'en' ? 'Created' : '作成'}: {fmtDate(a.created_at, dateLocale)}</span>
            {a.template_version_number != null && (
              <>
                <span>·</span>
                <span
                  className="font-semibold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/60"
                  title={lang === 'en' ? 'Form schema version this application was submitted under' : 'この申請が提出されたフォームスキーマのバージョン'}
                >
                  {lang === 'en' ? 'Schema' : 'スキーマ'} v{a.template_version_number}
                </span>
              </>
            )}
            {/* Template code hidden — auto-generated, not user-meaningful */}
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {a.applicant_avatar ? (
            <img src={a.applicant_avatar} alt="" className="w-9 h-9 rounded-full object-cover ring-2 ring-white/60" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-ringo-400 to-mustard-500 flex items-center justify-center text-white text-xs font-bold">
              {(a.applicant_name ?? '?').slice(0, 1)}
            </div>
          )}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-warmgray-400 mb-0.5">
              {lang === 'en' ? 'Applicant' : '申請者'}
            </p>
            <p className="font-bold text-warmgray-800 text-sm">{a.applicant_name ?? '—'}</p>
            <p className="text-[10px] text-warmgray-400">{a.applicant_email ?? '—'} · {a.department_name ?? '—'}</p>
          </div>
        </div>
      </div>

      {/* Internal IDs + timestamps grid */}
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 text-xs">
        <KVField label={lang === 'en' ? 'App ID'        : '申請ID'}   value={a.id}            mono />
        <KVField label={lang === 'en' ? 'Template ID'   : 'テンプレ'} value={a.template_id}   mono />
        <KVField label={lang === 'en' ? 'Route ID'      : 'ルートID'} value={a.route_id ?? '—'} mono />
        <KVField label={lang === 'en' ? 'Applicant ID'  : '申請者ID'} value={a.applicant_id}  mono />
        <KVField label={lang === 'en' ? 'Submitted'     : '提出日時'} value={fmtDate(a.submitted_at, dateLocale)} />
        <KVField label={lang === 'en' ? 'Settle subm.'  : '精算提出'} value={fmtDate(a.settlement_submitted_at, dateLocale)} />
        <KVField label={lang === 'en' ? 'Completed'     : '完了日時'} value={fmtDate(a.completed_at, dateLocale)} />
        <KVField label={lang === 'en' ? 'Last updated'  : '最終更新'} value={fmtDate(a.updated_at, dateLocale)} />
      </dl>
    </div>
  );
}

function KVField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-0.5">{label}</dt>
      <dd className={`text-warmgray-700 truncate ${mono ? 'font-mono text-[11px]' : 'text-xs'}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

// Extract the file UUID from /api/files/<uuid> URLs (incl comma-joined lists).
// Returns array of {url, file?} pairs so we can render filename + size if we
// have metadata, falling back to a generic "添付 N" label if the file row is
// missing (e.g. legacy data, file deleted, etc).
function parseFileValue(
  raw:   unknown,
  files: FileRow[],
): Array<{ url: string; file: FileRow | undefined }> {
  if (raw == null || raw === '') return [];
  const urls = String(raw).split(',').map((u) => u.trim()).filter(Boolean);
  return urls.map((url) => {
    // Match both relative `/api/files/<uuid>` and absolute URLs
    const m = url.match(/\/api\/files\/([a-f0-9-]{8,})/i);
    const id = m?.[1];
    const file = id ? files.find((f) => f.id === id) : undefined;
    return { url, file };
  });
}

function FormDataCard({ title, accent, data, schema, files, lang }: {
  title:  string;
  accent: 'ringo' | 'teal';
  data:   Record<string, unknown>;
  schema: { fields: FormField[] } | null;
  files:  FileRow[];
  lang:   'ja' | 'en';
}) {
  const fields = schema?.fields ?? [];
  const entries = fields.length > 0
    ? fields.map(f => ({ ...f, label: (lang === 'en' && f.label_en) ? f.label_en : f.label, value: data[f.name] }))
    : Object.entries(data).map(([k, v]) => ({ name: k, label: k, type: 'text', value: v }));

  if (entries.length === 0) {
    return (
      <div className="card text-center text-warmgray-400 text-xs py-4">
        {title} — (empty)
      </div>
    );
  }

  return (
    <div className={`card space-y-3 border ${accent === 'teal' ? 'border-teal-200/40' : 'border-ringo-200/40'}`}>
      <div className="flex items-center gap-2 pb-2 border-b border-white/30">
        <span className={`w-1 h-4 rounded-full ${accent === 'teal' ? 'bg-teal-500' : 'bg-ringo-500'}`} />
        <p className="text-sm font-bold text-warmgray-800">{title}</p>
      </div>
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
        {entries.map((f) => {
          const isFile = f.type === 'file';
          const isLong = isLongField(f, f.value);

          // File fields get rich tile rendering with metadata from uploaded_files
          if (isFile) {
            const parsed = parseFileValue(f.value, files);
            return (
              <div key={f.name} className="md:col-span-2">
                <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-1">{f.label}</dt>
                <dd className="min-h-[36px]">
                  {parsed.length === 0 ? (
                    <span className="text-warmgray-300 text-xs">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {parsed.map(({ url, file }, i) => (
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 bg-white/70 hover:bg-white border border-white/80 hover:border-ringo-200 rounded-xl px-3 py-2 transition-colors group max-w-full">
                          <span className="text-base shrink-0">📎</span>
                          <div className="min-w-0 text-left">
                            <p className="text-xs font-semibold text-warmgray-800 group-hover:text-ringo-600 truncate">
                              {file?.original_name ?? (lang === 'en' ? `Attachment ${i + 1}` : `添付 ${i + 1}`)}
                            </p>
                            <p className="text-[10px] text-warmgray-400">
                              {file ? fmtBytes(file.file_size) : (lang === 'en' ? 'file' : 'ファイル')}
                              {file?.mime_type ? ` · ${file.mime_type.split('/')[1]?.toUpperCase() ?? file.mime_type}` : ''}
                              {file?.drive_url ? ' · Drive' : ''}
                            </p>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </dd>
              </div>
            );
          }

          return (
            <div key={f.name} className={isLong ? 'md:col-span-2' : ''}>
              <dt className="text-[10px] font-bold uppercase tracking-widest text-warmgray-400 mb-1">{f.label}</dt>
              <dd className="text-sm font-medium text-warmgray-800 bg-white/60 border border-white/80 px-3 py-2 rounded-xl break-words min-h-[36px]">
                <FieldValueContent
                  field={f as any}
                  value={f.value}
                  renderRepeat={(field, value) => <RepeatGroupDisplay field={field} value={value} compact />}
                />
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function TimelineCard({ steps, lang, dateLocale }: { steps: StepRow[]; lang: 'ja' | 'en'; dateLocale: string }) {
  const ringi  = steps.filter(s => s.stage === 'RINGI' || !s.stage);
  const settle = steps.filter(s => s.stage === 'SETTLEMENT');
  const renderStep = (s: StepRow) => (
    <div key={s.id} className="relative pl-6">
      <div className={`absolute -left-[11px] top-0 w-5 h-5 rounded-full border-4 border-white/60 shadow-sm ${STEP_STATUS_DOT[s.status] ?? 'bg-warmgray-300'}`} />
      <div className="-mt-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-bold text-sm text-warmgray-800 leading-snug">
            {s.label || `${lang === 'en' ? 'Step' : 'ステップ'}${s.step_order}`}
          </p>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-100 text-warmgray-500">
            {s.status}
          </span>
          {s.action_type && s.action_type !== 'APPROVE' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-mustard-100 text-mustard-700">
              {s.action_type}
            </span>
          )}
        </div>
        <p className="text-xs text-warmgray-500">
          {lang === 'en' ? 'Assigned to' : '担当'}: {s.approver_name || (lang === 'en' ? '(unassigned)' : '(未割当)')}
        </p>
        {s.acted_at && (
          <p className="text-[10px] text-warmgray-400">
            {lang === 'en' ? 'Acted' : '処理'} {fmtDate(s.acted_at, dateLocale)}
            {s.acted_by_name && ` · ${lang === 'en' ? 'by' : '実行'}: ${s.acted_by_name}`}
          </p>
        )}
        {s.comment && (
          <div className={`mt-2 text-xs px-2.5 py-2 rounded-lg min-w-0 overflow-hidden ${
            s.status === 'RETURNED'  ? 'bg-amber-50 border border-amber-200 text-amber-800' :
            s.status === 'REJECTED'  ? 'bg-red-50 border border-red-200 text-red-800' :
            'bg-white/60 border border-white/80 text-warmgray-700'
          }`}>
            <span className="font-bold">{lang === 'en' ? 'Comment' : 'コメント'}:</span>
            <CollapsibleComment text={s.comment} className="mt-0.5" />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-white/30">
        <span className="w-1 h-4 rounded-full bg-gradient-to-b from-ringo-500 to-teal-500" />
        <p className="text-sm font-bold text-warmgray-800">
          {lang === 'en' ? 'Approval Timeline' : '承認タイムライン'}
        </p>
        <span className="ml-auto text-[10px] text-warmgray-400">
          {steps.length} {lang === 'en' ? 'steps total' : 'ステップ'}
        </span>
      </div>
      {ringi.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-ringo-500 mb-3 ml-1">
            {lang === 'en' ? 'Ringi Phase' : '稟議フェーズ'}
          </p>
          <div className="relative border-l-2 border-ringo-200 ml-3 space-y-5 pb-2">
            {ringi.map(renderStep)}
          </div>
        </div>
      )}
      {settle.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-teal-500 mb-3 ml-1">
            {lang === 'en' ? 'Settlement Phase' : '精算フェーズ'}
          </p>
          <div className="relative border-l-2 border-teal-200 ml-3 space-y-5 pb-2">
            {settle.map(renderStep)}
          </div>
        </div>
      )}
      {steps.length === 0 && (
        <p className="text-xs text-warmgray-400 text-center py-2">
          {lang === 'en' ? 'No approval steps yet' : '承認ステップなし'}
        </p>
      )}
    </div>
  );
}

function SettlementCard({ s, lang, dateLocale }: { s: SettlementRow; lang: 'ja' | 'en'; dateLocale: string }) {
  const delta = (s.actual_amount ?? 0) - (s.expected_amount ?? 0);
  return (
    <div className="card space-y-3 border border-teal-200/40">
      <div className="flex items-center gap-2 pb-2 border-b border-white/30">
        <span className="w-1 h-4 rounded-full bg-teal-500" />
        <p className="text-sm font-bold text-warmgray-800">
          💴 {lang === 'en' ? 'Settlement Record' : '精算記録'}
        </p>
        <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-100 text-warmgray-500">
          {s.status}
        </span>
      </div>
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 text-xs">
        <KVField label={lang === 'en' ? 'Expected' : '概算金額'} value={`¥${Number(s.expected_amount ?? 0).toLocaleString()}`} />
        <KVField label={lang === 'en' ? 'Actual'   : '実費合計'} value={`¥${Number(s.actual_amount ?? 0).toLocaleString()}`} />
        <KVField label={lang === 'en' ? 'Delta'    : '差額'}     value={`${delta >= 0 ? '+' : ''}¥${Number(delta).toLocaleString()}`} />
        <KVField label={lang === 'en' ? 'Transfer date' : '振込日'} value={s.transfer_date ? new Date(s.transfer_date).toLocaleDateString(dateLocale) : '—'} />
        <KVField label={lang === 'en' ? 'Processed'      : '処理日時'} value={fmtDate(s.processed_at, dateLocale)} />
        <KVField label={lang === 'en' ? 'Processed by'   : '処理者'}   value={s.processed_by_name ?? '—'} />
        <KVField label={lang === 'en' ? 'Created'        : '作成'}     value={fmtDate(s.created_at, dateLocale)} />
        <KVField label={lang === 'en' ? 'Updated'        : '更新'}     value={fmtDate(s.updated_at, dateLocale)} />
      </dl>
      {s.transfer_proof_url && (
        <a
          href={s.transfer_proof_url}
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-teal-600 hover:text-teal-700 font-semibold bg-teal-50/60 border border-teal-200/60 px-2.5 py-1 rounded-lg"
        >
          📎 {lang === 'en' ? 'Transfer proof' : '振込証明'}
        </a>
      )}
      {s.accounting_note && (
        <div className="text-xs px-2.5 py-2 rounded-lg bg-white/60 border border-white/80 text-warmgray-700">
          <span className="font-bold">{lang === 'en' ? 'Note' : '備考'}:</span> {s.accounting_note}
        </div>
      )}
    </div>
  );
}

function FilesCard({ files, lang }: { files: FileRow[]; lang: 'ja' | 'en' }) {
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-white/30">
        <span className="w-1 h-4 rounded-full bg-indigo-500" />
        <p className="text-sm font-bold text-warmgray-800">
          📎 {lang === 'en' ? 'Uploaded Files' : '添付ファイル'}
        </p>
        <span className="ml-auto text-[10px] text-warmgray-400">{files.length}</span>
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-warmgray-400 text-center py-2">
          {lang === 'en' ? 'No files' : 'なし'}
        </p>
      ) : (
        <ul className="space-y-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 bg-white/40 border border-white/60 rounded-xl px-3 py-2">
              <span className="text-base">📄</span>
              <div className="flex-1 min-w-0">
                <a
                  href={`/api/files/${f.id}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-sm font-medium text-ringo-600 hover:text-ringo-700 truncate block"
                >
                  {f.original_name}
                </a>
                <p className="text-[10px] text-warmgray-400">
                  {fmtBytes(f.file_size)} · {f.mime_type}
                  {f.field_name && ` · ${f.field_name}`}
                </p>
              </div>
              {f.drive_url && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">
                  Drive
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AuditCard({ logs, lang, dateLocale }: { logs: AuditRow[]; lang: 'ja' | 'en'; dateLocale: string }) {
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-white/30">
        <span className="w-1 h-4 rounded-full bg-warmgray-500" />
        <p className="text-sm font-bold text-warmgray-800">
          📋 {lang === 'en' ? 'Audit Log' : '監査ログ'}
        </p>
        <span className="ml-auto text-[10px] text-warmgray-400">{logs.length}</span>
      </div>
      {logs.length === 0 ? (
        <p className="text-xs text-warmgray-400 text-center py-2">
          {lang === 'en' ? 'No entries' : 'エントリなし'}
        </p>
      ) : (
        <ul className="space-y-2 max-h-72 overflow-y-auto">
          {logs.map((log) => (
            <li key={log.id} className="flex items-start gap-3 bg-white/40 border border-white/60 rounded-xl px-3 py-2 text-xs">
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-warmgray-100 text-warmgray-700 shrink-0 mt-0.5">
                {log.action}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-warmgray-700 break-all">
                  {log.metadata
                    ? <code className="text-[10px] font-mono text-warmgray-500">{JSON.stringify(log.metadata)}</code>
                    : <span className="text-warmgray-400">—</span>}
                </p>
                <p className="text-[10px] text-warmgray-400 mt-0.5">
                  {fmtDate(log.created_at, dateLocale)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
