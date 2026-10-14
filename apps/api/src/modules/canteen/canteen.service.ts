import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { JournalReferenceType } from '@cipansor/shared';
import { todayWib } from '../../utils/wib';
import { getAccountOrFallback, ACCOUNT_MAPPING_KEYS } from '../finance/accounting-config.service';
import { isPeriodOpen } from '../finance-enhancement/period.service';
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
  CreateItemInput,
  UpdateItemInput,
  ListItemsQuery,
  CreateTransactionInput,
  UpdateTransactionStatusInput,
  ListTransactionsQuery,
  CreateStockMovementInput,
  ListStockMovementsQuery,
} from './canteen.schema';

// =============================================================================
// CATEGORY SERVICE
// =============================================================================

export const categoryService = {
  // unitId is optional: when omitted (SUPER_ADMIN global view) returns categories
  // across all units. The caller is responsible for authorization.
  async getAll(unitId: string | undefined, businessUnitId?: string) {
    return prisma.canteenCategory.findMany({
      where: {
        ...(unitId && { unitId }),
        ...(businessUnitId && { businessUnitId }),
      },
      include: {
        _count: { select: { items: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  },

  async getById(id: string, unitId: string) {
    return prisma.canteenCategory.findFirst({
      where: { id, unitId },
      include: {
        items: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
        },
        _count: { select: { items: true } },
      },
    });
  },

  async create(unitId: string, data: CreateCategoryInput) {
    return prisma.canteenCategory.create({
      data: {
        unit: { connect: { id: unitId } },
        name: data.name,
        description: data.description,
        sortOrder: data.sortOrder,
        isActive: data.isActive,
        ...(data.businessUnitId && { businessUnit: { connect: { id: data.businessUnitId } } }),
      },
    });
  },

  async update(id: string, unitId: string, data: UpdateCategoryInput) {
    // Verify ownership before updating
    const existing = await prisma.canteenCategory.findFirst({ where: { id, unitId } });
    if (!existing) {
      throw new Error('Kategori tidak ditemukan');
    }

    const { businessUnitId, ...rest } = data;
    return prisma.canteenCategory.update({
      where: { id },
      data: {
        ...rest,
        ...(businessUnitId !== undefined && {
          businessUnit: businessUnitId ? { connect: { id: businessUnitId } } : { disconnect: true },
        }),
      },
    });
  },

  async delete(id: string, unitId: string) {
    // Verify ownership before deleting
    const existing = await prisma.canteenCategory.findFirst({ where: { id, unitId } });
    if (!existing) {
      throw new Error('Kategori tidak ditemukan');
    }

    // Check if category has items
    const itemCount = await prisma.canteenItem.count({
      where: { categoryId: id, unitId },
    });

    if (itemCount > 0) {
      throw new Error(`Kategori tidak dapat dihapus karena memiliki ${itemCount} item`);
    }

    return prisma.canteenCategory.delete({
      where: { id },
    });
  },

  /**
   * Get business efficiency metrics for canteen items.
   * Best Practice: Analyzing operational performance beyond simple revenue.
   */
  async getBusinessEfficiency(unitId: string | undefined, businessUnitId?: string) {
    const where: Prisma.CanteenItemWhereInput = {
      ...(unitId && { category: { businessUnit: { unitId } } }),
      ...(businessUnitId && { category: { businessUnitId } }),
    };

    const items = await prisma.canteenItem.findMany({
      where,
      select: {
        id: true,
        name: true,
        stock: true,
        price: true,
        _count: { select: { transactionItems: true } },
      },
    });

    const itemEfficiency = items.map((item) => {
      const turnover = item._count.transactionItems;
      // Efficiency Score: (Turnover / Stock) * 100 - simple proxy for stock velocity
      const score = item.stock > 0 ? (turnover / item.stock) * 100 : turnover > 0 ? 100 : 0;
      return {
        id: item.id,
        name: item.name,
        stock: item.stock,
        turnover,
        efficiencyScore: Math.round(score * 10) / 10,
      };
    });

    const avgEfficiency =
      itemEfficiency.length > 0
        ? itemEfficiency.reduce((sum, i) => sum + i.efficiencyScore, 0) / itemEfficiency.length
        : 0;

    return {
      unitId,
      businessUnitId,
      overallEfficiency: Math.round(avgEfficiency * 10) / 10,
      topItems: itemEfficiency.sort((a, b) => b.efficiencyScore - a.efficiencyScore).slice(0, 5),
      lowItems: itemEfficiency.sort((a, b) => a.efficiencyScore - b.efficiencyScore).slice(0, 5),
    };
  },
};

// =============================================================================
// ITEM SERVICE
// =============================================================================

export const itemService = {
  // unitId is optional: when omitted (SUPER_ADMIN global view) returns items
  // across all units. The caller is responsible for authorization.
  async getAll(unitId: string | undefined, query: ListItemsQuery) {
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '20');
    const skip = (page - 1) * limit;

    const where: Prisma.CanteenItemWhereInput = {
      ...(unitId && { unitId }),
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.businessUnitId && { businessUnitId: query.businessUnitId }),
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { code: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
      ...(query.isAvailable && { isAvailable: query.isAvailable === 'true' }),
      ...(query.isActive && { isActive: query.isActive === 'true' }),
      ...(query.lowStock === 'true' && {
        stock: { lte: prisma.canteenItem.fields.minStock },
      }),
    };

    const [items, total] = await Promise.all([
      prisma.canteenItem.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
        },
        orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.canteenItem.count({ where }),
    ]);

    return {
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async getById(id: string, unitId: string) {
    return prisma.canteenItem.findFirst({
      where: { id, unitId },
      include: {
        category: true,
        _count: {
          select: { transactionItems: true, stockMovements: true },
        },
      },
    });
  },

  async getLowStockItems(unitId: string | undefined) {
    // unitId is optional: when omitted (SUPER_ADMIN global view) returns low-stock
    // items across all units. Caller is responsible for authorization.
    if (unitId) {
      return prisma.$queryRaw<
        Array<{
          id: string;
          name: string;
          code: string | null;
          stock: number;
          minStock: number;
          categoryName: string;
        }>
      >`
        SELECT
          i.id, i.name, i.code, i.stock, i.min_stock as "minStock",
          c.name as "categoryName"
        FROM canteen_items i
        JOIN canteen_categories c ON i.category_id = c.id
        WHERE i.unit_id = ${unitId}
          AND i.is_active = true
          AND i.stock <= i.min_stock
        ORDER BY i.stock ASC
      `;
    }

    return prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        code: string | null;
        stock: number;
        minStock: number;
        categoryName: string;
      }>
    >`
      SELECT
        i.id, i.name, i.code, i.stock, i.min_stock as "minStock",
        c.name as "categoryName"
      FROM canteen_items i
      JOIN canteen_categories c ON i.category_id = c.id
      WHERE i.is_active = true
        AND i.stock <= i.min_stock
      ORDER BY i.stock ASC
    `;
  },

  async create(unitId: string, data: CreateItemInput) {
    return prisma.canteenItem.create({
      data: {
        unitRel: { connect: { id: unitId } },
        category: { connect: { id: data.categoryId } },
        ...(data.businessUnitId && { businessUnit: { connect: { id: data.businessUnitId } } }),
        code: data.code,
        name: data.name,
        description: data.description,
        price: new Prisma.Decimal(data.price),
        costPrice: data.costPrice ? new Prisma.Decimal(data.costPrice) : null,
        stock: data.stock,
        minStock: data.minStock,
        unit: data.unit,
        imageUrl: data.imageUrl,
        isAvailable: data.isAvailable,
        isActive: data.isActive,
      },
      include: {
        category: true,
      },
    });
  },

  async update(id: string, unitId: string, data: UpdateItemInput) {
    // Verify ownership before updating
    const existing = await prisma.canteenItem.findFirst({ where: { id, unitId } });
    if (!existing) {
      throw new Error('Item tidak ditemukan');
    }

    const updateData: Prisma.CanteenItemUpdateInput = {};

    if (data.categoryId !== undefined) updateData.category = { connect: { id: data.categoryId } };
    if (data.businessUnitId !== undefined) {
      updateData.businessUnit = data.businessUnitId
        ? { connect: { id: data.businessUnitId } }
        : { disconnect: true };
    }
    if (data.code !== undefined) updateData.code = data.code;
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.price !== undefined) updateData.price = new Prisma.Decimal(data.price);
    if (data.costPrice !== undefined)
      updateData.costPrice = data.costPrice ? new Prisma.Decimal(data.costPrice) : null;
    if (data.stock !== undefined) updateData.stock = data.stock;
    if (data.minStock !== undefined) updateData.minStock = data.minStock;
    if (data.unit !== undefined) updateData.unit = data.unit;
    if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
    if (data.isAvailable !== undefined) updateData.isAvailable = data.isAvailable;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    return prisma.canteenItem.update({
      where: { id },
      data: updateData,
      include: {
        category: true,
      },
    });
  },

  async delete(id: string, unitId: string) {
    // Verify ownership before deleting
    const existing = await prisma.canteenItem.findFirst({ where: { id, unitId } });
    if (!existing) {
      throw new Error('Item tidak ditemukan');
    }

    // Check if item has transactions
    const transactionCount = await prisma.canteenTransactionItem.count({
      where: { itemId: id },
    });

    if (transactionCount > 0) {
      // Soft delete - just mark as inactive
      return prisma.canteenItem.update({
        where: { id },
        data: { isActive: false, isAvailable: false },
      });
    }

    return prisma.canteenItem.delete({
      where: { id },
    });
  },
};

// =============================================================================
// TRANSACTION SERVICE
// =============================================================================

// NOTE: `tx` is required (no default). The advisory lock below (`pg_advisory_xact_lock`)
// is only held for the duration of the surrounding transaction, so calling this
// function outside a `prisma.$transaction` would release the lock immediately
// after the SELECT returns, defeating the serialization guarantee and allowing
// duplicate transaction numbers under concurrency.
//
// NOTE: No `unitId` parameter — transaction numbers use the format
// `CNT-YYYYMMDD-XXXX` which does NOT embed a unit, and the sequence query
// below is global. The advisory lock is therefore keyed to the date only.
// If future requirements introduce per-unit transaction numbering, add a
// `unitId` parameter AND include it in both the lock key and the WHERE
// clause of the `findFirst` query — they must stay in sync.
const generateTransactionNo = async (tx: Prisma.TransactionClient): Promise<string> => {
  // The date on the transaction number — and the advisory lock key below — is a
  // WIB calendar day, not the UTC one: the container runs UTC, so a 00:00–07:00
  // WIB sale would otherwise be numbered with yesterday and merged into
  // yesterday's sequence (and lock).
  const dateStr = todayWib().replace(/-/g, '');
  const prefix = `CNT-${dateStr}`;

  // Acquire a transaction-scoped advisory lock keyed to the date to serialize
  // concurrent transaction-number generation.  The lock scope MUST match the
  // query scope below: the `findFirst` with `transactionNo: { startsWith: prefix }`
  // searches globally across all units (the CNT-YYYYMMDD-XXXX format does not
  // embed unitId), so a per-unit lock would let two transactions from
  // different units read the same "last" transactionNo and try to insert the
  // same sequence, causing a unique-constraint violation.  Keying the lock to
  // the date only matches that global scope.  The lock is released
  // automatically when the enclosing transaction commits or rolls back.
  //
  // We use the two-argument form `pg_advisory_xact_lock(classId, objId)` with a
  // module-specific namespace (classId) so the canteen lockspace is isolated
  // from other modules that may also use advisory locks. Without the
  // namespace, a `hashtext()` collision with an unrelated module's lock key
  // could cause spurious contention across modules.
  //
  //   classId = 1001         → "canteen txno" namespace (arbitrary module id)
  //   objId   = hashtext(dateStr) → serializes per-date within the namespace
  const CANTEEN_TXNO_LOCK_NAMESPACE = 1001;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${CANTEEN_TXNO_LOCK_NAMESPACE}::int, hashtext(${dateStr})::int)`;

  const lastTransaction = await tx.canteenTransaction.findFirst({
    where: { transactionNo: { startsWith: prefix } },
    orderBy: { transactionNo: 'desc' },
    select: { transactionNo: true },
  });

  let sequence = 1;
  if (lastTransaction) {
    // Extract the sequence number using the last `-` so we are robust to any
    // future format extensions that add additional dash-separated segments
    // (e.g. `CNT-YYYYMMDD-UNITCODE-XXXX`). A naive `split('-')[2]` would break
    // in that scenario and produce `NaN + 1 = NaN`, corrupting the sequence.
    const lastDash = lastTransaction.transactionNo.lastIndexOf('-');
    const seqStr = lastDash >= 0 ? lastTransaction.transactionNo.slice(lastDash + 1) : '';
    const lastSeq = parseInt(seqStr, 10);
    if (Number.isFinite(lastSeq)) {
      sequence = lastSeq + 1;
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[Canteen] Could not parse sequence from transactionNo '${lastTransaction.transactionNo}'. ` +
          `Falling back to sequence=1 for prefix '${prefix}'.`
      );
    }
  }

  return `${prefix}-${sequence.toString().padStart(4, '0')}`;
};

