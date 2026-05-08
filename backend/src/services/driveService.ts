// Google Drive service-account uploader. Receipts/images go here so the
// Postgres row only stores a Drive file_id + URL — the binary lives in
// Drive, not in our backend FS.
//
// Required env (see config/env.ts):
//   GDRIVE_SERVICE_ACCOUNT_KEY  — path to JSON key file
//   GDRIVE_FOLDER_ID            — default parent folder (shared with svc account)
//
// Optional per-category folders (all fall back to GDRIVE_FOLDER_ID):
//   GDRIVE_FOLDER_RECEIPTS      — expense receipts / PDFs
//   GDRIVE_FOLDER_CONTRACTS     — contracts / Word / Excel
//   GDRIVE_FOLDER_OTHER         — anything else
//
// If Drive env not set, isDriveEnabled() returns false and uploadRoutes falls
// back to local FS storage. Switching is zero-touch — populate env, redeploy.

import { google } from 'googleapis';
import type { drive_v3 } from 'googleapis';
import fs from 'fs';
import { Readable } from 'stream';
import { env } from '../config/env';

// ── Folder category map ───────────────────────────────────────────────────────
// Upload callers pass one of these keys. Unknown/missing key → default folder.
export type DriveFolder = 'receipts' | 'contracts' | 'other';

function resolveFolderId(category?: DriveFolder): string {
  const fallback = env.GDRIVE_FOLDER_ID as string;
  if (!category) return fallback;
  const map: Record<DriveFolder, string | undefined> = {
    receipts:  env.GDRIVE_FOLDER_RECEIPTS,
    contracts: env.GDRIVE_FOLDER_CONTRACTS,
    other:     env.GDRIVE_FOLDER_OTHER,
  };
  return map[category] ?? fallback;
}

// ── Client singleton ──────────────────────────────────────────────────────────
let driveClient: drive_v3.Drive | null = null;

export function isDriveEnabled(): boolean {
  return !!(env.GDRIVE_SERVICE_ACCOUNT_KEY && env.GDRIVE_FOLDER_ID);
}

function getDrive(): drive_v3.Drive {
  if (driveClient) return driveClient;
  if (!env.GDRIVE_SERVICE_ACCOUNT_KEY) throw new Error('GDRIVE_SERVICE_ACCOUNT_KEY not set');

  const keyFile = env.GDRIVE_SERVICE_ACCOUNT_KEY;
  if (!fs.existsSync(keyFile)) {
    throw new Error(`Drive service account key not found: ${keyFile}`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface DriveUploadResult {
  fileId:          string;
  webViewLink:     string;        // Permalink for human viewing
  webContentLink?: string | null; // Direct download link
}

// ── Upload ────────────────────────────────────────────────────────────────────
/**
 * Upload a buffer to a Drive folder.
 *
 * @param filename  Original filename stored in Drive
 * @param mimeType  File MIME type
 * @param buffer    File bytes
 * @param category  Optional folder category. Falls back to GDRIVE_FOLDER_ID.
 *
 * The service account must have Editor access to the target folder.
 * When no category-specific folder is configured, GDRIVE_FOLDER_ID is used.
 */
export async function uploadToDrive(
  filename: string,
  mimeType: string,
  buffer:   Buffer,
  category?: DriveFolder,
): Promise<DriveUploadResult> {
  if (!isDriveEnabled()) throw new Error('Drive integration not configured');

  const folderId = resolveFolderId(category);
  const drive    = getDrive();

  const res = await drive.files.create({
    requestBody: {
      name:    filename,
      parents: [folderId],
      mimeType,
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: 'id, webViewLink, webContentLink',
    supportsAllDrives: true,
  });

  const data = res.data;
  if (!data.id) throw new Error('Drive upload returned no file id');
  return {
    fileId:         data.id,
    webViewLink:    data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view`,
    webContentLink: data.webContentLink ?? null,
  };
}

// ── Download stream ───────────────────────────────────────────────────────────
/**
 * Proxy-download a Drive file. Used by fileRoutes when we want to keep files
 * private (not shareable by link) and stream bytes through the backend.
 *
 * NOTE: For fully private files, remove link-sharing from the Drive folder and
 * route ALL downloads through this function + authz middleware.
 */
export async function getDriveDownloadStream(fileId: string): Promise<NodeJS.ReadableStream> {
  const drive = getDrive();
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' },
  );
  return res.data as unknown as NodeJS.ReadableStream;
}
