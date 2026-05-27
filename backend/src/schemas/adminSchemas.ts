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
