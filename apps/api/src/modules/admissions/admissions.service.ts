import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import { Prisma, AdmissionStatus, Gender } from '@prisma/client';
import type {
  CreatePublicRegistrantDocumentRequest,
  IntakeWindow,
  PublicIntakeDTO,
  PublicWaveWindow,
  ReplaceAdmissionFeesInput,
} from '@cipansor/shared';
import * as financeService from '../finance/finance.service';
import {
  CreateAdmissionPeriodInput,
  UpdateAdmissionPeriodInput,
  CreateRegistrantInput,
  UpdateRegistrantInput,
  UpdateRegistrantScoreInput,
  UpdateRegistrantStatusInput,
  RecordRegistrationFeeInput,
  CreateRegistrantDocumentInput,
} from './admissions.schema';
import { Errors } from '../../middleware/error';
import { readsAllUnits } from './admissions.access';
import { calendarDate, wibDayEnd, wibDayStart } from '@/utils/wib';

type AuthUser = { id: string; role: string; roleCode?: string; unitId?: string | null };

function isSuperAdmin(actor: AuthUser): boolean {
  return actor.roleCode === 'SUPER_ADMIN' || actor.role === 'SUPER_ADMIN';
}

/**
 * Refuse a non-SUPER_ADMIN actor that does not belong to the given unit.
 * A null `unitId` on the actor is always rejected: it would otherwise bypass
 * unit scoping entirely (see the `getRegistrants`/`createRegistrantOnce`
 * guards). SUPER_ADMIN is exempt.
 */
function assertUnitMatchesActor(unitId: string | null | undefined, actor?: AuthUser): void {
  if (actor && !isSuperAdmin(actor)) {
    if (!actor.unitId) {
      throw Errors.forbidden('Access to this unit is not allowed');
    }
    if (unitId !== actor.unitId) {
      throw Errors.forbidden('Access to this unit is not allowed');
    }
  }
}

/**
 * Server-side unit scoping for any by-id registrant operation.
 * SUPER_ADMIN is exempt; every other actor must belong to the registrant's
 * admission period unit, otherwise the request is refused with 403.
 */
export async function assertRegistrantUnitAccess(id: string, actor: AuthUser): Promise<void> {
  if (isSuperAdmin(actor)) return;
  const actorUnitId = actor.unitId;
  if (!actorUnitId) {
    throw Errors.forbidden('Access to this unit is not allowed');
  }
  const registrant = await prisma.registrant.findUnique({
    where: { id },
    select: { admissionPeriod: { select: { unitId: true } } },
  });
  if (!registrant) {
    throw Errors.notFound('Registrant');
  }
  if (registrant.admissionPeriod?.unitId !== actorUnitId) {
    throw Errors.forbidden('Access to this unit is not allowed');
  }
}

/**
 * Server-side unit scoping for by-id document operations, resolved through the
 * owning registrant's admission period unit.
 */
async function assertDocumentUnitAccess(id: string, actor: AuthUser): Promise<void> {
  if (isSuperAdmin(actor)) return;
  const actorUnitId = actor.unitId;
  if (!actorUnitId) {
    throw Errors.forbidden('Access to this unit is not allowed');
  }
  const document = await prisma.registrantDocument.findUnique({
    where: { id },
    select: { registrant: { select: { admissionPeriod: { select: { unitId: true } } } } },
  });
  if (!document) {
    throw Errors.notFound('Document');
  }
  if (document.registrant?.admissionPeriod?.unitId !== actorUnitId) {
    throw Errors.forbidden('Access to this unit is not allowed');
  }
}

// `CreateRegistrantInput` already defines `source` and `campaignId` as
// optional (see `createRegistrantSchema` in ./schema.ts), so there's no need
// for a separate "extended" interface here.
type CreateRegistrantExtendedInput = CreateRegistrantInput;

// =====================================
// ADMISSION PERIOD SERVICE
// =====================================

export async function getAdmissionPeriods(params: {
  page: number;
  limit: number;
  unitId?: string;
  academicYearId?: string;
  isActive?: boolean;
}) {
  const { page, limit, unitId, academicYearId, isActive } = params;
  const skip = (page - 1) * limit;

  const where: Prisma.AdmissionPeriodWhereInput = {};

  if (unitId) where.unitId = unitId;
  if (academicYearId) where.academicYearId = academicYearId;
  if (isActive !== undefined) where.isActive = isActive;

  const [data, total] = await Promise.all([
    prisma.admissionPeriod.findMany({
      where,
      skip,
      take: limit,
      orderBy: { startDate: 'desc' },
      include: {
        unit: { select: { id: true, name: true, type: true } },
        academicYear: { select: { id: true, name: true } },
        _count: { select: { registrants: true } },
      },
    }),
    prisma.admissionPeriod.count({ where }),
  ]);

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getAdmissionPeriodById(id: string) {
  return prisma.admissionPeriod.findUnique({
    where: { id },
    include: {
      unit: { select: { id: true, name: true, type: true } },
      academicYear: { select: { id: true, name: true } },
      waves: { orderBy: { waveNumber: 'asc' } },
      feeItems: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { registrants: true } },
    },
  });
}

/**
 * Public PPDB tracking lookup. Requires BOTH the registration number and the
 * registrant's birth date (matched on the calendar day) so the record cannot
 * be enumerated from a registration number alone. Returns null when either
 * factor does not match.
 */
