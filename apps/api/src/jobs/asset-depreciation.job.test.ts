import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

// `runMonthlyDepreciation` builds its period from the host clock. The API
// container sets no TZ, so `getFullYear()`/`getMonth()` read UTC: a run at
// 00:00–06:59 WIB (the first hours of the WIB month — and, on 1 January, the
// first hours of the WIB year) stamps the month that just ended. That string is
// both the reference written to the journal and the idempotence key, so the
// wrong month is stored and the "already ran this month?" check never matches
// the previous run, writing the same month's journal again.
//
// Same trap already fixed for the other monthly jobs (finance-billing.job.ts,
// spp-reminder.job.ts), which derive the month from `wibMonthYear`.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    unit: { findMany: vi.fn() },
    setting: { findMany: vi.fn() },
    asset: { findMany: vi.fn() },
    journalEntry: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@prisma/client', () => ({
  AssetStatus: {
    ACTIVE: 'ACTIVE',
    MAINTENANCE: 'MAINTENANCE',
    DAMAGED: 'DAMAGED',
    DISPOSED: 'DISPOSED',
  },
  Prisma: {
    Decimal: class Decimal {
      constructor(public readonly value: number) {}
    },
  },
}));

import { prisma } from '@/lib/prisma';
import { runMonthlyDepreciation } from './asset-depreciation.job';

const UNIT_ID = 'unit-1';
const ASSET_CODE = 'AST-001';

const asset = {
  id: 'asset-1',
  code: ASSET_CODE,
  name: 'Laptop',
  unitId: UNIT_ID,
  status: 'ACTIVE',
  purchasePrice: 12_000_000,
  residualValue: 0,
  usefulLife: 60,
  // Date-only column: its day is stored at midnight UTC.
  purchaseDate: new Date('2026-01-15T00:00:00.000Z'),
} as never;

const createMany = vi.fn();

const prevTz = process.env.TZ;

describe('runMonthlyDepreciation stamps the WIB calendar month, not the UTC one', () => {
  beforeAll(() => {
    process.env.TZ = 'UTC';
    vi.useFakeTimers();
  });
  afterAll(() => {
    vi.useRealTimers();
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.unit.findMany).mockResolvedValue([{ id: UNIT_ID, name: 'SD IT' } as never]);
    vi.mocked(prisma.setting.findMany).mockResolvedValue([
      { key: 'DEPRECIATION_EXPENSE_ACCOUNT', value: 'acct-expense' },
      { key: 'ACCUMULATED_DEPRECIATION_ACCOUNT', value: 'acct-accum' },
    ] as never);
    vi.mocked(prisma.asset.findMany).mockResolvedValue([asset]);
    vi.mocked(prisma.journalEntry.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.$transaction).mockImplementation((async (
      cb: (tx: unknown) => Promise<unknown>
    ) => cb({ journalEntry: { createMany } })) as never);
  });

  function referenceChecked() {
    return vi.mocked(prisma.journalEntry.findFirst).mock.calls[0][0]?.where?.reference;
  }

  function referencesWritten(): string[] {
    const rows = (createMany.mock.calls[0]?.[0]?.data ?? []) as Array<{ reference: string }>;
    return rows.map((r) => r.reference);
  }

  it('writes the August period at 2026-08-01 01:00 WIB (still 31 July UTC)', async () => {
    vi.setSystemTime(new Date('2026-07-31T18:00:00Z'));
    await runMonthlyDepreciation(UNIT_ID);

    expect(referenceChecked()).toBe(`DEPR-${ASSET_CODE}-2026-08`);
    expect(referencesWritten()).toEqual([
      `DEPR-${ASSET_CODE}-2026-08`,
      `DEPR-${ASSET_CODE}-2026-08`,
    ]);
  });

  it('rolls the year at 2026-01-01 01:00 WIB (still 31 December 2025 UTC)', async () => {
    vi.setSystemTime(new Date('2025-12-31T18:00:00Z'));
    await runMonthlyDepreciation(UNIT_ID);

    expect(referenceChecked()).toBe(`DEPR-${ASSET_CODE}-2026-01`);
    expect(referencesWritten()).toEqual([
      `DEPR-${ASSET_CODE}-2026-01`,
      `DEPR-${ASSET_CODE}-2026-01`,
    ]);
  });

  it('keeps the month mid-month, where the two calendars agree', async () => {
    vi.setSystemTime(new Date('2026-08-15T04:00:00Z'));
    await runMonthlyDepreciation(UNIT_ID);

    expect(referenceChecked()).toBe(`DEPR-${ASSET_CODE}-2026-08`);
  });

  it('skips an asset whose WIB month is already booked (idempotence)', async () => {
    vi.setSystemTime(new Date('2026-07-31T18:00:00Z'));
    vi.mocked(prisma.journalEntry.findFirst).mockResolvedValue({ id: 'j-1' } as never);

    await runMonthlyDepreciation(UNIT_ID);

    // The check queries the WIB month, and a hit means no journal is written.
    expect(referenceChecked()).toBe(`DEPR-${ASSET_CODE}-2026-08`);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });
});
