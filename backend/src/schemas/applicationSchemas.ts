import { z } from 'zod';

const formDataSchema = z.record(z.string(), z.unknown());

export const createApplicationSchema = z.object({
  template_id: z.string().uuid(),
  form_data:   formDataSchema,
});
export type CreateApplicationBody = z.infer<typeof createApplicationSchema>;

export const saveApplicationSchema = z.object({
  form_data: formDataSchema,
});
export type SaveApplicationBody = z.infer<typeof saveApplicationSchema>;

export const submitApplicationSchema = z.object({
  form_data:  formDataSchema.optional(),
  pattern_id: z.string().uuid().optional().nullable(),
});
export type SubmitApplicationBody = z.infer<typeof submitApplicationSchema>;

export const startSettlementSchema = z.object({
  settlement_data: formDataSchema,
  pattern_id:      z.string().uuid().optional().nullable(),
});
export type StartSettlementBody = z.infer<typeof startSettlementSchema>;

export const submitSettlementSchema = z.object({
  settlement_data: formDataSchema,
  pattern_id:      z.string().uuid().optional().nullable(),
});
export type SubmitSettlementBody = z.infer<typeof submitSettlementSchema>;

export const adminSubmitSchema = z.object({
  template_id: z.string().uuid(),
  stage:       z.enum(['RINGI', 'SETTLEMENT']),
  form_data:   formDataSchema,
  pattern_id:  z.string().uuid().optional().nullable(),
});
export type AdminSubmitBody = z.infer<typeof adminSubmitSchema>;
