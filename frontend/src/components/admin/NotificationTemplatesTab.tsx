// Admin tab: edit notification email/GChat templates.
// Templates stored in DB — read on mount, saved via PATCH.
// Cache invalidated server-side on each save → reflected app-wide within 5 min.

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../services/apiClient';
import { useLang } from '../../context/LanguageContext';
import { TEMPLATE_VAR_DEFS as HARDCODED_VAR_DEFS, type TemplateVarDef } from '../../config/notificationVars';

// ── Types ─────────────────────────────────────────────────────────────────────

interface NotificationTemplate {
  event_type: string;
  subject:    string;
  body_html:  string;
  is_active:  boolean;
  updated_at: string;
}

interface EasyParams {
  heading:      string;
  body:         string;
  btnText:      string;
  accentHex:    string;
  showComment:  boolean;
  infoFields:   string[];  // vars shown as detail table rows
  showProgress: boolean;   // add 承認進捗 row (route_dots + step X/Y)
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EVENT_META: Record<string, { label: string; label_en: string; icon: string; who: string; who_en: string }> = {
  APP_SUBMITTED:        { label: '申請提出',     label_en: 'Application Submitted',    icon: '📤', who: '→ 次の承認者',    who_en: '→ next approver' },
  STEP_ACTION_REQUIRED: { label: '承認依頼',     label_en: 'Approval Required',        icon: '🔔', who: '→ 担当承認者',    who_en: '→ assigned approver' },
  APP_APPROVED:         { label: '申請承認',     label_en: 'Application Approved',     icon: '✅', who: '→ 申請者',        who_en: '→ applicant' },
  APP_RETURNED:         { label: '差し戻し',     label_en: 'Application Returned',     icon: '↩',  who: '→ 申請者',        who_en: '→ applicant' },
  APP_REJECTED:         { label: '却下',         label_en: 'Application Rejected',     icon: '✗',  who: '→ 申請者',        who_en: '→ applicant' },
  SETTLEMENT_SUBMITTED: { label: '精算申請',     label_en: 'Settlement Submitted',     icon: '💴', who: '→ 精算承認者',    who_en: '→ settlement approver' },
  SETTLEMENT_APPROVED:  { label: '精算承認',     label_en: 'Settlement Approved',      icon: '🏦', who: '→ 申請者',        who_en: '→ applicant' },
  SETTLEMENT_AMOUNT_ADJUSTED: { label: '精算金額調整', label_en: 'Settlement Amount Adjusted', icon: '✏️', who: '→ 申請者', who_en: '→ applicant' },
};



const DUMMY_VARS: Record<string, string> = {
  applicant_name:        '山田 太郎',
  actor_name:            '佐藤 花子',
  application_number:    'RNG-2025-000001',
  template_name:         '出張申請',
  department_name:       '営業部',
  app_url:               'https://ringo.example.com/applications/123',
  comment:               '金額の根拠を追記してください。',
  step_name:             'マネージャー承認',
  date:                  '2025年5月27日',
  route_progress:        'ステップ 2 / 5',
  route_dots:            '●●◎○○',
  route_step_number:     '3',
  route_total_steps:     '5',
  current_step:          'マネージャー承認',
  current_step_approver: '佐藤 花子',
  old_amount:            '48,200',
  new_amount:            '48,560',
  adjustment_reason:     '領収書③の再計算により修正',
};

const ACCENT_PRESETS = [
  { label: 'RINGO Red',  hex: '#C0392B' },
  { label: 'Teal',       hex: '#0E7C7B' },
  { label: 'Amber',      hex: '#D97706' },
  { label: 'Slate',      hex: '#475569' },
  { label: 'Indigo',     hex: '#4F46E5' },
];

const EASY_MARKER = '<!-- ringo-easy-editor -->';

// ── Easy builder ───────────────────────────────────────────────────────────────

// Keys that map cleanly to a single {{var}} table row
const INFO_FIELD_OPTIONS: Array<{ key: string; labelJa: string }> = [
  { key: 'applicant_name',     labelJa: '申請者' },
  { key: 'template_name',      labelJa: '申請種別' },
  { key: 'department_name',    labelJa: '部署' },
  { key: 'application_number', labelJa: '申請番号' },
  { key: 'actor_name',         labelJa: '操作者' },
  { key: 'step_name',          labelJa: 'ステップ' },
  { key: 'date',               labelJa: '日付' },
  // Settlement amount adjustment (SETTLEMENT_AMOUNT_ADJUSTED)
  { key: 'old_amount',         labelJa: '調整前金額' },
  { key: 'new_amount',         labelJa: '調整後金額' },
  { key: 'adjustment_reason',  labelJa: '調整理由' },
];

function buildEmailFromEasy(p: EasyParams): string {
  // Info table rows
  const infoRows = p.infoFields.map((key) => {
    const def = INFO_FIELD_OPTIONS.find((o) => o.key === key);
    const label = def?.labelJa ?? key;
    return `      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;width:120px;" data-info-label="${label}">${label}</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;font-weight:600;">{{${key}}}</td></tr>`;
  });
  if (p.showProgress) {
    infoRows.push(
      `      <tr><td style="padding:4px 0;font-size:13px;color:#9e9589;width:120px;">承認進捗</td><td style="padding:4px 0;font-size:13px;color:#2d2d2d;">{{route_dots}} &nbsp;ステップ {{route_step_number}} / {{route_total_steps}}</td></tr>`,
    );
  }
  const infoTable = infoRows.length > 0
    ? `        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3ef;border-radius:8px;padding:16px;margin-bottom:24px;" data-info-table="1">
${infoRows.join('\n')}
        </table>`
    : '';

  const commentBlock = p.showComment
    ? `        <div style="background:#fef9ec;border-left:3px solid #f0b429;border-radius:0 4px 4px 0;padding:12px 16px;margin:0 0 24px 0;">
          <p style="margin:0 0 4px 0;font-size:12px;font-weight:700;color:#92610a;">コメント</p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#5a5550;">{{comment}}</p>
        </div>`
    : '';

  return `${EASY_MARKER}
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f2ee;font-family:'Helvetica Neue',Arial,'Hiragino Sans',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ee;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <tr><td style="background:${p.accentHex};padding:20px 32px;">
        <span style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">🍎 RINGO</span>
      </td></tr>
      <tr><td style="padding:32px;">
        <h1 style="margin:0 0 8px 0;font-size:19px;font-weight:700;color:#2d2a27;line-height:1.4;">${p.heading}</h1>
        <p style="margin:0 0 24px 0;font-size:14px;line-height:1.75;color:#5a5550;">${p.body}</p>
${infoTable}
${commentBlock}
        <table cellpadding="0" cellspacing="0"><tr><td style="background:${p.accentHex};border-radius:8px;overflow:hidden;">
          <a href="{{app_url}}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">${p.btnText}</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:14px 32px 16px;background:#faf9f7;border-top:1px solid #ede9e4;">
        <p style="margin:0;font-size:11px;color:#a09890;">{{applicant_name}} 様 ｜ {{template_name}} ｜ {{application_number}}</p>
        <p style="margin:4px 0 0;font-size:11px;color:#c0b8b0;">このメールは RINGO より自動送信されています。</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function parseEasyParams(html: string): EasyParams {
  // Heading: new = <h1>, old seeded = <p font-size:18px font-weight:700>
  const headingMatch =
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) ??
    html.match(/<p[^>]*font-size:1[6-9][^>]*font-weight:700[^>]*>([\s\S]*?)<\/p>/) ??
    html.match(/<p[^>]*font-weight:700[^>]*font-size:1[6-9][^>]*>([\s\S]*?)<\/p>/);

  // Body: new = margin:0 0 24px 0 font-size:14px; old = margin:0 0 24px;font-size:14px
  const bodyMatch =
    html.match(/<p[^>]*margin:0 0 24px[^>]*font-size:14px[^>]*>([\s\S]*?)<\/p>/) ??
    html.match(/<p style="margin:0 0 24px[^>]*>([\s\S]*?)<\/p>/);

  const btnMatch = html.match(/<a href="[^"]*"[^>]*>([\s\S]*?)<\/a>/);

  // Accent color: new = padding:20px, old = padding:24px
  const colorMatch =
    html.match(/background:(#[0-9A-Fa-f]{6});padding:20px/) ??
    html.match(/background:(#[0-9A-Fa-f]{6});padding:\d{1,2}px/);

  // Info table: new format uses data-info-table="1" + data-info-label on <td>
  // Old format: detect by matching {{varkey}} inside <td> cells of a table
  let infoFields: string[] = [];
  let showProgress = false;

  if (html.includes('data-info-table="1"')) {
    // New format — extract from data-info-label + {{key}} pairs
    const rowRegex = /data-info-label="[^"]*"[^>]*>[\s\S]*?<\/td>\s*<td[^>]*>\{\{(\w+)\}\}<\/td>/g;
    let m: RegExpExecArray | null;
    while ((m = rowRegex.exec(html)) !== null) {
      const key = m[1];
      if (key.startsWith('route_')) { showProgress = true; }
      else if (INFO_FIELD_OPTIONS.find((o) => o.key === key)) { infoFields.push(key); }
    }
  } else {
    // Old seeded format — detect table rows with {{varkey}} in second <td>
    const rowRegex = /<td[^>]*>\{\{(\w+)\}\}<\/td>/g;
    let m: RegExpExecArray | null;
    while ((m = rowRegex.exec(html)) !== null) {
      const key = m[1];
      if (key === 'app_url') continue; // skip the CTA link
      if (key.startsWith('route_')) { showProgress = true; }
      else if (INFO_FIELD_OPTIONS.find((o) => o.key === key)) {
        if (!infoFields.includes(key)) infoFields.push(key);
      }
    }
  }

  return {
    heading:      headingMatch?.[1]?.trim() ?? '',
    body:         bodyMatch?.[1]?.trim()    ?? '',
    btnText:      btnMatch?.[1]?.trim()     ?? '申請を確認する',
    accentHex:    colorMatch?.[1]           ?? '#C0392B',
    showComment:  html.includes('fef9ec'),
    infoFields,
    showProgress,
  };
}

function defaultEasyParams(): EasyParams {
  return {
    heading: '', body: '', btnText: '申請を確認する', accentHex: '#C0392B',
    showComment: false, infoFields: [], showProgress: false,
  };
}

// ── Easy Editor sub-component ─────────────────────────────────────────────────

// ── Reusable chip component ───────────────────────────────────────────────────
// Shows Japanese/English label → inserts {{key}} on click
function VarChip({
  varKey,
  lang,
  onInsert,
  variant = 'default',
  varDefs = HARDCODED_VAR_DEFS as readonly TemplateVarDef[],
}: {
  varKey: string;
  lang: string;
  onInsert: (key: string) => void;
  variant?: 'primary' | 'default' | 'progress';
  varDefs?: readonly TemplateVarDef[];
}) {
  const def = varDefs.find((v) => v.key === varKey);
  const label = def ? (lang === 'en' ? def.labelEn : def.labelJa) : varKey;
  const cls =
    variant === 'primary'  ? 'bg-ringo-50 text-ringo-700 border-ringo-100 hover:bg-ringo-100' :
    variant === 'progress' ? 'bg-teal-50 text-teal-700 border-teal-100 hover:bg-teal-100' :
                             'bg-surface-100 text-warmgray-600 border-surface-200 hover:bg-surface-200';
  return (
    <button
      key={varKey}
      type="button"
      title={`{{${varKey}}}`}
      onClick={() => onInsert(varKey)}
      className={`text-[10px] border px-2 py-0.5 rounded transition-colors ${cls}`}
    >
      + {label}
    </button>
  );
}

function EasyEditor({
  params,
  onChange,
  lang,
  varDefs = HARDCODED_VAR_DEFS as readonly TemplateVarDef[],
}: {
  params: EasyParams;
  onChange: (p: EasyParams) => void;
  lang: string;
  varDefs?: readonly TemplateVarDef[];
}) {
  const basicVars    = varDefs.filter((v) => v.group === 'basic');
  const progressVars = varDefs.filter((v) => v.group === 'progress');

  return (
    <div className="space-y-5">
      {/* Heading */}
      <div>
        <label className="label mb-1">見出し</label>
        <input
          type="text"
          value={params.heading}
          onChange={(e) => onChange({ ...params, heading: e.target.value })}
          className="input w-full"
          placeholder="新しい申請が届いています"
        />
        <div className="flex flex-wrap gap-1 mt-1.5">
          {['applicant_name', 'template_name', 'actor_name'].map((v) => (
            <VarChip key={v} varKey={v} lang={lang} variant="primary" varDefs={varDefs}
              onInsert={(k) => onChange({ ...params, heading: params.heading + `{{${k}}}` })} />
          ))}
        </div>
      </div>

      {/* Body */}
      <div>
        <label className="label mb-1">本文</label>
        <textarea
          value={params.body}
          onChange={(e) => onChange({ ...params, body: e.target.value })}
          className="input w-full text-sm leading-relaxed resize-y"
          rows={4}
          placeholder="{{applicant_name}} さんより申請が提出されました。内容をご確認ください。"
        />
        {/* Basic vars */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {basicVars.filter((v) => v.key !== 'comment' && v.key !== 'app_url').map((v) => (
            <VarChip key={v.key} varKey={v.key} lang={lang} variant="default" varDefs={varDefs}
              onInsert={(k) => onChange({ ...params, body: params.body + `{{${k}}}` })} />
          ))}
        </div>
        {/* Progress vars */}
        <div className="flex flex-wrap gap-1 mt-1 pt-1 border-t border-dashed border-warmgray-100">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-warmgray-400 self-center mr-1">
            {lang === 'ja' ? '承認進捗' : 'Progress'}
          </span>
          {progressVars.map((v) => (
            <VarChip key={v.key} varKey={v.key} lang={lang} variant="progress" varDefs={varDefs}
              onInsert={(k) => onChange({ ...params, body: params.body + `{{${k}}}` })} />
          ))}
        </div>
      </div>

      {/* Info table section */}
      <div>
        <label className="label mb-2">
          {lang === 'ja' ? '詳細テーブル行' : 'Detail table rows'}
          <span className="ml-1.5 text-[10px] font-normal text-warmgray-400">
            {lang === 'ja' ? '（メール本文に表形式で表示）' : '(shown as a table in the email body)'}
          </span>
        </label>
        {/* Current rows — sortable via up/down, removable */}
        {params.infoFields.length > 0 && (
          <div className="border border-warmgray-200 rounded-lg overflow-hidden mb-2 divide-y divide-warmgray-100">
            {params.infoFields.map((key, idx) => {
              const def = INFO_FIELD_OPTIONS.find((o) => o.key === key);
              return (
                <div key={key} className="flex items-center gap-2 px-3 py-1.5 bg-white text-xs">
                  <span className="text-warmgray-400 font-mono">#{idx + 1}</span>
                  <span className="font-semibold text-warmgray-700 w-20 shrink-0">{def?.labelJa ?? key}</span>
                  <code className="text-ringo-600 bg-ringo-50 px-1.5 py-0.5 rounded font-mono flex-1">{`{{${key}}}`}</code>
                  <div className="flex gap-0.5 shrink-0">
                    <button type="button" disabled={idx === 0}
                      onClick={() => { const f = [...params.infoFields]; [f[idx-1], f[idx]] = [f[idx], f[idx-1]]; onChange({ ...params, infoFields: f }); }}
                      className="px-1.5 py-0.5 rounded text-warmgray-400 hover:text-warmgray-700 disabled:opacity-30">↑</button>
                    <button type="button" disabled={idx === params.infoFields.length - 1}
                      onClick={() => { const f = [...params.infoFields]; [f[idx], f[idx+1]] = [f[idx+1], f[idx]]; onChange({ ...params, infoFields: f }); }}
                      className="px-1.5 py-0.5 rounded text-warmgray-400 hover:text-warmgray-700 disabled:opacity-30">↓</button>
                    <button type="button"
                      onClick={() => onChange({ ...params, infoFields: params.infoFields.filter((_, i) => i !== idx) })}
                      className="px-1.5 py-0.5 rounded text-warmgray-400 hover:text-red-500">✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {/* Add field pills */}
        <div className="flex flex-wrap gap-1">
          {INFO_FIELD_OPTIONS.filter((o) => !params.infoFields.includes(o.key)).map((o) => (
            <button key={o.key} type="button"
              onClick={() => onChange({ ...params, infoFields: [...params.infoFields, o.key] })}
              className="text-[10px] border px-2 py-0.5 rounded bg-surface-100 text-warmgray-600 border-surface-200 hover:bg-surface-200 transition-colors">
              + {o.labelJa}
            </button>
          ))}
        </div>
        {/* Progress row toggle */}
        <label className="flex items-center gap-2 mt-2 cursor-pointer select-none w-fit">
          <input type="checkbox" checked={params.showProgress}
            onChange={(e) => onChange({ ...params, showProgress: e.target.checked })}
            className="w-4 h-4 rounded border-warmgray-300 accent-teal-600" />
          <span className="text-xs text-warmgray-700">
            {lang === 'ja' ? '承認進捗行を追加（●◎○ ステップ X/Y）' : 'Add approval progress row (●◎○ step X/Y)'}
          </span>
        </label>
      </div>

      {/* Comment toggle */}
      <label className="flex items-center gap-2.5 cursor-pointer w-fit select-none">
        <input
          type="checkbox"
          checked={params.showComment}
          onChange={(e) => onChange({ ...params, showComment: e.target.checked })}
          className="w-4 h-4 rounded border-warmgray-300 accent-ringo-600"
        />
        <span className="text-sm text-warmgray-700">コメント欄を表示（差し戻し・却下メール用）</span>
      </label>

      {/* CTA button text */}
      <div>
        <label className="label mb-1">ボタンテキスト</label>
        <input
          type="text"
          value={params.btnText}
          onChange={(e) => onChange({ ...params, btnText: e.target.value })}
          className="input w-full"
          placeholder="申請を確認する"
        />
      </div>

      {/* Accent color */}
      <div>
        <label className="label mb-2">テーマカラー</label>
        <div className="flex items-center gap-2 flex-wrap">
          {ACCENT_PRESETS.map((c) => (
            <button
              key={c.hex}
              type="button"
              onClick={() => onChange({ ...params, accentHex: c.hex })}
              title={c.label}
              className={`w-8 h-8 rounded-full border-[3px] transition-all hover:scale-110 ${
                params.accentHex === c.hex
                  ? 'border-warmgray-700 scale-110 shadow-md'
                  : 'border-transparent shadow-sm'
              }`}
              style={{ background: c.hex }}
            />
          ))}
          {/* Custom color */}
          <label
            className="relative w-8 h-8 rounded-full border-2 border-dashed border-warmgray-300 flex items-center justify-center cursor-pointer hover:border-warmgray-500 transition-colors overflow-hidden"
            title="カスタムカラー"
            style={
              !ACCENT_PRESETS.find((c) => c.hex === params.accentHex)
                ? { background: params.accentHex, borderColor: '#374151', borderStyle: 'solid' }
                : {}
            }
          >
            <input
              type="color"
              value={params.accentHex}
              onChange={(e) => onChange({ ...params, accentHex: e.target.value })}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
            {!ACCENT_PRESETS.find((c) => c.hex === params.accentHex) ? null : (
              <span className="text-warmgray-400 text-base leading-none pointer-events-none">+</span>
            )}
          </label>
        </div>
      </div>

      {/* Live preview — renders the actual generated HTML with dummy vars */}
      <div className="border border-warmgray-200 rounded-xl overflow-hidden">
        <div className="px-3 py-1.5 bg-surface-50 border-b border-warmgray-100 text-[10px] font-semibold text-warmgray-400 uppercase tracking-wider">
          プレビュー
        </div>
        <iframe
          srcDoc={buildEmailFromEasy(params).replace(/\{\{(\w+)\}\}/g, (_, k) => DUMMY_VARS[k] ?? `{{${k}}}`)}
          className="w-full border-0"
          style={{ height: 420 }}
          sandbox="allow-same-origin"
          title="email preview"
        />
      </div>
    </div>
  );
}

// ── Helper ────────────────────────────────────────────────────────────────────

function renderPreview(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function NotificationTemplatesTab({
  showToast,
}: {
  showToast: (msg: string, type?: 'success' | 'error') => void;
}) {
  const { lang } = useLang();
  const qc = useQueryClient();

  const { data: templates = [], isLoading } = useQuery<NotificationTemplate[]>({
    queryKey: ['admin', 'notification-templates'],
    queryFn:  async () => (await apiClient.get('/admin/notification-templates')).data,
    staleTime: 0,
  });

  // Merge hardcoded defs with any user-added overrides from the dev page
  const { data: varOverrides } = useQuery<{ vars: TemplateVarDef[] }>({
    queryKey: ['admin', 'notify-var-defs'],
    queryFn:  async () => (await apiClient.get('/admin/notify-var-defs')).data,
    staleTime: 5 * 60 * 1000,
  });
  const varDefs = useMemo((): readonly TemplateVarDef[] => {
    if (!varOverrides?.vars?.length) return HARDCODED_VAR_DEFS;
    const overrideKeys = new Set(varOverrides.vars.map((v) => v.key));
    return [
      ...HARDCODED_VAR_DEFS.filter((v) => !overrideKeys.has(v.key)), // keep hardcoded not overridden
      ...varOverrides.vars,                                            // add/override from dev page
    ];
  }, [varOverrides]);

  const [drafts,    setDrafts]    = useState<Record<string, Partial<NotificationTemplate>>>({});
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [preview,   setPreview]   = useState<string | null>(null);
  const [editMode,  setEditMode]  = useState<Record<string, 'easy' | 'html'>>({});
  const [easyParams, setEasyParams] = useState<Record<string, EasyParams>>({});
  // track if html was edited manually (easy→html then typed) → warn on switch back
  const [htmlDirtyAfterSwitch, setHtmlDirtyAfterSwitch] = useState<Record<string, boolean>>({});

  // Sync draft + easy params when data loads
  useEffect(() => {
    const initialDrafts: Record<string, Partial<NotificationTemplate>> = {};
    const initialModes:  Record<string, 'easy' | 'html'> = {};
    const initialEasy:   Record<string, EasyParams> = {};

    for (const t of templates) {
      initialDrafts[t.event_type] = { subject: t.subject, body_html: t.body_html, is_active: t.is_active };
      // Always open in Easy mode — HTML only accessible via the small </> button
      // Always try to parse — works on EASY_MARKER html AND old html with same structure.
      // Falls back to empty strings for fields that can't be extracted (no regression).
      initialModes[t.event_type] = 'easy';
      initialEasy[t.event_type]  = parseEasyParams(t.body_html);
    }

    setDrafts(initialDrafts);
    setEditMode(initialModes);
    setEasyParams(initialEasy);
  }, [templates]);

  const saveMutation = useMutation({
    mutationFn: async (eventType: string) => {
      const d = drafts[eventType];
      return (await apiClient.patch(`/admin/notification-templates/${encodeURIComponent(eventType)}`, {
        subject:   d.subject,
        body_html: d.body_html,
        is_active: d.is_active,
      })).data;
    },
    onSuccess: (_, eventType) => {
      qc.invalidateQueries({ queryKey: ['admin', 'notification-templates'] });
      showToast(lang === 'ja' ? '保存しました' : 'Saved', 'success');
      setPreview(null);
      setHtmlDirtyAfterSwitch((prev) => ({ ...prev, [eventType]: false }));
    },
    onError: (err: unknown) => {
      const msg = (err as { data?: { error?: string } })?.data?.error;
      showToast(msg ?? (lang === 'ja' ? '保存に失敗しました' : 'Save failed'), 'error');
    },
  });

  const setField = (eventType: string, field: keyof NotificationTemplate, value: unknown) => {
    setDrafts((prev) => ({ ...prev, [eventType]: { ...prev[eventType], [field]: value } }));
  };

  const isDirty = (eventType: string) => {
    const original = templates.find((t) => t.event_type === eventType);
    const draft    = drafts[eventType];
    if (!original || !draft) return false;
    return draft.subject !== original.subject
      || draft.body_html !== original.body_html
      || draft.is_active !== original.is_active;
  };

  const insertVar = (eventType: string, field: 'subject' | 'body_html', varKey: string) => {
    setDrafts((prev) => {
      const cur = prev[eventType]?.[field] ?? '';
      return { ...prev, [eventType]: { ...prev[eventType], [field]: cur + `{{${varKey}}}` } };
    });
  };

  // Update easy params + regenerate HTML draft simultaneously
  const handleEasyChange = (eventType: string, p: EasyParams) => {
    setEasyParams((prev) => ({ ...prev, [eventType]: p }));
    const html = buildEmailFromEasy(p);
    setDrafts((prev) => ({ ...prev, [eventType]: { ...prev[eventType], body_html: html } }));
  };

  // Switch easy → html: generate HTML then switch
  const switchToHtml = (eventType: string) => {
    const html = buildEmailFromEasy(easyParams[eventType] ?? defaultEasyParams());
    setDrafts((prev) => ({ ...prev, [eventType]: { ...prev[eventType], body_html: html } }));
    setEditMode((prev) => ({ ...prev, [eventType]: 'html' }));
    setHtmlDirtyAfterSwitch((prev) => ({ ...prev, [eventType]: false }));
  };

  // Switch html → easy: parse if possible, warn only if user manually typed in HTML
  const switchToEasy = (eventType: string) => {
    // Already in easy mode — just close preview (no mode change needed)
    if ((editMode[eventType] ?? 'easy') === 'easy') {
      setPreview(null);
      return;
    }

    // Only confirm if user actually typed in the HTML textarea
    const hasManualEdits = htmlDirtyAfterSwitch[eventType];
    if (hasManualEdits) {
      const confirmed = window.confirm(
        lang === 'ja'
          ? 'HTMLを直接編集した内容がありますが、編集モードに戻ると上書きされます。よろしいですか？'
          : 'You have custom HTML edits. Switching to Edit mode will overwrite them. Continue?'
      );
      if (!confirmed) return;
    }

    const currentHtml = drafts[eventType]?.body_html ?? '';
    const isEasyHtml  = currentHtml.includes(EASY_MARKER);
    const parsed = isEasyHtml ? parseEasyParams(currentHtml) : defaultEasyParams();
    setEasyParams((prev) => ({ ...prev, [eventType]: parsed }));
    setEditMode((prev) => ({ ...prev, [eventType]: 'easy' }));
    setHtmlDirtyAfterSwitch((prev) => ({ ...prev, [eventType]: false }));
    setPreview(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-7 h-7 rounded-full border-2 border-ringo-200 border-t-ringo-600 animate-spin" />
      </div>
    );
  }

  const eventTypes = Object.keys(EVENT_META);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-warmgray-800">
            {lang === 'ja' ? '通知テンプレート' : 'Notification Templates'}
          </h2>
          <p className="text-xs text-warmgray-400 mt-0.5">
            {lang === 'ja'
              ? '各イベントのメール・Google Chat 通知文を編集できます。変更は最大5分以内に全体へ反映されます。'
              : 'Edit email and Google Chat notification text per event. Changes apply globally within 5 minutes.'}
          </p>
        </div>
      </div>

      {/* Variable reference */}
      <details className="card !p-0 overflow-hidden">
        <summary className="flex items-center justify-between px-4 py-3 cursor-pointer text-xs font-semibold text-warmgray-600 hover:text-warmgray-900 transition-colors list-none">
          <span>📖 {lang === 'ja' ? '使用可能な変数一覧' : 'Available template variables'}</span>
          <span className="text-warmgray-300">▾</span>
        </summary>
        <div className="px-4 pb-3 pt-2 space-y-3">
          {(['basic', 'progress'] as const).map((group) => (
            <div key={group}>
              <p className="text-[9px] font-bold uppercase tracking-widest text-warmgray-400 mb-1.5">
                {group === 'progress'
                  ? (lang === 'ja' ? '承認進捗' : 'Route progress')
                  : (lang === 'ja' ? '基本情報' : 'Basic')}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
                {varDefs.filter((v) => v.group === group).map((v) => (
                  <div key={v.key} className="flex items-baseline gap-2">
                    <code className="text-[11px] bg-ringo-50 text-ringo-700 px-1.5 py-0.5 rounded font-mono shrink-0">
                      {'{{' + v.key + '}}'}
                    </code>
                    <span className="text-[11px] font-semibold text-warmgray-700 shrink-0">
                      {lang === 'ja' ? v.labelJa : v.labelEn}
                    </span>
                    <span className="text-[11px] text-warmgray-400 truncate">{v.descJa}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>

      {/* Template cards */}
      <div className="space-y-3">
        {eventTypes.map((eventType) => {
          const meta    = EVENT_META[eventType];
          const draft   = drafts[eventType];
          const dirty   = isDirty(eventType);
          const isOpen  = expanded === eventType;
          const saving  = saveMutation.isPending && saveMutation.variables === eventType;
          const mode    = editMode[eventType] ?? 'html';
          const easy    = easyParams[eventType] ?? defaultEasyParams();

          return (
            <div
              key={eventType}
              className={`card !p-0 overflow-hidden transition-shadow ${isOpen ? 'shadow-md' : ''}`}
            >
              {/* Card header */}
              <button
                type="button"
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-50/60 transition-colors"
                onClick={() => setExpanded(isOpen ? null : eventType)}
              >
                <span className="text-xl leading-none">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-warmgray-800">
                      {lang === 'ja' ? meta.label : meta.label_en}
                    </span>
                    <span className="text-[10px] text-warmgray-400 font-mono bg-surface-100 px-1.5 py-0.5 rounded">
                      {eventType}
                    </span>
                    <span className="text-[11px] text-warmgray-400">
                      {lang === 'ja' ? meta.who : meta.who_en}
                    </span>
                    {dirty && (
                      <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                        {lang === 'ja' ? '未保存' : 'Unsaved'}
                      </span>
                    )}
                  </div>
                  {draft?.subject && (
                    <p className="text-[11px] text-warmgray-400 truncate mt-0.5">{draft.subject}</p>
                  )}
                </div>
                {/* Active toggle — saves immediately, no expand required */}
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <span className="text-[11px] text-warmgray-400">
                    {draft?.is_active ? (lang === 'ja' ? '有効' : 'Active') : (lang === 'ja' ? '無効' : 'Disabled')}
                  </span>
                  <button
                    type="button"
                    disabled={saveMutation.isPending}
                    onClick={async () => {
                      const next = !draft?.is_active;
                      setField(eventType, 'is_active', next);
                      await apiClient.patch(`/admin/notification-templates/${encodeURIComponent(eventType)}`, {
                        subject:   draft?.subject,
                        body_html: draft?.body_html,
                        is_active: next,
                      });
                      qc.invalidateQueries({ queryKey: ['admin', 'notification-templates'] });
                    }}
                    className={`relative w-9 h-5 rounded-full transition-colors focus:outline-none ${
                      draft?.is_active ? 'bg-ringo-500' : 'bg-warmgray-200'
                    } ${saveMutation.isPending ? 'opacity-50' : ''}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${draft?.is_active ? 'translate-x-4' : ''}`} />
                  </button>
                </div>
                <span className={`text-warmgray-300 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
              </button>

              {/* Expanded editor */}
              {isOpen && (
                <div className="border-t border-warmgray-100 px-4 pb-4 pt-3 space-y-4">

                  {/* Subject */}
                  <div>
                    <label className="label mb-1">
                      {lang === 'ja' ? 'メール件名' : 'Email subject'}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={draft?.subject ?? ''}
                        onChange={(e) => setField(eventType, 'subject', e.target.value)}
                        className="input flex-1 font-mono text-sm"
                        placeholder="【RINGO】{{template_name}} ..."
                      />
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {['applicant_name', 'template_name', 'application_number'].map((v) => (
                        <VarChip key={v} varKey={v} lang={lang} variant="primary" varDefs={varDefs}
                          onInsert={(k) => insertVar(eventType, 'subject', k)} />
                      ))}
                    </div>
                  </div>

                  {/* Body editor — mode toggle */}
                  <div>
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <label className="label shrink-0">
                        {lang === 'ja' ? 'メール本文' : 'Email body'}
                      </label>
                      <div className="flex items-center gap-2">
                        {/* Main pill: Easy + Preview */}
                        <div className="flex items-center bg-surface-100 rounded-lg p-0.5 gap-0.5">
                          <button
                            type="button"
                            onClick={() => switchToEasy(eventType)}
                            className={`px-3 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                              mode === 'easy'
                                ? 'bg-white text-warmgray-800 shadow-sm'
                                : 'text-warmgray-500 hover:text-warmgray-700'
                            }`}
                          >
                            ✏️ {lang === 'ja' ? '編集' : 'Edit'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPreview(preview === eventType ? null : eventType)}
                            className={`px-3 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                              preview === eventType
                                ? 'bg-white text-warmgray-800 shadow-sm'
                                : 'text-warmgray-500 hover:text-warmgray-700'
                            }`}
                          >
                            👁 {preview === eventType
                              ? (lang === 'ja' ? '閉じる' : 'Close')
                              : (lang === 'ja' ? 'プレビュー' : 'Preview')}
                          </button>
                        </div>
                        {/* Small HTML button — non-intrusive, outside main pill */}
                        <button
                          type="button"
                          onClick={() => switchToHtml(eventType)}
                          title={lang === 'ja' ? 'HTMLを直接編集' : 'Edit raw HTML'}
                          className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                            mode === 'html'
                              ? 'bg-warmgray-800 text-white border-warmgray-800'
                              : 'text-warmgray-400 border-warmgray-200 hover:text-warmgray-600 hover:border-warmgray-300'
                          }`}
                        >
                          {'</>'}
                        </button>
                      </div>
                    </div>

                    {/* Preview panel — available in both modes */}
                    {preview === eventType && (
                      <div className="border border-warmgray-200 rounded-lg overflow-hidden bg-white mb-4">
                        <div className="bg-surface-50 px-3 py-1.5 border-b border-warmgray-100 flex items-center gap-2">
                          <span className="text-[10px] font-semibold text-warmgray-400 uppercase tracking-wider">
                            {lang === 'ja' ? 'プレビュー（ダミーデータ）' : 'Preview (dummy data)'}
                          </span>
                        </div>
                        <div className="p-3">
                          <p className="text-[11px] text-warmgray-500 mb-2">
                            <span className="font-semibold">{lang === 'ja' ? '件名: ' : 'Subject: '}</span>
                            {renderPreview(draft?.subject ?? '', DUMMY_VARS)}
                          </p>
                          <iframe
                            srcDoc={renderPreview(draft?.body_html ?? '', DUMMY_VARS)}
                            className="w-full border-0 rounded"
                            style={{ height: 480 }}
                            sandbox="allow-same-origin"
                            title="email preview"
                          />
                        </div>
                      </div>
                    )}

                    {/* Easy editor */}
                    {mode === 'easy' && !preview && (
                      <EasyEditor
                        params={easy}
                        lang={lang}
                        varDefs={varDefs}
                        onChange={(p) => handleEasyChange(eventType, p)}
                      />
                    )}

                    {/* HTML editor */}
                    {mode === 'html' && !preview && (
                      <>
                        {/* Warning banner */}
                        <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200/80 rounded-lg mb-3 text-[11px] text-amber-700 leading-relaxed">
                          <span className="shrink-0 mt-px">⚠️</span>
                          <span>
                            {lang === 'ja'
                              ? 'HTMLを直接編集すると編集モードと同期しなくなります。「編集」に戻ると上書きされます。'
                              : 'Direct HTML edits are not synced back to Edit mode. Switching to Edit will overwrite your HTML changes.'}
                          </span>
                        </div>
                        <textarea
                          value={draft?.body_html ?? ''}
                          onChange={(e) => {
                            setField(eventType, 'body_html', e.target.value);
                            setHtmlDirtyAfterSwitch((prev) => ({ ...prev, [eventType]: true }));
                          }}
                          className="input w-full font-mono text-xs leading-relaxed resize-y"
                          style={{ minHeight: 240 }}
                          spellCheck={false}
                          placeholder="<!DOCTYPE html>..."
                        />
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {varDefs.filter((v) => v.group === 'basic').map((v) => (
                            <VarChip key={v.key} varKey={v.key} lang={lang} variant="default" varDefs={varDefs}
                              onInsert={(k) => insertVar(eventType, 'body_html', k)} />
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1 pt-1 border-t border-dashed border-warmgray-100">
                          <span className="text-[9px] font-semibold uppercase tracking-wider text-warmgray-400 self-center mr-1">
                            {lang === 'ja' ? '承認進捗' : 'Progress'}
                          </span>
                          {varDefs.filter((v) => v.group === 'progress').map((v) => (
                            <VarChip key={v.key} varKey={v.key} lang={lang} variant="progress" varDefs={varDefs}
                              onInsert={(k) => insertVar(eventType, 'body_html', k)} />
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Save row */}
                  <div className="flex items-center justify-between pt-1 border-t border-warmgray-100">
                    <div className="text-[11px] text-warmgray-400">
                      {templates.find((t) => t.event_type === eventType)?.updated_at
                        ? (lang === 'ja' ? '最終更新: ' : 'Last saved: ') +
                          new Date(templates.find((t) => t.event_type === eventType)!.updated_at)
                            .toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-US')
                        : ''}
                    </div>
                    <button
                      type="button"
                      disabled={!dirty || saving}
                      onClick={() => saveMutation.mutate(eventType)}
                      className={`btn-primary text-sm px-5 py-2 ${!dirty || saving ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {saving
                        ? (lang === 'ja' ? '保存中...' : 'Saving...')
                        : (lang === 'ja' ? '保存する' : 'Save')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
