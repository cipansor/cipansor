import { prisma } from '../lib/prisma';
import { AssetStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { wibMonthYear } from '../utils/wib-day';

// Use same ID as in seed.ts
const SYSTEM_USER_UUID = '00000000-0000-0000-0000-000000000000';

export async function runMonthlyDepreciation(unitId?: string, executorId?: string) {
  console.log(`[DepreciationJob] Starting for unit: ${unitId || 'ALL'}`);

  // Use executorId if provided (API trigger), otherwise fallback to SYSTEM_USER_UUID (cron/automated)
  const createdById = executorId || SYSTEM_USER_UUID;

  // 1. Get Units to process
  const units = await prisma.unit.findMany({
    where: unitId ? { id: unitId } : { deletedAt: null },
    select: { id: true, name: true },
  });

  const results = [];

  for (const unit of units) {
    try {
      // 2. Get Settings
      const settings = await prisma.setting.findMany({
        where: {
          unitId: unit.id,
          key: { in: ['DEPRECIATION_EXPENSE_ACCOUNT', 'ACCUMULATED_DEPRECIATION_ACCOUNT'] },
        },
      });

      const expenseAccount = settings.find((s) => s.key === 'DEPRECIATION_EXPENSE_ACCOUNT')
        ?.value as string;
      const accumAccount = settings.find((s) => s.key === 'ACCUMULATED_DEPRECIATION_ACCOUNT')
        ?.value as string;

      if (!expenseAccount || !accumAccount) {
        console.warn(
          `[DepreciationJob] Skipping Unit ${unit.name} (${unit.id}): Missing account settings`
        );
        results.push({ unit: unit.name, status: 'SKIPPED', reason: 'Missing Settings' });
        continue;
      }

      // 3. Get Active Assets with Value
      const assets = await prisma.asset.findMany({
        where: {
          unitId: unit.id,
          status: AssetStatus.ACTIVE,
          purchasePrice: { gt: 0 },
          usefulLife: { gt: 0 },
          purchaseDate: { not: null }, // Fix Bug 2: Ensure purchaseDate is present
          deletedAt: null,
        },
      });

      console.log(`[DepreciationJob] Found ${assets.length} assets for Unit ${unit.name}`);

      let processedCount = 0;
      let skippedCount = 0;
      const journalEntries: Prisma.JournalEntryCreateManyInput[] = [];

      const now = new Date();
      // The reference is both the period label and the idempotence key, so it
      // must follow the WIB calendar (UTC+7), like the other monthly jobs. The
      // API container sets no TZ, so `getMonth()`/`getFullYear()` read UTC: a
      // run at 00:00–06:59 WIB would stamp the month that just ended (and in
      // January the previous year) and never match the previous run's key,
      // writing the same month's journal twice.
      const { year, month } = wibMonthYear(now);
      const yearMonth = `${year}-${String(month + 1).padStart(2, '0')}`; // YYYY-MM (WIB)

      for (const asset of assets) {
        if (!asset.purchaseDate) continue; // Should be covered by query, but for type safety

        // Calculate Depreciation
        const cost = Number(asset.purchasePrice);
        const residual = Number(asset.residualValue || 0);
        const lifeMonths = asset.usefulLife || 0;
        const monthlyDepreciation = (cost - residual) / lifeMonths;

        // Skip if fully depreciated (approx). Both sides are read in the same
        // calendar: the WIB month for "now", and the UTC fields of the date-only
        // `purchaseDate` column, which stores its day at midnight UTC.
        const ageMonths =
          (year - asset.purchaseDate.getFullYear()) * 12 + (month - asset.purchaseDate.getMonth());

        if (ageMonths > lifeMonths) {
          skippedCount++;
          continue;
        }

        if (monthlyDepreciation <= 0) {
          skippedCount++;
          continue;
        }

        // Check if already run for this month
        // Reference format: DEPR-{ASSET_CODE}-{YYYY-MM}
        const reference = `DEPR-${asset.code}-${yearMonth}`;

        const existing = await prisma.journalEntry.findFirst({
          where: {
            unitId: unit.id,
            reference,
            referenceType: 'DEPRECIATION',
          },
        });

        if (existing) {
          skippedCount++;
          continue;
        }

        const description = `Depresiasi Bulan ${yearMonth} - ${asset.name} (${asset.code})`;

        // Debit Expense
        journalEntries.push({
          id: randomUUID(), // Generate UUID for consistency
          unitId: unit.id,
          accountId: expenseAccount,
          date: now,
          description,
          debit: new Prisma.Decimal(monthlyDepreciation),
          credit: new Prisma.Decimal(0),
          reference: reference, // Unique per asset per month
          referenceType: 'DEPRECIATION',
          createdById, // Fix Bug 1: Use valid user ID
        });

        // Credit Accum Depr
        journalEntries.push({
          id: randomUUID(),
          unitId: unit.id,
          accountId: accumAccount,
          date: now,
          description,
          debit: new Prisma.Decimal(0),
          credit: new Prisma.Decimal(monthlyDepreciation),
          reference: reference,
          referenceType: 'DEPRECIATION',
          createdById, // Fix Bug 1: Use valid user ID
        });

        processedCount++;
      }

      // Batch Insert (Chunk size 100) wrapped in transaction (Fix Bug 3)
      if (journalEntries.length > 0) {
        const BATCH_SIZE = 100;
        await prisma.$transaction(async (tx) => {
          for (let i = 0; i < journalEntries.length; i += BATCH_SIZE) {
            const batch = journalEntries.slice(i, i + BATCH_SIZE);
            await tx.journalEntry.createMany({
              data: batch,
            });
          }
        });
      }

      results.push({
        unit: unit.name,
        status: 'SUCCESS',
        assets: assets.length,
        processed: processedCount,
        skipped: skippedCount,
      });
    } catch (error) {
      console.error(`[DepreciationJob] Error processing unit ${unit.name}:`, error);
      results.push({ unit: unit.name, status: 'ERROR', error: String(error) });
    }
  }

  return results;
}
