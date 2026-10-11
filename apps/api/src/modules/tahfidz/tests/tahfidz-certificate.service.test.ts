import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    digitalCertificate: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';
import { TahfidzService } from '../tahfidz.service';
import { generateCertificateSchema } from '../tahfidz.schema';

const mocked = prisma as unknown as {
  digitalCertificate: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

/**
 * A freshly minted syahadah is printed with a QR that points at the public
 * verification page, so the row it lives in must be public from the moment it
 * is written — `generateCertificate` omitted `isPublic`, the column default
 * (`false`) applied, and every new tahfidz certificate failed its own
 * verification. The issuer may still opt out explicitly.
 */
describe('TahfidzService.generateCertificate visibility', () => {
  let service: TahfidzService;

  beforeEach(() => {
    service = new TahfidzService();
    vi.clearAllMocks();
    mocked.digitalCertificate.findFirst.mockResolvedValue(null);
    mocked.digitalCertificate.create.mockImplementation(async ({ data }: any) => ({
      ...data,
      id: 'cert-new',
    }));
  });

  /** Exactly what the route hands the service: the body parsed by the schema. */
  const parsed = (body: Record<string, unknown>) => generateCertificateSchema.parse(body);

  it('defaults a certificate to public, so the printed QR verifies', async () => {
    await service.generateCertificate(
      parsed({
        studentId: '11111111-1111-4111-8111-111111111111',
        certificateType: 'TAHFIDZ_30_JUZ',
        grade: 'MUMTAZ',
        qiraahType: 'Hafs',
        completedJuz: [1, 2, 3],
        musyrifName: 'Ust. Ahmad',
      }),
      'issuer-1'
    );

    expect(mocked.digitalCertificate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isPublic: true,
          // The qira'ah, juz and silsilah printed on the syahadah are stored,
          // so the public download reproduces the issued document.
          metadata: expect.objectContaining({
            qiraahType: 'Hafs',
            completedJuz: [1, 2, 3],
            musyrifName: 'Ust. Ahmad',
          }),
        }),
      })
    );
  });

  it('honours an explicit private choice for an internal record', async () => {
    await service.generateCertificate(
      parsed({
        studentId: '11111111-1111-4111-8111-111111111111',
        certificateType: 'TAHFIDZ_30_JUZ',
        grade: 'MUMTAZ',
        isPublic: false,
      }),
      'issuer-1'
    );

    expect(mocked.digitalCertificate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isPublic: false }),
      })
    );
  });
});
