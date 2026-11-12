import crypto from 'crypto';
import { AccreditationRating, Prisma } from '@prisma/client';
import {
  ACCREDITATION_PDF_MAX_BYTES,
  ACCREDITATION_READER_ROLE_CODES,
  ACCREDITATION_REMINDER_MONTHS,
  ACCREDITATION_WRITER_ROLE_CODES,
  PRINCIPAL_ROLE_CODES,
  type CreateAccreditationInput,
  type PublicAccreditation,
  type UnitAccreditation,
  type UnitAccreditationList,
  type UpdateAccreditationInput,
} from '@cipansor/shared';
import { prisma } from '@/lib/prisma';
import { ApiError, ErrorCode, Errors } from '@/middleware/error';
import { isFoundationScopedRole } from '@/utils/resolve-unit-id';
import { dayOf, dayString, todayWib } from '@/utils/wib';

/**
 * A unit's accreditation as its certificate states it (decided 2026-09-28,
 * decisions/akreditasi-unit.md). The unit's admin and the Super Admin keep the
 * record, one row per certificate, with the PDF; the unit's kepala sekolah and
 * the yayasan's organs read it. The unit's accreditation now is its latest
 * certificate still in force (`currentAccreditations`), which the public site,
 * the EMIS and Dapodik exports and the SKHUN read.
 */

export interface AccreditationActor {
  sub: string;
  roleCode?: string | null;
  unitId: string | null;
}

export interface CertificateFile {
  buffer: Buffer;
  originalname?: string;
}

const code = (actor: AccreditationActor) => actor.roleCode ?? '';

/**
 * Whether the caller reads this unit's record: the Super Admin and the organs
 * every unit's, a unit's admin and kepala sekolah their own. Anyone else — or
 * another unit — is told the unit does not exist.
 */
function assertReader(unitId: string, actor: AccreditationActor) {
  const reads =
    ACCREDITATION_READER_ROLE_CODES.includes(code(actor)) &&
    (isFoundationScopedRole(actor.roleCode) || actor.unitId === unitId);
  if (!reads) throw new ApiError(ErrorCode.NOT_FOUND, 'Unit tidak ditemukan');
}

/** Whether the caller may record, correct or delete: the Super Admin, or the unit's own admin. */
function mayWrite(unitId: string, actor: AccreditationActor) {
  if (code(actor) === 'SUPER_ADMIN') return true;
  return ACCREDITATION_WRITER_ROLE_CODES.includes(code(actor)) && actor.unitId === unitId;
}

function assertWriter(unitId: string, actor: AccreditationActor) {
  assertReader(unitId, actor);
  if (!mayWrite(unitId, actor)) {
    throw Errors.forbidden('Akreditasi unit dicatat oleh admin unit itu atau Super Admin');
  }
}

/** The certificate PDF, checked by its bytes, not by the name it came with. */
export function checkCertificate(file: CertificateFile | undefined) {
  if (!file?.buffer?.length) throw Errors.badRequest('Unggah PDF sertifikat akreditasinya');
  if (file.buffer.length > ACCREDITATION_PDF_MAX_BYTES) {
    throw Errors.badRequest('PDF sertifikat paling besar 5 MB');
  }
  if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw Errors.badRequest('Berkas sertifikat harus PDF');
  }
  return {
    certificatePdf: new Uint8Array(file.buffer),
    certificateSha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
  };
}

const RECORD_SELECT = {
  id: true,
  unitId: true,
  rating: true,
  certificateNumber: true,
  decreeNumber: true,
  decreedAt: true,
  validUntil: true,
  issuer: true,
  certificateSha256: true,
  reminderSentAt: true,
  createdAt: true,
  updatedAt: true,
  recordedBy: { select: { id: true, name: true } },
} satisfies Prisma.UnitAccreditationSelect;

type Row = Prisma.UnitAccreditationGetPayload<{ select: typeof RECORD_SELECT }>;

/** The unit's certificate in force today: the one decreed last among those not yet run out. */
function currentOf<T extends { decreedAt: Date; validUntil: Date; createdAt: Date }>(
  rows: T[],
  today: string
): T | undefined {
  return rows
    .filter((r) => dayString(r.validUntil) >= today)
    .sort(
      (a, b) =>
        b.decreedAt.getTime() - a.decreedAt.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime()
    )[0];
}

