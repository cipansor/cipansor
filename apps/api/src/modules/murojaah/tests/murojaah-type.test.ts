import { describe, it, expect } from 'vitest';
import { MurojaahType } from '@prisma/client';
import { createMurojaahSchema, listMurojaahQuerySchema } from '../murojaah.schema';

/**
 * The murojaah type the API accepts must be the database's own enum (#908).
 * The schema used to list DAILY/WEEKLY/MONTHLY/EXAM_PREP: they passed Zod and
 * then Prisma answered "Invalid value for argument `murojaahType`" — a 500 on
 * every save from Tahfidz → Murojaah → Tambah. The e2e found it.
 */
const body = (murojaahType: string) => ({
  studentId: '11111111-1111-4111-8111-111111111111',
  murojaahType,
  murojaahDate: '2026-11-09',
  juzStart: 1,
  juzEnd: 1,
  pagesReviewed: 1,
  durationMinutes: 30,
  qualityScore: 0,
});

describe('murojaahType', () => {
  it('accepts exactly the values of the Prisma enum', () => {
    for (const value of Object.values(MurojaahType)) {
      expect(createMurojaahSchema.safeParse(body(value)).success).toBe(true);
      expect(listMurojaahQuerySchema.safeParse({ murojaahType: value }).success).toBe(true);
    }
  });

  it('rejects a value the database does not have with a 400, not a 500', () => {
    for (const value of ['DAILY', 'WEEKLY', 'MONTHLY', 'EXAM_PREP']) {
      expect(createMurojaahSchema.safeParse(body(value)).success).toBe(false);
    }
  });
});
