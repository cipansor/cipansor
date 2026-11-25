import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import {
  ALUMNI_ROLE_CODES,
  JournalReferenceType,
  KOMITE_ROLE_CODES,
  PARENT_ROLE_CODES,
  STUDENT_ROLE_CODES,
} from '@cipansor/shared';
import { seesAllUnits } from '../../utils/resolve-unit-id';
import { todayWib, wibDayStart, wibDayEnd } from '../../utils/wib';

import { studentScope, type ScopeActor } from '../../utils/student-scope';
import { unitWritable, type WriteActor } from '../../utils/write-scope';
import { Errors } from '../../middleware/error';
import { laundryTransitionAllowed, type LaundryStatusCode } from '@cipansor/shared';
import { getAccountOrFallback, ACCOUNT_MAPPING_KEYS } from '../finance/accounting-config.service';
import { isPeriodOpen } from '../finance-enhancement/period.service';
import type {
  CreatePricingInput,
  UpdatePricingInput,
  CreateTransactionInput,
  UpdateStatusInput,
  ProcessPaymentInput,
  ListTransactionsQuery,
} from './laundry.schema';

// =============================================================================
// PRICING SERVICE
// =============================================================================

export const pricingService = {
  async getAll(unitId: string) {
    return prisma.laundryPricing.findMany({
      where: { unitId },
      orderBy: [{ isExpress: 'asc' }, { pricePerKg: 'asc' }],
    });
  },

  async getById(id: string, unitId: string) {
    return prisma.laundryPricing.findFirst({
      where: { id, unitId },
    });
  },

  async create(unitId: string, data: CreatePricingInput) {
    return prisma.laundryPricing.create({
      data: {
        unit: { connect: { id: unitId } },
        name: data.name,
        description: data.description,
        pricePerKg: new Prisma.Decimal(data.pricePerKg),
        minWeight: new Prisma.Decimal(data.minWeight),
        processDays: data.processDays,
        isExpress: data.isExpress,
        isActive: data.isActive,
      },
    });
  },

  async update(id: string, unitId: string, data: UpdatePricingInput) {
    const updateData: Prisma.LaundryPricingUpdateInput = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.pricePerKg !== undefined) updateData.pricePerKg = new Prisma.Decimal(data.pricePerKg);
    if (data.minWeight !== undefined) updateData.minWeight = new Prisma.Decimal(data.minWeight);
    if (data.processDays !== undefined) updateData.processDays = data.processDays;
    if (data.isExpress !== undefined) updateData.isExpress = data.isExpress;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    return prisma.laundryPricing.update({
      where: { id },
      data: updateData,
    });
  },

  async delete(id: string, unitId: string) {
    // Check if pricing has transactions
    const transactionCount = await prisma.laundryTransaction.count({
      where: { pricingId: id },
    });

    if (transactionCount > 0) {
      // Soft delete - just mark as inactive
      return prisma.laundryPricing.update({
        where: { id },
        data: { isActive: false },
      });
    }

    return prisma.laundryPricing.delete({
      where: { id },
    });
  },
};

// =============================================================================
// TRANSACTION SERVICE
// =============================================================================

const generateTransactionNo = async (
  tx: Prisma.TransactionClient,
  unitId: string
): Promise<string> => {
  // The date on the transaction number is a WIB calendar day, not the UTC one:
  // the container runs UTC, so a 00:00–07:00 WIB transaction would otherwise be
  // numbered with yesterday — and merged into yesterday's sequence.
  const dateStr = todayWib().replace(/-/g, '');
  const prefix = `LDR-${dateStr}`;

  // Two officers saving at once would otherwise read the same last number and
  // both try to insert it. The lock is released when this transaction commits.
  const lockKey = `${unitId}:${dateStr}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint) IS NULL AS locked`;

  const lastTransaction = await tx.laundryTransaction.findFirst({
    where: { transactionNo: { startsWith: prefix } },
    orderBy: { transactionNo: 'desc' },
    select: { transactionNo: true },
  });

  let sequence = 1;
  if (lastTransaction) {
    const lastSeq = parseInt(lastTransaction.transactionNo.split('-')[2]);
    sequence = lastSeq + 1;
  }

  return `${prefix}-${sequence.toString().padStart(4, '0')}`;
};

const calculateEstimatedDate = (processDays: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() + processDays);
  return date;
};

