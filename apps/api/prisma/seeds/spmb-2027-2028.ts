/**
 * Load SPMB 2027/2028 from the brochure into a database that already has its
 * units: per unit one period with the four waves, the fee table, the
 * requirements and the minimum age (`spmb-2027-2028.data.ts`).
 *
 * Decided 2026-10-02 / 2026-10-03 (decisions/spmb-2027-2028.md): the brochure
 * is loaded by this script — run on staging, and on production with a release
 * — rather than typed in by hand (some 320 values; keyed once, about one in a
 * hundred goes wrong). Each unit's admin then owns the period: the contact,
 * the real wave quotas, and any change.
 *
 * - **Same rules as the portal.** Every period, wave and fee table is checked
 *   with the schemas the API checks a form with, and dates become WIB day
 *   bounds the way the services make them.
 * - **Once per environment.** A unit whose period already exists is left
 *   alone, so an admin's later edit is never overwritten; `update: true`
 *   lays the brochure over it again (contact and quotas still untouched).
 * - **One intake per unit and year.** Other active periods of the unit for
 *   2027/2028 — the demo package's "SPMB 2027/2028 Gelombang 1/2" — are
 *   deactivated, not deleted: their registrants stay where they are.
 */
import { Prisma, type PrismaClient, type UnitType, type WaveStatus } from '@prisma/client';
import {
  admissionWaveDateIssues,
  createAdmissionPeriodSchema,
  createAdmissionWaveSchema,
  replaceAdmissionFeesSchema,
} from '../../../../packages/shared/src/schemas/admissions';
import { academicYearStarting } from '../../src/lib/academic-calendar';
import { calendarDate, wibDayEnd, wibDayStart } from '../../src/utils/wib';
import {
  BROCHURE_INTAKES,
  BROCHURE_REGISTRATION,
  BROCHURE_REGISTRATION_FEE,
  BROCHURE_START_YEAR,
  BROCHURE_WAVES,
  type BrochureUnit,
} from './spmb-2027-2028.data';

/**
 * The brochure gives no quota ("kuota terbatas"), and a wave needs one: it is
 * the cap a registration claims a slot under. 999 is no cap in practice, and
 * the note tells the unit's admin to set the real one.
 */
export const BROCHURE_WAVE_QUOTA = 999;
export const BROCHURE_WAVE_NOTE =
  'Kuota belum ditetapkan unit (brosur: "kuota terbatas"). Isi kuota sebenarnya.';

/** A placeholder id, only so the create schemas can check the other fields. */
const SOME_ID = '00000000-0000-4000-8000-000000000000';

export interface BrochureLoadResult {
  unit: BrochureUnit;
  period: string;
  action: 'created' | 'updated' | 'skipped';
  /** Other active 2027/2028 periods of the unit, now inactive. */
  deactivated: string[];
}

export function statusByDates(start: Date, end: Date, now: Date): WaveStatus {
  if (now < start) return 'UPCOMING';
  if (now > end) return 'CLOSED';
  return 'OPEN';
}

/** Throws on the first figure the portal's own form would refuse. */
export function checkBrochure(): void {
  for (const [unit, intake] of Object.entries(BROCHURE_INTAKES)) {
    createAdmissionPeriodSchema.parse({
      unitId: SOME_ID,
      academicYearId: SOME_ID,
      name: `SPMB 2027/2028 ${intake.label}`,
      ...BROCHURE_REGISTRATION,
      registrationFee: BROCHURE_REGISTRATION_FEE,
      requirements: intake.requirements,
      minAgeMonths: intake.minAgeMonths,
    });
    replaceAdmissionFeesSchema.parse({ items: intake.fees });
    for (const w of BROCHURE_WAVES) {
      createAdmissionWaveSchema.parse({
        periodId: SOME_ID,
        ...w,
        fullPaymentDiscount: intake.discounts ? w.fullPaymentDiscount : null,
        quota: BROCHURE_WAVE_QUOTA,
        notes: BROCHURE_WAVE_NOTE,
      });
      if (
        w.startDate < BROCHURE_REGISTRATION.startDate ||
        w.endDate > BROCHURE_REGISTRATION.endDate
      ) {
        throw new Error(`${unit} ${w.name}: outside the registration window`);
      }
      const issues = admissionWaveDateIssues(w);
      if (issues.length) throw new Error(`${unit} ${w.name}: ${issues[0].message}`);
    }
  }
}