function toView(row: Row, currentId: string | undefined): UnitAccreditation {
  return {
    id: row.id,
    unitId: row.unitId,
    rating: row.rating,
    certificateNumber: row.certificateNumber,
    decreeNumber: row.decreeNumber,
    decreedAt: dayString(row.decreedAt),
    validUntil: dayString(row.validUntil),
    issuer: row.issuer,
    certificateSha256: row.certificateSha256,
    current: row.id === currentId,
    recordedBy: row.recordedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function unitOrThrow(unitId: string) {
  const unit = await prisma.unit.findFirst({
    where: { id: unitId, deletedAt: null },
    select: { id: true, name: true, npsn: true },
  });
  if (!unit) throw new ApiError(ErrorCode.NOT_FOUND, 'Unit tidak ditemukan');
  return unit;
}

/** GET /units/:id/accreditations — the unit's certificates, newest first. */
export async function listAccreditations(
  unitId: string,
  actor: AccreditationActor,
  now = new Date()
): Promise<UnitAccreditationList> {
  assertReader(unitId, actor);
  const unit = await unitOrThrow(unitId);
  const rows = await prisma.unitAccreditation.findMany({
    where: { unitId },
    select: RECORD_SELECT,
    orderBy: [{ decreedAt: 'desc' }, { createdAt: 'desc' }],
  });
  const current = currentOf(rows, todayWib(now));
  return {
    unit,
    canWrite: mayWrite(unitId, actor),
    accreditations: rows.map((r) => toView(r, current?.id)),
  };
}

const auditEntry = (
  actor: AccreditationActor,
  action: string,
  entityId: string,
  oldValues?: object,
  newValues?: object
) => ({
  userId: actor.sub,
  action,
  entity: 'UNIT_ACCREDITATION',
  entityId,
  ...(oldValues ? { oldValues: oldValues as Prisma.InputJsonValue } : {}),
  ...(newValues ? { newValues: newValues as Prisma.InputJsonValue } : {}),
});

/** What the audit log keeps of a record: its facts, never the PDF bytes. */
const factsOf = (r: {
  rating: string;
  certificateNumber: string;
  decreeNumber: string;
  decreedAt: Date;
  validUntil: Date;
  issuer: string;
  certificateSha256: string;
}) => ({
  rating: r.rating,
  certificateNumber: r.certificateNumber,
  decreeNumber: r.decreeNumber,
  decreedAt: dayString(r.decreedAt),
  validUntil: dayString(r.validUntil),
  issuer: r.issuer,
  certificateSha256: r.certificateSha256,
});

/** POST /units/:id/accreditations — a certificate, with its PDF. */
export async function recordAccreditation(
  unitId: string,
  input: CreateAccreditationInput,
  file: CertificateFile | undefined,
  actor: AccreditationActor,
  now = new Date()
): Promise<UnitAccreditation> {
  assertWriter(unitId, actor);
  await unitOrThrow(unitId);
  const pdf = checkCertificate(file);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.unitAccreditation.create({
      data: {
        unitId,
        rating: input.rating as AccreditationRating,
        certificateNumber: input.certificateNumber,
        decreeNumber: input.decreeNumber,
        decreedAt: dayOf(input.decreedAt),
        validUntil: dayOf(input.validUntil),
        ...(input.issuer ? { issuer: input.issuer } : {}),
        ...pdf,
        recordedById: actor.sub,
      },
      select: RECORD_SELECT,
    });
    await tx.auditLog.create({
      data: auditEntry(actor, 'CREATE', created.id, undefined, { unitId, ...factsOf(created) }),
    });
    return created;
  });
  return withCurrent(row, now);
}

/** The record as the list would show it, `current` included. */
async function withCurrent(row: Row, now: Date) {
  const siblings = await prisma.unitAccreditation.findMany({
    where: { unitId: row.unitId },
    select: { id: true, decreedAt: true, validUntil: true, createdAt: true },
  });
  return toView(row, currentOf(siblings, todayWib(now))?.id);
}

