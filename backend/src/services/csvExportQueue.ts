// CSV export queue. The API process enqueues jobs here; the worker process
// (src/workers/csvExportWorker.ts) consumes them.
//
// Architecture:
//   API request → addCsvExportJob() → BullMQ queue (Redis-backed)
//   Worker     → reads job, streams DB rows via pg-cursor, writes to file,
//                writes job metadata to Redis hash, signals completion.
//   API GET /:jobId → reads metadata from Redis, returns status to client.
//   API GET /:jobId/download → ownership check, streams file, optional cleanup.
//
// Why BullMQ + a separate worker process:
//   - CSV exports of 5k+ rows would block the API event loop and OOM.
//   - Worker can run on the same EC2 (separate PM2 process) or on its own box.
//   - Job retention + retry semantics for free.

import { Queue } from 'bullmq';
import { redis, bullConnection } from '../config/redis';

export const CSV_EXPORT_QUEUE_NAME = 'csv-export';

// Single shared Queue instance — ONLY for enqueueing. Workers are separate.
export const csvExportQueue = new Queue(CSV_EXPORT_QUEUE_NAME, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 2,                                    // 1 retry on failure
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 3600, count: 1000 },   // 1h TTL on completed
    removeOnFail:     { age: 86400 },               // 24h TTL on failed (debugging)
  },
});

// ── Job payload ──────────────────────────────────────────────────────────────
export interface CsvExportPayload {
  /** User who requested the export — used for ownership check on download. */
  userId: string;
  /** Specific settlement UUIDs to export (partial/manual selection). */
  ids?: string[];
  /** Export all records matching date range — ignores `ids`. */
  selectAll?: boolean;
  /** ISO date YYYY-MM-DD — inclusive lower bound on settlement/created date. */
  dateFrom?: string;
  /** ISO date YYYY-MM-DD — inclusive upper bound. */
  dateTo?: string;
}

// ── Job metadata (stored in Redis hash for status polling) ───────────────────
//
// Why a separate Redis hash instead of just BullMQ's job state?
//   - BullMQ keeps job state but its "completed" payload is opaque to client.
//   - We want a clean shape: { status, filename, error?, createdAt }.
//   - Easy ownership check w/o loading full BullMQ job.
//
// Key: csv-export-meta:<jobId>
// TTL: 1 hour (matches BullMQ removeOnComplete.age)

export type CsvExportStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface CsvExportMeta {
  status:    CsvExportStatus;
  userId:    string;
  filename?: string;
  error?:    string;
  rowCount?: number;
  createdAt: number;
  finishedAt?: number;
}

const META_KEY = (jobId: string) => `csv-export-meta:${jobId}`;
const META_TTL = 3600; // 1 hour

export async function setCsvExportMeta(jobId: string, meta: Partial<CsvExportMeta>): Promise<void> {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined) flat[k] = String(v);
  }
  if (Object.keys(flat).length === 0) return;
  await redis.hset(META_KEY(jobId), flat);
  await redis.expire(META_KEY(jobId), META_TTL);
}

export async function getCsvExportMeta(jobId: string): Promise<CsvExportMeta | null> {
  const raw = await redis.hgetall(META_KEY(jobId));
  if (!raw || Object.keys(raw).length === 0) return null;
  return {
    status:     raw.status as CsvExportStatus,
    userId:     raw.userId,
    filename:   raw.filename || undefined,
    error:      raw.error    || undefined,
    rowCount:   raw.rowCount ? Number(raw.rowCount) : undefined,
    createdAt:  Number(raw.createdAt),
    finishedAt: raw.finishedAt ? Number(raw.finishedAt) : undefined,
  };
}

// ── Enqueue helper ───────────────────────────────────────────────────────────
export async function addCsvExportJob(payload: CsvExportPayload): Promise<string> {
  const job = await csvExportQueue.add('export', payload);
  if (!job.id) throw new Error('BullMQ returned no job id');

  await setCsvExportMeta(job.id, {
    status:    'queued',
    userId:    payload.userId,
    createdAt: Date.now(),
  });

  return job.id;
}
