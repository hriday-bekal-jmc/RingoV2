// Auth-gated file serving. Replaces public /uploads static mount.
// Receipts/images should be migrated to Google Drive — fall back to local
// disk only for legacy rows where drive_url is null.

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { query } from '../config/db';
import { isAdminUser, requireAuth } from '../middlewares/authMiddleware';
import { assertCanReadApp } from '../middlewares/authz';
import { isDriveEnabled, deleteFromDrive, getDriveFileBuffer } from '../services/driveService';
import { deleteSingleFile, type FileRow } from '../services/fileCleanup';
import { extractReceiptData, extractCustomFields, CustomFieldSpec } from '../services/geminiService';
import { env } from '../config/env';

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

// DELETE /api/files/:id — remove a file.
//
// Unlinked files (application_id IS NULL): any owner or admin.
// Draft-linked files (application_id set, status = DRAFT): applicant or admin.
// Submitted/approved files: blocked — use the application cancel/delete flow.
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const r = await query(
      `SELECT uf.id, uf.application_id, uf.uploader_id, uf.stored_path, uf.drive_file_id,
              a.applicant_id, a.status AS app_status
       FROM uploaded_files uf
       LEFT JOIN applications a ON a.id = uf.application_id
       WHERE uf.id = $1`,
      [req.params.id],
    );
    if (r.rows.length === 0) { res.status(404).json({ error: 'File not found' }); return; }

    const f = r.rows[0] as FileRow & {
      application_id: string | null;
      uploader_id: string;
      applicant_id: string | null;
      app_status: string | null;
    };
    const actor = req.user!;

    if (f.application_id) {
      // Draft-linked: applicant or admin may delete (e.g. replacing a receipt)
      if (f.app_status !== 'DRAFT') {
        res.status(409).json({ error: 'ファイルはアプリケーションに紐付いているため削除できません' });
        return;
      }
      if (f.applicant_id !== actor.id && !isAdminUser(req.user)) {
        res.status(403).json({ error: 'このファイルを削除する権限がありません' });
        return;
      }
    } else {
      // Unlinked: uploader or admin
      if (f.uploader_id !== actor.id && !isAdminUser(req.user)) {
        res.status(403).json({ error: 'このファイルを削除する権限がありません' });
        return;
      }
    }

    await deleteSingleFile(f);
    res.status(204).end();
  } catch (err) {
    console.error('[files] delete failed:', err);
    res.status(500).json({ error: 'ファイルの削除に失敗しました' });
  }
});

// POST /api/files/:id/ocr — run Gemini OCR on a stored file, return { date, amount }
// The file must be an image. Caller must have read access to the associated application.
router.post('/:id/ocr', async (req: Request, res: Response): Promise<void> => {
  if (!env.GEMINI_API_KEY) {
    res.status(503).json({ error: 'AI OCR not configured on this server' });
    return;
  }

  try {
    const r = await query(
      `SELECT id, application_id, uploader_id, original_name,
              stored_path, mime_type, drive_file_id
       FROM uploaded_files WHERE id = $1`,
      [req.params.id],
    );
    if (r.rows.length === 0) { res.status(404).json({ error: 'File not found' }); return; }

    const f = r.rows[0] as {
      id: string; application_id: string | null; uploader_id: string;
      original_name: string; stored_path: string; mime_type: string;
      drive_file_id: string | null;
    };

    // Auth: same as GET
    const actor = { id: req.user!.id, role: req.user!.role, is_admin: req.user!.is_admin };
    if (f.application_id) {
      await assertCanReadApp(actor, f.application_id);
    } else if (f.uploader_id !== actor.id && !isAdminUser(req.user)) {
      res.status(403).json({ error: 'このファイルにアクセスする権限がありません' });
      return;
    }

    // Only images supported for OCR
    if (!f.mime_type.startsWith('image/')) {
      res.status(422).json({ error: 'OCRは画像ファイルのみ対応しています' });
      return;
    }

    // Fetch bytes from Drive or local FS
    let imageBuffer: Buffer;
    if (f.drive_file_id && isDriveEnabled()) {
      imageBuffer = await getDriveFileBuffer(f.drive_file_id);
    } else if (f.stored_path && !f.stored_path.startsWith('drive:')) {
      const abs = path.join(UPLOADS_DIR, f.stored_path);
      if (!fs.existsSync(abs)) {
        res.status(404).json({ error: 'ファイルが見つかりません' });
        return;
      }
      imageBuffer = fs.readFileSync(abs);
    } else {
      res.status(422).json({ error: 'ファイルを取得できませんでした' });
      return;
    }

    // Parse custom fields from body (optional)
    const rawCustom = req.body?.extract_fields;
    const customFields: CustomFieldSpec[] = Array.isArray(rawCustom)
      ? rawCustom.filter((x): x is CustomFieldSpec =>
          x && typeof x === 'object' && typeof x.name === 'string' && typeof x.hint === 'string',
        )
      : [];

    // Run date+amount (regex-validated) and custom semantic extraction in parallel
    const [result, custom] = await Promise.all([
      extractReceiptData(imageBuffer, f.mime_type),
      customFields.length > 0 ? extractCustomFields(imageBuffer, f.mime_type, customFields) : Promise.resolve({}),
    ]);

    res.json({ date: result.date, amount: result.amount, custom });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status) { res.status(e.status).json({ error: e.message }); return; }
    console.error('[files] OCR failed:', err);
    res.status(500).json({ error: 'OCR処理に失敗しました' });
  }
});

export default router;