async function recordOf(unitId: string, id: string) {
  const row = await prisma.unitAccreditation.findFirst({
    where: { id, unitId },
    select: RECORD_SELECT,
  });
  if (!row) throw new ApiError(ErrorCode.NOT_FOUND, 'Catatan akreditasi tidak ditemukan');
  return row;
}

/** PATCH /units/:id/accreditations/:accreditationId — a correction; the PDF may be replaced. */
export async function correctAccreditation(
  unitId: string,
  id: string,
  input: UpdateAccreditationInput,
  file: CertificateFile | undefined,
  actor: AccreditationActor,
  now = new Date()
): Promise<UnitAccreditation> {
  assertWriter(unitId, actor);
  const before = await recordOf(unitId, id);
  const decreedAt = input.decreedAt ?? dayString(before.decreedAt);
  const validUntil = input.validUntil ?? dayString(before.validUntil);
  if (validUntil <= decreedAt) {
    throw Errors.badRequest('Tanggal berlaku harus sesudah tanggal SK');
  }
  const pdf = file?.buffer?.length ? checkCertificate(file) : undefined;
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.unitAccreditation.update({
      where: { id },
      data: {
        ...(input.rating ? { rating: input.rating as AccreditationRating } : {}),
        ...(input.certificateNumber ? { certificateNumber: input.certificateNumber } : {}),
        ...(input.decreeNumber ? { decreeNumber: input.decreeNumber } : {}),
        ...(input.decreedAt ? { decreedAt: dayOf(input.decreedAt) } : {}),
        ...(input.validUntil ? { validUntil: dayOf(input.validUntil), reminderSentAt: null } : {}),
        ...(input.issuer ? { issuer: input.issuer } : {}),
        ...(pdf ?? {}),
      },
      select: RECORD_SELECT,
    });
    await tx.auditLog.create({
      data: auditEntry(actor, 'UPDATE', id, factsOf(before), factsOf(updated)),
    });
    return updated;
  });
  return withCurrent(row, now);
}

/** DELETE /units/:id/accreditations/:accreditationId — a record entered by mistake. */
export async function deleteAccreditation(unitId: string, id: string, actor: AccreditationActor) {
  assertWriter(unitId, actor);
  const before = await recordOf(unitId, id);
  await prisma.$transaction([
    prisma.unitAccreditation.delete({ where: { id } }),
    prisma.auditLog.create({ data: auditEntry(actor, 'DELETE', id, factsOf(before)) }),
  ]);
}

/** GET /units/:id/accreditations/:accreditationId/certificate — the PDF. */
export async function certificateOf(unitId: string, id: string, actor: AccreditationActor) {
  assertReader(unitId, actor);
  const row = await prisma.unitAccreditation.findFirst({
    where: { id, unitId },
    select: { certificatePdf: true, certificateNumber: true },
  });
  if (!row) throw new ApiError(ErrorCode.NOT_FOUND, 'Catatan akreditasi tidak ditemukan');
  return {
    pdf: Buffer.from(row.certificatePdf),
    fileName: `sertifikat-akreditasi-${row.certificateNumber.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`,
  };
}

export interface CurrentAccreditation {
  id: string;
  unitId: string;
  rating: AccreditationRating;
  certificateNumber: string;
  decreeNumber: string;
  decreedAt: string;
  validUntil: string;
  issuer: string;
}

/**
 * Each unit's accreditation in force today, for everything that states it —
 * the public site, the EMIS and Dapodik exports, the SKHUN. A unit with none
 * in force is not in the map: it has no accreditation to state.
 */
export async function currentAccreditations(
  unitIds?: string[],
  now = new Date()
): Promise<Map<string, CurrentAccreditation>> {
  const today = todayWib(now);
  const rows = await prisma.unitAccreditation.findMany({
    where: {
      validUntil: { gte: dayOf(today) },
      ...(unitIds ? { unitId: { in: [...new Set(unitIds)] } } : {}),
    },
    select: {
      id: true,
      unitId: true,
      rating: true,
      certificateNumber: true,
      decreeNumber: true,
      decreedAt: true,
      validUntil: true,
      issuer: true,
      createdAt: true,
    },
  });
  const byUnit = new Map<string, CurrentAccreditation>();
  for (const unitId of new Set(rows.map((r) => r.unitId))) {
    const r = currentOf(
      rows.filter((x) => x.unitId === unitId),
      today
    )!;
    byUnit.set(unitId, {
      id: r.id,
      unitId,
      rating: r.rating,
      certificateNumber: r.certificateNumber,
      decreeNumber: r.decreeNumber,
      decreedAt: dayString(r.decreedAt),
      validUntil: dayString(r.validUntil),
      issuer: r.issuer,
    });
  }
  return byUnit;
}

