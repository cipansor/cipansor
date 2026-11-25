import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The acceptance criteria of #990 that the route guards and the pay path do
 * not already name: the read scopes, the write scopes, the component and
 * salary refusals, and the cancel/delete transitions. Each test is named after
 * the criterion it proves, because the PR body copies those names as evidence.
 */

const txMock = {
  payroll: { updateMany: vi.fn(), deleteMany: vi.fn() },
  payrollPeriod: {
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  payrollItem: { deleteMany: vi.fn() },
  employeeSalary: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  employeeSalaryItem: { deleteMany: vi.fn(), createMany: vi.fn() },
  salaryComponent: { create: vi.fn() },
};

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    payrollPeriod: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    payroll: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    payrollItem: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    employeeSalary: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    employeeSalaryItem: { count: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    salaryComponent: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    },
    staff: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../../finance/accounting-config.service', () => ({
  ACCOUNT_MAPPING_KEYS: {
    PAYROLL_EXPENSE: 'ACCOUNT_MAPPING_PAYROLL_EXPENSE',
    CASH: 'ACCOUNT_MAPPING_CASH',
  },
  getAccountOrFallback: vi.fn(),
}));

import { prisma } from '../../../lib/prisma';
import {
  salaryComponentService,
  employeeSalaryService,
  payrollPeriodService,
  payrollService,
} from '../payroll.service';

const TREASURER = { sub: 'user-bendahara', roleCode: 'SDIT_BENDAHARA', unitId: 'unit-sd' };
const SUPER_ADMIN = { sub: 'user-super', roleCode: 'SUPER_ADMIN', unitId: null };
const YAYASAN_BENDAHARA = { sub: 'user-yayasan', roleCode: 'YAYASAN_BENDAHARA', unitId: null };
const YAYASAN_PENGAWAS = { sub: 'user-pengawas', roleCode: 'YAYASAN_PENGAWAS', unitId: null };

function period(overrides: Record<string, unknown> = {}) {
  return {
    id: 'period-1',
    unitId: 'unit-sd',
    status: 'DRAFT',
    createdById: 'user-creator',
    notes: null,
    _count: { payrolls: 2 },
    ...overrides,
  };
}

const PAGE = { page: 1, limit: 20 };

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(prisma.$transaction).mockImplementation((async (arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => unknown)(txMock)
      : Promise.all(arg as unknown[])) as never);

  vi.mocked(prisma.payrollPeriod.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.payrollPeriod.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.employeeSalary.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.employeeSalary.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.payroll.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.payroll.count).mockResolvedValue(0 as never);

  txMock.payroll.updateMany.mockResolvedValue({ count: 2 });
  txMock.payrollPeriod.updateMany.mockResolvedValue({ count: 1 });
  txMock.payrollPeriod.findUnique.mockResolvedValue(period() as never);
  txMock.payrollPeriod.update.mockImplementation((async (args: { data: object }) => ({
    ...period(),
    ...args.data,
  })) as never);
  txMock.payrollPeriod.delete.mockResolvedValue({} as never);
  txMock.payrollPeriod.create.mockImplementation((async (args: { data: object }) => ({
    id: 'new-period',
    ...args.data,
  })) as never);
});

// ============================================
// READS
// ============================================

describe('R1.16 — a treasurer reads its own unit, whatever unitId it names', () => {
  it('pins GET /payroll/periods to the token unit and ignores unitId', async () => {
    await payrollPeriodService.list(TREASURER, { ...PAGE, unitId: 'unit-smp' });
    expect(prisma.payrollPeriod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { unitId: 'unit-sd' } })
    );
  });

  it('pins GET /payroll/slips to the token unit through the period', async () => {
    await payrollService.list(TREASURER, PAGE);
    expect(prisma.payroll.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { period: { unitId: 'unit-sd' } } })
    );
  });

  it('pins GET /payroll/salaries to the token unit through the staff row', async () => {
    await employeeSalaryService.list(TREASURER, { ...PAGE, unitId: 'unit-smp' });
    expect(prisma.employeeSalary.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { staff: { unitId: 'unit-sd' } } })
    );
  });

  it('answers GET /payroll/components with every component — they belong to the yayasan', async () => {
    vi.mocked(prisma.salaryComponent.findMany).mockResolvedValue([{ id: 'c1' }] as never);
    await expect(salaryComponentService.list({})).resolves.toHaveLength(1);
  });
});

