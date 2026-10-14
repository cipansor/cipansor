import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { generateBulkSppInvoices } from '@/modules/finance/finance.service';
import { wibMonthYear } from '@/utils/wib-day';

/**
 * Run Monthly Auto-Billing for all recurring PaymentTypes (e.g., SPP)
 */
export async function runMonthlyAutoBilling(at: Date = new Date()): Promise<void> {
  logger.info('[AutoBilling] Starting monthly auto-billing process...');
  const startTime = Date.now();

  try {
    // Target the WIB calendar month, not the server's. The cron fires at 04:00
    // WIB on the 1st, when a UTC server still reads the previous month (and, in
    // January, the previous year).
    const { year, month } = wibMonthYear(at); // month is 0-11

    // Fetch all active recurring payment types across all units
    const recurringPaymentTypes = await prisma.paymentType.findMany({
      where: {
        isRecurring: true,
        isActive: true,
      },
      include: {
        unit: { select: { name: true } },
      },
    });

    logger.info(
      `[AutoBilling] Found ${recurringPaymentTypes.length} active recurring payment types.`
    );

    let totalCreated = 0;
    let totalSkipped = 0;

    for (const paymentType of recurringPaymentTypes) {
      logger.info(
        `[AutoBilling] Processing ${paymentType.name} for unit ${paymentType.unit.name}...`
      );

      try {
        const result = await generateBulkSppInvoices({
          unitId: paymentType.unitId,
          paymentTypeId: paymentType.id,
          year,
          month,
          dueDay: 10, // Default due date on the 10th
          at, // number the invoices from the billed month, not the wall clock
        });

        totalCreated += result.created;
        totalSkipped += result.skipped;

        logger.info(
          `[AutoBilling] Completed processing ${paymentType.name}: ${result.created} invoices created, ${result.skipped} skipped.`
        );
      } catch (err) {
        logger.error(
          `[AutoBilling] Error processing ${paymentType.name} (Unit: ${paymentType.unitId}):`,
          err
        );
      }
    }

    const duration = Date.now() - startTime;
    logger.info(
      `[AutoBilling] Auto-billing process completed in ${duration}ms. Invoices Created: ${totalCreated}, Skipped: ${totalSkipped}.`
    );
  } catch (error) {
    logger.error('[AutoBilling] Critical crash in auto-billing process:', error);
  }
}
