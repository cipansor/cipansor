import { describe, expect, it } from 'vitest';
import { ACCOUNT_MAPPING_KEYS, updateAccountingSettingsSchema } from '@cipansor/shared';

const UNIT = '11111111-1111-4111-8111-111111111111';
const BUSINESS_UNIT = '33333333-3333-4333-8333-333333333333';
const ACCOUNT = '44444444-4444-4444-8444-444444444444';

describe('updateAccountingSettingsSchema', () => {
  it('accepts unit-level and business-unit mappings', () => {
    const parsed = updateAccountingSettingsSchema.parse({
      unitId: UNIT,
      settings: {
        [ACCOUNT_MAPPING_KEYS.CASH]: ACCOUNT,
        [`BU_${BUSINESS_UNIT}_${ACCOUNT_MAPPING_KEYS.SALES_REVENUE}`]: ACCOUNT,
      },
    });

    expect(parsed.settings[ACCOUNT_MAPPING_KEYS.CASH]).toBe(ACCOUNT);
  });

  it.each([
    ['CALENDAR_HOLIDAY_SYNC', 'a non-accounting key'],
    [`BU_${BUSINESS_UNIT}_ACCOUNT_MAPPING_CASH`, 'a key the journals never read with a BU prefix'],
    [`BU_not-a-uuid_${ACCOUNT_MAPPING_KEYS.SALES_REVENUE}`, 'a malformed BU id'],
    [
      `BU_${'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'}_${ACCOUNT_MAPPING_KEYS.SALES_REVENUE}`,
      'an uppercase BU id the journal lookup would never match',
    ],
  ])('rejects %s (%s)', (key) => {
    expect(
      updateAccountingSettingsSchema.safeParse({
        unitId: UNIT,
        settings: { [key]: ACCOUNT },
      }).success
    ).toBe(false);
  });

  it('rejects an array in place of the settings object', () => {
    expect(
      updateAccountingSettingsSchema.safeParse({
        unitId: UNIT,
        settings: [ACCOUNT_MAPPING_KEYS.CASH],
      }).success
    ).toBe(false);
  });

  it('rejects an unknown top-level field', () => {
    expect(
      updateAccountingSettingsSchema.safeParse({
        unitId: UNIT,
        settings: {},
        extra: true,
      }).success
    ).toBe(false);
  });
});
