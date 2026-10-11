import { wibDayOf } from '@/utils/wib-day';
import {
  Prisma,
  LetterFlowAction,
  LetterStatus as DbLetterStatus,
  LetterType as DbLetterType,
  LetterNature as DbLetterNature,
  RoleCode,
} from '@prisma/client';
import { prisma, type Db } from '@/lib/prisma';
import {
  CreateLetterInput,
  CreateDispositionInput,
  DispatchLetterSchemaInput,
  LetterCcInput,
  LETTER_DISPATCH_CHANNEL_LABELS,
  LETTER_NATURE_LABELS,
  LETTER_STATUS_LABELS,
  LetterDirection,
  LetterStatus,
  UpdateLetterInput,
  EXCLUDED_CORRESPONDENCE_ROLES,
  letterPartyName,
} from '@cipansor/shared';
import { eventBus } from '@/lib/event-bus';
import { verifyLetterByToken } from '@/utils/letter-verification';
import {
  assertLetterAccess,
  handlesUnitCorrespondence,
  letterScopeWhere,
  type LetterActor,
} from '@/utils/letter-access';
import { seesAllUnits } from '@/utils/resolve-unit-id';
import {
  reviewLetterRetentionForActor,
  type LetterRetentionSummary,
} from '@/jobs/letter-retention.job';
import {
  assertMayArchive,
  assertMayDispatch,
  assertMayResubmit,
  assertMayReview,
  nextRung,
  statusAfterApproval,
  statusAfterResubmit,
  type ReviewerRung,
} from '@/utils/letter-workflow';
import { LETTER_PDF_RELATIONS } from '@/utils/generate-letter-pdf';
import { AGENDA_TYPE_CODE, assertNatureAllowed } from '@/utils/letter-naskah';
import { Errors } from '@/middleware/error';

/** Anything that can run a query — the live client or a transaction handle. */
/**
 * Append one entry to a letter's history.
 *
 * Always called with the same transaction that performed the change, so a
 * letter cannot move without the move being recorded — a history written
 * afterwards, outside the transaction, is a history with holes in it exactly
 * when something went wrong and the record matters most.
 */
async function recordFlow(
  db: Db,
  entry: {
    letterId: string;
    actorId: string;
    action: LetterFlowAction;
    targetId?: string | null;
    fromStatus?: DbLetterStatus | null;
    toStatus?: DbLetterStatus | null;
    note?: string | null;
  }
) {
  await db.letterFlowEvent.create({
    data: {
      letterId: entry.letterId,
      actorId: entry.actorId,
      action: entry.action,
      targetId: entry.targetId ?? null,
      fromStatus: entry.fromStatus ?? null,
      toStatus: entry.toStatus ?? null,
      note: entry.note ?? null,
    },
  });
}

/**
 * Bentuk nomor surat bawaan, mengikuti surat asli Yayasan:
 *
 *     434/Sket/Y-CPS/VII/2026
 *      │    │     │    │    └── tahun
 *      │    │     │    └─────── bulan angka Romawi
 *      │    │     └──────────── kode organisasi
 *      │    └────────────────── kode jenis naskah (AGENDA_TYPE_CODE)
 *      └─────────────────────── nomor urut dalam buku agenda jenis itu
 *
 * Versi pertama menghilangkan kode organisasi, sehingga nomor yang dihasilkan
 * tidak sama bentuknya dengan surat yang selama ini dikeluarkan. Ini hanya
 * *bawaan*: `AgendaNumber.format` disimpan per unit + jenis + tahun ajaran,
 * jadi unit yang memakai kode sendiri tinggal menyunting barisnya tanpa
 * mengubah kode.
 */
const DEFAULT_AGENDA_FORMAT = '[NO]/[TYPE]/Y-CPS/[ROMAN]/[YEAR]';

const ROMAN_MONTHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** Pengguna internal yang disebut dalam daftar tembusan, tanpa duplikat. */
function ccUserIds(cc?: LetterCcInput[] | null): string[] {
  return Array.from(new Set((cc ?? []).map((c) => c.userId).filter((id): id is string => !!id)));
}

/**
 * Baris-baris tembusan yang akan ditulis, dalam urutan yang disusun penulisnya.
 *
 * Dua penyaringan, keduanya karena naskahnya mencetak daftar bernomor:
 * seseorang yang sudah menjadi penerima utama tidak dicatat lagi sebagai
 * tembusan — ia menerima surat ini *atau* salinannya — dan nama yang sama
 * tidak ditulis dua kali, sebab dua baris untuk satu pihak akan tercetak
 * sebagai dua nomor untuk satu orang.
 */
function buildCcRows(
  letterId: string,
  unitId: string,
  cc: LetterCcInput[] | undefined | null,
  primaryRecipientIds?: string[] | null
): Array<{
  letterId: string;
  userId: string | null;
  unitId: string;
  externalName: string | null;
  isCC: true;
  order: number;
}> {
  const primary = new Set(primaryRecipientIds ?? []);
  const seen = new Set<string>();
  const rows: ReturnType<typeof buildCcRows> = [];

  for (const entry of cc ?? []) {
    const key = entry.userId
      ? `u:${entry.userId}`
      : `e:${(entry.externalName ?? '').trim().toLowerCase()}`;
    if (key === 'e:') continue;
    if (entry.userId && primary.has(entry.userId)) continue;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      letterId,
      userId: entry.userId ?? null,
      unitId,
      externalName: entry.userId ? null : (entry.externalName ?? '').trim(),
      isCC: true,
      order: rows.length + 1,
    });
  }

  return rows;
}