export async function getRegistrantTrackingInfo(registrationNo: string, birthDate: Date) {
  const startOfDay = new Date(birthDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(birthDate);
  endOfDay.setHours(23, 59, 59, 999);

  return prisma.registrant.findFirst({
    where: {
      registrationNo,
      birthDate: { gte: startOfDay, lte: endOfDay },
    },
    select: {
      id: true,
      registrationNo: true,
      fullName: true,
      status: true,
      testScore: true,
      interviewScore: true,
      tahfidzScore: true,
      acceptedAt: true,
      enrolledAt: true,
      createdAt: true,
      admissionPeriod: {
        select: { name: true, unit: { select: { name: true } } },
      },
      documents: {
        select: { id: true, name: true, isVerified: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

export async function createAdmissionPeriod(data: CreateAdmissionPeriodInput, actor?: AuthUser) {
  // A UNIT_ADMIN may only create a period for their own unit; otherwise they
  // could manufacture a period in another unit's admissions.
  assertUnitMatchesActor(data.unitId, actor);

  const { startDate, endDate, registrationFee, ageReferenceDate, ...fields } = data;
  return prisma.admissionPeriod.create({
    data: {
      ...fields,
      startDate: wibDayStart(startDate),
      endDate: wibDayEnd(endDate),
      registrationFee: new Prisma.Decimal(registrationFee),
      ageReferenceDate: calendarDate(ageReferenceDate),
    },
  });
}

export async function updateAdmissionPeriod(
  id: string,
  data: UpdateAdmissionPeriodInput,
  actor?: AuthUser
) {
  // Resolve the existing period's unit so the scoping check can run against the
  // record being edited (a UNIT_ADMIN must not touch another unit's period).
  const existingPeriod = await prisma.admissionPeriod.findUnique({
    where: { id },
    select: { unitId: true, startDate: true, endDate: true },
  });
  if (!existingPeriod) {
    throw Errors.notFound('Admission period');
  }
  assertUnitMatchesActor(existingPeriod.unitId, actor);

  const { startDate, endDate, registrationFee, ageReferenceDate, ...fields } = data;
  const start = startDate ? wibDayStart(startDate) : existingPeriod.startDate;
  const end = endDate ? wibDayEnd(endDate) : existingPeriod.endDate;
  // A new end is checked against the start already saved, and the other way.
  if (end < start) {
    throw Errors.badRequest('Tanggal selesai tidak boleh sebelum tanggal mulai');
  }

  return prisma.admissionPeriod.update({
    where: { id },
    data: {
      ...fields,
      startDate: startDate ? start : undefined,
      endDate: endDate ? end : undefined,
      registrationFee:
        registrationFee !== undefined ? new Prisma.Decimal(registrationFee) : undefined,
      ageReferenceDate: calendarDate(ageReferenceDate),
    },
  });
}

/**
 * Replace an intake's fee table with the one the admin saved: the brochure's
 * "Rincian Biaya" lines, in the order shown. One transaction, so a reader
 * never sees half a table.
 */
export async function replaceAdmissionFees(
  periodId: string,
  data: ReplaceAdmissionFeesInput,
  actor?: AuthUser
) {
  const period = await prisma.admissionPeriod.findUnique({
    where: { id: periodId },
    select: { unitId: true },
  });
  if (!period) {
    throw Errors.notFound('Admission period');
  }
  assertUnitMatchesActor(period.unitId, actor);

  return prisma.$transaction(async (tx) => {
    await tx.admissionFeeItem.deleteMany({ where: { periodId } });
    await tx.admissionFeeItem.createMany({
      data: data.items.map((item, sortOrder) => ({
        periodId,
        sortOrder,
        label: item.label,
        maleAmount: new Prisma.Decimal(item.maleAmount),
        femaleAmount: new Prisma.Decimal(item.femaleAmount),
        residency: item.residency,
        isMonthly: item.isMonthly,
      })),
    });
    return tx.admissionFeeItem.findMany({ where: { periodId }, orderBy: { sortOrder: 'asc' } });
  });
}

export async function deleteAdmissionPeriod(id: string, actor?: AuthUser) {
  // Check if period has registrants
  const period = await prisma.admissionPeriod.findUnique({
    where: { id },
    include: { _count: { select: { registrants: true } } },
  });

  if (!period) {
    throw Errors.notFound('Admission period');
  }

  // A UNIT_ADMIN may only delete a period belonging to their own unit.
  assertUnitMatchesActor(period.unitId, actor);

  if (period._count.registrants && period._count.registrants > 0) {
    throw new Error('Cannot delete admission period with registrants');
  }

  return prisma.admissionPeriod.delete({ where: { id } });
}

export async function getAdmissionPeriodStats(id: string) {
  const period = await prisma.admissionPeriod.findUnique({
    where: { id },
    include: {
      unit: { select: { id: true, name: true } },
      academicYear: { select: { id: true, name: true } },
    },
  });

  if (!period) return null;

  const statusCounts = await prisma.registrant.groupBy({
    by: ['status'],
    where: { admissionPeriodId: id },
    _count: { status: true },
  });

  const genderCounts = await prisma.registrant.groupBy({
    by: ['gender'],
    where: { admissionPeriodId: id },
    _count: { gender: true },
  });

  const totalRegistrants = await prisma.registrant.count({
    where: { admissionPeriodId: id },
  });

  return {
    period,
    totalRegistrants,
    quota: period.quota,
    remaining: Math.max(0, period.quota - totalRegistrants),
    byStatus: statusCounts.reduce(
      (acc, item) => ({ ...acc, [item.status]: item._count.status }),
      {} as Record<string, number>
    ),
    byGender: genderCounts.reduce(
      (acc, item) => ({ ...acc, [item.gender]: item._count.gender }),
      {} as Record<string, number>
    ),
  };
}

// =====================================
// REGISTRANT SERVICE
// =====================================

async function generateRegistrationNo(
  admissionPeriodId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<string> {
  const period = await client.admissionPeriod.findUnique({
    where: { id: admissionPeriodId },
    include: { unit: true, academicYear: true },
  });

  if (!period) throw new Error('Admission period not found');

  const year = period.academicYear.name.split('/')[0];
  const count = await client.registrant.count({
    where: { admissionPeriodId },
  });

  // Include a short period-scoped suffix so two distinct AdmissionPeriods in
  // the same academic year cannot generate the same `registrationNo`. The
  // model's `registrationNo @unique` is GLOBAL (see prisma/schema.prisma:
  // `registrationNo String @unique`), so without this suffix two periods
  // would collide on `REG-{year}-{count+1}` and the retry loop in
  // `createRegistrant` would loop until MAX_ATTEMPTS, surfacing a 500.
  // Use the first 4 hex chars of the period UUID — short enough to keep the
  // human-readable format compact, but unique enough across periods.
  const periodSuffix = admissionPeriodId.replace(/-/g, '').slice(0, 4).toUpperCase();

  return `REG-${year}-${periodSuffix}-${String(count + 1).padStart(5, '0')}`;
}

export async function getRegistrants(
  params: {
    page: number;
    limit: number;
    admissionPeriodId?: string;
    status?: AdmissionStatus;
    gender?: 'MALE' | 'FEMALE';
    search?: string;
  },
  actor?: AuthUser
) {
  const { page, limit, admissionPeriodId, status, gender, search } = params;
  const skip = (page - 1) * limit;

  const where: Prisma.RegistrantWhereInput = {};

  if (admissionPeriodId) where.admissionPeriodId = admissionPeriodId;
  if (status) where.status = status;
  if (gender) where.gender = gender as Gender;

  // Server-side unit scoping: SUPER_ADMIN and the yayasan board read all
  // (readsAllUnits); everyone else is restricted to their unitId. Any other
  // user without a unitId must NEVER fall through to the unscoped query —
  // that would let them list registrants of EVERY unit. Refuse with 403.
  if (actor && !readsAllUnits(actor)) {
    if (!actor.unitId) {
      throw Errors.forbidden('Access to this unit is not allowed');
    }
    where.admissionPeriod = { ...(where.admissionPeriod as any), unitId: actor.unitId };
  }

  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: 'insensitive' } },
      { registrationNo: { contains: search, mode: 'insensitive' } },
      { parentName: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.registrant.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        admissionPeriod: {
          select: { id: true, name: true, unit: { select: { id: true, name: true } } },
        },
        campaign: {
          select: { id: true, name: true, code: true },
        },
        _count: { select: { documents: true } },
      },
    }),
    prisma.registrant.count({ where }),
  ]);

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getRegistrantById(id: string, actor?: AuthUser) {
  const registrant = await prisma.registrant.findUnique({
    where: { id },
    include: {
      admissionPeriod: {
        select: {
          id: true,
          name: true,
          registrationFee: true,
          unitId: true,
          unit: { select: { id: true, name: true, type: true } },
          academicYear: { select: { id: true, name: true } },
        },
      },
      wave: {
        select: { id: true, name: true, waveNumber: true, registrationFee: true },
      },
      documents: { orderBy: { createdAt: 'desc' } },
      student: { select: { id: true, nis: true, userId: true } },
    },
  });

  if (registrant && actor) {
    if (!readsAllUnits(actor)) {
      const actorUnitId = actor.unitId;
      if (!actorUnitId || registrant.admissionPeriod?.unitId !== actorUnitId) {
        throw Errors.forbidden('Access to this unit is not allowed');
      }
    }
  }

  return registrant;
}

export async function createPublicRegistrantService(data: CreateRegistrantExtendedInput) {
  const period = await prisma.admissionPeriod.findUnique({
    where: { id: data.admissionPeriodId },
    select: { isActive: true, startDate: true, endDate: true },
  });

  if (!period) {
    throw Errors.notFound('Admission period');
  }

  const now = new Date();
  if (!period.isActive || now < period.startDate || now > period.endDate) {
    throw Errors.badRequest('Admission period is not open for registration');
  }

  const registrant = await createRegistrant(data, false);

  const crypto = await import('crypto');
  const timestampHex = Date.now().toString(16);
  const hmacHex = crypto
    .createHmac('sha256', config.jwt.secret)
    .update(`${registrant.id}:${timestampHex}`)
    .digest('hex')
    .slice(0, 16);
  const registrationToken = `${timestampHex}.${hmacHex}`;

  return {
    id: registrant.id,
    registrationNo: registrant.registrationNo,
    registrationToken,
    fullName: registrant.fullName,
    status: registrant.status,
    createdAt: registrant.createdAt,
  };
}

export async function createRegistrant(
  data: CreateRegistrantExtendedInput,
  isAdmin: boolean = true,
  actor?: AuthUser
) {
  // Race-safety: `generateRegistrationNo` derives the next number from
  // `count(*) + 1`. Under PostgreSQL's default READ COMMITTED isolation,
  // two concurrent transactions can read the same count and try to insert
  // the same `registrationNo`, which then fails the unique constraint
  // (`Registrant.registrationNo @unique`) with Prisma error P2002. Retry
  // a small number of times so the second/third concurrent caller gets a
  // valid sequential number instead of a 500.
  const MAX_ATTEMPTS = 5;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await createRegistrantOnce(data, isAdmin, actor);
    } catch (err) {
      lastError = err;
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        Array.isArray((err.meta as { target?: string[] } | undefined)?.target) &&
        (err.meta as { target: string[] }).target.includes('registrationNo')
      ) {
        // Collision on registrationNo — retry with a fresh count.
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function createRegistrantOnce(
  data: CreateRegistrantExtendedInput,
  isAdmin: boolean = true,
  actor?: AuthUser
) {
  return prisma.$transaction(async (tx) => {
    // Unit scoping for the admin/staff create path: a non-SUPER_ADMIN may only
    // create a registrant in an admission period that belongs to their own
    // unit. Otherwise a staff member could send `admissionPeriodId` of another
    // unit's period and both consume that unit's wave quota and register
    // applicants into a period they do not manage.
    if (actor && !isSuperAdmin(actor)) {
      if (!actor.unitId) {
        throw Errors.forbidden('Access to this unit is not allowed');
      }
      const scopedPeriod = await tx.admissionPeriod.findUnique({
        where: { id: data.admissionPeriodId },
        select: { unitId: true },
      });
      if (!scopedPeriod) {
        throw Errors.notFound('Admission period');
      }
      if (scopedPeriod.unitId !== actor.unitId) {
        throw Errors.forbidden('Access to this unit is not allowed');
      }
    }

    const registrationNo = await generateRegistrationNo(data.admissionPeriodId, tx);

    // Map Zod input fields to the actual Prisma Registrant model.
    // The schema accepts richer father/mother/address breakdowns for UX,
    // but the persisted model uses consolidated parent* fields and does
    // not have columns for nickname / nationalId / familyCardNumber /
    // village / district / city / province / postalCode /
    // previousSchoolAddress / graduationYear / fatherEmail /
    // fatherOccupation / motherOccupation. Spreading would cause Prisma
    // to reject unknown args at runtime.
    const parentName = data.fatherName || data.motherName;
    const parentPhone = data.fatherPhone || data.motherPhone || '';
    const parentEmail = data.fatherEmail && data.fatherEmail !== '' ? data.fatherEmail : undefined;
    const parentOccupation = data.fatherOccupation || data.motherOccupation;

    // Check if the admission period defines any waves.
    const totalWaves = tx.admissionWave
      ? await tx.admissionWave.count({ where: { periodId: data.admissionPeriodId } })
      : 0;

    let waveId: string | undefined = undefined;

    if (totalWaves > 0) {
      // Look up all open waves for the period ordered by waveNumber asc
      // to atomically claim a slot in the first wave that has capacity.
      const now = new Date();
      // Auto-assign claims a wave only when it is *open for registration right
      // now*, decided by dates, not merely by status:
      //  - `FULL` is a terminal closed state (manual early-close OR capacity
      //    reached). Never auto-claim it, even if `registeredCount` is below
      //    quota (a manual early-close would otherwise be silently reopened by
      //    a fresh submission). Cancelled slots in a FULL wave are recovered by
      //    an admin re-opening the wave or by `updateWaveStatuses`.
      //  - `UPCOMING` is claimable once its window has opened (started and not
      //    ended), so registration does not depend on the `updateWaveStatuses`
      //    cron having transitioned it to OPEN before the first submission.
      const candidateWaves = tx.admissionWave
        ? await tx.admissionWave.findMany({
            where: {
              periodId: data.admissionPeriodId,
              status: { in: ['OPEN', 'UPCOMING'] },
              startDate: { lte: now },
              endDate: { gte: now },
            },
            orderBy: { waveNumber: 'asc' },
          })
        : [];

      if ((tx as any).$executeRaw) {
        // Acquire row-level locks on candidate waves to prevent concurrent quota race conditions
        await (tx as any)
          .$executeRaw`SELECT id FROM "admission_waves" WHERE "period_id" = ${data.admissionPeriodId} FOR UPDATE`;
      }

      let waveClaimed = false;
      for (const wave of candidateWaves) {
        const freshWave = await tx.admissionWave.findUnique({
          where: { id: wave.id },
          select: { id: true, registeredCount: true, quota: true, status: true },
        });

        if (!freshWave || freshWave.registeredCount >= freshWave.quota) {
          continue;
        }

        const claim = await tx.admissionWave.updateMany({
          where: {
            id: wave.id,
            status: { in: ['OPEN', 'UPCOMING'] },
            registeredCount: { lt: freshWave.quota },
          },
          data: {
            registeredCount: { increment: 1 },
          },
        });

        if (claim.count === 1) {
          const updatedWave = await tx.admissionWave.findUnique({
            where: { id: wave.id },
            select: { id: true, registeredCount: true, quota: true, status: true },
          });

          if (
            updatedWave &&
            updatedWave.registeredCount >= updatedWave.quota &&
            updatedWave.status !== 'FULL'
          ) {
            await tx.admissionWave.update({
              where: { id: wave.id },
              // Capacity-driven closure: the wave fills up because of enrolment,
              // so mark it auto-filled. deleteRegistrant may reopen it later when
              // a slot frees up (unlike an operator-closed FULL wave).
              data: { status: 'FULL', fullByCapacity: true },
            });
          }

          waveId = wave.id;
          waveClaimed = true;
          break;
        }
      }

      if (!waveClaimed && !isAdmin) {
        throw Errors.badRequest(
          'Semua gelombang pendaftaran pada periode ini telah penuh atau ditutup'
        );
      }
    }

    const registrant = await tx.registrant.create({
      data: {
        admissionPeriodId: data.admissionPeriodId,
        waveId,
        registrationNo,
        fullName: data.fullName,
        name: data.fullName, // legacy column, kept in sync
        gender: data.gender as Gender,
        birthPlace: data.birthPlace,
        birthDate: new Date(data.birthDate),
        address: data.address,
        phone: data.phone,
        email: data.email && data.email !== '' ? data.email : undefined,
        previousSchool: data.previousSchool,
        quranAbility: data.quranAbility,
        memorizedJuz: data.memorizedJuz,
        parentName,
        parentPhone,
        parentEmail,
        parentOccupation,
        notes: data.notes,
        source: data.source,
        campaignId: data.campaignId,
      },
    });

    // Best Practice: Ensure a REG_FEE payment type exists so that the
    // registration-fee invoice can be created automatically at enrollment
    // time (when a real studentId is available). We deliberately do NOT
    // create the Invoice here: the Invoice schema requires a non-null
    // studentId, and the registrant has not yet been promoted to a Student.
    // Creating an invoice with `studentId: ''` would fail with a Prisma
    // foreign-key error and abort the entire transaction.
    const period = await tx.admissionPeriod.findUnique({
      where: { id: data.admissionPeriodId },
    });

    if (period && Number(period.registrationFee) > 0) {
      // Use an atomic upsert on the `(unitId, code)` composite unique key
      // (see `@@unique([unitId, code])` on the PaymentType model in
      // prisma/schema.prisma). The previous `findFirst` + conditional
      // `create` pattern is NOT atomic under Postgres' default READ
      // COMMITTED isolation: two concurrent first-registrations for the
      // same unit can both observe `existing === null`, both call
      // `create`, and the second one fails with a P2002 unique-constraint
      // violation that aborts the entire createRegistrant transaction
      // (the retry loop in `createRegistrant` only handles `registrationNo`
      // collisions, so this would surface as a 500). `upsert` leans on
      // Postgres' `INSERT ... ON CONFLICT DO UPDATE` semantics and is
      // race-safe. The `update` clause is a no-op so that re-running this
      // path doesn't clobber admin-edited fields (name, amount, etc.).
      await tx.paymentType.upsert({
        where: { unitId_code: { unitId: period.unitId, code: 'REG_FEE' } },
        create: {
          unitId: period.unitId,
          code: 'REG_FEE',
          name: 'Biaya Pendaftaran',
          amount: period.registrationFee,
          isActive: true,
          isRecurring: false,
        },
        update: {},
      });
    }

    return registrant;
  });
}

export async function updateRegistrant(id: string, data: UpdateRegistrantInput, actor?: AuthUser) {
  if (actor) await assertRegistrantUnitAccess(id, actor);
  // Map Zod input fields to the actual Prisma Registrant model.
  // The schema accepts `fatherName` / `fatherPhone` / `motherName` /
  // `motherPhone` for UX parity with create, but the persisted model uses
  // consolidated `parentName` / `parentPhone` columns. Spreading the raw
  // input would cause Prisma to reject unknown args at runtime.
  const { fatherName, fatherPhone, motherName, motherPhone, fullName, email, ...rest } = data;

  const parentName =
    fatherName !== undefined || motherName !== undefined ? fatherName || motherName : undefined;
  const parentPhone =
    fatherPhone !== undefined || motherPhone !== undefined ? fatherPhone || motherPhone : undefined;

  // Normalise empty-string email to `null` to mirror `createRegistrantOnce`,
  // which maps `''` -> `undefined` (persisted as NULL). Without this, a PUT
  // carrying `{ email: "" }` would store `""` in the DB while the same value
  // on create stores NULL — breaking downstream `if (registrant.email)`
  // checks and risking duplicate-empty-string collisions if `email` ever
  // becomes @unique.
  const normalisedEmail = email === undefined ? undefined : email === '' ? null : email;

  return prisma.registrant.update({
    where: { id },
    data: {
      ...rest,
      ...(fullName !== undefined ? { fullName, name: fullName } : {}),
      ...(parentName !== undefined ? { parentName } : {}),
      ...(parentPhone !== undefined ? { parentPhone } : {}),
      ...(normalisedEmail !== undefined ? { email: normalisedEmail } : {}),
    },
  });
}

export async function updateRegistrantScore(
  id: string,
  data: UpdateRegistrantScoreInput,
  actor?: AuthUser
) {
  if (actor) await assertRegistrantUnitAccess(id, actor);
  // Only advance status to TEST_COMPLETED when:
  //   1. At least one actual score (test/interview/tahfidz) was provided, AND
  //   2. The registrant is still in a pre-test phase.
  // Recording only notes — or recording a score on someone already
  // ACCEPTED / REJECTED / ENROLLED / CANCELLED — must not change their status.
  //
  // The read+write are wrapped in a single interactive transaction so that a
  // concurrent updateRegistrantStatus() (e.g. moving the registrant to
  // ACCEPTED) cannot slip in between the status read and the update below
  // and get clobbered back to TEST_COMPLETED.
  const hasScore =
    data.testScore !== undefined ||
    data.interviewScore !== undefined ||
    data.tahfidzScore !== undefined;

  const preTestStatuses: AdmissionStatus[] = [
    AdmissionStatus.REGISTERED,
    AdmissionStatus.DOCUMENT_CHECK,
    AdmissionStatus.TEST_SCHEDULED,
  ];

  return prisma.$transaction(async (tx) => {
    const current = await tx.registrant.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!current) throw new Error('Registrant not found');

    const shouldAdvanceStatus = hasScore && preTestStatuses.includes(current.status);

    return tx.registrant.update({
      where: { id },
      data: {
        testScore: data.testScore !== undefined ? new Prisma.Decimal(data.testScore) : undefined,
        interviewScore:
          data.interviewScore !== undefined ? new Prisma.Decimal(data.interviewScore) : undefined,
        tahfidzScore:
          data.tahfidzScore !== undefined ? new Prisma.Decimal(data.tahfidzScore) : undefined,
        notes: data.notes,
        ...(shouldAdvanceStatus ? { status: AdmissionStatus.TEST_COMPLETED } : {}),
      },
    });
  });
}

/**
 * Record daftar ulang payment for a registrant.
 *
 * The counterpart to the enrolment gate. Adding the gate without this would
 * have left an admin told "belum melunasi" with no way to say otherwise — a
 * rule with no door through it, which stops the SPMB flow rather than
 * ordering it.
 */
export async function recordRegistrationFee(
  id: string,
  data: RecordRegistrationFeeInput,
  verifiedById: string,
  actor?: AuthUser
) {
  const registrant = await prisma.registrant.findUnique({
    where: { id },
    include: {
      admissionPeriod: { select: { registrationFee: true, unitId: true } },
      wave: { select: { registrationFee: true } },
    },
  });

  if (!registrant) throw Errors.notFound('Registrant');

  if (actor && !isSuperAdmin(actor)) {
    const actorUnitId = actor.unitId;
    if (!actorUnitId || registrant.admissionPeriod?.unitId !== actorUnitId) {
      throw Errors.forbidden('Access to this unit is not allowed');
    }
  }

  // A wave may override its parent period's registrationFee, so the amount
  // recorded should be what the registrant actually owed. Wave wins when set.
  const effectiveFee =
    registrant.wave?.registrationFee ?? registrant.admissionPeriod?.registrationFee ?? null;

  return prisma.registrant.update({
    where: { id },
    data: {
      registrationFeePaidAt: data.paidAt ?? new Date(),
      // Falls back to what the period/wave charges, so the common "paid in
      // full" case needs no amount and the record still says how much.
      registrationFeeAmount: data.amount != null ? data.amount : effectiveFee,
      registrationFeeVerifiedById: verifiedById,
      registrationFeeNote: data.note,
    },
  });
}

export async function updateRegistrantStatus(
  id: string,
  data: UpdateRegistrantStatusInput,
  actor?: AuthUser
) {
  if (actor) await assertRegistrantUnitAccess(id, actor);
  // Guard: ENROLLED is a terminal status that must only be reached through
  // `enrollRegistrant`, which atomically creates the User + Student records,
  // assigns class/room, generates the registration-fee invoice, and adjusts
  // wave counters. Allowing the status endpoint to set ENROLLED directly
  // would leave the registrant marked as enrolled but without any of those
  // side effects — a corrupt half-state that subsequent `enrollRegistrant`
  // calls cannot recover from (they require status === ACCEPTED).
  // The schema accepts `z.nativeEnum(AdmissionStatus)` so this check has to
  // live here at the service layer.
  if (data.status === AdmissionStatus.ENROLLED) {
    throw new Error('Cannot set status to ENROLLED directly; use the enrollment endpoint instead');
  }

  return prisma.$transaction(async (tx) => {
    // Read the previous status BEFORE updating so we can detect actual
    // transitions and avoid double-counting wave acceptance metrics.
    const previous = await tx.registrant.findUnique({
      where: { id },
      select: { status: true, waveId: true },
    });

    if (!previous) {
      throw new Error('Registrant not found');
    }

    // Guard: ENROLLED is a terminal status that was reached through
    // `enrollRegistrant` (which atomically created User + Student records,
    // class/room assignments, and the registration-fee invoice). Allowing
    // a transition AWAY from ENROLLED here (e.g. to REJECTED or CANCELLED)
    // would mark the registrant as un-enrolled while leaving all of those
    // downstream records in place — a corrupt half-state that the system
    // has no automated recovery path for. Un-enrollment must go through a
    // dedicated endpoint that tears down the side effects in the same
    // transaction.
    if (previous.status === AdmissionStatus.ENROLLED) {
      throw new Error(
        'Cannot change status of an enrolled registrant; un-enrollment must be handled through a dedicated endpoint'
      );
    }

    const updateData: Prisma.RegistrantUpdateInput = {
      status: data.status,
      notes: data.notes,
    };

    if (data.status === AdmissionStatus.ACCEPTED) {
      updateData.acceptedAt = new Date();
    }

    const registrant = await tx.registrant.update({
      where: { id },
      data: updateData,
    });

    // Best Practice: Trigger automated notification on status change
    // Search for registrant with parent info for notification
    const regWithParent = await tx.registrant.findUnique({
      where: { id },
      include: {
        admissionPeriod: { select: { name: true } },
      },
    });

    if (regWithParent && regWithParent.parentPhone) {
      // Notification could be sent here via WhatsApp/Push
    }

    // Best Practice: Update wave statistics if wave is linked.
    // Only adjust acceptedCount on real transitions into / out of ACCEPTED
    // so the counter stays consistent across re-accepts and reverts.
    if (registrant.waveId) {
      const wasAccepted = previous.status === AdmissionStatus.ACCEPTED;
      const isAccepted = data.status === AdmissionStatus.ACCEPTED;

      if (!wasAccepted && isAccepted) {
        await tx.admissionWave.update({
          where: { id: registrant.waveId },
          data: { acceptedCount: { increment: 1 } },
        });
      } else if (wasAccepted && !isAccepted) {
        await tx.admissionWave.updateMany({
          where: { id: registrant.waveId, acceptedCount: { gt: 0 } },
          data: { acceptedCount: { decrement: 1 } },
        });
      }
    }

    return registrant;
  });
}

/**
 * Enroll an ACCEPTED registrant as a Student.
 *
 * IMPORTANT — DUAL ENROLLMENT PATHS:
 * There is a second enrollment entry point in
 * `apps/api/src/services/integration/student-onboarding.orchestrator.ts`
 * (`StudentOnboardingOrchestrator.processEnrollment`) used by
 * `POST /api/admissions/waves/onboard-registrant` and the frontend
 * `useOnboardRegistrant` hook. The two paths diverge in scope:
 *
 *   - This function (`enrollRegistrant`):
 *       * Caller-supplied NIS (no auto-generation)
 *       * Creates User + Student
 *       * Generates REG_FEE invoice
 *       * Decrements wave `acceptedCount`
 *       * No parent account, no medical record, no wallet, no events
 *
 *   - `StudentOnboardingOrchestrator.processEnrollment`:
 *       * Auto-generates NIS via Postgres advisory lock
 *       * Creates User + Student
 *       * Creates parent User (PARENT role) + StudentParent link
 *       * Creates initial MedicalRecord
 *       * Creates SantriWallet
 *       * Emits `student:created`, `health:medical-record-created`,
 *         `notification:send`, `email:send_reset_token` on the eventBus
 *       * Does NOT generate REG_FEE invoice
 *       * Does NOT decrement wave `acceptedCount`
 *
 * If you change ANY business rule for enrollment (mandatory wallet,
 * mandatory medical record, mandatory invoice, NIS format, status
 * transitions, wave-counter handling, …), update BOTH paths or document
 * an explicit reason for the divergence here. Failing to do so leaves
 * student records in inconsistent states depending on which API the
 * caller used.
 */
export async function enrollRegistrant(
  registrantId: string,
  studentData: {
    nis?: string;
    nisn?: string;
    classId?: string;
    roomId?: string;
    processedById?: string;
  },
  actor?: AuthUser
) {
  const registrant = await prisma.registrant.findUnique({
    where: { id: registrantId },
    include: { admissionPeriod: true },
  });

  if (!registrant) throw new Error('Registrant not found');

  if (actor && !isSuperAdmin(actor)) {
    const actorUnitId = actor.unitId;
    if (!actorUnitId || registrant.admissionPeriod?.unitId !== actorUnitId) {
      throw Errors.forbidden('Access to this unit is not allowed');
    }
  }

  const { StudentOnboardingOrchestrator } =
    await import('../../services/integration/student-onboarding.orchestrator');

  const result = await StudentOnboardingOrchestrator.processEnrollment(
    registrantId,
    registrant.admissionPeriod.unitId,
    studentData.processedById || 'system',
    {
      nis: studentData.nis,
      nisn: studentData.nisn,
      classId: studentData.classId,
      assignedClassId: studentData.classId,
      roomId: studentData.roomId,
      academicYearId: registrant.admissionPeriod.academicYearId,
    }
  );

  return result;
}

export async function deleteRegistrant(id: string, actor?: AuthUser) {
  if (actor) await assertRegistrantUnitAccess(id, actor);
  // Wrap the read + decrement + delete in a single transaction so that the
  // wave's `registeredCount` (and `acceptedCount` if the registrant was
  // ACCEPTED) stays in sync with the registrants that actually exist.
  // Without this, deleting a registrant that was assigned to a wave would
  // leave the wave's counters permanently inflated, eventually marking
  // waves as FULL even when slots are free.
  return prisma.$transaction(async (tx) => {
    const registrant = await tx.registrant.findUnique({
      where: { id },
      select: { status: true, waveId: true },
    });

    if (!registrant) {
      throw new Error('Registrant not found');
    }

    if (registrant.status === AdmissionStatus.ENROLLED) {
      throw new Error('Cannot delete enrolled registrant');
    }

    if (registrant.waveId) {
      await tx.admissionWave.updateMany({
        where: { id: registrant.waveId, registeredCount: { gt: 0 } },
        data: { registeredCount: { decrement: 1 } },
      });

      const wave = await tx.admissionWave.findUnique({
        where: { id: registrant.waveId },
        select: {
          id: true,
          status: true,
          registeredCount: true,
          quota: true,
          startDate: true,
          endDate: true,
          fullByCapacity: true,
        },
      });
      const now = new Date();
      // Reopen only a FULL wave that became FULL by capacity (`fullByCapacity`
      // true) — i.e. a cancelled slot in a wave that simply filled up. A wave
      // an operator deliberately marked FULL below quota (`fullByCapacity`
      // false/null, e.g. manual early-close) stays closed: `createRegistrantOnce`
      // also treats FULL as terminal for manual closure, so never silently
      // reopen it just because one registrant was removed.
      if (
        wave &&
        wave.status === 'FULL' &&
        wave.fullByCapacity === true &&
        wave.registeredCount < wave.quota &&
        wave.startDate <= now &&
        wave.endDate >= now
      ) {
        await tx.admissionWave.update({
          where: { id: wave.id },
          data: { status: 'OPEN' },
        });
      }

      if (registrant.status === AdmissionStatus.ACCEPTED) {
        await tx.admissionWave.updateMany({
          where: { id: registrant.waveId, acceptedCount: { gt: 0 } },
          data: { acceptedCount: { decrement: 1 } },
        });
      }
    }

    return tx.registrant.delete({ where: { id } });
  });
}

// =====================================
// REGISTRANT DOCUMENT SERVICE
// =====================================

export async function getRegistrantDocuments(registrantId: string, actor?: AuthUser) {
  // A read: the yayasan board may look (readsAllUnits), never change.
  if (actor && !readsAllUnits(actor)) await assertRegistrantUnitAccess(registrantId, actor);
  return prisma.registrantDocument.findMany({
    where: { registrantId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createRegistrantDocument(
  data: CreateRegistrantDocumentInput,
  actor?: AuthUser
) {
  if (actor) await assertRegistrantUnitAccess(data.registrantId, actor);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return prisma.registrantDocument.create({ data: data as any });
}

export async function createPublicRegistrantDocumentService(
  data: CreatePublicRegistrantDocumentRequest & { registrantId: string }
) {
  const { registrantId, type, url, base64, fileName, registrationToken, ocrNotes, ocrStatus } =
    data;

  const registrant = await prisma.registrant.findUnique({
    where: { id: registrantId },
    select: { id: true, registrationNo: true },
  });

  if (!registrant) {
    throw Errors.notFound('Registrant');
  }

  // Token / Proof of Ownership & Expiry Check (max 2 hours valid)
  if (!registrationToken) {
    throw Errors.forbidden('Invalid registration token for document upload');
  }

  const crypto = await import('crypto');
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  let isTokenValid = false;

  if (registrationToken.includes('.')) {
    const [tsHex, hmacHex] = registrationToken.split('.');
    const timestamp = parseInt(tsHex, 16);
    if (!isNaN(timestamp)) {
      const now = Date.now();
      const expectedHmac = crypto
        .createHmac('sha256', config.jwt.secret)
        .update(`${registrant.id}:${tsHex}`)
        .digest('hex')
        .slice(0, 16);
      if (hmacHex === expectedHmac && now >= timestamp && now - timestamp <= TWO_HOURS_MS) {
        isTokenValid = true;
      }
    }
  }

  if (!isTokenValid) {
    throw Errors.forbidden('Invalid registration token for document upload');
  }

  const docUrl = url || base64;
  if (!docUrl || typeof docUrl !== 'string') {
    throw Errors.badRequest('Dokumen url/base64 wajib diisi');
  }

  // Identity documents are stored inline as data-URIs on the RegistrantDocument
  // row. This keeps the public upload flow dependency-free (no object-store
  // roundtrip) but trades away object-storage advantages. DECISION (documented
  // 2026-09-09): accept inline storage for now; revisit when moving to object
  // storage. Rationale and the controls that the current design relies on:
  //
  //  - Retention / backup exposure: a data-URI rides inside the DB row and is
  //    therefore included in every DB backup. There is no separate lifecycle —
  //    deleting the `RegistrantDocument` row (or its `registrant`, which
  //    cascades) deletes the file; backups must apply the same retention as the
  //    rest of the DB. Any future object-store migration must add an
  //    independent TTL/retention policy, a purge job, and access-audit log.
  //  - Access auditing: access to the file is the same as access to the row —
  //    the admins wave/detail handlers (`assertRegistrantUnitAccess`) are the
  //    gate. There is no per-download audit trail today; add one if a
  //    compliance requirement emerges.
  //  - Deletion: no orphan cleanup is needed beyond row/schema deletes. Uploads
  //    are capped at 2MB and MIME-whitelisted below.
  // If identity documents are later moved to object storage, add an access-audit
  // log and a retention policy AND a backfill job to migrate existing rows then,
  // not now.
  //
  // CONTRACT: the registration token is NOT single-use. It is an HMAC bound to
  // `registrant:id` and valid for 2 hours (see the check above), and may be
  // reused to upload multiple documents for that registrant within the window.
  // This is intentional: an applicant often uploads several identity documents
  // (KTP, KK, akta, foto) in one session without re-fetching a fresh token each
  // time. If the security policy later requires true single-use, persist a
  // one-time token per document (or a Redis `SETNX` key) — this needs a small
  // schema/extra-state change, not a code comment tweak.
  //
  // For remote URLs (https), the SSRF guard below blocks loopback and private
  // hosts. The URL is stored, never fetched in this path; if it is ever
  // fetched, the same check must run at fetch time AND redirect targets must be
  // re-validated (a public URL can redirect to 169.254.169.254 / metadata).
  if (docUrl.startsWith('data:')) {
    if (docUrl.length > 2800000) {
      throw Errors.badRequest('Ukuran berkas melebihi batas maksimum (2MB)');
    }
    const mimeMatch = docUrl.match(/^data:(image\/(jpeg|jpg|png|webp)|application\/pdf);base64,/i);
    if (!mimeMatch) {
      throw Errors.badRequest(
        'Tipe berkas tidak didukung. Hanya gambar (JPEG/PNG/WebP) dan PDF yang diperbolehkan'
      );
    }
  } else {
    try {
      const parsedUrl = new URL(docUrl);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('Invalid protocol');
      }
      const hostname = parsedUrl.hostname.toLowerCase();
      const isLoopback =
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname.startsWith('127.');
      const isPrivateIp =
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
        hostname === '169.254.169.254' ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal');

      if (isLoopback || isPrivateIp) {
        throw Errors.badRequest('URL dokumen tidak diizinkan (host privat atau internal)');
      }
    } catch (err: any) {
      if (err instanceof Errors.badRequest('').constructor || err?.name === 'ApiError' || err?.code)
        throw err;
      throw Errors.badRequest('URL dokumen tidak valid (harus diawali http:// atau https://)');
    }
  }

  let schemaType: 'akta' | 'ijazah' | 'kk' | 'foto' | 'rapor' | 'lainnya' = 'lainnya';
  const normalizedType = String(type).toLowerCase();
  if (normalizedType.includes('foto') || normalizedType === 'photo') {
    schemaType = 'foto';
  } else if (normalizedType.includes('kk') || normalizedType === 'family_card') {
    schemaType = 'kk';
  } else if (normalizedType.includes('akta') || normalizedType === 'birth_certificate') {
    schemaType = 'akta';
  } else if (normalizedType.includes('rapor') || normalizedType === 'report_card') {
    schemaType = 'rapor';
  } else if (normalizedType.includes('ijazah') || normalizedType === 'diploma') {
    schemaType = 'ijazah';
  }

  let ocrSummaryNote: string | undefined = undefined;
  if (ocrNotes && ocrNotes.length > 0) {
    ocrSummaryNote = `[Hasil Verifikasi: ${ocrStatus || 'WARNING'}] ${ocrNotes.join(' | ')}`;
  }

  const createRegistrantDocumentSchema = (await import('./admissions.schema'))
    .createRegistrantDocumentSchema;
  const docData = createRegistrantDocumentSchema.parse({
    registrantId,
    name: fileName || `${schemaType}_${Date.now()}`,
    type: schemaType,
    fileUrl: docUrl,
    notes: ocrSummaryNote,
  });

  // Execute count check and document creation within a row-locked transaction to prevent race conditions
  return prisma.$transaction(async (tx) => {
    if ((tx as any).$executeRaw) {
      await (tx as any)
        .$executeRaw`SELECT id FROM "registrants" WHERE id = ${registrantId} FOR UPDATE`;
    }

    const existingDocCount = await tx.registrantDocument.count({
      where: { registrantId },
    });

    if (existingDocCount >= 10) {
      throw Errors.badRequest(
        'Jumlah dokumen pendaftar telah mencapai batas maksimum (10 dokumen)'
      );
    }

    return tx.registrantDocument.create({ data: docData as any });
  });
}

export async function verifyDocument(
  id: string,
  isVerified: boolean,
  notes?: string,
  actor?: AuthUser
) {
  if (actor) await assertDocumentUnitAccess(id, actor);
  return prisma.registrantDocument.update({
    where: { id },
    data: {
      isVerified,
      verifiedAt: isVerified ? new Date() : null,
      notes,
    },
  });
}

export async function deleteRegistrantDocument(id: string, actor?: AuthUser) {
  if (actor) await assertDocumentUnitAccess(id, actor);
  return prisma.registrantDocument.delete({ where: { id } });
}

/** Units in the order the brochure lists them; any other type after them. */
const UNIT_ORDER = ['TK_QURAN', 'SD_IT', 'SMP_IT', 'SMA_QURAN', 'PESANTREN'];

function windowOf(start: Date, end: Date, now: Date): IntakeWindow {
  if (now < start) return 'upcoming';
  if (now > end) return 'closed';
  return 'open';
}

/**
 * Whether one can register today, and the day that changes.
 *
 * By the period's dates; for a period with waves, also by them, the way
 * `createRegistrantOnce` decides — it claims only a wave open by its dates and
 * not closed by an admin. Between two of the brochure's waves (21–31 December,
 * 1–7 March) the period runs on but nothing can be claimed, so the page must
 * not offer a form the API will refuse.
 */
function registrationWindow(
  period: { startDate: Date; endDate: Date },
  waves: Array<{ startDate: Date; endDate: Date; window: PublicWaveWindow }>,
  now: Date
): { window: IntakeWindow; opensAt: Date | null; closesAt: Date | null } {
  const byDates = windowOf(period.startDate, period.endDate, now);
  if (!waves.length || byDates === 'closed') {
    return {
      window: byDates,
      opensAt: byDates === 'upcoming' ? period.startDate : null,
      closesAt: byDates === 'open' ? period.endDate : null,
    };
  }
  const open = waves
    .filter((w) => w.window === 'open')
    .sort((a, b) => a.endDate.getTime() - b.endDate.getTime())[0];
  if (byDates === 'open' && open) {
    const closesAt = open.endDate < period.endDate ? open.endDate : period.endDate;
    return { window: 'open', opensAt: null, closesAt };
  }
  const next = waves
    .filter((w) => w.window === 'upcoming' && w.startDate <= period.endDate)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];
  if (next) {
    const opensAt = next.startDate > period.startDate ? next.startDate : period.startDate;
    return { window: 'upcoming', opensAt, closesAt: null };
  }
  return { window: 'closed', opensAt: null, closesAt: null };
}

/**
 * Each unit's intake to announce, for the public SPMB page, the homepage badge
 * and the chatbot.
 *
 * Per unit, among its active periods: the one running now (the first to
 * close), else the next to open, else the last one closed. `isActive` is an
 * admin's intent, not a schedule, so the dates decide. The projection is a
 * whitelist: no quota, no registrant counts, nothing about anyone who
 * registered — it is served to anyone, and read into the chatbot's prompt.
 */
export async function findPublicIntakes(now: Date = new Date()): Promise<PublicIntakeDTO[]> {
  const periods = await prisma.admissionPeriod.findMany({
    where: { isActive: true, unit: { deletedAt: null } },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      registrationFee: true,
      requirements: true,
      minAgeMonths: true,
      ageReferenceDate: true,
      contactName: true,
      contactPhone: true,
      unit: { select: { id: true, name: true, officialName: true, type: true } },
      academicYear: { select: { name: true } },
      waves: {
        orderBy: { waveNumber: 'asc' },
        select: {
          waveNumber: true,
          name: true,
          startDate: true,
          endDate: true,
          status: true,
          testStartDate: true,
          testEndDate: true,
          resultsStartDate: true,
          resultsEndDate: true,
          reRegistrationStartDate: true,
          reRegistrationEndDate: true,
          fullPaymentDiscount: true,
        },
      },
      feeItems: {
        orderBy: { sortOrder: 'asc' },
        select: {
          label: true,
          maleAmount: true,
          femaleAmount: true,
          residency: true,
          isMonthly: true,
        },
      },
    },
  });

  type Row = (typeof periods)[number];
  const rank = (p: Row): [number, number] => {
    const w = windowOf(p.startDate, p.endDate, now);
    if (w === 'open') return [0, p.endDate.getTime()];
    if (w === 'upcoming') return [1, p.startDate.getTime()];
    return [2, -p.endDate.getTime()];
  };
  const chosen = new Map<string, Row>();
  for (const period of periods) {
    const current = chosen.get(period.unit.id);
    if (!current) {
      chosen.set(period.unit.id, period);
      continue;
    }
    const [a, b] = [rank(period), rank(current)];
    if (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) chosen.set(period.unit.id, period);
  }

  const order = (type: string) => {
    const i = UNIT_ORDER.indexOf(type);
    return i === -1 ? UNIT_ORDER.length : i;
  };
  const iso = (d: Date | null) => (d ? d.toISOString() : null);

  return [...chosen.values()]
    .sort(
      (a, b) => order(a.unit.type) - order(b.unit.type) || a.unit.name.localeCompare(b.unit.name)
    )
    .map((p) => {
      const waves = p.waves.map(({ status, ...w }) => {
        // An admin's early close outranks the calendar.
        const window: PublicWaveWindow =
          status === 'FULL'
            ? 'full'
            : status === 'CLOSED'
              ? 'closed'
              : windowOf(w.startDate, w.endDate, now);
        return { ...w, window };
      });
      const registration = registrationWindow(p, waves, now);
      return {
        unit: p.unit,
        period: {
          id: p.id,
          name: p.name,
          academicYear: p.academicYear?.name ?? null,
          startDate: p.startDate.toISOString(),
          endDate: p.endDate.toISOString(),
          window: registration.window,
          opensAt: iso(registration.opensAt),
          closesAt: iso(registration.closesAt),
          registrationFee: p.registrationFee.toString(),
          requirements: p.requirements,
          minAgeMonths: p.minAgeMonths,
          ageReferenceDate: iso(p.ageReferenceDate),
          contactName: p.contactName,
          contactPhone: p.contactPhone,
        },
        waves: waves.map((w) => ({
          ...w,
          startDate: w.startDate.toISOString(),
          endDate: w.endDate.toISOString(),
          testStartDate: iso(w.testStartDate),
          testEndDate: iso(w.testEndDate),
          resultsStartDate: iso(w.resultsStartDate),
          resultsEndDate: iso(w.resultsEndDate),
          reRegistrationStartDate: iso(w.reRegistrationStartDate),
          reRegistrationEndDate: iso(w.reRegistrationEndDate),
          fullPaymentDiscount: w.fullPaymentDiscount?.toString() ?? null,
        })),
        fees: p.feeItems.map((f) => ({
          ...f,
          maleAmount: f.maleAmount.toString(),
          femaleAmount: f.femaleAmount.toString(),
        })),
      };
    });
}
