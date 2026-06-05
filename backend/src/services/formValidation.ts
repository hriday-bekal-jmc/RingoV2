// Server-side form validation against admin-configured schema.
// RE2 is used for user-supplied regex patterns — it runs in linear time and
// cannot catastrophically backtrack (no ReDoS risk).
import RE2 from 're2';
import { evalFormula, formulaDeps } from './formulaEval';
//
// Honours:
//   - required (skipped when field is hidden via conditional_on)
//   - validation.regex / min / max / maxlength
//   - conditional_on (hidden fields are exempt from required + validation)
//   - repeat_group (bounded JSON array of row objects)
//
// Returns array of { field, message }. Empty array = valid.
// Caller decides HTTP response (typically 400 with the array).

export interface FormField {
  name: string;
  label?: string;
  type: string;
  required?: boolean;
  computed?: boolean;
  hidden?: boolean;
  formula?: string;
  sum_target?: string;
  date_diff_from?: string;
  date_diff_to?:   string;
  fields?: FormField[];
  min_rows?: number;
  max_rows?: number;
  validation?: {
    regex?: string;
    min?: number;
    max?: number;
    maxlength?: number;
    min_time?: string;
    max_time?: string;
    /** date field: value must be ≥ the named sibling field */
    date_after_or_equal?: string;
    /** date field: value must be ≤ the named sibling field */
    date_before_or_equal?: string;
    /** number field: value must be ≤ value of the named sibling field */
    max_from_field?: string;
    /** number field (nights): must equal date diff between two sibling fields in same row */
    validate_nights_from?: { check_in: string; check_out: string };
  };
  /** repeat_group: field name whose values must be unique across all rows */
  unique_rows_by?: string;
  conditional_on?: {
    field: string;
    equals: string | number | boolean | Array<string | number | boolean>;
  };
}

export interface FormSchema {
  fields: FormField[];
}

export interface ValidationError {
  field: string;
  message: string;
}

const DEFAULT_REPEAT_MAX_ROWS = 50;

function isEmptyValue(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function isMeaningfulValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return !isEmptyValue(value);
}

function rowHasValue(row: Record<string, unknown>, fields: FormField[]): boolean {
  return fields.some((f) => f.type !== 'header' && isMeaningfulValue(row[f.name]));
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function conditionMatches(
  field: FormField,
  localData: Record<string, unknown>,
  rootData: Record<string, unknown>,
): boolean {
  if (!field.conditional_on) return true;
  const got = localData[field.conditional_on.field] ?? rootData[field.conditional_on.field];
  if (got == null) return false;
  const eq = field.conditional_on.equals;
  const eqArr = Array.isArray(eq) ? eq.map(String) : [String(eq)];
  const gotArr = Array.isArray(got) ? got.map(String) : [String(got)];
  return gotArr.some((v) => eqArr.includes(v));
}

/**
 * Validate form_data against schema. Hidden conditional fields are skipped
 * entirely: neither required nor validation rules apply to them.
 */
export function validateFormData(schema: FormSchema, data: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!schema?.fields) return errors;

  validateFieldList(schema.fields, data, data, errors);
  return errors;
}