export const CorrespondenceService = {
  // Helper: Generate Auto Number
  async generateNumber(
    unitId: string,
    type: string,
    academicYearId: string,
    db: Db = prisma
  ): Promise<string> {
    // 1. Find Agenda Config
    let agenda = await db.agendaNumber.findUnique({
      where: {
        unitId_academicYearId_type: {
          unitId,
          academicYearId,
          type,
        },
      },
    });

    // 2. Create if not exists
    if (!agenda) {
      agenda = await db.agendaNumber.create({
        data: {
          unitId,
          academicYearId,
          type,
          lastNumber: 0,
          format: DEFAULT_AGENDA_FORMAT,
        },
      });
    }

    // 3. Increment (Atomic)
    const updatedAgenda = await db.agendaNumber.update({
      where: { id: agenda.id },
      data: { lastNumber: { increment: 1 } },
    });

    const newNumber = updatedAgenda.lastNumber;

    // 4. Format String. Bulan dan tahun menurut kalender WIB, bukan zona jam
    // server: nomor dicetak ke naskah resmi, dan kontainer API berjalan dalam
    // UTC, sehingga surat pukul 00:00–07:00 WIB tanggal 1 dulu memakai bulan,
    // bahkan tahun, kemarin (#743).
    const [year, month] = wibDayOf(new Date()).split('-');
    const romanMonth = ROMAN_MONTHS[Number(month) - 1];

    let formatted = agenda.format
      .replace('[NO]', newNumber.toString().padStart(3, '0'))
      .replace('[TYPE]', type)
      .replace('[ROMAN]', romanMonth)
      .replace('[YEAR]', year);

    return formatted;
  },

  /**
   * Validate that all supplied user IDs exist, are active, have active internal roles, and fall within permitted unit scope.
   */
  async validateParticipantEligibility(userIds: string[], actor?: LetterActor) {
    if (!userIds || userIds.length === 0) return;

    const uniqueIds = Array.from(new Set(userIds));
    const now = new Date();

    const users = await prisma.user.findMany({
      where: {
        id: { in: uniqueIds },
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        unitId: true,
        teacher: { select: { nip: true } },
        staff: { select: { nip: true } },
        userRoles: {
          where: {
            isActive: true,
            role: {
              code: {
                notIn: EXCLUDED_CORRESPONDENCE_ROLES as unknown as RoleCode[],
              },
            },
            OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          },
          select: { unitId: true, role: { select: { code: true } } },
        },
      },
    });

    if (users.length !== uniqueIds.length) {
      throw Errors.badRequest(
        'Satu atau lebih penerima/pemeriksa tidak ditemukan atau tidak aktif'
      );
    }

    const actorSeesAll = actor ? seesAllUnits(actor) : true;

    for (const u of users) {
      const isInternal = u.userRoles && u.userRoles.length > 0;
      if (!isInternal) {
        throw Errors.badRequest(`Pengguna ${u.id} tidak memiliki peran internal yang sah`);
      }

      // Enforce unit scope based on active role assignments or legacy user unitId
      if (!actorSeesAll && actor?.unitId) {
        const matchesUserUnit = u.unitId === actor.unitId || u.unitId === null;
        const matchesRoleUnit = u.userRoles.some(
          (ur) => ur.unitId === actor.unitId || ur.unitId === null
        );
        if (!matchesUserUnit && !matchesRoleUnit) {
          throw Errors.forbidden(`Pengguna ${u.id} berada di luar unit Anda`);
        }
      }
    }
  },

  async createLetter(data: CreateLetterInput, userId: string, actor?: LetterActor) {
    if (!actor || !actor.roleCode) {
      throw Errors.forbidden('Peran Anda tidak berwenang untuk membuat surat dinas');
    }

    // Executive foundation roles authorized to issue correspondence
    const isFoundationExecutive =
      actor.roleCode === RoleCode.YAYASAN_KETUA || actor.roleCode === RoleCode.YAYASAN_SEKRETARIS;
    const isCorrespondenceRole = handlesUnitCorrespondence(actor);
    const isSuperAdmin = actor.roleCode === RoleCode.SUPER_ADMIN;

    // Allowlist: ONLY unit correspondence roles (tata usaha, kepsek, admin unit), executive foundation roles (Ketua/Sekretaris), and SUPER_ADMIN.
    // Oversight-only roles (YAYASAN_PEMBINA, YAYASAN_PENGAWAS, YAYASAN_ANGGOTA) do NOT have creation authority.
    const isAuthorizedCreator = isCorrespondenceRole || isFoundationExecutive || isSuperAdmin;

    if (!isAuthorizedCreator) {
      throw Errors.forbidden('Peran Anda tidak berwenang untuk membuat surat dinas');
    }

    // Validate reviewer and recipient eligibility
    const participantsToValidate = [
      ...(data.reviewerIds || []),
      ...(data.recipientIds || []),
      // Penerima tembusan internal adalah penerima juga: ia akan dapat membaca
      // surat ini. Melewatkannya dari pemeriksaan kelayakan berarti tembusan
      // menjadi jalan memberi akses kepada peran yang justru dikecualikan.
      // Tembusan ke pihak luar tidak diperiksa — ia hanya nama yang tercetak,
      // dan tidak membuka apa pun.
      ...ccUserIds(data.ccRecipients),
    ];
    if (participantsToValidate.length > 0) {
      await this.validateParticipantEligibility(participantsToValidate, actor);
    }

    // Client is only allowed to request initial status DRAFT or PENDING_REVIEW
    if (data.status !== LetterStatus.DRAFT && data.status !== LetterStatus.PENDING_REVIEW) {
      throw Errors.badRequest('Status awal surat hanya dapat berupa DRAFT atau PENDING_REVIEW');
    }

    // Outgoing letters submitted in PENDING_REVIEW must have at least one reviewer assigned
    if (
      data.direction === 'OUTGOING' &&
      data.status === LetterStatus.PENDING_REVIEW &&
      (!data.reviewerIds || data.reviewerIds.length === 0)
    ) {
      throw Errors.badRequest(
        'Surat keluar berstatus PENDING_REVIEW wajib memilih minimal satu pemeriksa'
      );
    }

    // Single-unit bypass is strictly reserved for Executive Foundation Roles and SUPER_ADMIN.
    const isFoundationBypass = isFoundationExecutive || isSuperAdmin;

    if (!isFoundationBypass) {
      if (!actor.unitId) {
        throw Errors.forbidden('Akun Anda tidak terhubung dengan unit kerja yang valid.');
      }
      if (data.unitId && data.unitId !== actor.unitId) {
        throw Errors.forbidden('Anda tidak berwenang membuat surat untuk unit lain');
      }
    }

    const targetUnitId = isFoundationBypass ? data.unitId || actor.unitId : actor.unitId;

    if (!targetUnitId) {
      throw Errors.badRequest('Unit ID wajib diisi');
    }

    // Jenis naskah menentukan sifat mana yang sah dan buku nomor mana yang
    // dipakai. Divalidasi sebelum apa pun ditulis: menolak setelah nomor
    // agenda terlanjur naik akan meninggalkan lubang di buku agenda.
    const type = (data.type as DbLetterType | undefined) ?? DbLetterType.SURAT_DINAS;
    assertNatureAllowed(type, data.nature as unknown as DbLetterNature);

    // Incoming letters do not enter review unless reviewerIds are provided.
    // If an incoming letter is submitted without reviewers, set status based on recipient assignment.
    let initialStatus = data.status as DbLetterStatus;
    if (
      data.direction === 'INCOMING' &&
      initialStatus === DbLetterStatus.PENDING_REVIEW &&
      (!data.reviewerIds || data.reviewerIds.length === 0)
    ) {
      initialStatus =
        data.recipientIds && data.recipientIds.length > 0
          ? DbLetterStatus.DISPOSED
          : DbLetterStatus.DRAFT;
    }

    // Get active academic year
    const activeYear = await prisma.academicYear.findFirst({
      where: { isActive: true },
    });
    const academicYearId = activeYear?.id || 'DEFAULT';

    const result = await prisma.$transaction(async (tx) => {
      // Generate number inside transaction so rollback cancels increment on failure
      let agendaNumber = data.agendaNumber;
      let letterNumber = data.letterNumber;

      if (data.direction === 'INCOMING' && !agendaNumber) {
        agendaNumber = await this.generateNumber(targetUnitId, 'INCOMING', academicYearId, tx);
      } else if (data.direction === 'OUTGOING' && !letterNumber) {
        if (initialStatus !== 'DRAFT') {
          letterNumber = await this.generateNumber(
            targetUnitId,
            AGENDA_TYPE_CODE[type],
            academicYearId,
            tx
          );
        }
      }

      // Create Letter
      const letter = await tx.letter.create({
        data: {
          unitId: targetUnitId,
          direction: data.direction as any, // Enum mapping might need care
          type,
          classificationId: data.classificationId,
          agendaNumber: agendaNumber,
          letterNumber: letterNumber,
          date: new Date(data.date),
          receivedAt: data.receivedAt ? new Date(data.receivedAt) : null,
          subject: data.subject,
          content: data.content,
          fileUrl: data.fileUrl,
          /**
           * Jalur penyusunan naskah, ditetapkan sekali di sini dan tidak diubah.
           *
           * Surat keluar yang membawa berkas naskah unggahan penyusunnya
           * ditandai `UPLOADED`: berkas itulah naskahnya, dan byte yang
           * ditandatangani, di-hash, serta dicocokkan pada verifikasi publik
           * adalah byte tersebut — bukan hasil render sistem. Surat lain
           * `GENERATED`, disusun sistem dari isian formulir.
           *
           * Surat masuk tidak pernah `UPLOADED` walau membawa pindaian: naskah
           * itu disusun pihak luar dan tidak masuk jalur tanda tangan elektronik
           * kita, jadi yang menentukan jalurnya adalah naskah yang *kita*
           * terbitkan.
           */
          authoringTrack: data.direction === 'OUTGOING' && data.fileUrl ? 'UPLOADED' : 'GENERATED',
          urgency: data.urgency as any,
          nature: data.nature as any,
          status: initialStatus,
          senderName: data.senderName,
          senderTitle: data.senderTitle,
          senderInstance: data.senderInstance,
          recipientName: data.recipientName,
          recipientInstance: data.recipientInstance,
          createdById: userId,
        },
      });

      // Add Reviewers (deduplicated)
      if (data.reviewerIds && data.reviewerIds.length > 0) {
        const uniqueReviewerIds = Array.from(new Set(data.reviewerIds));
        await tx.letterReviewer.createMany({
          data: uniqueReviewerIds.map((reviewerId, index) => ({
            letterId: letter.id,
            reviewerId: reviewerId,
            order: index + 1,
            status: 'PENDING',
            isSigner: false, // Default to false so dynamic review-and-forward can take place
          })),
        });
      }

      // Add Recipients
      if (data.recipientIds && data.recipientIds.length > 0) {
        const uniqueRecipients = Array.from(new Set(data.recipientIds));
        await tx.letterRecipient.createMany({
          data: uniqueRecipients.map((recipientId) => ({
            letterId: letter.id,
            userId: recipientId,
            unitId: targetUnitId,
            isCC: false,
          })),
        });
      }

      /**
       * Tembusan.
       *
       * `isCC` ada di skema sejak awal dan satu-satunya penulisannya di seluruh
       * kode adalah `isCC: false` di atas — kolom yang tidak pernah bernilai
       * true adalah kolom yang tidak ada.
       *
       * Siapa pun yang sudah menjadi penerima utama tidak dicatat lagi sebagai
       * tembusan: seseorang menerima surat ini *atau* salinannya, dan dua baris
       * untuk orang yang sama akan mencetak namanya dua kali di kaki naskah.
       */
      const ccRows = buildCcRows(letter.id, targetUnitId, data.ccRecipients, data.recipientIds);
      if (ccRows.length > 0) {
        await tx.letterRecipient.createMany({ data: ccRows });
      }

      /**
       * Lampiran.
       *
       * Urutannya adalah urutan yang disusun pembuatnya, dan ia disimpan:
       * naskahnya mengumumkan "Lampiran : 2 (dua) berkas", dan daftar bernomor
       * yang urutannya berubah-ubah setiap kali dibaca bukan daftar.
       */
      if (data.attachments && data.attachments.length > 0) {
        await tx.letterAttachment.createMany({
          data: data.attachments.map((att, index) => ({
            letterId: letter.id,
            name: att.name,
            fileUrl: att.fileUrl,
            mimeType: att.mimeType ?? null,
            sizeBytes: att.sizeBytes ?? null,
            order: index + 1,
            uploadedById: userId,
          })),
        });
      }

      // Record CREATED flow event first
      await recordFlow(tx, {
        letterId: letter.id,
        actorId: userId,
        action: LetterFlowAction.CREATED,
        toStatus: letter.status,
        note: letter.subject,
      });

      // Record SUBMITTED if created straight into review
      if (letter.status !== DbLetterStatus.DRAFT && data.reviewerIds?.length) {
        await recordFlow(tx, {
          letterId: letter.id,
          actorId: userId,
          action: LetterFlowAction.SUBMITTED,
          toStatus: letter.status,
        });
      }

      const createdDispositionsToNotify: Array<{ id: string; recipientId: string }> = [];

      // Create live Dispositions ONLY when initial status is DISPOSED
      if (
        data.direction === 'INCOMING' &&
        initialStatus === DbLetterStatus.DISPOSED &&
        data.recipientIds?.length
      ) {
        const uniqueRecipients = Array.from(new Set(data.recipientIds));
        for (const recipientId of uniqueRecipients) {
          const existingDisp = await tx.disposition.findFirst({
            where: { letterId: letter.id, recipientId, status: { not: 'COMPLETED' } },
          });

          if (!existingDisp) {
            const createdDisp = await tx.disposition.create({
              data: {
                letterId: letter.id,
                senderId: userId,
                recipientId,
                instruction: 'Surat Masuk Diteruskan',
                status: 'PENDING',
              },
            });

            await recordFlow(tx, {
              letterId: letter.id,
              actorId: userId,
              action: LetterFlowAction.DISPOSED,
              targetId: recipientId,
              fromStatus: letter.status,
              toStatus: DbLetterStatus.DISPOSED,
              note: 'Surat Masuk Diteruskan',
            });

            createdDispositionsToNotify.push({ id: createdDisp.id, recipientId });
          }
        }
      }

      return { letter, createdDispositionsToNotify };
    });

    // Post-commit: Notify first reviewer if letter created directly in PENDING_REVIEW
    const uniqueReviewers = data.reviewerIds ? Array.from(new Set(data.reviewerIds)) : [];
    if (result.letter.status === DbLetterStatus.PENDING_REVIEW && uniqueReviewers.length) {
      const firstReviewerId = uniqueReviewers[0];
      eventBus.emit('notification:send', {
        userId: firstReviewerId,
        unitId: result.letter.unitId,
        type: 'REMINDER',
        title: 'Konsep Surat Perlu Ditinjau',
        message: `Konsep surat "${result.letter.subject}" diajukan kepada Anda untuk ditinjau.`,
        data: { letterId: result.letter.id, link: `/e-office/letter/${result.letter.id}` },
      });
    }

    // Post-commit: Notify recipients for automatic dispositions
    for (const disp of result.createdDispositionsToNotify) {
      eventBus.emit('notification:send', {
        userId: disp.recipientId,
        type: 'REMINDER',
        title: 'Disposisi Baru',
        message: 'Anda menerima terusan surat masuk baru.',
        data: {
          entityId: disp.id,
          entityType: 'DISPOSITION',
          letterId: result.letter.id,
          link: `/e-office/letter/${result.letter.id}`,
        },
      });
    }

    return result.letter;
  },

  /**
   * Update a letter draft or a returned draft (REVISION_NEEDED).
   */
  async updateLetter(
    letterId: string,
    data: UpdateLetterInput,
    userId: string,
    actor: LetterActor
  ) {
    await assertLetterAccess(actor, letterId);

    // Compute the participant set up-front but DELAY the eligibility check until
    // after the status/signature/authorization guards below. Doing it first let
    // a read-only link on the review chain probe the eligibility of arbitrary
    // userIds through an update request before learning the letter is not theirs
    // to edit (Flag 12).
    const participantsToValidate = [
      ...(data.reviewerIds || []),
      ...(data.recipientIds || []),
      ...ccUserIds(data.ccRecipients),
    ];

    return await prisma.$transaction(async (tx) => {
      // Row lock letter for update
      await tx.$executeRaw`SELECT id FROM letters WHERE id = ${letterId} FOR UPDATE`;

      const letter = await tx.letter.findUnique({
        where: { id: letterId },
        select: {
          id: true,
          status: true,
          createdById: true,
          unitId: true,
          type: true,
          nature: true,
          direction: true,
          recipients: { where: { isCC: false }, select: { userId: true } },
          signatures: { select: { id: true } },
        },
      });

      if (!letter) {
        throw Errors.notFound('Surat tidak ditemukan');
      }

      // Check letter status: editing is only permitted for DRAFT or REVISION_NEEDED
      if (
        letter.status !== DbLetterStatus.DRAFT &&
        letter.status !== DbLetterStatus.REVISION_NEEDED
      ) {
        throw Errors.badRequest(
          'Hanya surat berstatus DRAFT atau REVISION_NEEDED yang dapat diubah.'
        );
      }

      if (letter.signatures && letter.signatures.length > 0) {
        throw Errors.badRequest(
          'Surat yang sudah memiliki tanda tangan elektronik tidak dapat diubah.'
        );
      }

      // Authorization check: creator, unit correspondence role (same unit only),
      // executive foundation roles, or SUPER_ADMIN. A unit-scope holder must be
      // in the letter's own unit — otherwise a correspondence officer from any
      // unit who happens to be on the letter's review chain (which assertLetterAccess
      // above admits cross-unit) could edit another unit's draft.
      const isCreator = actor.id === letter.createdById;
      const isExecutive =
        actor.roleCode === RoleCode.YAYASAN_KETUA ||
        actor.roleCode === RoleCode.YAYASAN_SEKRETARIS ||
        actor.roleCode === RoleCode.SUPER_ADMIN;
      const isSameUnitCorrespondence =
        handlesUnitCorrespondence(actor) && actor.unitId === letter.unitId;

      if (!isCreator && !isExecutive && !isSameUnitCorrespondence) {
        throw Errors.forbidden('Anda tidak berwenang mengubah surat ini.');
      }

      // Now that status, signature and authorization have all passed, validate
      // the requested participant list. A read-only reviewer cannot reach this
      // point, so the eligibility probe is no longer an oracle.
      if (participantsToValidate.length > 0) {
        await this.validateParticipantEligibility(participantsToValidate, actor);
      }

      // If letter already has an assigned letterNumber, forbid changing type or classificationId to prevent number category mismatches
      const fullLetter = await tx.letter.findUnique({
        where: { id: letterId },
        select: { letterNumber: true },
      });

      if (fullLetter?.letterNumber) {
        if (data.type !== undefined && data.type !== letter.type) {
          throw Errors.badRequest(
            'Jenis surat tidak dapat diubah karena nomor surat sudah terbit.'
          );
        }
        if (data.classificationId !== undefined) {
          throw Errors.badRequest(
            'Klasifikasi surat tidak dapat diubah karena nomor surat sudah terbit.'
          );
        }
      }

      const targetType = (data.type as DbLetterType | undefined) ?? letter.type;
      const targetNature = (data.nature as DbLetterNature | undefined) ?? letter.nature;
      assertNatureAllowed(targetType, targetNature);

      // Build update payload. Tracks whether the request actually changes
      // anything, so an empty PATCH is not recorded as a fake "EDITED" audit
      // entry (the flow log is append-only; a no-op edit claims an edit that
      // never happened).
      const updateData: Prisma.LetterUpdateInput = {};
      let hasChange = false;

      if (data.type !== undefined) {
        updateData.type = data.type as DbLetterType;
        hasChange = true;
      }
      if (data.classificationId !== undefined) {
        updateData.classification = data.classificationId
          ? { connect: { id: data.classificationId } }
          : { disconnect: true };
        hasChange = true;
      }
      if (data.date !== undefined) {
        updateData.date = new Date(data.date);
        hasChange = true;
      }
      if (data.receivedAt !== undefined) {
        updateData.receivedAt = data.receivedAt ? new Date(data.receivedAt) : null;
        hasChange = true;
      }
      if (data.subject !== undefined) {
        updateData.subject = data.subject;
        hasChange = true;
      }
      if (data.content !== undefined) {
        updateData.content = data.content;
        hasChange = true;
      }
      if (data.fileUrl !== undefined) {
        updateData.fileUrl = data.fileUrl;
        /**
         * Jalur penyusunan ikut berkasnya, selama suratnya masih dapat diubah.
         *
         * Penyusun boleh menyusun draf dulu, lalu mengunggah naskahnya
         * belakangan — atau menghapus unggahannya dan kembali ke naskah yang
         * disusun sistem. Karena hanya DRAFT/REVISION_NEEDED yang sampai ke
         * sini, dan surat bertanda tangan sudah ditolak di atas, jalurnya masih
         * bebas ditetapkan ulang; sesudah ditandatangani ia tidak lagi berubah.
         */
        if (letter.direction === 'OUTGOING') {
          updateData.authoringTrack = data.fileUrl ? 'UPLOADED' : 'GENERATED';
        }
        hasChange = true;
      }
      if (data.urgency !== undefined) {
        updateData.urgency = data.urgency as any;
        hasChange = true;
      }
      if (data.nature !== undefined) {
        updateData.nature = data.nature as any;
        hasChange = true;
      }
      if (data.senderName !== undefined) {
        updateData.senderName = data.senderName;
        hasChange = true;
      }
      if (data.senderTitle !== undefined) {
        updateData.senderTitle = data.senderTitle;
        hasChange = true;
      }
      if (data.senderInstance !== undefined) {
        updateData.senderInstance = data.senderInstance;
        hasChange = true;
      }
      if (data.recipientName !== undefined) {
        updateData.recipientName = data.recipientName;
        hasChange = true;
      }
      if (data.recipientInstance !== undefined) {
        updateData.recipientInstance = data.recipientInstance;
        hasChange = true;
      }

      if (Object.keys(updateData).length > 0) {
        await tx.letter.update({
          where: { id: letterId },
          data: updateData,
        });
      }

      // Update Reviewers if provided
      if (data.reviewerIds) {
        hasChange = true;
        const uniqueReviewers = Array.from(new Set(data.reviewerIds));
        if (letter.status === DbLetterStatus.REVISION_NEEDED && uniqueReviewers.length === 0) {
          throw Errors.badRequest(
            'Surat yang dalam perbaikan revisi wajib memiliki minimal satu pemeriksa/verifikator.'
          );
        }
        await tx.letterReviewer.deleteMany({ where: { letterId } });
        if (uniqueReviewers.length > 0) {
          await tx.letterReviewer.createMany({
            data: uniqueReviewers.map((reviewerId, index) => ({
              letterId,
              reviewerId,
              order: index + 1,
              status: 'PENDING',
              isSigner: false,
            })),
          });
        }
      }

      // Update Recipients if provided
      if (data.recipientIds) {
        hasChange = true;
        const uniqueRecipients = Array.from(new Set(data.recipientIds));
        await tx.letterRecipient.deleteMany({ where: { letterId, isCC: false } });
        if (uniqueRecipients.length > 0) {
          await tx.letterRecipient.createMany({
            data: uniqueRecipients.map((recipientId) => ({
              letterId,
              userId: recipientId,
              unitId: letter.unitId,
              isCC: false,
            })),
          });
        }
        // If CC recipients were NOT provided in this update, remove any CC rows for users promoted to primary recipients
        if (!data.ccRecipients && uniqueRecipients.length > 0) {
          await tx.letterRecipient.deleteMany({
            where: {
              letterId,
              isCC: true,
              userId: { in: uniqueRecipients },
            },
          });
        }
      }

      // Update CC Recipients if provided
      if (data.ccRecipients) {
        hasChange = true;
        await tx.letterRecipient.deleteMany({ where: { letterId, isCC: true } });
        const primaryRecipientIds =
          data.recipientIds ??
          letter.recipients.map((r) => r.userId).filter((id): id is string => !!id);
        const ccRows = buildCcRows(letterId, letter.unitId, data.ccRecipients, primaryRecipientIds);
        if (ccRows.length > 0) {
          await tx.letterRecipient.createMany({ data: ccRows });
        }
      }

      // Update Attachments if provided
      if (data.attachments) {
        hasChange = true;
        await tx.letterAttachment.deleteMany({ where: { letterId } });
        if (data.attachments.length > 0) {
          await tx.letterAttachment.createMany({
            data: data.attachments.map((att, index) => ({
              letterId,
              name: att.name,
              fileUrl: att.fileUrl,
              mimeType: att.mimeType ?? null,
              sizeBytes: att.sizeBytes ?? null,
              order: index + 1,
              uploadedById: userId,
            })),
          });
        }
      }

      // Only record an EDITED flow entry when the request actually changed
      // something. The flow log is append-only, so a no-op PATCH must not forge
      // an edit that never happened (Flag: "Edit kosong memalsukan riwayat surat").
      if (hasChange) {
        await recordFlow(tx, {
          letterId,
          actorId: userId,
          action: LetterFlowAction.EDITED,
          fromStatus: letter.status,
          toStatus: letter.status,
          note: 'Naskah surat diperbarui',
        });
      }

      return await tx.letter.findUnique({
        where: { id: letterId },
        include: LETTER_PDF_RELATIONS,
      });
    });
  },

  /**
   * `unitId` is an optional *narrowing* on top of what `actor` may see — not
   * the access rule itself. Foundation and cross-unit roles have no unit of
   * their own, so `undefined` means "every unit they are entitled to", not
   * "no rows".
   */
  async getLetters(
    unitId: string | undefined,
    params: {
      page?: number;
      limit?: number;
      direction?: LetterDirection;
      status?: LetterStatus;
      search?: string;
      scope?: 'ALL' | 'PERSONAL';
      userId?: string;
      actor: LetterActor;
    }
  ) {
    const page = params.page || 1;
    const limit = params.limit || 10;
    const skip = (page - 1) * limit;

    // Every independent restriction is its own AND term. Written as sibling
    // keys, a second `OR` would silently replace the first — the same way the
    // dormitory filter lost its unit scope.
    const and: Prisma.LetterWhereInput[] = [letterScopeWhere(params.actor)];

    if (unitId) and.push({ unitId });

    if (params.search) {
      and.push({
        OR: [
          { subject: { contains: params.search, mode: 'insensitive' } },
          { letterNumber: { contains: params.search, mode: 'insensitive' } },
          { senderName: { contains: params.search, mode: 'insensitive' } },
        ],
      });
    }

    if (params.scope === 'PERSONAL' && params.userId) {
      and.push({
        OR: [
          { recipients: { some: { userId: params.userId } } },
          { dispositions: { some: { recipientId: params.userId } } },
        ],
      });
    }

    const where: Prisma.LetterWhereInput = {
      direction: params.direction ? (params.direction as any) : undefined,
      status: params.status ? (params.status as any) : undefined,
      AND: and,
    };

    const [total, data] = await Promise.all([
      prisma.letter.count({ where }),
      prisma.letter.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          classification: true,
          createdBy: { select: { name: true } },
          reviewers: {
            include: {
              reviewer: { select: { name: true } },
            },
            orderBy: { order: 'asc' },
          },
        },
      }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Buku agenda sebagai CSV — bentuk yang dapat dicetak dan diserahkan.
   *
   * Sebelum ini tidak ada satu pun jalan keluar dari daftar surat: sebuah buku
   * agenda yang hanya ada di layar tidak dapat ditandatangani, diarsipkan, atau
   * diserahkan kepada pemeriksa. Ia memakai penyaring akses yang sama persis
   * dengan daftar — `letterScopeWhere` — sehingga ekspor tidak menjadi pintu
   * belakang untuk membaca apa yang daftarnya sembunyikan.
   *
   * Naskah berklasifikasi tetap ikut bila aktornya memang berhak, dan kolom
   * sifatnya tercetak apa adanya supaya pembaca berkas tahu tingkatannya.
   */
  async exportAgendaCsv(
    actor: LetterActor,
    filters: {
      direction?: LetterDirection;
      status?: LetterStatus;
      search?: string;
      scope?: 'ALL' | 'PERSONAL';
      from?: string;
      to?: string;
    }
  ): Promise<string> {
    const and: Prisma.LetterWhereInput[] = [letterScopeWhere(actor)];

    /**
     * Batas atas rentang bersifat eksklusif pada awal hari berikutnya.
     *
     * `Letter.date` adalah tanggal, tetapi disimpan sebagai `timestamp`; bila
     * kelak ada baris dengan jam selain tengah malam, `lte tengah malam` akan
     * menjatuhkan surat yang bertanggal sama. Menutup rentangnya dengan
     * `< awal hari berikutnya` membuat "sampai dengan 31 Desember" benar
     * terlepas dari jam yang tersimpan.
     */
    const date: Prisma.DateTimeFilter = {};
    if (filters.from) date.gte = startOfDay(new Date(filters.from));
    if (filters.to) date.lt = startOfNextDay(new Date(filters.to));
    if (filters.from || filters.to) and.push({ date });

    // Penyaring yang sama persis dengan daftar surat: buku agenda yang
    // diserahkan harus memuat baris yang tampak di layar, bukan lebih.
    if (filters.search) {
      and.push({
        OR: [
          { subject: { contains: filters.search, mode: 'insensitive' } },
          { letterNumber: { contains: filters.search, mode: 'insensitive' } },
          { senderName: { contains: filters.search, mode: 'insensitive' } },
        ],
      });
    }
    if (filters.scope === 'PERSONAL') {
      and.push({
        OR: [
          { recipients: { some: { userId: actor.id } } },
          { dispositions: { some: { recipientId: actor.id } } },
        ],
      });
    }

    const letters = await prisma.letter.findMany({
      where: {
        direction: filters.direction as any,
        status: filters.status as any,
        AND: and,
      },
      orderBy: { date: 'asc' },
      include: {
        classification: { select: { code: true, name: true } },
        unit: { select: { name: true } },
      },
    });

    const rows = letters.map((letter) => [
      letter.agendaNumber ?? '',
      letter.letterNumber ?? '',
      letter.direction === LetterDirection.INCOMING ? 'Masuk' : 'Keluar',
      letter.date instanceof Date ? letter.date.toISOString().slice(0, 10) : String(letter.date),
      letter.subject,
      // Cadangan instansi ikut, dan sisi yang dipakai mengikuti arah surat —
      // sama persis dengan yang tampak di daftar. Lihat `letterPartyName`.
      letterPartyName(letter),
      letter.classification?.code ?? '',
      letter.classification?.name ?? '',
      LETTER_NATURE_LABELS[letter.nature as keyof typeof LETTER_NATURE_LABELS] ?? letter.nature,
      LETTER_STATUS_LABELS[letter.status as keyof typeof LETTER_STATUS_LABELS] ?? letter.status,
      letter.unit?.name ?? '',
    ]);

    return toCsv(
      [
        'Nomor Agenda',
        'Nomor Surat',
        'Arah',
        'Tanggal',
        'Perihal',
        'Pengirim/Penerima',
        'Kode Klasifikasi',
        'Klasifikasi',
        'Sifat',
        'Status',
        'Unit',
      ],
      rows
    );
  },

  /**
   * Peninjauan retensi untuk petugas kearsipan — daftar usul, bukan tindakan.
   *
   * Sampai sekarang hasil peninjauan hanya sampai ke `logger` penjadwal dan
   * perintah CLI; seorang petugas arsip tidak punya layar untuk melihatnya, dan
   * laporan yang tak terbaca tidak mengubah kepatuhan apa pun. Rute ini
   * memberikan permukaannya, tanpa menambah kemampuan menghapus: memusnahkan
   * arsip menuntut penilaian dan berita acara (UU 43/2009 Pasal 51–52 dan PP 28/2012),
   * jadi yang disediakan hanyalah daftar dan ekspornya.
   *
   * Cakupannya dijaga `reviewLetterRetentionForActor`; rutenya menjaga bahwa
   * hanya jabatan yang memang mengurus surat — Tata Usaha, kepala sekolah, dan
   * pengurus yayasan — yang dapat membukanya.
   */
  async reviewRetention(actor: LetterActor): Promise<LetterRetentionSummary> {
    return reviewLetterRetentionForActor(prisma, actor);
  },

  /**
   * Ekspor CSV daftar retensi — kolom yang sama dengan buku agenda, ditambah
   * klasifikasi dan masa retensi, supaya petugas dapat menyerahkan usulnya
   * dalam bentuk yang dapat dibuka di Excel.
   *
   * Kolomnya dicetak dalam bahasa Indonesia dan nama unit, bukan nilai enum
   * `nature` dan id unit: berkas ini diserahkan kepada petugas kearsipan dan
   * pengawas, yang tidak menghafal kode enum maupun UUID unit. Nama unit
   * diambil dari tabel unit, dan satu kueri mengumpulkannya sekaligus supaya
   * jumlah baris tidak menambah jumlah kueri.
   */
  async exportRetentionCsv(actor: LetterActor): Promise<string> {
    const summary = await reviewLetterRetentionForActor(prisma, actor);

    const unitIds = [...new Set(summary.due.map((letter) => letter.unitId))];
    const units = unitIds.length
      ? await prisma.unit.findMany({
          where: { id: { in: unitIds } },
          select: { id: true, name: true },
        })
      : [];
    const unitName = new Map(units.map((unit) => [unit.id, unit.name]));

    const rows = summary.due.map((letter) => [
      letter.agendaNumber ?? '',
      letter.letterNumber ?? '',
      toDateOnly(letter.letterDate),
      letter.subject,
      letter.classificationCode ?? '',
      letter.classificationName ?? '',
      `${letter.retentionYears} tahun`,
      toDateOnly(letter.dueAt),
      LETTER_NATURE_LABELS[letter.nature as keyof typeof LETTER_NATURE_LABELS] ?? letter.nature,
      unitName.get(letter.unitId) ?? letter.unitId,
    ]);

    return toCsv(
      [
        'Nomor Agenda',
        'Nomor Surat',
        'Tanggal Surat',
        'Perihal',
        'Kode Klasifikasi',
        'Klasifikasi',
        'Masa Retensi',
        'Retensi Berakhir',
        'Sifat',
        'Unit',
      ],
      rows
    );
  },

  /**
   * `actor` is required, not optional: this route used to return any letter to
   * any authenticated caller. Making the parameter mandatory means a future
   * caller cannot reintroduce the hole by simply forgetting to pass it.
   */
  async getLetterById(id: string, actor: LetterActor) {
    await assertLetterAccess(actor, id);

    return await prisma.letter.findUnique({
      where: { id },
      include: {
        /**
         * Unit, lampiran, dan penerima — bentuk yang sama persis dengan yang
         * dibaca jalur penandatanganan.
         *
         * Halaman ini juga yang memberi makan `resolveLetterPdf`, jadi kalau
         * kedua jalur mengambil relasi yang berbeda, naskah yang dicetak
         * berbeda dari naskah yang di-hash dan verifikasi publik menyebut surat
         * yang sah sebagai berubah. Satu tetapan, dipakai keduanya.
         */
        ...LETTER_PDF_RELATIONS,
        classification: true,
        createdBy: { select: { name: true } },
        reviewers: {
          include: {
            reviewer: {
              // NIP tetap di sini: halaman surat hanya terbuka bagi yang sudah
              // masuk dan berhak membacanya, dan nomor induk memang keterangan
              // internal. Yang dihapus adalah NIP pada naskah yang beredar dan
              // pada halaman verifikasi publik, bukan NIP di meja sendiri.
              select: {
                name: true,
                teacher: { select: { nip: true } },
                staff: { select: { nip: true } },
              },
            },
          },
          orderBy: { order: 'asc' },
        },
        // Buku ekspedisi naskah ini, terbaru di atas: yang dicari petugas
        // hampir selalu pengiriman terakhir.
        dispatches: {
          include: { dispatchedBy: { select: { name: true } } },
          orderBy: { dispatchedAt: 'desc' },
        },
        /**
         * Oldest first, like the flow history below it.
         *
         * The disposition trail is read as a story — this official forwarded it
         * to that one, who forwarded it on — and newest-first told it backwards
         * while drawing a connector line that implied forwards. It also decided
         * which disposition `activeDisposition` picked when someone held more
         * than one; oldest-outstanding is the one that should be acted on first.
         */
        dispositions: {
          include: {
            sender: { select: { name: true } },
            recipient: { select: { name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        // Oldest first: this is read as a story, and a story told backwards
        // makes the reader reconstruct the order themselves.
        flowEvents: {
          include: {
            actor: { select: { name: true } },
            target: { select: { name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        /**
         * The signature belongs to the letter, not to the moment it was
         * created. Without it here the QR existed only inside the dialog shown
         * once at signing: close it and the naskah could no longer be printed
         * with anything to scan, which is the whole point of signing it.
         *
         * `signature` and `digest` are not selected — the naskah carries the
         * token, and the proof is checked by the public verify endpoint. The
         * caller has already passed `assertLetterAccess` above, so this adds
         * nothing they could not already read.
         */
        /**
         * Permohonan pencabutan ikut bersama suratnya.
         *
         * Halaman suratnya sendiri adalah tempat pejabat berwenang akan
         * melihatnya — pemberitahuan pun mengarahkannya ke sana — sehingga
         * permohonan tidak memerlukan menu tersendiri untuk sampai ke mejanya.
         */
        revocationRequests: {
          include: {
            requester: { select: { id: true, name: true, email: true } },
            decidedBy: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        signatures: {
          select: {
            id: true,
            signedAt: true,
            verificationToken: true,
            algorithm: true,
            // A revoked signature must not print as a valid one — and the
            // reason travels with it, so the letter's own page can say why
            // instead of leaving the reader to find out from the public
            // verification form.
            // Kewenangan mencabut diukur terhadap jabatan penandatangan saat
            // menandatangani, jadi antarmuka pun perlu membacanya untuk
            // menawarkan tombol yang sama dengan yang akan diterima server.
            signerRoleCode: true,
            revokedAt: true,
            revokedReason: true,
            revokedByRoleCode: true,
            /**
             * Nama pencabut **saat mencabut**, bukan dari akunnya hari ini.
             *
             * Cap DICABUT mencetak nama ini, dan hash salinan bercap dihitung
             * atas nama itu. Membacanya dari `revokedBy.name` membuat satu
             * penggantian nama mengubah byte salinan yang diunduh, sehingga
             * hashnya tak lagi cocok dan salinan resmi sistem sendiri dijawab
             * "tidak terdaftar" oleh verifikasi publik.
             */
            revokedByName: true,
            revokedBy: { select: { name: true } },
            // Dipakai pencetakan salinan bercap: naskah yang dihasilkan ulang
            // harus terbukti masih sama persis dengan yang di-hash saat
            // ditandatangani sebelum boleh dicap dan diserahkan.
            pdfHash: true,
            signer: {
              // Nama saja: naskah tidak lagi mencetak NIP.
              select: { name: true },
            },
          },
          orderBy: { signedAt: 'asc' },
        },
      },
    });
  },

  async processReview(
    letterId: string,
    reviewerId: string,
    action: 'APPROVE' | 'REJECT',
    notes?: string,
    nextReviewerId?: string,
    isFinalSigner?: boolean,
    actor?: LetterActor
  ) {
    if (nextReviewerId) {
      await this.validateParticipantEligibility([nextReviewerId], actor);
    }
    const result = await prisma.$transaction(async (tx) => {
      // Row locking to serialize concurrent review requests on the same letter
      await tx.$executeRaw`SELECT id FROM letters WHERE id = ${letterId} FOR UPDATE`;

      const letter = await tx.letter.findUnique({
        where: { id: letterId },
        select: {
          id: true,
          status: true,
          createdById: true,
          direction: true,
          unitId: true,
          reviewers: true,
          recipients: { select: { userId: true } },
        },
      });
      if (!letter) throw new Error('Letter not found');

      const ladder: ReviewerRung[] = letter.reviewers.map((r) => ({
        id: r.id,
        reviewerId: r.reviewerId,
        order: r.order,
        status: r.status,
        isSigner: r.isSigner,
      }));

      const mine = assertMayReview(letter.status, ladder, reviewerId);

      let updatedLadder: ReviewerRung[] = [...ladder];

      if (action === 'APPROVE') {
        if (nextReviewerId === reviewerId) {
          throw new Error('Tidak dapat meneruskan surat kepada diri sendiri.');
        }

        // Validate that an approval specifies either a nextReviewerId, isFinalSigner, or an existing signer
        const hasExistingSigner = updatedLadder.some((r) => r.isSigner);
        if (!nextReviewerId && !isFinalSigner && !hasExistingSigner) {
          throw new Error(
            'Harus memilih pejabat penerus atau menandai sebagai penandatangan akhir.'
          );
        }

        if (isFinalSigner) {
          // Transactionally ensure exactly one active final signer
          await tx.letterReviewer.updateMany({
            where: { letterId },
            data: { isSigner: false },
          });
          updatedLadder = updatedLadder.map((r) => ({ ...r, isSigner: false }));
        }

        // If approving and nextReviewerId is provided, add or update the next reviewer dynamically
        if (nextReviewerId) {
          const existingNext = letter.reviewers.find((r) => r.reviewerId === nextReviewerId);
          const nonSigners = letter.reviewers.filter(
            (r) => !r.isSigner && r.id !== existingNext?.id
          );
          const maxNonSignerOrder = Math.max(...nonSigners.map((r) => r.order), mine.order, 0);
          const newNextOrder = maxNonSignerOrder + 1;

          if (existingNext) {
            const updatedIsSigner = isFinalSigner ? true : existingNext.isSigner;
            await tx.letterReviewer.update({
              where: { id: existingNext.id },
              data: {
                order: newNextOrder,
                status: 'PENDING',
                reviewedAt: null,
                isSigner: updatedIsSigner,
              },
            });
            updatedLadder = updatedLadder.map((r) =>
              r.id === existingNext.id
                ? { ...r, order: newNextOrder, status: 'PENDING', isSigner: updatedIsSigner }
                : r
            );
          } else {
            const newRung = await tx.letterReviewer.create({
              data: {
                letterId,
                reviewerId: nextReviewerId,
                order: newNextOrder,
                status: 'PENDING',
                isSigner: !!isFinalSigner,
              },
            });
            updatedLadder.push({
              id: newRung.id,
              reviewerId: nextReviewerId,
              order: newNextOrder,
              status: 'PENDING',
              isSigner: !!isFinalSigner,
            });
          }

          // If nextReviewerId is NOT marked as final signer, move any existing signer to sit AFTER nextReviewerId
          if (!isFinalSigner) {
            const existingSigners = letter.reviewers.filter(
              (r) => r.isSigner && r.id !== existingNext?.id
            );
            for (const signer of existingSigners) {
              const shiftedOrder = newNextOrder + 1;
              await tx.letterReviewer.update({
                where: { id: signer.id },
                data: { order: shiftedOrder },
              });
              updatedLadder = updatedLadder.map((r) =>
                r.id === signer.id ? { ...r, order: shiftedOrder } : r
              );
            }
          }
        } else if (isFinalSigner) {
          // Mark current reviewer as signer if specified (restoring flag after bulk reset even if previously a signer)
          updatedLadder = updatedLadder.map((r) =>
            r.reviewerId === reviewerId ? { ...r, isSigner: true } : r
          );
          await tx.letterReviewer.update({
            where: { id: mine.id },
            data: { isSigner: true },
          });
        }
      }

      let nextStatus =
        action === 'APPROVE'
          ? statusAfterApproval(updatedLadder, reviewerId)
          : DbLetterStatus.REVISION_NEEDED;

      const reviewFinished =
        action === 'APPROVE' &&
        !nextRung(
          updatedLadder.map((r) => (r.reviewerId === reviewerId ? { ...r, status: 'APPROVED' } : r))
        );
      const disposedRecipients: string[] = [];

      if (action === 'APPROVE') {
        if (letter.direction === 'INCOMING' && reviewFinished) {
          /**
           * A2 & A6: penyelesaian review surat masuk tidak menuntut penanda
           * tangan. Ada penerima → DISPOSED; tidak ada → surat itu selesai.
           *
           * Sebelumnya "selesai" ditulis sebagai **SENT**, dan itu keliru dalam
           * arti yang paling harfiah: sebuah surat *masuk* dicatat sebagai
           * terkirim. Statusnya tampil "Terkirim" di daftar surat, penyaring
           * status menghitungnya bersama surat keluar, dan satu-satunya keadaan
           * yang seharusnya berarti "naskah ini sudah meninggalkan kantor"
           * justru paling sering diisi oleh surat yang baru saja tiba.
           *
           * ARCHIVED, karena itulah yang sebenarnya terjadi: surat masuk yang
           * sudah diverifikasi dan tidak perlu diteruskan kepada siapa pun sudah
           * selesai perjalanannya, dan yang tersisa hanyalah menyimpannya.
           * Peristiwanya dicatat tersendiri di bawah, supaya riwayat alurnya
           * menyebut siapa yang menutup surat itu dan atas dasar apa — bukan
           * berpindah status tanpa keterangan.
           */
          const hasRecipients = letter.recipients && letter.recipients.length > 0;
          nextStatus = hasRecipients ? DbLetterStatus.DISPOSED : DbLetterStatus.ARCHIVED;

          if (!hasRecipients) {
            await recordFlow(tx, {
              letterId: letter.id,
              actorId: reviewerId,
              action: LetterFlowAction.ARCHIVED,
              fromStatus: letter.status,
              toStatus: DbLetterStatus.ARCHIVED,
              note: 'Selesai diverifikasi tanpa disposisi; surat langsung diarsipkan.',
            });
          }

          // When review finishes for an INCOMING letter with recipients, create live Disposition tasks
          if (hasRecipients) {
            const uniqueRecipientIds = Array.from(
              new Set(letter.recipients.map((r) => r.userId).filter(Boolean))
            ) as string[];

            for (const recipientId of uniqueRecipientIds) {
              const existingDisp = await tx.disposition.findFirst({
                where: { letterId: letter.id, recipientId, status: { not: 'COMPLETED' } },
              });

              if (!existingDisp) {
                await tx.disposition.create({
                  data: {
                    letterId: letter.id,
                    senderId: reviewerId,
                    recipientId,
                    instruction: 'Surat Masuk Diteruskan',
                    status: 'PENDING',
                  },
                });

                await recordFlow(tx, {
                  letterId: letter.id,
                  actorId: reviewerId,
                  action: LetterFlowAction.DISPOSED,
                  targetId: recipientId,
                  fromStatus: letter.status,
                  toStatus: DbLetterStatus.DISPOSED,
                  note: 'Surat Masuk Diteruskan',
                });

                disposedRecipients.push(recipientId);
              }
            }
          }
        } else if (nextStatus === DbLetterStatus.SIGNED) {
          // Review approval alone must NEVER set status directly to SIGNED for outgoing letters — signing requires E-Sign passphrase via esign.service.
          nextStatus = DbLetterStatus.READY_TO_SIGN;
        }
      }

      await tx.letterReviewer.update({
        where: { id: mine.id },
        data: {
          status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          notes,
          reviewedAt: new Date(),
        },
      });

      await tx.letter.update({
        where: { id: letterId },
        data: { status: nextStatus },
      });

      await recordFlow(tx, {
        letterId,
        actorId: reviewerId,
        action:
          action === 'REJECT'
            ? LetterFlowAction.REVISION_REQUESTED
            : nextStatus === DbLetterStatus.SIGNED
              ? LetterFlowAction.SIGNED
              : LetterFlowAction.APPROVED,
        targetId: action === 'REJECT' ? letter.createdById : nextReviewerId || null,
        fromStatus: letter.status,
        toStatus: nextStatus,
        note: notes
          ? nextReviewerId
            ? `${notes} [Diteruskan]`
            : notes
          : nextReviewerId
            ? 'Diteruskan ke peninjau berikutnya'
            : null,
      });

      return {
        success: true,
        signed: nextStatus === DbLetterStatus.SIGNED,
        rejected: action === 'REJECT',
        authorId: letter.createdById,
        status: nextStatus,
        disposedRecipients,
      };
    });

    // A returned draft is only actionable if its author hears about it.
    // Nothing told them before, so REVISION_NEEDED was a silent dead end.
    if (result.rejected) {
      const letter = await prisma.letter.findUnique({
        where: { id: letterId },
        select: { subject: true, unitId: true },
      });
      eventBus.emit('notification:send', {
        userId: result.authorId,
        unitId: letter?.unitId,
        type: 'REMINDER',
        title: 'Surat Dikembalikan untuk Revisi',
        message: `Konsep "${letter?.subject ?? ''}" dikembalikan${notes ? `: ${notes}` : '.'}`,
        data: { letterId, link: `/e-office/letter/${letterId}` },
      });
    }

    // Post-commit: notify recipients for automatic dispositions created upon incoming review completion
    if (result.disposedRecipients && result.disposedRecipients.length > 0) {
      const letter = await prisma.letter.findUnique({
        where: { id: letterId },
        select: { subject: true, unitId: true },
      });
      for (const recipientId of result.disposedRecipients) {
        eventBus.emit('notification:send', {
          userId: recipientId,
          unitId: letter?.unitId,
          type: 'REMINDER',
          title: 'Disposisi Baru',
          message: `Anda menerima disposisi baru untuk surat "${letter?.subject ?? ''}".`,
          data: { letterId, link: `/e-office/letter/${letterId}` },
        });
      }
    }

    // Post-commit: when a letter is forwarded to a next reviewer, notify that official.
    if (action === 'APPROVE' && nextReviewerId) {
      const letter = await prisma.letter.findUnique({
        where: { id: letterId },
        select: { subject: true, unitId: true },
      });
      eventBus.emit('notification:send', {
        userId: nextReviewerId,
        unitId: letter?.unitId,
        type: 'REMINDER',
        title: 'Konsep Surat Perlu Ditinjau',
        message: `Konsep surat "${letter?.subject ?? ''}" diteruskan kepada Anda untuk ditinjau.`,
        data: { letterId, link: `/e-office/letter/${letterId}` },
      });
    }

    // Post-commit: when a letter has been signed, notify its creator so they can
    // proceed (dispatch/archive). Done outside the transaction so the listener
    // sees the committed SIGNED status.
    if (result.signed) {
      const letter = await prisma.letter.findUnique({
        where: { id: letterId },
        select: { createdById: true, unitId: true, subject: true, letterNumber: true },
      });
      if (letter) {
        eventBus.emit('notification:send', {
          userId: letter.createdById,
          unitId: letter.unitId,
          type: 'INFO',
          title: 'Surat Telah Ditandatangani',
          message: `Surat "${letter.subject}"${
            letter.letterNumber ? ` (${letter.letterNumber})` : ''
          } telah ditandatangani dan siap diproses.`,
          data: { letterId },
        });
      }
    }

    return { success: true };
  },

  /**
   * Submit an existing DRAFT letter into review (PENDING_REVIEW).
   *
   * Only the creator can submit their draft, and only when at least one
   * reviewer is assigned.
   */
  async submitForReview(
    letterId: string,
    actor: LetterActor,
    note?: string,
    reviewerIds?: string[]
  ) {
    await assertLetterAccess(actor, letterId);

    if (reviewerIds && reviewerIds.length > 0) {
      await this.validateParticipantEligibility(reviewerIds, actor);
    }

    const result = await prisma.$transaction(async (tx) => {
      const letter = await tx.letter.findUnique({
        where: { id: letterId },
        select: {
          id: true,
          status: true,
          createdById: true,
          direction: true,
          type: true,
          unitId: true,
          letterNumber: true,
          subject: true,
          reviewers: {
            orderBy: { order: 'asc' },
          },
        },
      });
      if (!letter) throw Errors.notFound('Letter not found');

      // A7: If reviewerIds parameter was not supplied, validate eligibility of stored draft reviewers
      if ((!reviewerIds || reviewerIds.length === 0) && letter.reviewers.length > 0) {
        const storedReviewerIds = letter.reviewers.map((r) => r.reviewerId);
        await this.validateParticipantEligibility(storedReviewerIds, actor);
      }

      if (letter.createdById !== actor.id) {
        throw Errors.forbidden('Hanya pembuat surat yang dapat mengajukan konsep untuk ditinjau');
      }

      if (letter.status !== DbLetterStatus.DRAFT) {
        throw Errors.badRequest('Hanya surat berstatus DRAFT yang dapat diajukan untuk ditinjau');
      }

      let currentReviewers = letter.reviewers;

      // If new reviewerIds are provided, assign them to the draft
      if (reviewerIds && reviewerIds.length > 0) {
        const uniqueReviewerIds = Array.from(new Set(reviewerIds));
        await tx.letterReviewer.deleteMany({ where: { letterId } });
        await tx.letterReviewer.createMany({
          data: uniqueReviewerIds.map((reviewerId, index) => ({
            letterId,
            reviewerId,
            order: index + 1,
            status: 'PENDING',
            isSigner: false,
          })),
        });
        currentReviewers = uniqueReviewerIds.map((rId, index) => ({
          id: `rev-${rId}`,
          reviewerId: rId,
          order: index + 1,
          status: 'PENDING',
          isSigner: false,
        })) as any;
      }

      if (!currentReviewers || currentReviewers.length === 0) {
        throw Errors.badRequest(
          'Konsep surat harus memiliki minimal satu pemeriksa sebelum diajukan'
        );
      }

      // Guard: atomic state transition from DRAFT -> PENDING_REVIEW
      const updated = await tx.letter.updateMany({
        where: { id: letterId, status: DbLetterStatus.DRAFT },
        data: { status: DbLetterStatus.PENDING_REVIEW },
      });

      if (updated.count === 0) {
        throw Errors.badRequest('Surat sudah diajukan atau tidak lagi berstatus DRAFT');
      }

      const nextStatus = DbLetterStatus.PENDING_REVIEW;

      // Allocate letterNumber only AFTER atomic update succeeded
      let letterNumber = letter.letterNumber;
      if (letter.direction === 'OUTGOING' && !letterNumber) {
        const activeYear = await tx.academicYear.findFirst({
          where: { isActive: true },
        });
        const academicYearId = activeYear?.id || 'DEFAULT';
        const typeKey = AGENDA_TYPE_CODE[letter.type as DbLetterType] || 'SKET';
        letterNumber = await this.generateNumber(letter.unitId, typeKey, academicYearId, tx);

        await tx.letter.update({
          where: { id: letterId },
          data: { letterNumber },
        });
      }

      await recordFlow(tx, {
        letterId,
        actorId: actor.id,
        action: LetterFlowAction.SUBMITTED,
        fromStatus: DbLetterStatus.DRAFT,
        toStatus: nextStatus,
        note: note || 'Mengajukan konsep surat untuk ditinjau',
      });

      const sortedReviewers = [...currentReviewers].sort((a, b) => a.order - b.order);
      const firstReviewerId = sortedReviewers[0]?.reviewerId;

      return { id: letterId, status: nextStatus, firstReviewerId, subject: letter.subject };
    });

    // Post-commit: Notify first reviewer when draft is submitted for review
    if (result.firstReviewerId) {
      eventBus.emit('notification:send', {
        userId: result.firstReviewerId,
        type: 'REMINDER',
        title: 'Konsep Surat Perlu Ditinjau',
        message: `Konsep surat "${result.subject}" diajukan kepada Anda untuk ditinjau.`,
        data: { letterId, link: `/e-office/letter/${letterId}` },
      });
    }

    return { id: result.id, status: result.status };
  },

  /**
   * Send a returned draft back up the ladder.
   *
   * This route did not exist. Rejecting a draft set it to REVISION_NEEDED and
   * there it stayed — the author could edit the text but had no way to put it
   * back into review, so every returned letter was abandoned. A rule with no
   * way to satisfy it is not a rule, it is a trap.
   */
  async resubmitLetter(letterId: string, actor: LetterActor, note?: string) {
    await assertLetterAccess(actor, letterId);

    return await prisma.$transaction(async (tx) => {
      const letter = await tx.letter.findUnique({
        where: { id: letterId },
        select: { id: true, status: true, createdById: true, reviewers: true },
      });
      if (!letter) throw new Error('Letter not found');

      assertMayResubmit(letter.status, letter.createdById, actor.id);

      const ladder: ReviewerRung[] = letter.reviewers.map((r) => ({
        id: r.id,
        reviewerId: r.reviewerId,
        order: r.order,
        status: r.status,
        isSigner: r.isSigner,
      }));
      const nextStatus = statusAfterResubmit(ladder);

      // Every paraf is cleared, not only those below the rejector — see the
      // reasoning in letter-workflow.ts. An approval given to the previous
      // text says nothing about the text now being sent.
      await tx.letterReviewer.updateMany({
        where: { letterId },
        data: { status: 'PENDING', reviewedAt: null },
      });

      await tx.letter.update({
        where: { id: letterId },
        data: { status: nextStatus },
      });

      await recordFlow(tx, {
        letterId,
        actorId: actor.id,
        action: LetterFlowAction.RESUBMITTED,
        fromStatus: letter.status,
        toStatus: nextStatus,
        note,
      });

      return { id: letterId, status: nextStatus };
    });
  },

  /**
   * Ganti seluruh daftar tembusan sebuah naskah.
   *
   * Mengganti, bukan menambah satu per satu, karena yang dikirim antarmuka
   * adalah daftar utuh sesudah disunting — dan urutan adalah bagian dari
   * daftarnya, bukan keterangan tambahan. Menambah dan menghapus per baris
   * akan memerlukan dua endpoint lagi dan tetap tidak dapat memindahkan urutan.
   *
   * **Hanya selama naskah belum ditandatangani.** Tembusan tercetak di kaki
   * naskah, dan byte naskah yang ditandatangani sudah diarsipkan (PR-3): kalau
   * daftar ini boleh berubah sesudahnya, basis data akan menyebut tembusan yang
   * tidak ada pada lembar yang beredar — dan lembar itulah yang dipegang orang.
   */
  async updateLetterCc(letterId: string, actor: LetterActor, cc: LetterCcInput[]) {
    await assertLetterAccess(actor, letterId);

    const internalIds = ccUserIds(cc);
    if (internalIds.length > 0) {
      await this.validateParticipantEligibility(internalIds, actor);
    }

    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM letters WHERE id = ${letterId} FOR UPDATE`;

      const letter = await tx.letter.findUnique({
        where: { id: letterId },
        select: {
          id: true,
          status: true,
          unitId: true,
          createdById: true,
          recipients: { where: { isCC: false }, select: { userId: true } },
          signatures: { select: { id: true } },
        },
      });
      if (!letter) throw Errors.notFound('Surat tidak ditemukan');

      if (letter.signatures.length > 0) {
        throw Errors.badRequest(
          'Naskah ini sudah ditandatangani; daftar tembusannya tercetak pada lembar ' +
            'yang beredar dan tidak dapat diubah lagi.'
        );
      }

      const isCreator = actor.id === letter.createdById;
      const isExecutive =
        actor.roleCode === RoleCode.YAYASAN_KETUA ||
        actor.roleCode === RoleCode.YAYASAN_SEKRETARIS ||
        actor.roleCode === RoleCode.SUPER_ADMIN;
      if (!isCreator && !isExecutive && !handlesUnitCorrespondence(actor)) {
        throw Errors.forbidden('Anda tidak berwenang mengubah tembusan surat ini.');
      }

      // Hanya baris tembusan yang diganti. Penerima utama adalah daftar yang
      // berbeda, dan menghapusnya di sini akan mencabut akses orang yang
      // memang berhak membaca surat ini.
      await tx.letterRecipient.deleteMany({ where: { letterId, isCC: true } });

      const rows = buildCcRows(
        letterId,
        letter.unitId,
        cc,
        letter.recipients.map((r) => r.userId).filter((id): id is string => !!id)
      );
      if (rows.length > 0) {
        await tx.letterRecipient.createMany({ data: rows });
      }

      return { id: letterId, count: rows.length };
    });
  },

  /**
   * Catat bahwa sebuah naskah keluar benar-benar dikirim.
   *
   * Inilah langkah yang selama ini hilang. Surat keluar berjalan
   * DRAFT → PENDING_REVIEW → READY_TO_SIGN → SIGNED → ARCHIVED, dan saat
   * naskahnya diserahkan kepada kurir — satu-satunya saat yang menjadi alasan
   * buku agenda surat keluar ada — tidak tercatat di mana pun. Status SENT ada
   * di skema sejak awal, tetapi yang mengisinya justru surat *masuk*
   * (`processReview`, kini diperbaiki).
   *
   * Yang disimpan bukan sekadar penanda "sudah dikirim": tanggal, saluran,
   * kepada siapa diserahkan, nomor resi, dan tanda terimanya. Ketika penerima
   * menyatakan tidak menerima surat, kelimanya itulah jawabannya — dan sebuah
   * kolom boolean tidak menjawab satu pun.
   *
   * Kewenangannya sama dengan pengarsipan: pembuat surat, petugas persuratan
   * unit, atau pejabat yayasan. Pengiriman adalah perbuatan tata usaha, bukan
   * perbuatan penanda tangan.
   */
  async dispatchLetter(letterId: string, actor: LetterActor, input: DispatchLetterSchemaInput) {
    await assertLetterAccess(actor, letterId);

    const existing = await prisma.letter.findUnique({
      where: { id: letterId },
      select: { createdById: true },
    });
    if (!existing) throw Errors.notFound('Surat tidak ditemukan');

    const isCreator = actor.id === existing.createdById;
    const isExecutive =
      actor.roleCode === RoleCode.YAYASAN_KETUA ||
      actor.roleCode === RoleCode.YAYASAN_SEKRETARIS ||
      actor.roleCode === RoleCode.SUPER_ADMIN;

    if (!isCreator && !isExecutive && !handlesUnitCorrespondence(actor)) {
      throw Errors.forbidden('Anda tidak berwenang mencatat pengiriman surat ini.');
    }

    const dispatchedAt = input.dispatchedAt ? new Date(input.dispatchedAt) : new Date();

    const result = await prisma.$transaction(async (tx) => {
      // Sejalan dengan pengarsipan dan review: dua petugas yang mencatat
      // pengiriman surat yang sama pada saat yang sama tidak boleh saling
      // menimpa `sentAt`.
      await tx.$executeRaw`SELECT id FROM letters WHERE id = ${letterId} FOR UPDATE`;

      const letter = await tx.letter.findUnique({
        where: { id: letterId },
        select: {
          id: true,
          status: true,
          direction: true,
          sentAt: true,
          subject: true,
          unitId: true,
          createdById: true,
          signatures: {
            select: { revokedAt: true },
            orderBy: { signedAt: 'asc' },
          },
        },
      });
      if (!letter) throw Errors.notFound('Surat tidak ditemukan');

      const latestSignature = letter.signatures.at(-1) ?? null;
      assertMayDispatch(letter.direction, letter.status, !!latestSignature?.revokedAt);

      const dispatch = await tx.letterDispatch.create({
        data: {
          letterId,
          dispatchedById: actor.id,
          dispatchedAt,
          channel: input.channel,
          receivedByName: input.receivedByName ?? null,
          trackingNumber: input.trackingNumber ?? null,
          receiptUrl: input.receiptUrl ?? null,
          note: input.note ?? null,
        },
      });

      await tx.letter.update({
        where: { id: letterId },
        data: {
          status: DbLetterStatus.SENT,
          // Pengiriman pertama, dan hanya yang pertama. Surat yang diantar ke
          // beberapa alamat atau dikirim ulang karena tidak sampai tetap
          // "keluar dari kantor" pada tanggal yang pertama itu; setiap
          // percobaannya tetap tersimpan sebagai barisnya sendiri.
          sentAt: letter.sentAt ?? dispatchedAt,
        },
      });

      const channelLabel = LETTER_DISPATCH_CHANNEL_LABELS[input.channel] ?? input.channel;
      await recordFlow(tx, {
        letterId,
        actorId: actor.id,
        action: LetterFlowAction.SENT,
        fromStatus: letter.status,
        toStatus: DbLetterStatus.SENT,
        note: input.receivedByName
          ? `Dikirim lewat ${channelLabel}, diterima ${input.receivedByName}.`
          : `Dikirim lewat ${channelLabel}.`,
      });

      return { letter, dispatch, sentAt: letter.sentAt ?? dispatchedAt };
    });

    // Pembuat surat berhak tahu naskahnya sudah keluar; yang mencatat
    // pengirimannya hampir selalu petugas tata usaha, bukan dia.
    if (result.letter.createdById !== actor.id) {
      eventBus.emit('notification:send', {
        userId: result.letter.createdById,
        unitId: result.letter.unitId,
        type: 'INFO',
        title: 'Surat Sudah Dikirim',
        message: `Surat "${result.letter.subject}" tercatat sudah dikirim.`,
        data: { letterId, link: `/e-office/letter/${letterId}` },
      });
    }

    return {
      id: letterId,
      status: DbLetterStatus.SENT,
      sentAt: result.sentAt,
      dispatch: result.dispatch,
    };
  },

  /**
   * Close a letter's journey.
   *
   * The end of the chain the tata usaha described: the last official to hold
   * the letter files it. Nothing could do this before — an empty
   * `if (status === 'SENT' || 'ARCHIVED') {}` stub sat where the transition
   * belonged, so no letter ever reached ARCHIVED and the disposition chain had
   * no ending.
   */
  async archiveLetter(letterId: string, actor: LetterActor, note?: string) {
    await assertLetterAccess(actor, letterId);

    // B4: Restrict archive authorization to creator, correspondence role, executive foundation roles, or super admin
    const isCreator =
      actor.id ===
      (await prisma.letter.findUnique({ where: { id: letterId }, select: { createdById: true } }))
        ?.createdById;
    const isExecutive =
      actor.roleCode === RoleCode.YAYASAN_KETUA ||
      actor.roleCode === RoleCode.YAYASAN_SEKRETARIS ||
      actor.roleCode === RoleCode.SUPER_ADMIN;
    const isCorrRole = handlesUnitCorrespondence(actor);

    if (!isCreator && !isExecutive && !isCorrRole) {
      throw Errors.forbidden('Anda tidak berwenang mengarsipkan surat ini.');
    }

    return await prisma.$transaction(async (tx) => {
      // A4: Lock letter row to serialize concurrent disposition and archive operations
      await tx.$executeRaw`SELECT id FROM letters WHERE id = ${letterId} FOR UPDATE`;

      const letter = await tx.letter.findUnique({
        where: { id: letterId },
        select: { id: true, status: true },
      });
      if (!letter) throw Errors.notFound('Surat tidak ditemukan');

      assertMayArchive(letter.status);

      // Any disposition still open is closed with the letter. Leaving them
      // PENDING would keep the letter on its recipients' to-do lists forever
      // while the letter itself was filed and done.
      await tx.disposition.updateMany({
        where: { letterId, status: { not: 'COMPLETED' } },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      await tx.letter.update({
        where: { id: letterId },
        data: { status: DbLetterStatus.ARCHIVED },
      });

      await recordFlow(tx, {
        letterId,
        actorId: actor.id,
        action: LetterFlowAction.ARCHIVED,
        fromStatus: letter.status,
        toStatus: DbLetterStatus.ARCHIVED,
        note,
      });

      return { id: letterId, status: DbLetterStatus.ARCHIVED };
    });
  },

  /**
   * Anyone authenticated could previously inject a disposition into any
   * letter's chain — and because a disposition is itself a grant of access,
   * that was also a way to grant yourself the letter.
   */
  async createDisposition(data: CreateDispositionInput, actor: LetterActor) {
    const letter = await assertLetterAccess(actor, data.letterId);

    if (letter.status === DbLetterStatus.ARCHIVED) {
      throw new Error('Surat sudah diarsipkan; buka kembali arsipnya sebelum mendisposisikan.');
    }

    const rawRecipients =
      data.recipientIds && data.recipientIds.length > 0
        ? data.recipientIds
        : data.recipientId
          ? [data.recipientId]
          : [];

    // Deduplicate recipient IDs to prevent duplicate dispositions for the same person
    const recipients = Array.from(new Set(rawRecipients));

    if (recipients.length === 0) {
      throw new Error('Minimal satu penerima disposisi harus ditentukan.');
    }

    await this.validateParticipantEligibility(recipients, actor);

    const { allDispositions, newlyCreatedDispositions } = await prisma.$transaction(async (tx) => {
      // Row lock letter for concurrent disposition protection
      await tx.$executeRaw`SELECT id FROM letters WHERE id = ${letter.id} FOR UPDATE`;

      // Re-read letter status under row lock to prevent race conditions with concurrent archive operations
      const txLetter = await tx.letter.findUnique({
        where: { id: letter.id },
        select: { id: true, status: true, direction: true, unitId: true },
      });

      if (!txLetter) throw Errors.notFound('Surat tidak ditemukan');

      if (txLetter.status === DbLetterStatus.ARCHIVED) {
        throw new Error('Surat sudah diarsipkan; buka kembali arsipnya sebelum mendisposisikan.');
      }

      const allDispositions = [];
      const newlyCreatedDispositions = [];

      for (const targetRecipientId of recipients) {
        // A5: Deduplicate only identical dispositions (same letter, recipient, sender, instruction)
        const existingDisp = await tx.disposition.findFirst({
          where: {
            letterId: txLetter.id,
            recipientId: targetRecipientId,
            senderId: data.senderId,
            instruction: data.instruction,
            status: { not: 'COMPLETED' },
          },
        });
        if (existingDisp) {
          allDispositions.push(existingDisp);
          continue;
        }

        const created = await tx.disposition.create({
          data: {
            letterId: data.letterId,
            senderId: data.senderId,
            recipientId: targetRecipientId,
            instruction: data.instruction,
            deadline: data.deadline ? new Date(data.deadline) : null,
            parentDispositionId: data.parentDispositionId,
            status: 'PENDING',
            notes: data.notes,
          },
        });

        await recordFlow(tx, {
          letterId: txLetter.id,
          actorId: data.senderId,
          action: LetterFlowAction.DISPOSED,
          targetId: targetRecipientId,
          fromStatus: txLetter.status,
          toStatus: txLetter.direction === 'INCOMING' ? DbLetterStatus.DISPOSED : txLetter.status,
          note: data.instruction,
        });

        allDispositions.push(created);
        newlyCreatedDispositions.push(created);
      }

      if (txLetter.direction === 'INCOMING' && txLetter.status !== DbLetterStatus.DISPOSED) {
        await tx.letter.update({
          where: { id: txLetter.id },
          data: { status: DbLetterStatus.DISPOSED },
        });
      }

      return { allDispositions, newlyCreatedDispositions };
    });

    // Notify ONLY Newly Created Dispositions
    for (const disp of newlyCreatedDispositions) {
      eventBus.emit('notification:send', {
        userId: disp.recipientId,
        type: 'REMINDER',
        title: 'Disposisi Baru',
        message: `Anda menerima disposisi baru: "${data.instruction}"`,
        data: {
          entityId: disp.id,
          entityType: 'DISPOSITION',
          letterId: letter.id,
          link: `/e-office/letter/${letter.id}`,
        },
      });
    }

    return allDispositions;
  },

  async updateDispositionStatus(id: string, status: string, notes?: string, userId?: string) {
    const disposition = await prisma.disposition.findUnique({ where: { id } });
    if (!disposition) throw new Error('Disposition not found');

    if (userId && disposition.recipientId !== userId) {
      throw new Error('Unauthorized access to this disposition');
    }

    const updatedDisposition = await prisma.$transaction(async (tx) => {
      const updated = await tx.disposition.update({
        where: { id },
        data: {
          status,
          // Notes are still concatenated here for the disposition's own
          // summary, but the history below is where each update is kept
          // separately — one text column cannot say when each line was added
          // or by whom, which is the whole question being asked of it.
          notes: notes
            ? disposition.notes
              ? `${disposition.notes}\n\n[UPDATE] ${notes}`
              : notes
            : undefined,
          completedAt: status === 'COMPLETED' ? new Date() : null,
        },
      });

      if (userId) {
        await recordFlow(tx, {
          letterId: disposition.letterId,
          actorId: userId,
          action: LetterFlowAction.DISPOSITION_UPDATED,
          targetId: disposition.senderId,
          note: notes ? `[${status}] ${notes}` : `[${status}]`,
        });
      }

      return updated;
    });

    // Notify Sender if Completed
    if (status === 'COMPLETED' && disposition.senderId) {
      eventBus.emit('notification:send', {
        userId: disposition.senderId,
        type: 'INFO',
        title: 'Disposisi Selesai',
        message: `Disposisi "${disposition.instruction}" telah diselesaikan.`,
        data: {
          entityId: disposition.id,
          entityType: 'DISPOSITION',
          letterId: disposition.letterId,
          link: `/e-office/letter/${disposition.letterId}`,
        },
      });
    }

    return updatedDisposition;
  },

  /**
   * Search / list eligible correspondence participants (teachers, staff, foundation officers)
   * accessible to authenticated E-Office participants.
   */
  async getParticipants(
    params: { search?: string; unitId?: string; limit?: number },
    actor?: LetterActor
  ) {
    if (!actor || !actor.roleCode) {
      throw Errors.forbidden('Anda tidak memiliki akses ke direktori persuratan');
    }

    // Deny external roles (students, parents, alumni, komite)
    if ((EXCLUDED_CORRESPONDENCE_ROLES as readonly string[]).includes(actor.roleCode)) {
      throw Errors.forbidden('Anda tidak memiliki akses ke direktori persuratan');
    }

    const limit = Math.min(params.limit || 100, 200);
    const now = new Date();

    // Derive unit scope according to seesAllUnits policy:
    // Cross-unit personnel and foundation roles can see participants across units or specify query.unitId.
    // Unit-pinned roles are restricted to their assigned unitId regardless of query.unitId.
    const actorSeesAll = actor ? seesAllUnits(actor) : true;
    const effectiveUnitId = actorSeesAll ? params.unitId : (actor?.unitId ?? params.unitId);

    const where: Prisma.UserWhereInput = {
      isActive: true,
      deletedAt: null, // A8: Exclude soft-deleted users
      // Candidates must have an active non-external role assignment
      userRoles: {
        some: {
          isActive: true,
          role: {
            code: {
              notIn: EXCLUDED_CORRESPONDENCE_ROLES as unknown as RoleCode[],
            },
          },
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
        },
      },
    };

    const and: Prisma.UserWhereInput[] = [];

    if (effectiveUnitId) {
      // A3: Match unit by legacy user unitId OR active role assignment unitId
      and.push({
        OR: [
          { unitId: effectiveUnitId },
          { unitId: null },
          { userRoles: { some: { unitId: effectiveUnitId, isActive: true } } },
        ],
      });
    }

    if (params.search) {
      and.push({
        OR: [
          { name: { contains: params.search, mode: 'insensitive' } },
          { email: { contains: params.search, mode: 'insensitive' } },
        ],
      });
    }

    if (and.length > 0) {
      where.AND = and;
    }

    const users = await prisma.user.findMany({
      where,
      take: limit,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        unitId: true,
        unit: { select: { name: true } },
        teacher: { select: { nip: true } },
        staff: { select: { nip: true, position: true } },
        userRoles: {
          where: {
            isActive: true,
            role: {
              code: {
                notIn: EXCLUDED_CORRESPONDENCE_ROLES as unknown as RoleCode[],
              },
            },
            OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          },
          select: { role: { select: { code: true } } },
          orderBy: [{ isPrimary: 'desc' }],
          take: 1,
        },
      },
    });

    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      unitId: u.unitId,
      unitName: u.unit?.name ?? null,
      roleCode: u.userRoles[0]?.role?.code ?? null,
      nip: u.teacher?.nip || u.staff?.nip || null,
      position: u.staff?.position || null,
    }));
  },

  /** `unitId` undefined = foundation-wide totals (see getLetters). */
  async getDashboardStats(unitId?: string) {
    // The counts below rely on Prisma reading an `undefined` field as "no
    // filter". The raw chart query has no such affordance, so it branches.
    // Type definition for Raw SQL Result
    type ChartDataRow = {
      month_key: string;
      direction: string;
      count: number;
    };

    const [totalIncoming, totalOutgoing, pendingReview, needsAction, urgentLetters, chartDataRaw] =
      await Promise.all([
        // Total Incoming
        prisma.letter.count({ where: { unitId, direction: 'INCOMING' } }),
        // Total Outgoing
        prisma.letter.count({ where: { unitId, direction: 'OUTGOING' } }),
        // Pending Review
        prisma.letter.count({ where: { unitId, status: 'PENDING_REVIEW' } }),
        // Needs Action
        prisma.letter.count({
          where: {
            unitId,
            status: { in: ['DRAFT', 'PENDING_REVIEW', 'REVISION_NEEDED'] },
          },
        }),
        // Urgent letters still in flight (not yet archived/disposed)
        prisma.letter.count({
          where: {
            unitId,
            urgency: { in: ['IMMEDIATE', 'URGENT'] },
            status: { notIn: ['ARCHIVED', 'DISPOSED'] },
          },
        }),
        // Chart Data (Last 6 Months). `unit_id = NULL` never matches, so a
        // foundation caller needs the predicate dropped, not parameterised.
        prisma.$queryRaw<ChartDataRow[]>`
        SELECT
          TO_CHAR(date, 'YYYY-MM') as month_key,
          direction,
          COUNT(*)::int as count
        FROM letters
        WHERE (${unitId ?? null}::text IS NULL OR unit_id = ${unitId ?? null})
          AND date >= NOW() - INTERVAL '6 months'
        GROUP BY 1, 2
        ORDER BY 1 ASC
      `,
      ]);

    // Process Chart Data
    const chartMap = new Map<string, { name: string; incoming: number; outgoing: number }>();
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'Mei',
      'Jun',
      'Jul',
      'Agu',
      'Sep',
      'Okt',
      'Nov',
      'Des',
    ];

    // Initialize last 6 months
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setDate(1); // Prevent month skipping on 31st
      d.setMonth(d.getMonth() - i);
      const key = d.toISOString().slice(0, 7); // YYYY-MM
      const monthLabel = monthNames[d.getMonth()];
      chartMap.set(key, { name: monthLabel, incoming: 0, outgoing: 0 });
    }

    (chartDataRaw as ChartDataRow[]).forEach((row) => {
      if (chartMap.has(row.month_key)) {
        const entry = chartMap.get(row.month_key)!;
        if (row.direction === 'INCOMING') entry.incoming = row.count;
        if (row.direction === 'OUTGOING') entry.outgoing = row.count;
      }
    });

    return {
      counts: {
        totalIncoming,
        totalOutgoing,
        pendingReview,
        needsAction,
        urgentLetters,
      },
      chart: Array.from(chartMap.values()),
    };
  },

  /**
   * Public verification for signed letters via token and optional uploaded PDF buffer
   */
};

/**
 * Satu nilai CSV, dikutip bila perlu dan dineutralkan dari rumus.
 *
 * Kutip ganda di dalam nilai digandakan, sesuai RFC 4180 — tanpa itu sebuah
 * perihal yang mengandung tanda kutip menghasilkan kolom yang bergeser dan
 * berkasnya rusak di pembaca mana pun.
 *
 * Netralkan sel CSV terhadap injeksi rumus (CWE-1236).
 *
 * Sebuah perihal surat diketik oleh manusia dan dapat dimulai dengan `=`, `+`,
 * `-`, `@`, TAB, atau CR. Bila berkasnya dibuka di Excel/LibreOffice, sel
 * semacam itu **dijalankan sebagai rumus** — `=HYPERLINK(...)`, `=cmd|'...'`,
 * atau `+1+1` yang mengacaukan buku agenda. Karena buku agenda memang dibuat
 * untuk dibuka di aplikasi lembar kerja, jalur inilah yang paling mungkin
 * dipakai menyerang, bukan jalur yang tidak ada.
 *
 * Obatnya menurut OWASP: awali nilai yang berbahaya dengan petik tunggal, yang
 * di lembar kerja menandai teks dan tidak ikut tampil. Nilai juga tetap
 * dikutip bila mengandung koma/baris baru, sebab tanda `"` saja tidak
 * menetralkan rumus.
 */
function csvCell(value: string): string {
  const neutralised = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  const needsQuotes = /[",\r\n]/.test(neutralised);
  const escaped = neutralised.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/** Tengah malam UTC dari sebuah tanggal, dasar perbandingan rentang. */
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Awal hari UTC berikutnya — batas atas eksklusif rentang ekspor. */
function startOfNextDay(date: Date): Date {
  const d = startOfDay(date);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Tanggal saja (`YYYY-MM-DD`) untuk sel CSV — jam tidak bermakna di arsip. */
function toDateOnly(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
}

/**
 * CSV dengan BOM UTF-8.
 *
 * BOM bukan hiasan: tanpa itu Excel di Windows membaca berkas sebagai
 * Latin-1, dan setiap huruf beraksen pada nama orang tampil sebagai mojibake.
 * Buku agenda yang rusak saat dibuka bukan buku agenda.
 */
function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
