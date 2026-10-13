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
import { JournalReferenceType } from '@cipansor/shared';
import { ACCOUNT_MAPPING_KEYS, getAccountOrFallback } from '../finance/accounting-config.service';
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

  async getById(id: string) {
    return prisma.salaryComponent.findUnique({ where: { id } });
  },

  async create(data: CreateSalaryComponentInput) {
    return prisma.salaryComponent.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        ...data,
        defaultAmount: data.defaultAmount ? new Prisma.Decimal(data.defaultAmount) : null,
        defaultRate: data.defaultRate ? new Prisma.Decimal(data.defaultRate) : null,
      } as any,
    });
  },

  async update(id: string, data: UpdateSalaryComponentInput) {
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

  async delete(id: string) {
    // Check if used in any payroll
    const usageCount = await prisma.payrollItem.count({
      where: { componentId: id },
    });

    if (usageCount > 0) {
      throw new Error('Komponen gaji tidak dapat dihapus karena sudah digunakan');
    }

    return prisma.salaryComponent.delete({ where: { id } });
  },

  async seedDefaults() {
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
  async list(params: { unitId?: string; search?: string; page: number; limit: number }) {
    const { unitId, search, page, limit } = params;
    const skip = (page - 1) * limit;

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

  async getByStaffId(staffId: string) {
    return prisma.employeeSalary.findUnique({
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
  },

  async create(data: CreateEmployeeSalaryInput) {
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

  async update(staffId: string, data: UpdateEmployeeSalaryInput) {
    const { items, ...salaryData } = data;

    const existing = await prisma.employeeSalary.findUnique({
      where: { staffId },
    });

    if (!existing) {
      throw new Error('Pengaturan gaji karyawan tidak ditemukan');
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

  async delete(staffId: string) {
    // Check if used in any payroll
    const usageCount = await prisma.payroll.count({
      where: { staffId },
    });

    if (usageCount > 0) {
      throw new Error('Pengaturan gaji tidak dapat dihapus karena sudah ada slip gaji');
    }

    return prisma.employeeSalary.delete({ where: { staffId } });
  },
};

// ============================================
// PAYROLL PERIOD SERVICE
// ============================================

export const payrollPeriodService = {
  async list(params: {
    unitId?: string;
    year?: number;
    status?: PayrollStatus;
    page: number;
    limit: number;
  }) {
    const { unitId, year, status, page, limit } = params;
    const skip = (page - 1) * limit;

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

  async getById(id: string) {
    return prisma.payrollPeriod.findUnique({
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
  },

  async create(data: CreatePayrollPeriodInput, createdById: string) {
    return prisma.payrollPeriod.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        ...data,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        payDate: data.payDate ? new Date(data.payDate) : null,
        createdById,
      } as any,
    });
  },

  async update(id: string, data: UpdatePayrollPeriodInput) {
    const period = await prisma.payrollPeriod.findUnique({ where: { id } });

    if (!period) {
      throw new Error('Periode penggajian tidak ditemukan');
    }

    if (period.status !== 'DRAFT') {
      throw new Error('Hanya periode DRAFT yang dapat diubah');
    }

    return prisma.payrollPeriod.update({
      where: { id },
      data: {
        ...data,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        payDate: data.payDate ? new Date(data.payDate) : undefined,
      },
    });
  },

  async approve(id: string, approverId: string, notes?: string) {
    const period = await prisma.payrollPeriod.findUnique({
      where: { id },
      include: { _count: { select: { payrolls: true } } },
    });

    if (!period) {
      throw new Error('Periode penggajian tidak ditemukan');
    }

    if (period.status !== 'DRAFT') {
      throw new Error('Hanya periode DRAFT yang dapat disetujui');
    }

    if (period._count.payrolls === 0) {
      throw new Error('Tidak ada slip gaji untuk disetujui');
    }

    return prisma.$transaction(async (tx) => {
      // Update all payrolls to APPROVED
      await tx.payroll.updateMany({
        where: { periodId: id, status: 'DRAFT' },
        data: { status: 'APPROVED' },
      });

      // Update period
      return tx.payrollPeriod.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedById: approverId,
          approvedAt: new Date(),
          notes: notes || period.notes,
        },
      });
    });
  },

  async markAsPaid(id: string, payDate: Date, notes?: string, userId: string = 'SYSTEM') {
    const period = await prisma.payrollPeriod.findUnique({ where: { id } });

    if (!period) {
      throw new Error('Periode penggajian tidak ditemukan');
    }

    if (period.status !== 'APPROVED') {
      throw new Error('Hanya periode APPROVED yang dapat dibayar');
    }

    return prisma.$transaction(async (tx) => {
      // 1. Update all payrolls to PAID
      await tx.payroll.updateMany({
        where: { periodId: id, status: 'APPROVED' },
        data: { status: 'PAID' },
      });

      // 2. Update period
      const updatedPeriod = await tx.payrollPeriod.update({
        where: { id },
        data: {
          status: 'PAID',
          payDate,
          paidAt: new Date(),
          notes: notes || period.notes,
        },
      });

      // 3. INTEGRATION: Create Journal Entry
      const agg = await tx.payroll.aggregate({
        where: { periodId: id },
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
        // Find Accounts
        const salaryExpenseAcc = await getAccountOrFallback(
          period.unitId,
          ACCOUNT_MAPPING_KEYS.PAYROLL_EXPENSE,
          '5100',
          'Beban Gaji'
        );

        const taxPayableAcc = await tx.accountCode.findFirst({
          where: { code: '2103', isActive: true },
        });

        const otherPayableAcc = await tx.accountCode.findFirst({
          where: {
            OR: [{ code: '2199' }, { name: { contains: 'Utang Lain', mode: 'insensitive' } }],
            isActive: true,
          },
        });

        const cashAcc = await getAccountOrFallback(
          period.unitId,
          ACCOUNT_MAPPING_KEYS.CASH,
          '1101',
          'Kas'
        );

        if (!salaryExpenseAcc || !cashAcc) {
          throw new Error(
            'Konfigurasi Akun Gaji/Kas tidak ditemukan. Mohon cek Chart of Accounts.'
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
            createdById: userId,
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
            createdById: userId,
          },
        });

        // Credit Tax Payable
        if (tax.gt(0)) {
          if (!taxPayableAcc) {
            throw new Error('Akun Utang PPh 21 tidak ditemukan. Mohon cek Chart of Accounts.');
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
              createdById: userId,
            },
          });
        }

        // Credit Other Payables
        if (otherDeductions.gt(0)) {
          if (!otherPayableAcc) {
            throw new Error('Akun Utang Lainnya tidak ditemukan. Mohon cek Chart of Accounts.');
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
              createdById: userId,
            },
          });
        }
      }

      return updatedPeriod;
    });
  },

  async cancel(id: string, notes?: string) {
    const period = await prisma.payrollPeriod.findUnique({ where: { id } });

    if (!period) {
      throw new Error('Periode penggajian tidak ditemukan');
    }

    if (period.status === 'PAID') {
      throw new Error('Periode yang sudah dibayar tidak dapat dibatalkan');
    }

    return prisma.$transaction(async (tx) => {
      // Update all payrolls to CANCELLED
      await tx.payroll.updateMany({
        where: { periodId: id },
        data: { status: 'CANCELLED' },
      });

      // Update period
      return tx.payrollPeriod.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          notes: notes || period.notes,
        },
      });
    });
  },

  async delete(id: string) {
    const period = await prisma.payrollPeriod.findUnique({ where: { id } });

    if (!period) {
      throw new Error('Periode penggajian tidak ditemukan');
    }

    if (period.status !== 'DRAFT' && period.status !== 'CANCELLED') {
      throw new Error('Hanya periode DRAFT atau CANCELLED yang dapat dihapus');
    }

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
  async list(params: {
    periodId?: string;
    staffId?: string;
    search?: string;
    page: number;
    limit: number;
  }) {
    const { periodId, staffId, search, page, limit } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.PayrollWhereInput = {};

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

  async getById(id: string) {
    return prisma.payroll.findUnique({
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
  },

  async generate(data: GeneratePayrollInput) {
    const period = await prisma.payrollPeriod.findUnique({
      where: { id: data.periodId },
      include: { unit: true },
    });

    if (!period) {
      throw new Error('Periode penggajian tidak ditemukan');
    }

    if (period.status !== 'DRAFT') {
      throw new Error('Hanya periode DRAFT yang dapat digenerate');
    }

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
      throw new Error('Tidak ada karyawan dengan pengaturan gaji');
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
              let component = components.find((c) => c.code === line.code);
              if (!component) {
                // A rule may name a component that has no payslip line yet;
                // create it so the FK holds and the line is visible.
                component = await tx.salaryComponent.upsert({
                  where: { code: line.code },
                  update: {},
                  create: {
                    code: line.code,
                    name: line.name,
                    type: line.kind,
                    isFixed: false,
                    classification: 'TIDAK_TETAP',
                  },
                });
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

  async adjustItem(payrollId: string, adjustment: PayrollItemAdjustmentInput) {
    const payroll = await prisma.payroll.findUnique({
      where: { id: payrollId },
      include: { period: true },
    });

    if (!payroll) {
      throw new Error('Slip gaji tidak ditemukan');
    }

    if (payroll.period.status !== 'DRAFT') {
      throw new Error('Hanya slip gaji DRAFT yang dapat disesuaikan');
    }

    const component = await prisma.salaryComponent.findUnique({
      where: { id: adjustment.componentId },
    });

    if (!component) {
      throw new Error('Komponen gaji tidak ditemukan');
    }

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

  async getSummary(periodId: string) {
    const period = await prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      include: { unit: true },
    });

    if (!period) {
      throw new Error('Periode penggajian tidak ditemukan');
    }

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
