// Safe client-side formula evaluator for computed form fields.
//
// Supports: numeric field references, +/-/*//, Math.min, Math.max, parentheses.
// Security: after substituting field values, the resulting expression must
// contain ONLY digits, whitespace, and allowed operators — otherwise returns 0.
//
// Usage:
//   evalFormula("participant_count * 2000", { participant_count: 5 }) // → 10000
//   evalFormula("Math.min(a * 2000, b)", { a: 3, b: 5000 })          // → 5000

const SAFE_EXPR = /^[\d\s+\-*/.(),|]+$/;

export function evalFormula(
  formula: string,
  values: Record<string, unknown>,
): number {
  if (!formula) return 0;
  try {
    // Protect built-in identifiers before field-name substitution
    let expr = formula
      .replace(/\bMath\.min\b/g, '__min__')
      .replace(/\bMath\.max\b/g, '__max__')
      .replace(/\bNumber\b/g,    '__Number__');

    // Replace every word-boundary identifier with its numeric value (0 if missing)
    expr = expr.replace(/\b([a-zA-Z_]\w*)\b/g, (match) => {
      if (match === '__min__' || match === '__max__' || match === '__Number__') return match;
      const v = values[match];
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
      return String(isFinite(n) ? n : 0);
    });

    // Restore built-ins
    expr = expr
      .replace(/__min__/g,    'Math.min')
      .replace(/__max__/g,    'Math.max')
      .replace(/__Number__/g, 'Number');

    // Allowlist check — after substitution only digits/ops/Math/Number calls allowed
    const stripped = expr.replace(/Math\.(min|max)/g, '').replace(/Number/g, '');
    if (!SAFE_EXPR.test(stripped)) return 0;

    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + expr + ')')() as unknown;
    const n = typeof result === 'number' ? result : parseFloat(String(result));
    return isFinite(n) ? Math.round(n * 1e9) / 1e9 : 0;
  } catch {
    return 0;
  }
}

// Extract field names referenced in a formula string.
export function formulaDeps(formula: string): string[] {
  if (!formula) return [];
  const reserved = new Set(['Math', 'min', 'max', 'Number']);
  const matches = formula.match(/\b([a-zA-Z_]\w*)\b/g) ?? [];
  return [...new Set(matches.filter((m) => !reserved.has(m)))];
}
