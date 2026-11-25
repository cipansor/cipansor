/**
 * Payroll Service
 * Layanan Penggajian untuk Yayasan/Pesantren/Sekolah
 *
 * Fitur:
 * - Komponen gaji (tunjangan & potongan)
 * - Pengaturan gaji per karyawan
 * - Periode penggajian
 * - Kalkulasi slip gaji
 * - Kalkulasi PPh 21
 */

import { prisma } from '../../lib/prisma';
import { Prisma, SalaryComponentType, PayrollStatus } from '@prisma/client';
import { attendanceDeductionService } from './attendance-deduction.service';
import { calculateMonthlyPph21, effectiveItemAmount, isBasicSalaryComponent } from './payroll-tax';
import { Errors } from '../../middleware/error';
import { workDatesInRange } from '../../utils/work-calendar';
import { JournalReferenceType, type PayrollActor } from '@cipansor/shared';
import { ACCOUNT_MAPPING_KEYS, getAccountOrFallback } from '../finance/accounting-config.service';
import {
  assertPayroll,
  assertRowInScope,
  listUnitFor,
  periodFacts,
  writeUnitFor,
} from './payroll.access';
import {
  CreateSalaryComponentInput,
  UpdateSalaryComponentInput,
  CreateEmployeeSalaryInput,
  UpdateEmployeeSalaryInput,
  CreatePayrollPeriodInput,
  UpdatePayrollPeriodInput,
  GeneratePayrollInput,
  PayrollItemAdjustmentInput,
} from './payroll.schema';

/** The name a missing row answers with — the same sentence for every caller. */
const NOT_FOUND = {
  component: 'Komponen gaji',
  salary: 'Pengaturan gaji karyawan',
  period: 'Periode penggajian',
  slip: 'Slip gaji',
} as const;

/** The key a non-cancelled period holds; null once cancelled, so a replacement fits. */
function activePeriodKey(unitId: string, month: number, year: number): string {
  return `${unitId}:${month}:${year}`;
}

/**
 * A mapped account a unit may post a liability to: active, a liability, and
 * either the unit's own row or a shared foundation-wide one. A mapping that
 * points elsewhere is ignored rather than posted to.
 */
function usableLiabilityAccount<
  T extends { unitId: string | null; isActive: boolean; type: string },
>(account: T | null, unitId: string): T | null {
  if (!account || !account.isActive || account.type !== 'LIABILITY') return null;
  if (account.unitId !== null && account.unitId !== unitId) return null;
  return account;
}

/**
 * The unit's PPh 21 payable, from the operator's explicit mapping only.
 *
 * A name search is not a mapping: it once credited PPh 21 to whichever tax
 * account happened to match the search string (PPh 23 got the money). A
 * missing or unusable mapping must fail the payment and send the operator to
 * the accounting settings, not guess.
 */
async function resolveTaxPayableAccount(unitId: string, tx: Prisma.TransactionClient) {
  const mapped = await getAccountOrFallback(
    unitId,
    ACCOUNT_MAPPING_KEYS.TAX_PAYABLE,
    undefined,
    undefined,
    tx
  );
  return usableLiabilityAccount(mapped, unitId);
}

/**
 * A period, or 404. Always loaded with the slip count, because every rule that
 * acts on a period needs it (approval refuses an empty period).
 */
async function loadPeriod(id: string) {
  const period = await prisma.payrollPeriod.findUnique({
    where: { id },
    include: { _count: { select: { payrolls: true } } },
  });
  if (!period) throw Errors.notFound(NOT_FOUND.period);
  return period;
}

/**
 * A staff row outside the caller's reach answers 404, exactly as an unknown
 * staffId does — a treasurer must not learn which ids exist in another unit.
 */
async function assertStaffInScope(actor: PayrollActor, staffId: string) {
  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: { unitId: true },
  });
  if (!staff) throw Errors.notFound('Pegawai');
  assertRowInScope(actor, staff.unitId, 'Pegawai');
}

// ============================================
// SALARY COMPONENT SERVICE
// ============================================

