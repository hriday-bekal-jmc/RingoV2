// Approval chain resolver — User × Pattern cross-reference model.
//
// Each applicant has 18 named slot assignments (user_approval_slots).
// Each approval pattern marks which slots are active (approval_pattern_slots).
// Chain = applicant's assigned approvers × pattern's active slots, filtered by stage.
//
// NULL approver_id in a slot = admin left it empty = silently skip.
// stageFilter = 'RINGI' | 'SETTLEMENT' | null (null returns all slot types).

import type pg from 'pg';
import type { ResolvedStep } from './approvalStepService';

export type SlotType = 'RINGI' | 'SETTLEMENT' | 'CONFIRM';

export interface ChainContext {
  applicantId:  string;
  departmentId: string | null;
  templateId:   string;
  formData:     Record<string, unknown>;
  patternId?:   string;           // caller-supplied pattern (secondary pattern override)
  stageFilter?: SlotType | null;  // filter chain to one stage; null = all
}

interface SlotRow {
  id:         string;
  slot_code:  string;
  label_ja:   string;
  slot_type:  SlotType;
  sort_order: number;
}

interface SlotAssignment extends SlotRow {
  slot_id:     string;
  approver_id: string | null;
}

interface ConditionRule {
  condition_type:  'AMOUNT_LT' | 'AMOUNT_GTE' | 'DEPT_IN' | 'DEPT_NOT_IN';
  condition_value: string;
  stop_at_slot_id: string;
}

// ── Main resolver ─────────────────────────────────────────────────────────────
export async function resolveChainFromUserSlots(
  client: pg.PoolClient,
  ctx:    ChainContext,
): Promise<{ steps: ResolvedStep[]; patternId: string }> {
  const patternId   = await resolvePatternId(client, ctx);
  const activeSlots = await loadPatternSlots(client, patternId);
  const assignments = await loadUserSlotAssignments(client, ctx.applicantId, activeSlots, ctx.departmentId);
  const stopSlotId  = await evaluateConditions(client, ctx, patternId);
  const steps       = buildChain(assignments, stopSlotId, ctx.stageFilter ?? null);
  return { steps, patternId };
}

