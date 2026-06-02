/**
 * Database backup service.
 *
 * Flow:
 *   1. pg_dump (plain SQL) piped through gzip compression
 *   2. Optionally encrypted with AES-256-CBC (openssl) if BACKUP_ENCRYPTION_KEY set
 *   3. Uploaded to S3 with key: {prefix}/{YYYY-MM-DD}/ringo_{timestamp}.sql.gz[.enc]
 *   4. Old backups (older than BACKUP_RETENTION_DAYS) deleted from S3
 *
 * Auth: EC2 IAM role (no keys in code). Falls back to env credentials for local dev.
 * Requires: @aws-sdk/client-s3  (install: npm i @aws-sdk/client-s3)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import { env } from '../config/env';

const execAsync = promisify(exec);

// ── S3 client (uses EC2 IAM role automatically in production) ────────────────
function buildS3Client(): S3Client {
  return new S3Client({ region: env.BACKUP_S3_REGION });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayPrefix(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function backupFilename(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const ext = env.BACKUP_ENCRYPTION_KEY ? '.sql.gz.enc' : '.sql.gz';
  return `ringo_${ts}${ext}`;
}

/** Encrypt a file with AES-256-CBC using the configured key. Returns encrypted file path. */
async function encryptFile(inputPath: string, outputPath: string): Promise<void> {
  const key = env.BACKUP_ENCRYPTION_KEY!;
  // Derive 32-byte key + 16-byte IV from passphrase using SHA-256
  const keyBuf = crypto.createHash('sha256').update(key).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuf, iv);
  const input = createReadStream(inputPath);
  const output = createWriteStream(outputPath);

  // Prepend IV so it can be recovered on decrypt
  output.write(iv);
  await pipeline(input, cipher, output);
}

/** pg_dump → gzip → temp file */
async function dumpDatabase(tempPath: string): Promise<void> {
  const pgEnv = {
    ...process.env,
    PGPASSWORD: env.PGPASSWORD,
  };

  const connArgs = [
    `-h ${env.PGHOST}`,
    `-p ${env.PGPORT}`,
    `-U ${env.PGUSER}`,
    env.PGDATABASE,
  ].join(' ');

  // Dump to a raw .sql temp file
  const rawPath = tempPath.replace(/\.gz.*$/, '.sql');
  await execAsync(`pg_dump --no-password ${connArgs} -f ${rawPath}`, { env: pgEnv });

  // Gzip the dump
  await pipeline(
    createReadStream(rawPath),
    createGzip({ level: 9 }),
    createWriteStream(tempPath),
  );

  // Remove raw SQL file
  fs.unlinkSync(rawPath);
}

/** Upload file to S3 */
async function uploadToS3(localPath: string, s3Key: string): Promise<void> {
  const client = buildS3Client();
  const body = fs.createReadStream(localPath);
  await client.send(new PutObjectCommand({
    Bucket: env.BACKUP_S3_BUCKET!,
    Key:    s3Key,
    Body:   body,
    ContentType: 'application/octet-stream',
    // Server-side encryption on top of optional client-side encryption
    ServerSideEncryption: 'AES256',
    StorageClass: 'STANDARD_IA', // cheaper for infrequent-access backups
    Metadata: {
      'backup-date':     todayPrefix(),
      'pg-database':     env.PGDATABASE,
      'encrypted':       env.BACKUP_ENCRYPTION_KEY ? 'true' : 'false',
    },
  }));
}

/** Delete backups older than BACKUP_RETENTION_DAYS */
async function pruneOldBackups(): Promise<number> {
  const client = buildS3Client();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - env.BACKUP_RETENTION_DAYS);

  const list = await client.send(new ListObjectsV2Command({
    Bucket: env.BACKUP_S3_BUCKET!,
    Prefix: `${env.BACKUP_S3_PREFIX}/`,
  }));

  const toDelete = (list.Contents ?? []).filter(obj => {
    const d = obj.LastModified;
    return d && d < cutoff;
  });

  if (toDelete.length === 0) return 0;

  await client.send(new DeleteObjectsCommand({
    Bucket: env.BACKUP_S3_BUCKET!,
    Delete: { Objects: toDelete.map(o => ({ Key: o.Key! })) },
  }));

  return toDelete.length;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface BackupResult {
  success: boolean;
  s3Key?:  string;
  sizeBytes?: number;
  pruned?: number;
  error?:  string;
  durationMs: number;
}

export async function runBackup(): Promise<BackupResult> {
  if (!env.BACKUP_S3_BUCKET) {
    return { success: false, error: 'BACKUP_S3_BUCKET not configured — skipping', durationMs: 0 };
  }

  const start = Date.now();
  const tmpDir = os.tmpdir();
  const filename = backupFilename();
  const gzPath  = path.join(tmpDir, filename.replace(/\.enc$/, ''));
  const encPath  = path.join(tmpDir, filename);
  const finalPath = env.BACKUP_ENCRYPTION_KEY ? encPath : gzPath;

  try {
    // 1. Dump + compress
    console.log('[backup] Starting pg_dump…');
    await dumpDatabase(gzPath);

    // 2. Optionally encrypt
    if (env.BACKUP_ENCRYPTION_KEY) {
      console.log('[backup] Encrypting dump…');
      await encryptFile(gzPath, encPath);
      fs.unlinkSync(gzPath);
    }

    const sizeBytes = fs.statSync(finalPath).size;
    const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);

    // 3. Upload
    const s3Key = `${env.BACKUP_S3_PREFIX}/${todayPrefix()}/${filename}`;
    console.log(`[backup] Uploading ${sizeMB} MB → s3://${env.BACKUP_S3_BUCKET}/${s3Key}`);
    await uploadToS3(finalPath, s3Key);

    // 4. Prune old backups
    const pruned = await pruneOldBackups();
    if (pruned > 0) console.log(`[backup] Pruned ${pruned} old backup(s)`);

    const durationMs = Date.now() - start;
    console.log(`[backup] Done in ${(durationMs / 1000).toFixed(1)}s`);
    return { success: true, s3Key, sizeBytes, pruned, durationMs };
  } catch (err: unknown) {
    const error = (err as Error).message ?? String(err);
    console.error('[backup] FAILED:', error);
    return { success: false, error, durationMs: Date.now() - start };
  } finally {
    // Always clean up temp files
    for (const p of [gzPath, encPath]) {
      if (fs.existsSync(p)) try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  }
}

/**
 * Decrypt a backup file (for restore).
 * Usage: node -e "require('./backupService').decryptBackup('in.sql.gz.enc', 'out.sql.gz')"
 */
export async function decryptBackup(inputPath: string, outputPath: string, passphrase?: string): Promise<void> {
  const key = passphrase ?? env.BACKUP_ENCRYPTION_KEY;
  if (!key) throw new Error('No encryption key provided');

  const keyBuf = crypto.createHash('sha256').update(key).digest();
  const input = createReadStream(inputPath);
  const output = createWriteStream(outputPath);

  // Read IV from first 16 bytes
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(chunk as Buffer);
    if (Buffer.concat(chunks).length >= 16) break;
  }
  const all = Buffer.concat(chunks);
  const iv = all.subarray(0, 16);
  const rest = all.subarray(16);

  const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuf, iv);
  output.write(decipher.update(rest));

  await pipeline(
    createReadStream(inputPath, { start: 16 }),
    decipher,
    output,
  );
}
