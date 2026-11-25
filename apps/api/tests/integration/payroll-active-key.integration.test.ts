/**
 * A cancelled period must free its unit/month/year slot without losing its
 * history (#990). The guarantee lives in the `active_key` unique index, so it
 * is proved against PostgreSQL: a mock would accept two rows the database
 * rejects. Opt-in via RUN_DB_TESTS=1.
 */
import { describe, it, expect, vi } from 'vitest';
import { prisma } from '@/lib/prisma';

const describeDb = process.env.RUN_DB_TESTS ? describe : describe.skip;
vi.setConfig({ testTimeout: 30_000 });

async function fixture() {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const unit = await prisma.unit.create({
    data: { name: `Payroll Key ${stamp}`, type: 'SMP_IT', address: 'test' },
  });
  const user = await prisma.user.create({
    data: { name: `Payroll Key ${stamp}`, email: `payroll-key-${stamp}@example.test` },
  });
  return { unit, user };
}

async function cleanup({ unit, user }: Awaited<ReturnType<typeof fixture>>) {
  await prisma.payrollPeriod.deleteMany({ where: { unitId: unit.id } });
  await prisma.user.deleteMany({ where: { id: user.id } });
  await prisma.unit.deleteMany({ where: { id: unit.id } });
}

describeDb('PayrollPeriod — a cancelled period frees the month', () => {
  it('creates a replacement for the same unit, month and year after cancellation', async () => {
    const data = await fixture();
    const key = `${data.unit.id}:7:2026`;
    const period = {
      unitId: data.unit.id,
      name: 'Gaji Juli 2026',
      month: 7,
      year: 2026,
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-07-31'),
      createdById: data.user.id,
    };
    try {
      const original = await prisma.payrollPeriod.create({
        data: { ...period, activeKey: key },
      });

      await prisma.payrollPeriod.update({
        where: { id: original.id },
        data: { status: 'CANCELLED', activeKey: null },
      });

      const replacement = await prisma.payrollPeriod.create({
        data: { ...period, activeKey: key },
      });

      const cancelled = await prisma.payrollPeriod.findUniqueOrThrow({
        where: { id: original.id },
      });
      expect(cancelled.activeKey).toBeNull();
      expect(cancelled.status).toBe('CANCELLED');
      expect(replacement.activeKey).toBe(key);
    } finally {
      await cleanup(data);
    }
  });

  it('refuses two active periods for the same unit, month and year', async () => {
    const data = await fixture();
    const key = `${data.unit.id}:8:2026`;
    const period = {
      unitId: data.unit.id,
      name: 'Gaji Agustus 2026',
      month: 8,
      year: 2026,
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-08-31'),
      createdById: data.user.id,
      activeKey: key,
    };
    try {
      await prisma.payrollPeriod.create({ data: period });
      await expect(prisma.payrollPeriod.create({ data: period })).rejects.toMatchObject({
        code: 'P2002',
      });
    } finally {
      await cleanup(data);
    }
  });
});
