import { describe, expect, it } from 'vitest';
import { skipStepsThroughApplicant, type ResolvedStep } from './approvalStepService';

const step = (order: number, approverId: string): ResolvedStep => ({
  step_order:  order,
  approver_id: approverId,
  label:       `step-${order}`,
  action_type: 'APPROVE',
});

describe('skipStepsThroughApplicant', () => {
  it('keeps full route when applicant is not an approver', () => {
    const steps = [step(1, 'manager'), step(2, 'section-head')];

    const result = skipStepsThroughApplicant(steps, 'employee');

    expect(result.steps).toEqual(steps);
    expect(result.skipped_steps).toBe(0);
    expect(result.skipped_through_step_order).toBeNull();
  });

  it('starts after applicant first appears in route', () => {
    const steps = [step(1, 'manager'), step(2, 'section-head'), step(3, 'gm')];

    const result = skipStepsThroughApplicant(steps, 'section-head');

    expect(result.steps).toEqual([step(3, 'gm')]);
    expect(result.skipped_steps).toBe(2);
    expect(result.skipped_through_step_order).toBe(2);
  });

  it('uses first applicant match when applicant appears more than once', () => {
    const steps = [step(1, 'manager'), step(2, 'section-head'), step(3, 'section-head'), step(4, 'gm')];

    const result = skipStepsThroughApplicant(steps, 'section-head');

    expect(result.steps).toEqual([step(3, 'section-head'), step(4, 'gm')]);
    expect(result.skipped_steps).toBe(2);
    expect(result.skipped_through_step_order).toBe(2);
  });

});
