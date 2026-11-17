import { describe, it, expect, vi, beforeEach } from 'vitest';

// Who reads a confidential counselling session, and how much of it (decided
// 2026-09-26): its counsellor and the unit's guru BK in full; the unit's
// kepala sekolah its referrals only; nobody else at all.

vi.mock('@/lib/prisma', () => {
  const prisma = {
    counselingSession: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    counselingNote: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    counselingReferral: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    student: { findUnique: vi.fn() },
    teacher: { findFirst: vi.fn() },
  };
  return { prisma };
});
vi.mock('../../notifications/notifications.service', () => ({ createNotification: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { counselingService, viewerAccess } from '../counseling.service';

type Mocked = Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const db = prisma as unknown as Mocked;

const SMP = 'unit-smp';
const SMA = 'unit-sma';
const actor = (sub: string, roleCode: string, unitId: string | null) => ({ sub, roleCode, unitId });
const counselor = actor('u-counselor', 'SMPIT_GURU', SMP);
const guruBk = actor('u-bk', 'SMPIT_GURU_BK', SMP);
const guruBkSma = actor('u-bk-sma', 'SMAQ_GURU_BK', SMA);
const kepala = actor('u-kepala', 'SMPIT_KEPALA_SEKOLAH', SMP);
const kepalaSma = actor('u-kepala-sma', 'SMAQ_KEPALA_SEKOLAH', SMA);
const guru = actor('u-guru', 'SMPIT_GURU', SMP);
const adminUnit = actor('u-admin', 'SMPIT_ADMIN', SMP);
const pembina = actor('u-pembina', 'YAYASAN_PEMBINA', null);
const superAdmin = actor('u-sa', 'SUPER_ADMIN', null);

const secret = () => ({
  id: 's-1',
  unitId: SMP,
  studentId: 'st-1',
  isConfidential: true,
  category: 'PSYCHOLOGICAL_OBSERVATION',
  title: 'Observasi kecemasan',
  description: 'Isi rahasia',
  summary: 'Ringkasan rahasia',
  recommendations: 'Rekomendasi rahasia',
  psychologyData: { anxiety: 'high' },
  counselor: { id: 't-1', userId: 'u-counselor', user: { id: 'u-counselor', name: 'Konselor' } },
  student: { id: 'st-1', nis: '001', user: { id: 'us-1', name: 'Santri' }, enrollments: [] },
  notes: [{ id: 'n-1', content: 'Catatan rahasia' }],
  referrals: [{ id: 'r-1', type: 'EXTERNAL', referredTo: 'Psikolog', reason: 'Asesmen lanjut' }],
  _count: { notes: 1, referrals: 1 },
});
const open = () => ({ ...secret(), isConfidential: false, category: 'ACADEMIC' });

beforeEach(() => {
  vi.clearAllMocks();
  db.counselingSession.findMany.mockResolvedValue([]);
  db.counselingSession.count.mockResolvedValue(0);
  db.counselingNote.create.mockResolvedValue({ id: 'n-2' });
  db.counselingReferral.create.mockResolvedValue({ id: 'r-2' });
});

describe('who reads a confidential session', () => {
  const facts = { isConfidential: true, unitId: SMP, counselor: { userId: 'u-counselor' } };

  it.each([
    ['its counsellor', counselor, 'FULL'],
    ["the unit's guru BK", guruBk, 'FULL'],
    ["another unit's guru BK", guruBkSma, 'NONE'],
    ["the unit's kepala sekolah", kepala, 'REFERRALS_ONLY'],
    ["another unit's kepala sekolah", kepalaSma, 'NONE'],
    ['another teacher of the unit', guru, 'NONE'],
    ['its admin unit', adminUnit, 'NONE'],
    ['a yayasan organ', pembina, 'NONE'],
    ['the super admin', superAdmin, 'NONE'],
  ])('%s → %s', (_who, who, expected) => {
    expect(viewerAccess(who, facts)).toBe(expected);
  });

  it('a session that is not confidential is read in full as before', () => {
    expect(viewerAccess(guru, { ...facts, isConfidential: false })).toBe('FULL');
  });
});

describe('reading one session', () => {
  it('the kepala sekolah gets the referrals and none of the content', async () => {
    db.counselingSession.findUnique.mockResolvedValue(secret());
    const got = (await counselingService.getSessionById('s-1', kepala)) as unknown as Record<
      string,
      unknown
    >;
    expect(got).toMatchObject({
      title: 'Sesi rahasia',
      description: null,
      summary: null,
      recommendations: null,
      psychologyData: null,
      viewerAccess: 'REFERRALS_ONLY',
      referrals: [expect.objectContaining({ referredTo: 'Psikolog' })],
      _count: { notes: 0, referrals: 1 },
    });
    expect(got.notes).toBeUndefined();
    const sent = JSON.stringify(got);
    for (const content of [
      'Isi rahasia',
      'Ringkasan',
      'Rekomendasi',
      'Catatan',
      'kecemasan',
      'anxiety',
    ]) {
      expect(sent).not.toContain(content);
    }
  });

  it('the counsellor and the guru BK get all of it', async () => {
    for (const who of [counselor, guruBk]) {
      db.counselingSession.findUnique.mockResolvedValue(secret());
      const got = await counselingService.getSessionById('s-1', who);
      expect(got).toMatchObject({ title: 'Observasi kecemasan', viewerAccess: 'FULL' });
      expect(got.notes).toHaveLength(1);
    }
  });

  it('anyone else is told it does not exist (404)', async () => {
    for (const who of [guru, adminUnit, pembina, superAdmin]) {
      db.counselingSession.findUnique.mockResolvedValue(secret());
      await expect(counselingService.getSessionById('s-1', who)).rejects.toMatchObject({
        statusCode: 404,
      });
    }
  });

  it("a child's record leaves as name, NIS and class only", async () => {
    db.counselingSession.findUnique.mockResolvedValue(open());
    await counselingService.getSessionById('s-1', guru);
    const include = db.counselingSession.findUnique.mock.calls[0][0].include;
    expect(Object.keys(include.student.select).sort()).toEqual([
      'enrollments',
      'id',
      'nis',
      'unitId',
      'user',
    ]);
    expect(include.counselor.select.user).toEqual({ select: { id: true, name: true } });
  });
});

describe('the list', () => {
  const visibility = () => db.counselingSession.findMany.mock.calls[0][0].where.AND[0];

  it('a teacher is sent open sessions and their own', async () => {
    await counselingService.getSessions({}, guru);
    expect(visibility()).toEqual({
      OR: [{ isConfidential: false }, { counselor: { userId: 'u-guru' } }],
    });
  });

  it("the guru BK and the kepala sekolah are also sent the unit's confidential ones", async () => {
    for (const who of [guruBk, kepala]) {
      db.counselingSession.findMany.mockClear();
      await counselingService.getSessions({}, who);
      expect(visibility().OR).toContainEqual({ unitId: SMP });
    }
  });

  it('what arrives for the kepala sekolah is withheld; a stray row for a teacher is dropped', async () => {
    db.counselingSession.findMany.mockResolvedValue([secret(), open()]);
    const forKepala = await counselingService.getSessions({}, kepala);
    expect(forKepala.data.map((s) => s.title)).toEqual(['Sesi rahasia', 'Observasi kecemasan']);

    const forGuru = await counselingService.getSessions({}, guru);
    expect(forGuru.data).toHaveLength(1);
    expect(forGuru.data[0].isConfidential).toBe(false);
  });

  it('searching title or description only reaches sessions the caller may read in full', async () => {
    await counselingService.getSessions({ search: 'cemas' }, kepala);
    const search = db.counselingSession.findMany.mock.calls[0][0].where.AND[1].OR[0];
    expect(search.AND[0]).toEqual({
      OR: [{ isConfidential: false }, { counselor: { userId: 'u-kepala' } }],
    });
  });

  it("a student's history is filtered the same way", async () => {
    db.student.findUnique.mockResolvedValue({ id: 'st-1', unitId: SMP });
    await counselingService.getStudentHistory('st-1', guru);
    expect(db.counselingSession.findMany.mock.calls[0][0].where.AND).toEqual([
      { studentId: 'st-1' },
      { OR: [{ isConfidential: false }, { counselor: { userId: 'u-guru' } }] },
    ]);
  });
});

describe('the counts', () => {
  it('count what the caller is sent, not what is withheld from them', async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    (db.counselingSession as Record<string, unknown>).groupBy = groupBy;
    await counselingService.getStatistics(adminUnit);
    expect(db.counselingSession.count.mock.calls[0][0].where).toEqual({
      unitId: SMP,
      AND: [{ OR: [{ isConfidential: false }, { counselor: { userId: 'u-admin' } }] }],
    });
    expect(groupBy.mock.calls[0][0].where.AND).toHaveLength(1);
  });
});

describe('changing a confidential session', () => {
  const note = { content: 'x', noteType: 'general' };

  it('its counsellor and the guru BK may', async () => {
    for (const who of [counselor, guruBk]) {
      db.counselingSession.findUnique.mockResolvedValue(secret());
      await counselingService.addNote('s-1', note, who);
    }
    expect(db.counselingNote.create).toHaveBeenCalledTimes(2);
  });

  it('the kepala sekolah reads its referrals but may not change it (403)', async () => {
    db.counselingSession.findUnique.mockResolvedValue(secret());
    await expect(counselingService.addNote('s-1', note, kepala)).rejects.toMatchObject({
      statusCode: 403,
    });
    db.counselingNote.findUnique.mockResolvedValue({ id: 'n-1', session: secret() });
    await expect(
      counselingService.updateNote('n-1', { content: 'y' }, kepala)
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('nobody else learns it exists (404), the super admin included', async () => {
    for (const who of [guru, superAdmin]) {
      db.counselingSession.findUnique.mockResolvedValue(secret());
      await expect(counselingService.deleteSession('s-1', who)).rejects.toMatchObject({
        statusCode: 404,
      });
      db.counselingReferral.findUnique.mockResolvedValue({ id: 'r-1', session: secret() });
      await expect(counselingService.deleteReferral('r-1', who)).rejects.toMatchObject({
        statusCode: 404,
      });
    }
    expect(db.counselingSession.delete).not.toHaveBeenCalled();
    expect(db.counselingReferral.delete).not.toHaveBeenCalled();
  });

  it('an open session keeps the unit rule: any teacher of the unit', async () => {
    db.counselingSession.findUnique.mockResolvedValue(open());
    await counselingService.addReferral(
      's-1',
      { type: 'INTERNAL', referredTo: 'Wali kelas', reason: 'Tindak lanjut' } as never,
      guru
    );
    expect(db.counselingReferral.create).toHaveBeenCalledTimes(1);
  });
});
