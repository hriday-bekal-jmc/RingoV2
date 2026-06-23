-- 058: Add copy_from to settlement schema fields where ringi/settlement names differ
--
-- EXPENSE_CLAIM : actual_items (settlement) ← expense_items (ringi)
-- RECREATION    : actual_participants       ← planned_participants
--                 recreation_date           ← event_date
--
-- Uses jsonb_agg to rewrite only the named fields; all other fields untouched.

-- ── EXPENSE_CLAIM ─────────────────────────────────────────────────────────────
UPDATE form_template_versions ftv
SET settlement_schema = jsonb_set(
  ftv.settlement_schema,
  '{fields}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN f->>'name' = 'actual_items'
          THEN f || '{"copy_from": "expense_items"}'::jsonb
        ELSE f
      END
      ORDER BY ordinality
    )
    FROM jsonb_array_elements(ftv.settlement_schema->'fields')
         WITH ORDINALITY AS f(f, ordinality)
  )
)
FROM form_templates ft
WHERE ft.code          = 'EXPENSE_CLAIM'
  AND ftv.template_id  = ft.id
  AND ftv.is_active    = TRUE
  AND ftv.settlement_schema IS NOT NULL;

-- ── RECREATION ────────────────────────────────────────────────────────────────
UPDATE form_template_versions ftv
SET settlement_schema = jsonb_set(
  ftv.settlement_schema,
  '{fields}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN f->>'name' = 'actual_participants'
          THEN f || '{"copy_from": "planned_participants"}'::jsonb
        WHEN f->>'name' = 'recreation_date'
          THEN f || '{"copy_from": "event_date"}'::jsonb
        ELSE f
      END
      ORDER BY ordinality
    )
    FROM jsonb_array_elements(ftv.settlement_schema->'fields')
         WITH ORDINALITY AS f(f, ordinality)
  )
)
FROM form_templates ft
WHERE ft.code          = 'RECREATION'
  AND ftv.template_id  = ft.id
  AND ftv.is_active    = TRUE
  AND ftv.settlement_schema IS NOT NULL;
