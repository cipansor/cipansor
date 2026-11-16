/**
 * The forecast reads `Invoice.dueDate` on the WIB calendar, not the server's.
 *
 * `Invoice.dueDate` is date-only, stored at midnight UTC — 07:00 WIB on the day
 * it names. Two forecast readers compared it with a raw `new Date()`: the
 * outstanding-age buckets (a bill due today ticked over mid-morning instead of
 * at the end of its WIB day) and the cash-flow forecast's month window (the
 * first 7 hours of a WIB month are still the previous UTC month). Both are
 * pinned here against a frozen clock in that 00:00–07:00 WIB stretch, where UTC
 * and WIB disagree on the date and the month (#1050).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Decimal } from '@prisma/client/runtime/client';

const prismaMock = vi.hoisted(() => ({
  invoice: { findMany: vi.fn(), aggregate: vi.fn() },
  academicYear: { findFirst: vi.fn() },
  budget: { findMany: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getOutstandingPaymentPrediction, calculateCashFlowForecast } from '../forecast.service';

// Minggu 1 Nov 2026 00:30 WIB — the UTC calendar day is still 31 October, and
// the UTC month is still October while WIB has turned to November.
const FROZEN = new Date('2026-10-31T17:30:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FROZEN);
  prismaMock.invoice.aggregate.mockResolvedValue({ _sum: { amount: null, paidAmount: null } });
  prismaMock.academicYear.findFirst.mockResolvedValue(null);
  prismaMock.budget.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getOutstandingPaymentPrediction age buckets', () => {
  it('buckets a bill due exactly 90 WIB days ago as "over 90 days"', async () => {
    // 3 Aug 2026 is exactly 90 WIB days before 1 Nov 2026. Anchoring on the WIB
    // day puts it in "Lebih dari 90 hari"; a raw `new Date()` at 00:30 WIB
    // computes 89 days (the 07:00 WIB gap), landing it in "60-90".
    prismaMock.invoice.findMany.mockResolvedValue([
      {
        amount: new Decimal(100_000),
        paidAmount: new Decimal(0),
        dueDate: new Date('2026-08-03T00:00:00.000Z'),
      },
    ]);

    const result = await getOutstandingPaymentPrediction();

    const bucket6090 = result.dataPoints.find((d) => d.category === '60-90 hari');
    const over90 = result.dataPoints.find((d) => d.category === 'Lebih dari 90 hari');
    expect(bucket6090?.amount).toBe(0);
    expect(over90?.amount).toBe(100_000);
  });

  it('buckets a bill due exactly 30 WIB days ago as "30-60 days"', async () => {
    // 2 Oct 2026 is exactly 30 WIB days before 1 Nov 2026. Anchoring on the WIB
    // day puts it in "30-60"; a raw `new Date()` at 00:30 WIB computes 29 days
    // (the 07:00 WIB gap), landing it in "under 30" — the defect.
    prismaMock.invoice.findMany.mockResolvedValue([
      {
        amount: new Decimal(200_000),
        paidAmount: new Decimal(0),
        dueDate: new Date('2026-10-02T00:00:00.000Z'),
      },
    ]);

    const result = await getOutstandingPaymentPrediction();

    const under30 = result.dataPoints.find((d) => d.category === 'Kurang dari 30 hari');
    const bucket3060 = result.dataPoints.find((d) => d.category === '30-60 hari');
    expect(under30?.amount).toBe(0);
    expect(bucket3060?.amount).toBe(200_000);
  });
});

describe('calculateCashFlowForecast month window', () => {
  it('starts the projection at the WIB month, not the previous UTC month', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([]);

    const result = await calculateCashFlowForecast();

    // 1 Nov 2026 00:30 WIB: the first month is 2026-11, not 2026-10.
    expect(result.dataPoints.map((d) => d.month)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
    ]);
  });

  it('counts an overdue bill against the WIB month it precedes', async () => {
    // A bill due 31 Oct 2026 (00:00Z) is before 1 Nov 2026 WIB, so it is
    // overdue; a bill due 2 Nov is not. A UTC month start (1 Oct) would have
    // treated both as overdue.
    prismaMock.invoice.findMany.mockResolvedValue([
      {
        amount: new Decimal(50_000),
        paidAmount: new Decimal(0),
        dueDate: new Date('2026-10-31T00:00:00.000Z'),
      },
      {
        amount: new Decimal(70_000),
        paidAmount: new Decimal(0),
        dueDate: new Date('2026-11-02T00:00:00.000Z'),
      },
    ]);

    const result = await calculateCashFlowForecast();

    expect(result.summary.overdueAmount).toBe(50_000);
    expect(result.dataPoints[0]).toMatchObject({ month: '2026-11', overdueIncluded: 50_000 });
  });
});
