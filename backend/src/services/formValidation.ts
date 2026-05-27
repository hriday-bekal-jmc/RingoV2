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
  formula?: string;
  sum_target?: string;
  fields?: FormField[];
  min_rows?: number;
  max_rows?: number;
  validation?: {
    regex?: string;
    min?: number;
    max?: number;
    maxlength?: number;
    /** Time fields: HH:mm boundary strings, step in minutes (informational, not re-validated here) */
    min_time?: string;
    max_time?: string;
  };
  conditional_on?: {
    field: string;
    equals: string | number | boolean;
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
  return got != null && String(got) === String(field.conditional_on.equals);
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

  if (computedTargets.size === 0 && formulaFields.length === 0) return data;

  const next: Record<string, unknown> = { ...data };
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
      if (child.type !== 'number' || !child.sum_target) continue;
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
          errors.push({ field: path, message: `${field.label ?? field.name} format is invalid` });
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
      }
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
  const minRows = boundedInt(field.min_rows, field.required ? 1 : 0, 0, maxRows);

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

  objectRows.forEach((row, rowIndex) => {
    if (!rowHasValue(row, childFields)) return;
    validateFieldList(childFields, row, rootData, errors, `${path}[${rowIndex + 1}]`);
  });
}
