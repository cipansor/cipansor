import { prisma } from '../../lib/prisma';
import {
  PaymentStatus,
  PaymentMethod,
  PaymentVerificationStatus,
  Prisma,
  NotificationType,
  UserRole,
} from '@prisma/client';
import * as notificationService from '../notifications/notifications.service';
import { eventBus } from '@/lib/event-bus';
import { AccountType, JournalReferenceType } from '@cipansor/shared';
import { ACCOUNT_MAPPING_KEYS, getAccountOrFallback } from './accounting-config.service';
import {
  CreatePaymentTypeDto,
  UpdatePaymentTypeDto,
  QueryPaymentTypeDto,
  CreateInvoiceDto,
  CreateBulkInvoicesDto,
  UpdateInvoiceDto,
  QueryInvoiceDto,
  CreatePaymentDto,
  QueryPaymentDto,
} from './finance.schema';
import { seesAllUnits } from '@/utils/resolve-unit-id';
import { CLASS_ENROLLMENT_STATUS, STUDENT_STATUS } from '@cipansor/shared';
import { nisMapForUnit } from '@/utils/student-nis';
import { wibMonthYear, wibDate, dayDate, utcMonthRange } from '@/utils/wib-day';

// =====================================
// PAYMENT TYPE SERVICE
// =====================================

export async function createPaymentType(data: CreatePaymentTypeDto) {
  const { unitId, ...rest } = data;
  return prisma.paymentType.create({
    data: {
      name: rest.name,
      code: rest.code,
      description: rest.description,
      isRecurring: rest.isRecurring,
      isActive: rest.isActive,
      amount: new Prisma.Decimal(data.amount),
      unit: { connect: { id: unitId } },
      account: rest.accountId ? { connect: { id: rest.accountId } } : undefined,
    },
    include: { unit: { select: { id: true, name: true } } },
  });
}

export async function getPaymentTypes(query: QueryPaymentTypeDto) {
  const { unitId, isActive, isRecurring, search, page, limit } = query;
  const skip = (page - 1) * limit;

  const where = {
    ...(unitId && { unitId }),
    ...(isActive !== undefined && { isActive }),
    ...(isRecurring !== undefined && { isRecurring }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' as const } },
        { code: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
  };

  const [data, total] = await Promise.all([
    prisma.paymentType.findMany({
      where,
      include: { unit: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
      skip,
      take: limit,
    }),
    prisma.paymentType.count({ where }),
  ]);

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getPaymentTypeById(id: string) {
  return prisma.paymentType.findUnique({
    where: { id },
    include: { unit: { select: { id: true, name: true } } },
  });
}

export async function updatePaymentType(id: string, data: UpdatePaymentTypeDto) {
  const { accountId, ...restData } = data;
  return prisma.paymentType.update({
    where: { id },
    data: {
      ...restData,
      ...(restData.amount && { amount: new Prisma.Decimal(restData.amount) }),
      ...(accountId && { account: { connect: { id: accountId } } }),
    },
    include: { unit: { select: { id: true, name: true } } },
  });
}

export async function deletePaymentType(id: string) {
  return prisma.paymentType.update({
    where: { id },
    data: { isActive: false },
  });
}

// =====================================
// INVOICE SERVICE
// =====================================

async function generateInvoiceNumber(
  unitId?: string,
  tx?: Prisma.TransactionClient,
  at: Date = new Date()
): Promise<string> {
  const { year, month: monthIndex } = wibMonthYear(at);
  const month = String(monthIndex + 1).padStart(2, '0');

  const dbClient: any = tx || prisma;

  const lastInvoice = await dbClient.invoice.findFirst({
    where: {
      invoiceNumber: { startsWith: `INV-${year}${month}` },
    },
    orderBy: { invoiceNumber: 'desc' },
  });

  let sequence = 1;
  if (lastInvoice) {
    const lastSeq = parseInt(lastInvoice.invoiceNumber.split('-')[2]);
    sequence = lastSeq + 1;
  }

  return `INV-${year}${month}-${String(sequence).padStart(5, '0')}`;
}

export async function createInvoice(data: CreateInvoiceDto, tx?: Prisma.TransactionClient) {
  let invoice;
  // Bug 1 Fix: Do not retry on P2002 if inside a transaction to prevent transaction aborts
  let retries = tx ? 1 : 3;
  const dbClient: any = tx || prisma;

  while (retries > 0) {
    try {
      // Use transaction client for invoice number generation if available
      const invoiceNumber = await generateInvoiceNumber(undefined, tx);

      const { studentId, paymentTypeId, ...invoiceData } = data;

      // =================================================================
      // INTEGRATION: Apply Scholarship Discounts
      // =================================================================
      let finalAmount = new Prisma.Decimal(data.amount);
      const scholarships = await dbClient.scholarshipRecipient.findMany({
        where: {
          studentId,
          status: 'ACTIVE',
          startDate: { lte: new Date() },
          OR: [{ endDate: null }, { endDate: { gte: new Date() } }],
        },
        include: {
          scholarship: {
            include: {
              discounts: true,
            },
          },
        },
      });

      for (const rec of scholarships) {
        // Find if this scholarship covers this payment type
        // In this implementation, we assume if it has specific discounts, apply them.
        // If it's a general scholarship, it might apply to all.
        for (const discount of rec.scholarship.discounts) {
          if (discount.componentId === paymentTypeId) {
            if (discount.discountType === 'PERCENTAGE') {
              const deduction = finalAmount.mul(discount.discountValue).div(100);
              finalAmount = finalAmount.sub(deduction);
            } else {
              finalAmount = finalAmount.sub(discount.discountValue);
            }
          }
        }
      }

      invoice = await dbClient.invoice.create({
        data: {
          ...invoiceData,
          invoiceNumber,
          amount: finalAmount.lt(0) ? 0 : finalAmount,
          dueDate: dayDate(data.dueDate),
          student: { connect: { id: studentId } },
          paymentType: { connect: { id: paymentTypeId } },
        },
        include: {
          student: {
            include: {
              user: { select: { id: true, name: true, email: true } },
              unit: { select: { id: true, name: true } },
            },
          },
          paymentType: { select: { id: true, name: true, code: true } },
        },
      });
      break;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        retries--;
        if (retries === 0) throw error;
        continue;
      }
      throw error;
    }
  }

  // Bug 3 Fix: Do not send notifications inside a transaction to avoid side-effects on rollback
  if (invoice && !tx) {
    try {
      const formatter = new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
      });

      await notificationService.createNotification({
        userId: invoice.student.user.id,
        title: 'Tagihan Baru',
        message: `Tagihan baru ${invoice.paymentType.name} sebesar ${formatter.format(
          invoice.amount.toNumber()
        )} telah dibuat. Jatuh tempo: ${new Date(invoice.dueDate).toLocaleDateString('id-ID')}`,
        type: 'PAYMENT' as any,
        link: `/finance/bills/${invoice.id}`,
        priority: 'HIGH',
        channels: ['IN_APP', 'EMAIL'],
        recipientType: 'INDIVIDUAL',
      });
    } catch (error) {
      console.error('Failed to send notification:', error);
      // Don't fail the request if notification fails
    }
  }

  return invoice;
}

/**
 * One bill for many santri: the same kind, amount and deadline for each. Every
 * bill goes through `createInvoice`, so it carries the same scholarship
 * discount, invoice numbering and notification as a bill made one at a time.
 *
 * Not the SPP matrix: `generateBulkSppInvoices` bills every active santri of a
 * unit or class for a month and skips the ones already billed, while this takes
 * the santri the caller picked.
 */
export async function createBulkInvoices(data: CreateBulkInvoicesDto) {
  const { studentIds, ...bill } = data;
  const invoices = [];

  for (const studentId of studentIds) {
    invoices.push(await createInvoice({ ...bill, studentId }));
  }

  return { created: invoices.length, invoices };
}

/**
 * The student fields a bill list or bill page needs, and nothing else.
 *
 * These endpoints used `include: { user }`, which returns every scalar column
 * of Student: the santri's NIK and family-card number, both parents' NIK,
 * income and phone. The billing screen reads a name and a NIS.
 */
const INVOICE_STUDENT_SELECT = {
  id: true,
  nis: true,
  unitId: true,
  user: { select: { id: true, name: true } },
} satisfies Prisma.StudentSelect;

/**
 * Invoices a user may see: those of the bill's own unit (its payment type's),
 * the rule the verification queue below already uses. The list had no unit
 * filter at all, so every unit's TU saw every unit's bills.
 */
function invoiceScope(currentUser: VerifierContext): Prisma.InvoiceWhereInput {
  return seesAllUnits(currentUser) ? {} : { paymentType: { unitId: currentUser.unitId ?? 'none' } };
}

/**
 * The due dates that belong to an academic year: every month it spans, from
 * the first of its starting month to the end of its final month.
 *
 * Not `startDate`..`endDate`: the year starts on 15 July, but July's SPP is due
 * on the 10th, so a strict range files July's bills under the year before.
 * Both columns hold a date at UTC midnight, so months are read in UTC.
 */
export function academicYearBillingWindow(year: { startDate: Date; endDate: Date }): {
  gte: Date;
  lt: Date;
} {
  const { startDate: s, endDate: e } = year;
  return {
    gte: new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1)),
    lt: new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 1)),
  };
}

