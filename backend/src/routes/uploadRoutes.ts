import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { query } from '../config/db';
import { requireAuth } from '../middlewares/authMiddleware';
import { uploadLimiter } from '../middlewares/rateLimit';
import { isDriveEnabled, uploadToDrive } from '../services/driveService';

const router = Router();
router.use(requireAuth);
router.use(uploadLimiter);

// Use memory storage so we can either:
//   (a) push to Google Drive (when service account is configured), or
//   (b) write to local FS as a fallback.
// Memory cap matches per-file size limit, so OOM risk is bounded.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`ファイル形式が対応していません: ${file.mimetype}`));
    }
  },
});

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function safeName(original: string): string {
  const ts = Date.now();
  const safe = original.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${ts}_${safe}`;
}

// POST /api/uploads — upload one or more files
// Returns: { files: [{ id, url, original_name, field_name, size, mime }] }
router.post('/', upload.array('files', 10), async (req: Request, res: Response): Promise<void> => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'ファイルが選択されていません' }); return;
  }

  const { application_id, field_name } = req.body as {
    application_id?: string;
    field_name?: string;
  };

  const useDrive = isDriveEnabled();

  try {
    const results = await Promise.all(
      files.map(async (f) => {
        let stored_path = '';
        let drive_file_id: string | null = null;
        let drive_url:     string | null = null;

        if (useDrive) {
          // Drive path — bytes never touch our disk
          const result = await uploadToDrive(f.originalname, f.mimetype, f.buffer);
          drive_file_id = result.fileId;
          drive_url     = result.webViewLink;
          stored_path   = `drive:${result.fileId}`; // sentinel — never read from FS
        } else {
          // Local FS fallback — only used when Drive env is not configured
          stored_path = safeName(f.originalname);
          fs.writeFileSync(path.join(UPLOADS_DIR, stored_path), f.buffer);
        }

        const row = await query(
          `INSERT INTO uploaded_files
             (application_id, uploader_id, field_name, original_name,
              stored_path, file_size, mime_type, drive_url, drive_file_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            application_id ?? null,
            req.user!.id,
            field_name ?? null,
            f.originalname,
            stored_path,
            f.size,
            f.mimetype,
            drive_url,
            drive_file_id,
          ],
        );

        return {
          id:            row.rows[0].id as string,
          // Gated URL — fileRoutes enforces authz, then either redirects to
          // Drive's webViewLink or streams local FS bytes.
          url:           `/api/files/${row.rows[0].id}`,
          original_name: f.originalname,
          field_name:    field_name ?? null,
          size:          f.size,
          mime:          f.mimetype,
        };
      }),
    );
    res.status(201).json({ files: results });
  } catch (err) {
    console.error('[uploads] failed:', err);
    res.status(500).json({ error: 'アップロードに失敗しました' });
  }
});

// GET /api/uploads/application/:appId — file metadata for an application.
// (The binary itself is served via /api/files/:id with authz checks.)
router.get('/application/:appId', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(
      `SELECT id, field_name, original_name, file_size, mime_type, drive_url, created_at
       FROM uploaded_files WHERE application_id = $1 ORDER BY created_at`,
      [req.params.appId],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[uploads] list failed:', err);
    res.status(500).json({ error: 'ファイル一覧の取得に失敗しました' });
  }
});

export default router;
