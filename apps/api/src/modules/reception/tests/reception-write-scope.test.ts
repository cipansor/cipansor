import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    guestBook: { findUnique: vi.fn(), update: vi.fn() },
    studentVisit: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    studentPackage: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    student: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
// The service's inputs are the `@cipansor/shared` DTOs, whose `status` is the
// shared `PackageStatus`; the test must use that enum, not Prisma's twin.
import { PackageStatus } from '@cipansor/shared';
import * as service from '../reception.service';
import {
  createStudentVisitSchema,
  createStudentPackageSchema,
  createGuestBookSchema,
} from '../reception.schema';

// A resepsionis pinned to unit-1.
const ACTOR = { sub: 'user-1', roleCode: 'SDIT_STAFF', unitId: 'unit-1' };

describe('ReceptionService — write scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updateGuestBook refuses a guest book entry of another unit (404)', async () => {
    vi.mocked(prisma.guestBook.findUnique).mockResolvedValue({ unitId: 'other-unit' } as never);

    await expect(service.updateGuestBook('g-1', { notes: 'x' }, ACTOR)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prisma.guestBook.update).not.toHaveBeenCalled();
  });

  it('updateGuestBook updates an entry of the actor own unit', async () => {
    vi.mocked(prisma.guestBook.findUnique).mockResolvedValue({ unitId: 'unit-1' } as never);
    vi.mocked(prisma.guestBook.update).mockResolvedValue({ id: 'g-1' } as never);

    await expect(service.updateGuestBook('g-1', { notes: 'x' }, ACTOR)).resolves.toBeDefined();
  });

  it('updateStudentVisit refuses a visit of another unit (404)', async () => {
    vi.mocked(prisma.studentVisit.findUnique).mockResolvedValue({ unitId: 'other-unit' } as never);

    await expect(service.updateStudentVisit('v-1', { notes: 'x' }, ACTOR)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prisma.studentVisit.update).not.toHaveBeenCalled();
  });

  it('updatePackage refuses a parcel of another unit (404)', async () => {
    vi.mocked(prisma.studentPackage.findUnique).mockResolvedValue({
      unitId: 'other-unit',
    } as never);

    await expect(service.updatePackage('p-1', { notes: 'x' }, ACTOR)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prisma.studentPackage.update).not.toHaveBeenCalled();
  });

  it('createStudentVisit refuses a santri the actor does not reach (404)', async () => {
    vi.mocked(prisma.student.findFirst).mockResolvedValue(null);

    await expect(
      service.createStudentVisit(
        'unit-1',
        { studentId: 's-1', visitorName: 'Budi', relationship: 'Ayah', needs: 'Jenguk' },
        ACTOR
      )
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.studentVisit.create).not.toHaveBeenCalled();
  });

  it('createStudentVisit looks the santri up in the record own unit, not scope alone', async () => {
    // A foundation account reaches every santri, so scope alone would let it
    // file a unit-1 visit about a unit-2 santri; the lookup must carry unit-1.
    vi.mocked(prisma.student.findFirst).mockResolvedValue(null);

    await expect(
      service.createStudentVisit(
        'unit-1',
        { studentId: 's-1', visitorName: 'Budi', relationship: 'Ayah', needs: 'Jenguk' },
        { sub: 'u-1', roleCode: 'YAYASAN_KETUA', unitId: null }
      )
    ).rejects.toMatchObject({ statusCode: 404 });

    const where = vi.mocked(prisma.student.findFirst).mock.calls[0][0]?.where as {
      AND: Array<Record<string, unknown>>;
    };
    expect(where.AND).toContainEqual({ unitId: 'unit-1' });
  });

  it('createPackage looks the santri up in the record own unit, not scope alone', async () => {
    vi.mocked(prisma.student.findFirst).mockResolvedValue(null);

    await expect(
      service.createPackage(
        'unit-1',
        'user-1',
        { studentId: 's-1', senderName: 'JNE', expedition: 'JNE', content: 'Buku' },
        { sub: 'u-1', roleCode: 'YAYASAN_KETUA', unitId: null }
      )
    ).rejects.toMatchObject({ statusCode: 404 });

    const where = vi.mocked(prisma.student.findFirst).mock.calls[0][0]?.where as {
      AND: Array<Record<string, unknown>>;
    };
    expect(where.AND).toContainEqual({ unitId: 'unit-1' });
  });

  it('createPackage refuses a santri the actor does not reach (404)', async () => {
    vi.mocked(prisma.student.findFirst).mockResolvedValue(null);

    await expect(
      service.createPackage(
        'unit-1',
        'user-1',
        { studentId: 's-1', senderName: 'JNE', expedition: 'JNE', content: 'Buku' },
        ACTOR
      )
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.studentPackage.create).not.toHaveBeenCalled();
  });

  it('createPackage persists the storageLocation the form sends', async () => {
    vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: 's-1' } as never);
    vi.mocked(prisma.studentPackage.create).mockResolvedValue({
      id: 'p-1',
      student: null,
    } as never);

    await service.createPackage(
      'unit-1',
      'user-1',
      {
        studentId: 's-1',
        senderName: 'JNE',
        expedition: 'JNE',
        content: 'Buku',
        storageLocation: 'Rak A1',
      },
      ACTOR
    );

    expect(prisma.studentPackage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ storageLocation: 'Rak A1' }) })
    );
  });

  it('updatePackage keeps an explicit pickedUpAt instead of overwriting it with now()', async () => {
    const pickedUpAt = new Date('2026-11-01T02:00:00.000Z');
    vi.mocked(prisma.studentPackage.findUnique).mockResolvedValue({
      unitId: 'unit-1',
      pickedUpAt: null,
    } as never);
    vi.mocked(prisma.studentPackage.update).mockResolvedValue({ id: 'p-1' } as never);

    await service.updatePackage('p-1', { status: PackageStatus.PICKED_UP, pickedUpAt }, ACTOR);

    expect(prisma.studentPackage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pickedUpAt }),
      })
    );
  });

  it('updatePackage stamps pickedUpAt on a PICKED_UP transition with none given', async () => {
    vi.mocked(prisma.studentPackage.findUnique).mockResolvedValue({
      unitId: 'unit-1',
      pickedUpAt: null,
    } as never);
    vi.mocked(prisma.studentPackage.update).mockResolvedValue({ id: 'p-1' } as never);

    await service.updatePackage('p-1', { status: PackageStatus.PICKED_UP }, ACTOR);

    const call = vi.mocked(prisma.studentPackage.update).mock.calls[0][0] as {
      data: { pickedUpAt?: Date };
    };
    expect(call.data.pickedUpAt).toBeInstanceOf(Date);
  });
});

describe('Reception schemas — flat, and named as the shared DTO', () => {
  it('createStudentVisitSchema accepts the shared DTO field names', () => {
    const parsed = createStudentVisitSchema.parse({
      studentId: '00000000-0000-4000-8000-000000000000',
      visitorName: 'Budi',
      relationship: 'Ayah',
      needs: 'Jenguk',
    });
    expect(parsed).toMatchObject({ relationship: 'Ayah', needs: 'Jenguk' });
  });

  it('createStudentPackageSchema accepts expedition/content/storageLocation', () => {
    const parsed = createStudentPackageSchema.parse({
      studentId: '00000000-0000-4000-8000-000000000000',
      senderName: 'JNE',
      expedition: 'JNE',
      content: 'Buku',
      storageLocation: 'Rak A1',
    });
    expect(parsed).toMatchObject({ expedition: 'JNE', content: 'Buku', storageLocation: 'Rak A1' });
  });

  it('createGuestBookSchema is flat — no { body } wrapper', () => {
    const parsed = createGuestBookSchema.parse({ name: 'Tamu', purpose: 'Dinas', visitorCount: 2 });
    expect(parsed).toMatchObject({ name: 'Tamu', purpose: 'Dinas', visitorCount: 2 });
  });
});
