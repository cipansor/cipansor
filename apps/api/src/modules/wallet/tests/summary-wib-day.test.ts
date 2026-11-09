import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The container runs UTC, so the three "today" cards of `/finance/wallet` must
// bound their day on the WIB clock: a 00:30 WIB transaction is already the new
// day in Tasikmalaya even though the server still reads the previous one.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    santriWallet: { findMany: vi.fn() },
    walletTransaction: { findMany: vi.fn() },
  },
}));

vi.mock('../../finance/accounting-config.service', () => ({
  ACCOUNT_MAPPING_KEYS: { CASH: 'CASH', BANK: 'BANK' },
  getAccountOrFallback: vi.fn().mockResolvedValue({ id: 'acc-x' }),
}));

import { prisma } from '@/lib/prisma';
import { todayWib } from '@/utils/wib';
import { wibDayStart } from '@/utils/wib-day';
import { walletService } from '../wallet.service';

const mocked = prisma as any;

describe('walletService.getSummary day bounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.santriWallet.findMany.mockResolvedValue([]);
    mocked.walletTransaction.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('bounds "Transaksi Hari Ini" with the WIB calendar day, not the UTC one', async () => {
    // 2026-11-01 00:30 WIB == 2026-10-31T17:30:00Z.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T17:30:00Z'));

    await walletService.getSummary();

    const where = mocked.walletTransaction.findMany.mock.calls[0][0].where;
    expect(todayWib()).toBe('2026-11-01');
    expect(where.createdAt.gte.toISOString()).toBe(wibDayStart('2026-11-01').toISOString());
    // The regression: midnight UTC of the server's day, seven hours early.
    expect(where.createdAt.gte.toISOString()).not.toBe('2026-10-31T00:00:00.000Z');
  });

  it('keeps the unit filter on the same query', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T17:30:00Z'));

    await walletService.getSummary('unit-sd');

    const where = mocked.walletTransaction.findMany.mock.calls[0][0].where;
    expect(where.wallet).toEqual({ student: { unitId: 'unit-sd' } });
  });
});