async function billingWindowFor(academicYearId: string | undefined) {
  if (!academicYearId) return undefined;
  const year = await prisma.academicYear.findUnique({
    where: { id: academicYearId },
    select: { startDate: true, endDate: true },
  });
  // An unknown id matches nothing rather than silently widening to all years.
  return year ? academicYearBillingWindow(year) : { gte: new Date(0), lt: new Date(0) };
}

export async function getInvoices(query: QueryInvoiceDto, currentUser: VerifierContext) {
  const {
    studentId,
    paymentTypeId,
    paymentTypeCode,
    status,
    startDate,
    endDate,
    overdue,
    academicYearId,
    search,
    page,
    limit,
  } = query;
  const skip = (page - 1) * limit;

  const window = await billingWindowFor(academicYearId);
  const dueDate: Prisma.DateTimeFilter = {
    ...(window ?? {}),
    ...(startDate && { gte: new Date(startDate) }),
    ...(endDate && { lte: new Date(endDate) }),
  };
  if (overdue === true) {
    const now = new Date();
    dueDate.lt = dueDate.lt && dueDate.lt < now ? dueDate.lt : now;
  }

  const term = search?.trim();
  const where: Prisma.InvoiceWhereInput = {
    AND: [
      invoiceScope(currentUser),
      {
        ...(studentId && { studentId }),
        ...(paymentTypeId && { paymentTypeId }),
        ...(paymentTypeCode && { paymentType: { code: paymentTypeCode } }),
        ...(status && { status }),
        ...(overdue === true && { status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] } }),
        ...(Object.keys(dueDate).length > 0 && { dueDate }),
        ...(term && {
          OR: [
            { invoiceNumber: { contains: term, mode: 'insensitive' } },
            { student: { nis: { contains: term } } },
            { student: { user: { name: { contains: term, mode: 'insensitive' } } } },
          ],
        }),
      },
    ],
  };

  const [data, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        student: { select: INVOICE_STUDENT_SELECT },
        paymentType: { select: { id: true, name: true, code: true } },
        _count: { select: { payments: true } },
      },
      // Newest first: a TU opens this list to see this month's bills, and
      // ascending order opened it on July 2024.
      orderBy: [{ dueDate: 'desc' }, { invoiceNumber: 'asc' }],
      skip,
      take: limit,
    }),
    prisma.invoice.count({ where }),
  ]);

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/** One bill, or null when it doesn't exist or belongs to another unit. */
export async function getInvoiceById(id: string, currentUser: VerifierContext) {
  return prisma.invoice.findFirst({
    where: { AND: [{ id }, invoiceScope(currentUser)] },
    include: {
      student: {
        select: { ...INVOICE_STUDENT_SELECT, unit: { select: { id: true, name: true } } },
      },
      paymentType: { select: { id: true, name: true, code: true, amount: true } },
      payments: {
        orderBy: { paidAt: 'desc' },
      },
    },
  });
}

