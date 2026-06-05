// Server-side safe formula evaluator — mirrors frontend/src/utils/formulaEval.ts.
//
// Uses a recursive-descent AST parser instead of Function()/eval() to eliminate
// any code-execution surface. Supports: +, -, *, /, unary minus, parentheses,
// Math.min(...), Math.max(...), numeric literals.

// ── Tokeniser ────────────────────────────────────────────────────────────────
type FnName = 'min' | 'max' | 'round' | 'abs' | 'floor' | 'ceil';
type Token = { type: 'num'; val: number }
           | { type: 'op';  val: string }
           | { type: 'lparen' | 'rparen' | 'comma' }
           | { type: 'fn';  val: FnName };

// Longest-match first so 'Math.round' isn't mistaken for 'Math.ro...'.
const FN_TOKENS: { src: string; val: FnName }[] = [
  { src: 'Math.round', val: 'round' },
  { src: 'Math.floor', val: 'floor' },
  { src: 'Math.ceil',  val: 'ceil'  },
  { src: 'Math.min',   val: 'min'   },
  { src: 'Math.max',   val: 'max'   },
  { src: 'Math.abs',   val: 'abs'   },
];

function tokenise(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/\d|\./.test(ch)) {
      let s = '';
      while (i < expr.length && /[\d.]/.test(expr[i])) s += expr[i++];
      tokens.push({ type: 'num', val: parseFloat(s) });
      continue;
    }
    const fn = FN_TOKENS.find((f) => expr.slice(i, i + f.src.length) === f.src);
    if (fn) {
      tokens.push({ type: 'fn', val: fn.val }); i += fn.src.length;
    } else if ('+-*/%'.includes(ch)) {
      tokens.push({ type: 'op', val: ch }); i++;
    } else if (ch === '(') { tokens.push({ type: 'lparen' });  i++; }
    else if (ch === ')') { tokens.push({ type: 'rparen' }); i++; }
    else if (ch === ',') { tokens.push({ type: 'comma' });  i++; }
    else { throw new Error(`Unexpected char: ${ch}`); }
  }
  return tokens;
}

// ── Recursive-descent parser ─────────────────────────────────────────────────
function parse(tokens: Token[]): number {
  let pos = 0;
  const peek  = () => tokens[pos];
  const eat   = () => tokens[pos++];
  const done  = () => pos >= tokens.length;

  function parseExpr(): number { return parseAdd(); }

  function parseAdd(): number {
    let left = parseMul();
    while (!done() && peek().type === 'op' && (peek() as any).val === '+' || (!done() && peek().type === 'op' && (peek() as any).val === '-')) {
      const op = (eat() as any).val;
      const right = parseMul();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseMul(): number {
    let left = parseUnary();
    while (!done() && peek().type === 'op' && ('*/%'.includes((peek() as any).val))) {
      const op = (eat() as any).val;
      const right = parseUnary();
      if (op === '*') left = left * right;
      else if (op === '/') left = right === 0 ? 0 : left / right;
      else left = right === 0 ? 0 : left % right; // modulo
    }
    return left;
  }

  function parseUnary(): number {
    if (!done() && peek().type === 'op' && (peek() as any).val === '-') {
      eat();
      return -parseAtom();
    }
    return parseAtom();
  }

  function parseAtom(): number {
    const tok = peek();
    if (!tok) return 0;
    if (tok.type === 'num') { eat(); return tok.val; }
    if (tok.type === 'fn') {
      const fn = tok.val; eat();
      if (peek()?.type !== 'lparen') throw new Error('Expected (');
      eat();
      const args: number[] = [parseExpr()];
      while (peek()?.type === 'comma') { eat(); args.push(parseExpr()); }
      if (peek()?.type !== 'rparen') throw new Error('Expected )');
      eat();
      switch (fn) {
        case 'min':   return Math.min(...args);
        case 'max':   return Math.max(...args);
        case 'round': return Math.round(args[0]);
        case 'abs':   return Math.abs(args[0]);
        case 'floor': return Math.floor(args[0]);
        case 'ceil':  return Math.ceil(args[0]);
      }
      return 0;
    }
    if (tok.type === 'lparen') {
      eat();
      const val = parseExpr();
      if (peek()?.type !== 'rparen') throw new Error('Expected )');
      eat();
      return val;
    }
    return 0;
  }

  const result = parseExpr();
  return result;
}

export function evalFormula(
  formula: string,
  values: Record<string, number>,
): number {
  if (!formula) return 0;
  try {
    // Substitute variable names with their numeric values
    const reserved = new Set(['Math', 'min', 'max', 'round', 'abs', 'floor', 'ceil']);
    const expr = formula
      .replace(/\b([a-zA-Z_]\w*)\b/g, (match) => {
        if (reserved.has(match)) return match;
        const v = values[match];
        const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
        return String(isFinite(n) ? n : 0);
      });
    const result = parse(tokenise(expr));
    return isFinite(result) ? Math.round(result * 1e9) / 1e9 : 0;
  } catch {
    return 0;
  }
}

export function formulaDeps(formula: string): string[] {
  if (!formula) return [];
  const reserved = new Set(['Math', 'min', 'max', 'round', 'abs', 'floor', 'ceil']);
  const matches = formula.match(/\b([a-zA-Z_]\w*)\b/g) ?? [];
  return [...new Set(matches.filter((m) => !reserved.has(m)))];
}
