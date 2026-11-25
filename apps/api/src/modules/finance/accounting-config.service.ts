import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { Errors } from '../../middleware/error';

type TransactionClient = Prisma.TransactionClient;

export const ACCOUNT_MAPPING_KEYS = {
  CASH: 'ACCOUNT_MAPPING_CASH',
  BANK: 'ACCOUNT_MAPPING_BANK',
  PAYROLL_EXPENSE: 'ACCOUNT_MAPPING_PAYROLL_EXPENSE',
  TAX_PAYABLE: 'ACCOUNT_MAPPING_TAX_PAYABLE',
  INVENTORY_ASSET: 'ACCOUNT_MAPPING_INVENTORY_ASSET',
  ACCOUNTS_PAYABLE: 'ACCOUNT_MAPPING_ACCOUNTS_PAYABLE',
  WALLET_LIABILITY: 'ACCOUNT_MAPPING_WALLET_LIABILITY',
  SALES_REVENUE: 'ACCOUNT_MAPPING_SALES_REVENUE',
  LAUNDRY_REVENUE: 'ACCOUNT_MAPPING_LAUNDRY_REVENUE',
  COGS: 'ACCOUNT_MAPPING_COGS',
};

export async function getAccountMapping(
  unitId: string,
  key: string,
  tx: TransactionClient | typeof prisma = prisma
): Promise<string | null> {
  const setting = await tx.setting.findUnique({
    where: {
      unitId_key: {
        unitId,
        key,
      },
    },
  });

  if (!setting || !setting.value) return null;

  // Value is stored as JSON, expected to be { accountId: "..." } or just the ID string if simple
  const value = setting.value as any;
  return typeof value === 'string' ? value : value.accountId || null;
}

/**
 * A mapping the payroll journal will actually post to. The PPh 21 payable is
 * a liability the unit owns (or a shared foundation-wide one); saving an
 * expense account, an inactive row or another unit's account would make the
 * settings look saved while the payment ignored it.
 */
async function assertUsableAccountMapping(unitId: string, key: string, accountId: string) {
  if (key !== ACCOUNT_MAPPING_KEYS.TAX_PAYABLE) return;

  const account = await prisma.accountCode.findUnique({
    where: { id: accountId },
    select: { unitId: true, isActive: true, type: true },
  });
  if (
    !account ||
    !account.isActive ||
    account.type !== 'LIABILITY' ||
    (account.unitId !== null && account.unitId !== unitId)
  ) {
    throw Errors.badRequest(
      'Akun Utang PPh 21 harus akun kewajiban aktif milik unit ini atau akun bersama'
    );
  }
}

export async function setAccountMapping(unitId: string, key: string, accountId: string) {
  await assertUsableAccountMapping(unitId, key, accountId);

  return prisma.setting.upsert({
    where: {
      unitId_key: {
        unitId,
        key,
      },
    },
    update: {
      value: { accountId },
    },
    create: {
      unitId,
      key,
      value: { accountId },
    },
  });
}

/**
 * Helper to get a mapped account or fall back to a UNIT-SCOPED default
 * code/name lookup. Accepts an optional transaction client so reads
 * participate in the caller's transaction inside prisma.$transaction.
 *
 * UNIT SCOPING (no cross-unit leak): every path is scoped to `unitId`.
 *   1. Primary path — Settings-based mapping — is unit-keyed (operator's
 *      explicit choice; resolved by account id).
 *   2/3. Fallback code/name lookups filter `AccountCode.unitId === unitId`,
 *      so a unit can only ever resolve its OWN chart of accounts — never
 *      another unit's. Rows with a null `unitId` (legacy/shared, not yet
 *      assigned to a unit) are intentionally excluded: until an operator
 *      assigns accounts to the unit the fallbacks return null and the caller
 *      skips journal creation (its existing "missing mapping" behaviour) — the
 *      same safe default as before, now without the env-flag gate and with no
 *      cross-unit leak possible.
 */
export async function getAccountOrFallback(
  unitId: string,
  key: string,
  fallbackCode?: string,
  fallbackNameSearch?: string,
  tx: TransactionClient | typeof prisma = prisma
) {
  // 1. Try Mapping (unit-scoped via Settings — operator's explicit choice).
  const mappedId = await getAccountMapping(unitId, key, tx);
  if (mappedId) {
    const account = await tx.accountCode.findUnique({ where: { id: mappedId } });
    if (account) return account;
  }

  // 2. Fallback by code — scoped to this unit's own chart of accounts.
  if (fallbackCode) {
    const account = await tx.accountCode.findFirst({
      where: { code: fallbackCode, isActive: true, unitId },
    });
    if (account) return account;
  }

  // 3. Fallback by name — scoped to this unit's own chart of accounts.
  if (fallbackNameSearch) {
    const account = await tx.accountCode.findFirst({
      where: {
        name: { contains: fallbackNameSearch, mode: 'insensitive' },
        isActive: true,
        unitId,
      },
    });
    if (account) return account;
  }

  return null;
}