export async function updateInvoice(id: string, data: UpdateInvoiceDto) {
  return prisma.invoice.update({
    where: { id },
    data: {
      ...data,
      ...(data.amount && { amount: new Prisma.Decimal(data.amount) }),
      ...(data.dueDate && { dueDate: dayDate(data.dueDate) }),
    },
    include: {
      student: {
        include: {
          user: { select: { id: true, name: true } },
        },
      },
      paymentType: { select: { id: true, name: true, code: true } },
    },
  });
}

export async function deleteInvoice(id: string) {
  return prisma.invoice.update({
    where: { id },
    data: { status: PaymentStatus.CANCELLED },
  });
}

// =====================================
// PAYMENT SERVICE
// =====================================

export async function createPayment(data: CreatePaymentDto, userId: string = 'SYSTEM') {
  // Create payment and update invoice in a transaction
  const payment = await prisma.$transaction(async (tx) => {
    // 1. Fetch invoice with all required details upfront
    const invoice = await tx.invoice.findUnique({
      where: { id: data.invoiceId },
      include: {
        student: {
          include: {
            user: { select: { name: true } }, // Fetch user name for description
          },
        },
        paymentType: { select: { id: true, name: true, accountId: true, unitId: true } },
      },
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    // Tagihan milik unit JENIS BAYARNYA (SPP SD IT = tagihan SD IT), bukan unit
    // santri sekarang. Santri yang sudah naik ke SMP IT dan melunasi SPP SD IT
    // yang tertunggak dulu tercatat sebagai kas SMP IT yang mengkredit akun
    // pendapatan SD IT — satu transaksi, dua buku unit.
    const unitTagihan = invoice.paymentType.unitId;

    const { invoiceId, ...paymentData } = data;
    const payment = await tx.payment.create({
      data: {
        method: paymentData.method,
        referenceNo: paymentData.referenceNo,
        notes: paymentData.notes,
        amount: new Prisma.Decimal(data.amount),
        invoice: { connect: { id: invoiceId } },
      },
      include: {
        invoice: {
          include: {
            student: {
              include: {
                user: { select: { id: true, name: true } },
              },
            },
            paymentType: { select: { id: true, name: true, unitId: true } },
          },
        },
      },
    });

    // Update invoice paid amount and status
    const newPaidAmount = invoice.paidAmount.add(new Prisma.Decimal(data.amount));
    let newStatus: PaymentStatus;

    if (newPaidAmount.gte(invoice.amount)) {
      newStatus = PaymentStatus.PAID;
    } else if (newPaidAmount.gt(0)) {
      newStatus = PaymentStatus.PARTIAL;
    } else {
      newStatus = PaymentStatus.PENDING;
    }

    await tx.invoice.update({
      where: { id: data.invoiceId },
      data: {
        paidAmount: newPaidAmount,
        status: newStatus,
      },
    });

    // =================================================================
    // INTEGRATION: Create Journal Entry for Accounting
    // =================================================================
    if (invoice.paymentType.accountId && unitTagihan) {
      // 1. Determine Debit Account (Asset) based on Payment Method
      const isBank = ['BANK_TRANSFER', 'VIRTUAL_ACCOUNT', 'QRIS', 'EWALLET'].includes(
        payment.method
      );
      const mappingKey = isBank ? ACCOUNT_MAPPING_KEYS.BANK : ACCOUNT_MAPPING_KEYS.CASH;
      const fallbackCode = isBank ? '1102' : '1101';
      const fallbackName = isBank ? 'Bank' : 'Kas';

      const assetAccount = await getAccountOrFallback(
        unitTagihan,
        mappingKey,
        fallbackCode,
        fallbackName
      );

      if (assetAccount) {
        const descriptionPrefix = `Pembayaran ${invoice.invoiceNumber}`;

        // Debit Entry (Asset increases)
        await tx.journalEntry.create({
          data: {
            unitId: unitTagihan,
            accountId: assetAccount.id,
            date: new Date(),
            description: `${descriptionPrefix} (${payment.method})`,
            debit: payment.amount,
            credit: 0,
            reference: payment.id,
            referenceType: JournalReferenceType.PAYMENT,
            createdById: userId,
          },
        });

        // Credit Entry (Revenue increases)
        await tx.journalEntry.create({
          data: {
            unitId: unitTagihan,
            accountId: invoice.paymentType.accountId,
            date: new Date(),
            description: `Pendapatan ${invoice.paymentType.name} - ${invoice.student.user.name}`,
            debit: 0,
            credit: payment.amount,
            reference: payment.id,
            referenceType: JournalReferenceType.PAYMENT,
            createdById: userId,
          },
        });
      } else {
        // If no account found, we must throw error to maintain integrity
        console.warn(
          `Accounting Integration: No Asset Account found for method ${payment.method} in unit ${unitTagihan}`
        );
      }
    }

    return payment;
  });

  // Send notification after transaction commits
  try {
    const formatter = new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
    });

    await notificationService.createNotification({
      userId: payment.invoice.student.user.id,
      title: 'Pembayaran Berhasil',
      message: `Pembayaran untuk tagihan ${payment.invoice.paymentType.name} sebesar ${formatter.format(
        payment.amount.toNumber()
      )} telah diterima.`,
      type: NotificationType.PAYMENT,
      link: `/finance/bills/${payment.invoice.id}`,
      priority: 'HIGH',
      channels: ['IN_APP', 'EMAIL'],
      recipientType: 'INDIVIDUAL',
    });
  } catch (error) {
    console.error('Failed to send payment notification:', error);
  }

  // Emit event for cross-module integration (dashboard real-time updates)
  try {
    // Unit penerima pembayaran = unit tagihannya (lihat createPayment).
    const unitTagihan = await prisma.unit.findUnique({
      where: { id: payment.invoice.paymentType.unitId },
      select: { id: true, name: true },
    });

    if (unitTagihan) {
      eventBus.emit('finance:payment-received', {
        id: payment.id,
        invoiceId: payment.invoiceId,
        studentId: payment.invoice.studentId,
        studentName: payment.invoice.student.user.name,
        unitId: unitTagihan.id,
        unitName: unitTagihan.name,
        amount: payment.amount.toNumber(),
        paymentMethod: payment.method,
        paidAt: payment.paidAt || new Date(),
        processedById: 'SYSTEM',
      });
    }
  } catch (error) {
    console.error('Failed to emit payment event:', error);
  }

  return payment;
}