export const salaryComponentService = {
  async list(params: { type?: SalaryComponentType; isActive?: boolean; search?: string }) {
    const where: Prisma.SalaryComponentWhereInput = {};

    if (params.type) where.type = params.type;
    if (params.isActive !== undefined) where.isActive = params.isActive;
    if (params.search) {
      where.OR = [
        { code: { contains: params.search, mode: 'insensitive' } },
        { name: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const components = await prisma.salaryComponent.findMany({
      where,
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });

    return components;
  },

  /**
   * A salary component carries no unit — it belongs to the yayasan and feeds
   * every unit's payroll — so every reader sees all of them (R1.16) and a
   * missing id answers 404 for everyone.
   */
  async getById(id: string) {
    const component = await prisma.salaryComponent.findUnique({ where: { id } });
    if (!component) throw Errors.notFound(NOT_FOUND.component);
    return component;
  },

  async create(actor: PayrollActor, data: CreateSalaryComponentInput) {
    assertPayroll(actor, 'COMPONENT_WRITE');
    return prisma.salaryComponent.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        ...data,
        defaultAmount: data.defaultAmount ? new Prisma.Decimal(data.defaultAmount) : null,
        defaultRate: data.defaultRate ? new Prisma.Decimal(data.defaultRate) : null,
      } as any,
    });
  },

  async update(actor: PayrollActor, id: string, data: UpdateSalaryComponentInput) {
    assertPayroll(actor, 'COMPONENT_WRITE');
    const existing = await prisma.salaryComponent.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound(NOT_FOUND.component);

    return prisma.salaryComponent.update({
      where: { id },
      data: {
        ...data,
        defaultAmount:
          data.defaultAmount !== undefined
            ? data.defaultAmount
              ? new Prisma.Decimal(data.defaultAmount)
              : null
            : undefined,
        defaultRate:
          data.defaultRate !== undefined
            ? data.defaultRate
              ? new Prisma.Decimal(data.defaultRate)
              : null
            : undefined,
      },
    });
  },

  /**
   * A component that a slip or a salary structure already refers to is not
   * deleted — the reference would dangle — but deactivated instead, and the
   * refusal says so (R1.22).
   */
  async delete(actor: PayrollActor, id: string) {
    assertPayroll(actor, 'COMPONENT_WRITE');
    const existing = await prisma.salaryComponent.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound(NOT_FOUND.component);

    const [slipItems, salaryItems] = await Promise.all([
      prisma.payrollItem.count({ where: { componentId: id } }),
      prisma.employeeSalaryItem.count({ where: { componentId: id } }),
    ]);

    if (slipItems > 0 || salaryItems > 0) {
      throw Errors.conflict(
        `Komponen gaji tidak dapat dihapus karena masih dirujuk ${slipItems} rincian slip dan ` +
          `${salaryItems} rincian gaji pegawai. Nonaktifkan saja lewat isActive = false.`
      );
    }

    return prisma.salaryComponent.delete({ where: { id } });
  },

  async seedDefaults(actor: PayrollActor) {
    assertPayroll(actor, 'COMPONENT_WRITE');
    const defaultComponents = [
      // Earnings
      {
        code: 'GAJI_POKOK',
        name: 'Gaji Pokok',
        type: 'EARNING' as SalaryComponentType,
        isFixed: true,
        isTaxable: true,
        sortOrder: 1,
      },
      {
        code: 'TUNJ_JABATAN',
        name: 'Tunjangan Jabatan',
        type: 'EARNING' as SalaryComponentType,
        isFixed: true,
        isTaxable: true,
        sortOrder: 2,
      },
      {
        code: 'TUNJ_MENGAJAR',
        name: 'Tunjangan Mengajar',
        type: 'EARNING' as SalaryComponentType,
        isFixed: true,
        isTaxable: true,
        sortOrder: 3,
      },
      {
        code: 'TUNJ_SERTIFIKASI',
        name: 'Tunjangan Sertifikasi',
        type: 'EARNING' as SalaryComponentType,
        isFixed: true,
        isTaxable: true,
        sortOrder: 4,
      },
      {
        code: 'TUNJ_KELUARGA',
        name: 'Tunjangan Keluarga',
        type: 'EARNING' as SalaryComponentType,
        isFixed: true,
        isTaxable: true,
        sortOrder: 5,
      },
      {
        code: 'TUNJ_TRANSPORT',
        name: 'Tunjangan Transport',
        type: 'EARNING' as SalaryComponentType,
        isFixed: true,
        isTaxable: false,
        sortOrder: 6,
      },
      {
        code: 'TUNJ_MAKAN',
        name: 'Tunjangan Makan',
        type: 'EARNING' as SalaryComponentType,
        isFixed: true,
        isTaxable: false,
        sortOrder: 7,
      },
      {
        code: 'HONOR_TAMBAHAN',
        name: 'Honor Mengajar Tambahan',
        type: 'EARNING' as SalaryComponentType,
        isFixed: false,
        isTaxable: true,
        sortOrder: 8,
      },
      {
        code: 'BONUS',
        name: 'Bonus',
        type: 'EARNING' as SalaryComponentType,
        isFixed: false,
        isTaxable: true,
        sortOrder: 9,
      },
      {
        code: 'LEMBUR',
        name: 'Upah Lembur',
        type: 'EARNING' as SalaryComponentType,
        isFixed: false,
        isTaxable: true,
        sortOrder: 10,
      },
      // Deductions
      {
        code: 'PPH21',
        name: 'PPh 21',
        type: 'DEDUCTION' as SalaryComponentType,
        isFixed: false,
        isTaxable: false,
        sortOrder: 1,
      },
      {
        code: 'BPJS_KES',
        name: 'BPJS Kesehatan',
        type: 'DEDUCTION' as SalaryComponentType,
        isFixed: false,
        isPercentage: true,
        percentageOf: 'GAJI_POKOK',
        defaultRate: 0.01,
        isTaxable: false,
        sortOrder: 2,
      },
      {
        code: 'BPJS_TK',
        name: 'BPJS Ketenagakerjaan',
        type: 'DEDUCTION' as SalaryComponentType,
        isFixed: false,
        isPercentage: true,
        percentageOf: 'GAJI_POKOK',
        defaultRate: 0.02,
        isTaxable: false,
        sortOrder: 3,
      },
      {
        code: 'POT_KOPERASI',
        name: 'Potongan Koperasi',
        type: 'DEDUCTION' as SalaryComponentType,
        isFixed: false,
        isTaxable: false,
        sortOrder: 4,
      },
      {
        code: 'POT_PINJAMAN',
        name: 'Potongan Pinjaman',
        type: 'DEDUCTION' as SalaryComponentType,
        isFixed: false,
        isTaxable: false,
        sortOrder: 5,
      },
      {
        code: 'POT_LAIN',
        name: 'Potongan Lain-lain',
        type: 'DEDUCTION' as SalaryComponentType,
        isFixed: false,
        isTaxable: false,
        sortOrder: 6,
      },
    ];

    for (const comp of defaultComponents) {
      await prisma.salaryComponent.upsert({
        where: { code: comp.code },
        update: {},
        create: {
          ...comp,
          defaultRate: comp.defaultRate ? new Prisma.Decimal(comp.defaultRate) : null,
        },
      });
    }

    return { created: defaultComponents.length };
  },
};

// ============================================
// EMPLOYEE SALARY SERVICE
// ============================================

