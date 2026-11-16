/**
 * A unit's demo intake, for the base seed (seed.ts) and the presentation pack:
 * one period, as the module has it, with two waves placed around today —
 * wave 1 open, wave 2 still ahead (`admissionWindows`) — so a database seeded
 * on any day has a registration a visitor can complete.
 *
 * The fee table, the requirements and the minimum age are the brochure's
 * (spmb-2027-2028.data.ts); only the dates, the sessions after each wave and
 * the quotas are made up.
 *
 * The name ends in "(contoh)" on purpose. The brochure loader skips a unit
 * whose "SPMB 2027/2028 <unit>" period exists, so a demo period under that
 * name would leave a reseeded staging on demo dates; under its own name the
 * loader sets it aside like any other period of the year.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  createAdmissionPeriodSchema,
  createAdmissionWaveSchema,
} from '../../../../packages/shared/src/schemas/admissions';
import { admissionWindows } from '../../src/lib/academic-calendar';
import { calendarDate, calendarDayOf, wibDayEnd, wibDayStart } from '../../src/utils/wib';
import { statusByDates } from './spmb-2027-2028';
import {
  BROCHURE_INTAKES,
  BROCHURE_REGISTRATION_FEE,
  BROCHURE_WAVES,
  type BrochureUnit,
} from './spmb-2027-2028.data';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A placeholder id, only so the create schemas can check the other fields. */
const SOME_ID = '00000000-0000-4000-8000-000000000000';

export function demoIntakeName(intakeName: string, unit: BrochureUnit): string {
  return `SPMB ${intakeName} ${BROCHURE_INTAKES[unit].label} (contoh)`;
}

/** `day` moved by `days`, both as a date input shows them. */
function shift(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The two waves as the portal's form would send them. Sessions follow the
 * brochure's wave 1, counted from the day registration closes: the test from
 * that day for six days, results the two days after, then a week of
 * re-registration.
 */
function demoWaves(unit: BrochureUnit, quotas: [number, number], now: Date) {
  return admissionWindows(now).map((win, i) => {
    const closes = calendarDayOf(win.endDate)!;
    const discount = BROCHURE_WAVES[i].fullPaymentDiscount;
    return {
      waveNumber: i + 1,
      name: `Gelombang ${i + 1}`,
      startDate: calendarDayOf(win.startDate)!,
      endDate: closes,
      quota: quotas[i],
      testStartDate: closes,
      testEndDate: shift(closes, 5),
      resultsStartDate: shift(closes, 6),
      resultsEndDate: shift(closes, 7),
      reRegistrationStartDate: shift(closes, 8),
      reRegistrationEndDate: shift(closes, 14),
      fullPaymentDiscount: BROCHURE_INTAKES[unit].discounts ? discount : null,
    };
  });
}

/**
 * The unit's demo intake for `academicYear`, created once: a second call
 * returns the one already there, untouched.
 */
export async function ensureDemoIntake(
  db: PrismaClient,
  {
    unit,
    unitId,
    academicYear,
    quotas,
    now = new Date(),
  }: {
    unit: BrochureUnit;
    unitId: string;
    academicYear: { id: string; name: string };
    quotas: [number, number];
    now?: Date;
  }
) {
  const name = demoIntakeName(academicYear.name, unit);
  const include = { waves: { orderBy: { waveNumber: 'asc' as const } } };
  const existing = await db.admissionPeriod.findFirst({
    where: { unitId, academicYearId: academicYear.id, name },
    include,
  });
  if (existing) return existing;

  const intake = BROCHURE_INTAKES[unit];
  const waves = demoWaves(unit, quotas, now);
  const period = createAdmissionPeriodSchema.parse({
    unitId: SOME_ID,
    academicYearId: SOME_ID,
    name,
    startDate: waves[0].startDate,
    endDate: waves[waves.length - 1].endDate,
    quota: quotas[0] + quotas[1],
    registrationFee: BROCHURE_REGISTRATION_FEE,
    requirements: intake.requirements,
    minAgeMonths: intake.minAgeMonths,
  });
  for (const w of waves) createAdmissionWaveSchema.parse({ periodId: SOME_ID, ...w });

  return db.admissionPeriod.create({
    data: {
      unitId,
      academicYearId: academicYear.id,
      name,
      startDate: wibDayStart(period.startDate),
      endDate: wibDayEnd(period.endDate),
      quota: period.quota,
      registrationFee: new Prisma.Decimal(BROCHURE_REGISTRATION_FEE),
      requirements: intake.requirements,
      minAgeMonths: intake.minAgeMonths,
      isActive: true,
      waves: {
        create: waves.map((w) => {
          const startDate = wibDayStart(w.startDate);
          const endDate = wibDayEnd(w.endDate);
          return {
            waveNumber: w.waveNumber,
            name: w.name,
            startDate,
            endDate,
            quota: w.quota,
            status: statusByDates(startDate, endDate, now),
            testStartDate: calendarDate(w.testStartDate),
            testEndDate: calendarDate(w.testEndDate),
            resultsStartDate: calendarDate(w.resultsStartDate),
            resultsEndDate: calendarDate(w.resultsEndDate),
            reRegistrationStartDate: calendarDate(w.reRegistrationStartDate),
            reRegistrationEndDate: calendarDate(w.reRegistrationEndDate),
            fullPaymentDiscount:
              w.fullPaymentDiscount === null ? null : new Prisma.Decimal(w.fullPaymentDiscount),
          };
        }),
      },
      feeItems: {
        create: intake.fees.map((fee, sortOrder) => ({
          sortOrder,
          label: fee.label,
          maleAmount: new Prisma.Decimal(fee.maleAmount),
          femaleAmount: new Prisma.Decimal(fee.femaleAmount),
          residency: fee.residency,
          isMonthly: fee.isMonthly,
        })),
      },
    },
    include,
  });
}
