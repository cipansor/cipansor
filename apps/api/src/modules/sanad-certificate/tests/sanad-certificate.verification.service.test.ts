import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    digitalCertificate: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    sanadRecord: { findUnique: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { verifyCertificate, generateCertificate } from '../sanad-certificate.service';
import { generateCertificateSchema } from '../sanad-certificate.schema';

const mocked = prisma as unknown as {
  digitalCertificate: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  sanadRecord: { findUnique: ReturnType<typeof vi.fn> };
};

const storedCertificate = {
  id: 'cert-1',
  certificateNumber: 'SANAD-202601-ABCD1234',
  qrCode: 'A1B2C3D4E5F6',
  certificateType: 'SANAD',
  title: 'Sertifikat Sanad Juz 30',
  grade: 'Mumtaz',
  issueDate: new Date('2026-01-10'),
  signatoryName: 'Ust. Ahmad',
  signatoryTitle: 'Guru Tahfidz',
  student: {
    user: { name: 'Santri Fulan' },
    unit: { name: 'SMA Quran Cipansor' },
  },
};

describe('verifyCertificate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects certificates that are not in the database, even with a valid-looking number', async () => {
    mocked.digitalCertificate.findFirst.mockResolvedValue(null);

    const result = await verifyCertificate({
      certificateNumber: 'SANAD-202601-DEADBEEF',
    });

    expect(result.valid).toBe(false);
    expect(result).not.toHaveProperty('data');
  });

  it('never discloses a private certificate, and answers exactly as an unknown number does', async () => {
    // A private certificate is invisible to this public route: the query must
    // carry `isPublic: true` so the row is never found, and the caller gets the
    // same "tidak ditemukan" answer as a number that does not exist — the route
    // must not confirm that a private certificate exists. Before the fix this
    // used `findUnique({ where: { certificateNumber } })` and returned the
    // holder, unit and grade for any number (CWE-862).
    mocked.digitalCertificate.findFirst.mockResolvedValue(null);

    const result = await verifyCertificate({
      certificateNumber: 'SANAD-202601-PRIVATE1',
    });

    expect(mocked.digitalCertificate.findFirst.mock.calls[0][0].where.isPublic).toBe(true);
    expect(result.valid).toBe(false);
    expect(result).not.toHaveProperty('data');
  });

  it('rejects a mismatching verification code for an existing certificate', async () => {
    mocked.digitalCertificate.findFirst.mockResolvedValue(storedCertificate);

    const result = await verifyCertificate({
      certificateNumber: 'SANAD-202601-ABCD1234',
      verificationCode: 'WRONGCODE111',
    });

    expect(result.valid).toBe(false);
  });

  it('returns certificate details for a registered public certificate', async () => {
    mocked.digitalCertificate.findFirst.mockResolvedValue(storedCertificate);

    const result = await verifyCertificate({
      certificateNumber: 'SANAD-202601-ABCD1234',
      verificationCode: 'a1b2c3d4e5f6', // case-insensitive match
    });

    expect(result.valid).toBe(true);
    expect(result.data).toMatchObject({
      certificateNumber: 'SANAD-202601-ABCD1234',
      studentName: 'Santri Fulan',
      grade: 'Mumtaz',
      unitName: 'SMA Quran Cipansor',
    });
  });
});

describe('generateCertificate persistence', () => {
  beforeEach(() => vi.clearAllMocks());

  const sanad = {
    id: 'sanad-1',
    juz: 30,
    grade: 'MUMTAZ',
    certifiedAt: new Date('2026-01-10'),
    enrollment: {
      student: {
        id: 'student-1',
        nis: '12345',
        user: { name: 'Santri Fulan' },
        unit: { id: 'unit-1', name: 'SMA Quran Cipansor' },
      },
      halaqoh: { id: 'h-1', name: 'Halaqoh A' },
    },
    teacher: { id: 't-1', name: 'Ust. Ahmad', email: 't@x.id' },
  };

  it('persists a DigitalCertificate on first generation', async () => {
    mocked.sanadRecord.findUnique.mockResolvedValue(sanad);
    mocked.digitalCertificate.findFirst.mockResolvedValue(null);
    mocked.digitalCertificate.create.mockImplementation(async ({ data }: any) => ({
      ...data,
      id: 'cert-new',
    }));

    const result = await generateCertificate(
      generateCertificateSchema.parse({ sanadId: '11111111-1111-4111-8111-111111111111' }),
      { userId: 'admin-1' }
    );

    expect(mocked.digitalCertificate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          studentId: 'student-1',
          certificateType: 'SANAD',
          createdById: 'admin-1',
          // The printed URL points at the public page, so the row must be
          // public the moment it is minted — the column default (`false`) left
          // every freshly issued certificate failing its own verification. The
          // route parses the body through this schema, whose default supplies
          // `isPublic: true`.
          isPublic: true,
          // What was printed on the sanad is persisted, so the public download
          // reproduces the issued document instead of the generic layout.
          metadata: expect.objectContaining({ juz: 30, teacherName: 'Ust. Ahmad' }),
        }),
      })
    );
    expect(result.certificateNumber).toMatch(/^SANAD-\d{6}-[A-F0-9]+$/);
    expect(result.verificationCode).toBeTruthy();
  });

  it('honours an explicit private choice, so an internal record stays internal', async () => {
    mocked.sanadRecord.findUnique.mockResolvedValue(sanad);
    mocked.digitalCertificate.findFirst.mockResolvedValue(null);
    mocked.digitalCertificate.create.mockImplementation(async ({ data }: any) => ({
      ...data,
      id: 'cert-internal',
    }));

    await generateCertificate(
      {
        sanadId: 'sanad-1',
        templateType: 'STANDARD',
        includeQRCode: true,
        isPublic: false,
      },
      { userId: 'admin-1' }
    );

    expect(mocked.digitalCertificate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isPublic: false }),
      })
    );
  });

  it('reuses the stored number when regenerating the same certificate', async () => {
    mocked.sanadRecord.findUnique.mockResolvedValue(sanad);
    mocked.digitalCertificate.findFirst.mockResolvedValue({
      certificateNumber: 'SANAD-202601-EXISTING1',
      qrCode: 'FIXEDCODE123',
    });

    const result = await generateCertificate(
      generateCertificateSchema.parse({ sanadId: '11111111-1111-4111-8111-111111111111' }),
      { userId: 'admin-1' }
    );

    expect(mocked.digitalCertificate.create).not.toHaveBeenCalled();
    expect(result.certificateNumber).toBe('SANAD-202601-EXISTING1');
    expect(result.verificationCode).toBe('FIXEDCODE123');
  });
});