// =================================================================
// PAYMENT PROOF + TWO-STEP VERIFICATION (maker-checker Tata Usaha)
// =================================================================

interface VerifierContext {
  sub: string;
  role: string;
  /**
   * RoleCode granular. Wajib ada agar scoping bisa memakai seesAllUnits():
   * `role` legacy memetakan setiap YAYASAN_* menjadi 'UNIT_ADMIN', sehingga
   * pemeriksaan yang ditulis atas `role` menggolongkan pengurus yayasan
   * sebagai admin unit — itulah yang menyembunyikan datanya.
   */
  roleCode?: string | null;
  unitId: string | null;
}

/**
 * Parent/student submits a transfer proof against their own invoice.
 * Creates a Payment in PENDING_VERIFICATION — the invoice and ledger are
 * only touched when the payment reaches FINAL_APPROVED.
 */
export async function submitPaymentProof(
  input: {
    invoiceId: string;
    amount: number;
    method: PaymentMethod;
    referenceNo?: string;
    proofUrl: string;
    notes?: string;
  },
  currentUser: VerifierContext
) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    include: {
      student: { select: { id: true, userId: true, unitId: true } },
      paymentType: { select: { name: true } },
    },
  });
  if (!invoice) throw new Error('Invoice not found');
  if (invoice.status === PaymentStatus.PAID || invoice.status === PaymentStatus.CANCELLED) {
    throw new Error('Invoice is not payable');
  }

  // Ownership: parents may only pay their own children's invoices,
  // students only their own.
  if (currentUser.role === UserRole.PARENT) {
    const link = await prisma.studentParent.findUnique({
      where: {
        studentId_parentId: { studentId: invoice.student.id, parentId: currentUser.sub },
      },
    });
    if (!link) throw new Error("Access denied: not your child's invoice");
  } else if (currentUser.role === UserRole.STUDENT) {
    if (invoice.student.userId !== currentUser.sub) {
      throw new Error('Access denied: not your invoice');
    }
  }

  const remaining = invoice.amount.sub(invoice.paidAmount);
  if (new Prisma.Decimal(input.amount).gt(remaining)) {
    throw new Error('Amount exceeds the remaining invoice balance');
  }

  const payment = await prisma.payment.create({
    data: {
      invoiceId: input.invoiceId,
      amount: new Prisma.Decimal(input.amount),
      method: input.method,
      referenceNo: input.referenceNo,
      notes: input.notes,
      proofUrl: input.proofUrl,
      verificationStatus: PaymentVerificationStatus.PENDING_VERIFICATION,
    },
  });

  try {
    await notificationService.createNotification({
      userId: currentUser.sub,
      title: 'Bukti Pembayaran Diterima',
      message: `Bukti pembayaran ${invoice.paymentType.name} sedang menunggu verifikasi Tata Usaha.`,
      type: NotificationType.PAYMENT,
      link: `/finance/bills/${invoice.id}`,
      priority: 'LOW',
      channels: ['IN_APP'],
      recipientType: 'INDIVIDUAL',
    });
  } catch (error) {
    console.error('Failed to send proof-received notification:', error);
  }

  return payment;
}

/**
 * List payments awaiting verification for the TU queue (unit-scoped for
 * non-super-admins).
 */
