/** A month's slice of the verified-donation report, bucketed on the WIB calendar. */
export interface DonationMonthlyReportMonth {
  /** 1–12, as the report labels it. */
  month: number;
  monthName: string;
  total: number;
  /** Verified amount per donation type, keyed by the Prisma type code. */
  byType: Record<string, number>;
}

/** `GET /api/donation/monthly-report` — verified donations per WIB month. */
export interface DonationMonthlyReport {
  year: number;
  months: DonationMonthlyReportMonth[];
  yearTotal: number;
}
