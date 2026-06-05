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
  computed?:         boolean;
  sum_target?:       string;
  count_field?:      string;
  options?:          { value: string; label_ja?: string; label_en?: string }[];
  fields?:           FieldDef[]; // repeat_group children (skip for row preview)
}

interface Schema {
  fields: FieldDef[];
}

// field_group is a visual-only container; its children live flat at the top
// level. Expand groups so show_in_row children are discoverable here too.
function flattenGroups(fields: FieldDef[]): FieldDef[] {
  const out: FieldDef[] = [];
  for (const f of fields) {
    if (f.type === 'field_group' && Array.isArray(f.fields)) out.push(...flattenGroups(f.fields));
    else out.push(f);
  }
  return out;
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
      // For select fields, resolve opaque value (opt_xxx) → label_ja for display.
      // Falls back to raw value if no options or no match (legacy data).
      let display = String(raw);
      if (f.type === 'select' && Array.isArray(f.options)) {
        const opt = f.options.find((o) => o.value === String(raw));
        if (opt?.label_ja) display = opt.label_ja;
      }
      out.text = {
        label:    f.label,
        label_en: f.label_en ?? f.label,
        value:    display,
      };
    }
    return;
  }

  if (f.type === 'user_picker' && out.numbers.length < 2) {
    let arr: unknown[] = [];
    try {
      const raw = data[f.name];
      arr = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : []);
    } catch { /* empty */ }
    if (arr.length > 0) {
      out.numbers.push({
        label:        f.label,
        label_en:     f.label_en ?? f.label,
        value:        arr.length,
        is_different: false,
      });
    }
    return;
  }

  if (f.type === 'route_entry' && out.numbers.length < 2) {
    const routes = Array.isArray(data[f.name]) ? (data[f.name] as { fare?: unknown }[]) : [];
    const total = routes.reduce((s, r) => s + (Number(r.fare) || 0), 0);
    if (total > 0) {
      out.numbers.push({
        label:        f.label,
        label_en:     f.label_en ?? f.label,
        value:        total,
        is_different: false,
      });
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
  const ringiFields  = flattenGroups(ringiSchema?.fields  ?? []);
  const settleFields = flattenGroups(settlementSchema?.fields ?? []);
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

  // Fallback: if no number extracted via show_in_row, check for grand_total key
  // (saved automatically by TransportationForm and other computed-total forms).
  // Runs for both ringi and settlement data.
  if (out.numbers.length === 0) {
    for (const [data, fields, label] of [
      [ringiData,  ringiFields,  '合計金額'] as const,
      [settleData, settleFields, '合計金額'] as const,
    ]) {
      if (data.grand_total != null) {
        const val = toNum(data.grand_total);
        if (val !== null && val > 0) {
          const f = (fields as FieldDef[]).find((x) => x.name === 'grand_total');
          out.numbers.push({
            label:        f?.label    ?? label,
            label_en:     f?.label_en ?? 'Total',
            value:        val,
            is_different: false,
          });
          break;
        }
      }
    }
  }

  return { text: out.text, numbers: out.numbers };
}
