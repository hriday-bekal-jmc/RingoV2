// CSV export worker. Runs as a SEPARATE process from the API.
//
// Start in dev:    npm run worker:csv     (tsx watch)
// Start in prod:   pm2 start dist/workers/csvExportWorker.js --name ringo-worker
//
// Responsibilities:
//   1. Pull job from BullMQ queue
//   2. Stream settlement rows from Postgres via pg-cursor (no full-result buffer)
//   3. Write CSV to backend/exports/<jobId>.csv as rows arrive
//   4. Update Redis metadata so API can report status to user
//   5. Retry once on transient failure (BullMQ default)
//
// Why streaming + cursor:
//   - 10k-row export buffered in memory + concatenated into a string can OOM
//     a small Node process. Cursor reads N rows at a time.
//   - File write is append-only — RAM stays bounded regardless of result size.

// Boot env first — fail-fast if config malformed
import '../config/env';

import { Worker, Job } from 'bullmq';
import fs from 'fs';
import path from 'path';
import Cursor from 'pg-cursor';
import { workerPool as pool } from '../config/db';
import { bullConnection } from '../config/redis';
import {
  CSV_EXPORT_QUEUE_NAME,
  CsvExportPayload,
  setCsvExportMeta,
} from '../services/csvExportQueue';
import { withTransaction } from '../config/db';
import { insertOutboxEvent } from '../services/eventOutbox';

// ── Output directory ─────────────────────────────────────────────────────────
const EXPORTS_DIR = path.join(__dirname, '../../exports');
fs.mkdirSync(EXPORTS_DIR, { recursive: true });

// ── CSV helpers ──────────────────────────────────────────────────────────────
const HEADERS = [
  '申請番号', '申請者', '部署', '申請種別',
  '概算金額（円）', '実費合計（円）',
  '振込日', '備考', 'ステータス', '作成日',
];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  const s = String(v).replace(/"/g, '""');
  return `"${s}"`;
}

function rowToCsvLine(r: Record<string, unknown>): string {
  return [
    csvEscape(r.application_number),
    csvEscape(r.applicant),
    csvEscape(r.department),
    csvEscape(r.form_type),
    r.expected_amount ?? 0,
    r.actual_amount   ?? 0,
    r.transfer_date ? new Date(r.transfer_date as string).toLocaleDateString('ja-JP') : '',
    csvEscape(r.accounting_note),
    csvEscape(r.settlement_status),
    new Date(r.created_at as string).toLocaleDateString('ja-JP'),
  ].join(',');
}

// ── Cursor-based row streaming ───────────────────────────────────────────────
const BATCH_SIZE = 500;

interface CursorClient {
  read: (n: number, cb: (err: Error | null, rows: Record<string, unknown>[]) => void) => void;
  close: (cb?: () => void) => void;
}

