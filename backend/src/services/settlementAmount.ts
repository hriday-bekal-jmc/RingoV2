// Settlement amount resolution — single source of truth.
//
// The displayed/authoritative settlement amount is recomputed live from
// settlement_data (JSONB) against the current schema, because stored numeric
// columns can be stale (pre-amount_field submissions). When accounting has
// adjusted the total, the override (adjusted_amount) always wins.
//
// Used by: accounting list, amount-adjust endpoint, close flow.

export interface SchemaField {
  name: string;
  type: string;
  computed?: boolean;
  formula?: string;
  sum_target?: string;
  amount_field?: boolean;
}
export interface FormSchema { fields?: SchemaField[] }

const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return isFinite(n) ? n : 0;
};

/**
 * Recompute the amount from form/settlement data using the schema's amount field.
 * Priority: explicit amount_field → computed+formula → grand_total → sum_target → computed → first number.
 */
export function pickAmount(schema: FormSchema | null, data: Record<string, unknown> | null): number {
  if (!data) return 0;
  const fields = (schema?.fields ?? []).filter((f) => f.type === 'number');
  const explicit = fields.filter((f) => f.amount_field);
  if (explicit.length) return toNum(data[explicit[explicit.length - 1].name]);
  const formula = fields.filter((f) => f.computed && f.formula);
  if (formula.length) return toNum(data[formula[formula.length - 1].name]);
  if (data.grand_total != null) return toNum(data.grand_total);
  const summed = fields.filter((f) => f.computed && f.sum_target);
  if (summed.length) return toNum(data[summed[summed.length - 1].name]);
  const computed = fields.filter((f) => f.computed);
  if (computed.length) return toNum(data[computed[computed.length - 1].name]);
  if (fields.length) return toNum(data[fields[0].name]);
  return 0;
}

/**
 * The final settlement amount: accounting's override wins, else the live recompute.
 * adjustedAmount is the settlements.adjusted_amount column (null = not adjusted).
 */
export function resolveFinalAmount(
  adjustedAmount: number | string | null | undefined,
  schema: FormSchema | null,
  data: Record<string, unknown> | null,
): number {
  if (adjustedAmount !== null && adjustedAmount !== undefined) return toNum(adjustedAmount);
  return pickAmount(schema, data);
}
