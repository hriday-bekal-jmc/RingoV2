// Core notification dispatcher.
//
// Usage (fire-and-forget — NEVER await):
//   notifyApplicationEvent('APP_RETURNED', appId, { actor_id: userId, comment });
//
// Recipients are resolved internally from DB based on event type:
//   - Approver events  → next PENDING step with explicit approver_id
//   - Applicant events → applications.applicant_id
//
// Template is read from notification_templates (5-min cache).
// Failure at any stage is caught + logged — never propagates to caller.

import fs   from 'fs/promises';
import path from 'path';
import { pool }                    from '../config/db';
import { env }                     from '../config/env';
import { getNotificationTemplate } from './notificationCache';
import { sendEmail }               from './emailService';
import { sendGChat }               from './gchatService';

// ── Auto-resolve: source table whitelist + override cache ─────────────────────

const NOTIFY_VARS_PATH = path.resolve(__dirname, '../../../frontend/src/config/notificationVars.overrides.json');

/**
 * Whitelist of allowed sources for auto-resolve.
 * alias    = table alias already in the base fetchAppContext query
 * join     = SQL JOIN appended when this source is needed (added once per query)
 */
export const RESOLVE_SOURCES: Record<string, {
  alias:      string;
  label:      string;
  hintFields: string[];
  join?:      string;
}> = {
  application: {
    alias:      'a',
    label:      '申請',
    hintFields: ['status', 'amount', 'application_number', 'created_at'],
  },
  applicant: {
    alias:      'u',
    label:      '申請者',
    hintFields: ['full_name', 'email', 'role'],
  },
  department: {
    alias:      'd',
    label:      '部署',
    hintFields: ['name', 'code'],
  },
  template: {
    alias:      'ft',
    label:      '申請テンプレート',
    hintFields: ['title_ja', 'title', 'description_ja'],
  },
  settlement: {
    alias:      's',
    label:      '精算',
    hintFields: ['actual_amount', 'status'],
    join:       'LEFT JOIN settlements s ON s.application_id = a.id',
  },
  pending_step: {
    alias:      'ps',
    label:      '現承認ステップ',
    hintFields: ['label', 'status'],
    join:       `LEFT JOIN LATERAL (
      SELECT label, status, approver_id
      FROM approval_steps
      WHERE application_id = a.id AND status = 'PENDING'
      ORDER BY step_order ASC LIMIT 1
    ) ps ON TRUE`,
  },
};

interface ResolveConfig { source: string; field: string; fallback?: string }
interface VarOverrideEntry { key: string; resolve?: ResolveConfig }

// 30s in-memory cache — re-reads file when dev saves changes in the UI
let _varOverrideCache: { data: VarOverrideEntry[]; ts: number } | null = null;
const VAR_OVERRIDE_TTL_MS = 30_000;