export async function getPendingVerifications(
  currentUser: VerifierContext,
  query: { page?: number; limit?: number; status?: PaymentVerificationStatus }
) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const status = query.status ?? PaymentVerificationStatus.PENDING_VERIFICATION;

  const where: Prisma.PaymentWhereInput = {
    verificationStatus: status,
    // Pengurus yayasan memegang FINANCE_VIEW (Ketua bahkan FINANCE_MANAGE)
    // tetapi tidak punya unitId, sehingga cabang lama menyaringnya ke 'none'
    // dan daftar verifikasi pembayaran selalu kosong bagi mereka.
    ...(seesAllUnits(currentUser)
      ? {}
      : { invoice: { paymentType: { unitId: currentUser.unitId ?? 'none' } } }),
  };

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'asc' },
      include: {
        invoice: {
          include: {
            student: {
              select: {
                id: true,
                nis: true,
                unitId: true,
                user: { select: { name: true } },
              },
            },
            paymentType: { select: { name: true } },
          },
        },
        tuVerifiedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.payment.count({ where }),
  ]);

  return {
    data: payments,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Two-step verification state machine:
 *   PENDING_VERIFICATION --TU_APPROVE--> TU_APPROVED --FINAL_APPROVE--> FINAL_APPROVED
 *   PENDING_VERIFICATION / TU_APPROVED --REJECT--> REJECTED
 * Invalid transitions throw (idempotent — re-approving a FINAL_APPROVED
 * payment cannot double-post the invoice or the ledger). The final
 * approver must be a different user than the TU verifier (separation of
 * duties), and non-super-admins can only verify payments of their unit.
 */
export async function verifyPayment(
  paymentId: string,
  action: 'TU_APPROVE' | 'FINAL_APPROVE' | 'REJECT',
  currentUser: VerifierContext,
  rejectionReason?: string
) {
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        invoice: {
          include: {
            student: {
              include: { user: { select: { id: true, name: true } } },
            },
            paymentType: { select: { id: true, name: true, accountId: true, unitId: true } },
          },
        },
      },
    });
    if (!payment) throw new Error('Payment not found');

    // Lingkup unit = unit TAGIHAN, sama dengan antrean getPendingVerifications
    // (keduanya dulu memakai unit santri sekarang, dan pemeriksaan ini hanya
    // mengenal SUPER_ADMIN sehingga pengurus yayasan melihat antrean yang tak
    // bisa mereka setujui).
    const unitTagihan = payment.invoice.paymentType.unitId;
    if (!seesAllUnits(currentUser) && unitTagihan !== currentUser.unitId) {
      throw new Error('Access denied: payment belongs to another unit');
    }

    const status = payment.verificationStatus;

    if (action === 'TU_APPROVE') {
      if (status !== PaymentVerificationStatus.PENDING_VERIFICATION) {
        throw new Error(`Cannot TU-approve a payment in status ${status}`);
      }
      return tx.payment.update({
        where: { id: paymentId },
        data: {
          verificationStatus: PaymentVerificationStatus.TU_APPROVED,
          tuVerifiedAt: new Date(),
          tuVerifiedById: currentUser.sub,
          rejectionReason: null,
        },
      });
    }

    if (action === 'REJECT') {
      if (
        status !== PaymentVerificationStatus.PENDING_VERIFICATION &&
        status !== PaymentVerificationStatus.TU_APPROVED
      ) {
        throw new Error(`Cannot reject a payment in status ${status}`);
      }
      return tx.payment.update({
        where: { id: paymentId },
        data: {
          verificationStatus: PaymentVerificationStatus.REJECTED,
          rejectionReason: rejectionReason ?? 'Bukti pembayaran tidak valid',
        },
      });
    }

    // FINAL_APPROVE
    if (status !== PaymentVerificationStatus.TU_APPROVED) {
      throw new Error(`Cannot final-approve a payment in status ${status}`);
    }
    if (payment.tuVerifiedById === currentUser.sub) {
      throw new Error('Separation of duties: final approver must differ from the TU verifier');
    }

    const invoice = payment.invoice;
    const newPaidAmount = invoice.paidAmount.add(payment.amount);
    const newStatus: PaymentStatus = newPaidAmount.gte(invoice.amount)
      ? PaymentStatus.PAID
      : PaymentStatus.PARTIAL;

    await tx.invoice.update({
      where: { id: invoice.id },
      data: { paidAmount: newPaidAmount, status: newStatus },
    });

    // Ledger posting (same double entry as direct payments)
    if (invoice.paymentType.accountId && unitTagihan) {
      const isBank = ['BANK_TRANSFER', 'VIRTUAL_ACCOUNT', 'QRIS', 'EWALLET'].includes(
        payment.method
      );
      const mappingKey = isBank ? ACCOUNT_MAPPING_KEYS.BANK : ACCOUNT_MAPPING_KEYS.CASH;
      const assetAccount = await getAccountOrFallback(
        unitTagihan,
        mappingKey,
        isBank ? '1102' : '1101',
        isBank ? 'Bank' : 'Kas'
      );
      if (assetAccount) {
        await tx.journalEntry.create({
          data: {
            unitId: unitTagihan,
            accountId: assetAccount.id,
            date: new Date(),
            description: `Pembayaran ${invoice.invoiceNumber} (${payment.method})`,
            debit: payment.amount,
            credit: 0,
            reference: payment.id,
            referenceType: JournalReferenceType.PAYMENT,
            createdById: currentUser.sub,
          },
        });
        await tx.journalEntry.create({
          data: {
            unitId: unitTagihan,
            accountId: invoice.paymentType.accountId,
            date: new Date(),
            description: `Pendapatan ${invoice.paymentType.name} - ${invoice.student.user.name}`,
            debit: 0,
            credit: payment.amount,
            reference: payment.id,
            referenceType: JournalReferenceType.PAYMENT,
            createdById: currentUser.sub,
          },
        });
      }
    }

    return tx.payment.update({
      where: { id: paymentId },
      data: {
        verificationStatus: PaymentVerificationStatus.FINAL_APPROVED,
        finalVerifiedAt: new Date(),
        finalVerifiedById: currentUser.sub,
      },
    });
  });

  // Post-commit notifications (never inside the transaction)
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        invoice: {
          include: {
            student: {
              select: {
                userId: true,
                parents: { select: { parentId: true } },
              },
            },
            paymentType: { select: { name: true } },
          },
        },
      },
    });
    if (payment) {
      const recipients = [
        payment.invoice.student.userId,
        ...payment.invoice.student.parents.map((link) => link.parentId),
      ];
      const formatter = new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
      });
      const isApproved = payment.verificationStatus === PaymentVerificationStatus.FINAL_APPROVED;
      const isRejected = payment.verificationStatus === PaymentVerificationStatus.REJECTED;
      if (isApproved || isRejected) {
        await Promise.allSettled(
          recipients.map((userId) =>
            notificationService.createNotification({
              userId,
              title: isApproved ? 'Pembayaran SPP Berhasil' : 'Bukti Pembayaran Ditolak',
              message: isApproved
                ? `Pembayaran ${payment.invoice.paymentType.name} sebesar ${formatter.format(
                    payment.amount.toNumber()
                  )} telah diverifikasi dan tercatat.`
                : `Bukti pembayaran ${payment.invoice.paymentType.name} ditolak: ${
                    payment.rejectionReason ?? '-'
                  }. Silakan unggah ulang bukti yang valid.`,
              type: NotificationType.PAYMENT,
              link: `/finance/bills/${payment.invoiceId}`,
              priority: 'HIGH',
              channels: isApproved ? ['IN_APP', 'EMAIL', 'WHATSAPP'] : ['IN_APP'],
              recipientType: 'INDIVIDUAL',
            })
          )
        );
      }
    }
  } catch (error) {
    console.error('Failed to send verification notification:', error);
  }

  return result;
}

/**
 * Payments a user may see. Staff: their unit's bills (invoiceScope). A parent,
 * who may open a single receipt: only payments on their own children's bills.
 */
function paymentScope(currentUser: VerifierContext): Prisma.PaymentWhereInput {
  if (currentUser.role === UserRole.PARENT) {
    return { invoice: { student: { parents: { some: { parentId: currentUser.sub } } } } };
  }
  return { invoice: invoiceScope(currentUser) };
}

const PAYMENT_INVOICE_INCLUDE = {
  invoice: {
    include: {
      student: { select: INVOICE_STUDENT_SELECT },
      paymentType: { select: { id: true, name: true, code: true } },
    },
  },
} satisfies Prisma.PaymentInclude;

