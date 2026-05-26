// Shared physical-file deletion helpers.
//
// Call deleteFilesForApplication BEFORE the DB DELETE so uploaded_files rows
// are still readable. The ON DELETE CASCADE on applications→uploaded_files
// handles DB row cleanup after the application row is gone.
//
// Used by:
//   applicationRoutes DELETE  — draft delete
//   fileRoutes DELETE         — single-file removal (draft-linked allowed)
//   driveAudit                — orphan sweep

import path from 'path';
import fs from 'fs';
import { query } from '../config/db';
import { isDriveEnabled, deleteFromDrive } from './driveService';
import type { PoolClient } from 'pg';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

export interface FileRow {
  id: string;
  stored_path: string;
  drive_file_id: string | null;
}

export async function deletePhysicalFile(
  f: Pick<FileRow, 'stored_path' | 'drive_file_id'>,
): Promise<void> {
  if (f.drive_file_id && isDriveEnabled()) {
    try { await deleteFromDrive(f.drive_file_id); } catch { /* already gone */ }
  } else if (f.stored_path && !f.stored_path.startsWith('drive:')) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, f.stored_path)); } catch { /* ENOENT */ }
  }
}

// Fetch + physically delete all files for an application.
// Pass the transaction client when called inside a transaction so the SELECT
// sees the same snapshot (uploaded_files rows still exist before CASCADE fires).
export async function deleteFilesForApplication(
  applicationId: string,
  client?: PoolClient,
): Promise<void> {
  const sql = `SELECT id, stored_path, drive_file_id
               FROM uploaded_files WHERE application_id = $1`;

  const r = client
    ? await client.query<FileRow>(sql, [applicationId])
    : await query(sql, [applicationId]);

  if (r.rows.length === 0) return;

  await Promise.all(r.rows.map(deletePhysicalFile));

  console.log(
    `[file-cleanup] purged ${r.rows.length} physical file(s) for application ${applicationId}`,
  );
}

// Delete a single file physically + its DB row.
// Used by fileRoutes DELETE for draft-linked files.
export async function deleteSingleFile(f: FileRow): Promise<void> {
  await deletePhysicalFile(f);
  await query(`DELETE FROM uploaded_files WHERE id = $1`, [f.id]);
}
