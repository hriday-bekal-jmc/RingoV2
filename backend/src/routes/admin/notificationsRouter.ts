import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { pool } from '../../config/db';
import { invalidateNotificationCache } from '../../services/notificationCache';

const router = Router();

const VALID_EVENT_TYPES = new Set([
  'APP_SUBMITTED', 'APP_APPROVED', 'APP_RETURNED', 'APP_REJECTED',
  'SETTLEMENT_SUBMITTED', 'SETTLEMENT_APPROVED', 'STEP_ACTION_REQUIRED',
  'SETTLEMENT_AMOUNT_ADJUSTED',
]);

const NOTIFY_VARS_PATH = path.resolve(__dirname, '../../../../frontend/src/config/notificationVars.overrides.json');

// ─── Notification Templates ───────────────────────────────────────────────────

router.get('/notification-templates', async (_req: Request, res: Response): Promise<void> => {
  try {
    const r = await pool.query(
      `SELECT event_type, subject, body_html, is_active, updated_at
       FROM notification_templates ORDER BY event_type`,
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[admin] notification-templates fetch failed:', err);
    res.status(500).json({ error: 'テンプレートの取得に失敗しました' });
  }
});

router.patch('/notification-templates/:eventType', async (req: Request, res: Response): Promise<void> => {
  const eventType = String(req.params.eventType);
  if (!VALID_EVENT_TYPES.has(eventType)) {
    res.status(400).json({ error: '無効なイベントタイプです' });
    return;
  }

  const { subject, body_html, is_active } = req.body as {
    subject?: string; body_html?: string; is_active?: boolean;
  };

  if (subject !== undefined && typeof subject !== 'string') {
    res.status(400).json({ error: 'subject must be a string' }); return;
  }
  if (body_html !== undefined && typeof body_html !== 'string') {
    res.status(400).json({ error: 'body_html must be a string' }); return;
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    res.status(400).json({ error: 'is_active must be a boolean' }); return;
  }

  try {
    const r = await pool.query(
      `INSERT INTO notification_templates (event_type, subject, body_html, is_active, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (event_type) DO UPDATE
         SET subject    = COALESCE($2, notification_templates.subject),
             body_html  = COALESCE($3, notification_templates.body_html),
             is_active  = COALESCE($4, notification_templates.is_active),
             updated_at = NOW()
       RETURNING event_type, subject, body_html, is_active, updated_at`,
      [eventType, subject ?? null, body_html ?? null, is_active ?? null],
    );

    invalidateNotificationCache(eventType);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[admin] notification-template update failed:', err);
    res.status(500).json({ error: 'テンプレートの更新に失敗しました' });
  }
});

// ─── Notify var defs ──────────────────────────────────────────────────────────

router.get('/notify-var-defs', async (_req: Request, res: Response) => {
  try {
    const raw = await fs.readFile(NOTIFY_VARS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { vars?: unknown[] };
    res.json({ vars: Array.isArray(parsed.vars) ? parsed.vars : [] });
  } catch {
    res.json({ vars: [] }); // file missing → empty overrides, frontend uses hardcoded
  }
});

export default router;
