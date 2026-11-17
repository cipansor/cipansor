import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import {
  RoleCode,
  CounselingStatus,
  CounselingCategory,
  CounselingPriority,
  ReferralType,
  Prisma,
} from '@prisma/client';
import { isAdminRoleCode } from '@/middleware/auth';
import { createNotification } from '../notifications/notifications.service';
import {
  GURU_BK_ROLE_CODES,
  PRINCIPAL_ROLE_CODES,
  type CounselingViewerAccess,
  CounselingSession as SharedCounselingSession,
  CounselingNote as SharedCounselingNote,
  CounselingReferral as SharedCounselingReferral,
  CounselingStats as SharedCounselingStats,
  CreateCounselingSessionInput,
  UpdateCounselingSessionInput,
  CreateCounselingNoteInput,
  CreateCounselingReferralInput,
  CounselingListParams,
} from '@cipansor/shared';

/**
 * Foundation-level RoleCodes that have cross-unit visibility into counseling
 * data (read-only access across all units, just like SUPER_ADMIN).
 *
 * These governance roles (board members, auditors, foundation secretary, etc.)
 * legitimately need to view counseling statistics and session lists across all
 * units for oversight purposes, even though they are NOT system administrators.
 *
 * WITHOUT this allowlist, the access-control check below would reject any
 * non-SUPER_ADMIN whose JWT has no `unitId` — which would break foundation
 * governance users whose role assignment is unit-less by design.
 *
 * NOTE: This grants cross-unit READ access to sessions, statistics, individual
 * sessions (`getSessionById`) and student counseling history
 * (`getStudentHistory`) — consistent with their oversight role. It does NOT
 * grant mutation rights: `updateSession`, `deleteSession`, `addNote`,
 * `updateNote`, `deleteNote`, `addReferral`, `updateReferral`, and
 * `deleteReferral` continue to require either SUPER_ADMIN or a unit match, so
 * foundation governance can view but not modify counseling data from other
 * units. `authorize()` in the routes layer enforces coarse-grained route-level
 * permissions in addition to these service-layer checks.
 */
const FOUNDATION_LEVEL_ROLES: string[] = [
  RoleCode.YAYASAN_PEMBINA,
  RoleCode.YAYASAN_KETUA,
  RoleCode.YAYASAN_SEKRETARIS,
  RoleCode.YAYASAN_BENDAHARA,
  RoleCode.YAYASAN_ANGGOTA,
  RoleCode.YAYASAN_PENGAWAS,
];

function hasCrossUnitCounselingAccess(roleCode: string): boolean {
  return roleCode === RoleCode.SUPER_ADMIN || FOUNDATION_LEVEL_ROLES.includes(roleCode);
}

// User type from JwtPayload (aligned with new RoleCode-based auth)
interface AuthenticatedUser {
  sub: string;
  roleCode: string;
  unitId: string | null;
}

/*
 * Confidential sessions (decided by the yayasan 2026-09-26). A session marked
 * confidential is read in full only by its own counsellor and by the guru BK
 * of its unit. The unit's kepala sekolah sees that it exists and its
 * referrals; its content — description, summary, recommendations, psychology
 * data and notes — is withheld. Nobody else receives it: not other teachers,
 * not the admin unit, not the yayasan organs, not the super admin. Health and
 * children's data are specific personal data (UU 27/2022 Ps. 4). The unit and
 * cross-unit rules above still decide who reads non-confidential sessions.
 */
type ViewerAccess = CounselingViewerAccess | 'NONE';

interface AccessFacts {
  isConfidential: boolean;
  unitId: string;
  counselor: { userId: string } | null;
}

const isGuruBkOf = (actor: AuthenticatedUser, unitId: string) =>
  GURU_BK_ROLE_CODES.includes(actor.roleCode) && actor.unitId === unitId;
const isHeadOf = (actor: AuthenticatedUser, unitId: string) =>
  PRINCIPAL_ROLE_CODES.includes(actor.roleCode) && actor.unitId === unitId;