/**
 * GET /units/public/accreditations — each unit's certificate in force, as the
 * public site states it. A certificate that has run out is gone from here the
 * day after its last day, and a unit with none is absent.
 */
export async function publicAccreditations(now = new Date()): Promise<PublicAccreditation[]> {
  const current = await currentAccreditations(undefined, now);
  if (!current.size) return [];
  const units = await prisma.unit.findMany({
    where: { id: { in: [...current.keys()] }, deletedAt: null },
    select: { id: true, name: true, type: true, npsn: true },
    orderBy: { name: 'asc' },
  });
  return units.map((unit) => {
    const c = current.get(unit.id)!;
    return {
      id: c.id,
      unitType: unit.type,
      unitName: unit.name,
      npsn: unit.npsn,
      rating: c.rating,
      certificateNumber: c.certificateNumber,
      decreeNumber: c.decreeNumber,
      decreedAt: c.decreedAt,
      validUntil: c.validUntil,
      issuer: c.issuer,
    };
  });
}

/**
 * GET /units/public/accreditations/:accreditationId/certificate — the PDF of
 * a certificate the public site states, and of no other: one that has run
 * out, been superseded, or belongs to a deleted unit is "not found".
 */
export async function publicCertificate(id: string, now = new Date()) {
  const row = await prisma.unitAccreditation.findFirst({
    where: { id, unit: { deletedAt: null } },
    select: { unitId: true, certificatePdf: true, certificateNumber: true },
  });
  const inForce = row && (await currentAccreditations([row.unitId], now)).get(row.unitId);
  if (!row || inForce?.id !== id) {
    throw new ApiError(ErrorCode.NOT_FOUND, 'Sertifikat tidak ditemukan');
  }
  return {
    pdf: Buffer.from(row.certificatePdf),
    fileName: `sertifikat-akreditasi-${row.certificateNumber.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`,
  };
}

/**
 * For the daily reminder: each unit's certificate in force whose end is
 * within `ACCREDITATION_REMINDER_MONTHS`, not yet reminded, and not already
 * followed by a newer certificate — with the unit's kepala sekolah and admin.
 */
export async function accreditationsToRemind(now = new Date()) {
  const today = todayWib(now);
  const horizon = new Date(dayOf(today));
  horizon.setUTCMonth(horizon.getUTCMonth() + ACCREDITATION_REMINDER_MONTHS);
  const current = await currentAccreditations(undefined, now);
  const due = [...current.values()].filter((c) => dayOf(c.validUntil) <= horizon);
  if (!due.length) return [];

  const pending = await prisma.unitAccreditation.findMany({
    where: { id: { in: due.map((d) => d.id) }, reminderSentAt: null },
    select: { id: true, unit: { select: { id: true, name: true } } },
  });
  if (!pending.length) return [];
  const people = await prisma.userRoleAssignment.findMany({
    where: {
      isActive: true,
      user: { isActive: true },
      unitId: { in: pending.map((p) => p.unit.id) },
      role: {
        code: {
          in: [
            ...ACCREDITATION_WRITER_ROLE_CODES.filter((c) => c !== 'SUPER_ADMIN'),
            ...PRINCIPAL_ROLE_CODES,
          ],
        },
      },
    },
    select: { userId: true, unitId: true },
  });
  return pending.map((p) => ({
    ...current.get(p.unit.id)!,
    unitName: p.unit.name,
    recipients: [...new Set(people.filter((x) => x.unitId === p.unit.id).map((x) => x.userId))],
  }));
}

export async function markReminded(ids: string[], now = new Date()) {
  if (!ids.length) return;
  await prisma.unitAccreditation.updateMany({
    where: { id: { in: ids } },
    data: { reminderSentAt: now },
  });
}
