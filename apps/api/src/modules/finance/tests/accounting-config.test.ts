import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    accountCode: { findUnique: vi.fn() },
    setting: { upsert: vi.fn() },
  },
}));

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

import { ACCOUNT_MAPPING_KEYS, setAccountMapping } from '../accounting-config.service';

const UNIT = 'unit-sd';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.setting.upsert.mockResolvedValue({} as never);
});

describe('PPh 21 account mapping', () => {
  it('accepts an active liability account owned by the unit', async () => {
    prismaMock.accountCode.findUnique.mockResolvedValue({
      unitId: UNIT,
      isActive: true,
      type: 'LIABILITY',
    } as never);

    await setAccountMapping(UNIT, ACCOUNT_MAPPING_KEYS.TAX_PAYABLE, 'acc-pph21');

    expect(prismaMock.setting.upsert).toHaveBeenCalled();
  });

  it('accepts an active shared liability account', async () => {
    prismaMock.accountCode.findUnique.mockResolvedValue({
      unitId: null,
      isActive: true,
      type: 'LIABILITY',
    } as never);

    await setAccountMapping(UNIT, ACCOUNT_MAPPING_KEYS.TAX_PAYABLE, 'acc-shared');

    expect(prismaMock.setting.upsert).toHaveBeenCalled();
  });

  it.each([
    ['an expense account', { unitId: UNIT, isActive: true, type: 'EXPENSE' }],
    ['an inactive account', { unitId: UNIT, isActive: false, type: 'LIABILITY' }],
    ['another unit’s account', { unitId: 'unit-smp', isActive: true, type: 'LIABILITY' }],
  ])('refuses %s', async (_label, account) => {
    prismaMock.accountCode.findUnique.mockResolvedValue(account as never);

    await expect(
      setAccountMapping(UNIT, ACCOUNT_MAPPING_KEYS.TAX_PAYABLE, 'acc-bad')
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.setting.upsert).not.toHaveBeenCalled();
  });

  it('does not apply the liability check to other mappings', async () => {
    await setAccountMapping(UNIT, ACCOUNT_MAPPING_KEYS.CASH, 'acc-cash');

    expect(prismaMock.accountCode.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.setting.upsert).toHaveBeenCalled();
  });
});
