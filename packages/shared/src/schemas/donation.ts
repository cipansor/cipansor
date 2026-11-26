import { z } from "zod";

/**
 * What a new donation may be given as — on the public Wakaf & Infaq form and
 * when staff record one.
 *
 * Zakat is not among them. Only BAZNAS, a licensed LAZ or a UPZ that BAZNAS
 * forms may collect zakat (UU 23/2011 Pasal 38 and 41), and the yayasan's own
 * site offers wakaf, scholarships and infaq but no zakat. The user's rule of
 * 2026-09-27: offer what the yayasan itself offers, until its zakat status is
 * known (`.claude/memory/decisions/istilah-dan-penamaan.md` §7). The types stay
 * in Prisma's `PublicDonationType`, so donations recorded before still read and
 * filter by their type.
 */
export const OFFERED_DONATION_TYPES = [
  "INFAK",
  "INFAK_BULANAN",
  "WAKAF",
  "SEDEKAH_JARIYAH",
  "PEMBANGUNAN",
  "BEASISWA",
  "OTHERS",
] as const;
export type OfferedDonationType = (typeof OFFERED_DONATION_TYPES)[number];

export const offeredDonationTypeSchema = z.enum(OFFERED_DONATION_TYPES, {
  message: "Jenis donasi ini tidak diterima",
});

/** One month of `GET /api/donation/monthly-report`, bucketed on the WIB calendar. */
export const donationMonthlyReportMonthSchema = z.object({
  month: z.number().int().min(1).max(12),
  monthName: z.string(),
  total: z.number().nonnegative(),
  byType: z.record(z.string(), z.number().nonnegative()),
});

/** `GET /api/donation/monthly-report` — verified donations per WIB month. */
export const donationMonthlyReportSchema = z.object({
  year: z.number().int(),
  months: z.array(donationMonthlyReportMonthSchema),
  yearTotal: z.number().nonnegative(),
});

export type DonationMonthlyReportMonth = z.infer<
  typeof donationMonthlyReportMonthSchema
>;
export type DonationMonthlyReport = z.infer<typeof donationMonthlyReportSchema>;