async function loadVarOverrides(): Promise<VarOverrideEntry[]> {
  const now = Date.now();
  if (_varOverrideCache && now - _varOverrideCache.ts < VAR_OVERRIDE_TTL_MS) {
    return _varOverrideCache.data;
  }
  try {
    const raw    = await fs.readFile(NOTIFY_VARS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { vars?: VarOverrideEntry[] };
    const data   = Array.isArray(parsed.vars) ? parsed.vars : [];
    _varOverrideCache = { data, ts: now };
    return data;
  } catch {
    _varOverrideCache = { data: [], ts: now };
    return [];
  }
}

/** Flush the in-process cache — called immediately after dev page saves. */
export function invalidateVarOverrideCache(): void {
  _varOverrideCache = null;
}

/** Validate column/alias name — prevents SQL injection. */
function isSafeIdentifier(name: string): boolean {
  return /^[a-z_][a-z0-9_]{0,62}$/.test(name);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotificationEventType =
  | 'APP_SUBMITTED'
  | 'APP_APPROVED'
  | 'APP_RETURNED'
  | 'APP_REJECTED'
  | 'SETTLEMENT_SUBMITTED'
  | 'SETTLEMENT_APPROVED'
  | 'SETTLEMENT_AMOUNT_ADJUSTED'
  | 'STEP_ACTION_REQUIRED';

// Events where recipient = next pending step's assigned approver
const APPROVER_EVENTS = new Set<NotificationEventType>([
  'APP_SUBMITTED',
  'STEP_ACTION_REQUIRED',
  'SETTLEMENT_SUBMITTED',
]);

interface RecipientRow {
  id:                string;
  email:             string;
  notify_email:      boolean;
  notify_gchat:      boolean;
  gchat_webhook_url: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderTemplate(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function resolveRecipientIds(
  eventType:     NotificationEventType,
  applicationId: string,
): Promise<string[]> {
  if (APPROVER_EVENTS.has(eventType)) {
    // Only explicitly-assigned approvers — role-based (null approver_id) steps are too broad
    const r = await pool.query<{ approver_id: string }>(
      `SELECT approver_id FROM approval_steps
       WHERE application_id = $1 AND status = 'PENDING' AND approver_id IS NOT NULL
       ORDER BY step_order ASC LIMIT 1`,
      [applicationId],
    );
    return r.rows[0]?.approver_id ? [r.rows[0].approver_id] : [];
  } else {
    const r = await pool.query<{ applicant_id: string }>(
      `SELECT applicant_id FROM applications WHERE id = $1`,
      [applicationId],
    );
    return r.rows[0]?.applicant_id ? [r.rows[0].applicant_id] : [];
  }
}

async function fetchAppContext(applicationId: string): Promise<Record<string, string> | null> {
  try {
    // Build dynamic SELECT columns + JOINs from user-defined resolve configs
    const varOverrides    = await loadVarOverrides();
    const dynamicSelects: string[] = [];
    const dynamicJoins:   string[] = [];
    const joinAdded = new Set<string>();

    for (const v of varOverrides) {
      if (!v.resolve) continue;
      const { source, field, fallback } = v.resolve;
      const src = RESOLVE_SOURCES[source];
      if (!src)                    continue;   // unknown source → skip
      if (!isSafeIdentifier(field)) continue;  // unsafe field → skip
      if (!isSafeIdentifier(v.key)) continue;  // unsafe output key → skip

      if (src.join && !joinAdded.has(source)) {
        dynamicJoins.push(src.join);
        joinAdded.add(source);
      }
      const textExpr = `${src.alias}.${field}::text`;
      const coalesced = fallback !== undefined
        ? `COALESCE(${textExpr}, '${fallback.replace(/'/g, "''")}')`
        : `COALESCE(${textExpr}, '')`;
      dynamicSelects.push(`${coalesced} AS "${v.key}"`);
    }

    const r = await pool.query(
      `SELECT
         u.full_name                                     AS applicant_name,
         COALESCE(a.application_number, '未発行')        AS application_number,
         COALESCE(ft.title_ja, ft.title, '—')           AS template_name,
         COALESCE(d.name, '—')                          AS department_name
         ${dynamicSelects.length ? ',\n         ' + dynamicSelects.join(',\n         ') : ''}
       FROM applications a
       JOIN users u           ON u.id  = a.applicant_id
       JOIN form_templates ft ON ft.id = a.template_id
       LEFT JOIN departments d ON d.id = u.department_id
       ${dynamicJoins.join('\n       ')}
       WHERE a.id = $1`,
      [applicationId],
    );
    if (r.rows.length === 0) return null;
    return {
      ...(r.rows[0] as Record<string, string>),
      app_url: `${env.FRONTEND_ORIGIN}/applications/${applicationId}`,
    };
  } catch (err) {
    console.error('[notify] fetchAppContext failed:', err);
    return null;
  }
}

interface StepRow {
  step_order: number;
  status:     string;
  label:      string;
  approver_name: string | null;
}

async function fetchRouteProgress(applicationId: string): Promise<Record<string, string>> {
  try {
    const r = await pool.query<StepRow>(
      `SELECT s.step_order, s.status, s.label,
              u.full_name AS approver_name
       FROM approval_steps s
       LEFT JOIN users u ON u.id = s.approver_id
       WHERE s.application_id = $1
         AND s.status != 'CANCELLED'
         AND (s.stage = 'RINGI' OR s.stage IS NULL)
       ORDER BY s.step_order ASC`,
      [applicationId],
    );
    const steps = r.rows;
    if (steps.length === 0) return {};

    // Latest round only (highest floor(step_order/100))
    const maxRound    = Math.max(...steps.map((s) => Math.floor(s.step_order / 100)));
    const latest      = steps.filter((s) => Math.floor(s.step_order / 100) === maxRound);
    const total       = latest.length;
    const doneCount   = latest.filter((s) => s.status === 'APPROVED').length;
    const pendingStep = latest.find((s) => s.status === 'PENDING');

    // Unicode dot string: ● done, ◎ current/pending, ○ waiting, ✗ returned
    const dots = latest
      .map((s) =>
        s.status === 'APPROVED'                               ? '●' :
        s.status === 'PENDING'                               ? '◎' :
        s.status === 'RETURNED' || s.status === 'REJECTED'  ? '✗' :
        '○',
      )
      .join('');

    return {
      route_progress:          `ステップ ${doneCount} / ${total}`,
      route_dots:              dots,
      route_step_number:       String(doneCount + 1),
      route_total_steps:       String(total),
      current_step:            pendingStep?.label          ?? '',
      current_step_approver:   pendingStep?.approver_name  ?? '',
    };
  } catch (err) {
    console.error('[notify] fetchRouteProgress failed:', err);
    return {};
  }
}

async function fetchRecipients(userIds: string[]): Promise<RecipientRow[]> {
  if (userIds.length === 0) return [];
  try {
    const r = await pool.query<RecipientRow>(
      `SELECT id, email, notify_email, notify_gchat, gchat_webhook_url
       FROM users
       WHERE id = ANY($1::uuid[]) AND is_active = TRUE AND deleted_at IS NULL`,
      [userIds],
    );
    return r.rows;
  } catch (err) {
    console.error('[notify] fetchRecipients failed:', err);
    return [];
  }
}

async function resolveActorName(actorId: string): Promise<string> {
  try {
    const r = await pool.query<{ full_name: string }>(
      `SELECT full_name FROM users WHERE id = $1`,
      [actorId],
    );
    return r.rows[0]?.full_name ?? '';
  } catch { return ''; }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget notification dispatch.
 * Call WITHOUT await — never blocks the approval flow.
 *
 * extraVars special keys:
 *   actor_id  → resolved to actor_name via DB lookup
 *   comment   → shown in return/reject templates
 *   step_name → current step label
 */
export function notifyApplicationEvent(
  eventType:     NotificationEventType,
  applicationId: string,
  extraVars:     Record<string, string> = {},
): void {
  _dispatch(eventType, applicationId, extraVars).catch((err) => {
    console.error(`[notify] unhandled error ${eventType}/${applicationId}:`, err);
  });
}

async function _dispatch(
  eventType:     NotificationEventType,
  applicationId: string,
  extraVars:     Record<string, string>,
): Promise<void> {
  console.info(`[notify] ▶ ${eventType} app=${applicationId}`);

  const [recipientIds, template, appCtx, routeProgress] = await Promise.all([
    resolveRecipientIds(eventType, applicationId),
    getNotificationTemplate(eventType),
    fetchAppContext(applicationId),
    fetchRouteProgress(applicationId),
  ]);

  if (!template || !template.is_active) {
    console.warn(`[notify] ✗ SKIP — template missing or inactive for ${eventType}`); return;
  }
  if (!appCtx) {
    console.warn(`[notify] ✗ SKIP — fetchAppContext returned null (app not found?) for ${applicationId}`); return;
  }
  if (recipientIds.length === 0) {
    console.warn(`[notify] ✗ SKIP — no recipients for ${eventType}/${applicationId}. For APP_SUBMITTED: step must have approver_id set (not role-based)`); return;
  }
  console.info(`[notify] recipients=${recipientIds.join(',')}`);

  let actorName = extraVars.actor_name ?? '';
  if (!actorName && extraVars.actor_id) {
    actorName = await resolveActorName(extraVars.actor_id);
  }

  const vars: Record<string, string> = {
    ...appCtx,
    ...routeProgress,
    actor_name: actorName,
    comment:    extraVars.comment   ?? '',
    step_name:  extraVars.step_name ?? '',
    date:       new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }),
    ...extraVars,
  };

  const renderedSubject  = renderTemplate(template.subject,   vars);
  const renderedBodyHtml = renderTemplate(template.body_html, vars);

  const recipients = await fetchRecipients(recipientIds);
  if (recipients.length === 0) return;

  const dispatches: Promise<void>[] = [];
  for (const r of recipients) {
    if (r.notify_email) {
      console.info(`[notify] → email to ${r.email}`);
      dispatches.push(sendEmail(r.email, renderedSubject, renderedBodyHtml));
    } else {
      console.info(`[notify] ⊘ email skipped for ${r.email} (notify_email=false)`);
    }
    if (r.notify_gchat && r.gchat_webhook_url) {
      console.info(`[notify] → gchat webhook for ${r.email}`);
      const text = htmlToText(renderedBodyHtml);
      dispatches.push(sendGChat(r.gchat_webhook_url, `*${renderedSubject}*\n\n${text}`));
    } else if (r.notify_gchat && !r.gchat_webhook_url) {
      console.info(`[notify] ⊘ gchat skipped for ${r.email} (no webhook URL saved)`);
    }
  }

  await Promise.allSettled(dispatches);
  console.info(`[notify] ✓ ${eventType} dispatched ${dispatches.length} message(s)`);
}
