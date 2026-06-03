// Dashboard summary endpoint.
//
// Replaces the previous pattern of fetching limit=100 applications and
// filtering on the client. One small JSON instead of 100-row payload.
//
// Returns:
//   - status_counts:    counts per status for the current user's own apps
//   - recent_apps:      5 most-recent for the recent activity list
//   - pending_approvals: { items, total } for users who can approve
//
// Cached per-user in Redis (30s TTL). Invalidated naturally; relevant SSE
// events on the frontend already trigger React Query refetch.

import { Router, Request, Response } from 'express';
import { query } from '../config/db';
import { extractRowPreview } from '../services/rowPreview';
import { redis } from '../config/redis';
import { isAdminUser, requireAuth } from '../middlewares/authMiddleware';

// Roles that may have pending approvals assigned. Backend role-gates the
// pending query so non-approver users don't pay for an empty join.
const APPROVER_ROLES = new Set(['MANAGER', 'GM', 'SOUMU', 'SENMU', 'PRESIDENT']);

const router = Router();
router.use(requireAuth);

const CACHE_TTL_SEC = 60;  // SSE invalidates on real changes — pure ping-pong guard
const cacheKey = (userId: string) => `dashboard:summary:${userId}`;

interface StatusCounts {
  DRAFT:              number;
  PENDING_APPROVAL:   number;
  RETURNED:           number;
  APPROVED:           number;
  PENDING_SETTLEMENT: number;
  SETTLEMENT_APPROVED: number;
  COMPLETED:          number;
  REJECTED:           number;
}

interface DashboardSummary {
  status_counts: StatusCounts;
  recent_apps: Array<{
    id:                  string;
    application_number:  string | null;
    status:              string;
    created_at:          string;
    submitted_at:        string | null;
    template_name:       string;
    template_code:       string;
    has_settlement:      boolean;
    pattern_id:          number;
    current_step:        number | null;
    total_steps:         number;
  }>;
  pending_approvals?: {
    items: Array<{
      id:               string;
      application_id:   string;
      application_number: string | null;
      template_name:    string;
      applicant_name:   string;
      created_at:       string;
    }>;
    total: number;
  };
}

const ZERO_COUNTS: StatusCounts = {
  DRAFT: 0, PENDING_APPROVAL: 0, RETURNED: 0, APPROVED: 0,
  PENDING_SETTLEMENT: 0, SETTLEMENT_APPROVED: 0, COMPLETED: 0, REJECTED: 0,
};

