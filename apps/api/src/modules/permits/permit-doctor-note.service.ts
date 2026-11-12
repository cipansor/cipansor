import crypto from 'crypto';
import { PermitStatus, Prisma } from '@prisma/client';
import { PARENT_ROLE_CODES, PERMIT_NOTE_MAX_BYTES } from '@cipansor/shared';
import { prisma } from '@/lib/prisma';
import { ApiError, ErrorCode, Errors } from '@/middleware/error';
import type { ScopeActor } from '@/utils/student-scope';
import { dayOf, wibDayOf } from '@/utils/wib';
import { mayOpenNote } from './permits.decider';
import {
  findInScope,
  guardianshipOf,
  loadGuardianship,
  withDecision,
  type PermitView,
} from './permits.service';

/**
 * A doctor's note on a permit (decided 2026-09-28,
 * decisions/pemutus-izin-santri.md). It is a child's health data — data
 * pribadi spesifik under UU PDP 27/2022 Ps. 4(2) — so:
 *
 * - it lives in the database row, never under `public/uploads`, and the only
 *   way to read it is `openDoctorNote`, which checks who asks and audits it;
 * - whoever decides the permit, the unit head and the santri's wali open it
 *   (`mayOpenNote`); anyone else who sees the permit sees that one exists;
 * - it is erased when the academic year of the leave ends (`retainUntil`,
 *   `erasePermitNotes`), leaving that it was attached, its SHA-256 and who
 *   saw it first.
 */

export interface NoteFile {
  buffer: Buffer;
}

/** What the file is, read from its first bytes — never from its name or the header the client sent. */
function sniff(buffer: Buffer): { mimeType: string; ext: string } | null {
  const b = buffer;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mimeType: 'image/jpeg', ext: 'jpg' };
  }
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mimeType: 'image/png', ext: 'png' };
  }
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', ext: 'webp' };
  }
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { mimeType: 'application/pdf', ext: 'pdf' };
  }
  return null;
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export function checkNote(file: NoteFile | undefined) {
  if (!file?.buffer?.length) throw Errors.badRequest('Unggah foto atau PDF surat dokternya');
  if (file.buffer.length > PERMIT_NOTE_MAX_BYTES) {
    throw Errors.badRequest('Surat dokter paling besar 5 MB');
  }
  const kind = sniff(file.buffer);
  if (!kind) throw Errors.badRequest('Surat dokter harus foto (JPG, PNG, WebP) atau PDF');
  return {
    mimeType: kind.mimeType,
    sizeBytes: file.buffer.length,
    sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
    content: new Uint8Array(file.buffer),
  };
}

/**
 * The last day of the academic year the leave starts in. With no academic
 * year on record for that day, 30 June — the end of the Indonesian school
 * year — that follows it.
 */
export async function retainUntilFor(start: Date): Promise<Date> {
  const year = await prisma.academicYear.findFirst({
    where: { deletedAt: null, startDate: { lte: start }, endDate: { gte: start } },
    select: { endDate: true },
    orderBy: { startDate: 'desc' },
  });
  if (year) return dayOf(wibDayOf(year.endDate));
  const [y, m] = wibDayOf(start).split('-').map(Number);
  return dayOf(`${m >= 7 ? y + 1 : y}-06-30`);
}

const ATTACHABLE: PermitStatus[] = [PermitStatus.PENDING, PermitStatus.APPROVED];

