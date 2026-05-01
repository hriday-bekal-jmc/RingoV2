import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { query } from '../config/db';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();
router.use(requireAuth);

// Store to disk — swap to Google Drive when service account is ready
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${ts}_${safe}`);
  },
});

const upload = multer({
  storage,
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

// POST /api/uploads — upload one or more files
// Returns: [{ id, url, original_name, field_name }]
router.post('/', upload.array('files', 10), async (req: Request, res: Response): Promise<void> => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'ファイルが選択されていません' }); return;
  }

  const { application_id, field_name } = req.body as {
    application_id?: string;
    field_name?: string;
  };

  try {
    const results = await Promise.all(
      files.map(async (f) => {
        const row = await query(
          `INSERT INTO uploaded_files
             (application_id, uploader_id, field_name, original_name, stored_path, file_size, mime_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            application_id ?? null,
            req.user!.id,
            field_name ?? null,
            f.originalname,
            f.filename,
            f.size,
            f.mimetype,
          ],
        );
        return {
          id:            row.rows[0].id as string,
          url:           `/uploads/${f.filename}`,
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

// GET /api/uploads/:id — serve file metadata (actual binary is served as static)
router.get('/application/:appId', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(
      `SELECT id, field_name, original_name, stored_path, file_size, mime_type, drive_url, created_at
       FROM uploaded_files WHERE application_id = $1 ORDER BY created_at`,
      [req.params.appId],
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'ファイル一覧の取得に失敗しました' });
  }
});

export default router;
