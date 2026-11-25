import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import {
  ACCOUNT_MAPPING_KEYS,
  ACCOUNT_MAPPING_KEY_LIST,
  expectedAccountTypeForMapping,
  isAccountMappingKey,
  parseBusinessUnitMappingKey,
} from '@cipansor/shared';
import { Errors } from '../../middleware/error';

type TransactionClient = Prisma.TransactionClient;

export {
  ACCOUNT_MAPPING_KEYS,
  ACCOUNT_MAPPING_KEY_LIST,
  BUSINESS_UNIT_MAPPING_KEYS,
  isAccountMappingKey,
  parseBusinessUnitMappingKey,
} from '@cipansor/shared';

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

  return storedAccountId(setting?.value);
}

function storedAccountId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'accountId' in value) {
    const accountId = (value as { accountId?: unknown }).accountId;
    return typeof accountId === 'string' ? accountId : null;
  }
  return null;
}

function isUsableAccount(
  account: { unitId: string | null; isActive: boolean; type: string } | null,
  unitId: string,
  key: string
): boolean {
  if (!account || !account.isActive) return false;
  if (account.unitId !== null && account.unitId !== unitId) return false;
  const expectedType = expectedAccountTypeForMapping(key);
  return !expectedType || account.type === expectedType;
}

/**
 * A mapping the journals will actually post to. Every mapped account must be
 * active, owned by the unit (or shared foundation-wide), and of the type its
 * slot needs — a cash account in a revenue slot would debit and credit cash.
 * Otherwise the settings look saved while the journal silently ignores the
 * choice.
 */
async function isUsableAccountMapping(
  unitId: string,
  key: string,
  accountId: string,
  tx: TransactionClient | typeof prisma
): Promise<boolean> {
  const account = await tx.accountCode.findUnique({
    where: { id: accountId },
    select: { unitId: true, isActive: true, type: true },
  });
  return isUsableAccount(account, unitId, key);
}

async function assertUsableAccountMapping(
  unitId: string,
  key: string,
  accountId: string,
  tx: TransactionClient
) {
  const account = await tx.accountCode.findUnique({
    where: { id: accountId },
    select: { unitId: true, isActive: true, type: true },
  });

  if (!account) {
    throw Errors.badRequest(`Akun pemetaan ${key} tidak ditemukan`);
  }
  if (account.unitId !== null && account.unitId !== unitId) {
    throw Errors.badRequest(`Akun pemetaan ${key} bukan milik unit ini`);
  }
  if (!account.isActive) {
    throw Errors.badRequest(`Akun pemetaan ${key} tidak aktif`);
  }
  const expectedType = expectedAccountTypeForMapping(key);
  if (expectedType && account.type !== expectedType) {
    throw Errors.badRequest(
      `Akun pemetaan ${key} harus bertipe ${expectedType}, bukan ${account.type}`
    );
  }
}

/**
 * Every mapping of one unit exactly as stored. A stored PPh 21 id that no
 * longer points to a usable account is still returned: the settings form must
 * not turn an untouched row into a delete instruction when the operator saves
 * an unrelated field.
 */
export async function getAccountMappings(unitId: string) {
  const settings: Record<string, string | null> = {};

  for (const key of ACCOUNT_MAPPING_KEY_LIST) {
    settings[key] = await getAccountMapping(unitId, key);
  }

  return settings;
}

/**
 * The stored mappings plus the keys whose stored account is no longer usable.
 * The form uses `invalidKeys` to warn without replacing the stored id with
 * `null` (which would delete it on the next save).
 */
export async function getAccountMappingState(unitId: string) {
  const settings = await getAccountMappings(unitId);

  const [ownedBusinessUnits, businessUnitSettings] = await Promise.all([
    prisma.businessUnit.findMany({
      where: { unitId },
      select: { id: true, name: true, type: true },
    }),
    prisma.setting.findMany({
      where: { unitId, key: { startsWith: 'BU_' } },
      select: { key: true, value: true },
    }),
  ]);
  const ownedBusinessUnitIds = new Set(ownedBusinessUnits.map((unit) => unit.id));

  for (const setting of businessUnitSettings) {
    const parsed = parseBusinessUnitMappingKey(setting.key);
    if (!parsed || !ownedBusinessUnitIds.has(parsed.businessUnitId)) continue;
    settings[setting.key] = storedAccountId(setting.value);
  }

  const invalidKeys: string[] = [];

  for (const [key, accountId] of Object.entries(settings)) {
    if (accountId && !(await isUsableAccountMapping(unitId, key, accountId, prisma))) {
      invalidKeys.push(key);
    }
  }

  return { settings, invalidKeys, businessUnits: ownedBusinessUnits };
}