/** POST /permits/:id/doctor-note — attach it, or replace the one there. */
export async function attachDoctorNote(
  id: string,
  file: NoteFile | undefined,
  actor: ScopeActor
): Promise<PermitView> {
  const permit = await findInScope(id, actor);
  if (!ATTACHABLE.includes(permit.status)) {
    throw Errors.conflict('Surat dokter dilampirkan pada izin yang menunggu atau sudah disetujui');
  }
  const replacing = !!permit.doctorNote;
  // Anyone who may file the permit attaches the first note; replacing one is
  // for those who may open it — nobody overwrites evidence they cannot see.
  if (replacing) {
    const g = guardianshipOf(await loadGuardianship([permit.studentId]), permit);
    if (!mayOpenNote(permit, g, actor)) {
      throw Errors.forbidden(
        'Surat dokter yang sudah dilampirkan hanya dapat diganti oleh pemutus izin, wali santri, dan kepala unit'
      );
    }
  }
  const note = checkNote(file);
  const retainUntil = await retainUntilFor(permit.startDate);
  await prisma.$transaction(async (tx) => {
    const fields = { ...note, retainUntil, uploadedById: actor.sub };
    await tx.permitAttachment.upsert({
      where: { permitId: id },
      create: { permitId: id, ...fields },
      // A new file is a new note: nobody has seen it yet, and it is whole.
      update: { ...fields, erasedAt: null, firstViewedById: null, firstViewedAt: null },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.sub,
        action: replacing ? 'UPDATE' : 'CREATE',
        entity: 'PERMIT_DOCTOR_NOTE',
        entityId: id,
        // The facts, never the file.
        newValues: {
          mimeType: note.mimeType,
          sizeBytes: note.sizeBytes,
          sha256: note.sha256,
          retainUntil: wibDayOf(retainUntil),
        } as Prisma.InputJsonValue,
      },
    });
  });
  return withDecision(await findInScope(id, actor), actor);
}

/** GET /permits/:id/doctor-note — the file, to those who may open it; each opening audited. */
export async function openDoctorNote(id: string, actor: ScopeActor) {
  const permit = await findInScope(id, actor);
  if (!permit.doctorNote) {
    throw new ApiError(ErrorCode.NOT_FOUND, 'Izin ini tidak berlampiran surat dokter');
  }
  const g = guardianshipOf(await loadGuardianship([permit.studentId]), permit);
  if (!mayOpenNote(permit, g, actor)) {
    throw Errors.forbidden(
      'Surat dokter hanya dapat dibuka oleh pemutus izin, wali santri, dan kepala unit'
    );
  }
  const note = await prisma.permitAttachment.findUnique({
    where: { permitId: id },
    select: { content: true, mimeType: true, firstViewedById: true },
  });
  if (!note?.content) {
    throw new ApiError(
      ErrorCode.NOT_FOUND,
      'Berkas surat dokter sudah dihapus pada akhir tahun ajaran'
    );
  }
  // "Dilihat oleh" names the first of those who check it for the permit —
  // not the wali looking at what they sent.
  const staff = !PARENT_ROLE_CODES.includes(actor.roleCode ?? '');
  await prisma.$transaction([
    ...(staff && !note.firstViewedById
      ? [
          prisma.permitAttachment.update({
            where: { permitId: id },
            data: { firstViewedById: actor.sub, firstViewedAt: new Date() },
          }),
        ]
      : []),
    prisma.auditLog.create({
      data: { userId: actor.sub, action: 'READ', entity: 'PERMIT_DOCTOR_NOTE', entityId: id },
    }),
  ]);
  return {
    content: Buffer.from(note.content),
    mimeType: note.mimeType,
    fileName: `surat-dokter-${permit.code ?? permit.id}.${EXT[note.mimeType] ?? 'bin'}`,
  };
}

/**
 * Erase every note whose academic year has ended (daily, before the nightly
 * backup): the file goes, the facts stay. Returns how many were erased.
 */
export async function erasePermitNotes(now = new Date()): Promise<number> {
  const due = await prisma.permitAttachment.findMany({
    where: { erasedAt: null, retainUntil: { lt: dayOf(wibDayOf(now)) } },
    select: { id: true, permitId: true },
  });
  if (!due.length) return 0;
  await prisma.$transaction([
    prisma.permitAttachment.updateMany({
      where: { id: { in: due.map((d) => d.id) }, erasedAt: null },
      data: { content: null, erasedAt: now },
    }),
    prisma.auditLog.createMany({
      data: due.map((d) => ({
        action: 'ERASE',
        entity: 'PERMIT_DOCTOR_NOTE',
        entityId: d.permitId,
      })),
    }),
  ]);
  return due.length;
}
