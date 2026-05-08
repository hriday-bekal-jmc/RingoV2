-- 013_drive_file_id.sql
-- Track the Google Drive file id (separate from drive_url) so we can:
--   - re-derive a fresh signed/proxy URL whenever needed
--   - delete the Drive file when the application is hard-deleted
-- Existing rows have NULL → served from local FS until next re-upload.

ALTER TABLE uploaded_files
  ADD COLUMN IF NOT EXISTS drive_file_id VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_drive_file_id
  ON uploaded_files(drive_file_id)
  WHERE drive_file_id IS NOT NULL;
