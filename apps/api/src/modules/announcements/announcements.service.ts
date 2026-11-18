import { Prisma, AnnouncementScope } from '@prisma/client';
import {
  ADMIN_ROLE_CODES,
  BENDAHARA_ROLE_CODES,
  BUSINESS_ROLE_CODES,
  CLASS_ENROLLMENT_STATUS,
  FAMILY_AUDIENCES,
  PARENT_ROLE_CODES,
  PESANTREN_EDUCATOR_ROLE_CODES,
  PESANTREN_LEADER_ROLE_CODES,
  PRINCIPAL_ROLE_CODES,
  SCHOOL_TEACHER_ROLE_CODES,
  STUDENT_ROLE_CODES,
  STUDENT_STATUS,
  SUPPORT_ROLE_CODES,
  TATA_USAHA_ROLE_CODES,
  ANNOUNCEMENT_AUDIENCES,
  type AnnouncementAudience,
  type AnnouncementComposeOptionsDTO,
  type AnnouncementDTO,
  type AnnouncementStatsDTO,
} from '@cipansor/shared';
import { prisma } from '@/lib/prisma';
import { ApiError, ErrorCode, Errors } from '@/middleware/error';
import { wibMonthRange, wibMonthYear } from '@/utils/wib';
import { boardersOfMusyrif } from '@/modules/dormitories';
import {
  announcementDeliveryCounts,
  deliverAnnouncement,
  reviseAnnouncementDelivery,
  withdrawAnnouncementDelivery,
} from '@/modules/notifications';
import {
  choosesUnit,
  mayManage,
  overseesUnit,
  scopesFor,
  seesDelivery,
  type AnnouncementActor,
} from './announcements.access';
import type {
  AnnouncementListQuery,
  CreateAnnouncementBody,
  UpdateAnnouncementBody,
} from './announcements.schema';

const notFound = () => new ApiError(ErrorCode.NOT_FOUND, 'Pengumuman tidak ditemukan');

// ==================== AUDIENCE ====================

/** The role codes that read an announcement addressed to each audience. */
const AUDIENCE_ROLE_CODES: Record<AnnouncementAudience, readonly string[]> = {
  STUDENT: STUDENT_ROLE_CODES,
  PARENT: PARENT_ROLE_CODES,
  TEACHER: [
    ...SCHOOL_TEACHER_ROLE_CODES,
    ...PRINCIPAL_ROLE_CODES,
    ...PESANTREN_EDUCATOR_ROLE_CODES,
    ...PESANTREN_LEADER_ROLE_CODES,
  ],
  STAFF: [
    ...ADMIN_ROLE_CODES.filter((c) => c !== 'SUPER_ADMIN'),
    ...TATA_USAHA_ROLE_CODES,
    ...BENDAHARA_ROLE_CODES,
    ...SUPPORT_ROLE_CODES,
    ...BUSINESS_ROLE_CODES,
  ],
};

const audienceOfCode = (code: string): AnnouncementAudience | null =>
  ANNOUNCEMENT_AUDIENCES.find((a) => AUDIENCE_ROLE_CODES[a].includes(code)) ?? null;

