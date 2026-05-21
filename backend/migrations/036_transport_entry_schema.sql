-- Migration 036: Move TRANSPORT_EXPENSE entry fields into schema_definition
--
-- Before: schema_definition had only the top-level "title" header field.
--         Entry fields (date, destination, purpose, routes, allowance_days,
--         other_expense, note) were hardcoded in TransportationForm.tsx.
-- After:  All fields live in schema_definition. Fields with entry_field:true
--         render inside the per-day entry section; others render as header.
--         Admin can now edit labels, required, order via the form builder.

UPDATE form_templates
SET schema_definition = '{
  "fields": [
    {
      "name": "title",
      "label": "件名",
      "label_en": "Subject",
      "type": "text",
      "required": true,
      "placeholder": "例）2025年5月分"
    },
    {
      "name": "date",
      "label": "日付",
      "label_en": "Date",
      "type": "date",
      "required": true,
      "entry_field": true
    },
    {
      "name": "destination",
      "label": "出張先",
      "label_en": "Destination",
      "type": "text",
      "required": true,
      "entry_field": true
    },
    {
      "name": "purpose",
      "label": "訪問先（用務）",
      "label_en": "Purpose",
      "type": "text",
      "required": false,
      "entry_field": true
    },
    {
      "name": "routes",
      "label": "交通費",
      "label_en": "Transportation",
      "type": "route_entry",
      "required": false,
      "entry_field": true
    },
    {
      "name": "allowance_days",
      "label": "日当支給日数",
      "label_en": "Allowance Days",
      "type": "allowance_days",
      "required": false,
      "entry_field": true
    },
    {
      "name": "other_expense",
      "label": "その他費用",
      "label_en": "Other Expenses",
      "type": "number",
      "required": false,
      "entry_field": true,
      "validation": { "min": 0 }
    },
    {
      "name": "note",
      "label": "備考",
      "label_en": "Note",
      "type": "text",
      "required": false,
      "entry_field": true
    }
  ]
}'::jsonb
WHERE code = 'TRANSPORT_EXPENSE';

-- Sync active version to match (version must stay in lockstep with template)
UPDATE form_template_versions fv
SET schema_definition = ft.schema_definition
FROM form_templates ft
WHERE fv.template_id = ft.id
  AND ft.code = 'TRANSPORT_EXPENSE'
  AND fv.is_active = TRUE;
