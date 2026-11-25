import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, txMock } = vi.hoisted(() => {
  const txMock = {
    accountCode: { findUnique: vi.fn() },
    setting: { deleteMany: vi.fn(), upsert: vi.fn() },
  };
  return {
    txMock,
    prismaMock: {
      accountCode: { findUnique: vi.fn() },
      setting: { findUnique: vi.fn(), upsert: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

import {
  ACCOUNT_MAPPING_KEYS,
  getAccountMappings,
  setAccountMappings,
} from '../accounting-config.service';

const UNIT = 'unit-sd';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((async (callback: (tx: unknown) => unknown) =>
    callback(txMock)) as never);
  txMock.setting.upsert.mockResolvedValue({} as never);
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

  it('does not apply the liability check to other mappings', async () => {
    await setAccountMappings(UNIT, { [ACCOUNT_MAPPING_KEYS.CASH]: 'acc-cash' });

    expect(txMock.accountCode.findUnique).not.toHaveBeenCalled();
    expect(txMock.setting.upsert).toHaveBeenCalled();
  });

  it('writes every mapping through the same transaction', async () => {
    txMock.accountCode.findUnique.mockResolvedValue({
      unitId: UNIT,
      isActive: true,
      type: 'LIABILITY',
    } as never);

    await setAccountMappings(UNIT, {
      [ACCOUNT_MAPPING_KEYS.CASH]: 'acc-new-cash',
      [ACCOUNT_MAPPING_KEYS.TAX_PAYABLE]: 'acc-pph21',
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.setting.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.setting.upsert).not.toHaveBeenCalled();
  });

  it('reports a stored PPh 21 mapping that is no longer usable as unset', async () => {
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

    const settings = await getAccountMappings(UNIT);

    // The form must not resend a stale id and block the cash field it is
    // actually editing.
    expect(settings[ACCOUNT_MAPPING_KEYS.TAX_PAYABLE]).toBeNull();
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

  it('clears a mapping when the value is null', async () => {
    await setAccountMappings(UNIT, { [ACCOUNT_MAPPING_KEYS.TAX_PAYABLE]: null });

    expect(txMock.setting.deleteMany).toHaveBeenCalledWith({
      where: { unitId: UNIT, key: ACCOUNT_MAPPING_KEYS.TAX_PAYABLE },
    });
    expect(txMock.setting.upsert).not.toHaveBeenCalled();
  });

  it('leaves the cash mapping untouched when a later PPh 21 mapping is invalid', async () => {
    txMock.accountCode.findUnique.mockResolvedValue({
      unitId: UNIT,
      isActive: true,
      type: 'EXPENSE',
    } as never);

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
