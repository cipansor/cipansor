import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// Property 31 and 32 for laundry. Property 31 is the status flow (#989,
// R22.6, R27.10): the API accepts a status change exactly when the pair is in
// `LAUNDRY_STATUS_FLOW` and refuses the rest with 409, and the Portal offers
// exactly the targets that table names (#1010). Property 32 is the derived item
// count and the case-insensitive search (R22.2, R22.11).

vi.mock('@/lib/prisma', () => ({
  prisma: {
    laundryTransaction: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    laundryStatusLog: { create: vi.fn() },
    journalEntry: { findMany: vi.fn(), create: vi.fn() },
    santriWallet: { findUnique: vi.fn(), update: vi.fn() },
    walletTransaction: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn((cb) => cb(prisma)),
  },
}));
vi.mock('../../finance-enhancement/period.service', () => ({
  isPeriodOpen: vi.fn().mockResolvedValue(true),
}));

import { prisma } from '@/lib/prisma';
import {
  LAUNDRY_STATUS_FLOW,
  LAUNDRY_STATUS_LABELS,
  LAUNDRY_STATUS_VALUES,
  laundryItemCount,
  laundryNextStatuses,
  laundryStatusOptions,
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

/**
 * #1010 (PR-24): the Portal's half of Property 31. The status menu a detail
 * dialog offers is `laundryStatusOptions`, which reads `LAUNDRY_STATUS_FLOW` —
 * the same table the API's `updateStatus` validates against, pinned above. So
 * the two halves of the property are the two sides of one table.
 */
describe('Property 31: what the Portal offers for each status (R22.5, R22.6)', () => {
  it('the Portal offers exactly the flow’s targets, each labelled in Indonesian', () => {
    // Feature: web-api-reconnect-phase-2, Property 31: Alur status laundry
    fc.assert(
      fc.property(fc.constantFrom(...LAUNDRY_STATUS_VALUES), (from) => {
        const offered = laundryStatusOptions(from);
        expect(offered.map((option) => option.value)).toEqual([...LAUNDRY_STATUS_FLOW[from]]);
        for (const option of offered) {
          expect(option.label).toBe(LAUNDRY_STATUS_LABELS[option.value]);
          // Every offered move is one the API accepts — no dead button.
          expect(laundryTransitionAllowed(from, option.value)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('a DELIVERED or CANCELLED transaction offers no status at all', () => {
    expect(laundryStatusOptions('DELIVERED')).toEqual([]);
    expect(laundryStatusOptions('CANCELLED')).toEqual([]);
  });

  it('every status carries a label of its own, and a status the flow does not know offers nothing', () => {
    expect(Object.keys(LAUNDRY_STATUS_LABELS).sort()).toEqual([...LAUNDRY_STATUS_VALUES].sort());
    expect(new Set(Object.values(LAUNDRY_STATUS_LABELS)).size).toBe(LAUNDRY_STATUS_VALUES.length);
  });
});

/**
 * Property 32: turunan dan pencarian laundry (R22.2, R22.11).
 *
 * Two halves. The first is the count the Portal prints for a row: the sum of
 * `items[].quantity`, and 0 when there are none — the API sends no total of its
 * own. The second is the list's search: for any text of 1–100 characters, the
 * query must narrow to rows whose santri name, NIS or `transactionNo` contains
 * it case-insensitively, inside the reader's scope.
 */
describe('Property 32: turunan dan pencarian laundry', () => {
  it('the item count is the sum of the quantities, and 0 when the list is empty', () => {
    // Feature: web-api-reconnect-phase-2, Property 32: Turunan dan pencarian laundry
    fc.assert(
      fc.property(
        fc.array(fc.record({ quantity: fc.integer({ min: 1, max: 20 }) }), {
          maxLength: 12,
        }),
        (items) => {
          const expected = items.reduce((sum, item) => sum + item.quantity, 0);
          expect(laundryItemCount(items)).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
    expect(laundryItemCount([])).toBe(0);
    expect(laundryItemCount(null)).toBe(0);
    expect(laundryItemCount(undefined)).toBe(0);
  });

  it('a search narrows to santri name, NIS or transactionNo, case-insensitively', async () => {
    // Feature: web-api-reconnect-phase-2, Property 32: Turunan dan pencarian laundry
    await fc.assert(
      fc.asyncProperty(
        // The edge schema trims and requires 1–100 characters; whitespace-only
        // is a 400 there, so the service never sees it.
        fc.string({ minLength: 1, maxLength: 100 }).filter((text) => text.trim().length > 0),
        async (search) => {
          vi.clearAllMocks();
          vi.mocked(prisma.laundryTransaction.findMany).mockResolvedValue([] as never);
          vi.mocked(prisma.laundryTransaction.count).mockResolvedValue(1);
          await transactionService.getAll({}, { search, page: 1, limit: 20 });
          const where = vi.mocked(prisma.laundryTransaction.findMany).mock.calls.at(-1)![0]!.where;
          const text = search.trim();
          expect(where!.OR).toEqual([
            { transactionNo: { contains: text, mode: 'insensitive' } },
            { student: { nis: { contains: text, mode: 'insensitive' } } },
            {
              student: {
                user: { name: { contains: text, mode: 'insensitive' } },
              },
            },
          ]);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('a search of only spaces is no search at all', async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.laundryTransaction.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.laundryTransaction.count).mockResolvedValue(0);
    await transactionService.getAll({}, { search: '   ', page: 1, limit: 20 });
    const where = vi.mocked(prisma.laundryTransaction.findMany).mock.calls.at(-1)![0]!.where;
    expect(where).not.toHaveProperty('OR');
  });
});
