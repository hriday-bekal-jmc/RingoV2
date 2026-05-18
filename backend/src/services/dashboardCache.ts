/**
 * Dashboard cache invalidation helper.
 *
 * The /dashboard/summary endpoint caches per-user in Redis to avoid
 * hammering Postgres on every page load. The cache is safe because SSE
 * events tell the frontend to refetch — BUT only if the backend also
 * purges the Redis cache at the same time. Without this, the refetch just
 * gets the stale cached value back (up to 60s stale).
 *
 * Call invalidateDashboardCache(recipients) inside any route that changes
 * application status, alongside the insertOutboxEvent call.
 *
 * Fire-and-forget: a Redis failure here just means one extra DB hit on the
 * next request. Don't await in hot paths.
 */
import { redis } from '../config/redis';

const summaryKey = (uid: string) => `dashboard:summary:${uid}`;
const OVERVIEW_KEY = 'dashboard:admin-overview';

/**
 * Bust per-user summary caches + global admin overview.
 * Pass the full recipients array from computeApplicationRecipients so
 * both the applicant's and approvers' dashboards refresh immediately.
 */
export function invalidateDashboardCache(userIds: string[]): void {
  if (userIds.length === 0) return;
  const keys = [...userIds.map(summaryKey), OVERVIEW_KEY];
  redis.del(...keys).catch(() => {
    // Non-fatal — natural TTL will expire the cache within 60s
  });
}
