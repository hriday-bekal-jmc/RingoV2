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
import { redis } from '../config/redis';
import { requireAuth } from '../middlewares/authMiddleware';

// Roles that may have pending approvals assigned. Backend role-gates the
// pending query so non-approver users don't pay for an empty join.
const APPROVER_ROLES = new Set(['MANAGER', 'GM', 'SOUMU', 'SENMU', 'PRESIDENT', 'ACCOUNTING', 'ADMIN']);

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
  const canApprove = APPROVER_ROLES.has(role);

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
           t.title_ja AS template_name, t.code AS template_code,
           t.settlement_schema IS NOT NULL AS has_settlement,
           (
             SELECT pos FROM (
               SELECT status,
                 ROW_NUMBER() OVER (ORDER BY step_order) AS pos
               FROM approval_steps
               WHERE application_id = a.id
                 AND stage = CASE
                   WHEN a.status IN ('PENDING_SETTLEMENT','SETTLEMENT_APPROVED') THEN 'SETTLEMENT'
                   ELSE 'RINGI'
                 END
             ) ranked
             WHERE status = 'PENDING'
             LIMIT 1
           ) AS current_step,
           (SELECT COUNT(*) FROM approval_steps s
            WHERE s.application_id = a.id
              AND s.stage = CASE
                WHEN a.status IN ('PENDING_SETTLEMENT','SETTLEMENT_APPROVED') THEN 'SETTLEMENT'
                ELSE 'RINGI'
              END
           ) AS total_steps
         FROM applications a
         JOIN form_templates t ON a.template_id = t.id
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
               t.title_ja AS template_name,
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
        template_code:      r.template_code,
        has_settlement:     r.has_settlement,
        current_step:       r.current_step !== null ? Number(r.current_step) : null,
        total_steps:        Number(r.total_steps),
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
  if (req.user!.role !== 'ADMIN') {
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

export default router;
