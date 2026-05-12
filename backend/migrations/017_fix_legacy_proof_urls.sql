-- Migration 017: convert legacy /uploads/<filename> transfer_proof_url values
-- into auth-gated /api/files/<id> URLs.
--
-- Background:
--   Earlier P0 hardening removed the public /uploads static mount, but
--   settlements.transfer_proof_url rows uploaded BEFORE that point still
--   pointed to /uploads/<filename>. The frontend renders them as <a href>
--   links → 404 (no route serves /uploads).
--
-- This migration:
--   1. For each settlement with a legacy /uploads/<filename> URL:
--      a. Insert an uploaded_files row whose stored_path = <filename>
--         and application_id = the settlement's app id.
--      b. Update the settlement's transfer_proof_url to /api/files/<new_id>.
--   2. Files that don't actually exist on disk are still updated — admin
--      can identify them via the audit log or by 404 on click.
--
-- Idempotent: re-running is safe. Only rows still matching '/uploads/%'
-- are touched. After migration they're all '/api/files/%'.

DO $$
DECLARE
  s_row RECORD;
  new_id UUID;
  fname TEXT;
BEGIN
  FOR s_row IN
    SELECT id, application_id, transfer_proof_url
    FROM settlements
    WHERE transfer_proof_url LIKE '/uploads/%'
  LOOP
    -- Extract just the filename portion
    fname := SUBSTRING(s_row.transfer_proof_url FROM '^/uploads/(.*)$');
    IF fname IS NULL OR fname = '' THEN
      CONTINUE;
    END IF;

    -- Create uploaded_files row (uploader unknown → use NULL via system; the
    -- migration runs as DB user, so we leave uploader_id blank and rely on
    -- application_id for read auth)
    INSERT INTO uploaded_files (
      application_id, uploader_id, field_name, original_name,
      stored_path, file_size, mime_type, drive_url, drive_file_id
    )
    VALUES (
      s_row.application_id,
      NULL,                                       -- legacy upload, original uploader lost
      'transfer_proof',
      fname,                                      -- original_name not preserved; use stored name
      fname,                                      -- stored_path matches the disk file
      0,                                          -- size unknown
      'application/octet-stream',                 -- mime unknown
      NULL,                                       -- not on Drive
      NULL
    )
    RETURNING id INTO new_id;

    UPDATE settlements
    SET transfer_proof_url = '/api/files/' || new_id::text,
        updated_at = NOW()
    WHERE id = s_row.id;

    RAISE NOTICE 'Migrated proof URL for settlement %: % → /api/files/%',
      s_row.id, s_row.transfer_proof_url, new_id;
  END LOOP;
END $$;