export function applyComputedFormData(schema: FormSchema | null | undefined, data: Record<string, unknown>): Record<string, unknown> {
  if (!schema?.fields) return data;

  const computedTargets = new Set(
    schema.fields.filter((field) => field.type === 'number' && field.computed).map((field) => field.name),
  );
  const formulaFields = schema.fields.filter(
    (field) => field.type === 'number' && field.formula,
  );

  // Whitelist: only keep keys that exist in the schema + internal _seed marker.
  // Drops any unknown keys the client sends (prevents JSONB bloat / injection).
  const allowedKeys = new Set(schema.fields.map((f) => f.name));
  allowedKeys.add('_seed'); // internal test-data marker — preserve if present
  const sanitised: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (allowedKeys.has(key)) sanitised[key] = data[key];
  }

  if (computedTargets.size === 0 && formulaFields.length === 0) return sanitised;

  const next: Record<string, unknown> = { ...sanitised };
  const totals = new Map<string, number>();

  const addToTarget = (target: string | undefined, value: unknown) => {
    if (!target || !computedTargets.has(target)) return;
    totals.set(target, (totals.get(target) ?? 0) + (Number(value) || 0));
  };

  for (const field of schema.fields) {
    if (!conditionMatches(field, data, data)) continue;

    if (field.sum_target) {
      addToTarget(field.sum_target, data[field.name]);
    }

    if (field.type !== 'repeat_group' || !Array.isArray(data[field.name])) continue;

    const rows = data[field.name] as unknown[];
    for (const child of field.fields ?? []) {
      if (!['number', 'select', 'allowance_days'].includes(child.type) || !child.sum_target) continue;
      for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const rowData = row as Record<string, unknown>;
        if (!conditionMatches(child, rowData, data)) continue;
        addToTarget(child.sum_target, rowData[child.name]);
      }
    }
  }

  totals.forEach((total, target) => {
    next[target] = total;
  });

  // Compute date-diff fields server-side (e.g. trip_duration from departure/return dates)
  for (const field of schema.fields) {
    if (field.type === 'number' && field.date_diff_from && field.date_diff_to) {
      const from = String(next[field.date_diff_from] ?? '');
      const to   = String(next[field.date_diff_to]   ?? '');
      if (from && to) {
        const diff = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
        next[field.name] = diff;
      }
    }
  }

  // Recalculate formula fields server-side — client value is untrusted.
  for (const field of formulaFields) {
    if (!field.formula) continue;
    const deps = formulaDeps(field.formula);
    const numValues: Record<string, number> = {};
    for (const dep of deps) {
      const v = next[dep];
      numValues[dep] = typeof v === 'number' ? v : parseFloat(String(v ?? '0')) || 0;
    }
    next[field.name] = evalFormula(field.formula, numValues);
  }

  return next;
}

function validateFieldList(
  fields: FormField[],
  localData: Record<string, unknown>,
  rootData: Record<string, unknown>,
  errors: ValidationError[],
  prefix = '',
): void {
  for (const field of fields) {
    if (field.type === 'header') continue;
    if (!conditionMatches(field, localData, rootData)) continue;

    const path = prefix ? `${prefix}.${field.name}` : field.name;
    const value = localData[field.name];

    if (field.type === 'repeat_group') {
      validateRepeatGroup(field, value, rootData, errors, path);
      continue;
    }

    const empty = isEmptyValue(value);

    if (field.required && empty) {
      errors.push({ field: path, message: `${field.label ?? field.name} is required` });
      continue;
    }

    if (empty) continue;

    const validation = field.validation;
    if (!validation) continue;

    const stringValue = String(value);

    if (validation.regex) {
      try {
        if (!new RE2(validation.regex).test(stringValue)) {
          errors.push({ field: path, message: `${field.label ?? field.name} の形式が正しくありません` });
        }
      } catch {
        console.warn(`[formValidation] invalid regex on field ${path}: ${validation.regex}`);
      }
    }

    if (validation.maxlength != null && stringValue.length > validation.maxlength) {
      errors.push({ field: path, message: `${field.label ?? field.name} must be ${validation.maxlength} characters or less` });
    }

    if (field.type === 'number') {
      const num = Number(value);
      if (Number.isFinite(num)) {
        if (validation.min != null && num < validation.min) {
          errors.push({ field: path, message: `${field.label ?? field.name} must be at least ${validation.min}` });
        }
        if (validation.max != null && num > validation.max) {
          errors.push({ field: path, message: `${field.label ?? field.name} must be at most ${validation.max}` });
        }
        // max_from_field: value must be ≤ another field's value (e.g. days_total ≤ trip_duration)
        if (validation.max_from_field) {
          const cap = Number(rootData[validation.max_from_field] ?? localData[validation.max_from_field]);
          if (Number.isFinite(cap) && cap > 0 && num > cap) {
            errors.push({ field: path, message: `${field.label ?? field.name} (${num}) が出張日数 (${cap}日) を超えています` });
          }
        }
      }
    }

    if (field.type === 'date' && validation.date_after_or_equal) {
      const ref = String(rootData[validation.date_after_or_equal] ?? localData[validation.date_after_or_equal] ?? '');
      if (ref && String(value) < ref) {
        errors.push({ field: path, message: `${field.label ?? field.name} は ${ref} 以降の日付を入力してください` });
      }
    }

    if (field.type === 'date' && validation.date_before_or_equal) {
      const ref = String(rootData[validation.date_before_or_equal] ?? localData[validation.date_before_or_equal] ?? '');
      if (ref && String(value) > ref) {
        errors.push({ field: path, message: `${field.label ?? field.name} は ${ref} 以前の日付を入力してください` });
      }
    }

    if (field.type === 'number' && validation.validate_nights_from) {
      const { check_in, check_out } = validation.validate_nights_from;
      const cin  = String(localData[check_in]  ?? '');
      const cout = String(localData[check_out] ?? '');
      if (cin && cout && Date.parse(cout) > Date.parse(cin)) {
        const expected = Math.round((Date.parse(cout) - Date.parse(cin)) / 86400000);
        const actual   = Number(value);
        if (Number.isFinite(actual) && actual !== expected) {
          errors.push({ field: path, message: `${field.label ?? field.name} はチェックイン・アウト日付の差（${expected}泊）と一致しません` });
        }
      }
    }

    // route_entry: validate each row's travel_date is within the trip date range
    if (field.type === 'route_entry') {
      const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
      const depDate = String(rootData['departure_date'] ?? localData['departure_date'] ?? '');
      const retDate = String(rootData['return_date']    ?? localData['return_date']    ?? '');
      rows.forEach((row, i) => {
        const td = String(row['travel_date'] ?? '');
        if (!td) return;
        if (depDate && td < depDate) {
          errors.push({ field: `${path}[${i + 1}].travel_date`, message: `交通費明細の日付（${td}）は出発日（${depDate}）以降にしてください` });
        }
        if (retDate && td > retDate) {
          errors.push({ field: `${path}[${i + 1}].travel_date`, message: `交通費明細の日付（${td}）は帰着日（${retDate}）以前にしてください` });
        }
      });
    }

    if (field.type === 'time') {
      // HH:mm format — browsers always emit this format, but validate defensively
      if (!/^\d{2}:\d{2}$/.test(stringValue)) {
        errors.push({ field: path, message: `${field.label ?? field.name} must be a valid time (HH:mm)` });
      } else {
        // String comparison works correctly for zero-padded HH:mm in 24h format
        if (validation.min_time && stringValue < validation.min_time) {
          errors.push({ field: path, message: `${field.label ?? field.name} must be ${validation.min_time} or later` });
        }
        if (validation.max_time && stringValue > validation.max_time) {
          errors.push({ field: path, message: `${field.label ?? field.name} must be ${validation.max_time} or earlier` });
        }
      }
    }
  }
}

