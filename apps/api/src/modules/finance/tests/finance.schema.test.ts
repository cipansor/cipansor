import { describe, expect, it } from 'vitest';
import { createInvoiceSchema, updateInvoiceSchema } from '../finance.schema';

// A bill's deadline is a calendar day, not an instant. The contract accepts
// "YYYY-MM-DD" (what the web date inputs send and what the Swagger says is a
// `format: date`), and refuses a full timestamp — accepting one would let the
// writer silently truncate a time the caller meant.
describe('invoice deadline is a calendar day', () => {
  const base = {
    studentId: '11111111-1111-4111-8111-111111111111',
    paymentTypeId: '22222222-2222-4222-8222-222222222222',
    amount: 350000,
  };

  it('accepts a date-only deadline on create', () => {
    expect(createInvoiceSchema.safeParse({ ...base, dueDate: '2026-08-10' }).success).toBe(true);
  });

  it('refuses an instant on create', () => {
    // The reviewer's example: a caller sends a time, and it would be dropped.
    const parsed = createInvoiceSchema.safeParse({
      ...base,
      dueDate: '2026-08-10T12:00:00.000Z',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a date-only deadline on update and refuses an instant', () => {
    expect(updateInvoiceSchema.safeParse({ dueDate: '2026-08-10' }).success).toBe(true);
    expect(updateInvoiceSchema.safeParse({ dueDate: '2026-08-10T12:00:00Z' }).success).toBe(false);
  });
});