export const employeeSalaryService = {
  /**
   * A unit treasurer's list always carries the token's unit, whatever `unitId`
   * the request names (R1.16); Super_Admin and the yayasan organs read every
   * unit and may narrow to one (R1.18).
   */
  async list(
    actor: PayrollActor,
    params: { unitId?: string; search?: string; page: number; limit: number }
  ) {
    const { search, page, limit } = params;
    const skip = (page - 1) * limit;
    const unitId = listUnitFor(actor, params.unitId);

    const where: Prisma.EmployeeSalaryWhereInput = {};

    if (unitId) {
      where.staff = { unitId };
    }
    if (search) {
      where.OR = [
        { staff: { user: { name: { contains: search, mode: 'insensitive' } } } },
        { staff: { nip: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.employeeSalary.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          staff: {
            include: {
              user: { select: { id: true, name: true, email: true } },
              unit: { select: { id: true, name: true } },
            },
          },
          items: {
            include: {
              component: { select: { code: true, name: true, type: true } },
            },
          },
        },
      }),
      prisma.employeeSalary.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  /**
   * A salary row outside the caller's reach answers 404, exactly as a missing
   * staffId does (R1.17): the row's existence is never confirmed.
   */
  async getByStaffId(actor: PayrollActor, staffId: string) {
    const salary = await prisma.employeeSalary.findUnique({
      where: { staffId },
      include: {
        staff: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            unit: { select: { id: true, name: true } },
          },
        },
        items: {
          include: {
            component: true,
          },
          orderBy: { component: { sortOrder: 'asc' } },
        },
      },
    });

    if (!salary) throw Errors.notFound(NOT_FOUND.salary);
    assertRowInScope(actor, salary.staff.unitId, NOT_FOUND.salary);
    return salary;
  },

  async create(actor: PayrollActor, data: CreateEmployeeSalaryInput) {
    assertPayroll(actor, 'SALARY_WRITE');
    await assertStaffInScope(actor, data.staffId);

    const { items, ...salaryData } = data;

    return prisma.$transaction(async (tx) => {
      const salary = await tx.employeeSalary.create({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: {
          ...salaryData,
          baseSalary: new Prisma.Decimal(salaryData.baseSalary),
          effectiveAt: new Date(salaryData.effectiveAt),
        } as any,
      });

      if (items && items.length > 0) {
        await tx.employeeSalaryItem.createMany({
          data: items.map((item) => ({
            salaryId: salary.id,
            componentId: item.componentId,
            amount: new Prisma.Decimal(item.amount),
            isPercentage: item.isPercentage,
            rate: item.rate ? new Prisma.Decimal(item.rate) : null,
            notes: item.notes,
          })),
        });
      }

      return salary;
    });
  },

  async update(actor: PayrollActor, staffId: string, data: UpdateEmployeeSalaryInput) {
    assertPayroll(actor, 'SALARY_WRITE');
    await assertStaffInScope(actor, staffId);

    const { items, ...salaryData } = data;

    const existing = await prisma.employeeSalary.findUnique({
      where: { staffId },
    });

    if (!existing) {
      throw Errors.notFound(NOT_FOUND.salary);
    }

    return prisma.$transaction(async (tx) => {
      const salary = await tx.employeeSalary.update({
        where: { staffId },
        data: {
          baseSalary: salaryData.baseSalary ? new Prisma.Decimal(salaryData.baseSalary) : undefined,
          bankName: salaryData.bankName,
          bankAccount: salaryData.bankAccount,
          bankHolder: salaryData.bankHolder,
          taxStatus: salaryData.taxStatus,
          npwp: salaryData.npwp,
          effectiveAt: salaryData.effectiveAt ? new Date(salaryData.effectiveAt) : undefined,
          notes: salaryData.notes,
        },
      });

      if (items) {
        // Delete existing items
        await tx.employeeSalaryItem.deleteMany({
          where: { salaryId: salary.id },
        });

        // Create new items
        if (items.length > 0) {
          await tx.employeeSalaryItem.createMany({
            data: items.map((item) => ({
              salaryId: salary.id,
              componentId: item.componentId,
              amount: new Prisma.Decimal(item.amount),
              isPercentage: item.isPercentage,
              rate: item.rate ? new Prisma.Decimal(item.rate) : null,
              notes: item.notes,
            })),
          });
        }
      }

      return salary;
    });
  },

  async delete(actor: PayrollActor, staffId: string) {
    assertPayroll(actor, 'SALARY_WRITE');
    await assertStaffInScope(actor, staffId);

    const existing = await prisma.employeeSalary.findUnique({ where: { staffId } });
    if (!existing) throw Errors.notFound(NOT_FOUND.salary);

    const usageCount = await prisma.payroll.count({
      where: { staffId },
    });

    if (usageCount > 0) {
      throw Errors.conflict(
        'Pengaturan gaji tidak dapat dihapus karena sudah ada slip gaji untuk pegawai ini'
      );
    }

    return prisma.employeeSalary.delete({ where: { staffId } });
  },
};

// ============================================
// PAYROLL PERIOD SERVICE
// ============================================

