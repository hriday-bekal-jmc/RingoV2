-- Migration 042: Mark RECREATION template as protected (undeletable)
UPDATE form_templates
SET is_protected = TRUE
WHERE code = 'RECREATION';
