-- Migration 003: add avatar_url to users, create uploads tracking table

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);

-- Track uploaded files (local storage now, swap to Drive URL later)
CREATE TABLE IF NOT EXISTS uploaded_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
  uploader_id UUID REFERENCES users(id),
  field_name  VARCHAR(100),
  original_name VARCHAR(255),
  stored_path VARCHAR(500) NOT NULL,
  file_size   INTEGER,
  mime_type   VARCHAR(100),
  drive_url   VARCHAR(500),   -- NULL until Google Drive is configured
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_app ON uploaded_files(application_id);
