import { z } from "zod";

/** Account-mapping keys the finance settings form and journals share. */
export const ACCOUNT_MAPPING_KEYS = {
  CASH: "ACCOUNT_MAPPING_CASH",
  BANK: "ACCOUNT_MAPPING_BANK",
  PAYROLL_EXPENSE: "ACCOUNT_MAPPING_PAYROLL_EXPENSE",
  TAX_PAYABLE: "ACCOUNT_MAPPING_TAX_PAYABLE",
  INVENTORY_ASSET: "ACCOUNT_MAPPING_INVENTORY_ASSET",
  ACCOUNTS_PAYABLE: "ACCOUNT_MAPPING_ACCOUNTS_PAYABLE",
  WALLET_LIABILITY: "ACCOUNT_MAPPING_WALLET_LIABILITY",
  SALES_REVENUE: "ACCOUNT_MAPPING_SALES_REVENUE",
  LAUNDRY_REVENUE: "ACCOUNT_MAPPING_LAUNDRY_REVENUE",
  COGS: "ACCOUNT_MAPPING_COGS",
} as const;

export type AccountMappingKey =
  (typeof ACCOUNT_MAPPING_KEYS)[keyof typeof ACCOUNT_MAPPING_KEYS];

export const ACCOUNT_MAPPING_KEY_LIST = Object.values(
  ACCOUNT_MAPPING_KEYS,
) as readonly AccountMappingKey[];

/**
 * Keys the canteen and laundry services actually read with a `BU_<id>_`
 * prefix. A business-unit mapping for any other key is refused: it would be
 * stored but never consulted.
 */
export const BUSINESS_UNIT_MAPPING_KEYS: readonly AccountMappingKey[] = [
  ACCOUNT_MAPPING_KEYS.SALES_REVENUE,
  ACCOUNT_MAPPING_KEYS.INVENTORY_ASSET,
  ACCOUNT_MAPPING_KEYS.COGS,
  ACCOUNT_MAPPING_KEYS.LAUNDRY_REVENUE,
];

const BUSINESS_UNIT_MAPPING_PATTERN =
  /^BU_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(.+)$/;

export interface BusinessUnitMappingKey {
  businessUnitId: string;
  mappingKey: AccountMappingKey;
}

export function parseBusinessUnitMappingKey(
  key: string,
): BusinessUnitMappingKey | null {
  const match = BUSINESS_UNIT_MAPPING_PATTERN.exec(key);
  if (!match) return null;

  const mappingKey = match[2] as AccountMappingKey;
  if (!BUSINESS_UNIT_MAPPING_KEYS.includes(mappingKey)) return null;
  return { businessUnitId: match[1], mappingKey };
}

/** A unit-level mapping key, or a business-unit key the journals read. */
export function isAccountMappingKey(key: string): boolean {
  return (
    (ACCOUNT_MAPPING_KEY_LIST as readonly string[]).includes(key) ||
    parseBusinessUnitMappingKey(key) !== null
  );
}

const accountMappingsSchema = z
  .record(z.string(), z.string().uuid().nullable())
  .superRefine((mappings, ctx) => {
    for (const key of Object.keys(mappings)) {
      if (!isAccountMappingKey(key)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `Kunci pengaturan tidak dikenal: ${key}`,
        });
      }
    }
  });

/** POST /finance/accounting/settings — one contract for the API and the portal. */
export const updateAccountingSettingsSchema = z
  .object({
    unitId: z.string().uuid().optional(),
    settings: accountMappingsSchema,
  })
  .strict();

export type UpdateAccountingSettingsInput = z.infer<
  typeof updateAccountingSettingsSchema
>;

export interface AccountingSettingsData {
  mappings: Record<string, string | null>;
  invalidKeys: string[];
}
