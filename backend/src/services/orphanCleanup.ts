// Orphan file cleanup — runs every hour.
// Deletes uploaded_files rows where application_id IS NULL and the file is
// older than 24 hours. These are abandoned draft uploads (user closed the form
// without submitting, or removed a file from the UI but the DELETE /files/:id
// call was missed, e.g. a network error).
//
// Physical files are deleted before the DB row to avoid ghost rows pointing at
// missing files. Drive deletes are best-effort; local FS deletes are silent on
// ENOENT (file already gone is fine).

import path from 'path';
import fs from 'fs';
import { query } from '../config/db';
import { isDriveEnabled, deleteFromDrive } from './driveService';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const ORPHAN_AGE_HOURS = 24;
const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

async function runOrphanCleanup(): Promise<void> {
  try {
    const r = await query(
      `SELECT id, stored_path, drive_file_id
       FROM uploaded_files
       WHERE application_id IS NULL
         AND created_at < NOW() - INTERVAL '${ORPHAN_AGE_HOURS} hours'`,
      [],
    );

    if (r.rows.length === 0) return;

    const rows = r.rows as { id: string; stored_path: string; drive_file_id: string | null }[];

    await Promise.all(
      rows.map(async (f) => {
        // Delete physical file first
        if (f.drive_file_id && isDriveEnabled()) {
          try { await deleteFromDrive(f.drive_file_id); } catch { /* already gone */ }
        } else if (f.stored_path && !f.stored_path.startsWith('drive:')) {
          const abs = path.join(UPLOADS_DIR, f.stored_path);
          try { fs.unlinkSync(abs); } catch { /* ENOENT — already gone, fine */ }
        }
      }),
    );

    const ids = rows.map((f) => f.id);
    await query(
      `DELETE FROM uploaded_files WHERE id = ANY($1::uuid[])`,
      [ids],
    );

    console.log(`[orphan-cleanup] removed ${ids.length} orphaned file(s)`);
  } catch (err) {
    console.error('[orphan-cleanup] failed:', err);
  }
}

export function scheduleOrphanCleanup(): void {
  // Run once shortly after startup, then every hour.
  setTimeout(() => void runOrphanCleanup(), 5 * 60 * 1000);
  setInterval(() => void runOrphanCleanup(), INTERVAL_MS).unref();
}
