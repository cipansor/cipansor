/**
 * The transaction number is `LDR-YYYYMMDD-XXXX` and `transaction_no` is unique
 * across the whole table, not per unit. Two officers saving at the same moment
 * must therefore serialise on the date, not on their unit. This suite creates
 * four units and saves one transaction in each at once: every save must keep a
 * number of its own.
 *
 * Opt-in via RUN_DB_TESTS=1, like the other database integration suites.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { transactionService } from '@/modules/laundry/laundry.service';

const describeDb = process.env.RUN_DB_TESTS ? describe : describe.skip;

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const units = [0, 1, 2, 3].map((n) => ({
  unitId: `it-laundry-unit-${n}-${suffix}`,
  userId: `it-laundry-user-${n}-${suffix}`,
  studentId: `it-laundry-student-${n}-${suffix}`,
  pricingId: `it-laundry-pricing-${n}-${suffix}`,
  nis: `IT${Date.now()}${n}`.slice(0, 20),
}));

describeDb('laundry transaction numbering across units', () => {
  beforeAll(async () => {
    for (const row of units) {
      await prisma.unit.create({
        data: {
          id: row.unitId,
          name: `IT Laundry ${row.unitId}`,
          type: 'SMP_IT',
          address: 'Jalan Pengujian',
        },
      });
      await prisma.user.create({
        data: {
          id: row.userId,
          name: `Petugas ${row.unitId}`,
          email: `${row.userId}@example.test`,
          unitId: row.unitId,
        },
      });
      await prisma.student.create({
        data: {
          id: row.studentId,
          userId: row.userId,
          unitId: row.unitId,
          nis: row.nis,
          gender: 'MALE',
          birthPlace: 'Cipansor',
          birthDate: new Date('2010-01-01'),
          address: 'Jalan Pengujian',
          parentName: 'Orang Tua Pengujian',
          parentPhone: '081200000000',
        },
      });
      await prisma.laundryPricing.create({
        data: {
          id: row.pricingId,
          unitId: row.unitId,
          name: `Reguler ${row.unitId}`,
          pricePerKg: 10000,
        },
      });
    }
  });

  afterAll(async () => {
    const unitIds = units.map((row) => row.unitId);
    await prisma.laundryTransaction.deleteMany({ where: { unitId: { in: unitIds } } });
    await prisma.student.deleteMany({ where: { unitId: { in: unitIds } } });
    await prisma.laundryPricing.deleteMany({ where: { unitId: { in: unitIds } } });
    await prisma.user.deleteMany({ where: { unitId: { in: unitIds } } });
    await prisma.unit.deleteMany({ where: { id: { in: unitIds } } });
  });

  it('gives every unit its own number when four saves run at once', async () => {
    const saved = await Promise.all(
      units.map((row) =>
        transactionService.create(row.unitId, row.userId, {
          studentId: row.studentId,
          pricingId: row.pricingId,
          weight: 1.5,
          paymentMethod: 'CASH',
        } as never)
      )
    );

    const numbers = saved.map((transaction) => transaction.transactionNo);
    expect(numbers).toHaveLength(units.length);
    expect(new Set(numbers).size).toBe(units.length);
    await expect(
      prisma.laundryTransaction.count({ where: { transactionNo: { in: numbers } } })
    ).resolves.toBe(units.length);
  });
});
