// Google Drive service-account uploader.
//
// Auth priority (first match wins):
//   1. GDRIVE_SERVICE_ACCOUNT_JSON — inline JSON string (preferred, no file on disk)
//   2. GDRIVE_SERVICE_ACCOUNT_KEY  — path to JSON key file (legacy)
//
// Required:
//   GDRIVE_FOLDER_ID — default parent folder (shared with service account email)
//
// Optional per-category folders (all fall back to GDRIVE_FOLDER_ID):
//   GDRIVE_FOLDER_RECEIPTS       — expense receipts / PDFs
//   GDRIVE_FOLDER_INVOICES       — vendor invoices / bills
//   GDRIVE_FOLDER_TRANSPORTATION — transport tickets / IC records
//   GDRIVE_FOLDER_CONTRACTS      — contracts / Word / Excel
//   GDRIVE_FOLDER_OTHER          — anything else

import { google } from 'googleapis';
import type { drive_v3 } from 'googleapis';
import fs from 'fs';
import { Readable } from 'stream';
import { env } from '../config/env';

// ── Folder category map ───────────────────────────────────────────────────────
export type DriveFolder = 'receipts' | 'invoices' | 'transportation' | 'contracts' | 'other';

function resolveFolderId(category?: DriveFolder): string {
  const fallback = env.GDRIVE_FOLDER_ID as string;
  if (!category) return fallback;
  const map: Record<DriveFolder, string | undefined> = {
    receipts:       env.GDRIVE_FOLDER_RECEIPTS,
    invoices:       env.GDRIVE_FOLDER_INVOICES,
    transportation: env.GDRIVE_FOLDER_TRANSPORTATION,
    contracts:      env.GDRIVE_FOLDER_CONTRACTS,
    other:          env.GDRIVE_FOLDER_OTHER,
  };
  return map[category] ?? fallback;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function buildAuth() {
  const scopes = ['https://www.googleapis.com/auth/drive.file'];
  const subject = env.GDRIVE_IMPERSONATE_USER; // undefined = no impersonation

  // Prefer inline JSON (no file on disk — more secure for containers/PaaS)
  if (env.GDRIVE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(env.GDRIVE_SERVICE_ACCOUNT_JSON);
    // When GDRIVE_IMPERSONATE_USER set, use JWT so we can pass subject (DWD)
    if (subject) {
      return new google.auth.JWT({
        email:   credentials.client_email,
        key:     credentials.private_key,
        scopes,
        subject, // impersonate this Workspace user — requires DWD in Admin Console
      });
    }
    return new google.auth.GoogleAuth({ credentials, scopes });
  }

  // Fall back to key file path
  if (env.GDRIVE_SERVICE_ACCOUNT_KEY) {
    if (!fs.existsSync(env.GDRIVE_SERVICE_ACCOUNT_KEY)) {
      throw new Error(`Drive service account key not found: ${env.GDRIVE_SERVICE_ACCOUNT_KEY}`);
    }
    if (subject) {
      const keyJson = JSON.parse(fs.readFileSync(env.GDRIVE_SERVICE_ACCOUNT_KEY, 'utf-8'));
      return new google.auth.JWT({
        email:   keyJson.client_email,
        key:     keyJson.private_key,
        scopes,
        subject,
      });
    }
    return new google.auth.GoogleAuth({ keyFile: env.GDRIVE_SERVICE_ACCOUNT_KEY, scopes });
  }

  throw new Error('No Drive credentials configured (set GDRIVE_SERVICE_ACCOUNT_JSON or GDRIVE_SERVICE_ACCOUNT_KEY)');
}

// ── Client singleton ──────────────────────────────────────────────────────────
let driveClient: drive_v3.Drive | null = null;

export function isDriveEnabled(): boolean {
  return !!((env.GDRIVE_SERVICE_ACCOUNT_JSON || env.GDRIVE_SERVICE_ACCOUNT_KEY) && env.GDRIVE_FOLDER_ID);
}

function getDrive(): drive_v3.Drive {
  if (driveClient) return driveClient;
  driveClient = google.drive({ version: 'v3', auth: buildAuth() });
  return driveClient;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface DriveUploadResult {
  fileId:          string;
  webViewLink:     string;
  webContentLink?: string | null;
}

// ── Upload ────────────────────────────────────────────────────────────────────
export async function uploadToDrive(
  filename: string,
  mimeType: string,
  stream:   Buffer | Readable, // Accept stream to avoid buffering large files in RAM
  category?: DriveFolder,
  parentFolderId?: string,
): Promise<DriveUploadResult> {
  if (!isDriveEnabled()) throw new Error('Drive integration not configured');

  const folderId = parentFolderId ?? resolveFolderId(category);
  const drive    = getDrive();

  const res = await drive.files.create({
    requestBody: {
      name:    filename,
      parents: [folderId],
      mimeType,
    },
    media: {
      mimeType,
      body: stream instanceof Readable ? stream : Readable.from(stream),
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

// ── Create subfolder ──────────────────────────────────────────────────────────
// Creates a named subfolder inside a parent folder. Used to create per-application
// folders (e.g. "APP-2025-001") inside the category folder.
export async function createDriveFolder(name: string, parentFolderId?: string): Promise<string> {
  if (!isDriveEnabled()) throw new Error('Drive integration not configured');

  const parent = parentFolderId ?? (env.GDRIVE_FOLDER_ID as string);
  const drive  = getDrive();

  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents:  [parent],
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  if (!res.data.id) throw new Error('Drive folder creation returned no id');
  return res.data.id;
}

// ── Delete ────────────────────────────────────────────────────────────────────
export async function deleteFromDrive(fileId: string): Promise<void> {
  if (!isDriveEnabled()) return;
  const drive = getDrive();
  await drive.files.delete({ fileId, supportsAllDrives: true });
}

// ── Download stream ───────────────────────────────────────────────────────────
// Proxy a Drive file through the backend (auth-gated). Keeps files private —
// the Drive folder does NOT need link-sharing enabled.
export async function getDriveDownloadStream(fileId: string): Promise<NodeJS.ReadableStream> {
  const drive = getDrive();
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' },
  );
  return res.data as unknown as NodeJS.ReadableStream;
}

// ── Orphan scan (used by weekly driveAudit job) ───────────────────────────────
// Returns Drive file IDs present in configured folder(s) but absent from knownIds.
// Skips subfolders (mimeType filter). Paginates automatically.
export async function listDriveOrphans(knownIds: Set<string>): Promise<string[]> {
  if (!isDriveEnabled()) return [];
  const drive = getDrive();

  const folderIds = new Set<string>([
    env.GDRIVE_FOLDER_ID as string,
    ...(
      [
        env.GDRIVE_FOLDER_RECEIPTS,
        env.GDRIVE_FOLDER_INVOICES,
        env.GDRIVE_FOLDER_TRANSPORTATION,
        env.GDRIVE_FOLDER_CONTRACTS,
        env.GDRIVE_FOLDER_OTHER,
      ] as (string | undefined)[]
    ).filter(Boolean) as string[],
  ]);

  const orphans: string[] = [];

  // Only audit files created in last 90 days — avoids full-table Drive scan
  // which grows unbounded as file count increases over years.
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  for (const folderId of folderIds) {
    let pageToken: string | undefined;
    do {
      const resp = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder' and createdTime >= '${cutoff}'`,
        fields: 'nextPageToken, files(id)',
        pageSize: 200,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const f of resp.data.files ?? []) {
        if (f.id && !knownIds.has(f.id)) orphans.push(f.id);
      }
      pageToken = resp.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  return orphans;
}

// ── Get file bytes (for Gemini OCR) ──────────────────────────────────────────
export async function getDriveFileBuffer(fileId: string): Promise<Buffer> {
  const stream = await getDriveDownloadStream(fileId);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