export function viewerAccess(actor: AuthenticatedUser, session: AccessFacts): ViewerAccess {
  if (!session.isConfidential) return 'FULL';
  if (session.counselor?.userId === actor.sub || isGuruBkOf(actor, session.unitId)) return 'FULL';
  if (isHeadOf(actor, session.unitId)) return 'REFERRALS_ONLY';
  return 'NONE';
}

/** The sessions a caller may receive at all; the unit scope is applied beside it. */
function visibleWhere(actor: AuthenticatedUser): Prisma.CounselingSessionWhereInput {
  const or: Prisma.CounselingSessionWhereInput[] = [
    { isConfidential: false },
    { counselor: { userId: actor.sub } },
  ];
  const seesUnitsConfidential =
    GURU_BK_ROLE_CODES.includes(actor.roleCode) || PRINCIPAL_ROLE_CODES.includes(actor.roleCode);
  if (actor.unitId && seesUnitsConfidential) or.push({ unitId: actor.unitId });
  return { OR: or };
}

/** The sessions whose content the caller may read — and so search. */
function readableWhere(actor: AuthenticatedUser): Prisma.CounselingSessionWhereInput {
  const or: Prisma.CounselingSessionWhereInput[] = [
    { isConfidential: false },
    { counselor: { userId: actor.sub } },
  ];
  if (actor.unitId && GURU_BK_ROLE_CODES.includes(actor.roleCode)) {
    or.push({ unitId: actor.unitId });
  }
  return { OR: or };
}

const WITHHELD = {
  title: 'Sesi rahasia',
  description: null,
  summary: null,
  recommendations: null,
  psychologyData: null,
} as const;

/** A session as it leaves the API for this caller. */
function present<T extends object>(
  session: T,
  access: CounselingViewerAccess
): T & { viewerAccess: CounselingViewerAccess } {
  if (access === 'FULL') return { ...session, viewerAccess: access };
  const out: Record<string, unknown> = { ...session, ...WITHHELD, viewerAccess: access };
  delete out.notes;
  if (out._count) out._count = { ...(out._count as object), notes: 0 };
  return out as T & { viewerAccess: CounselingViewerAccess };
}

/** Writes on a confidential session are its readers' alone. */
function assertMayChange(actor: AuthenticatedUser, session: AccessFacts) {
  if (actor.roleCode !== RoleCode.SUPER_ADMIN && session.unitId !== actor.unitId) {
    throw Errors.forbidden('Access denied');
  }
  const access = viewerAccess(actor, session);
  if (access === 'NONE') throw Errors.notFound('Session not found');
  if (access !== 'FULL') {
    throw Errors.forbidden(
      'Sesi rahasia hanya dapat diubah oleh konselornya atau guru BK unit ini'
    );
  }
}

// A child's record has close to seventy columns; a session needs these.
const STUDENT_SELECT = {
  id: true,
  nis: true,
  unitId: true,
  user: { select: { id: true, name: true } },
  enrollments: {
    where: { status: 'active' },
    take: 1,
    select: { class: { select: { id: true, name: true } } },
  },
} satisfies Prisma.StudentSelect;

const COUNSELOR_SELECT = {
  id: true,
  userId: true,
  user: { select: { id: true, name: true } },
} satisfies Prisma.TeacherSelect;

const SESSION_ACCESS_SELECT = {
  unitId: true,
  isConfidential: true,
  counselor: { select: { userId: true } },
} satisfies Prisma.CounselingSessionSelect;

const withClass = <S extends { enrollments: { class: unknown }[] }>(student: S) => ({
  ...student,
  currentClass: student.enrollments[0]?.class ?? null,
});