/**
 * Saves every mapping of one unit in a single transaction. Validation runs
 * before any upsert, so a request that changes the cash account and carries a
 * stale/invalid PPh 21 mapping writes neither: the portal's failure message and
 * the stored settings always describe the same state.
 */
export async function setAccountMappings(
  unitId: string,
  mappings: Record<string, string | null | undefined>
) {
  const entries = Object.entries(mappings);
  const unknown = entries.map(([key]) => key).filter((key) => !isAccountMappingKey(key));
  if (unknown.length > 0) {
    throw Errors.badRequest(`Kunci pengaturan tidak dikenal: ${unknown.join(', ')}`);
  }

  const businessUnitIds = [
    ...new Set(
      entries
        .map(([key]) => parseBusinessUnitMappingKey(key)?.businessUnitId)
        .filter((id): id is string => !!id)
    ),
  ];

  return prisma.$transaction(async (tx) => {
    if (businessUnitIds.length > 0) {
      const owned = await tx.businessUnit.findMany({
        where: { id: { in: businessUnitIds }, unitId },
        select: { id: true },
      });
      if (owned.length !== businessUnitIds.length) {
        throw Errors.badRequest('Unit usaha tidak berada dalam unit ini');
      }
    }

    for (const [key, accountId] of entries) {
      if (accountId !== null && accountId !== undefined) {
        if (typeof accountId !== 'string') {
          throw Errors.badRequest(`Nilai pemetaan ${key} harus berupa id akun`);
        }
        await assertUsableAccountMapping(unitId, key, accountId, tx);
      }
    }

    for (const [key, accountId] of entries) {
      // `undefined` means "not part of this save"; only an explicit `null`
      // clears a mapping.
      if (accountId === undefined) continue;

      if (accountId === null) {
        await tx.setting.deleteMany({ where: { unitId, key } });
        continue;
      }

      await tx.setting.upsert({
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
  });
}

/**
 * Helper to get a mapped account or fall back to a UNIT-SCOPED default
 * code/name lookup. Accepts an optional transaction client so reads
 * participate in the caller's transaction inside prisma.$transaction.
 *
 * UNIT SCOPING (no cross-unit leak): every path is scoped to `unitId`.
 *   1. Primary path — Settings-based mapping(s) — is unit-keyed (operator's
 *      explicit choice; resolved by account id). A business-unit key may be
 *      followed by the unit-level key, so the latter is the documented
 *      fallback.
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
  key: string | readonly string[],
  fallbackCode?: string,
  fallbackNameSearch?: string,
  tx: TransactionClient | typeof prisma = prisma
) {
  const mappingKeys = typeof key === 'string' ? [key] : key;
  const expectedType = expectedAccountTypeForMapping(mappingKeys[0] ?? '');

  // 1. Try the mappings in order (a business-unit key, then the unit-level
  //    fallback). Old cross-unit rows are ignored rather than posted.
  for (const mappingKey of mappingKeys) {
    const mappedId = await getAccountMapping(unitId, mappingKey, tx);
    if (!mappedId) continue;

    const account = await tx.accountCode.findUnique({ where: { id: mappedId } });
    if (account && isUsableAccount(account, unitId, mappingKey)) return account;
  }

  // 2. Fallback by code — scoped to this unit's own chart of accounts.
  if (fallbackCode) {
    const account = await tx.accountCode.findFirst({
      where: {
        code: fallbackCode,
        isActive: true,
        unitId,
        ...(expectedType ? { type: expectedType } : {}),
      },
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
        ...(expectedType ? { type: expectedType } : {}),
      },
    });
    if (account) return account;
  }

  return null;
}
