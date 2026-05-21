-- Migration 038: Redesign TRANSPORT_EXPENSE entry schema v3
--
-- Changes from v2 (037):
--   - Remove standalone transport_mode select field (entry-level mode was wrong UX)
--   - Add show_mode: true + mode options to the routes (route_entry) field
--     → each route row now has its own mode selector (train/bus/taxi/car/plane/other)
--     → user can do osaka→kobe[train] + kobe→dest[car] on same day
--   - Add default options to allowance_days field
--     → admin can edit steps (0 / 0.5 / 1 / 2 / etc.) in form builder

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
      "label_en": "Routes",
      "type": "route_entry",
      "required": false,
      "entry_field": true,
      "show_mode": true,
      "options": [
        { "value": "train",    "label_ja": "電車・地下鉄", "label_en": "Train / Subway" },
        { "value": "bus",      "label_ja": "バス",          "label_en": "Bus" },
        { "value": "taxi",     "label_ja": "タクシー",      "label_en": "Taxi" },
        { "value": "car",      "label_ja": "自家用車",      "label_en": "Private Car" },
        { "value": "airplane", "label_ja": "飛行機",        "label_en": "Airplane" },
        { "value": "other",    "label_ja": "その他",        "label_en": "Other" }
      ]
    },
    {
      "name": "allowance_days",
      "label": "日当支給日数",
      "label_en": "Allowance Days",
      "type": "allowance_days",
      "required": false,
      "entry_field": true,
      "options": [
        { "value": "0",   "label_ja": "0",   "label_en": "0" },
        { "value": "0.5", "label_ja": "0.5", "label_en": "0.5" },
        { "value": "1",   "label_ja": "1",   "label_en": "1" }
      ]
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

-- Sync active version
UPDATE form_template_versions fv
SET schema_definition = ft.schema_definition
FROM form_templates ft
WHERE fv.template_id = ft.id
  AND ft.code = 'TRANSPORT_EXPENSE'
  AND fv.is_active = TRUE;
