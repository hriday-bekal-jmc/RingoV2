-- 039_uploaded_files_category.sql
-- Add category column to uploaded_files for folder routing.
-- Values match DriveFolder type: receipts | invoices | transportation | contracts | other

ALTER TABLE uploaded_files
  ADD COLUMN IF NOT EXISTS category VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_category
  ON uploaded_files(category)
  WHERE category IS NOT NULL;
