import pg, { type QueryResult } from 'pg';
import fs from 'fs';
import { env } from './env';

const { Pool } = pg;

// Strict TLS in prod: validate server cert against CA bundle (e.g. AWS RDS
// combined CA) when PGSSLROOTCERT is set. rejectUnauthorized=true means
// MITM-resistant — never silently downgrade.
function buildSslConfig(): { rejectUnauthorized: boolean; ca?: string } | false {
  if (env.NODE_ENV !== 'production') return false;
  const cfg: { rejectUnauthorized: boolean; ca?: string } = { rejectUnauthorized: true };
  if (env.PGSSLROOTCERT) cfg.ca = fs.readFileSync(env.PGSSLROOTCERT, 'utf8');
  return cfg;
}

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

pool.on('error', (err: Error) => {
  console.error('[pg] unexpected pool error', err);
});

export const query = (
  text: string,
  params?: unknown[],
): Promise<QueryResult<any>> => pool.query(text, params);

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
