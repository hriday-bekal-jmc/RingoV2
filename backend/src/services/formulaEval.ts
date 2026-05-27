// Server-side safe formula evaluator — mirrors frontend/src/utils/formulaEval.ts.
//
// Formulas are admin-configured (not user-supplied), but we still allowlist
// the expression after substitution so only digits/operators/Math calls can
// reach Function(). This prevents any code-injection path.

const SAFE_EXPR = /^[\d\s+\-*/.(),|]+$/;

export function evalFormula(
  formula: string,
  values: Record<string, number>,
): number {
  if (!formula) return 0;
  try {
    let expr = formula
      .replace(/\bMath\.min\b/g, '__min__')
      .replace(/\bMath\.max\b/g, '__max__');

    expr = expr.replace(/\b([a-zA-Z_]\w*)\b/g, (match) => {
      if (match === '__min__' || match === '__max__') return match;
      const v = values[match];
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
      return String(isFinite(n) ? n : 0);
    });

    expr = expr
      .replace(/__min__/g, 'Math.min')
      .replace(/__max__/g, 'Math.max');

    const stripped = expr.replace(/Math\.(min|max)/g, '');
    if (!SAFE_EXPR.test(stripped)) return 0;

    // Formula comes from admin schema, not user input. Allowlist above ensures
    // only arithmetic reaches eval.
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + expr + ')')() as unknown;
    const n = typeof result === 'number' ? result : parseFloat(String(result));
    return isFinite(n) ? Math.round(n * 1e9) / 1e9 : 0;
  } catch {
    return 0;
  }
}

export function formulaDeps(formula: string): string[] {
  if (!formula) return [];
  const reserved = new Set(['Math', 'min', 'max']);
  const matches = formula.match(/\b([a-zA-Z_]\w*)\b/g) ?? [];
  return [...new Set(matches.filter((m) => !reserved.has(m)))];
}