// ── Preview (no condition evaluation — for route-preview UI) ─────────────────
export async function previewChainForUser(
  client:      pg.PoolClient,
  applicantId: string,
  templateId:  string,
  patternId?:  string,
): Promise<{
  steps:        ResolvedStep[];
  pattern_name: string;
  pattern_id:   string;
  all_patterns: Array<{ id: string; name: string; is_default: boolean }>;
}> {
  const ctx: ChainContext = { applicantId, departmentId: null, templateId, formData: {}, patternId };
  const resolvedPatternId = await resolvePatternId(client, ctx);

  const [patternRes, allPatternsRes, activeSlots] = await Promise.all([
    client.query(`SELECT name FROM approval_patterns WHERE id = $1`, [resolvedPatternId]),
    client.query(
      `SELECT ap.id, ap.name, ftp.is_default
       FROM form_template_patterns ftp
       JOIN approval_patterns ap ON ap.id = ftp.pattern_id
       WHERE ftp.template_id = $1 AND ap.is_active = TRUE
       ORDER BY ftp.is_default DESC, ftp.priority DESC`,
      [templateId],
    ),
    loadPatternSlots(client, resolvedPatternId),
  ]);

  const assignments = await loadUserSlotAssignments(client, applicantId, activeSlots, null);

  // Preview shows full chain (no stage filter, no conditions) so user sees all approvers
  const steps = buildChain(assignments, null, null);

  return {
    steps,
    pattern_name: (patternRes.rows[0] as { name: string } | undefined)?.name ?? '',
    pattern_id:   resolvedPatternId,
    all_patterns: allPatternsRes.rows as Array<{ id: string; name: string; is_default: boolean }>,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function resolvePatternId(client: pg.PoolClient, ctx: ChainContext): Promise<string> {
  // Caller-supplied pattern takes precedence if it's actually assigned to this template
  if (ctx.patternId) {
    const check = await client.query(
      `SELECT 1 FROM form_template_patterns WHERE template_id = $1 AND pattern_id = $2`,
      [ctx.templateId, ctx.patternId],
    );
    if (check.rows.length > 0) return ctx.patternId;
  }

  const res = await client.query(
    `SELECT pattern_id FROM form_template_patterns
     WHERE template_id = $1 AND is_default = TRUE
     ORDER BY priority DESC LIMIT 1`,
    [ctx.templateId],
  );
  if (res.rows.length === 0) {
    throw Object.assign(
      new Error('この申請フォームには承認パターンが設定されていません。管理者にお問い合わせください。'),
      { status: 422 },
    );
  }
  return res.rows[0].pattern_id as string;
}

async function loadPatternSlots(client: pg.PoolClient, patternId: string): Promise<SlotRow[]> {
  const res = await client.query(
    `SELECT s.id, s.slot_code, s.label_ja, s.slot_type, s.sort_order
     FROM approval_pattern_slots aps
     JOIN approval_slots s ON s.id = aps.slot_id
     WHERE aps.pattern_id = $1
     ORDER BY s.sort_order ASC`,
    [patternId],
  );
  return res.rows as SlotRow[];
}

async function loadUserSlotAssignments(
  client:       pg.PoolClient,
  applicantId:  string,
  activeSlots:  SlotRow[],
  departmentId: string | null,
): Promise<SlotAssignment[]> {
  if (activeSlots.length === 0) return [];
  const slotIds = activeSlots.map((s) => s.id);
  // Priority: user slot → dept slot fallback → NULL (skip)
  // COALESCE(uas.approver_id, das.approver_id): user assignment wins; dept is fallback when user row absent or NULL
  const res = await client.query(
    `SELECT s.id AS slot_id, s.slot_code, s.label_ja, s.slot_type, s.sort_order,
            COALESCE(uas.approver_id, das.approver_id) AS approver_id
     FROM approval_slots s
     LEFT JOIN user_approval_slots uas ON uas.slot_id = s.id AND uas.user_id = $1
     LEFT JOIN dept_approval_slots das ON das.slot_id = s.id AND das.department_id = $2
     WHERE s.id = ANY($3::uuid[])
     ORDER BY s.sort_order ASC`,
    [applicantId, departmentId, slotIds],
  );
  return res.rows as SlotAssignment[];
}

async function evaluateConditions(
  client:    pg.PoolClient,
  ctx:       ChainContext,
  patternId: string,
): Promise<string | null> {
  const res = await client.query(
    `SELECT condition_type, condition_value, stop_at_slot_id
     FROM approval_conditions
     WHERE template_id = $1 AND pattern_id = $2
       AND (user_id IS NULL OR user_id = $3)
     ORDER BY user_id NULLS LAST`,
    [ctx.templateId, patternId, ctx.applicantId],
  );
  if (res.rows.length === 0) return null;

  const amount = extractAmount(ctx.formData);
  for (const rule of res.rows as ConditionRule[]) {
    if (matchesCondition(rule, amount, ctx.departmentId)) {
      return rule.stop_at_slot_id;
    }
  }
  return null;
}

function extractAmount(formData: Record<string, unknown>): number {
  const candidates = [
    'amount', 'total', 'grand_total', 'total_amount',
    'request_amount', 'settlement_total', 'estimated_amount',
  ];
  for (const key of candidates) {
    const v = formData[key];
    if (v != null) {
      const n = parseFloat(String(v));
      if (isFinite(n)) return n;
    }
  }
  for (const v of Object.values(formData)) {
    const n = parseFloat(String(v ?? ''));
    if (isFinite(n) && n > 0) return n;
  }
  return 0;
}

function matchesCondition(rule: ConditionRule, amount: number, departmentId: string | null): boolean {
  switch (rule.condition_type) {
    case 'AMOUNT_LT':
      return amount < parseFloat(rule.condition_value);
    case 'AMOUNT_GTE':
      return amount >= parseFloat(rule.condition_value);
    case 'DEPT_IN':
      return !!departmentId && rule.condition_value.split(',').map((s) => s.trim()).includes(departmentId);
    case 'DEPT_NOT_IN':
      return !departmentId || !rule.condition_value.split(',').map((s) => s.trim()).includes(departmentId);
    default:
      return false;
  }
}

function buildChain(
  assignments: SlotAssignment[],
  stopSlotId:  string | null,
  stageFilter: SlotType | null,
): ResolvedStep[] {
  const steps: ResolvedStep[] = [];
  let order = 1;

  for (const slot of assignments) {
    // Skip slots that don't match the current stage (RINGI vs SETTLEMENT vs CONFIRM)
    if (stageFilter && slot.slot_type !== stageFilter) continue;
    // NULL approver_id = admin left this slot empty for this user → silently skip
    if (!slot.approver_id) continue;

    const actionType = slot.slot_type === 'CONFIRM' ? 'CONFIRM' : 'APPROVE';
    steps.push({
      step_order:  order++,
      approver_id: slot.approver_id,
      label:       slot.label_ja,
      action_type: actionType,
    });

    // stopSlotId = condition match → include this slot then halt
    if (stopSlotId && slot.slot_id === stopSlotId) break;
  }

  return steps;
}
