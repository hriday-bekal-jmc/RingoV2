import { describe, expect, it } from 'vitest';
import { applyComputedFormData, validateFormData, type FormSchema } from './formValidation';

const schema: FormSchema = {
  fields: [
    {
      name: 'manual_fee',
      label: 'Manual fee',
      type: 'number',
      sum_target: 'total_amount',
    },
    {
      name: 'total_amount',
      label: 'Total amount',
      type: 'number',
      computed: true,
    },
    {
      name: 'transport_lines',
      label: 'Transport lines',
      type: 'repeat_group',
      required: true,
      min_rows: 1,
      max_rows: 3,
      fields: [
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'vehicle', label: 'Vehicle', type: 'text', required: true },
        { name: 'amount', label: 'Amount', type: 'number', required: true, sum_target: 'total_amount', validation: { min: 0 } },
        { name: 'receipt', label: 'Receipt', type: 'file' },
      ],
    },
  ],
};

describe('validateFormData repeat_group', () => {
  it('accepts bounded row objects', () => {
    const errors = validateFormData(schema, {
      transport_lines: [
        { date: '2026-05-15', vehicle: 'Train', amount: 1200, receipt: '/api/files/abc' },
        { date: '2026-05-16', vehicle: 'Taxi', amount: 0 },
      ],
    });

    expect(errors).toEqual([]);
  });

  it('ignores empty optional rows but enforces required child fields on filled rows', () => {
    const errors = validateFormData(schema, {
      transport_lines: [
        {},
        { date: '2026-05-15', amount: 500 },
      ],
    });

    expect(errors).toEqual([
      { field: 'transport_lines[2].vehicle', message: 'Vehicle is required' },
    ]);
  });

  it('rejects too many rows before nested validation work', () => {
    const errors = validateFormData(schema, {
      transport_lines: [
        { date: '2026-05-15', vehicle: 'Train', amount: 1 },
        { date: '2026-05-16', vehicle: 'Bus', amount: 2 },
        { date: '2026-05-17', vehicle: 'Taxi', amount: 3 },
        { date: '2026-05-18', vehicle: 'Plane', amount: 4 },
      ],
    });

    expect(errors).toEqual([
      { field: 'transport_lines', message: 'Transport lines allows up to 3 row(s)' },
    ]);
  });

  it('recomputes top-level totals from direct and repeat-group sources', () => {
    const normalized = applyComputedFormData(schema, {
      manual_fee: 300,
      total_amount: 999999,
      transport_lines: [
        { date: '2026-05-15', vehicle: 'Train', amount: 1200 },
        { date: '2026-05-16', vehicle: 'Taxi', amount: 800 },
      ],
    });

    expect(normalized.total_amount).toBe(2300);
  });
});
