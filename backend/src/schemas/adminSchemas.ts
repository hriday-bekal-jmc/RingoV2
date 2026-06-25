import { z } from 'zod';

const BUSINESS_ROLES = [
  'SHITSUCHO', 'GM', 'SENIOR_MANAGER', 'MANAGER', 'SUB_MANAGER',
  'SUB_MANAGER_TSUKI', 'LEADER', 'SUB_LEADER', 'CHIEF', 'MEMBER',
  'SENMU', 'PRESIDENT',
] as const;
const STAGES = ['RINGI', 'SETTLEMENT'] as const;
const ACTION_TYPES = ['APPROVE', 'CONFIRM'] as const;

export const createUserSchema = z.object({
  full_name:     z.string().min(1).max(100),
  email:         z.string().email().max(255),
  role:          z.enum(BUSINESS_ROLES),
  is_admin:      z.boolean().optional(),
  department_id: z.string().uuid().optional().nullable(),
  password:      z.string().min(8).max(128).optional(),
  is_active:     z.boolean().optional(),
});
export type CreateUserBody = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  full_name:     z.string().min(1).max(100).optional(),
  email:         z.string().email().max(255).optional(),
  role:          z.enum(BUSINESS_ROLES).optional(),
  is_admin:      z.boolean().optional(),
  department_id: z.string().uuid().optional().nullable(),
  password:      z.string().min(8).max(128).optional(),
  is_active:     z.boolean().optional(),
});
export type UpdateUserBody = z.infer<typeof updateUserSchema>;

export const createRouteSchema = z.object({
  template_id:   z.string().uuid(),
  department_id: z.string().uuid(),
  name:          z.string().min(1).max(200),
  stage:         z.enum(STAGES).optional(),
});
export type CreateRouteBody = z.infer<typeof createRouteSchema>;

export const addRouteStepSchema = z.object({
  approver_id:  z.string().uuid().optional(),
  label:        z.string().max(255).optional(),
  action_type:  z.enum(ACTION_TYPES).optional(),
  insert_after: z.number().int().nonnegative().optional(),
});
export type AddRouteStepBody = z.infer<typeof addRouteStepSchema>;

export const updatePermissionsSchema = z.object({
  canSubmit:  z.boolean(),
  canApprove: z.boolean(),
  canSettle:  z.boolean(),
  canAdmin:   z.boolean(),
  navPages:   z.array(z.string().max(50)).max(50),
});
export type UpdatePermissionsBody = z.infer<typeof updatePermissionsSchema>;

// ── Routing V2 schemas ────────────────────────────────────────────────────────

export const createSlotSchema = z.object({
  label_ja:  z.string().min(1).max(100),
  slot_type: z.enum(['RINGI', 'SETTLEMENT', 'CONFIRM']),
});
export type CreateSlotBody = z.infer<typeof createSlotSchema>;

export const upsertPatternSchema = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  slot_ids:    z.array(z.string().uuid()).max(30),
});
export type UpsertPatternBody = z.infer<typeof upsertPatternSchema>;

export const upsertUserSlotsSchema = z.object({
  slots: z.array(z.object({
    slot_id:     z.string().uuid(),
    approver_id: z.string().uuid().nullable(),
  })).min(1).max(20),
});
export type UpsertUserSlotsBody = z.infer<typeof upsertUserSlotsSchema>;

export const copyFromUserSchema = z.object({
  source_user_id: z.string().uuid(),
  force:          z.boolean().optional(),
});
export type CopyFromUserBody = z.infer<typeof copyFromUserSchema>;

export const bulkUpdateSlotSchema = z.object({
  department_id: z.string().uuid(),
  slot_id:       z.string().uuid(),
  approver_id:   z.string().uuid().nullable(),
});
export type BulkUpdateSlotBody = z.infer<typeof bulkUpdateSlotSchema>;

export const upsertTemplatePatternsSchema = z.object({
  patterns: z.array(z.object({
    pattern_id: z.string().uuid(),
    is_default: z.boolean(),
    priority:   z.number().int().nonnegative(),
  })),
});
export type UpsertTemplatePatternsBody = z.infer<typeof upsertTemplatePatternsSchema>;

export const upsertConditionsSchema = z.object({
  conditions: z.array(z.object({
    pattern_id:      z.string().uuid(),
    user_id:         z.string().uuid().nullable().optional(),
    condition_type:  z.enum(['AMOUNT_LT', 'AMOUNT_GTE', 'DEPT_IN', 'DEPT_NOT_IN']),
    condition_value: z.string().min(1),
    stop_at_slot_id: z.string().uuid(),
  })),
});
export type UpsertConditionsBody = z.infer<typeof upsertConditionsSchema>;