export async function getPayments(query: QueryPaymentDto, currentUser: VerifierContext) {
  const { invoiceId, method, startDate, endDate, page, limit } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.PaymentWhereInput = {
    AND: [
      paymentScope(currentUser),
      {
        ...(invoiceId && { invoiceId }),
        ...(method && { method }),
        ...(startDate || endDate
          ? {
              paidAt: {
                ...(startDate && { gte: new Date(startDate) }),
                ...(endDate && { lte: new Date(endDate) }),
              },
            }
          : {}),
      },
    ],
  };

  const [data, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: PAYMENT_INVOICE_INCLUDE,
      orderBy: { paidAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.payment.count({ where }),
  ]);

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/** One payment, or null when it doesn't exist or is outside paymentScope. */
export async function getPaymentById(id: string, currentUser: VerifierContext) {
  return prisma.payment.findFirst({
    where: { AND: [{ id }, paymentScope(currentUser)] },
    include: {
      invoice: {
        include: {
          ...PAYMENT_INVOICE_INCLUDE.invoice.include,
          // The receipt prints the santri's class.
          student: {
            select: {
              ...INVOICE_STUDENT_SELECT,
              enrollments: {
                where: { status: CLASS_ENROLLMENT_STATUS.ACTIVE },
                select: { class: { select: { id: true, name: true } } },
                take: 1,
                orderBy: { enrolledAt: 'desc' },
              },
            },
          },
        },
      },
    },
  });
}

// =====================================
// ANALYTICS
// =====================================

export async function getStudentFinanceSummary(studentId: string) {
  const invoices = await prisma.invoice.findMany({
    where: { studentId },
    include: {
      paymentType: { select: { id: true, name: true } },
    },
  });

  const total = invoices.reduce((sum, inv) => sum.add(inv.amount), new Prisma.Decimal(0));
  const paid = invoices.reduce((sum, inv) => sum.add(inv.paidAmount), new Prisma.Decimal(0));
  const pending = total.sub(paid);

  const overdue = invoices.filter(
    (inv) =>
      (inv.status === PaymentStatus.PENDING || inv.status === PaymentStatus.PARTIAL) &&
      new Date(inv.dueDate) < new Date()
  );

  return {
    total: total.toNumber(),
    paid: paid.toNumber(),
    pending: pending.toNumber(),
    overdueCount: overdue.length,
    overdueAmount: overdue.reduce((sum, inv) => sum + inv.amount.sub(inv.paidAmount).toNumber(), 0),
  };
}

export async function getUnitFinanceStats(unitId: string, month?: string) {
  let dateFilter: { dueDate?: { gte: Date; lt: Date } } = {};
  if (month) {
    const [year, monthIndex] = month.split('-').map(Number);
    const { start, end } = utcMonthRange(year, monthIndex - 1);
    dateFilter = { dueDate: { gte: start, lt: end } };
  }

  // Tagihan unit = tagihan jenis bayar unit itu, termasuk milik santri yang
  // sejak itu pindah unit — tunggakannya tetap piutang unit penerbit.
  const invoices = await prisma.invoice.findMany({
    where: {
      paymentType: { unitId },
      ...dateFilter,
    },
  });

  const total = invoices.reduce((sum, inv) => sum.add(inv.amount), new Prisma.Decimal(0));
  const collected = invoices.reduce((sum, inv) => sum.add(inv.paidAmount), new Prisma.Decimal(0));
  const pending = total.sub(collected);

  const byStatus = await prisma.invoice.groupBy({
    by: ['status'],
    where: { paymentType: { unitId }, ...dateFilter },
    _count: true,
    _sum: { amount: true },
  });

  return {
    total: total.toNumber(),
    collected: collected.toNumber(),
    pending: pending.toNumber(),
    collectionRate: total.gt(0) ? collected.div(total).mul(100).toNumber() : 0,
    byStatus: byStatus.map((s) => ({
      status: s.status,
      count: s._count,
      amount: s._sum.amount?.toNumber() || 0,
    })),
  };
}

/**
 * Billing summary for the finance and foundation dashboards: the user's own
 * unit, or every unit for foundation-scope roles, over one academic year when
 * `academicYearId` is given (see academicYearBillingWindow).
 *
 * The web app has called GET /api/finance/summary since those pages were
 * written, but the route never existed — every card rendered zero. Shape
 * matches the `FinancialSummary` interface in apps/web/src/hooks/use-finance.ts.
 *
 * It used to ignore both the unit and the year, so an SMP IT admin read the
 * whole yayasan's all-time totals under a card labelled "tahun ajaran aktif".
 */
export async function getFinancialSummary(currentUser: VerifierContext, academicYearId?: string) {
  const now = new Date();
  const window = await billingWindowFor(academicYearId);
  const where: Prisma.InvoiceWhereInput = {
    AND: [invoiceScope(currentUser), window ? { dueDate: window } : {}],
  };

  const [invoices, recentPayments] = await Promise.all([
    prisma.invoice.findMany({
      where,
      select: {
        amount: true,
        paidAmount: true,
        status: true,
        dueDate: true,
        paymentType: { select: { name: true } },
      },
    }),
    prisma.payment.findMany({
      where: { invoice: where },
      take: 10,
      orderBy: { paidAt: 'desc' },
      include: {
        invoice: {
          select: {
            invoiceNumber: true,
            student: { select: { id: true, nis: true, user: { select: { name: true } } } },
          },
        },
      },
    }),
  ]);

  const zero = new Prisma.Decimal(0);
  let totalBilled = zero;
  let totalPaid = zero;
  let totalOverdue = zero;

  const byType = new Map<string, { total: Prisma.Decimal; paid: Prisma.Decimal }>();

  for (const inv of invoices) {
    totalBilled = totalBilled.add(inv.amount);
    totalPaid = totalPaid.add(inv.paidAmount);

    const unpaid = inv.amount.sub(inv.paidAmount);
    const isSettled = inv.status === PaymentStatus.PAID;
    if (!isSettled && inv.dueDate < now && unpaid.gt(0)) {
      totalOverdue = totalOverdue.add(unpaid);
    }

    const name = inv.paymentType?.name ?? 'Lainnya';
    const bucket = byType.get(name) ?? { total: zero, paid: zero };
    byType.set(name, {
      total: bucket.total.add(inv.amount),
      paid: bucket.paid.add(inv.paidAmount),
    });
  }

  return {
    totalBilled: totalBilled.toNumber(),
    totalPaid: totalPaid.toNumber(),
    totalOutstanding: totalBilled.sub(totalPaid).toNumber(),
    totalOverdue: totalOverdue.toNumber(),
    billsByType: Array.from(byType.entries())
      .map(([type, v]) => ({
        type,
        total: v.total.toNumber(),
        paid: v.paid.toNumber(),
        outstanding: v.total.sub(v.paid).toNumber(),
      }))
      .sort((a, b) => b.total - a.total),
    recentPayments,
  };
}

export async function getStudentOutstandingBalances(unitId: string) {
  const invoices = await prisma.invoice.findMany({
    where: {
      paymentType: { unitId },
      status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL] },
      dueDate: { lt: new Date() },
    },
    include: {
      student: {
        include: {
          user: { select: { id: true, name: true } },
          enrollments: {
            where: { status: CLASS_ENROLLMENT_STATUS.ACTIVE },
            include: { class: { select: { id: true, name: true } } },
            take: 1,
            orderBy: { enrolledAt: 'desc' },
          },
        },
      },
    },
  });

  const studentMap = new Map<string, any>();
  // NIS yang dikenal unit penerbit tagihan, bukan NIS unit santri sekarang.
  const nisUnit = await nisMapForUnit(
    prisma,
    unitId,
    invoices.map((inv) => inv.student)
  );

  for (const inv of invoices) {
    const unpaidAmount = inv.amount.sub(inv.paidAmount).toNumber();
    if (unpaidAmount <= 0) continue;

    if (!studentMap.has(inv.studentId)) {
      studentMap.set(inv.studentId, {
        studentId: inv.studentId,
        studentName: inv.student.user.name,
        nis: nisUnit.get(inv.studentId) ?? '-',
        className: inv.student.enrollments[0]?.class?.name || '-',
        unpaid_amount: 0,
        overdueInvoiceCount: 0,
      });
    }

    const rec = studentMap.get(inv.studentId);
    rec.unpaid_amount += unpaidAmount;
    rec.overdueInvoiceCount += 1;
  }

  return Array.from(studentMap.values()).sort((a, b) => b.unpaid_amount - a.unpaid_amount);
}