/** The database stores money in two decimals; round once and reuse that value. */
const roundMoney = (value: Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(value.toFixed(2));

/**
 * The laundry transactions a reader may see. Laundry is an asrama service: one
 * unit's business staff record it, for santri of every school.
 *
 * - the pesantren's staff and the cross-unit services (`seesAllUnits`): every
 *   unit's — they stay where the asrama is, whichever unit they belong to;
 * - a santri, a wali, alumni and komite: only the santri they may see
 *   (`studentScope` — their own, their children's, none);
 * - anyone else, the staff who run it included: their own unit's.
 */
export function laundryReadScope(actor: ScopeActor): Prisma.LaundryTransactionWhereInput {
  if (seesAllUnits(actor)) return {};
  const code = actor.roleCode ?? '';
  if (
    [
      ...STUDENT_ROLE_CODES,
      ...PARENT_ROLE_CODES,
      ...ALUMNI_ROLE_CODES,
      ...KOMITE_ROLE_CODES,
    ].includes(code)
  ) {
    return { student: studentScope(actor) };
  }
  return actor.unitId ? { unitId: actor.unitId } : { id: { in: [] } };
}

export const transactionService = {
  /**
   * The list (R22.4, R22.11): newest first, a full `pagination`, and a
   * `search` that matches the santri's name, NIS or the transaction number,
   * case-insensitively — all inside `laundryReadScope`.
   *
   * The santri is read with `select` so the query fetches only the columns the
   * Portal shows; including the relation sends every column, NIK and No. KK
   * among them (R24.10).
   */
  async getAll(scope: Prisma.LaundryTransactionWhereInput, query: ListTransactionsQuery) {
    const { page, limit } = query;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    const where: Prisma.LaundryTransactionWhereInput = {
      ...scope,
      ...(query.studentId && { studentId: query.studentId }),
      ...(query.status && { status: query.status }),
      ...(query.paymentStatus && { paymentStatus: query.paymentStatus }),
      ...(query.startDate &&
        query.endDate && {
          createdAt: {
            gte: new Date(query.startDate),
            lte: new Date(query.endDate + 'T23:59:59.999Z'),
          },
        }),
      ...(search && {
        OR: [
          { transactionNo: { contains: search, mode: 'insensitive' as const } },
          { student: { nis: { contains: search, mode: 'insensitive' as const } } },
          {
            student: {
              user: { name: { contains: search, mode: 'insensitive' as const } },
            },
          },
        ],
      }),
    };

    const [transactions, total] = await Promise.all([
      prisma.laundryTransaction.findMany({
        where,
        include: {
          student: {
            select: { id: true, nis: true, user: { select: { name: true } } },
          },
          pricing: { select: { id: true, name: true, isExpress: true } },
          items: true,
          receivedBy: { select: { id: true, name: true } },
          deliveredBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.laundryTransaction.count({ where }),
    ]);

    return {
      data: transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async getById(id: string, scope: Prisma.LaundryTransactionWhereInput) {
    return prisma.laundryTransaction.findFirst({
      where: { ...scope, id },
      include: {
        student: {
          select: {
            id: true,
            nis: true,
            user: { select: { name: true } },
            wallet: { select: { balance: true } },
          },
        },
        pricing: true,
        items: true,
        receivedBy: { select: { id: true, name: true } },
        deliveredBy: { select: { id: true, name: true } },
        statusLogs: {
          include: { createdBy: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  },

  async getByStudent(studentId: string, scope: Prisma.LaundryTransactionWhereInput) {
    return prisma.laundryTransaction.findMany({
      where: {
        ...scope,
        studentId,
        status: { notIn: ['DELIVERED', 'CANCELLED'] },
      },
      include: {
        pricing: { select: { id: true, name: true, isExpress: true } },
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getReadyForPickup(scope: Prisma.LaundryTransactionWhereInput) {
    return prisma.laundryTransaction.findMany({
      where: {
        ...scope,
        status: 'READY',
      },
      include: {
        student: {
          select: { id: true, nis: true, user: { select: { name: true } } },
        },
        pricing: { select: { name: true } },
      },
      orderBy: { readyAt: 'asc' },
    });
  },

  async create(unitId: string, userId: string, data: CreateTransactionInput) {
    return prisma.$transaction(async (tx) => {
      // Get pricing
      const pricing = await tx.laundryPricing.findFirst({
        where: { id: data.pricingId, unitId, isActive: true },
      });

      if (!pricing) {
        throw new Error('Jenis layanan tidak ditemukan');
      }

      // Calculate totals
      const weight = new Prisma.Decimal(data.weight);
      const minWeight = pricing.minWeight;
      const effectiveWeight = weight.lessThan(minWeight) ? minWeight : weight;
      const subtotal = roundMoney(effectiveWeight.mul(pricing.pricePerKg));
      const discount = roundMoney(new Prisma.Decimal(data.discount || 0));
      const total = roundMoney(subtotal.sub(discount));

      // Check wallet if payment method is WALLET
      let walletId: string | undefined;
      let paymentStatus = 'UNPAID';

      if (data.paymentMethod === 'WALLET') {
        const wallet = await tx.santriWallet.findUnique({
          where: { studentId: data.studentId },
        });

        if (!wallet) {
          throw new Error('Wallet santri tidak ditemukan');
        }

        if (wallet.balance.lessThan(total)) {
          throw new Error(
            `Saldo wallet tidak mencukupi (saldo: Rp ${wallet.balance.toNumber().toLocaleString('id-ID')})`
          );
        }

        // Deduct wallet balance
        const newBalance = wallet.balance.sub(total);
        await tx.santriWallet.update({
          where: { id: wallet.id },
          data: { balance: newBalance },
        });

        walletId = wallet.id;
        paymentStatus = 'PAID';
      } else if (data.paymentMethod === 'CASH') {
        paymentStatus = 'PAID';
      }

      const paidAt = paymentStatus === 'PAID' ? new Date() : null;

      // Generate transaction number
      const transactionNo = await generateTransactionNo(tx, unitId);
      const estimatedAt = calculateEstimatedDate(pricing.processDays);

      // Create transaction
      const transaction = await tx.laundryTransaction.create({
        data: {
          unitRel: { connect: { id: unitId } },
          transactionNo,
          student: { connect: { id: data.studentId } },
          walletId,
          pricing: { connect: { id: pricing.id } },
          weight,
          pricePerKg: pricing.pricePerKg,
          subtotal,
          discount,
          total,
          paymentMethod: data.paymentMethod,
          paymentStatus,
          paidAt,
          status: 'RECEIVED',
          estimatedAt,
          notes: data.notes,
          receivedBy: { connect: { id: userId } },
          items: data.items
            ? {
                create: data.items.map((item) => ({
                  itemType: item.itemType,
                  quantity: item.quantity,
                  notes: item.notes,
                })),
              }
            : undefined,
          statusLogs: {
            create: {
              fromStatus: null,
              toStatus: 'RECEIVED',
              notes: 'Laundry diterima',
              createdBy: { connect: { id: userId } },
            },
          },
        },
        include: {
          student: {
            select: { id: true, nis: true, user: { select: { name: true } } },
          },
          pricing: { select: { id: true, name: true } },
          items: true,
        },
      });

      // Create wallet transaction if wallet payment
      if (walletId) {
        const wallet = await tx.santriWallet.findUnique({
          where: { id: walletId },
        });

        await tx.walletTransaction.create({
          data: {
            wallet: { connect: { id: walletId } },
            type: 'PURCHASE',
            amount: total,
            balanceBefore: wallet!.balance.add(total),
            balanceAfter: wallet!.balance,
            reference: transaction.id,
            referenceType: 'LAUNDRY',
            description: `Laundry #${transactionNo}`,
            createdBy: { connect: { id: userId } },
          },
        });
      }

      // ─── ACCOUNTING INTEGRATION (AUTOMATED JOURNALS) ───
      if (paymentStatus === 'PAID') {
        const journalDate = paidAt ?? new Date();
        const periodOpen = await isPeriodOpen(unitId, journalDate, tx);

        if (periodOpen) {
          const accountPrefix = data.businessUnitId ? `BU_${data.businessUnitId}_` : '';

          const salesAccount = await getAccountOrFallback(
            unitId,
            `${accountPrefix}${ACCOUNT_MAPPING_KEYS.LAUNDRY_REVENUE}`,
            '4102',
            'Pendapatan Laundry',
            tx
          );

          const cashAccount = await getAccountOrFallback(
            unitId,
            ACCOUNT_MAPPING_KEYS.CASH,
            '1101',
            'Kas',
            tx
          );

          const walletLiabilityAccount = await getAccountOrFallback(
            unitId,
            ACCOUNT_MAPPING_KEYS.WALLET_LIABILITY,
            '2101',
            'Utang Wallet Santri',
            tx
          );

          const paymentAccount =
            data.paymentMethod === 'WALLET' ? walletLiabilityAccount : cashAccount;

          if (salesAccount && paymentAccount) {
            await tx.journalEntry.create({
              data: {
                unitId,
                accountId: paymentAccount.id,
                date: journalDate,
                description: `Pendapatan Laundry #${transactionNo}`,
                debit: total,
                credit: 0,
                reference: transaction.id,
                referenceType: JournalReferenceType.LAUNDRY as any,
                createdById: userId,
              },
            });

            await tx.journalEntry.create({
              data: {
                unitId,
                accountId: salesAccount.id,
                date: journalDate,
                description: `Pendapatan Laundry #${transactionNo}`,
                debit: 0,
                credit: total,
                reference: transaction.id,
                referenceType: JournalReferenceType.LAUNDRY as any,
                createdById: userId,
              },
            });
          }
        }
      }

      return transaction;
    });
  },

  /**
   * Move a transaction along the status flow. The caller must reach it — it
   * exists, is inside `laundryReadScope`, and (unless Super_Admin) belongs to
   * the token's unit; anything else is answered 404, the same body as a
   * transaction that does not exist (R27.9). A move outside the flow is 409,
   * naming the current and the requested status (R27.10). Super_Admin reaches
   * any unit and needs no unit on the token (R27.11).
   */
  async updateStatus(id: string, actor: WriteActor & ScopeActor, data: UpdateStatusInput) {
    const userId = actor.sub;

    return prisma.$transaction(async (tx) => {
      // Check reach before taking the lock: an out-of-unit request must not
      // hold up a legitimate status change on that row.
      const reachable = await tx.laundryTransaction.findFirst({
        where: { id, ...laundryReadScope(actor) },
        select: { unitId: true },
      });

      if (!reachable || !unitWritable(actor, reachable.unitId)) {
        throw Errors.notFound('Transaksi');
      }

      // Serialise with processPayment. Without the row lock both requests read
      // the pre-payment row: the cancellation skips the refund and the payment
      // still debits the wallet.
      await tx.$queryRaw`SELECT id FROM laundry_transactions WHERE id = ${id} FOR UPDATE`;

      const transaction = await tx.laundryTransaction.findFirst({
        where: { id, ...laundryReadScope(actor) },
      });

      if (!transaction || !unitWritable(actor, transaction.unitId)) {
        throw Errors.notFound('Transaksi');
      }

      const unitId = transaction.unitId;
      const current = transaction.status as LaundryStatusCode;
      if (!laundryTransitionAllowed(current, data.status)) {
        throw Errors.conflict(`Status tidak dapat diubah dari ${current} ke ${data.status}`);
      }

      const updateData: Prisma.LaundryTransactionUpdateInput = {
        status: data.status,
      };

      // Set timestamps based on status
      if (data.status === 'READY') {
        updateData.readyAt = new Date();
      } else if (data.status === 'DELIVERED') {
        updateData.deliveredAt = new Date();
        updateData.deliveredBy = { connect: { id: userId } };
      }

      // Handle cancellation refund
      if (
        data.status === 'CANCELLED' &&
        transaction.paymentStatus === 'PAID' &&
        transaction.walletId
      ) {
        const wallet = await tx.santriWallet.findUnique({
          where: { id: transaction.walletId },
        });

        if (wallet) {
          const refund = roundMoney(transaction.total);
          const newBalance = wallet.balance.add(refund);
          await tx.santriWallet.update({
            where: { id: wallet.id },
            data: { balance: newBalance },
          });

          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { id: wallet.id } },
              type: 'REFUND',
              amount: refund,
              balanceBefore: wallet.balance,
              balanceAfter: newBalance,
              reference: transaction.id,
              referenceType: 'LAUNDRY',
              description: `Refund laundry #${transaction.transactionNo} (dibatalkan)`,
              createdBy: { connect: { id: userId } },
            },
          });

          updateData.paymentStatus = 'REFUNDED';
        }
      }

      // ─── REVERSING JOURNAL ENTRIES FOR CANCELLATION ───
      if (data.status === 'CANCELLED' && transaction.paymentStatus === 'PAID') {
        const reversalDate = new Date();
        const periodOpen = await isPeriodOpen(unitId, reversalDate, tx);

        if (periodOpen) {
          const originalEntries = await tx.journalEntry.findMany({
            where: {
              reference: transaction.id,
              referenceType: JournalReferenceType.LAUNDRY as any,
            },
          });

          for (const entry of originalEntries) {
            await tx.journalEntry.create({
              data: {
                unitId,
                accountId: entry.accountId,
                date: reversalDate,
                description: `Pembatalan ${entry.description || ''} #${transaction.transactionNo}`,
                debit: entry.credit,
                credit: entry.debit,
                reference: `CANCEL:${transaction.id}`,
                referenceType: JournalReferenceType.LAUNDRY as any,
                createdById: userId,
              },
            });
          }
        }
      }

      const updated = await tx.laundryTransaction.update({
        where: { id },
        data: updateData,
        include: {
          student: {
            select: { id: true, nis: true, user: { select: { name: true } } },
          },
          pricing: { select: { id: true, name: true } },
        },
      });

      // Create status log
      await tx.laundryStatusLog.create({
        data: {
          transaction: { connect: { id } },
          fromStatus: transaction.status,
          toStatus: data.status,
          notes: data.notes,
          createdBy: { connect: { id: userId } },
        },
      });

      return updated;
    });
  },

  async processPayment(id: string, actor: WriteActor & ScopeActor, data: ProcessPaymentInput) {
    const userId = actor.sub;

    return prisma.$transaction(async (tx) => {
      // Check reach before taking the lock, as updateStatus does: a request
      // from another unit must not delay this row's own payment or cancellation.
      const reachable = await tx.laundryTransaction.findFirst({
        where: { id, ...laundryReadScope(actor) },
        select: { unitId: true },
      });

      if (!reachable || !unitWritable(actor, reachable.unitId)) {
        throw Errors.notFound('Transaksi');
      }

      // Same lock as updateStatus: a cancellation waits for this payment and
      // then sees PAID, so it refunds instead of skipping the refund.
      await tx.$queryRaw`SELECT id FROM laundry_transactions WHERE id = ${id} FOR UPDATE`;

      const transaction = await tx.laundryTransaction.findFirst({
        where: { id, ...laundryReadScope(actor) },
      });

      if (!transaction || !unitWritable(actor, transaction.unitId)) {
        throw Errors.notFound('Transaksi');
      }

      if (transaction.paymentStatus === 'PAID') {
        throw Errors.conflict('Transaksi sudah dibayar');
      }

      if (transaction.paymentStatus === 'REFUNDED') {
        throw Errors.conflict('Pembayaran transaksi sudah dikembalikan');
      }

      if (transaction.status === 'CANCELLED') {
        throw Errors.conflict('Transaksi sudah dibatalkan');
      }

      const unitId = transaction.unitId;
      const paidAt = new Date();
      const amount = roundMoney(transaction.total);
      let walletId: string | undefined;

      if (data.paymentMethod === 'WALLET') {
        const wallet = await tx.santriWallet.findUnique({
          where: { studentId: transaction.studentId },
        });

        if (!wallet) {
          throw Errors.badRequest('Wallet santri tidak ditemukan');
        }

        if (wallet.balance.lessThan(amount)) {
          throw Errors.badRequest(
            `Saldo wallet tidak mencukupi (saldo: Rp ${wallet.balance.toNumber().toLocaleString('id-ID')})`
          );
        }

        // Deduct wallet balance
        const newBalance = wallet.balance.sub(amount);
        await tx.santriWallet.update({
          where: { id: wallet.id },
          data: { balance: newBalance },
        });

        walletId = wallet.id;

        // Create wallet transaction
        await tx.walletTransaction.create({
          data: {
            wallet: { connect: { id: wallet.id } },
            type: 'PURCHASE',
            amount,
            balanceBefore: wallet.balance,
            balanceAfter: newBalance,
            reference: transaction.id,
            referenceType: 'LAUNDRY',
            description: `Laundry #${transaction.transactionNo}`,
            createdBy: { connect: { id: userId } },
          },
        });
      }

      const updated = await tx.laundryTransaction.update({
        where: { id },
        data: {
          paymentMethod: data.paymentMethod,
          paymentStatus: 'PAID',
          paidAt,
          walletId,
        },
        include: {
          student: {
            select: { id: true, nis: true, user: { select: { name: true } } },
          },
          pricing: { select: { id: true, name: true } },
        },
      });

      // ─── ACCOUNTING INTEGRATION (AUTOMATED JOURNALS) FOR LATE PAYMENT ───
      const journalDate = paidAt;
      const periodOpen = await isPeriodOpen(unitId, journalDate, tx);

      if (periodOpen) {
        const accountPrefix = updated.businessUnitId ? `BU_${updated.businessUnitId}_` : '';

        const salesAccount = await getAccountOrFallback(
          unitId,
          `${accountPrefix}${ACCOUNT_MAPPING_KEYS.LAUNDRY_REVENUE}`,
          '4102',
          'Pendapatan Laundry',
          tx
        );

        const cashAccount = await getAccountOrFallback(
          unitId,
          ACCOUNT_MAPPING_KEYS.CASH,
          '1101',
          'Kas',
          tx
        );

        const walletLiabilityAccount = await getAccountOrFallback(
          unitId,
          ACCOUNT_MAPPING_KEYS.WALLET_LIABILITY,
          '2101',
          'Utang Wallet Santri',
          tx
        );

        const paymentAccount =
          data.paymentMethod === 'WALLET' ? walletLiabilityAccount : cashAccount;

        if (salesAccount && paymentAccount) {
          await tx.journalEntry.create({
            data: {
              unitId,
              accountId: paymentAccount.id,
              date: journalDate,
              description: `Pendapatan Laundry #${updated.transactionNo} (Pelunasan)`,
              debit: amount,
              credit: 0,
              reference: updated.id,
              referenceType: JournalReferenceType.LAUNDRY as any,
              createdById: userId,
            },
          });

          await tx.journalEntry.create({
            data: {
              unitId,
              accountId: salesAccount.id,
              date: journalDate,
              description: `Pendapatan Laundry #${updated.transactionNo} (Pelunasan)`,
              debit: 0,
              credit: amount,
              reference: updated.id,
              referenceType: JournalReferenceType.LAUNDRY as any,
              createdById: userId,
            },
          });
        }
      }

      return updated;
    });
  },

  async getStats(scope: Prisma.LaundryTransactionWhereInput, startDate?: string, endDate?: string) {
    // Both ends are WIB calendar days. Orders are counted on `createdAt`;
    // money is counted on `paidAt`, so a bill from Monday paid on Tuesday
    // belongs to Tuesday's income and to Monday's transaction count.
    const day = startDate && endDate ? { startDate, endDate } : null;
    const createdFilter = {
      createdAt: {
        gte: wibDayStart(day?.startDate ?? todayWib()),
        lte: wibDayEnd(day?.endDate ?? todayWib()),
      },
    };
    const paidFilter = {
      paidAt: {
        gte: wibDayStart(day?.startDate ?? todayWib()),
        lte: wibDayEnd(day?.endDate ?? todayWib()),
      },
    };

    const [periodStats, paidStats, statusBreakdown, pendingPayments, pendingPickup] =
      await Promise.all([
        prisma.laundryTransaction.aggregate({
          where: { ...scope, status: { not: 'CANCELLED' }, ...createdFilter },
          _sum: { weight: true },
          _count: { id: true },
        }),
        // Revenue is money received, not money billed: a Bayar Nanti order
        // counts towards the period's transactions and weight, but only a PAID
        // one towards the income card.
        prisma.laundryTransaction.aggregate({
          where: {
            ...scope,
            status: { not: 'CANCELLED' },
            paymentStatus: 'PAID',
            ...paidFilter,
          },
          _sum: { total: true },
        }),
        prisma.laundryTransaction.groupBy({
          by: ['status'],
          where: { ...scope, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
          _count: { id: true },
        }),
        prisma.laundryTransaction.count({
          where: { ...scope, paymentStatus: 'UNPAID', status: { not: 'CANCELLED' } },
        }),
        prisma.laundryTransaction.count({
          where: { ...scope, status: 'READY' },
        }),
      ]);

    return {
      period: {
        startDate: startDate || todayWib(),
        endDate: endDate || todayWib(),
      },
      summary: {
        totalRevenue: paidStats._sum.total?.toNumber() || 0,
        totalWeight: periodStats._sum.weight?.toNumber() || 0,
        totalTransactions: periodStats._count.id,
        pendingPayments,
        pendingPickup,
      },
      statusBreakdown: statusBreakdown.map((s) => ({
        status: s.status,
        count: s._count.id,
      })),
    };
  },
};
