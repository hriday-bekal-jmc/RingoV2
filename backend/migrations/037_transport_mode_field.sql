-- Migration 037: Add transport_mode select field to TRANSPORT_EXPENSE entry schema
--
-- Inserts "交通手段" (transport mode) select between destination and purpose.
-- Admin can edit/rename/reorder options in form builder (it's a normal select field).

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
      "name": "transport_mode",
      "label": "交通手段",
      "label_en": "Transport Mode",
      "type": "select",
      "required": false,
      "entry_field": true,
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

-- Sync active version
UPDATE form_template_versions fv
SET schema_definition = ft.schema_definition
FROM form_templates ft
WHERE fv.template_id = ft.id
  AND ft.code = 'TRANSPORT_EXPENSE'
  AND fv.is_active = TRUE;
