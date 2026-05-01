import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../src/config/db';

const migrationsDir = path.join(__dirname, '..', 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getApplied(): Promise<Set<string>> {
  const { rows } = await pool.query('SELECT id FROM schema_migrations');
  return new Set(rows.map((r: { id: string }) => r.id));
}

async function run(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await getApplied();
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[skip] ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`[apply] ${file}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[done]  ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[fail]  ${file}:`, (err as Error).message);
      process.exit(1);
    } finally {
      client.release();
    }
  }
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
