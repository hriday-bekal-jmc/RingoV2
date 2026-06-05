import pg, { type QueryResult } from 'pg';
import fs from 'fs';
import { env } from './env';

const { Pool } = pg;

// Strict TLS in prod: validate server cert against CA bundle (e.g. AWS RDS
// combined CA) when PGSSLROOTCERT is set. rejectUnauthorized=true means
// MITM-resistant — never silently downgrade.
function buildSslConfig(): { rejectUnauthorized: boolean; ca?: string } | false {
  if (env.PGSSLMODE === 'disable') return false;
  if (env.NODE_ENV !== 'production') return false;
  const cfg: { rejectUnauthorized: boolean; ca?: string } = { rejectUnauthorized: true };
  if (env.PGSSLROOTCERT) cfg.ca = fs.readFileSync(env.PGSSLROOTCERT, 'utf8');
  return cfg;
}

// API pool — used by all user-facing request handlers
export const pool = new Pool({
  host:     env.PGHOST,
  port:     env.PGPORT,
  user:     env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
  min:      env.PG_POOL_MIN,
  max:      env.PG_POOL_MAX,
  idleTimeoutMillis:    30_000,
  connectionTimeoutMillis: 5_000,
  ssl: buildSslConfig(),
});

// Worker pool — separate low-limit pool for background jobs (CSV export, backups, etc.)
// Prevents background workers from starving the API pool under concurrent load.
// Hard cap of 3: enough for current worker concurrency (2) with one spare.
export const workerPool = new Pool({
  host:     env.PGHOST,
  port:     env.PGPORT,
  user:     env.PGUSER,
  password: env.PGPASSWORD,
  database: env.PGDATABASE,
  min:      1,
  max:      3,
  idleTimeoutMillis:    60_000,
  connectionTimeoutMillis: 10_000,
  ssl: buildSslConfig(),
});

pool.on('error',       (err: Error) => { console.error('[pg] pool error',        err); });
workerPool.on('error', (err: Error) => { console.error('[pg] workerPool error',  err); });

export async function warmPgPool(): Promise<void> {
  const count = Math.max(env.PG_POOL_MIN, 1);
  const clients = await Promise.all(
    Array.from({ length: count }, async () => {
      const client = await pool.connect();
      await client.query('SELECT 1');
      return client;
    }),
  );
  clients.forEach((client) => client.release());
}

const normalizeSql = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, 600);

export const query = async (
  text: string,
  params?: unknown[],
): Promise<QueryResult<any>> => {
  const start = Date.now();
  try {
    return await pool.query(text, params);
  } finally {
    const durationMs = Date.now() - start;
    if (durationMs >= env.SLOW_QUERY_MS) {
      console.warn(`[pg] slow query ${durationMs}ms ${normalizeSql(text)}`);
    }
  }
};

export const withTransaction = async <T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
