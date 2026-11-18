import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// Property 31: the status flow (#989, R22.6, R27.10). The API accepts a status
// change exactly when the pair is in `LAUNDRY_STATUS_FLOW`, and refuses the
// rest with 409. The Portal's own side of the property belongs to #1010; this
// file is the API half.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    laundryTransaction: { findFirst: vi.fn(), update: vi.fn() },
    laundryStatusLog: { create: vi.fn() },
    journalEntry: { findMany: vi.fn(), create: vi.fn() },
    santriWallet: { findUnique: vi.fn(), update: vi.fn() },
    walletTransaction: { create: vi.fn() },
    $transaction: vi.fn((cb) => cb(prisma)),
  },
}));
vi.mock('../../finance-enhancement/period.service', () => ({
  isPeriodOpen: vi.fn().mockResolvedValue(true),
}));

import { prisma } from '@/lib/prisma';
import {
  LAUNDRY_STATUS_FLOW,
  LAUNDRY_STATUS_VALUES,
  laundryNextStatuses,
  laundryTransitionAllowed,
  type LaundryStatusCode,
} from '@cipansor/shared';
import { transactionService } from '../laundry.service';

const UNIT = 'unit-a';
const OTHER_UNIT = 'unit-b';
const SUPER: { sub: string; roleCode: string; unitId: string | null } = {
  sub: 'u-super',
  roleCode: 'SUPER_ADMIN',
  unitId: null,
};
const UNIT_ADMIN = { sub: 'u-admin', roleCode: 'SMPIT_ADMIN', unitId: UNIT };

/** A transaction in `status` of `unitId`, as `findFirst` would return it. */
const transaction = (status: LaundryStatusCode, unitId = UNIT) => ({
  id: 'tx-1',
  unitId,
  status,
  paymentStatus: 'UNPAID',
  walletId: null,
  total: 0,
  transactionNo: 'LDR-1',
});

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.laundryTransaction.update as any).mockImplementation(async ({ data }: any) => ({
    id: 'tx-1',
    status: data.status,
  }));
  vi.mocked(prisma.laundryStatusLog.create).mockResolvedValue({} as any);
});

describe('Property 31: alur status laundry', () => {
  it('the flow table names exactly the moves laundryNextStatuses allows', () => {
    // Feature: web-api-reconnect-phase-2, Property 31: Alur status laundry
    fc.assert(
      fc.property(
        fc.constantFrom(...LAUNDRY_STATUS_VALUES),
        fc.constantFrom(...LAUNDRY_STATUS_VALUES),
        (from, to) => {
          expect(laundryTransitionAllowed(from, to)).toBe(LAUNDRY_STATUS_FLOW[from].includes(to));
          expect(laundryNextStatuses(from).includes(to)).toBe(
            LAUNDRY_STATUS_FLOW[from].includes(to)
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it('a DELIVERED or CANCELLED transaction has no target status', () => {
    expect(laundryNextStatuses('DELIVERED')).toEqual([]);
    expect(laundryNextStatuses('CANCELLED')).toEqual([]);
  });

  it('the API accepts a move exactly when the flow names it, and refuses the rest with 409', async () => {
    // Feature: web-api-reconnect-phase-2, Property 31: Alur status laundry
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...LAUNDRY_STATUS_VALUES),
        fc.constantFrom(...LAUNDRY_STATUS_VALUES),
        async (from, to) => {
          vi.clearAllMocks();
          vi.mocked(prisma.laundryTransaction.findFirst).mockResolvedValue(
            transaction(from) as any
          );
          (prisma.laundryTransaction.update as any).mockImplementation(async ({ data }: any) => ({
            id: 'tx-1',
            status: data.status,
          }));
          vi.mocked(prisma.laundryStatusLog.create).mockResolvedValue({} as any);

          const allowed = LAUNDRY_STATUS_FLOW[from].includes(to);
          const call = transactionService.updateStatus('tx-1', UNIT_ADMIN, {
            status: to,
          });
          if (allowed) {
            await expect(call).resolves.toMatchObject({ status: to });
          } else {
            await expect(call).rejects.toMatchObject({ statusCode: 409 });
            expect(prisma.laundryTransaction.update).not.toHaveBeenCalled();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 31: the reach of a status change (R27.9, R27.11)', () => {
  it('404 for a transaction that does not exist, is outside the read scope, or is another unit', async () => {
    vi.mocked(prisma.laundryTransaction.findFirst).mockResolvedValue(null as any);
    await expect(
      transactionService.updateStatus('nope', UNIT_ADMIN, { status: 'WASHING' })
    ).rejects.toMatchObject({ statusCode: 404 });

    // A unit-B transaction found by the read scope but not writable by a
    // unit-A admin.
    vi.mocked(prisma.laundryTransaction.findFirst).mockResolvedValue(
      transaction('RECEIVED', OTHER_UNIT) as any
    );
    await expect(
      transactionService.updateStatus('tx-1', UNIT_ADMIN, { status: 'WASHING' })
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.laundryTransaction.update).not.toHaveBeenCalled();
  });

  it('a Super_Admin with no unit on the token may change any unit, following the flow', async () => {
    vi.mocked(prisma.laundryTransaction.findFirst).mockResolvedValue(
      transaction('RECEIVED', OTHER_UNIT) as any
    );
    await expect(
      transactionService.updateStatus('tx-1', SUPER, { status: 'WASHING' })
    ).resolves.toMatchObject({ status: 'WASHING' });
  });
});