/** Who an announcement is for, when it names nobody: everyone its scope can hold. */
const audiencesOf = (a: { scope: AnnouncementScope; targetRoles: readonly string[] }) => {
  const family = a.scope === 'CLASSES' || a.scope === 'BOARDERS';
  const all = family ? FAMILY_AUDIENCES : ANNOUNCEMENT_AUDIENCES;
  const named = a.targetRoles.filter((r): r is AnnouncementAudience =>
    (ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(r)
  );
  return named.length ? all.filter((r) => named.includes(r)) : [...all];
};

const ACTIVE_STUDENT = { status: STUDENT_STATUS.ACTIVE, deletedAt: null } as const;
const ACTIVE_USER = { isActive: true, deletedAt: null } as const;

/**
 * The people an announcement reaches, as user ids, without its sender.
 *
 * Santri and wali come from the students in scope — a unit's, the classes'
 * (active enrolment), or the musyrif's santri recorded at publication — so a
 * wali is reached through their child, whatever role row their account holds.
 * Guru and staf come from active role assignments, in the unit or anywhere.
 */
export async function recipientsOf(a: {
  scope: AnnouncementScope;
  unitId: string | null;
  classIds: readonly string[];
  studentIds: readonly string[];
  targetRoles: readonly string[];
  createdById: string;
}): Promise<string[]> {
  const audiences = audiencesOf(a);
  const ids = new Set<string>();

  if (audiences.includes('STUDENT') || audiences.includes('PARENT')) {
    const where: Prisma.StudentWhereInput = {
      ...ACTIVE_STUDENT,
      ...(a.scope === 'UNIT' ? { unitId: a.unitId ?? '' } : {}),
      ...(a.scope === 'CLASSES'
        ? {
            enrollments: {
              some: { classId: { in: [...a.classIds] }, status: CLASS_ENROLLMENT_STATUS.ACTIVE },
            },
          }
        : {}),
      ...(a.scope === 'BOARDERS' ? { id: { in: [...a.studentIds] } } : {}),
    };
    const students = await prisma.student.findMany({
      where,
      select: {
        user: { select: { id: true, isActive: true, deletedAt: true } },
        parents: { select: { parent: { select: { id: true, isActive: true, deletedAt: true } } } },
      },
    });
    for (const s of students) {
      if (audiences.includes('STUDENT') && s.user.isActive && !s.user.deletedAt) ids.add(s.user.id);
      if (audiences.includes('PARENT')) {
        for (const { parent } of s.parents)
          if (parent.isActive && !parent.deletedAt) ids.add(parent.id);
      }
    }
  }

  const staff = audiences.filter((r) => r === 'TEACHER' || r === 'STAFF');
  if (staff.length && (a.scope === 'YAYASAN' || a.scope === 'UNIT')) {
    const codes = staff.flatMap((r) => AUDIENCE_ROLE_CODES[r]);
    const holds = (unit?: Prisma.UserRoleAssignmentWhereInput) => ({
      userRoles: { some: { isActive: true, role: { code: { in: codes } }, ...unit } },
    });
    const users = await prisma.user.findMany({
      where: {
        ...ACTIVE_USER,
        ...(a.scope === 'UNIT'
          ? {
              OR: [
                holds({ unitId: a.unitId ?? '' }),
                // An assignment that names no unit belongs to the account's.
                { unitId: a.unitId ?? '', ...holds({ unitId: null }) },
              ],
            }
          : holds()),
      },
      select: { id: true },
    });
    for (const u of users) ids.add(u.id);
  }

  ids.delete(a.createdById);
  return [...ids];
}

interface Viewer {
  userId: string;
  audiences: AnnouncementAudience[];
  unitIds: string[];
  classIds: string[];
  studentIds: string[];
}

/** What decides which announcements reach the caller: their roles, units, classes and children. */
async function viewerOf(actor: AnnouncementActor): Promise<Viewer> {
  const enrolled = {
    where: { status: CLASS_ENROLLMENT_STATUS.ACTIVE },
    select: { classId: true },
  } as const;
  const user = await prisma.user.findUnique({
    where: { id: actor.sub },
    select: {
      unitId: true,
      userRoles: {
        where: { isActive: true },
        select: { unitId: true, role: { select: { code: true } } },
      },
      student: { select: { id: true, unitId: true, enrollments: enrolled } },
      parentOf: {
        where: { student: ACTIVE_STUDENT },
        select: { student: { select: { id: true, unitId: true, enrollments: enrolled } } },
      },
    },
  });
  if (!user) throw Errors.unauthorized();

  const audiences = new Set<AnnouncementAudience>();
  for (const r of user.userRoles) {
    const a = audienceOfCode(r.role.code);
    if (a) audiences.add(a);
  }
  if (user.student) audiences.add('STUDENT');
  if (user.parentOf.length) audiences.add('PARENT');

  const students = [
    ...(user.student ? [user.student] : []),
    ...user.parentOf.map((p) => p.student),
  ];
  return {
    userId: actor.sub,
    audiences: [...audiences],
    unitIds: [
      ...new Set(
        [
          user.unitId,
          ...user.userRoles.map((r) => r.unitId),
          ...students.map((s) => s.unitId),
        ].filter((u): u is string => !!u)
      ),
    ],
    classIds: [...new Set(students.flatMap((s) => s.enrollments.map((e) => e.classId)))],
    studentIds: students.map((s) => s.id),
  };
}

/** Published, not expired, not withdrawn. */
const live = (now: Date): Prisma.AnnouncementWhereInput => ({
  withdrawnAt: null,
  publishedAt: { lte: now },
  OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
});

/** The announcements addressed to the viewer that are live now. */
function addressedTo(v: Viewer, now: Date): Prisma.AnnouncementWhereInput {
  const reach: Prisma.AnnouncementWhereInput[] = [
    { scope: 'YAYASAN' },
    { scope: 'UNIT', unitId: { in: v.unitIds } },
  ];
  if (v.classIds.length) reach.push({ scope: 'CLASSES', classIds: { hasSome: v.classIds } });
  if (v.studentIds.length) reach.push({ scope: 'BOARDERS', studentIds: { hasSome: v.studentIds } });
  return {
    AND: [
      live(now),
      { OR: reach },
      { OR: [{ targetRoles: { isEmpty: true } }, { targetRoles: { hasSome: v.audiences } }] },
    ],
  };
}

/**
 * Everything the caller may see on the board: what is addressed to them, what
 * they wrote, and — for a unit's head, TU or admin and the yayasan's organs —
 * every announcement they oversee, scheduled and withdrawn included.
 */
async function boardOf(
  actor: AnnouncementActor,
  now: Date
): Promise<Prisma.AnnouncementWhereInput> {
  const oversees = overseesUnit(actor);
  const branches: Prisma.AnnouncementWhereInput[] = [
    addressedTo(await viewerOf(actor), now),
    { createdById: actor.sub },
  ];
  if (oversees === 'ALL') return {};
  if (oversees) branches.push({ unitId: oversees });
  return { OR: branches };
}

// ==================== READ ====================

const SHOWN = {
  unit: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.AnnouncementInclude;

type Shown = Prisma.AnnouncementGetPayload<{ include: typeof SHOWN }>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toDTO(
  a: Shown,
  actor: AnnouncementActor,
  delivery?: { recipients: number; read: number }
): AnnouncementDTO {
  return {
    id: a.id,
    unitId: a.unitId,
    scope: a.scope,
    classIds: a.classIds,
    title: a.title,
    content: a.content,
    type: a.type,
    priority: a.priority,
    attachmentUrl: a.attachmentUrl,
    publishedAt: iso(a.publishedAt),
    expiresAt: iso(a.expiresAt),
    targetRoles: a.targetRoles,
    withdrawnAt: iso(a.withdrawnAt),
    createdById: a.createdById,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    unit: a.unit,
    createdBy: a.createdBy,
    canManage: mayManage(actor, a),
    ...(delivery ? { recipientCount: delivery.recipients, readCount: delivery.read } : {}),
  };
}

/** Bells reached and read, for the rows the caller may see that of. */
async function withDelivery(rows: Shown[], actor: AnnouncementActor): Promise<AnnouncementDTO[]> {
  const counts = await announcementDeliveryCounts(
    rows.filter((a) => seesDelivery(actor, a)).map((a) => a.id)
  );
  return rows.map((a) => toDTO(a, actor, counts.get(a.id)));
}

export async function list(actor: AnnouncementActor, query: AnnouncementListQuery) {
  const now = new Date();
  const where: Prisma.AnnouncementWhereInput = {
    AND: [
      await boardOf(actor, now),
      query.active ? live(now) : {},
      query.unitId ? { unitId: query.unitId } : {},
      query.priority !== undefined ? { priority: query.priority } : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.announcement.findMany({
      where,
      include: SHOWN,
      orderBy: [{ priority: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.announcement.count({ where }),
  ]);
  return {
    data: await withDelivery(rows, actor),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

/** The newest live announcements addressed to the caller — the dashboards' card. */
export async function recent(actor: AnnouncementActor, limit: number) {
  const now = new Date();
  const rows = await prisma.announcement.findMany({
    where: addressedTo(await viewerOf(actor), now),
    include: SHOWN,
    orderBy: [{ priority: 'desc' }, { publishedAt: 'desc' }],
    take: limit,
  });
  return rows.map((a) => toDTO(a, actor));
}

/** One announcement the caller may see; 404 otherwise, as if it did not exist. */
export async function getById(actor: AnnouncementActor, id: string) {
  const a = await prisma.announcement.findFirst({
    where: { AND: [{ id }, await boardOf(actor, new Date())] },
    include: SHOWN,
  });
  if (!a) throw notFound();
  const [shown] = await withDelivery([a], actor);
  return shown;
}

/** Counts over the announcements the caller oversees (or can see). */
export async function stats(actor: AnnouncementActor): Promise<AnnouncementStatsDTO> {
  const now = new Date();
  const board = await boardOf(actor, now);
  const { year, month } = wibMonthYear(now);
  const startOfMonth = wibMonthRange(year, month).start;
  const [total, active, urgent, thisMonth] = await Promise.all([
    prisma.announcement.count({ where: board }),
    prisma.announcement.count({ where: { AND: [board, live(now)] } }),
    prisma.announcement.count({ where: { AND: [board, live(now), { priority: 2 }] } }),
    prisma.announcement.count({ where: { AND: [board, { createdAt: { gte: startOfMonth } }] } }),
  ]);
  return { total, active, urgent, thisMonth };
}

// ==================== COMPOSE ====================

/** The classes a guru or ustadz teaches or homerooms now. */
async function classesOf(userId: string) {
  const teacher = await prisma.teacher.findFirst({
    where: { userId, deletedAt: null },
    select: { id: true },
  });
  if (!teacher) return [];
  return prisma.class.findMany({
    where: {
      deletedAt: null,
      academicYear: { isActive: true },
      OR: [
        { homeroomTeacherId: teacher.id },
        { schedules: { some: { teacherId: teacher.id, isActive: true } } },
      ],
    },
    select: { id: true, name: true, unitId: true, unit: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
}

export async function composeOptions(
  actor: AnnouncementActor
): Promise<AnnouncementComposeOptionsDTO> {
  const scopes = scopesFor(actor);
  const units = scopes.includes('UNIT')
    ? await prisma.unit.findMany({
        where: choosesUnit(actor) ? {} : { id: actor.unitId ?? '' },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
    : [];
  const classes = scopes.includes('CLASSES') ? await classesOf(actor.sub) : [];
  const boarders = scopes.includes('BOARDERS') ? (await boardersOfMusyrif(actor.sub)).length : 0;
  return {
    scopes,
    units,
    classes: classes.map((c) => ({ id: c.id, name: c.name, unitName: c.unit?.name ?? null })),
    boarders,
  };
}

// ==================== WRITE ====================

export async function create(actor: AnnouncementActor, input: CreateAnnouncementBody) {
  if (!scopesFor(actor).includes(input.scope)) {
    throw Errors.forbidden('Anda tidak dapat menerbitkan pengumuman untuk cakupan ini');
  }

  let unitId: string | null = actor.unitId;
  let classIds: string[] = [];
  let studentIds: string[] = [];
  switch (input.scope) {
    case 'YAYASAN':
      unitId = null;
      break;
    case 'UNIT':
      if (choosesUnit(actor)) {
        if (!input.unitId) throw Errors.badRequest('Pilih unit');
        const unit = await prisma.unit.findUnique({
          where: { id: input.unitId },
          select: { id: true },
        });
        if (!unit) throw Errors.badRequest('Unit tidak ditemukan');
        unitId = unit.id;
      }
      break;
    case 'CLASSES': {
      const own = await classesOf(actor.sub);
      const outside = input.classIds.filter((id) => !own.some((c) => c.id === id));
      if (outside.length) {
        throw Errors.forbidden('Pengumuman kelas hanya untuk kelas yang Anda ajar atau walikan');
      }
      classIds = [...new Set(input.classIds)];
      unitId = own.find((c) => c.id === classIds[0])?.unitId ?? actor.unitId;
      break;
    }
    case 'BOARDERS':
      studentIds = await boardersOfMusyrif(actor.sub);
      if (!studentIds.length) throw Errors.badRequest('Anda belum membina santri mukim');
      break;
  }

  const now = new Date();
  const publishedAt = input.publishedAt ?? now;
  const created = await prisma.announcement.create({
    data: {
      scope: input.scope,
      unitId,
      classIds,
      studentIds,
      title: input.title,
      content: input.content,
      type: input.type,
      priority: input.priority,
      attachmentUrl: input.attachmentUrl ?? null,
      publishedAt,
      expiresAt: input.expiresAt ?? null,
      targetRoles: input.targetRoles,
      createdById: actor.sub,
    },
    include: SHOWN,
  });

  try {
    const delivered = await deliverAnnouncement({
      id: created.id,
      title: created.title,
      content: created.content,
      sentBy: actor.sub,
      scheduledAt: publishedAt > now ? publishedAt : null,
      recipients: await recipientsOf(created),
    });
    return toDTO(created, actor, { recipients: delivered, read: 0 });
  } catch (error) {
    // Nothing half-sent: an announcement no bell received is not left behind.
    await prisma.announcement.delete({ where: { id: created.id } }).catch(() => undefined);
    throw error;
  }
}

async function manageable(actor: AnnouncementActor, id: string) {
  const a = await prisma.announcement.findUnique({ where: { id }, include: SHOWN });
  if (!a) throw notFound();
  if (!mayManage(actor, a)) {
    // Seen but not one's own to change: 403; not even seen: 404.
    const visible = await prisma.announcement.count({
      where: { AND: [{ id }, await boardOf(actor, new Date())] },
    });
    throw visible ? Errors.forbidden('Anda tidak dapat mengubah pengumuman ini') : notFound();
  }
  if (a.withdrawnAt) throw Errors.badRequest('Pengumuman ini sudah ditarik');
  return a;
}

export async function update(actor: AnnouncementActor, id: string, input: UpdateAnnouncementBody) {
  const current = await manageable(actor, id);
  if (input.expiresAt && input.expiresAt <= (current.publishedAt ?? new Date())) {
    throw Errors.badRequest('Berakhir harus sesudah waktu terbit');
  }
  const updated = await prisma.announcement.update({
    where: { id },
    data: input,
    include: SHOWN,
  });
  await reviseAnnouncementDelivery(id, { title: input.title, content: input.content });
  return toDTO(updated, actor);
}

/** Off the board and out of every bell; the row stays as the record. */
export async function withdraw(actor: AnnouncementActor, id: string) {
  await manageable(actor, id);
  const withdrawn = await prisma.announcement.update({
    where: { id },
    data: { withdrawnAt: new Date(), withdrawnById: actor.sub },
    include: SHOWN,
  });
  const removed = await withdrawAnnouncementDelivery(id);
  return { ...toDTO(withdrawn, actor), removedFromBells: removed };
}
