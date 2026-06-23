interface MinField {
  name:      string;
  type:      string;
  computed?: boolean;
  fields?:   MinField[];
  copy_from?: string;
}

// Types that can never be copied
const SKIP_TYPES = new Set(['header', 'field_group', 'ai_file_reader', 'file']);

// Type groups that are mutually compatible
const COMPAT: string[][] = [
  ['text', 'textarea'],
  ['number', 'allowance_days'],
];

function typesCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  return COMPAT.some((g) => g.includes(a) && g.includes(b));
}

function flattenForLookup(fields: MinField[]): Map<string, MinField> {
  const map = new Map<string, MinField>();
  for (const f of fields) {
    map.set(f.name, f);
    if (f.type === 'field_group' && f.fields) {
      flattenForLookup(f.fields).forEach((v, k) => map.set(k, v));
    }
  }
  return map;
}

export interface CopyResult {
  values:      Record<string, unknown>;
  copiedCount: number;
}

/**
 * Copy ringi form_data values into settlement form fields.
 *
 * Matching priority per settlement field:
 *   1. field.copy_from  → use that ringi field name as the source
 *   2. field.name       → same-name auto-match fallback
 *
 * Handles: text, textarea, number, date, time, select, checkbox,
 *          user_picker, route_entry, repeat_group (row-by-row child matching).
 * Skips:   computed fields, file, ai_file_reader, header, field_group, null/empty values.
 *
 * For repeat_group children the same copy_from / same-name logic applies per child.
 */
export function copyRingiToSettlement(
  ringiData:        Record<string, unknown>,
  ringiFields:      MinField[],
  settlementFields: MinField[],
): CopyResult {
  const ringiMap = flattenForLookup(ringiFields); // used for regular field type-compat check
  const result: Record<string, unknown> = {};
  let copiedCount = 0;

  const processFields = (sFields: MinField[]) => {
    for (const sf of sFields) {

      // ── structural passthrough ──
      if (sf.type === 'field_group') {
        if (sf.fields) processFields(sf.fields);
        continue;
      }

      // ── always skip ──
      if (SKIP_TYPES.has(sf.type) || sf.computed) continue;
      if (sf.copy_from === '__none__') continue;

      const srcName = sf.copy_from ?? sf.name;

      // ── repeat_group ──
      if (sf.type === 'repeat_group') {
        const rows = ringiData[srcName];
        if (!Array.isArray(rows) || rows.length === 0) continue;

        // Copy rows verbatim. Settlement form reads only the keys it knows;
        // extra or renamed keys from ringi are ignored by DynamicForm renderers.
        result[sf.name] = rows;
        copiedCount++;
        continue;
      }

      // ── regular field ──
      const rf = ringiMap.get(srcName);
      if (!rf) continue;
      if (!typesCompatible(rf.type, sf.type)) continue;

      const val = ringiData[srcName];
      if (val === null || val === undefined || val === '') continue;

      result[sf.name] = val;
      copiedCount++;
    }
  };

  processFields(settlementFields);
  return { values: result, copiedCount };
}