export class CounselingService {
  /**
   * Get counseling sessions
   */
  async getSessions(filters: CounselingListParams, currentUser: AuthenticatedUser) {
    const where: Prisma.CounselingSessionWhereInput = {};

    // Access control.
    //
    // BEHAVIOR CHANGE: Previously, non-SUPER_ADMIN users without a unitId
    // silently received ALL counseling sessions across ALL units — a
    // cross-unit data leak. We now reject such requests explicitly so that
    // misconfigured role assignments are surfaced rather than hidden.
    //
    // Foundation-level governance roles (YAYASAN_PEMBINA, YAYASAN_KETUA, etc.)
    // retain cross-unit read visibility via `hasCrossUnitCounselingAccess`.
    // Unit-scoped users MUST have a unitId in their JWT.
    if (!hasCrossUnitCounselingAccess(currentUser.roleCode)) {
      if (!currentUser.unitId) {
        throw Errors.forbidden(
          'No unit assignment found for your account. Contact an administrator to assign you to a unit.'
        );
      }
      where.unitId = currentUser.unitId;
    }
    const and: Prisma.CounselingSessionWhereInput[] = [visibleWhere(currentUser)];

    if (filters.status) where.status = filters.status as CounselingStatus;
    if (filters.category) where.category = filters.category as CounselingCategory;
    if (filters.priority) where.priority = filters.priority as CounselingPriority;
    if (filters.studentId) where.studentId = filters.studentId;

    if (filters.search) {
      const text = { contains: filters.search, mode: 'insensitive' } as const;
      and.push({
        OR: [
          // A withheld title or description is not searchable either.
          { AND: [readableWhere(currentUser), { OR: [{ title: text }, { description: text }] }] },
          // Optimized search: Filter by Student Name and Counselor Name via User relation
          {
            student: {
              user: {
                name: { contains: filters.search, mode: 'insensitive' },
              },
            },
          },
          {
            counselor: {
              user: {
                name: { contains: filters.search, mode: 'insensitive' },
              },
            },
          },
        ],
      });
    }
    where.AND = and;

    if (filters.startDate || filters.endDate) {
      where.scheduledAt = {};
      if (filters.startDate) where.scheduledAt.gte = new Date(filters.startDate);
      if (filters.endDate) where.scheduledAt.lte = new Date(filters.endDate);
    }

    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const skip = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      prisma.counselingSession.findMany({
        where,
        include: {
          student: { select: STUDENT_SELECT },
          counselor: { select: COUNSELOR_SELECT },
          unit: { select: { id: true, name: true } },
          _count: { select: { notes: true, referrals: true } },
        },
        orderBy: { scheduledAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.counselingSession.count({ where }),
    ]);

    const mappedSessions = sessions.flatMap((s) => {
      const access = viewerAccess(currentUser, s);
      return access === 'NONE' ? [] : [present({ ...s, student: withClass(s.student) }, access)];
    });

    return { data: mappedSessions as unknown as SharedCounselingSession[], total };
  }

  /**
   * Get session by ID
   */
  async getSessionById(sessionId: string, currentUser: AuthenticatedUser) {
    const session = await prisma.counselingSession.findUnique({
      where: { id: sessionId },
      include: {
        student: { select: STUDENT_SELECT },
        counselor: { select: COUNSELOR_SELECT },
        unit: { select: { id: true, name: true } },
        notes: {
          include: {
            createdBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        referrals: {
          include: {
            createdBy: { select: { id: true, name: true } },
          },
          orderBy: { referredAt: 'desc' },
        },
        _count: { select: { notes: true, referrals: true } },
      },
    });

    if (!session) {
      throw Errors.notFound('Session not found');
    }

    // Access control: SUPER_ADMIN and foundation-level governance roles have
    // cross-unit read access; all other users must match the session's unit.
    // Keeping read access consistent with `getSessions` avoids the confusing
    // UX where a governance user sees a session in the list but cannot open it.
    if (
      !hasCrossUnitCounselingAccess(currentUser.roleCode) &&
      session.unitId !== currentUser.unitId
    ) {
      throw Errors.forbidden('Access denied');
    }

    // Not "forbidden": a confidential session is not acknowledged to exist.
    const access = viewerAccess(currentUser, session);
    if (access === 'NONE') throw Errors.notFound('Session not found');

    return present(
      { ...session, student: withClass(session.student) },
      access
    ) as unknown as SharedCounselingSession;
  }

  /**
   * Create counseling session
   */
  async createSession(input: CreateCounselingSessionInput, currentUser: AuthenticatedUser) {
    const student = await prisma.student.findUnique({
      where: { id: input.studentId, deletedAt: null },
    });

    if (!student) {
      throw Errors.notFound('Student not found');
    }

    let counselorId: string | undefined;

    const teacher = await prisma.teacher.findFirst({
      where: { userId: currentUser.sub },
    });

    if (teacher) {
      counselorId = teacher.id;
    } else {
      if (isAdminRoleCode(currentUser.roleCode)) {
        throw Errors.forbidden('You must have a Teacher profile to be assigned as a counselor.');
      } else {
        throw Errors.forbidden('Only teachers can create counseling sessions');
      }
    }

    // PSYCHOLOGICAL_OBSERVATION sessions default to confidential regardless
    // of the caller's input, since they contain sensitive mental health data.
    const isConfidential =
      input.category === 'PSYCHOLOGICAL_OBSERVATION' ? true : (input.isConfidential ?? true);

    const session = await prisma.counselingSession.create({
      data: {
        unitId: student.unitId,
        studentId: input.studentId,
        counselorId: counselorId,
        category: input.category as CounselingCategory,
        priority: (input.priority as CounselingPriority) || CounselingPriority.MEDIUM,
        title: input.title,
        description: input.description,
        scheduledAt: new Date(input.scheduledAt),
        duration: input.duration,
        location: input.location,
        isConfidential,
        status: CounselingStatus.SCHEDULED,
      },
      include: {
        student: { select: STUDENT_SELECT },
        counselor: { select: COUNSELOR_SELECT },
        unit: { select: { id: true, name: true } },
      },
    });

    return present(
      { ...session, student: withClass(session.student) },
      'FULL'
    ) as unknown as SharedCounselingSession;
  }

  /**
   * Update counseling session
   */
  async updateSession(
    sessionId: string,
    input: UpdateCounselingSessionInput,
    currentUser: AuthenticatedUser
  ) {
    const session = await prisma.counselingSession.findUnique({
      where: { id: sessionId },
      include: { counselor: { select: { userId: true } } },
    });

    if (!session) {
      throw Errors.notFound('Session not found');
    }

    assertMayChange(currentUser, session);

    const updateData: Prisma.CounselingSessionUpdateInput = {};
    if (input.category) {
      // Once a session is classified as PSYCHOLOGICAL_OBSERVATION it cannot
      // be reclassified to any other category. Allowing reclassification would
      // open a multi-step confidentiality-bypass: (1) create as PO, (2) change
      // category to ACADEMIC (clears `session.category === PO`), (3) set
      // `isConfidential: false` — the guard below would pass because neither
      // the pre-update nor effective category is PO anymore, yet the session's
      // notes/description still contain sensitive mental-health data written
      // while it was classified as PO. Locking the category at the source
      // eliminates this bypass without needing a persisted historical flag.
      if (
        session.category === CounselingCategory.PSYCHOLOGICAL_OBSERVATION &&
        input.category !== 'PSYCHOLOGICAL_OBSERVATION'
      ) {
        throw Errors.badRequest(
          'Sessions classified as PSYCHOLOGICAL_OBSERVATION cannot be reclassified to another category'
        );
      }
      updateData.category = input.category as CounselingCategory;
    }
    if (input.priority) updateData.priority = input.priority as CounselingPriority;
    if (input.title) updateData.title = input.title;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.scheduledAt) updateData.scheduledAt = new Date(input.scheduledAt);
    if (input.duration !== undefined) updateData.duration = input.duration;
    if (input.location !== undefined) updateData.location = input.location;
    if (input.status) {
      updateData.status = input.status as CounselingStatus;
      if ((input.status as string) === CounselingStatus.IN_PROGRESS && !session.startedAt) {
        updateData.startedAt = new Date();
      } else if ((input.status as string) === CounselingStatus.COMPLETED && !session.endedAt) {
        updateData.endedAt = new Date();
      }
    }
    if (input.summary !== undefined) updateData.summary = input.summary;
    if (input.recommendations !== undefined) updateData.recommendations = input.recommendations;
    if (input.followUpDate) updateData.followUpDate = new Date(input.followUpDate);
    if (input.isConfidential !== undefined) {
      // PSYCHOLOGICAL_OBSERVATION sessions must always remain confidential.
      // Prevent downgrading confidentiality to avoid leaking sensitive mental
      // health data (e.g. via parent notifications at line 332).
      //
      // We check BOTH the effective post-update category AND the pre-update
      // category. Rationale: the session's notes/description may still contain
      // sensitive PO data written while the session was classified as PO.
      // Reclassifying away from PO (e.g. PO → ACADEMIC) and setting
      // isConfidential=false would trigger a parent notification linking to
      // those historical sensitive notes. Once PO, always confidential.
      const effectiveCategory =
        (input.category as CounselingCategory | undefined) || session.category;
      const wasPsychologicalObservation =
        session.category === CounselingCategory.PSYCHOLOGICAL_OBSERVATION;
      const isPsychologicalObservation =
        effectiveCategory === CounselingCategory.PSYCHOLOGICAL_OBSERVATION;
      if ((isPsychologicalObservation || wasPsychologicalObservation) && !input.isConfidential) {
        throw Errors.badRequest(
          'Sessions that are or were classified as PSYCHOLOGICAL_OBSERVATION cannot be marked as non-confidential'
        );
      }
      updateData.isConfidential = input.isConfidential;
    }

    // If the category is being changed TO PSYCHOLOGICAL_OBSERVATION, force
    // confidentiality regardless of whether isConfidential was provided.
    // This mirrors the create-time enforcement at createSession().
    if (
      input.category === 'PSYCHOLOGICAL_OBSERVATION' &&
      session.category !== CounselingCategory.PSYCHOLOGICAL_OBSERVATION
    ) {
      updateData.isConfidential = true;
    }

    // NOTE: A previous defense-in-depth block preserved confidentiality when
    // the category was changed away from PSYCHOLOGICAL_OBSERVATION without an
    // explicit `isConfidential`. That block has been removed because the guard
    // at lines 325-332 now rejects any reclassification away from PO with a
    // 400 error, making the preservation branch unreachable. If the upstream
    // guard is ever relaxed, reinstate the block here.

    if (input.parentNotified !== undefined) updateData.parentNotified = input.parentNotified;

    const updated = await prisma.counselingSession.update({
      where: { id: sessionId },
      data: updateData,
      include: {
        student: { select: STUDENT_SELECT },
        counselor: { select: COUNSELOR_SELECT },
      },
    });

    // ─── NOTIFICATION INTEGRATION ───
    // If session is completed, notify primary parents.
    // Parent data is fetched only when the notification condition is met
    // to avoid leaking parent relationship data in confidential sessions.
    // Wrapped in try/catch so a non-critical notification failure
    // does not cause the already-persisted session update to appear failed.
    if (
      updated.status === CounselingStatus.COMPLETED &&
      session.status !== CounselingStatus.COMPLETED &&
      !updated.isConfidential
    ) {
      try {
        const studentWithParents = await prisma.student.findUnique({
          where: { id: updated.studentId },
          include: {
            parents: { select: { parentId: true, isPrimary: true } },
          },
        });
        const primaryParent =
          studentWithParents?.parents.find((p) => p.isPrimary) || studentWithParents?.parents[0];
        if (primaryParent) {
          await createNotification({
            userId: primaryParent.parentId,
            type: 'INFO',
            title: 'Sesi Konseling Selesai',
            message: `Sesi konseling untuk ${updated.student.user.name} telah selesai dilaksanakan. Silakan cek portal wali untuk detailnya.`,
            link: `/parent/counseling/${updated.id}`,
          } as any);
        }
      } catch (err) {
        console.error('Failed to send counseling completion notification:', err);
      }
    }

    return present(
      { ...updated, student: withClass(updated.student) },
      'FULL'
    ) as unknown as SharedCounselingSession;
  }

  /**
   * Delete counseling session
   */
  async deleteSession(sessionId: string, currentUser: AuthenticatedUser) {
    const session = await prisma.counselingSession.findUnique({
      where: { id: sessionId },
      select: SESSION_ACCESS_SELECT,
    });

    if (!session) {
      throw Errors.notFound('Session not found');
    }

    assertMayChange(currentUser, session);

    await prisma.counselingSession.delete({
      where: { id: sessionId },
    });

    return { success: true };
  }

  /**
   * Add session note
   */
  async addNote(
    sessionId: string,
    input: CreateCounselingNoteInput,
    currentUser: AuthenticatedUser
  ) {
    const session = await prisma.counselingSession.findUnique({
      where: { id: sessionId },
      select: SESSION_ACCESS_SELECT,
    });

    if (!session) {
      throw Errors.notFound('Session not found');
    }

    assertMayChange(currentUser, session);

    const note = await prisma.counselingNote.create({
      data: {
        sessionId,
        content: input.content,
        noteType: input.noteType || 'general',
        createdById: currentUser.sub,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });

    return note as unknown as SharedCounselingNote;
  }

  /**
   * Update session note
   */
  async updateNote(
    noteId: string,
    input: Partial<CreateCounselingNoteInput>,
    currentUser: AuthenticatedUser
  ) {
    const note = await prisma.counselingNote.findUnique({
      where: { id: noteId },
      include: { session: { select: SESSION_ACCESS_SELECT } },
    });

    if (!note) {
      throw Errors.notFound('Note not found');
    }

    assertMayChange(currentUser, note.session);

    const updated = await prisma.counselingNote.update({
      where: { id: noteId },
      data: {
        content: input.content,
        noteType: input.noteType,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });

    return updated as unknown as SharedCounselingNote;
  }

  /**
   * Delete session note
   */
  async deleteNote(noteId: string, currentUser: AuthenticatedUser) {
    const note = await prisma.counselingNote.findUnique({
      where: { id: noteId },
      include: { session: { select: SESSION_ACCESS_SELECT } },
    });

    if (!note) {
      throw Errors.notFound('Note not found');
    }

    assertMayChange(currentUser, note.session);

    await prisma.counselingNote.delete({ where: { id: noteId } });
    return { success: true };
  }

  /**
   * Add referral
   */
  async addReferral(
    sessionId: string,
    input: CreateCounselingReferralInput,
    currentUser: AuthenticatedUser
  ) {
    const session = await prisma.counselingSession.findUnique({
      where: { id: sessionId },
      select: SESSION_ACCESS_SELECT,
    });

    if (!session) {
      throw Errors.notFound('Session not found');
    }

    assertMayChange(currentUser, session);

    const referral = await prisma.counselingReferral.create({
      data: {
        sessionId,
        type: input.type as ReferralType,
        referredTo: input.referredTo,
        institution: input.institution,
        reason: input.reason,
        contactInfo: input.contactInfo,
        followUpDate: input.followUpDate ? new Date(input.followUpDate) : null,
        createdById: currentUser.sub,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });

    return referral as unknown as SharedCounselingReferral;
  }

  /**
   * Update referral
   */
  async updateReferral(
    referralId: string,
    input: Partial<CreateCounselingReferralInput & { outcome: string }>,
    currentUser: AuthenticatedUser
  ) {
    const referral = await prisma.counselingReferral.findUnique({
      where: { id: referralId },
      include: { session: { select: SESSION_ACCESS_SELECT } },
    });

    if (!referral) {
      throw Errors.notFound('Referral not found');
    }

    assertMayChange(currentUser, referral.session);

    const updated = await prisma.counselingReferral.update({
      where: { id: referralId },
      data: {
        type: input.type as ReferralType,
        referredTo: input.referredTo,
        institution: input.institution,
        reason: input.reason,
        contactInfo: input.contactInfo,
        followUpDate: input.followUpDate ? new Date(input.followUpDate) : undefined,
        outcome: input.outcome,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });

    return updated as unknown as SharedCounselingReferral;
  }

  /**
   * Delete referral
   */
  async deleteReferral(referralId: string, currentUser: AuthenticatedUser) {
    const referral = await prisma.counselingReferral.findUnique({
      where: { id: referralId },
      include: { session: { select: SESSION_ACCESS_SELECT } },
    });

    if (!referral) {
      throw Errors.notFound('Referral not found');
    }

    assertMayChange(currentUser, referral.session);

    await prisma.counselingReferral.delete({ where: { id: referralId } });
    return { success: true };
  }

  /**
   * Get student counseling history
   */
  async getStudentHistory(studentId: string, currentUser: AuthenticatedUser) {
    const student = await prisma.student.findUnique({
      where: { id: studentId, deletedAt: null },
    });

    if (!student) {
      throw Errors.notFound('Student not found');
    }

    // Read-only cross-unit access for SUPER_ADMIN and foundation governance
    // roles, consistent with `getSessionById` and `getSessions`.
    if (
      !hasCrossUnitCounselingAccess(currentUser.roleCode) &&
      student.unitId !== currentUser.unitId
    ) {
      throw Errors.forbidden('Access denied');
    }

    const sessions = await prisma.counselingSession.findMany({
      where: { AND: [{ studentId }, visibleWhere(currentUser)] },
      include: {
        counselor: { select: COUNSELOR_SELECT },
        _count: { select: { notes: true, referrals: true } },
      },
      orderBy: { scheduledAt: 'desc' },
    });

    return sessions.flatMap((s) => {
      const access = viewerAccess(currentUser, s);
      return access === 'NONE' ? [] : [present(s, access)];
    }) as unknown as SharedCounselingSession[];
  }

  /**
   * Get counselor sessions
   */
  async getCounselorSessions(currentUser: AuthenticatedUser) {
    const teacher = await prisma.teacher.findFirst({
      where: { userId: currentUser.sub },
    });

    if (!teacher) {
      return [];
    }

    const sessions = await prisma.counselingSession.findMany({
      where: { counselorId: teacher.id },
      include: {
        student: { select: STUDENT_SELECT },
        unit: { select: { id: true, name: true } },
        _count: { select: { notes: true, referrals: true } },
      },
      orderBy: { scheduledAt: 'desc' },
    });

    // The caller is the counsellor of every one of them.
    return sessions.map((s) =>
      present({ ...s, student: withClass(s.student) }, 'FULL')
    ) as unknown as SharedCounselingSession[];
  }

  /**
   * Get statistics
   */
  async getStatistics(currentUser: AuthenticatedUser): Promise<SharedCounselingStats> {
    const where: Prisma.CounselingSessionWhereInput = {};

    // Same access-control pattern as getSessions — see comment there for
    // rationale on rejecting non-SUPER_ADMIN users without a unitId.
    // Foundation-level governance roles retain cross-unit read visibility.
    if (!hasCrossUnitCounselingAccess(currentUser.roleCode)) {
      if (!currentUser.unitId) {
        throw Errors.forbidden(
          'No unit assignment found for your account. Contact an administrator to assign you to a unit.'
        );
      }
      where.unitId = currentUser.unitId;
    }
    // Counted as listed: a session the caller does not receive is not counted.
    where.AND = [visibleWhere(currentUser)];

    const [totalSessions, byStatus, byCategory, byPriority] = await Promise.all([
      prisma.counselingSession.count({ where }),
      prisma.counselingSession.groupBy({
        by: ['status'],
        where,
        _count: { status: true },
      }),
      prisma.counselingSession.groupBy({
        by: ['category'],
        where,
        _count: { category: true },
      }),
      prisma.counselingSession.groupBy({
        by: ['priority'],
        where,
        _count: { priority: true },
      }),
    ]);

    return {
      totalSessions,
      byStatus: byStatus.map((s) => ({
        status: s.status as unknown as any,
        count: s._count.status,
      })),
      byCategory: byCategory.map((c) => ({
        category: c.category as unknown as any,
        count: c._count.category,
      })),
      byPriority: byPriority.map((p) => ({
        priority: p.priority as unknown as any,
        count: p._count.priority,
      })),
    };
  }
}

export const counselingService = new CounselingService();
