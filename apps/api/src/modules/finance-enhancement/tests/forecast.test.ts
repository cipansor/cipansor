import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Decimal } from '@prisma/client/runtime/client';

// Mock prisma before importing the service
vi.mock('@/lib/prisma', () => ({
  prisma: {
    accountCode: {
      findMany: vi.fn(),
    },
    journalEntry: {
      aggregate: vi.fn(),
    },
    invoice: {
      findMany: vi.fn(),
    },
    purchaseRequest: {
      findMany: vi.fn(),
    },
  },
}));

// Now import the service
import { getCashFlowForecast } from '../reporting.service';
import { prisma } from '@/lib/prisma';
import { AccountType } from '@cipansor/shared';
import { wibMonthYear } from '@/utils/wib';

/**
 * The forecast buckets by the WIB month (#1149). The clock is frozen at
 * 1 Nov 2026 00:30 WIB, while the UTC server still reads 31 Oct, so a fixture
 * built from the server month would land in the first bucket instead of the
 * second — exactly the regression this test guards.
 */
const NOW = new Date('2026-10-31T17:30:00.000Z');

describe('Finance Forecasting Logic', () => {
  const unitId = 'unit-123';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should calculate forecast correctly with inflows and outflows', async () => {
    // 1. Current Balance Mock: 10M
    (prisma.accountCode.findMany as any).mockResolvedValue([
      { id: 'acc-1', name: 'Kas Utama', code: '1-101', type: AccountType.ASSET },
    ]);
    (prisma.journalEntry.aggregate as any).mockResolvedValue({
      _sum: { debit: new Decimal(15000000), credit: new Decimal(5000000) },
    });

    // 2. Pending Invoices (Inflow): 5M next WIB month. Derive the month the
    // same way the service does; `new Date().getMonth()` reads the UTC server
    // month, which is still October at NOW.
    const base = wibMonthYear(new Date());
    const nextIndex = base.month + 1;
    const nextMonth = {
      year: base.year + Math.floor(nextIndex / 12),
      month: ((nextIndex % 12) + 12) % 12,
    };
    const nextMonthDay = new Date(Date.UTC(nextMonth.year, nextMonth.month, 15));

    (prisma.invoice.findMany as any).mockResolvedValue([
      {
        dueDate: nextMonthDay,
        amount: new Decimal(5000000),
        paidAmount: new Decimal(0),
      },
    ]);

    // 3. Approved PRs (Outflow): 2M next month
    (prisma.purchaseRequest.findMany as any).mockResolvedValue([
      {
        date: nextMonthDay,
        totalEstimated: new Decimal(2000000),
      },
    ]);

    const result = await getCashFlowForecast(unitId, 3);

    expect(result.initialBalance).toBe(10000000);
    expect(result.forecast).toHaveLength(3);

    // Month 1 (Current Month): No specific items mocked, flow 0
    expect(result.forecast[0].income).toBe(0);
    expect(result.forecast[0].expense).toBe(0);
    expect(result.forecast[0].balance).toBe(10000000);

    // Month 2 (Next Month): 5M in, 2M out -> +3M
    expect(result.forecast[1].income).toBe(5000000);
    expect(result.forecast[1].expense).toBe(2000000);
    expect(result.forecast[1].netFlow).toBe(3000000);
    expect(result.forecast[1].balance).toBe(13000000);
  });

  it('labels every bucket in Indonesian, not the host locale', async () => {
    // 1 Aug 2026 00:30 WIB. `en-US` would say Aug, Oct, Dec; the portal's
    // Indonesian labels are the ones the web table renders as-is (#1149).
    vi.setSystemTime(new Date('2026-07-31T17:30:00.000Z'));

    (prisma.accountCode.findMany as any).mockResolvedValue([]);
    (prisma.journalEntry.aggregate as any).mockResolvedValue({
      _sum: { debit: new Decimal(0), credit: new Decimal(0) },
    });
    (prisma.invoice.findMany as any).mockResolvedValue([]);
    (prisma.purchaseRequest.findMany as any).mockResolvedValue([]);

    const result = await getCashFlowForecast(unitId, 5);

    expect(result.forecast.map((bucket) => bucket.month)).toEqual([
      'Agu 26',
      'Sep 26',
      'Okt 26',
      'Nov 26',
      'Des 26',
    ]);
  });
});
