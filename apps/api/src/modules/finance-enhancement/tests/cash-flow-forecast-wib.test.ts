/**
 * The cash-flow forecast buckets by the WIB calendar month (#1149).
 *
 * `getCashFlowForecast` used `new Date(now.getFullYear(), now.getMonth() + i)`,
 * which reads the *server* clock. The container runs UTC, so between 00:00 and
 * 06:59 WIB on the 1st the server is still in the previous UTC month: the first
 * bucket was labelled with the month that had just ended and the last requested
 * month fell off the projection entirely.
 *
 * The clock is frozen at 2026-10-31T17:30:00Z = 1 Nov 2026 00:30 WIB — inside
 * the window where the two calendars disagree — and the file runs under three
 * server timezones to prove the result no longer depends on any of them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Decimal } from '@prisma/client/runtime/client';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    accountCode: { findMany: vi.fn() },
    journalEntry: { aggregate: vi.fn() },
    invoice: { findMany: vi.fn() },
    purchaseRequest: { findMany: vi.fn() },
  },
}));

import { getCashFlowForecast } from '../reporting.service';
import { prisma } from '@/lib/prisma';
import { AccountType } from '@cipansor/shared';

/** 1 Nov 2026 00:30 WIB, while the UTC clock still reads 31 Oct. */
const NOW = new Date('2026-10-31T17:30:00.000Z');

const invoice = (day: string, amount: number) => ({
  dueDate: new Date(`${day}T00:00:00.000Z`), // the date-only form `Invoice.dueDate` holds
  amount: new Decimal(amount),
  paidAmount: new Decimal(0),
});

describe.each(['UTC', 'Asia/Jakarta', 'America/New_York'])(
  'cash-flow forecast buckets the WIB month (server TZ=%s)',
  (tz) => {
    let previousTz: string | undefined;

    beforeEach(() => {
      previousTz = process.env.TZ;
      process.env.TZ = tz;
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
      vi.clearAllMocks();

      vi.mocked(prisma.accountCode.findMany).mockResolvedValue([
        { id: 'acc-1', name: 'Kas Utama', code: '1-101', type: AccountType.ASSET },
      ] as never);
      vi.mocked(prisma.journalEntry.aggregate).mockResolvedValue({
        _sum: { debit: new Decimal(0), credit: new Decimal(0) },
      } as never);
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        invoice('2026-10-05', 500_000), // overdue — folded into the current month
        invoice('2026-11-10', 2_000_000),
        invoice('2026-12-20', 1_000_000),
        invoice('2027-01-15', 3_000_000),
      ] as never);
      vi.mocked(prisma.purchaseRequest.findMany).mockResolvedValue([] as never);
    });

    afterEach(() => {
      vi.useRealTimers();
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    });

    it('starts at the running WIB month and keeps every requested month', async () => {
      const { forecast } = await getCashFlowForecast('unit-1', 3);

      expect(forecast.map((row) => row.month)).toEqual(['Nov 26', 'Des 26', 'Jan 27']);
      expect(forecast).toHaveLength(3);
    });

    it('returns exactly one bucket for a one-month horizon', async () => {
      const { forecast } = await getCashFlowForecast('unit-1', 1);

      expect(forecast.map((row) => row.month)).toEqual(['Nov 26']);
    });

    it('folds the overdue receivable into the running WIB month, not the ended one', async () => {
      const { forecast } = await getCashFlowForecast('unit-1', 3);

      expect(forecast.map((row) => row.income)).toEqual([2_500_000, 1_000_000, 3_000_000]);
    });

    it('bounds the invoice query at the end of the last requested WIB month', async () => {
      await getCashFlowForecast('unit-1', 3);

      const where = vi.mocked(prisma.invoice.findMany).mock.calls[0][0]!.where as {
        dueDate: { lte: Date };
      };
      // 31 Jan 2027 23:59:59.999 WIB — the last requested month is January, so
      // its final day must be inside the window (the UTC bound stopped at
      // 31 Dec 23:59:59.999Z, dropping January entirely).
      expect(where.dueDate.lte.toISOString()).toBe('2027-01-31T16:59:59.999Z');
    });

    it('bounds the purchase-request query at the same end of the last WIB month', async () => {
      await getCashFlowForecast('unit-1', 3);

      const where = vi.mocked(prisma.purchaseRequest.findMany).mock.calls[0][0]!.where as {
        date: { lte: Date };
      };
      expect(where.date.lte.toISOString()).toBe('2027-01-31T16:59:59.999Z');
    });
  }
);