export const payrollPeriodService = {
  async list(
    actor: PayrollActor,
    params: {
      unitId?: string;
      year?: number;
      status?: PayrollStatus;
      page: number;
      limit: number;
    }
  ) {
    const { year, status, page, limit } = params;
    const skip = (page - 1) * limit;
    const unitId = listUnitFor(actor, params.unitId);

    const where: Prisma.PayrollPeriodWhereInput = {};

    if (unitId) where.unitId = unitId;
    if (year) where.year = year;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      prisma.payrollPeriod.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        include: {
          unit: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          _count: { select: { payrolls: true } },
        },
      }),
      prisma.payrollPeriod.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  async getById(actor: PayrollActor, id: string) {
    const period = await prisma.payrollPeriod.findUnique({
      where: { id },
      include: {
        unit: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        payrolls: {
          orderBy: { employeeName: 'asc' },
          include: {
            staff: {
              include: {
                user: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (!period) throw Errors.notFound(NOT_FOUND.period);
    assertRowInScope(actor, period.unitId, NOT_FOUND.period);
    return period;
  },

  /**
   * A period is created in the caller's own unit — the body cannot name
   * another one (R1.19) — in DRAFT, with the caller as its creator.
   */
  async create(actor: PayrollActor, data: CreatePayrollPeriodInput) {
    assertPayroll(actor, 'PERIOD_CREATE');
    const unitId = writeUnitFor(actor);

    return prisma.payrollPeriod.create({
      data: {
        ...data,
        unitId,
        activeKey: activePeriodKey(unitId, data.month, data.year),
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        payDate: data.payDate ? new Date(data.payDate) : null,
        status: 'DRAFT',
        createdById: actor.sub,
      } as never,
    });
  },

  async update(actor: PayrollActor, id: string, data: UpdatePayrollPeriodInput) {
    const period = await loadPeriod(id);
    assertPayroll(actor, 'PERIOD_UPDATE', periodFacts(period));

    return prisma.payrollPeriod.update({
      where: { id },
      data: {
        ...data,
        // A period never changes unit: that would move the whole payroll, and
        // its slips, into a unit whose treasurer never approved it.
        unitId: undefined,
        activeKey: activePeriodKey(
          period.unitId,
          data.month ?? period.month,
          data.year ?? period.year
        ),
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        payDate: data.payDate ? new Date(data.payDate) : undefined,
      } as never,
    });
  },

  async approve(actor: PayrollActor, id: string, notes?: string) {
    const period = await loadPeriod(id);
    assertPayroll(actor, 'APPROVE', periodFacts(period));
    const approvedAt = new Date();

    return prisma.$transaction(async (tx) => {
      // Claim the transition first: if another request approved or cancelled
      // the period after we read it, this updates no row and the whole
      // approval is refused instead of overwriting a newer state.
      const claimed = await tx.payrollPeriod.updateMany({
        where: { id, status: 'DRAFT' },
        data: {
          status: 'APPROVED',
          approvedById: actor.sub,
          approvedAt,
          notes: notes || period.notes,
        },
      });
      if (claimed.count === 0) {
        throw Errors.conflict('Periode penggajian sudah berubah dan tidak dapat disetujui');
      }

      await tx.payroll.updateMany({
        where: { periodId: id, status: 'DRAFT' },
        data: { status: 'APPROVED' },
      });

      return tx.payrollPeriod.findUnique({ where: { id } });
    });
  },

  /**
   * Tandai dibayar (R1.27): one transaction moves the period and every
   * APPROVED slip to PAID, stamps `payDate` from the request and `paidAt` from
   * the clock, and books the unit's payroll journal with `actor.sub` as its
   * creator.
   *
   * The journal is written in the same transaction, so a period never reads
   * PAID without its entry: when an account the entry needs is missing the
   * whole transaction rolls back and the period stays APPROVED with its slips,
   * which is what the criterion asks for — a half-booked payment would be
   * worse than none.
   */
  async markAsPaid(actor: PayrollActor, id: string, payDate: Date, notes?: string) {
    const period = await loadPeriod(id);
    assertPayroll(actor, 'PAY', periodFacts(period));

    const paidAt = new Date();

    return prisma.$transaction(async (tx) => {
      // 1. Claim the period first. Two requests that both read APPROVED can
      //    reach here; only the one whose conditional update changes a row may
      //    write the journal, so the second answers 409 instead of booking the
      //    payroll twice.
      const claimed = await tx.payrollPeriod.updateMany({
        where: { id, status: 'APPROVED' },
        data: {
          status: 'PAID',
          payDate,
          paidAt,
          notes: notes || period.notes,
        },
      });
      if (claimed.count === 0) {
        throw Errors.conflict('Periode penggajian sudah berubah dan tidak dapat ditandai dibayar');
      }

      // 2. Every APPROVED slip of the period, and only those: a DRAFT slip was
      //    never approved and must not be paid by this call (R1.11).
      await tx.payroll.updateMany({
        where: { periodId: id, status: 'APPROVED' },
        data: { status: 'PAID' },
      });

      // 3. The journal, for what was actually paid.
      const agg = await tx.payroll.aggregate({
        where: { periodId: id, status: 'PAID' },
        _sum: {
          totalEarnings: true,
          totalDeductions: true,
          taxAmount: true,
          netSalary: true,
        },
      });

      const earnings = agg._sum.totalEarnings || new Prisma.Decimal(0);
      const tax = agg._sum.taxAmount || new Prisma.Decimal(0);
      const totalDeductions = agg._sum.totalDeductions || new Prisma.Decimal(0);
      const net = agg._sum.netSalary || new Prisma.Decimal(0);
      const otherDeductions = totalDeductions.sub(tax);

      if (earnings.gt(0)) {
        const salaryExpenseAcc = await getAccountOrFallback(
          period.unitId,
          ACCOUNT_MAPPING_KEYS.PAYROLL_EXPENSE,
          '5100',
          'Beban Gaji',
          tx
        );

        const cashAcc = await getAccountOrFallback(
          period.unitId,
          ACCOUNT_MAPPING_KEYS.CASH,
          '1101',
          'Kas',
          tx
        );

        if (!salaryExpenseAcc || !cashAcc) {
          throw Errors.conflict(
            'Akun Beban Gaji atau Kas unit ini belum dipetakan di Chart of Accounts, ' +
              'jadi jurnal penggajian tidak dapat dibuat dan pembayaran dibatalkan.'
          );
        }

        const desc = `Penggajian Periode ${period.name}`;

        // Debit Salaries Expense (Gross)
        await tx.journalEntry.create({
          data: {
            unitId: period.unitId,
            date: payDate,
            description: desc,
            reference: period.id,
            referenceType: JournalReferenceType.PAYROLL,
            accountId: salaryExpenseAcc.id,
            debit: earnings,
            credit: 0,
            createdById: actor.sub,
          },
        });

        // Credit Cash (Net Salary)
        await tx.journalEntry.create({
          data: {
            unitId: period.unitId,
            date: payDate,
            description: `Pembayaran Gaji ${period.name}`,
            reference: period.id,
            referenceType: JournalReferenceType.PAYROLL,
            accountId: cashAcc.id,
            debit: 0,
            credit: net,
            createdById: actor.sub,
          },
        });

        // Credit Tax Payable
        if (tax.gt(0)) {
          const taxPayableAcc = await resolveTaxPayableAccount(period.unitId, tx);
          if (!taxPayableAcc) {
            throw Errors.conflict(
              'Pemetaan Akun Utang PPh 21 unit ini belum diisi atau akunnya tidak aktif, ' +
                'jadi jurnal penggajian tidak dapat dibuat dan pembayaran dibatalkan. ' +
                'Isi pemetaannya di Laporan Keuangan → Pengaturan.'
            );
          }
          await tx.journalEntry.create({
            data: {
              unitId: period.unitId,
              date: payDate,
              description: `Penyetoran PPh 21 ${period.name}`,
              reference: period.id,
              referenceType: JournalReferenceType.PAYROLL,
              accountId: taxPayableAcc.id,
              debit: 0,
              credit: tax,
              createdById: actor.sub,
            },
          });
        }

        // Credit Other Payables
        if (otherDeductions.gt(0)) {
          const otherPayableAcc = await tx.accountCode.findFirst({
            where: {
              unitId: period.unitId,
              type: 'LIABILITY',
              OR: [{ code: '2199' }, { name: { contains: 'Utang Lain', mode: 'insensitive' } }],
              isActive: true,
            },
          });
          if (!otherPayableAcc) {
            throw Errors.conflict(
              'Akun Utang Lainnya unit ini tidak ditemukan di Chart of Accounts, ' +
                'jadi jurnal penggajian tidak dapat dibuat dan pembayaran dibatalkan.'
            );
          }
          await tx.journalEntry.create({
            data: {
              unitId: period.unitId,
              date: payDate,
              description: `Potongan Lain ${period.name}`,
              reference: period.id,
              referenceType: JournalReferenceType.PAYROLL,
              accountId: otherPayableAcc.id,
              debit: 0,
              credit: otherDeductions,
              createdById: actor.sub,
            },
          });
        }
      }

      return tx.payrollPeriod.findUnique({ where: { id } });
    });
  },

  /**
   * Refuse a period the caller cannot reach, without loading its slips — the
   * read the attendance-deductions preview needs before it computes anything
   * (R1.17). A period outside the caller's unit answers the 404 of a missing
   * id, so its existence is never confirmed.
   */
  async assertReadable(actor: PayrollActor, id: string) {
    const period = await loadPeriod(id);
    assertRowInScope(actor, period.unitId, NOT_FOUND.period);
    return period;
  },

  async cancel(actor: PayrollActor, id: string, notes?: string) {
    const period = await loadPeriod(id);
    assertPayroll(actor, 'CANCEL', periodFacts(period));

    return prisma.$transaction(async (tx) => {
      // Claim the status we read. If an approval landed in between, this
      // updates no row: a unit treasurer cannot cancel a period the yayasan
      // just approved (R1.31).
      const claimed = await tx.payrollPeriod.updateMany({
        where: { id, status: period.status },
        data: {
          status: 'CANCELLED',
          notes: notes || period.notes,
          // The month is free again: a cancelled period keeps its history but
          // no longer holds the unit's one-period-per-month slot.
          activeKey: null,
        },
      });
      if (claimed.count === 0) {
        throw Errors.conflict('Periode penggajian sudah berubah dan tidak dapat dibatalkan');
      }

      await tx.payroll.updateMany({
        where: { periodId: id },
        data: { status: 'CANCELLED' },
      });

      return tx.payrollPeriod.findUnique({ where: { id } });
    });
  },

  async delete(actor: PayrollActor, id: string) {
    const period = await loadPeriod(id);
    assertPayroll(actor, 'DELETE', periodFacts(period));

    return prisma.$transaction(async (tx) => {
      // Delete all payroll items
      await tx.payrollItem.deleteMany({
        where: { payroll: { periodId: id } },
      });

      // Delete all payrolls
      await tx.payroll.deleteMany({
        where: { periodId: id },
      });

      // Delete period
      return tx.payrollPeriod.delete({ where: { id } });
    });
  },
};

// ============================================
// PAYROLL SERVICE
// ============================================

export const payrollService = {
  /**
   * Slips are read through their period's unit: a treasurer sees its own
   * unit's slips, never another's (R1.17).
   */
  async list(
    actor: PayrollActor,
    params: {
      periodId?: string;
      staffId?: string;
      search?: string;
      page: number;
      limit: number;
    }
  ) {
    const { periodId, staffId, search, page, limit } = params;
    const skip = (page - 1) * limit;
    const unitId = listUnitFor(actor);

    const where: Prisma.PayrollWhereInput = {};

    if (unitId) where.period = { unitId };
    if (periodId) where.periodId = periodId;
    if (staffId) where.staffId = staffId;
    if (search) {
      where.OR = [
        { employeeName: { contains: search, mode: 'insensitive' } },
        { employeeNo: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.payroll.findMany({
        where,
        skip,
        take: limit,
        orderBy: { employeeName: 'asc' },
        include: {
          period: { select: { id: true, name: true, month: true, year: true } },
          staff: {
            include: {
              user: { select: { name: true, email: true } },
              unit: { select: { name: true } },
            },
          },
        },
      }),
      prisma.payroll.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  async getById(actor: PayrollActor, id: string) {
    const slip = await prisma.payroll.findUnique({
      where: { id },
      include: {
        period: true,
        staff: {
          include: {
            user: { select: { name: true, email: true } },
            unit: { select: { name: true } },
          },
        },
        items: {
          orderBy: [{ type: 'asc' }, { component: { sortOrder: 'asc' } }],
          include: {
            component: true,
          },
        },
      },
    });

    if (!slip) throw Errors.notFound(NOT_FOUND.slip);
    assertRowInScope(actor, slip.period.unitId, NOT_FOUND.slip);
    return slip;
  },

  async generate(actor: PayrollActor, data: GeneratePayrollInput) {
    const period = await prisma.payrollPeriod.findUnique({
      where: { id: data.periodId },
      include: { unit: true, _count: { select: { payrolls: true } } },
    });

    if (!period) throw Errors.notFound(NOT_FOUND.period);
    assertPayroll(actor, 'GENERATE', periodFacts(period));

    // Get staff with salary configuration
    const staffWhere: Prisma.StaffWhereInput = {
      unitId: period.unitId,
      deletedAt: null,
      employeeSalary: { isNot: null },
    };

    if (data.staffIds && data.staffIds.length > 0) {
      staffWhere.id = { in: data.staffIds };
    }

    const staffList = await prisma.staff.findMany({
      where: staffWhere,
      include: {
        user: { select: { name: true } },
        employeeSalary: {
          include: {
            items: { include: { component: true } },
          },
        },
      },
    });

    if (staffList.length === 0) {
      throw Errors.badRequest('Tidak ada karyawan dengan pengaturan gaji');
    }

    // Get salary components
    const components = await prisma.salaryComponent.findMany({
      where: { isActive: true },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }],
    });

    const results: { created: number; updated: number; errors: string[] } = {
      created: 0,
      updated: 0,
      errors: [],
    };

    // Get attendance summary for the period
    const attendanceSummary = await prisma.staffAttendance.groupBy({
      by: ['staffId', 'status'],
      where: {
        staffId: { in: staffList.map((s) => s.id) },
        date: {
          gte: period.startDate,
          lte: period.endDate,
        },
      },
      _count: true,
    });

    const attendanceMap = new Map<string, Record<string, number>>();
    for (const att of attendanceSummary) {
      if (!att.staffId) continue;
      const current = attendanceMap.get(att.staffId) || {};
      current[att.status] = att._count;
      attendanceMap.set(att.staffId, current);
    }

    // Attendance-derived adjustments, computed once for the whole period from
    // the configured PayrollPolicyRule rows. Nothing is hardcoded here.
    const deductionRows = await attendanceDeductionService.computeForPeriod(period.id);
    const deductionByStaff = new Map(deductionRows.map((row) => [row.staffId, row]));

    // A payslip cannot be honest while the register it reads is incomplete:
    // a work day with no row means nobody knows whether the person was there,
    // so no deduction can be derived from it. Generation stops here — but only
    // for the staff this request generates, so one employee's missing day does
    // not block everyone else's slip.
    const requestedStaffIds = new Set(staffList.map((s) => s.id));

    // Attendance rules name salary components. A missing component is not
    // created here: components belong to the yayasan and only Bendahara
    // Yayasan writes them (R1.21, R1.23). Refuse and name what is missing.
    const componentByCode = new Map(components.map((component) => [component.code, component]));
    const requestedLines = deductionRows
      .filter((row) => requestedStaffIds.has(row.staffId))
      .flatMap((row) => row.lines);
    const missingComponents = [...new Set(requestedLines.map((line) => line.code))].filter(
      (code) => !componentByCode.has(code)
    );
    if (missingComponents.length > 0) {
      throw Errors.badRequest(
        `Aturan absensi memakai komponen gaji yang belum ada atau tidak aktif: ` +
          `${missingComponents.join(', ')}. Minta Bendahara Yayasan membuat komponen ` +
          'tersebut lebih dulu.'
      );
    }
    const mismatchedComponent = requestedLines.find(
      (line) => componentByCode.get(line.code)?.type !== line.kind
    );
    if (mismatchedComponent) {
      throw Errors.badRequest(
        `Komponen gaji ${mismatchedComponent.code} bertipe ` +
          `${componentByCode.get(mismatchedComponent.code)?.type}, bukan ` +
          `${mismatchedComponent.kind} seperti yang diminta aturan absensi.`
      );
    }

    const unresolved = deductionRows.filter(
      (row) => row.unresolvedDates.length > 0 && requestedStaffIds.has(row.staffId)
    );
    if (unresolved.length > 0) {
      const detail = unresolved
        .slice(0, 5)
        .map((row) => `${row.staffName} (${row.unresolvedDates.length} hari)`)
        .join(', ');
      const more = unresolved.length > 5 ? `, +${unresolved.length - 5} lainnya` : '';
      throw Errors.badRequest(
        `Absensi belum lengkap untuk ${unresolved.length} pegawai: ${detail}${more}. ` +
          'Lengkapi presensi atau tandai pegawai yang tidak masuk sebelum generate slip.'
      );
    }

    // A salary structure that crosses the legal bound (basic below the
    // configured share, or below UMK) is reported, not silently applied —
    // PP 36/2021 art. 32 bounds how far "upah" may be reduced. An admin may
    // still proceed, but only by saying so and leaving a reason on the record.
    // The attendance cap itself is enforced by the engine and never blocks.
    const breached = deductionRows.filter(
      (row) => row.guardBreaches.length > 0 && requestedStaffIds.has(row.staffId)
    );
    if (breached.length > 0 && !data.overrideGuardReason) {
      const detail = breached
        .slice(0, 5)
        .map((row) => `${row.staffName}: ${row.guardBreaches[0]}`)
        .join('; ');
      const more = breached.length > 5 ? `; +${breached.length - 5} lainnya` : '';
      throw Errors.badRequest(
        `Potongan melampaui batas untuk ${breached.length} pegawai — ${detail}${more}. ` +
          'Ubah aturan potongan, atau isi alasan override bila memang disengaja.'
      );
    }
    // The override is not silent: the reason lands on each breaching slip, so
    // the record says who decided and why when the slip is read back.
    const guardNoteByStaff = new Map<string, string>();
    if (data.overrideGuardReason) {
      for (const row of breached) {
        guardNoteByStaff.set(row.staffId, `Override batas potongan: ${data.overrideGuardReason}`);
      }
    }

    // Work days come from the unit's configured week and its holidays, not a
    // Monday–Friday literal: a 6-day unit and a 5-day unit must not print the
    // same number on a slip.
    const workDays = await countWorkDays(period.startDate, period.endDate, period.unitId);

    await prisma.$transaction(async (tx) => {
      for (const staff of staffList) {
        try {
          const empSalary = staff.employeeSalary;
          if (!empSalary) continue;

          // Check existing payroll
          const existing = await tx.payroll.findUnique({
            where: {
              periodId_staffId: {
                periodId: period.id,
                staffId: staff.id,
              },
            },
          });

          if (existing && !data.overwrite) {
            results.errors.push(`${staff.user.name}: Slip gaji sudah ada`);
            continue;
          }

          // Get attendance data
          const attendance = attendanceMap.get(staff.id) || {};
          const presentDays = attendance['PRESENT'] || 0;
          const absentDays = attendance['ABSENT'] || 0;
          const lateDays = attendance['LATE'] || 0;

          // Calculate earnings and deductions
          let totalEarnings = Number(empSalary.baseSalary);
          let totalDeductions = 0;
          let taxableIncome = 0;

          const payrollItems: Prisma.PayrollItemCreateManyInput[] = [];

          // Add base salary as first item. The base component is whichever
          // earning is classified POKOK (or named GAJI_POKOK / BASIC_SALARY):
          // the seed calls it BASIC_SALARY, so matching the literal GAJI_POKOK
          // alone silently dropped the basic salary line from every slip.
          const baseSalaryComponent = components.find(
            (c) => c.type === 'EARNING' && isBasicSalaryComponent(c)
          );
          if (baseSalaryComponent) {
            payrollItems.push({
              payrollId: '', // Will be set after payroll creation
              componentId: baseSalaryComponent.id,
              componentCode: baseSalaryComponent.code,
              componentName: baseSalaryComponent.name,
              type: 'EARNING',
              amount: empSalary.baseSalary,
            });
            if (baseSalaryComponent.isTaxable) {
              taxableIncome += Number(empSalary.baseSalary);
            }
          }

          // Add employee-specific salary items. A basic-salary item is skipped:
          // `EmployeeSalary.baseSalary` is the authoritative base and already
          // printed above, so counting the item too would pay the base twice.
          for (const item of empSalary.items) {
            const comp = item.component;
            if (isBasicSalaryComponent(comp)) continue;
            const amount = effectiveItemAmount(item, Number(empSalary.baseSalary));

            if (comp.type === 'EARNING') {
              totalEarnings += amount;
              if (comp.isTaxable) {
                taxableIncome += amount;
              }
            } else {
              totalDeductions += amount;
            }

            payrollItems.push({
              payrollId: '',
              componentId: comp.id,
              componentCode: comp.code,
              componentName: comp.name,
              type: comp.type,
              amount: new Prisma.Decimal(amount),
              isPercentage: item.isPercentage,
              rate: item.rate,
              baseAmount: item.isPercentage ? empSalary.baseSalary : null,
            });
          }

          // Calculate PPh 21
          const hasNpwp = !!empSalary.npwp;
          const taxAmount = calculateMonthlyPph21(taxableIncome, empSalary.taxStatus, hasNpwp);

          const pph21Component = components.find((c) => c.code === 'PPH21');
          if (pph21Component && taxAmount > 0) {
            totalDeductions += taxAmount;
            payrollItems.push({
              payrollId: '',
              componentId: pph21Component.id,
              componentCode: pph21Component.code,
              componentName: pph21Component.name,
              type: 'DEDUCTION',
              amount: new Prisma.Decimal(taxAmount),
            });
          }

          // Apply the configured attendance rules: deductions come from the
          // allowance side, additions go back to earnings. Each line is written
          // to the slip so the employee can see what was docked and why.
          const attendanceAdjust = deductionByStaff.get(staff.id);
          if (attendanceAdjust) {
            for (const line of attendanceAdjust.lines) {
              const component = componentByCode.get(line.code);
              if (!component) {
                throw new Error(`Komponen gaji ${line.code} tidak ditemukan`);
              }
              if (line.kind === 'DEDUCTION') {
                totalDeductions += line.amount;
              } else {
                totalEarnings += line.amount;
              }
              payrollItems.push({
                payrollId: '',
                componentId: component.id,
                componentCode: line.code,
                componentName: component.name,
                type: line.kind,
                amount: new Prisma.Decimal(line.amount),
                notes: line.detail,
              });
            }
          }

          const netSalaryFinal = totalEarnings - totalDeductions;

          // Create or update payroll
          if (existing && data.overwrite) {
            // Delete existing items
            await tx.payrollItem.deleteMany({
              where: { payrollId: existing.id },
            });

            // Update payroll
            await tx.payroll.update({
              where: { id: existing.id },
              data: {
                employeeNo: staff.nip || '',
                employeeName: staff.user.name,
                department: staff.department,
                position: staff.position,
                baseSalary: empSalary.baseSalary,
                totalEarnings: new Prisma.Decimal(totalEarnings),
                totalDeductions: new Prisma.Decimal(totalDeductions),
                netSalary: new Prisma.Decimal(netSalaryFinal),
                taxableIncome: new Prisma.Decimal(taxableIncome),
                taxAmount: new Prisma.Decimal(taxAmount),
                taxStatus: empSalary.taxStatus,
                bankName: empSalary.bankName,
                bankAccount: empSalary.bankAccount,
                bankHolder: empSalary.bankHolder,
                workDays,
                presentDays,
                absentDays,
                lateDays,
                status: 'DRAFT',
                notes: guardNoteByStaff.get(staff.id),
              },
            });

            // Create items
            await tx.payrollItem.createMany({
              data: payrollItems.map((item) => ({
                ...item,
                payrollId: existing.id,
              })),
            });

            results.updated++;
          } else {
            // Create new payroll
            const payroll = await tx.payroll.create({
              data: {
                periodId: period.id,
                staffId: staff.id,
                employeeNo: staff.nip || '',
                employeeName: staff.user.name,
                department: staff.department,
                position: staff.position,
                baseSalary: empSalary.baseSalary,
                totalEarnings: new Prisma.Decimal(totalEarnings),
                totalDeductions: new Prisma.Decimal(totalDeductions),
                netSalary: new Prisma.Decimal(netSalaryFinal),
                taxableIncome: new Prisma.Decimal(taxableIncome),
                taxAmount: new Prisma.Decimal(taxAmount),
                taxStatus: empSalary.taxStatus,
                bankName: empSalary.bankName,
                bankAccount: empSalary.bankAccount,
                bankHolder: empSalary.bankHolder,
                workDays,
                presentDays,
                absentDays,
                lateDays,
                status: 'DRAFT',
                notes: guardNoteByStaff.get(staff.id),
              },
            });

            // Create items
            await tx.payrollItem.createMany({
              data: payrollItems.map((item) => ({
                ...item,
                payrollId: payroll.id,
              })),
            });

            results.created++;
          }
        } catch (error: any) {
          results.errors.push(`${staff.user.name}: ${error.message}`);
        }
      }

      // Update period totals
      const totals = await tx.payroll.aggregate({
        where: { periodId: period.id },
        _sum: { netSalary: true },
        _count: true,
      });

      await tx.payrollPeriod.update({
        where: { id: period.id },
        data: {
          totalAmount: totals._sum.netSalary || 0,
          employeeCount: totals._count,
        },
      });
    });

    return results;
  },

  async adjustItem(actor: PayrollActor, payrollId: string, adjustment: PayrollItemAdjustmentInput) {
    const payroll = await prisma.payroll.findUnique({
      where: { id: payrollId },
      include: { period: { include: { _count: { select: { payrolls: true } } } } },
    });

    if (!payroll) throw Errors.notFound(NOT_FOUND.slip);
    // A slip outside the caller's unit answers exactly like an unknown slip
    // id — the period's name must not leak through the refusal message.
    assertRowInScope(actor, payroll.period.unitId, NOT_FOUND.slip);
    assertPayroll(actor, 'ADJUST', periodFacts(payroll.period));

    const component = await prisma.salaryComponent.findUnique({
      where: { id: adjustment.componentId },
    });

    if (!component) throw Errors.notFound(NOT_FOUND.component);

    // Find or create the item
    const existingItem = await prisma.payrollItem.findFirst({
      where: {
        payrollId,
        componentId: adjustment.componentId,
      },
    });

    if (existingItem) {
      await prisma.payrollItem.update({
        where: { id: existingItem.id },
        data: {
          amount: new Prisma.Decimal(adjustment.amount),
          notes: adjustment.notes,
        },
      });
    } else {
      await prisma.payrollItem.create({
        data: {
          payrollId,
          componentId: adjustment.componentId,
          componentCode: component.code,
          componentName: component.name,
          type: component.type,
          amount: new Prisma.Decimal(adjustment.amount),
          notes: adjustment.notes,
        },
      });
    }

    // Recalculate totals
    const items = await prisma.payrollItem.findMany({
      where: { payrollId },
    });

    let totalEarnings = 0;
    let totalDeductions = 0;

    for (const item of items) {
      if (item.type === 'EARNING') {
        totalEarnings += Number(item.amount);
      } else {
        totalDeductions += Number(item.amount);
      }
    }

    const netSalary = totalEarnings - totalDeductions;

    await prisma.payroll.update({
      where: { id: payrollId },
      data: {
        totalEarnings: new Prisma.Decimal(totalEarnings),
        totalDeductions: new Prisma.Decimal(totalDeductions),
        netSalary: new Prisma.Decimal(netSalary),
      },
    });

    return prisma.payroll.findUnique({
      where: { id: payrollId },
      include: { items: { include: { component: true } } },
    });
  },

  async getSummary(actor: PayrollActor, periodId: string) {
    const period = await prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      include: { unit: true },
    });

    if (!period) throw Errors.notFound(NOT_FOUND.period);
    assertRowInScope(actor, period.unitId, NOT_FOUND.period);

    const payrolls = await prisma.payroll.findMany({
      where: { periodId },
      include: {
        items: true,
      },
    });

    // Aggregate by component
    const byComponent: Record<
      string,
      { name: string; type: string; total: number; count: number }
    > = {};

    for (const payroll of payrolls) {
      for (const item of payroll.items) {
        const key = item.componentCode;
        if (!byComponent[key]) {
          byComponent[key] = {
            name: item.componentName,
            type: item.type,
            total: 0,
            count: 0,
          };
        }
        byComponent[key].total += Number(item.amount);
        byComponent[key].count++;
      }
    }

    const totals = await prisma.payroll.aggregate({
      where: { periodId },
      _sum: {
        baseSalary: true,
        totalEarnings: true,
        totalDeductions: true,
        netSalary: true,
        taxAmount: true,
      },
      _count: true,
    });

    return {
      period: {
        id: period.id,
        name: period.name,
        month: period.month,
        year: period.year,
        status: period.status,
        unit: period.unit.name,
      },
      summary: {
        employeeCount: totals._count,
        totalBaseSalary: Number(totals._sum.baseSalary) || 0,
        totalEarnings: Number(totals._sum.totalEarnings) || 0,
        totalDeductions: Number(totals._sum.totalDeductions) || 0,
        totalNetSalary: Number(totals._sum.netSalary) || 0,
        totalTax: Number(totals._sum.taxAmount) || 0,
      },
      byComponent: Object.entries(byComponent).map(([code, data]) => ({
        code,
        ...data,
      })),
    };
  },
};

// Helper: Calculate work days (excluding weekends)
/**
 * Working days in a period for a unit: the unit's `WorkWeekConfig` (or the
 * yayasan default), minus whole-unit holidays. The same rules the deduction
 * engine uses, so the slip's day count and its deductions agree.
 */
async function countWorkDays(
  startDate: Date,
  endDate: Date,
  unitId: string | null
): Promise<number> {
  return (await workDatesInRange(startDate, endDate, unitId)).length;
}