router.get('/summary', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const role   = req.user!.role;
  const canApprove = isAdminUser(req.user) || APPROVER_ROLES.has(role);

  // ── Redis cache check ──────────────────────────────────────────────────
  try {
    const cached = await redis.get(cacheKey(userId));
    if (cached) {
      res.json(JSON.parse(cached));
      return;
    }
  } catch {
    // Cache miss / Redis down → fall through to DB
  }

  try {
    // Keep these sequential to avoid one dashboard request occupying multiple
    // Postgres connections on a cache miss. The individual queries are small.
    // 1. Status counts via GROUP BY (one row per status)
    const countsRes = await query(
        `SELECT status, COUNT(*)::text AS n
         FROM applications
         WHERE applicant_id = $1
           AND archived_at IS NULL
         GROUP BY status`,
        [userId],
    );

    // 2. Recent 5 with template join + step counts in one query
    const recentRes = await query(
        `SELECT
           a.id, a.application_number, a.status, a.created_at, a.submitted_at,
           t.title_ja AS template_name, t.title AS template_title_en, t.code AS template_code,
           t.settlement_schema IS NOT NULL AS has_settlement,
           t.pattern_id,
           a.form_data, a.settlement_data,
           COALESCE(v.schema_definition, t.schema_definition) AS schema_definition,
           COALESCE(v.settlement_schema, t.settlement_schema) AS settlement_schema_def,
           -- current_step = 1-indexed rank within the current batch (excludes skipped-at-start steps and cancelled)
           COALESCE((
             SELECT COUNT(*)::int FROM approval_steps
             WHERE application_id = a.id
               AND stage = ps.stage
               AND step_order / 100 = ps.batch
               AND step_order <= ps.step_order
               AND status != 'CANCELLED'
           ), 0) AS current_step,
           -- total_steps = count of non-cancelled steps in the current batch only
           COALESCE((
             SELECT COUNT(*)::int FROM approval_steps
             WHERE application_id = a.id
               AND stage = ps.stage
               AND step_order / 100 = ps.batch
               AND status != 'CANCELLED'
           ), 0) AS total_steps
         FROM applications a
         JOIN form_templates t ON a.template_id = t.id
         LEFT JOIN form_template_versions v ON v.id = a.template_version_id
         -- resolve the current pending step once; drives both current_step + total_steps
         LEFT JOIN LATERAL (
           SELECT s.step_order, s.step_order / 100 AS batch,
             CASE WHEN a.status IN ('PENDING_SETTLEMENT','SETTLEMENT_APPROVED')
                  THEN 'SETTLEMENT' ELSE 'RINGI' END AS stage
           FROM approval_steps s
           WHERE s.application_id = a.id
             AND s.status = 'PENDING'
             AND s.stage = CASE WHEN a.status IN ('PENDING_SETTLEMENT','SETTLEMENT_APPROVED')
                                THEN 'SETTLEMENT' ELSE 'RINGI' END
           ORDER BY s.step_order ASC LIMIT 1
         ) ps ON TRUE
         WHERE a.applicant_id = $1
           AND a.archived_at IS NULL
         ORDER BY a.created_at DESC
         LIMIT 5`,
        [userId],
    );

      // 3. Pending approvals — only for approvers
    const pendingRes = canApprove
      ? await query(
            `SELECT
               s.id, s.application_id, a.application_number,
               t.title_ja AS template_name, t.title AS template_title_en,
               u.full_name AS applicant_name,
               s.created_at,
               COUNT(*) OVER() AS _total
             FROM approval_steps s
             JOIN applications a   ON a.id = s.application_id
             JOIN form_templates t ON t.id = a.template_id
             JOIN users u          ON u.id = a.applicant_id
             WHERE s.approver_id = $1
               AND s.status = 'PENDING'
               AND a.archived_at IS NULL
             ORDER BY s.created_at ASC
             LIMIT 5`,
            [userId],
          )
      : { rows: [] as Array<Record<string, unknown>> };

    // Build status_counts
    const status_counts: StatusCounts = { ...ZERO_COUNTS };
    for (const r of countsRes.rows) {
      const key = r.status as keyof StatusCounts;
      if (key in status_counts) status_counts[key] = Number(r.n);
    }

    // Build response
    const total =
      pendingRes.rows.length > 0
        ? Number((pendingRes.rows[0] as { _total: string })._total)
        : 0;

    const summary: DashboardSummary = {
      status_counts,
      recent_apps: recentRes.rows.map((r: any) => ({
        id:                 r.id,
        application_number: r.application_number,
        status:             r.status,
        created_at:         r.created_at,
        submitted_at:       r.submitted_at,
        template_name:      r.template_name,
        template_title_en:  r.template_title_en,
        template_code:      r.template_code,
        has_settlement:     r.has_settlement,
        pattern_id:         Number(r.pattern_id),
        current_step:       r.current_step !== null ? Number(r.current_step) : null,
        total_steps:        Number(r.total_steps),
        row_preview:        extractRowPreview(r.schema_definition, r.form_data, r.settlement_schema_def, r.settlement_data),
      })),
    };

    if (canApprove) {
      summary.pending_approvals = {
        items: pendingRes.rows.map((r: any) => ({
          id:                 r.id,
          application_id:     r.application_id,
          application_number: r.application_number,
          template_name:      r.template_name,
          applicant_name:     r.applicant_name,
          created_at:         r.created_at,
        })),
        total,
      };
    }

    // Cache and return
    redis.setex(cacheKey(userId), CACHE_TTL_SEC, JSON.stringify(summary)).catch(() => {});
    res.json(summary);
  } catch (err) {
    console.error('[dashboard] summary failed:', err);
    res.status(500).json({ error: 'ダッシュボードの取得に失敗しました' });
  }
});

