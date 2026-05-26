// Weekly Drive audit job.
//
// Compares all drive_file_ids the DB knows about against what actually exists
// in the configured Drive folder(s). Files in Drive that have no DB record are
// orphans — deleted from Drive to reclaim space.
//
// Common orphan causes:
//   • Application hard-deleted before this fix landed (old leak)
//   • Drive API error during deleteFromDrive left the physical file
//   • Direct Drive manipulation outside the app
//
// Schedule: first run 2 h after startup (orphan-cleanup runs first at 5 min),
//           then every 7 days.

import { query } from '../config/db';
import { isDriveEnabled, deleteFromDrive, listDriveOrphans } from './driveService';

const INITIAL_DELAY_MS = 2 * 60 * 60 * 1000;   // 2 hours
const INTERVAL_MS      = 7 * 24 * 60 * 60 * 1000; // 7 days

async function runDriveAudit(): Promise<void> {
  if (!isDriveEnabled()) return;

  try {
    console.log('[drive-audit] starting weekly audit…');

    const r = await query(
      `SELECT drive_file_id FROM uploaded_files WHERE drive_file_id IS NOT NULL`,
      [],
    );
    const knownIds = new Set(
      (r.rows as { drive_file_id: string }[]).map((row) => row.drive_file_id),
    );

    const orphans = await listDriveOrphans(knownIds);

    if (orphans.length === 0) {
      console.log('[drive-audit] clean — no orphaned Drive files found');
      return;
    }

    console.log(`[drive-audit] found ${orphans.length} orphaned Drive file(s) — deleting`);

    let deleted = 0;
    let failed  = 0;

    for (const id of orphans) {
      try {
        await deleteFromDrive(id);
        deleted++;
      } catch (e) {
        console.warn(`[drive-audit] could not delete Drive file ${id}:`, e);
        failed++;
      }
    }

    console.log(`[drive-audit] done — deleted ${deleted}, failed ${failed}`);
  } catch (err) {
    console.error('[drive-audit] audit run failed:', err);
  }
}

export function scheduleDriveAudit(): void {
  setTimeout(() => void runDriveAudit(), INITIAL_DELAY_MS);
  setInterval(() => void runDriveAudit(), INTERVAL_MS).unref();
}
