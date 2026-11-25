import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, txMock } = vi.hoisted(() => {
  const txMock = {
    accountCode: { findUnique: vi.fn(), findFirst: vi.fn() },
    businessUnit: { findMany: vi.fn() },
    setting: { deleteMany: vi.fn(), upsert: vi.fn() },
  };
  return {
    txMock,
    prismaMock: {
      accountCode: { findUnique: vi.fn(), findFirst: vi.fn() },
      businessUnit: { findMany: vi.fn() },
      setting: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

import {
  ACCOUNT_MAPPING_KEYS,
  getAccountMappingState,
  getAccountMappings,
  getAccountOrFallback,
  setAccountMappings,
} from '../accounting-config.service';

const UNIT = 'unit-sd';
const BUSINESS_UNIT = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((async (callback: (tx: unknown) => unknown) =>
    callback(txMock)) as never);
  txMock.setting.upsert.mockResolvedValue({} as never);
  txMock.businessUnit.findMany.mockResolvedValue([{ id: BUSINESS_UNIT }] as never);
  txMock.accountCode.findUnique.mockResolvedValue({
    unitId: UNIT,
    isActive: true,
    type: 'ASSET',
  } as never);
  prismaMock.setting.findMany.mockResolvedValue([] as never);
  prismaMock.businessUnit.findMany.mockResolvedValue([
    { id: BUSINESS_UNIT, name: 'Kantin Pesantren', type: 'CANTEEN' },
  ] as never);
});

describe('PPh 21 account mapping', () => {
  it('accepts an active liability account owned by the unit', async () => {
    txMock.accountCode.findUnique.mockResolvedValue({
      unitId: UNIT,
      isActive: true,
      type: 'LIABILITY',
    } as never);

    await setAccountMappings(UNIT, { [ACCOUNT_MAPPING_KEYS.TAX_PAYABLE]: 'acc-pph21' });

    expect(txMock.setting.upsert).toHaveBeenCalled();
  });

  it('accepts an active shared liability account', async () => {
    txMock.accountCode.findUnique.mockResolvedValue({
      unitId: null,
      isActive: true,
      type: 'LIABILITY',
    } as never);

    await setAccountMappings(UNIT, { [ACCOUNT_MAPPING_KEYS.TAX_PAYABLE]: 'acc-shared' });

    expect(txMock.setting.upsert).toHaveBeenCalled();
  });

  it.each([
    ['an expense account', { unitId: UNIT, isActive: true, type: 'EXPENSE' }],
    ['an inactive account', { unitId: UNIT, isActive: false, type: 'LIABILITY' }],
    ['another unit’s account', { unitId: 'unit-smp', isActive: true, type: 'LIABILITY' }],
  ])('refuses %s', async (_label, account) => {
    txMock.accountCode.findUnique.mockResolvedValue(account as never);

    await expect(
      setAccountMappings(UNIT, { [ACCOUNT_MAPPING_KEYS.TAX_PAYABLE]: 'acc-bad' })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(txMock.setting.upsert).not.toHaveBeenCalled();
  });

  it('accepts an active account of the unit for non-liability mappings', async () => {
    await setAccountMappings(UNIT, { [ACCOUNT_MAPPING_KEYS.CASH]: 'acc-cash' });

    expect(txMock.accountCode.findUnique).toHaveBeenCalledWith({
      where: { id: 'acc-cash' },
      select: { unitId: true, isActive: true, type: true },
    });
    expect(txMock.setting.upsert).toHaveBeenCalled();
    expect(txMock.setting.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses another unit’s account for a business-unit mapping', async () => {
    txMock.accountCode.findUnique.mockResolvedValue({
      unitId: 'unit-smp',
      isActive: true,
      type: 'REVENUE',
    } as never);

    await expect(
      setAccountMappings(UNIT, {
        [`BU_${BUSINESS_UNIT}_${ACCOUNT_MAPPING_KEYS.SALES_REVENUE}`]: 'acc-smp',
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(txMock.setting.upsert).not.toHaveBeenCalled();
  });

  it('refuses an account that does not exist', async () => {
    txMock.accountCode.findUnique.mockResolvedValue(null as never);

    await expect(
      setAccountMappings(UNIT, { [ACCOUNT_MAPPING_KEYS.CASH]: 'missing' })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(txMock.setting.upsert).not.toHaveBeenCalled();
  });

  it('saving only the cash account leaves a stored invalid PPh 21 row untouched', async () => {
    await setAccountMappings(UNIT, { [ACCOUNT_MAPPING_KEYS.CASH]: 'acc-cash' });

    expect(txMock.setting.deleteMany).not.toHaveBeenCalled();
    expect(txMock.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          unitId_key: { unitId: UNIT, key: ACCOUNT_MAPPING_KEYS.CASH },
        },
      })
    );
  });

  it('ignores an undefined entry instead of deleting it', async () => {
    await setAccountMappings(UNIT, { [ACCOUNT_MAPPING_KEYS.CASH]: undefined });

    expect(txMock.setting.deleteMany).not.toHaveBeenCalled();
    expect(txMock.setting.upsert).not.toHaveBeenCalled();
  });

  it('stores a business-unit mapping the canteen service reads', async () => {
    txMock.accountCode.findUnique.mockResolvedValue({
      unitId: UNIT,
      isActive: true,
      type: 'REVENUE',
    } as never);

    await setAccountMappings(UNIT, {
      [`BU_${BUSINESS_UNIT}_${ACCOUNT_MAPPING_KEYS.SALES_REVENUE}`]: 'acc-sales',
    });

    expect(txMock.businessUnit.findMany).toHaveBeenCalledWith({
      where: { id: { in: [BUSINESS_UNIT] }, unitId: UNIT },
      select: { id: true },
    });
    expect(txMock.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          unitId_key: {
            unitId: UNIT,
            key: `BU_${BUSINESS_UNIT}_${ACCOUNT_MAPPING_KEYS.SALES_REVENUE}`,
          },
        },
      })
    );
  });

  it('refuses a business unit that belongs to another unit', async () => {
    txMock.businessUnit.findMany.mockResolvedValue([] as never);

    await expect(
      setAccountMappings(UNIT, {
        [`BU_${BUSINESS_UNIT}_${ACCOUNT_MAPPING_KEYS.SALES_REVENUE}`]: 'acc-sales',
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(txMock.setting.upsert).not.toHaveBeenCalled();
  });

  it.each([
    [`BU_${BUSINESS_UNIT}_ACCOUNT_MAPPING_CASH`, 'a key no journal reads with a BU prefix'],
    [`BU_${BUSINESS_UNIT}_CALENDAR_HOLIDAY_SYNC`, 'a non-accounting key under a BU prefix'],
    [`BU_not-a-uuid_${ACCOUNT_MAPPING_KEYS.SALES_REVENUE}`, 'a malformed business-unit id'],
  ])('refuses %s (%s)', async (key) => {
    await expect(setAccountMappings(UNIT, { [key]: null })).rejects.toMatchObject({
      statusCode: 400,
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a key that is not an account mapping', async () => {
    await expect(setAccountMappings(UNIT, { CALENDAR_HOLIDAY_SYNC: null })).rejects.toMatchObject({
      statusCode: 400,
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(txMock.setting.deleteMany).not.toHaveBeenCalled();
  });

  it('writes every mapping through the same transaction', async () => {
    txMock.accountCode.findUnique
      .mockResolvedValueOnce({ unitId: UNIT, isActive: true, type: 'ASSET' } as never)
      .mockResolvedValueOnce({ unitId: UNIT, isActive: true, type: 'LIABILITY' } as never);

    await setAccountMappings(UNIT, {
      [ACCOUNT_MAPPING_KEYS.CASH]: 'acc-new-cash',
      [ACCOUNT_MAPPING_KEYS.TAX_PAYABLE]: 'acc-pph21',
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.setting.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.setting.upsert).not.toHaveBeenCalled();
  });

  it.each([
    [ACCOUNT_MAPPING_KEYS.CASH, 'LIABILITY'],
    [ACCOUNT_MAPPING_KEYS.SALES_REVENUE, 'ASSET'],
    [ACCOUNT_MAPPING_KEYS.INVENTORY_ASSET, 'EXPENSE'],
    [ACCOUNT_MAPPING_KEYS.COGS, 'REVENUE'],
    [ACCOUNT_MAPPING_KEYS.PAYROLL_EXPENSE, 'ASSET'],
  ])('refuses %s mapped to a %s account', async (key, type) => {
    txMock.accountCode.findUnique.mockResolvedValue({
      unitId: UNIT,
      isActive: true,
      type,
    } as never);

    await expect(setAccountMappings(UNIT, { [key]: 'acc-wrong-type' })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(txMock.setting.upsert).not.toHaveBeenCalled();
  });

  it('returns the business units owned by the unit for the mapping form', async () => {
    const { businessUnits } = await getAccountMappingState(UNIT);

    expect(businessUnits).toEqual([
      { id: BUSINESS_UNIT, name: 'Kantin Pesantren', type: 'CANTEEN' },
    ]);
  });

  it('returns the stored PPh 21 id and flags it when no longer usable', async () => {
    prismaMock.setting.findUnique.mockImplementation((async ({
      where,
    }: {
      where: { unitId_key: { key: string } };
    }) =>
      where.unitId_key.key === ACCOUNT_MAPPING_KEYS.TAX_PAYABLE
        ? { value: { accountId: 'acc-expense' } }
        : null) as never);
    prismaMock.accountCode.findUnique.mockResolvedValue({
      unitId: UNIT,
      isActive: true,
      type: 'EXPENSE',
    } as never);

    const { settings, invalidKeys } = await getAccountMappingState(UNIT);

    // The form keeps the stored id (so it is not deleted by an unrelated
    // save) and warns that the account must be replaced.
    expect(settings[ACCOUNT_MAPPING_KEYS.TAX_PAYABLE]).toBe('acc-expense');
    expect(invalidKeys).toContain(ACCOUNT_MAPPING_KEYS.TAX_PAYABLE);
  });

  it('returns stored business-unit mappings owned by the unit', async () => {
    const businessUnitKey = `BU_${BUSINESS_UNIT}_${ACCOUNT_MAPPING_KEYS.SALES_REVENUE}`;
    prismaMock.setting.findMany.mockResolvedValue([
      { key: businessUnitKey, value: { accountId: 'acc-sales' } },
    ] as never);
    prismaMock.accountCode.findUnique.mockResolvedValue({
      unitId: UNIT,
      isActive: true,
      type: 'REVENUE',
    } as never);

    const { settings, invalidKeys } = await getAccountMappingState(UNIT);

    expect(settings[businessUnitKey]).toBe('acc-sales');
    expect(invalidKeys).not.toContain(businessUnitKey);
  });

  it('drops a business-unit mapping once it is cleared', async () => {
    const businessUnitKey = `BU_${BUSINESS_UNIT}_${ACCOUNT_MAPPING_KEYS.SALES_REVENUE}`;
    prismaMock.setting.findMany
      .mockResolvedValueOnce([{ key: businessUnitKey, value: { accountId: 'acc-sales' } }] as never)
      .mockResolvedValueOnce([] as never);
    prismaMock.accountCode.findUnique.mockResolvedValue({
      unitId: UNIT,
      isActive: true,
      type: 'REVENUE',
    } as never);

    expect((await getAccountMappingState(UNIT)).settings[businessUnitKey]).toBe('acc-sales');
    expect((await getAccountMappingState(UNIT)).settings[businessUnitKey]).toBeUndefined();
  });

  it('ignores a stored business-unit mapping owned by another unit', async () => {
    prismaMock.businessUnit.findMany.mockResolvedValue([] as never);
    prismaMock.setting.findMany.mockResolvedValue([
      {
        key: `BU_${BUSINESS_UNIT}_${ACCOUNT_MAPPING_KEYS.SALES_REVENUE}`,
        value: { accountId: 'acc-sales' },
      },
    ] as never);

    const { settings } = await getAccountMappingState(UNIT);

    expect(settings).not.toHaveProperty(
      `BU_${BUSINESS_UNIT}_${ACCOUNT_MAPPING_KEYS.SALES_REVENUE}`
    );
  });

  it('returns a usable stored PPh 21 mapping', async () => {
    prismaMock.setting.findUnique.mockImplementation((async ({
      where,
    }: {
      where: { unitId_key: { key: string } };
    }) =>
      where.unitId_key.key === ACCOUNT_MAPPING_KEYS.TAX_PAYABLE
        ? { value: { accountId: 'acc-pph21' } }
        : null) as never);
    prismaMock.accountCode.findUnique.mockResolvedValue({
      unitId: UNIT,
      isActive: true,
      type: 'LIABILITY',
    } as never);

    const settings = await getAccountMappings(UNIT);

    expect(settings[ACCOUNT_MAPPING_KEYS.TAX_PAYABLE]).toBe('acc-pph21');
  });

  it('ignores a stored cross-unit mapping and uses the scoped fallback', async () => {
    prismaMock.setting.findUnique.mockResolvedValue({
      value: { accountId: 'acc-smp' },
    } as never);
    prismaMock.accountCode.findUnique.mockResolvedValue({
      id: 'acc-smp',
      unitId: 'unit-smp',
      isActive: true,
      type: 'EXPENSE',
    } as never);
    prismaMock.accountCode.findFirst.mockResolvedValue({
      id: 'acc-sd',
      unitId: UNIT,
      isActive: true,
      type: 'ASSET',
    } as never);

    const account = await getAccountOrFallback(UNIT, ACCOUNT_MAPPING_KEYS.CASH, '1101');

    expect(account).toMatchObject({ id: 'acc-sd' });
  });

  it('clears a mapping when the value is null', async () => {
    await setAccountMappings(UNIT, { [ACCOUNT_MAPPING_KEYS.TAX_PAYABLE]: null });

    expect(txMock.setting.deleteMany).toHaveBeenCalledWith({
      where: { unitId: UNIT, key: ACCOUNT_MAPPING_KEYS.TAX_PAYABLE },
    });
    expect(txMock.setting.upsert).not.toHaveBeenCalled();
  });

  it('leaves the cash mapping untouched when a later PPh 21 mapping is invalid', async () => {
    txMock.accountCode.findUnique
      .mockResolvedValueOnce({ unitId: UNIT, isActive: true, type: 'ASSET' } as never)
      .mockResolvedValueOnce({ unitId: UNIT, isActive: true, type: 'EXPENSE' } as never);

    await expect(
      setAccountMappings(UNIT, {
        [ACCOUNT_MAPPING_KEYS.CASH]: 'acc-new-cash',
        [ACCOUNT_MAPPING_KEYS.TAX_PAYABLE]: 'acc-expense',
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    // The cash entry came first, but nothing was written: validation happens
    // before the first upsert and every write shares the transaction.
    expect(txMock.setting.upsert).not.toHaveBeenCalled();
    expect(prismaMock.setting.upsert).not.toHaveBeenCalled();
  });
});
