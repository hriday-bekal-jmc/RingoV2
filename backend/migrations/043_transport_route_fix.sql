-- Migration 043: Fix transport route_entry field
-- • Ensure show_copy_return is not false (explicitly set to true)
-- • Ensure show_mode is true
-- • Restore standard mode options if missing or empty

UPDATE form_templates
SET schema_definition = jsonb_set(
  schema_definition,
  '{fields}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN f->>'type' = 'route_entry'
        THEN f
          || '{"show_copy_return": true}'::jsonb
          || '{"show_mode": true}'::jsonb
          || CASE
               WHEN (f->'options') IS NULL
                 OR jsonb_array_length(f->'options') = 0
               THEN '{
                 "options": [
                   {"value":"train",    "label_ja":"電車・地下鉄","label_en":"Train / Subway"},
                   {"value":"bus",      "label_ja":"バス",        "label_en":"Bus"},
                   {"value":"taxi",     "label_ja":"タクシー",    "label_en":"Taxi"},
                   {"value":"car",      "label_ja":"自家用車",    "label_en":"Private Car"},
                   {"value":"airplane", "label_ja":"飛行機",      "label_en":"Airplane"},
                   {"value":"other",    "label_ja":"その他",      "label_en":"Other"}
                 ]
               }'::jsonb
               ELSE '{}'::jsonb
             END
        ELSE f
      END
    )
    FROM jsonb_array_elements(schema_definition->'fields') f
  )
)
WHERE code = 'TRANSPORT_EXPENSE';

-- Sync active version
UPDATE form_template_versions ftv
SET schema_definition = ft.schema_definition
FROM form_templates ft
WHERE ftv.template_id = ft.id
  AND ft.code         = 'TRANSPORT_EXPENSE'
  AND ftv.is_active   = TRUE;
