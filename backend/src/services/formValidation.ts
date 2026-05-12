// Server-side form validation against admin-configured schema.
//
// Honours:
//   - required (skipped when field is hidden via conditional_on)
//   - validation.regex / min / max / maxlength
//   - conditional_on (hidden fields are exempt from required + validation)
//
// Returns array of { field, message }. Empty array = valid.
// Caller decides HTTP response (typically 400 with the array).

export interface FormField {
  name: string;
  label?: string;
  type: string;
  required?: boolean;
  validation?: {
    regex?: string;
    min?: number;
    max?: number;
    maxlength?: number;
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

/**
 * Validate form_data against schema. Hidden (conditional) fields are skipped
 * entirely — neither required nor validation rules apply to them.
 */
export function validateFormData(schema: FormSchema, data: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!schema?.fields) return errors;

  for (const f of schema.fields) {
    // Skip headers (display-only)
    if (f.type === 'header') continue;

    // Conditional visibility — skip entirely if condition not met
    if (f.conditional_on) {
      const got = data[f.conditional_on.field];
      // Loose comparison: form values often arrive as strings even for numeric/boolean
      if (got == null || String(got) !== String(f.conditional_on.equals)) {
        continue;
      }
    }

    const val = data[f.name];
    const empty = val == null || val === '' || (Array.isArray(val) && val.length === 0);

    // Required check
    if (f.required && empty) {
      errors.push({ field: f.name, message: `${f.label ?? f.name} は必須です` });
      continue;  // skip further validation if empty
    }

    if (empty) continue;  // optional + empty = nothing more to check

    // Validation rules
    const v = f.validation;
    if (v) {
      const strVal = String(val);

      if (v.regex) {
        try {
          if (!new RegExp(v.regex).test(strVal)) {
            errors.push({ field: f.name, message: `${f.label ?? f.name} の形式が正しくありません` });
          }
        } catch {
          // Bad regex from admin — log but don't block submit
          console.warn(`[formValidation] invalid regex on field ${f.name}: ${v.regex}`);
        }
      }

      if (v.maxlength != null && strVal.length > v.maxlength) {
        errors.push({ field: f.name, message: `${f.label ?? f.name} は ${v.maxlength} 文字以内` });
      }

      if (f.type === 'number') {
        const num = Number(val);
        if (Number.isFinite(num)) {
          if (v.min != null && num < v.min) {
            errors.push({ field: f.name, message: `${f.label ?? f.name} は ${v.min} 以上` });
          }
          if (v.max != null && num > v.max) {
            errors.push({ field: f.name, message: `${f.label ?? f.name} は ${v.max} 以下` });
          }
        }
      }
    }
  }

  return errors;
}