export const transactionService = {
  // unitId is optional: when omitted (SUPER_ADMIN global view) returns
  // transactions across all units. Caller is responsible for authorization.
  async getAll(unitId: string | undefined, query: ListTransactionsQuery) {
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '20');
    const skip = (page - 1) * limit;

    const where: Prisma.CanteenTransactionWhereInput = {
      ...(unitId && { unitId }),
      ...(query.studentId && { studentId: query.studentId }),
      ...(query.status && { status: query.status }),
      ...(query.paymentMethod && { paymentMethod: query.paymentMethod }),
      ...(query.startDate &&
        query.endDate && {
          createdAt: {
            gte: new Date(query.startDate),
            lte: new Date(query.endDate + 'T23:59:59.999Z'),
          },
        }),
    };

    const [transactions, total] = await Promise.all([
      prisma.canteenTransaction.findMany({
        where,
        include: {
          student: {
            select: { id: true, nis: true, user: { select: { name: true } } },
          },
          cashier: { select: { id: true, name: true } },
          items: {
            include: { item: { select: { id: true, name: true, code: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.canteenTransaction.count({ where }),
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

  async getById(id: string, unitId: string) {
    return prisma.canteenTransaction.findFirst({
      where: { id, unitId },
      include: {
        student: {
          select: {
            id: true,
            nis: true,
            user: { select: { name: true } },
            wallet: { select: { balance: true } },
          },
        },
        cashier: { select: { id: true, name: true } },
        items: {
          include: { item: { select: { id: true, name: true, code: true, imageUrl: true } } },
        },
      },
    });
  },

  async create(
    unitId: string,
    cashierId: string,
    data: CreateTransactionInput & { businessUnitId?: string }
  ) {
    return prisma.$transaction(async (tx) => {
      // Validate businessUnitId belongs to the same unit (multi-tenant isolation)
      if (data.businessUnitId) {
        const bu = await tx.businessUnit.findFirst({
          where: { id: data.businessUnitId, unitId },
        });
        if (!bu) {
          throw new Error('Unit usaha tidak ditemukan atau tidak termasuk dalam unit ini');
        }
      }

      // Get all items.
      //
      // Acquire SELECT ... FOR UPDATE row locks on the canteen_items rows
      // BEFORE reading them via Prisma, so that concurrent transactions
      // purchasing the same item serialize on the stock check/update.
      // Without this lock, two concurrent `create` calls could both read
      // stock=N, both pass the stock check for quantity=K, and both write
      // stock=N-K — losing one decrement under PostgreSQL READ COMMITTED.
      //
      // Locks are acquired in deterministic ID-sorted order to avoid
      // deadlocks between concurrent multi-item transactions.
      const itemIds = [...new Set(data.items.map((i) => i.itemId))].sort();

      if (itemIds.length > 0) {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM canteen_items
          WHERE id = ANY(${itemIds}::text[])
          ORDER BY id
          FOR UPDATE
        `;
      }

      const items = await tx.canteenItem.findMany({
        where: {
          id: { in: itemIds },
          unitId,
          isAvailable: true,
          isActive: true,
          ...(data.businessUnitId && { businessUnitId: data.businessUnitId }),
        },
      });

      if (items.length !== itemIds.length) {
        throw new Error(
          'Beberapa item tidak tersedia atau tidak termasuk dalam unit usaha yang dipilih'
        );
      }

      // Aggregate quantities per itemId so that multiple order lines referencing
      // the same item (e.g. same drink with different notes) are stock-checked
      // and decremented as a single combined quantity. Without this aggregation,
      // two lines with qty=3 and qty=4 for the same item would each pass the
      // stock check against the original stock value, and the stock-update loop
      // below would last-write-wins — deducting only one line's quantity and
      // under-reporting inventory consumption.
      const quantityByItem = new Map<string, number>();
      for (const orderItem of data.items) {
        quantityByItem.set(
          orderItem.itemId,
          (quantityByItem.get(orderItem.itemId) || 0) + orderItem.quantity
        );
      }

      // Check stock against aggregated quantities
      for (const [itemId, totalQty] of quantityByItem) {
        const item = items.find((i) => i.id === itemId);
        if (item && item.stock < totalQty) {
          throw new Error(
            `Stok ${item.name} tidak mencukupi (tersedia: ${item.stock}, diminta: ${totalQty})`
          );
        }
      }

      // Calculate totals
      let subtotal = new Prisma.Decimal(0);
      const transactionItems: Array<{
        itemId: string;
        itemName: string;
        quantity: number;
        unitPrice: Prisma.Decimal;
        subtotal: Prisma.Decimal;
        discount: Prisma.Decimal;
        total: Prisma.Decimal;
        notes?: string;
      }> = [];

      for (const orderItem of data.items) {
        const item = items.find((i) => i.id === orderItem.itemId)!;
        const itemSubtotal = item.price.mul(orderItem.quantity);
        subtotal = subtotal.add(itemSubtotal);

        transactionItems.push({
          itemId: item.id,
          itemName: item.name,
          quantity: orderItem.quantity,
          unitPrice: item.price,
          subtotal: itemSubtotal,
          discount: new Prisma.Decimal(0),
          total: itemSubtotal,
          notes: orderItem.notes,
        });
      }

      const discount = new Prisma.Decimal(data.discount || 0);
      // Guard against discount exceeding subtotal: a negative total would
      // silently credit the wallet on payment, produce negative-amount journal
      // entries, and create a negative refund on reversal. Zod validates
      // `discount >= 0` at the schema layer, but the upper bound depends on
      // the computed subtotal so it must be enforced here.
      if (discount.greaterThan(subtotal)) {
        throw new Error(
          `Diskon (Rp ${discount.toNumber().toLocaleString('id-ID')}) tidak boleh melebihi subtotal (Rp ${subtotal.toNumber().toLocaleString('id-ID')})`
        );
      }
      const total = subtotal.sub(discount);

      // Handle wallet payment
      let walletId: string | undefined;
      let walletBalance = new Prisma.Decimal(0);
      let newBalance = new Prisma.Decimal(0);
      if (data.paymentMethod === 'WALLET' && data.studentId) {
        // Acquire row lock on wallet to prevent lost updates from concurrent
        // transactions (e.g. two purchases or a purchase + refund for the same student).
        const lockedWallets = await tx.$queryRaw<Array<{ id: string; balance: string }>>`
          SELECT id, balance::text FROM santri_wallets
          WHERE student_id = ${data.studentId}
          FOR UPDATE
        `;

        if (lockedWallets.length === 0) {
          throw new Error('Wallet santri tidak ditemukan');
        }

        const walletRow = lockedWallets[0];
        walletBalance = new Prisma.Decimal(walletRow.balance);

        if (walletBalance.lessThan(total)) {
          throw new Error(
            `Saldo wallet tidak mencukupi (saldo: Rp ${walletBalance.toNumber().toLocaleString('id-ID')})`
          );
        }

        // Deduct wallet balance
        newBalance = walletBalance.sub(total);
        await tx.santriWallet.update({
          where: { id: walletRow.id },
          data: { balance: newBalance },
        });

        walletId = walletRow.id;
      }

      // Generate transaction number (inside tx to reduce race window)
      const transactionNo = await generateTransactionNo(tx);

      // Create transaction
      const transaction = await tx.canteenTransaction.create({
        data: {
          unitId,
          businessUnitId: data.businessUnitId,
          transactionNo,
          studentId: data.studentId,
          walletId,
          customerName: data.customerName,
          subtotal,
          discount,
          total,
          paymentMethod: data.paymentMethod,
          status: 'COMPLETED',
          notes: data.notes,
          cashierId,
          items: {
            create: transactionItems,
          },
        },
        include: {
          student: {
            select: { id: true, nis: true, user: { select: { name: true } } },
          },
          cashier: { select: { id: true, name: true } },
          items: true,
        },
      });

      // Create wallet transaction if wallet payment
      if (walletId && data.studentId) {
        await tx.walletTransaction.create({
          data: {
            walletId,
            type: 'PURCHASE',
            amount: total,
            balanceBefore: walletBalance,
            balanceAfter: newBalance,
            reference: transaction.id,
            referenceType: 'CANTEEN',
            description: `Pembelian kantin #${transactionNo}`,
            createdById: cashierId,
          },
        });
      }

      // ─── ACCOUNTING INTEGRATION (AUTOMATED JOURNALS) ───
      // We process accounting entries per unit for simple unit-level reports.
      // If businessUnitId is present, we try to use BU-specific account mappings first.
      // Use a single timestamp for all journal entries so that related entries
      // in the same double-entry set share the exact same date.
      const journalDate = new Date();

      // Refuse to post journal entries into a closed financial period, but
      // DO NOT block the sale itself — the business transaction (stock,
      // wallet, order record) must still complete so the POS remains
      // operational when an accountant has closed a prior period.
      // When the period is closed we skip journal creation and log a warning;
      // the accounting team can post adjusting entries manually if required.
      const periodOpen = await isPeriodOpen(unitId, journalDate, tx);
      if (!periodOpen) {
        // eslint-disable-next-line no-console
        console.warn(
          `[Canteen Accounting] Skipping journal entries for transaction ${transactionNo} — ` +
            `financial period for ${journalDate.toISOString()} is closed (unit ${unitId}).`
        );
      }

      // Short-circuit: when the period is closed there is no way we will post
      // any journal entries below, so skip the 5 account-mapping lookups to
      // avoid unnecessary DB round-trips on every sale (each getAccountOrFallback
      // hits the Settings table, and potentially AccountCode when unscoped
      // fallback is enabled).
      const accountPrefix = data.businessUnitId ? `BU_${data.businessUnitId}_` : '';

      const salesAccount = periodOpen
        ? await getAccountOrFallback(
            unitId,
            `${accountPrefix}${ACCOUNT_MAPPING_KEYS.SALES_REVENUE}`,
            '4101',
            'Pendapatan Kantin',
            tx
          )
        : null;

      const inventoryAccount = periodOpen
        ? await getAccountOrFallback(
            unitId,
            `${accountPrefix}${ACCOUNT_MAPPING_KEYS.INVENTORY_ASSET}`,
            '1104',
            'Persediaan',
            tx
          )
        : null;

      const cogsAccount = periodOpen
        ? await getAccountOrFallback(
            unitId,
            `${accountPrefix}${ACCOUNT_MAPPING_KEYS.COGS}`,
            '5101',
            'Beban Pokok Penjualan Kantin',
            tx
          )
        : null;

      const cashAccount = periodOpen
        ? await getAccountOrFallback(unitId, ACCOUNT_MAPPING_KEYS.CASH, '1101', 'Kas', tx)
        : null;

      const walletLiabilityAccount = periodOpen
        ? await getAccountOrFallback(
            unitId,
            ACCOUNT_MAPPING_KEYS.WALLET_LIABILITY,
            '2101',
            'Utang Wallet Santri',
            tx
          )
        : null;

      // 1. Record Revenue & Cash/Wallet Receipt
      const paymentAccount = data.paymentMethod === 'WALLET' ? walletLiabilityAccount : cashAccount;
      // Skip journal creation when the period is closed OR when required
      // account mappings are missing. The business transaction still completes
      // either way; only the ledger entries are deferred.
      const revenueJournalCreated = periodOpen && !!(salesAccount && paymentAccount);

      if (periodOpen && !(salesAccount && paymentAccount)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[Canteen Accounting] Skipping journal entries for transaction ${transactionNo} — ` +
            `missing account mappings (salesAccount: ${!!salesAccount}, paymentAccount: ${!!paymentAccount}). ` +
            `Configure chart of accounts for unit ${unitId}.`
        );
      }

      if (revenueJournalCreated) {
        // Debit Cash/Wallet
        await tx.journalEntry.create({
          data: {
            unitId,
            accountId: paymentAccount.id,
            date: journalDate,
            description: `Penjualan Kantin #${transactionNo}`,
            debit: total,
            credit: 0,
            reference: transaction.id,
            referenceType: JournalReferenceType.CANTEEN as any,
            createdById: cashierId,
          },
        });

        // Credit Revenue
        await tx.journalEntry.create({
          data: {
            unitId,
            accountId: salesAccount.id,
            date: journalDate,
            description: `Penjualan Kantin #${transactionNo}`,
            debit: 0,
            credit: total,
            reference: transaction.id,
            referenceType: JournalReferenceType.CANTEEN as any,
            createdById: cashierId,
          },
        });
      }

      // Update stock and create stock movements + COGS Journals.
      // Iterate over the aggregated `quantityByItem` map rather than
      // `data.items` so that duplicate order lines referencing the same
      // itemId produce exactly one stock decrement and one stock movement
      // with the combined quantity. Iterating over `data.items` directly
      // would cause last-write-wins on the stock column.
      let totalCogs = new Prisma.Decimal(0);

      for (const [itemId, totalQty] of quantityByItem) {
        const item = items.find((i) => i.id === itemId)!;
        const newStock = item.stock - totalQty;
        const itemCogs = (item.costPrice || new Prisma.Decimal(0)).mul(totalQty);
        totalCogs = totalCogs.add(itemCogs);

        await tx.canteenItem.update({
          where: { id: item.id },
          data: { stock: newStock },
        });

        await tx.canteenStockMovement.create({
          data: {
            itemId: item.id,
            type: 'OUT',
            quantity: totalQty,
            stockBefore: item.stock,
            stockAfter: newStock,
            reference: transaction.id,
            notes: `Penjualan #${transactionNo}`,
            createdById: cashierId,
          },
        });
      }

      // 2. Record COGS & Inventory Reduction
      // Only create COGS journals when revenue journals were also created,
      // to avoid partially recording the business event in the ledger.
      //
      // If revenue journals WERE created but COGS accounts are missing or
      // totalCogs is zero (e.g. item.costPrice unset), we skip COGS entries
      // and emit a warning. Without this warning the income statement would
      // record revenue without the corresponding cost of goods sold,
      // overstating profit — and operators following ACCOUNTING_DEPLOYMENT.md
      // would have no log signal indicating the gap until month-end
      // reconciliation.
      if (revenueJournalCreated && (!cogsAccount || !inventoryAccount || !totalCogs.gt(0))) {
        // eslint-disable-next-line no-console
        console.warn(
          `[Canteen Accounting] Revenue journals posted but COGS journals skipped for transaction ${transactionNo} — ` +
            `cogsAccount: ${!!cogsAccount}, inventoryAccount: ${!!inventoryAccount}, totalCogs: ${totalCogs.toString()}. ` +
            `Income statement for unit ${unitId} will be overstated until adjusting entries are posted. ` +
            `Configure COGS/Inventory account mappings and ensure item.costPrice is set.`
        );
      }

      if (revenueJournalCreated && cogsAccount && inventoryAccount && totalCogs.gt(0)) {
        // Debit COGS
        await tx.journalEntry.create({
          data: {
            unitId,
            accountId: cogsAccount.id,
            date: journalDate,
            description: `BPP Penjualan Kantin #${transactionNo}`,
            debit: totalCogs,
            credit: 0,
            reference: transaction.id,
            referenceType: JournalReferenceType.CANTEEN as any,
            createdById: cashierId,
          },
        });

        // Credit Inventory
        await tx.journalEntry.create({
          data: {
            unitId,
            accountId: inventoryAccount.id,
            date: journalDate,
            description: `Pengurangan Stok Kantin #${transactionNo}`,
            debit: 0,
            credit: totalCogs,
            reference: transaction.id,
            referenceType: JournalReferenceType.CANTEEN as any,
            createdById: cashierId,
          },
        });
      }

      return transaction;
    });
  },

  async updateStatus(
    id: string,
    unitId: string,
    userId: string,
    data: UpdateTransactionStatusInput
  ) {
    return prisma.$transaction(async (tx) => {
      // Acquire an exclusive row lock via SELECT ... FOR UPDATE to prevent
      // concurrent refund requests from both passing the status guard.
      // Prisma doesn't support FOR UPDATE natively, so we use $queryRaw.
      const lockedRows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM canteen_transactions
        WHERE id = ${id} AND unit_id = ${unitId}
        FOR UPDATE
      `;

      if (lockedRows.length === 0) {
        throw new Error('Transaksi tidak ditemukan');
      }

      if (data.status === 'REFUNDED' && lockedRows[0].status !== 'COMPLETED') {
        throw new Error('Hanya transaksi COMPLETED yang dapat di-refund');
      }

      // Enforce valid state transitions to prevent data corruption.
      // Re-completing a CANCELLED/REFUNDED transaction is not allowed because
      // the reversal (stock restore, wallet refund, journal reversal) has
      // already been applied and re-completing would not re-deduct them.
      // PENDING → COMPLETED is also disallowed here because the `create` method
      // always creates transactions as COMPLETED with all side-effects (stock
      // deduction, wallet charge, journal entries) processed atomically.
      // Allowing PENDING → COMPLETED via updateStatus would silently skip
      // those side-effects, producing inconsistent inventory and accounting data.
      const VALID_TRANSITIONS: Record<string, string[]> = {
        PENDING: ['CANCELLED'],
        COMPLETED: ['REFUNDED', 'CANCELLED'],
        CANCELLED: [], // Terminal state
        REFUNDED: [], // Terminal state
      };

      const currentStatus = lockedRows[0].status;
      const allowedNext = VALID_TRANSITIONS[currentStatus] || [];
      if (!allowedNext.includes(data.status)) {
        throw new Error(
          `Transisi status dari ${currentStatus} ke ${data.status} tidak diperbolehkan`
        );
      }

      // Cancelling a COMPLETED transaction triggers financial reversal (wallet refund,
      // stock restore, journal entries). Require explicit confirmation to prevent
      // accidental cancellation of settled transactions.
      if (data.status === 'CANCELLED' && currentStatus === 'COMPLETED' && !data.confirmReversal) {
        throw new Error(
          'Pembatalan transaksi yang sudah COMPLETED akan mengembalikan saldo wallet, stok, dan jurnal akuntansi. ' +
            'Kirim confirmReversal: true untuk mengonfirmasi.'
        );
      }

      // Now safe to read the full transaction — the row is locked.
      const transaction = await tx.canteenTransaction.findFirst({
        where: { id, unitId },
        include: { items: true },
      });

      if (!transaction) {
        throw new Error('Transaksi tidak ditemukan');
      }

      // Handle refund or cancellation of a COMPLETED transaction.
      // Both cases need to restore wallet balance and stock so that the
      // physical inventory and wallet ledger stay in sync with the
      // reversing journal entries created further below.
      const shouldReverse =
        data.status === 'REFUNDED' ||
        (data.status === 'CANCELLED' && lockedRows[0].status === 'COMPLETED');

      if (shouldReverse) {
        // Refund to wallet if original payment was wallet
        if (transaction.walletId) {
          // Acquire row lock on wallet to prevent lost updates from concurrent refunds
          const lockedWallets = await tx.$queryRaw<Array<{ id: string; balance: string }>>`
            SELECT id, balance::text FROM santri_wallets
            WHERE id = ${transaction.walletId}
            FOR UPDATE
          `;

          if (lockedWallets.length === 0) {
            // Wallet was deleted between the original transaction and this refund.
            // Fail loudly rather than silently skipping — a silent skip would mark
            // the transaction as REFUNDED without returning money to the student,
            // producing a financial discrepancy that's hard to detect later.
            throw new Error(
              `Wallet (${transaction.walletId}) untuk transaksi #${transaction.transactionNo} tidak ditemukan. ` +
                `Refund tidak dapat diproses.`
            );
          }

          const walletRow = lockedWallets[0];
          const currentBalance = new Prisma.Decimal(walletRow.balance);
          const newBalance = currentBalance.add(transaction.total);
          await tx.santriWallet.update({
            where: { id: walletRow.id },
            data: { balance: newBalance },
          });

          await tx.walletTransaction.create({
            data: {
              walletId: walletRow.id,
              type: 'REFUND',
              amount: transaction.total,
              balanceBefore: currentBalance,
              balanceAfter: newBalance,
              reference: transaction.id,
              referenceType: 'CANTEEN',
              description: `${data.status === 'REFUNDED' ? 'Refund' : 'Pembatalan'} transaksi #${transaction.transactionNo}`,
              createdById: userId,
            },
          });
        }

        // Restore stock.
        //
        // Acquire SELECT ... FOR UPDATE row locks on the canteen_items rows
        // BEFORE reading them, so that concurrent `create` transactions (which
        // also lock items FOR UPDATE — see line 475-481) cannot decrement stock
        // between our read and write. Without this lock, a concurrent sale
        // could decrement stock from N to N-K after we read N but before we
        // write N+restore, causing our write to clobber the sale's decrement
        // and over-report inventory.
        //
        // Locks are acquired in deterministic ID-sorted order to match the
        // ordering used by `create` and avoid deadlocks between a concurrent
        // sale and refund on overlapping item sets.
        const restoreItemIds = [...new Set(transaction.items.map((i) => i.itemId))].sort();

        if (restoreItemIds.length > 0) {
          await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM canteen_items
            WHERE id = ANY(${restoreItemIds}::text[])
            ORDER BY id
            FOR UPDATE
          `;
        }

        // Aggregate quantities per itemId so that duplicate order lines on the
        // same item produce exactly one stock restore with the combined
        // quantity (mirrors the aggregation applied on the `create` path).
        const restoreQtyByItem = new Map<string, number>();
        for (const item of transaction.items) {
          restoreQtyByItem.set(
            item.itemId,
            (restoreQtyByItem.get(item.itemId) || 0) + item.quantity
          );
        }

        for (const [itemId, restoreQty] of restoreQtyByItem) {
          const currentItem = await tx.canteenItem.findUnique({
            where: { id: itemId },
          });

          if (currentItem) {
            const newStock = currentItem.stock + restoreQty;
            await tx.canteenItem.update({
              where: { id: itemId },
              data: { stock: newStock },
            });

            await tx.canteenStockMovement.create({
              data: {
                itemId,
                type: 'IN',
                quantity: restoreQty,
                stockBefore: currentItem.stock,
                stockAfter: newStock,
                reference: transaction.id,
                notes: `${data.status === 'REFUNDED' ? 'Refund' : 'Pembatalan'} transaksi #${transaction.transactionNo}`,
                createdById: userId,
              },
            });
          }
        }
      }

      // ─── REVERSING JOURNAL ENTRIES FOR REFUND / CANCELLATION ───
      // Look up the *original* journal entries by transaction reference so that
      // reversals always target the exact same accounts and amounts that were
      // recorded at sale time, even if account mappings have been changed since.
      //
      // Reversal entries use a `REFUND:` / `CANCEL:` prefix on the reference
      // field so they are distinguishable from the originals.  This prevents a
      // (now-unlikely but still theoretically possible) double-reversal if a
      // second request were to read both originals and prior reversals.
      if (
        data.status === 'REFUNDED' ||
        (data.status === 'CANCELLED' && lockedRows[0].status === 'COMPLETED')
      ) {
        const reversalDate = new Date();
        // Refuse to post reversing entries into a closed financial period, but
        // DO NOT block the refund/cancellation itself — the customer-facing
        // wallet refund and stock restoration must still complete so customers
        // aren't denied refunds due to an accounting configuration. Skip the
        // reversing journal entries when the period is closed and log a
        // warning; accounting can post adjusting entries manually.
        const reversalPeriodOpen = await isPeriodOpen(unitId, reversalDate, tx);
        if (!reversalPeriodOpen) {
          // eslint-disable-next-line no-console
          console.warn(
            `[Canteen Accounting] Skipping reversing journal entries for transaction ${transaction.transactionNo} — ` +
              `financial period for ${reversalDate.toISOString()} is closed (unit ${unitId}).`
          );
        }

        if (reversalPeriodOpen) {
          const reversalPrefix = data.status === 'REFUNDED' ? 'REFUND' : 'CANCEL';
          const refundReference = `${reversalPrefix}:${transaction.id}`;

          const originalEntries = await tx.journalEntry.findMany({
            where: {
              reference: transaction.id,
              referenceType: JournalReferenceType.CANTEEN as any,
            },
            select: { accountId: true, debit: true, credit: true, description: true },
          });

          for (const entry of originalEntries) {
            // Swap debit ↔ credit to create the reversing entry
            await tx.journalEntry.create({
              data: {
                unitId,
                accountId: entry.accountId,
                date: reversalDate,
                description: `${data.status === 'REFUNDED' ? 'Refund' : 'Pembatalan'} ${entry.description || ''} #${transaction.transactionNo}`,
                debit: entry.credit,
                credit: entry.debit,
                reference: refundReference,
                referenceType: JournalReferenceType.CANTEEN as any,
                createdById: userId,
              },
            });
          }
        }
      }

      return tx.canteenTransaction.update({
        where: { id },
        data: {
          status: data.status,
          notes: data.notes ? `${transaction.notes || ''}\n${data.notes}` : transaction.notes,
        },
      });
    });
  },

  async getStats(unitId: string | undefined, startDate?: string, endDate?: string) {
    const dateFilter =
      startDate && endDate
        ? {
            createdAt: {
              gte: new Date(startDate),
              lte: new Date(endDate + 'T23:59:59.999Z'),
            },
          }
        : {
            createdAt: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
            },
          };

    // unitId is optional: when omitted (SUPER_ADMIN global view) stats aggregate
    // across all units. Caller is responsible for authorization.
    const unitFilter = unitId ? { unitId } : {};

    const [todayStats, totalTransactions, topItems, paymentBreakdown] = await Promise.all([
      prisma.canteenTransaction.aggregate({
        where: { ...unitFilter, status: 'COMPLETED', ...dateFilter },
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.canteenTransaction.count({
        where: { ...unitFilter },
      }),
      prisma.canteenTransactionItem.groupBy({
        by: ['itemId', 'itemName'],
        where: {
          transaction: { ...unitFilter, status: 'COMPLETED', ...dateFilter },
        },
        _sum: { quantity: true, total: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 10,
      }),
      prisma.canteenTransaction.groupBy({
        by: ['paymentMethod'],
        where: { ...unitFilter, status: 'COMPLETED', ...dateFilter },
        _sum: { total: true },
        _count: { id: true },
      }),
    ]);

    return {
      period: {
        startDate: startDate || new Date().toISOString().slice(0, 10),
        endDate: endDate || new Date().toISOString().slice(0, 10),
      },
      summary: {
        totalRevenue: todayStats._sum.total?.toNumber() || 0,
        totalTransactions: todayStats._count.id,
        allTimeTransactions: totalTransactions,
      },
      topItems: topItems.map((item) => ({
        itemId: item.itemId,
        itemName: item.itemName,
        quantitySold: item._sum.quantity || 0,
        totalRevenue: item._sum.total?.toNumber() || 0,
      })),
      paymentBreakdown: paymentBreakdown.map((p) => ({
        method: p.paymentMethod,
        count: p._count.id,
        total: p._sum.total?.toNumber() || 0,
      })),
    };
  },
};

// =============================================================================
// STOCK MOVEMENT SERVICE
// =============================================================================

export const stockMovementService = {
  async getAll(unitId: string, query: ListStockMovementsQuery) {
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '20');
    const skip = (page - 1) * limit;

    const where: Prisma.CanteenStockMovementWhereInput = {
      item: { unitId },
      ...(query.itemId && { itemId: query.itemId }),
      ...(query.type && { type: query.type }),
      ...(query.startDate &&
        query.endDate && {
          createdAt: {
            gte: new Date(query.startDate),
            lte: new Date(query.endDate + 'T23:59:59.999Z'),
          },
        }),
    };

    const [movements, total] = await Promise.all([
      prisma.canteenStockMovement.findMany({
        where,
        include: {
          item: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.canteenStockMovement.count({ where }),
    ]);

    return {
      data: movements,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async create(unitId: string, userId: string, data: CreateStockMovementInput) {
    const item = await prisma.canteenItem.findFirst({
      where: { id: data.itemId, unitId },
    });

    if (!item) {
      throw new Error('Item tidak ditemukan');
    }

    return prisma.$transaction(async (tx) => {
      let newStock: number;

      switch (data.type) {
        case 'IN':
          newStock = item.stock + data.quantity;
          break;
        case 'OUT':
        case 'EXPIRED':
          if (item.stock < data.quantity) {
            throw new Error(`Stok tidak mencukupi (tersedia: ${item.stock})`);
          }
          newStock = item.stock - data.quantity;
          break;
        case 'ADJUSTMENT':
          newStock = data.quantity; // For adjustment, quantity is the new stock value
          break;
        default:
          throw new Error('Tipe pergerakan tidak valid');
      }

      await tx.canteenItem.update({
        where: { id: item.id },
        data: { stock: newStock },
      });

      return tx.canteenStockMovement.create({
        data: {
          itemId: item.id,
          type: data.type,
          quantity: data.type === 'ADJUSTMENT' ? Math.abs(newStock - item.stock) : data.quantity,
          stockBefore: item.stock,
          stockAfter: newStock,
          notes: data.notes,
          createdById: userId,
        },
        include: {
          item: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });
    });
  },
};