function validateRepeatGroup(
  field: FormField,
  value: unknown,
  rootData: Record<string, unknown>,
  errors: ValidationError[],
  path: string,
): void {
  const childFields = field.fields ?? [];
  const maxRows = boundedInt(field.max_rows, DEFAULT_REPEAT_MAX_ROWS, 1, DEFAULT_REPEAT_MAX_ROWS);
  // required:true with explicit min_rows:0 — force at least 1 row so required is meaningful
  const rawMin = boundedInt(field.min_rows, field.required ? 1 : 0, 0, maxRows);
  const minRows = field.required && rawMin === 0 ? 1 : rawMin;

  if (value == null || value === '') {
    if (minRows > 0) {
      errors.push({ field: path, message: `${field.label ?? field.name} requires at least ${minRows} row(s)` });
    }
    return;
  }

  if (!Array.isArray(value)) {
    errors.push({ field: path, message: `${field.label ?? field.name} must be a repeatable row list` });
    return;
  }

  if (value.length > maxRows) {
    errors.push({ field: path, message: `${field.label ?? field.name} allows up to ${maxRows} row(s)` });
    return;
  }

  const objectRows = value.filter(
    (row): row is Record<string, unknown> => typeof row === 'object' && row !== null && !Array.isArray(row),
  );
  if (objectRows.length !== value.length) {
    errors.push({ field: path, message: `${field.label ?? field.name} contains an invalid row` });
    return;
  }

  const rows = objectRows.filter((row) => rowHasValue(row, childFields));

  if (minRows > 0 && rows.length < minRows) {
    errors.push({ field: path, message: `${field.label ?? field.name} requires at least ${minRows} row(s)` });
    return;
  }

  // Check uniqueness across rows if specified
  if (field.unique_rows_by) {
    const seen = new Map<string, number>();
    const uKey = field.unique_rows_by;
    objectRows.forEach((row, i) => {
      const v = row[uKey];
      if (v == null || v === '') return;
      const k = String(v);
      if (seen.has(k)) {
        errors.push({ field: `${path}[${i + 1}].${uKey}`, message: `${field.label ?? field.name} に重複した値があります（${k}）— 同じ日付は1回のみ入力できます` });
      } else {
        seen.set(k, i);
      }
    });
  }

  objectRows.forEach((row, rowIndex) => {
    if (!rowHasValue(row, childFields)) return;
    validateFieldList(childFields, row, rootData, errors, `${path}[${rowIndex + 1}]`);
  });
}
