// Auth-gated file serving. Replaces public /uploads static mount.
// Receipts/images should be migrated to Google Drive — fall back to local
// disk only for legacy rows where drive_url is null.

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { query } from '../config/db';
import { isAdminUser, requireAuth } from '../middlewares/authMiddleware';
import { assertCanReadApp } from '../middlewares/authz';
import { isDriveEnabled, deleteFromDrive } from '../services/driveService';

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

const router = Router();
router.use(requireAuth);

// GET /api/files/:id — stream file binary IF caller has access to its application
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const r = await query(
      `SELECT id, application_id, uploader_id, original_name, stored_path,
              mime_type, drive_url
       FROM uploaded_files WHERE id = $1`,
      [req.params.id],
    );
    if (r.rows.length === 0) { res.status(404).json({ error: 'File not found' }); return; }
    const f = r.rows[0] as {
      id: string; application_id: string | null; uploader_id: string;
      original_name: string; stored_path: string; mime_type: string;
      drive_url: string | null;
    };

    // ── Authorization: if the file is attached to an application, the
    //    caller must have read access to that application. Files with no
    //    application_id (drafts mid-upload) are restricted to uploader.
    const actor = { id: req.user!.id, role: req.user!.role, is_admin: req.user!.is_admin };
    if (f.application_id) {
      await assertCanReadApp(actor, f.application_id);
    } else if (f.uploader_id !== actor.id && !isAdminUser(req.user)) {
      res.status(403).json({ error: 'このファイルにアクセスする権限がありません' });
      return;
    }

    // Drive URL → redirect (browser handles auth via Google's signed link).
    // Service account integration TODO: generate short-lived signed URL here.
    if (f.drive_url) {
      res.redirect(f.drive_url);
      return;
    }

    // Local fallback — stream from disk
    const abs = path.join(__dirname, '../../uploads', f.stored_path);
    if (!fs.existsSync(abs)) {
      // WARN not ERROR: recoverable, often caused by deleted/migrated files,
      // not a code bug. Internal path NOT leaked to client (info-disclosure
      // risk). Server-side log gets enough to grep + diagnose.
      console.warn('[files] missing on disk', {
        fileId:      f.id,
        stored_path: f.stored_path,
      });
      res.status(404).json({ error: 'ファイルが見つかりません' });
      return;
    }

    res.setHeader('Content-Type', f.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.original_name)}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(abs).pipe(res);
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[files] serve failed:', err);
    res.status(500).json({ error: 'ファイル取得に失敗しました' });
  }
});

// DELETE /api/files/:id — remove unlinked file (draft upload cleaned up when user removes from form).
// Normal users: own unlinked files only. Admins: any unlinked file.
// Linked files (application_id IS NOT NULL) cannot be deleted this way — use application delete flow.
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const r = await query(
      `SELECT id, application_id, uploader_id, stored_path, drive_file_id
       FROM uploaded_files WHERE id = $1`,
      [req.params.id],
    );
    if (r.rows.length === 0) { res.status(404).json({ error: 'File not found' }); return; }

    const f = r.rows[0] as {
      id: string;
      application_id: string | null;
      uploader_id: string;
      stored_path: string;
      drive_file_id: string | null;
    };

    const actor = req.user!;

    // Linked files are immutable via this endpoint — protect application integrity.
    if (f.application_id) {
      res.status(409).json({ error: 'ファイルはアプリケーションに紐付いているため削除できません' });
      return;
    }

    // Auth: uploader or admin
    if (f.uploader_id !== actor.id && !isAdminUser(req.user)) {
      res.status(403).json({ error: 'このファイルを削除する権限がありません' });
      return;
    }

    // Delete physical file
    if (f.drive_file_id && isDriveEnabled()) {
      try {
        await deleteFromDrive(f.drive_file_id);
      } catch (driveErr) {
        // Log but continue — Drive file may already be gone; still remove DB row.
        console.warn('[files] Drive delete failed, removing DB row anyway:', driveErr);
      }
    } else if (f.stored_path && !f.stored_path.startsWith('drive:')) {
      const abs = path.join(UPLOADS_DIR, f.stored_path);
      if (fs.existsSync(abs)) {
        try { fs.unlinkSync(abs); } catch { /* already gone */ }
      }
    }

    await query(`DELETE FROM uploaded_files WHERE id = $1`, [f.id]);
    res.status(204).end();
  } catch (err) {
    console.error('[files] delete failed:', err);
    res.status(500).json({ error: 'ファイルの削除に失敗しました' });
  }
});

export default router;
