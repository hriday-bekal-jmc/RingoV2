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

const CACHE_TTL_SEC = 30;
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
    // Parallel queries via Promise.all — all read-only, safe
    const [countsRes, recentRes, pendingRes] = await Promise.all([
      // 1. Status counts via GROUP BY (one row per status)
      query(
        `SELECT status, COUNT(*)::text AS n
         FROM applications
         WHERE applicant_id = $1
         GROUP BY status`,
        [userId],
      ),

      // 2. Recent 5 with template join + step counts in one query
      query(
        `SELECT
           a.id, a.application_number, a.status, a.created_at, a.submitted_at,
           t.title_ja AS template_name, t.code AS template_code,
           t.settlement_schema IS NOT NULL AS has_settlement,
           COALESCE(
             (SELECT s.step_order FROM approval_steps s
              WHERE s.application_id = a.id AND s.stage = 'SETTLEMENT' AND s.status = 'PENDING'
              LIMIT 1),
             (SELECT s.step_order FROM approval_steps s
              WHERE s.application_id = a.id AND s.stage = 'RINGI' AND s.status = 'PENDING'
              LIMIT 1)
           ) AS current_step,
           (SELECT COUNT(*) FROM approval_steps s
            WHERE s.application_id = a.id AND s.stage = 'RINGI') AS total_steps
         FROM applications a
         JOIN form_templates t ON a.template_id = t.id
         WHERE a.applicant_id = $1
         ORDER BY a.created_at DESC
         LIMIT 5`,
        [userId],
      ),

      // 3. Pending approvals — only for approvers
      canApprove
        ? query(
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
             WHERE s.approver_id = $1 AND s.status = 'PENDING'
             ORDER BY s.created_at ASC
             LIMIT 5`,
            [userId],
          )
        : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
    ]);

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

export default router;