async function readBatch(cursor: CursorClient): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    cursor.read(BATCH_SIZE, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// ── Job processor ────────────────────────────────────────────────────────────
async function processCsvExport(job: Job<CsvExportPayload>): Promise<{ filename: string; rowCount: number }> {
  const jobId = job.id!;
  const { userId, ids, selectAll, dateFrom, dateTo } = job.data;

  await setCsvExportMeta(jobId, { status: 'processing' });

  const filename = `settlements_${jobId}.csv`;
  const filepath = path.join(EXPORTS_DIR, filename);

  // Acquire a dedicated client so we can use pg-cursor (pool.query won't work).
  const client = await pool.connect();
  let rowCount = 0;
  let writeStream: fs.WriteStream | null = null;

  try {
    // BOM + header so Excel opens it as UTF-8 with proper columns
    writeStream = fs.createWriteStream(filepath, { encoding: 'utf8' });
    writeStream.write('﻿');
    writeStream.write(HEADERS.join(',') + '\r\n');

    // Build query — same shape as the old sync route, just no LIMIT
    let sql: string;
    let params: unknown[];

    const SELECT_COLS = `
        SELECT
          a.application_number,
          u.full_name AS applicant,
          d.name      AS department,
          ft.title_ja AS form_type,
          s.expected_amount,
          s.actual_amount,
          s.transfer_date,
          s.accounting_note,
          s.status    AS settlement_status,
          s.created_at
        FROM settlements s
        JOIN applications a    ON a.id = s.application_id
        JOIN form_templates ft ON ft.id = a.template_id
        JOIN users u           ON u.id = a.applicant_id
        LEFT JOIN departments d ON d.id = u.department_id`;

    if (ids && ids.length > 0) {
      // Specific IDs — manual row selection
      sql    = `${SELECT_COLS} WHERE s.id = ANY($1::uuid[]) ORDER BY s.created_at DESC`;
      params = [ids];
    } else if (selectAll && (dateFrom || dateTo)) {
      // "Select all in period" — date-filtered export (no specific IDs)
      // Only export accounting-ready rows: SETTLEMENT_APPROVED or COMPLETED.
      // Filter matches the display date shown in the UI: settlement_submitted_at ?? s.created_at
      sql = `${SELECT_COLS}
        WHERE ($1::date IS NULL OR COALESCE(a.settlement_submitted_at, s.created_at)::date >= $1::date)
          AND ($2::date IS NULL OR COALESCE(a.settlement_submitted_at, s.created_at)::date <= $2::date)
          AND a.status IN ('SETTLEMENT_APPROVED', 'COMPLETED')
          AND a.archived_at IS NULL
        ORDER BY s.created_at DESC`;
      params = [dateFrom ?? null, dateTo ?? null];
    } else {
      // No filter — export all accounting-ready settlements (SETTLEMENT_APPROVED or COMPLETED).
      // Excludes PENDING_SETTLEMENT — approval not yet complete, not accounting's concern.
      sql    = `${SELECT_COLS} WHERE a.status IN ('SETTLEMENT_APPROVED', 'COMPLETED') AND a.archived_at IS NULL ORDER BY s.created_at DESC`;
      params = [];
    }

    const cursor = client.query(new Cursor(sql, params)) as unknown as CursorClient;

    // Read until empty
    while (true) {
      const rows = await readBatch(cursor);
      if (rows.length === 0) break;
      for (const r of rows) {
        writeStream.write(rowToCsvLine(r) + '\r\n');
        rowCount++;
      }
      // Periodically update progress for long jobs
      if (rowCount % (BATCH_SIZE * 10) === 0) {
        await job.updateProgress(rowCount);
      }
    }

    await new Promise<void>((resolve, reject) => {
      cursor.close((err?: unknown) => err ? reject(err as Error) : resolve());
    });

    await new Promise<void>((resolve, reject) => {
      writeStream!.end((err?: unknown) => err ? reject(err as Error) : resolve());
    });
  } catch (err) {
    // Best-effort cleanup of partial file
    if (writeStream) writeStream.destroy();
    fs.promises.unlink(filepath).catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await setCsvExportMeta(jobId, {
    status:     'ready',
    filename,
    rowCount,
    finishedAt: Date.now(),
  });

  // Notify requesting user via outbox → SSE.
  // Outbox publisher worker picks this up + fans out to all API instances.
  try {
    await withTransaction(async (client) => {
      await insertOutboxEvent(client, {
        event_type:         'CSV_EXPORT_READY',
        entity_type:        'csv_export',
        entity_id:          null,
        recipient_user_ids: [userId],
        payload:            { jobId, filename, rowCount },
      });
    });
  } catch (err) {
    // Don't fail the job over a missed event — the user can poll status as fallback
    console.error('[csv-worker] outbox emit failed for job', jobId, err);
  }

  return { filename, rowCount };
}

// ── Worker bootstrap ─────────────────────────────────────────────────────────
const worker = new Worker<CsvExportPayload>(
  CSV_EXPORT_QUEUE_NAME,
  processCsvExport,
  {
    connection:  bullConnection,
    concurrency: 2,           // tune up if exports are common; CSV is I/O-bound
  },
);

worker.on('completed', (job) => {
  console.log(`[csv-worker] job ${job.id} completed (${job.returnvalue?.rowCount ?? '?'} rows)`);
});

worker.on('failed', async (job, err) => {
  if (!job) return;
  console.error(`[csv-worker] job ${job.id} failed:`, err.message);
  // Mark ready=false so API can return error to user
  await setCsvExportMeta(job.id!, {
    status:     'failed',
    error:      err.message,
    finishedAt: Date.now(),
  });
});

worker.on('error', (err) => {
  console.error('[csv-worker] worker error', err);
});

console.log('[csv-worker] running');

// ── Graceful shutdown ────────────────────────────────────────────────────────
const shutdown = async (signal: string): Promise<void> => {
  console.log(`[csv-worker] ${signal} received, draining`);
  await worker.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
