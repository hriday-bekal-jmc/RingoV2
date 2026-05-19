-- Migration 030: move avatar storage from base64-in-DB to files on disk
--
-- Problems fixed:
--   1. VARCHAR(500) couldn't hold base64 JPEG — silent truncation/error on upload
--   2. google_picture_url stored separately so login doesn't overwrite custom uploads
--   3. avatar_version used for cache-busting (?v=N in URL)

-- Fix column type (VARCHAR(500) is too small for any URL or path)
ALTER TABLE users ALTER COLUMN avatar_url TYPE TEXT;

-- Track whether user has custom upload (version > 0) or Google/default (version = 0)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_version INTEGER NOT NULL DEFAULT 0;

-- Store raw Google picture URL so we can re-download after custom avatar is deleted
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_picture_url TEXT;
