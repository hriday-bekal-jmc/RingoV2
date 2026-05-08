// Centralized env validation. Boot fails fast w/ clear message when
// required vars missing or malformed. Import this once in server.ts before
// any other module reads process.env.

import dotenv from 'dotenv';
import { z } from 'zod';
import fs from 'fs';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT:     z.coerce.number().int().positive().default(3000),

  // ── Postgres ──
  PGHOST:     z.string().min(1),
  PGPORT:     z.coerce.number().int().positive().default(5432),
  PGUSER:     z.string().min(1),
  PGPASSWORD: z.string().min(1),
  PGDATABASE: z.string().min(1),
  PG_POOL_MIN: z.coerce.number().int().nonnegative().default(2),
  PG_POOL_MAX: z.coerce.number().int().positive().default(20),
  // Path to CA bundle (e.g. RDS combined CA). Required in production.
  PGSSLROOTCERT: z.string().optional(),

  // ── Redis ──
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // ── JWT ──
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be ≥32 chars'),

  // ── CORS / Origin ──
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),

  // ── Google OAuth ──
  GOOGLE_CLIENT_ID:     z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL:  z.string().url().optional(),
  // Workspace domain enforcement — only these domains may complete OAuth
  GOOGLE_WORKSPACE_DOMAIN: z.string().optional(),

  // ── Google Drive (service account) ──
  GDRIVE_SERVICE_ACCOUNT_KEY: z.string().optional(), // path to JSON
  GDRIVE_FOLDER_ID:           z.string().optional(),

  // ── Misc ──
  SUPER_ADMIN_EMAIL: z.string().email().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('[env] Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

// Production hardening assertions
if (env.NODE_ENV === 'production') {
  if (!env.PGSSLROOTCERT) {
    console.warn('[env] WARNING: PGSSLROOTCERT not set — Postgres TLS will use system CAs only');
  } else if (!fs.existsSync(env.PGSSLROOTCERT)) {
    console.error(`[env] PGSSLROOTCERT path does not exist: ${env.PGSSLROOTCERT}`);
    process.exit(1);
  }
  if (!env.GOOGLE_WORKSPACE_DOMAIN) {
    console.warn('[env] WARNING: GOOGLE_WORKSPACE_DOMAIN not set — OAuth allows ANY Google account');
  }
}
