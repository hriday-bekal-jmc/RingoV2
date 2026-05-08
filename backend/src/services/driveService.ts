// Google Drive service-account uploader. Receipts/images go here so the
// Postgres row only stores a Drive file_id + URL — the binary lives in
// Drive, not in our backend FS.
//
// Required env (see config/env.ts):
//   GDRIVE_SERVICE_ACCOUNT_KEY  — path to JSON key file
//   GDRIVE_FOLDER_ID            — parent folder (must be shared with the
//                                 service-account email)
//
// If env not set, isDriveEnabled() returns false and uploadRoutes falls
// back to local FS storage. Switching is zero-touch — populate env, redeploy.

import { google } from 'googleapis';
import type { drive_v3 } from 'googleapis';
import fs from 'fs';
import { Readable } from 'stream';
import { env } from '../config/env';

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

export interface DriveUploadResult {
  fileId:   string;
  webViewLink: string; // Permalink for human viewing
  webContentLink?: string | null; // Direct download link
}

/**
 * Upload a buffer to the configured Drive folder.
 * The service account must have edit access to GDRIVE_FOLDER_ID.
 */
export async function uploadToDrive(
  filename: string,
  mimeType: string,
  buffer: Buffer,
): Promise<DriveUploadResult> {
  if (!isDriveEnabled()) throw new Error('Drive integration not configured');

  const drive = getDrive();
  const res = await drive.files.create({
    requestBody: {
      name:    filename,
      parents: [env.GDRIVE_FOLDER_ID as string],
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
    fileId:        data.id,
    webViewLink:   data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view`,
    webContentLink: data.webContentLink ?? null,
  };
}

/**
 * Generate a short-lived signed URL for direct download. NOTE: Drive's API
 * does not expose signed URLs the same way S3 does — the simplest pattern
 * is to either keep files private and proxy through our backend, or set
 * link-sharing to anyone-with-link and serve webViewLink directly.
 *
 * For audit-grade tracking we recommend KEEPING FILES PRIVATE and proxying
 * downloads through the backend (where authz enforced). This stub is here
 * for forward-compat.
 */
export async function getDriveDownloadStream(fileId: string): Promise<NodeJS.ReadableStream> {
  const drive = getDrive();
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' },
  );
  return res.data as unknown as NodeJS.ReadableStream;
}
