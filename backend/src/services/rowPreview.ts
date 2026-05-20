// Row preview extraction — computes the compact field summary shown in list rows.
//
// Called server-side so large form_data JSONB never reaches the client.
// Only the extracted preview (1 text + up to 2 numbers) is returned.
//
// Caps (keeps rows scannable regardless of how many fields admin marks):
//   text    → max 1 (first show_in_row text/textarea/select field found)
//   numbers → max 2 (ringi fields first, then settlement fields)
//
// Cross-schema comparison (Q3, Method B):
//   A number field may set row_compare_with = '<field_name_in_other_schema>'.
//   Backend looks up that name in the other schema + data and pairs them.
//   is_different = true when both values are non-null and not equal.

export interface RowTextPreview {
  label:    string;
  label_en: string;
  value:    string;
}

export interface RowNumberPreview {
  label:              string;
  label_en:           string;
  value:              number | null;
  compare_label?:     string;
  compare_label_en?:  string;
  compare_value?:     number | null;
  is_different:       boolean;
}

export interface RowPreview {
  text:    RowTextPreview | null;
  numbers: RowNumberPreview[]; // max 2
}

interface FieldDef {
  name:              string;
  label:             string;
  label_en?:         string;
  type:              string;
  show_in_row?:      boolean;
  row_compare_with?: string;
  fields?:           FieldDef[]; // repeat_group children (skip for row preview)
}

interface Schema {
  fields: FieldDef[];
}

function toNum(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return isNaN(n) ? null : n;
}

const TEXT_TYPES = new Set(['text', 'textarea', 'select']);

function processField(
  f:          FieldDef,
  data:       Record<string, unknown>,
  otherData:  Record<string, unknown>,
  otherFields: FieldDef[],
  out:        { text: RowTextPreview | null; numbers: RowNumberPreview[] },
): void {
  if (!f.show_in_row) return;

  if (TEXT_TYPES.has(f.type) && !out.text) {
    const raw = data[f.name];
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      out.text = {
        label:    f.label,
        label_en: f.label_en ?? f.label,
        value:    String(raw),
      };
    }
    return;
  }

  if (f.type === 'number' && out.numbers.length < 2) {
    const value = toNum(data[f.name]);
    let compareLabel:    string | undefined;
    let compareLabelEn:  string | undefined;
    let compareValue:    number | null | undefined;
    let isDifferent = false;

    if (f.row_compare_with) {
      const other = otherFields.find((x) => x.name === f.row_compare_with);
      if (other) {
        compareLabel   = other.label;
        compareLabelEn = other.label_en ?? other.label;
        compareValue   = toNum(otherData[other.name]);
        isDifferent    = value !== null && compareValue !== null && value !== compareValue;
      }
    }

    out.numbers.push({
      label:             f.label,
      label_en:          f.label_en ?? f.label,
      value,
      compare_label:     compareLabel,
      compare_label_en:  compareLabelEn,
      compare_value:     compareValue,
      is_different:      isDifferent,
    });
  }
}

export function extractRowPreview(
  ringiSchema:      Schema | null | undefined,
  formData:         Record<string, unknown> | null | undefined,
  settlementSchema: Schema | null | undefined,
  settlementData:   Record<string, unknown> | null | undefined,
): RowPreview {
  const ringiFields  = ringiSchema?.fields  ?? [];
  const settleFields = settlementSchema?.fields ?? [];
  const ringiData    = formData      ?? {};
  const settleData   = settlementData ?? {};

  const out: { text: RowTextPreview | null; numbers: RowNumberPreview[] } = {
    text:    null,
    numbers: [],
  };

  // Process ringi fields first so they appear before settlement fields
  for (const f of ringiFields) {
    processField(f, ringiData, settleData, settleFields, out);
    if (out.text && out.numbers.length >= 2) break;
  }
  // Then settlement fields (fills remaining slots)
  for (const f of settleFields) {
    processField(f, settleData, ringiData, ringiFields, out);
    if (out.text && out.numbers.length >= 2) break;
  }

  return { text: out.text, numbers: out.numbers };
}
