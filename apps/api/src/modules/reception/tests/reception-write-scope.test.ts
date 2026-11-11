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
