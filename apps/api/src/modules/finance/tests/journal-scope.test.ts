import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cakupan jurnal manual (#988, R26.7–R26.8). A manual journal belongs to the
 * caller's own unit — only Super_Admin may name another — and every line's
 * account must belong to that unit. A shared (`unitId: null`) account is not
 * enough, and one bad line refuses the whole request with 404, so no partial
 * journal is written.
 */
const { prismaMock, txCreate, txAccountFindMany } = vi.hoisted(() => ({
  prismaMock: { $transaction: vi.fn() },
  txCreate: vi.fn(),
  txAccountFindMany: vi.fn(),
}));

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

import { createManualJournal } from '../accounting.service';

const SD = 'unit-sd';
const SMP = 'unit-smp';

const adminSd = { sub: 'u-sd', roleCode: 'SDIT_ADMIN', unitId: SD };
const superAdmin = { sub: 'u-super', roleCode: 'SUPER_ADMIN', unitId: null };

const entries = [
  { accountId: 'kas', debit: 1000, credit: 0 },
  { accountId: 'pendapatan', debit: 0, credit: 1000 },
];

beforeEach(() => {
  vi.clearAllMocks();
  txCreate.mockResolvedValue({ id: 'je' });
  txAccountFindMany.mockImplementation(async (args: any) =>
    (args.where.id.in as string[]).map((id) => ({ id }))
  );
  prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({ journalEntry: { create: txCreate }, accountCode: { findMany: txAccountFindMany } })
  );
});

describe('createManualJournal — unit jurnal', () => {
  it('unit pada body diabaikan: jurnal ditulis di unit pemanggil', async () => {
    await createManualJournal({
      unitId: SMP,
      date: new Date('2026-03-01'),
      description: 'Jurnal',
      entries,
      createdById: 'u-sd',
      actor: adminSd,
    });

    const units = txCreate.mock.calls.map(([arg]) => arg.data.unitId);
    expect(units).toEqual([SD, SD]);
    expect(txAccountFindMany.mock.calls[0][0].where.unitId).toBe(SD);
  });

  it('Super_Admin boleh menulis unit yang dinamai', async () => {
    await createManualJournal({
      unitId: SMP,
      date: new Date('2026-03-01'),
      description: 'Jurnal',
      entries,
      createdById: 'u-super',
      actor: superAdmin,
    });

    expect(txCreate.mock.calls[0][0].data.unitId).toBe(SMP);
  });

  it('akun unit lain (atau akun bersama) menolak seluruh jurnal', async () => {
    txAccountFindMany.mockResolvedValue([{ id: 'kas' }]); // 'pendapatan' tidak dimiliki unit

    await expect(
      createManualJournal({
        unitId: SD,
        date: new Date('2026-03-01'),
        description: 'Jurnal',
        entries,
        createdById: 'u-sd',
        actor: adminSd,
      })
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(txCreate).not.toHaveBeenCalled();
  });
});
