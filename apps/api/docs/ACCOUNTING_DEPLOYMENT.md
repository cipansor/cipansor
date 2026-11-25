# Accounting Integration — Deployment Notes

The Canteen module posts automated double-entry journal entries (Revenue,
COGS, Inventory) on every sale, refund and cancellation. These entries are
**best-effort** and are intentionally decoupled from the business
transaction so that the POS remains operational regardless of the accounting
configuration.

## Graceful Degradation

Journal entries are **skipped with a warning log** (not failed) when:

1. The financial period covering the transaction date is **closed**
   (`financial_periods.is_closed = true`). See
   `apps/api/src/modules/canteen/canteen.service.ts:607-620` (create) and
   `apps/api/src/modules/canteen/canteen.service.ts:939-952` (refund/cancel).
2. The required **account mappings are missing** for the unit
   (`sales_revenue`, `cogs`, `inventory_asset`, `cash`,
   `wallet_liability`). See
   `apps/api/src/modules/canteen/canteen.service.ts:669-678`.

In both cases the sale/refund itself completes. Reconciliation must then be
performed manually by the accounting team (e.g. via adjusting journal
entries).

## Required Configuration Before Go-Live

Account resolution for canteen (and payroll, laundry, wallet, donation,
inventory, …) journals follows a **unit-scoped** chain — see
`getAccountOrFallback` in
`apps/api/src/modules/finance/accounting-config.service.ts`:

1. An explicit Settings mapping for the unit (the operator's deliberate choice).
2. A fallback lookup of the unit's own chart of accounts by account **code**.
3. A fallback lookup of the unit's own chart of accounts by account **name**.

All three are scoped to the requesting unit: a unit can only ever resolve
`AccountCode` rows whose `unitId` equals its own id. Rows with a null `unitId`
(legacy / not yet assigned to a unit) are **never** matched by the fallback.
This means:

> **No canteen journal entries will be created for a unit until either (a)
> explicit Settings mappings are configured for it, or (b) the unit's
> `AccountCode` rows carry that unit's `unitId`.** This is the safe default and
> makes a cross-unit chart-of-accounts leak impossible.

### Setup Checklist (per unit)

1. Ensure an `AccountCode` exists for each of the following roles in the
   unit's chart of accounts:
   - Sales Revenue (typical code `4101`)
   - Cost of Goods Sold (typical code `5101`)
   - Inventory Asset (typical code `1104`)
   - Cash (typical code `1101`)
   - Wallet Liability (typical code `2101`)
2. Create entries in the `settings` table (via the admin UI or seed script)
   mapping each of these to the correct `AccountCode.id`. The mapping keys
   are defined in `@cipansor/shared` as `ACCOUNT_MAPPING_KEYS`. Every mapping
   has a required account type (`ACCOUNT_MAPPING_EXPECTED_TYPES`): cash and
   bank are `ASSET`, sales/laundry revenue are `REVENUE`, COGS and payroll
   expense are `EXPENSE`, inventory is `ASSET`, and PPh 21, accounts payable
   and wallet liability are `LIABILITY`. A save with the wrong type is refused,
   and a stored row of the wrong type is reported in `invalidKeys` and skipped
   by the journals.
3. If the unit operates **multiple Business Units** (e.g. two canteens),
   create BU-specific mappings using the key prefix
   `BU_{businessUnitId}_{ACCOUNT_MAPPING_KEY}`. Only the keys the journals
   actually read with that prefix are accepted: `SALES_REVENUE`,
   `INVENTORY_ASSET`, `COGS` (canteen) and `LAUNDRY_REVENUE` (laundry). The
   business unit must belong to the unit being configured, and the account
   must be active, of the type the slot requires, and owned by that unit (or
   shared). A canteen sale with a business unit reads its BU-specific
   `INVENTORY_ASSET` mapping, then the code/name fallback — never the unit-level
   "Aset Inventaris" slot, which is for office purchases. Sales and COGS may
   still fall back to their unit-level mapping. Laundry still accepts the
   unit-level `LAUNDRY_REVENUE` fallback. See
   `apps/api/src/modules/canteen/canteen.service.ts:735`.
4. Ensure the financial period covering the expected first sale date is
   **open** (`is_closed = false`).

### Monitoring After Go-Live

Grep application logs for the prefix `[Canteen Accounting]` to surface any
skipped journal entries. Expected patterns:

- `Skipping journal entries for transaction ${transactionNo} — financial
period for ${date} is closed (unit ${unitId}).`
- `Skipping journal entries for transaction ${transactionNo} — missing
account mappings …`
- `Skipping reversing journal entries for transaction ${transactionNo} —
financial period for ${date} is closed (unit ${unitId}).`

Any of these warnings indicates a reconciliation gap that must be closed
manually.

## Assigning a Chart of Accounts to a Unit

The old unscoped env-flag fallback (`ACCOUNTING_ALLOW_UNSCOPED_FALLBACK`) has
been **removed**. Instead, `AccountCode.unitId` records which unit owns each
account, and the code/name fallback is scoped to it. To let a unit's canteen
(or other module) post journals via the fallback without configuring a Settings
mapping per key, set `unitId` on that unit's chart of accounts:

- **New accounts:** create them with `unitId` set to the owning unit.
- **Existing (legacy, `unitId = null`) accounts:** assign them to a unit before
  relying on the fallback, e.g.
  `UPDATE account_codes SET unit_id = '<unitId>' WHERE …`.

Because the fallback matches only rows whose `unitId` equals the requesting
unit, this is safe in multi-unit deployments — no configuration can bind a unit
to another unit's accounts. For explicit control, prefer per-unit Settings
mappings (step 1 above); they always win over the code/name fallback.
