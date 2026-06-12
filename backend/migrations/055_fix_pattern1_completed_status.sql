-- Pattern 1 forms (ringi-only) were incorrectly left in APPROVED status after
-- full ringi approval instead of being marked COMPLETED. The approval logic now
-- sets COMPLETED directly, but existing rows need a one-time backfill.

UPDATE applications a
SET    status       = 'COMPLETED',
       completed_at = COALESCE(a.completed_at, a.updated_at)
FROM   form_templates ft
WHERE  ft.id        = a.template_id
  AND  ft.pattern_id = 1
  AND  a.status      = 'APPROVED'
  AND  a.archived_at IS NULL;