// ── GET /dashboard/admin-overview — ADMIN only, company-wide stats ────────────
router.get('/admin-overview', async (req: Request, res: Response): Promise<void> => {
  if (!isAdminUser(req.user)) {
    res.status(403).json({ error: 'ADMIN only' });
    return;
  }

  const CACHE_KEY = 'dashboard:admin-overview';

  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) { res.json(JSON.parse(cached)); return; }
  } catch { /* fall through */ }

  try {
    // Keep this sequential to avoid a single admin request occupying five
    // Postgres connections on a cache miss.

      // 1. Company-wide status counts
      const statusRes = await query(
        `SELECT status, COUNT(*)::int AS n
         FROM applications
         WHERE archived_at IS NULL
         GROUP BY status`,
        [],
      );

      // 2. Apps per department
      const deptRes = await query(
        `SELECT
           COALESCE(d.name, '未設定') AS dept_name,
           COUNT(*)::int             AS total,
           COUNT(*) FILTER (WHERE a.status = 'PENDING_APPROVAL')::int AS pending,
           COUNT(*) FILTER (WHERE a.status IN ('PENDING_SETTLEMENT','SETTLEMENT_APPROVED'))::int AS in_settlement,
           COUNT(*) FILTER (WHERE a.status = 'COMPLETED')::int AS completed
         FROM applications a
         JOIN users u ON u.id = a.applicant_id
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE a.archived_at IS NULL
         GROUP BY d.name
         ORDER BY total DESC
         LIMIT 10`,
        [],
      );

      // 3. Pending approval steps — grouped by assigned approver
      const pendingRes = await query(
        `SELECT
           COALESCE(u.full_name, '未割当') AS approver_name,
           COUNT(*)::int AS pending_count
         FROM approval_steps s
         LEFT JOIN users u ON u.id = s.approver_id
         WHERE s.status = 'PENDING'
         GROUP BY u.full_name
         ORDER BY pending_count DESC
         LIMIT 8`,
        [],
      );

      // 4. Recent 8 company-wide apps
      const recentRes = await query(
        `SELECT
           a.id, a.application_number, a.status, a.created_at,
           t.title_ja AS template_name, t.code AS template_code,
           u.full_name AS applicant_name,
           COALESCE(d.name, '—') AS dept_name
         FROM applications a
         JOIN form_templates t ON t.id = a.template_id
         JOIN users u ON u.id = a.applicant_id
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE a.archived_at IS NULL
         ORDER BY a.created_at DESC
         LIMIT 5`,
        [],
      );

      // 5. Settlement overview
      const settleRes = await query(
        `SELECT
           COUNT(*) FILTER (WHERE a.status = 'PENDING_SETTLEMENT')::int   AS awaiting_approval,
           COUNT(*) FILTER (WHERE a.status = 'SETTLEMENT_APPROVED')::int  AS awaiting_transfer,
           COUNT(*) FILTER (WHERE a.status = 'COMPLETED')::int            AS completed
         FROM applications a
         WHERE a.status IN ('PENDING_SETTLEMENT','SETTLEMENT_APPROVED','COMPLETED')
           AND a.archived_at IS NULL`,
        [],
      );

    const overview = {
      status_counts: Object.fromEntries(
        statusRes.rows.map((r: any) => [r.status, r.n])
      ),
      dept_breakdown: deptRes.rows,
      pending_by_approver: pendingRes.rows,
      recent_activity: recentRes.rows,
      settlement_overview: settleRes.rows[0] ?? { awaiting_approval: 0, awaiting_transfer: 0, completed: 0 },
    };

    redis.setex(CACHE_KEY, 120, JSON.stringify(overview)).catch(() => {});
    res.json(overview);
  } catch (err) {
    console.error('[dashboard] admin-overview failed:', err);
    res.status(500).json({ error: '管理者ダッシュボードの取得に失敗しました' });
  }
});

// ── GET /dashboard/pending-approvals — paginated, cursor-based ───────────────
// Used exclusively by the "View all" drawer on the personal dashboard.
// Summary endpoint already returns the first 5 (fast, cached) — this endpoint
// is only called when the user explicitly opens the full list.
// No Redis cache: the list is small and must always be fresh.
router.get('/pending-approvals', async (req: Request, res: Response): Promise<void> => {
  const userId     = req.user!.id;
  const role       = req.user!.role;
  const canApprove = isAdminUser(req.user) || APPROVER_ROLES.has(role);

  if (!canApprove) {
    res.json({ items: [], nextCursor: null });
    return;
  }

  const limit = Math.min(Number(req.query.limit) || 25, 50);

  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;

  if (req.query.cursor && typeof req.query.cursor === 'string') {
    try {
      const decoded = JSON.parse(
        Buffer.from(req.query.cursor, 'base64').toString('utf8'),
      ) as { ca: string; id: string };
      cursorCreatedAt = decoded.ca;
      cursorId = decoded.id;
    } catch { /* bad cursor → treat as first page */ }
  }

  try {
    // Keyset pagination on (created_at ASC, id ASC). No COUNT(*) OVER() —
    // total is already in the cached summary. Fetching limit+1 rows to detect
    // whether a next page exists without a separate COUNT query.
    const result = await query(
      `SELECT
         s.id, s.application_id, a.application_number,
         t.title_ja  AS template_name,
         t.code      AS template_code,
         u.full_name AS applicant_name,
         s.created_at
       FROM approval_steps s
       JOIN applications a   ON a.id = s.application_id
       JOIN form_templates t ON t.id = a.template_id
       JOIN users u          ON u.id = a.applicant_id
       WHERE s.approver_id = $1
         AND s.status = 'PENDING'
         AND a.archived_at IS NULL
         AND ($2::timestamptz IS NULL
              OR (s.created_at, s.id::text) > ($2::timestamptz, $3::text))
       ORDER BY s.created_at ASC, s.id ASC
       LIMIT $4`,
      [userId, cursorCreatedAt, cursorId ?? '', limit + 1],
    );

    const hasMore = result.rows.length > limit;
    const rows    = hasMore ? result.rows.slice(0, limit) : result.rows;

    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({
          ca: (rows[rows.length - 1] as any).created_at,
          id: (rows[rows.length - 1] as any).id,
        })).toString('base64')
      : null;

    res.json({
      items: rows.map((r: any) => ({
        id:                 r.id,
        application_id:     r.application_id,
        application_number: r.application_number,
        template_name:      r.template_name,
        template_code:      r.template_code,
        applicant_name:     r.applicant_name,
        created_at:         r.created_at,
      })),
      nextCursor,
    });
  } catch (err) {
    console.error('[dashboard] pending-approvals failed:', err);
    res.status(500).json({ error: '承認待ち一覧の取得に失敗しました' });
  }
});

export default router;
