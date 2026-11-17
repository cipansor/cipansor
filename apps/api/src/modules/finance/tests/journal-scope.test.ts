import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Akun jurnal manual (#988, R26.7–R26.8). A manual journal belongs to the
 * caller's own unit — only Super_Admin may name another — and every line's
 * account must be usable by that unit: its own, or a shared foundation-wide row
 * (`unitId: null`). The chart of accounts is one shared catalog (`code` is
 * globally unique), so an account created through the app has no unit and must
 * still be postable; one pinned to another unit — or one that does not exist —
 * refuses the whole request with 404, so no partial journal is written.
 */
const { prismaMock, txCreate, txAccountFindMany } = vi.hoisted(() => ({
  prismaMock: { $transaction: vi.fn(), accountCode: { create: vi.fn() } },
  txCreate: vi.fn(),
  txAccountFindMany: vi.fn(),
}));

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

import { createAccount, createManualJournal } from '../accounting.service';

const SD = 'unit-sd';
const SMP = 'unit-smp';

const adminSd = { sub: 'u-sd', roleCode: 'SDIT_ADMIN', unitId: SD };
const superAdmin = { sub: 'u-super', roleCode: 'SUPER_ADMIN', unitId: null };

/** A tiny in-memory stand-in for the account table, so the create path and the
 * journal path run against the same rows rather than a mocked "always owned". */
let store: { id: string; unitId: string | null }[] = [];
let nextId = 0;
const seed = (id: string, unitId: string | null) => store.push({ id, unitId });

const entries = [
  { accountId: 'kas', debit: 1000, credit: 0 },
  { accountId: 'pendapatan', debit: 0, credit: 1000 },
];

beforeEach(() => {
  vi.clearAllMocks();
  store = [];
  nextId = 0;
  txCreate.mockResolvedValue({ id: 'je' });
  prismaMock.accountCode.create.mockImplementation(async (args: any) => {
    const id = `acc-${++nextId}`;
    store.push({ id, unitId: args.data.unitId ?? null });
    return { id, ...args.data };
  });
  txAccountFindMany.mockImplementation(async (args: any) => {
    // Honour the `where` like the database: rows must match the asked ids and,
    // when the query names a unit, that unit too (a null-unit row never matches
    // a named unit). This is what makes the test fail against the strict rule,
    // rather than a mock that returns every asked id regardless.
    const ids: string[] = args.where.id.in;
    const unit = args.where.unitId;
    return store.filter((r) => ids.includes(r.id) && (unit === undefined || r.unitId === unit));
  });
  prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({ journalEntry: { create: txCreate }, accountCode: { findMany: txAccountFindMany } })
  );
});

describe('createManualJournal — unit dan akun', () => {
  it('unit pada body diabaikan: jurnal ditulis di unit pemanggil', async () => {
    seed('kas', SD);
    seed('pendapatan', SD);

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
  });

  it('Super_Admin boleh menulis unit yang dinamai', async () => {
    seed('kas', SMP);
    seed('pendapatan', SMP);

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

  it('akun yang dibuat lewat aplikasi (tanpa unit) boleh dijurnal', async () => {
    // The reviewer's case: create both accounts through the real service, then
    // post a balanced journal with them. The accounts come out unit-less, which
    // must not block the journal.
    const kas = await createAccount({
      code: '1101',
      name: 'Kas',
      type: 'ASSET',
      normalBalance: 'DEBIT',
    });
    const pendapatan = await createAccount({
      code: '4101',
      name: 'Pendapatan',
      type: 'REVENUE',
      normalBalance: 'CREDIT',
    });
    expect(store.find((r) => r.id === kas.id)?.unitId).toBeNull();

    await createManualJournal({
      unitId: SD,
      date: new Date('2026-03-01'),
      description: 'Jurnal',
      entries: [
        { accountId: kas.id, debit: 1000, credit: 0 },
        { accountId: pendapatan.id, debit: 0, credit: 1000 },
      ],
      createdById: 'u-sd',
      actor: adminSd,
    });

    expect(txCreate).toHaveBeenCalledTimes(2);
    expect(txCreate.mock.calls.map(([arg]) => arg.data.unitId)).toEqual([SD, SD]);
  });

  it('akun unit lain menolak seluruh jurnal', async () => {
    seed('kas', SD);
    seed('pendapatan', SMP); // akun milik unit lain

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

  it('akun yang tidak ada menolak seluruh jurnal', async () => {
    seed('kas', SD); // 'pendapatan' tidak ada

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
