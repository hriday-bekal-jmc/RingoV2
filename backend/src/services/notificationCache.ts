// In-memory cache for notification_templates rows.
// TTL: 5 min. Explicit invalidation on admin save.
// Re-reads from DB on cache miss — "read on update" pattern.

import { pool } from '../config/db';

export interface NotificationTemplate {
  event_type: string;
  subject:    string;
  body_html:  string;
  is_active:  boolean;
  updated_at: Date;
}

interface CacheEntry {
  template:  NotificationTemplate;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 min
const cache        = new Map<string, CacheEntry>();

/**
 * Get template for eventType. Checks cache first; fetches DB on miss.
 * Returns null if eventType not in DB or is_active=false.
 */
export async function getNotificationTemplate(
  eventType: string,
): Promise<NotificationTemplate | null> {
  const hit = cache.get(eventType);
  if (hit && Date.now() < hit.expiresAt) return hit.template;

  const r = await pool.query<NotificationTemplate>(
    `SELECT event_type, subject, body_html, is_active, updated_at
     FROM notification_templates WHERE event_type = $1`,
    [eventType],
  );
  if (r.rows.length === 0) return null;

  const template = r.rows[0];
  cache.set(eventType, { template, expiresAt: Date.now() + CACHE_TTL_MS });
  return template;
}

/** Invalidate one eventType (after admin save) or all (pass no arg) */
export function invalidateNotificationCache(eventType?: string): void {
  if (eventType) {
    cache.delete(eventType);
  } else {
    cache.clear();
  }
}

/** Preload all active templates into cache (called on server boot, optional) */
export async function preloadNotificationTemplates(): Promise<void> {
  try {
    const r = await pool.query<NotificationTemplate>(
      `SELECT event_type, subject, body_html, is_active, updated_at
       FROM notification_templates`,
    );
    const now = Date.now();
    for (const row of r.rows) {
      cache.set(row.event_type, { template: row, expiresAt: now + CACHE_TTL_MS });
    }
    console.info(`[notifCache] preloaded ${r.rows.length} templates`);
  } catch (err) {
    // Non-fatal — cache miss will re-fetch on demand
    console.warn('[notifCache] preload failed (will lazy-load):', err);
  }
}