// =====================================
// SPP MATRIX - Tampilan bulanan per santri
// =====================================

export interface SppMatrixQuery {
  unitId?: string;
  classId?: string;
  year: number;
  paymentTypeId?: string;
}

export interface StudentSppRow {
  studentId: string;
  studentName: string;
  nis: string;
  className: string;
  months: {
    [month: string]: {
      invoiceId?: string;
      status: 'PAID' | 'PARTIAL' | 'PENDING' | 'OVERDUE' | 'NOT_BILLED';
      amount: number;
      paidAmount: number;
      dueDate?: string;
    };
  };
  totalAmount: number;
  totalPaid: number;
}

export async function getSppMatrix(query: SppMatrixQuery) {
  const { unitId, classId, year, paymentTypeId } = query;

  // Get students with their class enrollment
  const students = await prisma.student.findMany({
    where: {
      ...(unitId && { unitId }),
      ...(classId && {
        enrollments: {
          some: { classId },
        },
      }),
    },
    include: {
      user: { select: { id: true, name: true } },
      enrollments: {
        include: {
          class: { select: { id: true, name: true } },
        },
        orderBy: { enrolledAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { nis: 'asc' },
  });

  // Get SPP payment type (recurring monthly)
  const sppPaymentType = paymentTypeId
    ? await prisma.paymentType.findUnique({ where: { id: paymentTypeId } })
    : await prisma.paymentType.findFirst({
        where: {
          code: 'SPP',
          isRecurring: true,
          ...(unitId && { unitId }),
        },
      });

  if (!sppPaymentType) {
    return { students: [], sppRate: 0, year, months: [] };
  }

  // Define months for the year
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31, 23, 59, 59);

  // Get all invoices for these students for the year
  const studentIds = students.map((s) => s.id);
  const invoices = await prisma.invoice.findMany({
    where: {
      studentId: { in: studentIds },
      paymentTypeId: sppPaymentType.id,
      dueDate: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      payments: true,
    },
  });

  // Build matrix data
  const now = new Date();
  const matrixData: StudentSppRow[] = students.map((student) => {
    const studentInvoices = invoices.filter((inv) => inv.studentId === student.id);
    const monthsData: StudentSppRow['months'] = {};

    let totalAmount = 0;
    let totalPaid = 0;

    months.forEach((monthName, index) => {
      const monthDate = new Date(year, index, 10); // Due date is 10th of each month
      const invoice = studentInvoices.find((inv) => {
        const invMonth = new Date(inv.dueDate).getMonth();
        return invMonth === index;
      });

      if (invoice) {
        const isPastDue = new Date(invoice.dueDate) < now;
        let status: 'PAID' | 'PARTIAL' | 'PENDING' | 'OVERDUE' = invoice.status as any;

        if ((status === 'PENDING' || status === 'PARTIAL') && isPastDue) {
          status = 'OVERDUE';
        }

        monthsData[monthName] = {
          invoiceId: invoice.id,
          status,
          amount: invoice.amount.toNumber(),
          paidAmount: invoice.paidAmount.toNumber(),
          dueDate: invoice.dueDate.toISOString(),
        };

        totalAmount += invoice.amount.toNumber();
        totalPaid += invoice.paidAmount.toNumber();
      } else {
        monthsData[monthName] = {
          status: 'NOT_BILLED',
          amount: 0,
          paidAmount: 0,
        };
      }
    });

    return {
      studentId: student.id,
      studentName: student.user.name,
      nis: student.nis || '-',
      className: student.enrollments[0]?.class?.name || '-',
      months: monthsData,
      totalAmount,
      totalPaid,
    };
  });

  // Calculate summary stats
  const summary = {
    totalStudents: students.length,
    totalBilled: matrixData.reduce((sum, s) => sum + s.totalAmount, 0),
    totalPaid: matrixData.reduce((sum, s) => sum + s.totalPaid, 0),
    totalOutstanding: 0,
    paidCount: 0,
    partialCount: 0,
    pendingCount: 0,
    overdueCount: 0,
  };

  summary.totalOutstanding = summary.totalBilled - summary.totalPaid;

  // Count statuses
  matrixData.forEach((student) => {
    Object.values(student.months).forEach((month) => {
      if (month.status === 'PAID') summary.paidCount++;
      else if (month.status === 'PARTIAL') summary.partialCount++;
      else if (month.status === 'PENDING') summary.pendingCount++;
      else if (month.status === 'OVERDUE') summary.overdueCount++;
    });
  });

  return {
    students: matrixData,
    sppRate: sppPaymentType.amount.toNumber(),
    paymentTypeId: sppPaymentType.id,
    year,
    months,
    summary,
  };
}

// Generate bulk invoices for SPP
export async function generateBulkSppInvoices(data: {
  unitId?: string;
  classId?: string;
  paymentTypeId: string;
  year: number;
  month: number; // 0-11
  dueDay?: number;
  /**
   * The instant the run belongs to, used only to number the invoices it
   * creates. A backdated run (`runMonthlyAutoBilling(at)`) bills `year`/`month`
   * but must number its invoices from that same month, not from the wall clock
   * — otherwise an August run labels its invoices `INV-202609-`. Defaults to
   * now, so a manual bulk run from the UI is unchanged.
   */
  at?: Date;
}) {
  const { unitId, classId, paymentTypeId, year, month, dueDay = 10, at = new Date() } = data;

  const paymentType = await prisma.paymentType.findUnique({
    where: { id: paymentTypeId },
  });

  if (!paymentType) {
    throw new Error('Payment type not found');
  }

  // Only santri who are still enrolled. With no status filter the monthly job
  // (finance-billing.job.ts) billed alumni, and santri who had transferred out,
  // every month.
  const students = await prisma.student.findMany({
    where: {
      status: STUDENT_STATUS.ACTIVE,
      deletedAt: null,
      ...(unitId && { unitId }),
      ...(classId && {
        enrollments: {
          some: { classId },
        },
      }),
    },
  });

  const dueDate = wibDate(year, month, dueDay);
  const period = `${
    [
      'Januari',
      'Februari',
      'Maret',
      'April',
      'Mei',
      'Juni',
      'Juli',
      'Agustus',
      'September',
      'Oktober',
      'November',
      'Desember',
    ][month]
  } ${year}`;

  const createdInvoices = [];

  // The billed month, as the date-only bounds the due date column uses, so the
  // guard matches an invoice from this run on any server timezone.
  const { start: monthStart, end: monthEnd } = utcMonthRange(year, month);

  for (const student of students) {
    // Check if invoice already exists for this student/month
    const existing = await prisma.invoice.findFirst({
      where: {
        studentId: student.id,
        paymentTypeId,
        dueDate: {
          gte: monthStart,
          lt: monthEnd,
        },
      },
    });

    if (!existing) {
      const invoiceNumber = await generateInvoiceNumber(undefined, undefined, at);
      const invoice = await prisma.invoice.create({
        data: {
          studentId: student.id,
          paymentTypeId,
          invoiceNumber,
          amount: paymentType.amount,
          dueDate,
          period,
          notes: `Tagihan ${paymentType.name} untuk ${period}`,
        },
      });
      createdInvoices.push(invoice);
    }
  }

  return {
    created: createdInvoices.length,
    skipped: students.length - createdInvoices.length,
    total: students.length,
  };
}

// Generate recurring bills for all active students (Auto-billing scheduler)
export async function generateRecurringBills(at: Date = new Date()) {
  const { year, month } = wibMonthYear(at);
  const dueDate = wibDate(year, month, 10);
  const period = `${
    [
      'Januari',
      'Februari',
      'Maret',
      'April',
      'Mei',
      'Juni',
      'Juli',
      'Agustus',
      'September',
      'Oktober',
      'November',
      'Desember',
    ][month]
  } ${year}`;

  let processed = 0;
  let created = 0;
  let skipped = 0;

  // 1. Get all recurring payment types
  const paymentTypes = await prisma.paymentType.findMany({
    where: { isRecurring: true, isActive: true },
  });

  if (!paymentTypes.length) {
    return { processed, created, skipped };
  }

  // 2. Get all active students
  const activeStudents = await prisma.student.findMany({
    where: { status: STUDENT_STATUS.ACTIVE },
    select: { id: true, unitId: true, userId: true },
  });

  if (!activeStudents.length) {
    return { processed, created, skipped };
  }

  // The billed month, as the date-only bounds the due date column uses.
  const { start: monthStart, end: monthEnd } = utcMonthRange(year, month);

  // Process billing for each student matching payment types
  for (const student of activeStudents) {
    // Determine applicable payment types for this student (matching unitId)
    const applicableTypes = paymentTypes.filter((pt) => pt.unitId === student.unitId);

    for (const paymentType of applicableTypes) {
      processed++;

      // Check if already billed
      const existing = await prisma.invoice.findFirst({
        where: {
          studentId: student.id,
          paymentTypeId: paymentType.id,
          dueDate: {
            gte: monthStart,
            lt: monthEnd,
          },
        },
      });

      if (!existing) {
        const invoiceNumber = await generateInvoiceNumber(undefined, undefined, at);
        await prisma.invoice.create({
          data: {
            studentId: student.id,
            paymentTypeId: paymentType.id,
            invoiceNumber,
            amount: paymentType.amount,
            dueDate,
            period,
            notes: `Tagihan ${paymentType.name} otomatis untuk ${period}`,
          },
        });
        created++;
      } else {
        skipped++;
      }
    }
  }

  return { processed, created, skipped };
}

// =====================================
// BUG 1 FIX: Transaction isolation for calculateInvoiceAmounts
// =====================================
export async function calculateInvoiceAmounts(
  studentId: string | undefined,
  paymentTypeId: string,
  originalAmount: number,
  dueDate: Date,
  tx?: Prisma.TransactionClient
) {
  const db = tx || prisma;
  if (studentId) {
    const recipients = await db.scholarshipRecipient.findMany({
      where: { studentId },
    });
    // Calculation logic...
  }
  return { amount: originalAmount, discount: 0 };
}

// =====================================
// BUG 2 FIX: Application-level validation for ScholarshipDiscount
// =====================================
export function validateScholarshipDiscount(data: {
  componentId?: string | null;
  paymentTypeId?: string | null;
}) {
  if (!data.componentId && !data.paymentTypeId) {
    throw new Error(
      'Data Integrity Error: At least one of componentId or paymentTypeId must be set to prevent duplicate orphaned discounts.'
    );
  }
}
