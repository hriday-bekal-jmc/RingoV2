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
  PGSSLMODE: z.enum(['disable', 'verify-full']).default('verify-full'),
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
  // Prefer GDRIVE_SERVICE_ACCOUNT_JSON (inline JSON string) over key file path.
  // Either one activates Drive integration.
  GDRIVE_SERVICE_ACCOUNT_JSON: z.string().optional(), // inline JSON key (preferred)
  GDRIVE_SERVICE_ACCOUNT_KEY:  z.string().optional(), // path to JSON key file (legacy)
  // Domain-wide delegation — service account impersonates this Workspace user
  // Requires DWD enabled in Google Admin Console for the service account.
  GDRIVE_IMPERSONATE_USER:      z.string().email().optional(),
  // Default / fallback folder — must be shared with service account email (or impersonated user)
  GDRIVE_FOLDER_ID:             z.string().optional(),
  // Per-category folders (all optional — fall back to GDRIVE_FOLDER_ID)
  GDRIVE_FOLDER_RECEIPTS:       z.string().optional(), // expense receipts / PDFs
  GDRIVE_FOLDER_INVOICES:       z.string().optional(), // vendor invoices / bills
  GDRIVE_FOLDER_TRANSPORTATION: z.string().optional(), // transport tickets / IC records
  GDRIVE_FOLDER_CONTRACTS:      z.string().optional(), // contracts / Word / Excel
  GDRIVE_FOLDER_OTHER:          z.string().optional(), // anything else

  // ── Gemini AI (OCR / auto-fill) ──
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL:   z.string().default('gemini-2.0-flash'),

  // ── Email (SMTP) — all optional; if absent, email notifications silently disabled ──
  SMTP_HOST:   z.string().optional(),
  SMTP_PORT:   z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.string().optional(), // 'true' for port 465 TLS (SMTPS); default STARTTLS
  SMTP_USER:   z.string().optional(),
  SMTP_PASS:   z.string().optional(),
  EMAIL_FROM:  z.string().optional(), // e.g. "RINGO <noreply@example.com>"

  // ── S3 Backup ──
  // All optional — backup is skipped when not configured.
  // Bucket should be write-only for the EC2 IAM role (no DeleteObject).
  BACKUP_S3_BUCKET:  z.string().optional(), // e.g. "ringo-backups"
  BACKUP_S3_REGION:  z.string().default('ap-northeast-1'),
  BACKUP_S3_PREFIX:  z.string().default('db'),  // key prefix inside bucket
  // Retention: backups older than this many days are deleted (default 30)
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  // Cron schedule — default 02:00 every day (server local time)
  BACKUP_CRON: z.string().default('0 2 * * *'),
  // Optional: encryption passphrase for AES-256 before upload (highly recommended)
  BACKUP_ENCRYPTION_KEY: z.string().min(16).optional(),
  // Optional: alert email on backup failure (uses SMTP config above)
  BACKUP_ALERT_EMAIL: z.string().email().optional(),

  // ── Misc ──
  SUPER_ADMIN_EMAIL: z.string().email().optional(),
  SUPER_ADMIN_EMAILS: z.string().optional(),
  SLOW_QUERY_MS: z.coerce.number().int().positive().default(50),
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

const superAdminEmails = [
  env.SUPER_ADMIN_EMAIL,
  ...(env.SUPER_ADMIN_EMAILS ?? '').split(','),
]
  .map((email) => email?.trim().toLowerCase())
  .filter((email): email is string => Boolean(email));

const invalidSuperAdminEmails = superAdminEmails.filter((email) => !z.string().email().safeParse(email).success);
if (invalidSuperAdminEmails.length > 0) {
  console.error(`[env] Invalid SUPER_ADMIN_EMAILS: ${invalidSuperAdminEmails.join(', ')}`);
  process.exit(1);
}

export const SUPER_ADMIN_EMAILS = new Set(superAdminEmails);

// Production hardening assertions
if (env.NODE_ENV === 'production') {
  if (env.PGSSLMODE === 'disable') {
    const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
    if (!localHosts.has(env.PGHOST)) {
      console.error('[env] PGSSLMODE=disable is only allowed for localhost PostgreSQL in production');
      process.exit(1);
    }
    console.warn('[env] WARNING: PostgreSQL TLS disabled for local loopback connection');
  } else if (!env.PGSSLROOTCERT) {
    console.warn('[env] WARNING: PGSSLROOTCERT not set — Postgres TLS will use system CAs only');
  } else if (!fs.existsSync(env.PGSSLROOTCERT)) {
    console.error(`[env] PGSSLROOTCERT path does not exist: ${env.PGSSLROOTCERT}`);
    process.exit(1);
  }
  if (!env.GOOGLE_WORKSPACE_DOMAIN) {
    console.warn('[env] WARNING: GOOGLE_WORKSPACE_DOMAIN not set — OAuth allows ANY Google account');
  }
}