export async function loadSpmb20272028(
  db: PrismaClient,
  { update = false, now = new Date() }: { update?: boolean; now?: Date } = {}
): Promise<BrochureLoadResult[]> {
  checkBrochure();

  const spec = academicYearStarting(BROCHURE_START_YEAR);
  const year =
    (await db.academicYear.findUnique({ where: { name: spec.name } })) ??
    (await db.academicYear.create({
      data: { name: spec.name, startDate: spec.startDate, endDate: spec.endDate, isActive: false },
    }));

  const types = Object.keys(BROCHURE_INTAKES) as BrochureUnit[];
  const units = await db.unit.findMany({
    where: { type: { in: types as UnitType[] }, deletedAt: null },
    select: { id: true, type: true },
  });
  for (const type of types) {
    const count = units.filter((u) => u.type === type).length;
    if (count !== 1) {
      throw new Error(`Expected one active ${type} unit, found ${count}`);
    }
  }

  const results: BrochureLoadResult[] = [];
  for (const type of types) {
    const intake = BROCHURE_INTAKES[type];
    const unitId = units.find((u) => u.type === type)!.id;
    const name = `SPMB ${spec.name} ${intake.label}`;

    const result = await db.$transaction(async (tx) => {
      const existing = await tx.admissionPeriod.findFirst({
        where: { unitId, academicYearId: year.id, name },
        select: { id: true },
      });
      if (existing && !update) {
        return { unit: type, period: name, action: 'skipped' as const, deactivated: [] };
      }

      const fields = {
        startDate: wibDayStart(BROCHURE_REGISTRATION.startDate),
        endDate: wibDayEnd(BROCHURE_REGISTRATION.endDate),
        registrationFee: new Prisma.Decimal(BROCHURE_REGISTRATION_FEE),
        requirements: intake.requirements,
        minAgeMonths: intake.minAgeMonths,
        isActive: true,
      };
      const period = existing
        ? await tx.admissionPeriod.update({ where: { id: existing.id }, data: fields })
        : await tx.admissionPeriod.create({
            data: { unitId, academicYearId: year.id, name, ...fields },
          });

      for (const w of BROCHURE_WAVES) {
        const startDate = wibDayStart(w.startDate);
        const endDate = wibDayEnd(w.endDate);
        const dates = {
          name: w.name,
          startDate,
          endDate,
          testStartDate: calendarDate(w.testStartDate) ?? null,
          testEndDate: calendarDate(w.testEndDate) ?? null,
          resultsStartDate: calendarDate(w.resultsStartDate) ?? null,
          resultsEndDate: calendarDate(w.resultsEndDate) ?? null,
          reRegistrationStartDate: calendarDate(w.reRegistrationStartDate) ?? null,
          reRegistrationEndDate: calendarDate(w.reRegistrationEndDate) ?? null,
          fullPaymentDiscount:
            intake.discounts && w.fullPaymentDiscount !== null
              ? new Prisma.Decimal(w.fullPaymentDiscount)
              : null,
        };
        const current = await tx.admissionWave.findUnique({
          where: { periodId_waveNumber: { periodId: period.id, waveNumber: w.waveNumber } },
          select: { id: true, status: true },
        });
        if (current) {
          // An admin's early close (FULL, CLOSED) stands; otherwise the dates decide.
          const byAdmin = current.status === 'FULL' || current.status === 'CLOSED';
          await tx.admissionWave.update({
            where: { id: current.id },
            data: {
              ...dates,
              ...(byAdmin ? {} : { status: statusByDates(startDate, endDate, now) }),
            },
          });
        } else {
          await tx.admissionWave.create({
            data: {
              periodId: period.id,
              waveNumber: w.waveNumber,
              ...dates,
              quota: BROCHURE_WAVE_QUOTA,
              notes: BROCHURE_WAVE_NOTE,
              status: statusByDates(startDate, endDate, now),
            },
          });
        }
      }

      await tx.admissionFeeItem.deleteMany({ where: { periodId: period.id } });
      await tx.admissionFeeItem.createMany({
        data: intake.fees.map((fee, sortOrder) => ({
          periodId: period.id,
          sortOrder,
          label: fee.label,
          maleAmount: new Prisma.Decimal(fee.maleAmount),
          femaleAmount: new Prisma.Decimal(fee.femaleAmount),
          residency: fee.residency,
          isMonthly: fee.isMonthly,
        })),
      });

      const others = await tx.admissionPeriod.findMany({
        where: { unitId, academicYearId: year.id, isActive: true, id: { not: period.id } },
        select: { id: true, name: true },
      });
      if (others.length) {
        await tx.admissionPeriod.updateMany({
          where: { id: { in: others.map((o) => o.id) } },
          data: { isActive: false },
        });
      }

      return {
        unit: type,
        period: name,
        action: existing ? ('updated' as const) : ('created' as const),
        deactivated: others.map((o) => o.name),
      };
    });
    results.push(result);
  }
  return results;
}