describe('R1.18 — Super_Admin and the organs read every unit, and may narrow', () => {
  it('reads every unit when the request names none', async () => {
    await payrollPeriodService.list(SUPER_ADMIN, PAGE);
    expect(prisma.payrollPeriod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });

  it('narrows to the named unit', async () => {
    await payrollPeriodService.list(YAYASAN_PENGAWAS, { ...PAGE, unitId: 'unit-smp' });
    expect(prisma.payrollPeriod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { unitId: 'unit-smp' } })
    );
  });

  it('narrows GET /payroll/salaries the same way', async () => {
    await employeeSalaryService.list(SUPER_ADMIN, { ...PAGE, unitId: 'unit-smp' });
    expect(prisma.employeeSalary.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { staff: { unitId: 'unit-smp' } } })
    );
  });
});

describe('R1.17 — a record outside the caller’s scope answers 404, like a missing id', () => {
  it('answers GET /payroll/periods/:id of another unit with 404', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(
      period({ unitId: 'unit-smp' }) as never
    );
    await expect(payrollPeriodService.getById(TREASURER, 'period-1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('answers GET /payroll/periods/:id/summary of another unit with 404', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(
      period({ unitId: 'unit-smp' }) as never
    );
    await expect(payrollService.getSummary(TREASURER, 'period-1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('answers GET /payroll/slips/:id of another unit with 404', async () => {
    vi.mocked(prisma.payroll.findUnique).mockResolvedValue({
      id: 'slip-1',
      period: { unitId: 'unit-smp' },
    } as never);
    await expect(payrollService.getById(TREASURER, 'slip-1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('answers GET /payroll/salaries/:staffId of another unit with 404', async () => {
    vi.mocked(prisma.employeeSalary.findUnique).mockResolvedValue({
      staffId: 'staff-1',
      staff: { unitId: 'unit-smp' },
    } as never);
    await expect(employeeSalaryService.getByStaffId(TREASURER, 'staff-1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('answers GET /payroll/components/:id of a missing component with 404 for everyone', async () => {
    vi.mocked(prisma.salaryComponent.findUnique).mockResolvedValue(null as never);
    await expect(salaryComponentService.getById('nope')).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ============================================
// WRITES
// ============================================

describe('R1.19 — a treasurer drafts in its own unit, as the creator', () => {
  it('writes the token unit and the caller as createdById', async () => {
    await payrollPeriodService.create(TREASURER, {
      name: 'Gaji Juli 2026',
      month: 7,
      year: 2026,
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      unitId: 'unit-smp',
    } as never);

    const data = vi.mocked(prisma.payrollPeriod.create).mock.calls[0][0].data as {
      unitId: string;
      createdById: string;
      status: string;
      activeKey: string;
    };
    expect(data).toMatchObject({
      unitId: 'unit-sd',
      createdById: 'user-bendahara',
      status: 'DRAFT',
      activeKey: 'unit-sd:7:2026',
    });
  });

  it('adjusts a slip of its own DRAFT period', async () => {
    vi.mocked(prisma.payroll.findUnique).mockResolvedValue({
      id: 'slip-1',
      period: period(),
    } as never);
    vi.mocked(prisma.salaryComponent.findUnique).mockResolvedValue({ id: 'c1' } as never);
    vi.mocked(prisma.payrollItem.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.payrollItem.create).mockResolvedValue({} as never);
    vi.mocked(prisma.payrollItem.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.payroll.update).mockResolvedValue({} as never);

    await expect(
      payrollService.adjustItem(TREASURER, 'slip-1', { componentId: 'c1', amount: 100 } as never)
    ).resolves.toBeDefined();
  });
});

describe('R1.20 — a write to a record outside scope answers 404 and changes nothing', () => {
  it('refuses PUT /payroll/periods/:id of another unit with 404', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(
      period({ unitId: 'unit-smp' }) as never
    );
    await expect(
      payrollPeriodService.update(TREASURER, 'period-1', { notes: 'x' } as never)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.payrollPeriod.update).not.toHaveBeenCalled();
  });

  it('refuses POST /payroll/generate for another unit’s period with 404', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(
      period({ unitId: 'unit-smp' }) as never
    );
    await expect(
      payrollService.generate(TREASURER, { periodId: 'period-1', overwrite: false } as never)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses PUT /payroll/slips/:id/adjust of another unit with 404', async () => {
    vi.mocked(prisma.payroll.findUnique).mockResolvedValue({
      id: 'slip-1',
      period: period({ unitId: 'unit-smp' }),
    } as never);
    await expect(
      payrollService.adjustItem(TREASURER, 'slip-1', { componentId: 'c1', amount: 1 } as never)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses a salary write for another unit’s staff with 404', async () => {
    vi.mocked(prisma.staff.findUnique).mockResolvedValue({ unitId: 'unit-smp' } as never);
    await expect(
      employeeSalaryService.create(TREASURER, { staffId: 'staff-1', baseSalary: 1 } as never)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('answers an out-of-scope slip with the same 404 message as an unknown slip id', async () => {
    const refusal = async (promise: Promise<unknown>) =>
      (await promise.catch((error) => error)) as { statusCode: number; message: string };

    vi.mocked(prisma.payroll.findUnique).mockResolvedValueOnce(null as never);
    const unknown = await refusal(
      payrollService.adjustItem(TREASURER, 'missing', { componentId: 'c1', amount: 1 } as never)
    );

    vi.mocked(prisma.payroll.findUnique).mockResolvedValueOnce({
      id: 'slip-1',
      period: period({ unitId: 'unit-smp' }),
    } as never);
    const outside = await refusal(
      payrollService.adjustItem(TREASURER, 'slip-1', { componentId: 'c1', amount: 1 } as never)
    );

    expect(outside.statusCode).toBe(404);
    expect(outside.message).toBe(unknown.message);
  });

  it('refuses an adjust naming a component that does not exist with 404', async () => {
    vi.mocked(prisma.payroll.findUnique).mockResolvedValue({
      id: 'slip-1',
      period: period(),
    } as never);
    vi.mocked(prisma.salaryComponent.findUnique).mockResolvedValue(null as never);
    await expect(
      payrollService.adjustItem(TREASURER, 'slip-1', { componentId: 'nope', amount: 1 } as never)
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('R1.21 — only Bendahara_Yayasan writes the yayasan-level components', () => {
  it('creates a component for Bendahara_Yayasan', async () => {
    vi.mocked(prisma.salaryComponent.create).mockResolvedValue({ id: 'c1' } as never);
    await expect(
      salaryComponentService.create(YAYASAN_BENDAHARA, {
        code: 'TUNJ_X',
        name: 'Tunjangan X',
        type: 'EARNING',
      } as never)
    ).resolves.toBeDefined();
  });

  it('updates and deactivates a component with isActive = false', async () => {
    vi.mocked(prisma.salaryComponent.findUnique).mockResolvedValue({ id: 'c1' } as never);
    vi.mocked(prisma.salaryComponent.update).mockResolvedValue({
      id: 'c1',
      isActive: false,
    } as never);

    const updated = await salaryComponentService.update(YAYASAN_BENDAHARA, 'c1', {
      isActive: false,
    } as never);

    expect(vi.mocked(prisma.salaryComponent.update).mock.calls[0][0].data).toMatchObject({
      isActive: false,
    });
    expect(updated).toMatchObject({ isActive: false });
  });

  it('deletes a component nothing refers to', async () => {
    vi.mocked(prisma.salaryComponent.findUnique).mockResolvedValue({ id: 'c1' } as never);
    vi.mocked(prisma.payrollItem.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.employeeSalaryItem.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.salaryComponent.delete).mockResolvedValue({ id: 'c1' } as never);

    await expect(salaryComponentService.delete(YAYASAN_BENDAHARA, 'c1')).resolves.toBeDefined();
  });

  it('seeds the defaults without touching a component whose code already exists', async () => {
    vi.mocked(prisma.salaryComponent.upsert).mockResolvedValue({} as never);
    await salaryComponentService.seedDefaults(YAYASAN_BENDAHARA);

    const upserts = vi.mocked(prisma.salaryComponent.upsert).mock.calls;
    expect(upserts.length).toBeGreaterThan(0);
    for (const call of upserts) {
      // `update: {}` is what keeps an existing component's values.
      expect(call[0].update).toEqual({});
      expect(call[0].where).toEqual({ code: expect.any(String) });
    }
  });
});

describe('R1.22 — a referenced component or salary is not deleted, but 409', () => {
  it('refuses DELETE /payroll/components/:id referred to by a slip item, and suggests isActive', async () => {
    vi.mocked(prisma.salaryComponent.findUnique).mockResolvedValue({ id: 'c1' } as never);
    vi.mocked(prisma.payrollItem.count).mockResolvedValue(3 as never);
    vi.mocked(prisma.employeeSalaryItem.count).mockResolvedValue(0 as never);

    await expect(salaryComponentService.delete(YAYASAN_BENDAHARA, 'c1')).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('isActive'),
    });
    expect(prisma.salaryComponent.delete).not.toHaveBeenCalled();
  });

  it('refuses DELETE /payroll/components/:id referred to by a salary item', async () => {
    vi.mocked(prisma.salaryComponent.findUnique).mockResolvedValue({ id: 'c1' } as never);
    vi.mocked(prisma.payrollItem.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.employeeSalaryItem.count).mockResolvedValue(2 as never);

    await expect(salaryComponentService.delete(YAYASAN_BENDAHARA, 'c1')).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('refuses DELETE /payroll/salaries/:staffId of a staff who already has a slip', async () => {
    vi.mocked(prisma.staff.findUnique).mockResolvedValue({ unitId: 'unit-sd' } as never);
    vi.mocked(prisma.employeeSalary.findUnique).mockResolvedValue({ staffId: 'staff-1' } as never);
    vi.mocked(prisma.payroll.count).mockResolvedValue(1 as never);

    await expect(employeeSalaryService.delete(TREASURER, 'staff-1')).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('slip gaji'),
    });
    expect(prisma.employeeSalary.delete).not.toHaveBeenCalled();
  });
});

describe('R1.23 — Bendahara_Unit and YAYASAN_KETUA never write a component', () => {
  it.each([
    ['Bendahara_Unit', TREASURER],
    ['YAYASAN_KETUA', { sub: 'u-ketua', roleCode: 'YAYASAN_KETUA', unitId: null }],
  ])('refuses %s on POST /payroll/components with 403', async (_name, actor) => {
    await expect(
      salaryComponentService.create(actor, { code: 'X', name: 'X', type: 'EARNING' } as never)
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.salaryComponent.create).not.toHaveBeenCalled();
  });
});

describe('R1.24 — the approver moves a DRAFT period and its DRAFT slips to APPROVED', () => {
  it('approves and records who did it and when', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(period() as never);

    await payrollPeriodService.approve(YAYASAN_BENDAHARA, 'period-1');

    expect(txMock.payroll.updateMany).toHaveBeenCalledWith({
      where: { periodId: 'period-1', status: 'DRAFT' },
      data: { status: 'APPROVED' },
    });
    const data = txMock.payrollPeriod.updateMany.mock.calls[0][0].data as {
      status: string;
      approvedById: string;
      approvedAt: Date;
    };
    expect(data.status).toBe('APPROVED');
    expect(data.approvedById).toBe('user-yayasan');
    expect(data.approvedAt).toBeInstanceOf(Date);
  });
});

describe('R1.24 — approval claims the DRAFT status it read', () => {
  it('refuses with 409 when another request already moved the period', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(period() as never);
    txMock.payrollPeriod.updateMany.mockResolvedValue({ count: 0 } as never);

    await expect(payrollPeriodService.approve(YAYASAN_BENDAHARA, 'period-1')).rejects.toMatchObject(
      { statusCode: 409 }
    );
    expect(txMock.payroll.updateMany).not.toHaveBeenCalled();
  });
});

describe('R1.27 — the payer is not the approver', () => {
  it('refuses a dual-role account paying the period it approved', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(
      period({ status: 'APPROVED', approvedById: TREASURER.sub }) as never
    );

    await expect(
      payrollPeriodService.markAsPaid(TREASURER, 'period-1', new Date('2026-06-25'))
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ============================================
// CANCEL AND DELETE
// ============================================

describe('R1.29 — a treasurer cancels or deletes its own DRAFT period', () => {
  it('cancels a DRAFT period and every slip', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(period() as never);

    await payrollPeriodService.cancel(TREASURER, 'period-1');

    expect(txMock.payroll.updateMany).toHaveBeenCalledWith({
      where: { periodId: 'period-1' },
      data: { status: 'CANCELLED' },
    });
    expect(txMock.payrollPeriod.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'CANCELLED',
      activeKey: null,
    });
  });

  it('deletes a DRAFT period with its slips and items', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(period() as never);

    await payrollPeriodService.delete(TREASURER, 'period-1');

    expect(txMock.payrollItem.deleteMany).toHaveBeenCalledWith({
      where: { payroll: { periodId: 'period-1' } },
    });
    expect(txMock.payroll.deleteMany).toHaveBeenCalledWith({ where: { periodId: 'period-1' } });
    expect(txMock.payrollPeriod.delete).toHaveBeenCalledWith({ where: { id: 'period-1' } });
  });
});

describe('R1.31 — cancellation claims the status it read', () => {
  it('refuses with 409 when an approval landed after the period was read', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(period() as never);
    txMock.payrollPeriod.updateMany.mockResolvedValue({ count: 0 } as never);

    await expect(payrollPeriodService.cancel(TREASURER, 'period-1')).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(txMock.payroll.updateMany).not.toHaveBeenCalled();
  });
});

describe('R1.30 — the approver cancels an APPROVED period of any unit', () => {
  it('cancels it and every slip', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(
      period({ status: 'APPROVED' }) as never
    );

    await payrollPeriodService.cancel(YAYASAN_BENDAHARA, 'period-1');

    expect(txMock.payroll.updateMany).toHaveBeenCalledWith({
      where: { periodId: 'period-1' },
      data: { status: 'CANCELLED' },
    });
    expect(txMock.payrollPeriod.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'CANCELLED',
    });
  });
});

describe('R1.31 — the wrong role for the status is refused with 403', () => {
  it('refuses a treasurer cancelling an APPROVED period with 403', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(
      period({ status: 'APPROVED' }) as never
    );
    await expect(payrollPeriodService.cancel(TREASURER, 'period-1')).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses the approver cancelling a DRAFT period with 403', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(period() as never);
    await expect(payrollPeriodService.cancel(YAYASAN_BENDAHARA, 'period-1')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('refuses DELETE /payroll/periods/:id by the approver with 403, whatever the status', async () => {
    for (const status of ['DRAFT', 'APPROVED', 'PAID', 'CANCELLED']) {
      vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(period({ status }) as never);
      await expect(
        payrollPeriodService.delete(YAYASAN_BENDAHARA, 'period-1')
      ).rejects.toMatchObject({ statusCode: 403 });
    }
  });
});

describe('R1.34 — a PAID period is never cancelled or deleted', () => {
  it.each(['PAID', 'CANCELLED'])(
    'refuses a treasurer cancelling a %s period with 409',
    async (status) => {
      vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(period({ status }) as never);
      await expect(payrollPeriodService.cancel(TREASURER, 'period-1')).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining(status),
      });
    }
  );

  it.each(['APPROVED', 'PAID', 'CANCELLED'])(
    'refuses a treasurer deleting a %s period with 409',
    async (status) => {
      vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(period({ status }) as never);
      await expect(payrollPeriodService.delete(TREASURER, 'period-1')).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining(status),
      });
    }
  );

  it.each(['PAID', 'CANCELLED'])(
    'refuses the approver cancelling a %s period with 409',
    async (status) => {
      vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(period({ status }) as never);
      await expect(
        payrollPeriodService.cancel(YAYASAN_BENDAHARA, 'period-1')
      ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining(status) });
    }
  );
});

describe('R1.35 — a status the action cannot act on is refused with 409', () => {
  it.each(['APPROVED', 'PAID', 'CANCELLED'])(
    'refuses approving a %s period with 409',
    async (status) => {
      vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(period({ status }) as never);
      await expect(
        payrollPeriodService.approve(YAYASAN_BENDAHARA, 'period-1')
      ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining(status) });
    }
  );

  it('refuses approving a DRAFT period with no slips, and says so', async () => {
    vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(
      period({ _count: { payrolls: 0 } }) as never
    );
    await expect(payrollPeriodService.approve(YAYASAN_BENDAHARA, 'period-1')).rejects.toMatchObject(
      { statusCode: 409, message: expect.stringContaining('belum memiliki slip') }
    );
  });

  it.each(['APPROVED', 'PAID', 'CANCELLED'])(
    'refuses a treasurer editing a %s period with 409',
    async (status) => {
      vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(period({ status }) as never);
      await expect(
        payrollPeriodService.update(TREASURER, 'period-1', { notes: 'x' } as never)
      ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining(status) });
    }
  );

  it.each(['APPROVED', 'PAID', 'CANCELLED'])(
    'refuses generating into a %s period with 409',
    async (status) => {
      vi.mocked(prisma.payrollPeriod.findUnique).mockResolvedValue(period({ status }) as never);
      await expect(
        payrollService.generate(TREASURER, { periodId: 'period-1', overwrite: false } as never)
      ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining(status) });
    }
  );

  it.each(['APPROVED', 'PAID', 'CANCELLED'])(
    'refuses adjusting a slip of a %s period with 409',
    async (status) => {
      vi.mocked(prisma.payroll.findUnique).mockResolvedValue({
        id: 'slip-1',
        period: period({ status }),
      } as never);
      await expect(
        payrollService.adjustItem(TREASURER, 'slip-1', { componentId: 'c1', amount: 1 } as never)
      ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining(status) });
    }
  );
});

// ============================================
// THE ROUTE THAT MUST NOT MOVE
// ============================================

describe('R1.36 — the HR attendance-settings payroll routes keep their guards', () => {
  const source = readFileSync(join(__dirname, '../../hr/hr.routes.ts'), 'utf8');

  /** The `authorize(...)` call that follows the method+path declaration. */
  function guardFor(path: string, method: string): string {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declaration = new RegExp(
      `router\\.${method.toLowerCase()}\\(\\s*['"]${escaped}['"]`
    ).exec(source);
    expect(declaration, `${method} ${path} is not declared`).not.toBeNull();
    const start = declaration!.index;
    const next = source.slice(start, start + 400);
    const guard = /authorize\(([^)]*)\)/.exec(next);
    expect(guard, `${method} ${path} has no authorize()`).not.toBeNull();
    return guard![1];
  }

  it.each([
    ['GET', '/payroll/policy-rules'],
    ['PUT', '/payroll/policy-rules/:id'],
    ['GET', '/payroll/guard-config'],
    ['PUT', '/payroll/guard-config'],
  ])('%s %s still accepts Super_Admin and Unit_Admin', (method, path) => {
    const guard = guardFor(path, method);
    expect(guard).toContain('UserRole.SUPER_ADMIN');
    expect(guard).toContain('UserRole.UNIT_ADMIN');
  });

  it('DELETE /payroll/policy-rules/:id still accepts Super_Admin alone', () => {
    const start = source.indexOf(`'/payroll/policy-rules/:id'`);
    const after = source.slice(start);
    const deleteGuard = after.slice(after.indexOf('router.delete'));
    const guard = /authorize\(([^)]*)\)/.exec(deleteGuard.slice(0, 300))!;
    expect(guard[1]).toContain('UserRole.SUPER_ADMIN');
    expect(guard[1]).not.toContain('UserRole.UNIT_ADMIN');
  });
});
