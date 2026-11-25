import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as service from '../admissions.service';
import { prisma } from '@/lib/prisma';

// Calls made through the transaction client, not the base client. A lock
// issued outside `$transaction` looks identical in call order but releases
// before the wave update, so tests must be able to tell the two apart.
const { txCalls } = vi.hoisted(() => ({
  txCalls: {
    executeRaw: [] as unknown[][],
    waveUpdate: [] as unknown[][],
    waveUpdateMany: [] as unknown[][],
    registrantDelete: [] as unknown[][],
    registrantUpdate: [] as unknown[][],
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    admissionPeriod: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    registrant: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    registrantDocument: {
      count: vi.fn(),
      create: vi.fn(),
    },
    paymentType: {
      findFirst: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
    invoice: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    admissionWave: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    // The public form's consent is checked against a published Kebijakan
    // Privasi version (see `assertVersionExists`).
    privacyPolicyVersion: {
      findUnique: vi.fn(),
    },
    // The retention delete re-checks open data-subject requests under a row
    // lock (`$executeRaw` is Prisma's lock form; a lock returns `void`).
    dataSubjectRequest: {
      findFirst: vi.fn(),
    },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn((cb) => {
      const tx = new Proxy(prisma, {
        get(target, prop) {
          if (prop === '$executeRaw') {
            return (...args: unknown[]) => {
              txCalls.executeRaw.push(args);
              return (target.$executeRaw as any)(...args);
            };
          }
          if (prop === 'admissionWave') {
            return new Proxy(target.admissionWave, {
              get(waveTarget, waveProp) {
                if (waveProp === 'update') {
                  return (...args: unknown[]) => {
                    txCalls.waveUpdate.push(args);
                    return (waveTarget.update as any)(...args);
                  };
                }
                if (waveProp === 'updateMany') {
                  return (...args: unknown[]) => {
                    txCalls.waveUpdateMany.push(args);
                    return (waveTarget.updateMany as any)(...args);
                  };
                }
                return Reflect.get(waveTarget, waveProp);
              },
            });
          }
          if (prop === 'registrant') {
            return new Proxy(target.registrant, {
              get(regTarget, regProp) {
                if (regProp === 'delete') {
                  return (...args: unknown[]) => {
                    txCalls.registrantDelete.push(args);
                    return (regTarget.delete as any)(...args);
                  };
                }
                if (regProp === 'update') {
                  return (...args: unknown[]) => {
                    txCalls.registrantUpdate.push(args);
                    return (regTarget.update as any)(...args);
                  };
                }
                return Reflect.get(regTarget, regProp);
              },
            });
          }
          return Reflect.get(target, prop);
        },
      });
      return cb(tx);
    }),
  },
}));

vi.mock('@prisma/client', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    Prisma: {
      ...actual.Prisma,
      Decimal: class {
        val: number;
        constructor(v: any) {
          this.val = Number(v);
        }
        toNumber() {
          return this.val;
        }
      },
      PrismaClientKnownRequestError: class extends Error {},
    },
  };
});

describe('Admissions Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txCalls.executeRaw.length = 0;
    txCalls.waveUpdate.length = 0;
    txCalls.waveUpdateMany.length = 0;
    txCalls.registrantDelete.length = 0;
    txCalls.registrantUpdate.length = 0;
    vi.mocked(prisma.admissionWave.count as any).mockResolvedValue(0);
    // Wave mocks are set per test; without a reset, a wave left by an earlier
    // test would be "found" by the next one (e.g. making a full period look
    // claimable).
    vi.mocked(prisma.admissionWave.findUnique as any).mockReset();
    vi.mocked(prisma.admissionWave.findMany as any)
      .mockReset()
      .mockResolvedValue([]);
    vi.mocked(prisma.admissionWave.update as any).mockReset();
    vi.mocked(prisma.admissionWave.updateMany as any).mockReset();
    // The registration counter is incremented atomically; each test that
    // creates a registrant gets its own starting sequence.
    vi.mocked(prisma.admissionPeriod.update as any).mockResolvedValue({ registrationSeq: 1 });
    vi.mocked(prisma.$executeRaw as any)
      .mockReset()
      .mockResolvedValue(1);
    // Most tests do not have a row with the candidate number; tests that do
    // override this with their own sequence.
    vi.mocked(prisma.registrant.findUnique as any).mockResolvedValue(null);
  });

  it('should reject document upload when registration token is registrant id or non-timestamped token', async () => {
    vi.mocked(prisma.registrant.findUnique).mockResolvedValue({
      id: 'reg123',
      registrationNo: 'REG-001',
    } as any);

    // Rejecting registrant.id as token
    await expect(
      service.createPublicRegistrantDocumentService({
        registrantId: 'reg123',
        type: 'PHOTO',
        base64:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        registrationToken: 'reg123',
      })
    ).rejects.toThrow('Invalid registration token');

    // Rejecting non-timestamped simple HMAC token
    const crypto = await import('crypto');
    const { config } = await import('../../../config');
    const simpleHmac = crypto
      .createHmac('sha256', config.jwt.secret)
      .update('reg123')
      .digest('hex')
      .slice(0, 16);

    await expect(
      service.createPublicRegistrantDocumentService({
        registrantId: 'reg123',
        type: 'PHOTO',
        base64:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        registrationToken: simpleHmac,
      })
    ).rejects.toThrow('Invalid registration token');
  });

  it('should reject document upload when timestamped registration token is expired (> 2 hours)', async () => {
    const crypto = await import('crypto');
    const { config } = await import('../../../config');
    const oldTimestamp = Date.now() - 3 * 60 * 60 * 1000; // 3 hours ago
    const tsHex = oldTimestamp.toString(16);
    const hmacHex = crypto
      .createHmac('sha256', config.jwt.secret)
      .update(`reg123:${tsHex}`)
      .digest('hex')
      .slice(0, 16);
    const expiredToken = `${tsHex}.${hmacHex}`;

    vi.mocked(prisma.registrant.findUnique).mockResolvedValue({
      id: 'reg123',
      registrationNo: 'REG-001',
    } as any);

    await expect(
      service.createPublicRegistrantDocumentService({
        registrantId: 'reg123',
        type: 'PHOTO',
        base64:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        registrationToken: expiredToken,
      })
    ).rejects.toThrow('Invalid registration token');
  });

  it('should reject document upload when url contains data-URI exceeding size limit or invalid MIME', async () => {
    const crypto = await import('crypto');
    const { config } = await import('../../../config');
    const tsHex = Date.now().toString(16);
    const hmacHex = crypto
      .createHmac('sha256', config.jwt.secret)
      .update(`reg123:${tsHex}`)
      .digest('hex')
      .slice(0, 16);
    const validToken = `${tsHex}.${hmacHex}`;

    vi.mocked(prisma.registrant.findUnique).mockResolvedValue({
      id: 'reg123',
      registrationNo: 'REG-001',
    } as any);

    const hugeUrlDataUri = 'data:image/png;base64,' + 'A'.repeat(3000000);

    await expect(
      service.createPublicRegistrantDocumentService({
        registrantId: 'reg123',
        type: 'PHOTO',
        url: hugeUrlDataUri,
        registrationToken: validToken,
      })
    ).rejects.toThrow('Ukuran berkas melebihi batas maksimum');

    await expect(
      service.createPublicRegistrantDocumentService({
        registrantId: 'reg123',
        type: 'PHOTO',
        url: 'data:text/plain;base64,SGVsbG8=',
        registrationToken: validToken,
      })
    ).rejects.toThrow('Tipe berkas tidak didukung');

    await expect(
      service.createPublicRegistrantDocumentService({
        registrantId: 'reg123',
        type: 'PHOTO',
        url: 'ftp://malicious.com/file.exe',
        registrationToken: validToken,
      })
    ).rejects.toThrow('URL dokumen tidak valid');

    // Rejecting private/loopback IP SSRF
    await expect(
      service.createPublicRegistrantDocumentService({
        registrantId: 'reg123',
        type: 'PHOTO',
        url: 'http://10.0.0.1/doc.png',
        registrationToken: validToken,
      })
    ).rejects.toThrow('URL dokumen tidak diizinkan');
  });

  it('should not reopen expired wave upon deleting registrant', async () => {
    const expiredWave = {
      id: 'w-expired',
      status: 'FULL',
      registeredCount: 50,
      quota: 50,
      startDate: new Date('2020-01-01'),
      endDate: new Date('2020-12-31'), // Expired
    };

    vi.mocked(prisma.registrant.findUnique).mockResolvedValue({
      id: 'r-1',
      status: 'REGISTERED',
      waveId: 'w-expired',
    } as any);
    vi.mocked(prisma.admissionWave.updateMany as any).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.admissionWave.findUnique as any).mockResolvedValue(expiredWave as any);
    vi.mocked(prisma.registrant.delete as any).mockResolvedValue({ id: 'r-1' });

    await service.deleteRegistrant('r-1');

    // Verify wave was NOT updated to OPEN because it is expired
    expect(prisma.admissionWave.update).not.toHaveBeenCalledWith({
      where: { id: 'w-expired' },
      data: { status: 'OPEN' },
    });
  });

  it('should NOT reopen a manually-closed FULL wave when a registrant is deleted (fullByCapacity=false)', async () => {
    // A FULL wave that an operator closed manually (fullByCapacity=false) is a
    // terminal state for the admission window. Removing one registrant must not
    // silently reopen it — otherwise the next public registrant could claim a
    // slot in a wave the admin deliberately shut early.
    const now = new Date();
    const manuallyClosedWave = {
      id: 'w-manual',
      status: 'FULL',
      fullByCapacity: false,
      registeredCount: 20,
      quota: 50,
      startDate: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
      endDate: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000), // still within the window
    };

    vi.mocked(prisma.registrant.findUnique).mockResolvedValue({
      id: 'r-1',
      status: 'REGISTERED',
      waveId: 'w-manual',
    } as any);
    vi.mocked(prisma.admissionWave.updateMany as any).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.admissionWave.findUnique as any).mockResolvedValue(manuallyClosedWave as any);
    vi.mocked(prisma.registrant.delete as any).mockResolvedValue({ id: 'r-1' });

    await service.deleteRegistrant('r-1');

    // The wave is within its window and has capacity, but because it was closed
    // manually (`fullByCapacity !== true`) it must stay FULL.
    expect(prisma.admissionWave.update).not.toHaveBeenCalledWith({
      where: { id: 'w-manual' },
      data: { status: 'OPEN' },
    });

    // This file's `beforeEach` only clears call history, not implementations,
    // so reset the shared mocks this test touched to avoid leaking capacity/wave
    // mocks into sibling tests that assume a bare `vi.fn()` default.
    vi.mocked(prisma.admissionWave.findUnique as any).mockReset();
    vi.mocked(prisma.admissionWave.updateMany as any).mockReset();
    vi.mocked(prisma.registrant.findUnique as any).mockReset();
    vi.mocked(prisma.registrant.delete as any).mockReset();
    vi.mocked(prisma.admissionPeriod.findUnique as any).mockReset();
  });

  it('reopens a FULL-by-capacity wave within its window when a registrant is deleted', async () => {
    const now = new Date();
    const capacityFullWave = {
      id: 'w-cap',
      status: 'FULL',
      fullByCapacity: true,
      registeredCount: 40,
      quota: 50,
      startDate: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
      endDate: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
    };

    vi.mocked(prisma.registrant.findUnique).mockResolvedValue({
      id: 'r-1',
      status: 'REGISTERED',
      waveId: 'w-cap',
    } as any);
    vi.mocked(prisma.admissionWave.updateMany as any).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.admissionWave.findUnique as any).mockResolvedValue(capacityFullWave as any);
    vi.mocked(prisma.registrant.delete as any).mockResolvedValue({ id: 'r-1' });

    await service.deleteRegistrant('r-1');

    // Auto-filled waves regain a slot on cancellation and re-open, inside the
    // same transaction as the counter decrement and the delete.
    expect(prisma.admissionWave.update).toHaveBeenCalledWith({
      where: { id: 'w-cap' },
      data: { status: 'OPEN' },
    });
    expect(txCalls.waveUpdate).toEqual([[{ where: { id: 'w-cap' }, data: { status: 'OPEN' } }]]);

    // Reset shared mocks to avoid leaking the capacity-full wave mock into
    // sibling tests (see the manually-closed test above).
    vi.mocked(prisma.admissionWave.findUnique as any).mockReset();
    vi.mocked(prisma.admissionWave.updateMany as any).mockReset();
    vi.mocked(prisma.registrant.findUnique as any).mockReset();
    vi.mocked(prisma.registrant.delete as any).mockReset();
    vi.mocked(prisma.admissionPeriod.findUnique as any).mockReset();
  });

  it('mengunci pendaftar sebelum gelombangnya saat penghapusan manual', async () => {
    vi.mocked(prisma.registrant.findUnique).mockResolvedValue({
      id: 'r-1',
      status: 'REGISTERED',
      waveId: 'w-1',
    } as any);
    vi.mocked(prisma.admissionWave.updateMany as any).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.admissionWave.findUnique as any).mockResolvedValue({
      id: 'w-1',
      status: 'OPEN',
      registeredCount: 1,
      quota: 10,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-12-31T00:00:00.000Z'),
      fullByCapacity: false,
    } as any);
    vi.mocked(prisma.registrant.delete as any).mockResolvedValue({ id: 'r-1' });

    await service.deleteRegistrant('r-1');

    // Retention, onboarding, and reassignment lock the registrant first. The
    // manual delete must do the same, or it can deadlock with any of them.
    // The lock, counter update, and delete must all run on the transaction
    // client: outside it, PostgreSQL releases the row lock before the wave
    // update and commits each write separately.
    expect(txCalls.executeRaw).toHaveLength(1);
    expect(txCalls.waveUpdateMany).toHaveLength(1);
    expect(txCalls.registrantDelete).toHaveLength(1);
    const registrantLock = vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0];
    const waveLock = vi.mocked(prisma.admissionWave.updateMany).mock.invocationCallOrder[0];
    expect(registrantLock).toBeLessThan(waveLock);
  });

  describe('deleteRegistrantForRetention', () => {
    function deletableRegistrant(over: Record<string, unknown> = {}) {
      return {
        status: 'REJECTED',
        waveId: null,
        studentId: null,
        registrationFeePaidAt: null,
        ...over,
      };
    }

    it('deletes a registrant that still satisfies every retention condition', async () => {
      vi.mocked(prisma.registrant.findUnique).mockResolvedValue(deletableRegistrant() as any);
      vi.mocked(prisma.dataSubjectRequest.findFirst).mockResolvedValue(null as any);
      vi.mocked(prisma.registrant.delete).mockResolvedValue({ id: 'r-1' } as any);

      await service.deleteRegistrantForRetention('r-1');

      // The row is locked before it is read, so onboarding (which takes the
      // same lock) cannot turn it into a santri between the check and delete.
      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(prisma.registrant.delete).toHaveBeenCalledWith({ where: { id: 'r-1' } });
    });

    it('mengunci pendaftar sebelum gelombangnya (urutan yang sama dengan assignRegistrant)', async () => {
      vi.mocked(prisma.registrant.findUnique).mockResolvedValue(
        deletableRegistrant({ waveId: 'w-1' }) as any
      );
      vi.mocked(prisma.dataSubjectRequest.findFirst).mockResolvedValue(null as any);
      vi.mocked(prisma.admissionWave.updateMany as any).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.admissionWave.findUnique as any).mockResolvedValue({
        id: 'w-1',
        status: 'OPEN',
        registeredCount: 1,
        quota: 10,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-12-31T00:00:00.000Z'),
        fullByCapacity: false,
      } as any);
      vi.mocked(prisma.registrant.delete).mockResolvedValue({ id: 'r-1' } as any);

      await service.deleteRegistrantForRetention('r-1');

      // The lock, counter update, and delete must all run inside the delete
      // transaction; a lock issued before `$transaction` is released before
      // the wave update runs.
      expect(txCalls.executeRaw).toHaveLength(1);
      expect(txCalls.waveUpdateMany).toHaveLength(1);
      expect(txCalls.registrantDelete).toHaveLength(1);
      const registrantLock = vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0];
      const waveLock = vi.mocked(prisma.admissionWave.updateMany).mock.invocationCallOrder[0];
      expect(registrantLock).toBeLessThan(waveLock);
    });

    it('refuses a registrant whose daftar-ulang payment landed after the sweep picked it', async () => {
      vi.mocked(prisma.registrant.findUnique).mockResolvedValue(
        deletableRegistrant({ registrationFeePaidAt: new Date('2026-05-01T00:00:00.000Z') }) as any
      );

      await expect(service.deleteRegistrantForRetention('r-1')).rejects.toThrow(
        /paid the registration fee/
      );
      expect(prisma.registrant.delete).not.toHaveBeenCalled();
    });

    it('refuses a registrant with an open data-subject request', async () => {
      vi.mocked(prisma.registrant.findUnique).mockResolvedValue(deletableRegistrant() as any);
      vi.mocked(prisma.dataSubjectRequest.findFirst).mockResolvedValue({ id: 'dsr-1' } as any);

      await expect(service.deleteRegistrantForRetention('r-1')).rejects.toThrow(
        /open data subject request/
      );
      // Only unfinished requests withhold; the query must ask for exactly them.
      expect(prisma.dataSubjectRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subjectRegistrantId: 'r-1',
            status: { in: ['RECEIVED', 'VERIFIED', 'PROCESSING'] },
          }),
        })
      );
      expect(prisma.registrant.delete).not.toHaveBeenCalled();
    });

    it('refuses a registrant that became a santri after the sweep picked it', async () => {
      vi.mocked(prisma.registrant.findUnique).mockResolvedValue(
        deletableRegistrant({ status: 'ENROLLED', studentId: 'std-1' }) as any
      );

      await expect(service.deleteRegistrantForRetention('r-1')).rejects.toThrow(
        /enrolled registrant/
      );
      expect(prisma.registrant.delete).not.toHaveBeenCalled();
    });
  });

  it('should reject registration when all waves for a period are full', async () => {
    const mockPeriod = {
      id: 'p1',
      academicYear: { name: '2024/2025' },
      unit: { name: 'SD IT' },
      unitId: 'u1',
      registrationFee: 100000,
    };

    vi.mocked(prisma.admissionPeriod.findUnique).mockResolvedValue(mockPeriod as any);
    vi.mocked(prisma.admissionWave.count as any).mockResolvedValue(2); // Period has 2 waves
    vi.mocked(prisma.admissionWave.findMany as any).mockResolvedValue([
      { id: 'w1', quota: 10, registeredCount: 10 },
      { id: 'w2', quota: 10, registeredCount: 10 },
    ]);

    await expect(
      service.createRegistrant(
        {
          admissionPeriodId: 'p1',
          fullName: 'Test Student',
          gender: 'MALE',
          birthPlace: 'Jakarta',
          birthDate: new Date().toISOString(),
          address: 'Test Address',
          fatherName: 'Father',
          motherName: 'Mother',
        } as any,
        false
      )
    ).rejects.toThrow('Semua gelombang pendaftaran pada periode ini telah penuh atau ditutup');
  });

  it('should generate registration number correctly and skip invoice creation at registration', async () => {
    const mockPeriod = {
      id: 'p1',
      academicYear: { name: '2024/2025' },
      unit: { name: 'SD IT' },
      unitId: 'u1',
      registrationFee: 100000,
    };

    vi.mocked(prisma.admissionPeriod.findUnique).mockResolvedValue(mockPeriod as any);
    vi.mocked(prisma.admissionPeriod.update as any).mockResolvedValue({ registrationSeq: 11 });
    (vi.mocked(prisma.registrant.create) as any).mockImplementation(({ data }: any) =>
      Promise.resolve({ ...data, id: 'r1' })
    );
    // REG_FEE payment type already exists, so no need to create one.
    vi.mocked(prisma.paymentType.findFirst).mockResolvedValue({ id: 'pt1' } as any);

    const result = await service.createRegistrant({
      admissionPeriodId: 'p1',
      fullName: 'Test Student',
      gender: 'MALE',
      birthPlace: 'Jakarta',
      birthDate: new Date().toISOString(),
      address: 'Test Address',
      fatherName: 'Father',
      motherName: 'Mother',
    } as any);

    // The registration number includes a 4-char period suffix derived from
    // the admissionPeriodId (with hyphens removed, uppercased, first 4 chars)
    // so two distinct periods in the same academic year cannot collide on the
    // globally-unique `registrationNo`. For id='p1' the suffix is 'P1'.
    expect(result.registrationNo).toBe('REG-2024-P1-00011');
    expect(result.fullName).toBe('Test Student');
    // The number comes from an atomic counter, not `count(*) + 1`: retention
    // deletes early rows while a later wave is still open, so a count would
    // reissue a number another registrant already holds.
    expect(prisma.admissionPeriod.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { registrationSeq: { increment: 1 } },
      select: { registrationSeq: true },
    });
    expect(prisma.registrant.count).not.toHaveBeenCalled();
    // Invoice creation is intentionally deferred to enrollment time, when a
    // real Student record exists. Creating it here would require a non-null
    // studentId that doesn't yet exist.
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  it('melewati nomor yang sudah terpakai saat pencacah tertinggal (mis. setelah db:push)', async () => {
    const mockPeriod = {
      id: 'p1',
      academicYear: { name: '2024/2025' },
      unit: { name: 'SD IT' },
      unitId: 'u1',
      registrationFee: 100000,
    };

    vi.mocked(prisma.admissionPeriod.findUnique).mockResolvedValue(mockPeriod as any);
    // The column still says 0 (or 1) while `00001` is already in the table.
    vi.mocked(prisma.admissionPeriod.update as any).mockResolvedValue({ registrationSeq: 1 });
    vi.mocked(prisma.registrant.findUnique as any)
      .mockResolvedValueOnce({ id: 'legacy-00001' })
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.$queryRaw as any).mockResolvedValue([{ registration_seq: 2 }]);
    (vi.mocked(prisma.registrant.create) as any).mockImplementation(({ data }: any) =>
      Promise.resolve({ ...data, id: 'r-new' })
    );
    vi.mocked(prisma.paymentType.findFirst).mockResolvedValue({ id: 'pt1' } as any);

    const result = await service.createRegistrant({
      admissionPeriodId: 'p1',
      fullName: 'Stale Counter',
      gender: 'MALE',
      birthPlace: 'Jakarta',
      birthDate: new Date().toISOString(),
      address: 'Test Address',
      fatherName: 'Father',
      motherName: 'Mother',
    } as any);

    // The used number is skipped; the insert is not attempted with it, so the
    // transaction never rolls the counter back to repeat the same value.
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(result.registrationNo).toBe('REG-2024-P1-00002');
  });

  it('should set wave status to FULL when increment causes registeredCount to reach quota even if initial read showed remaining slots', async () => {
    const mockPeriod = {
      id: 'p1',
      academicYear: { name: '2024/2025' },
      unit: { name: 'SD IT' },
      unitId: 'u1',
      registrationFee: 100000,
    };

    vi.mocked(prisma.admissionPeriod.findUnique).mockResolvedValue(mockPeriod as any);
    vi.mocked(prisma.admissionWave.count as any).mockResolvedValue(1);
    // Initial read showed 8 out of 10 registered (so initial calculation might have assumed OPEN)
    vi.mocked(prisma.admissionWave.findMany as any).mockResolvedValue([
      { id: 'w1', quota: 10, registeredCount: 8, status: 'OPEN' },
    ]);
    vi.mocked(prisma.admissionWave.updateMany as any).mockResolvedValue({ count: 1 });
    // Re-reading updated wave shows concurrent increment pushed registeredCount to 10 (FULL)
    vi.mocked(prisma.admissionWave.findUnique as any)
      .mockResolvedValueOnce({ id: 'w1', quota: 10, registeredCount: 8, status: 'OPEN' })
      .mockResolvedValueOnce({ id: 'w1', quota: 10, registeredCount: 10, status: 'OPEN' });
    vi.mocked(prisma.registrant.count).mockResolvedValue(0);
    (vi.mocked(prisma.registrant.create) as any).mockImplementation(({ data }: any) =>
      Promise.resolve({ ...data, id: 'r1' })
    );

    await service.createRegistrant(
      {
        admissionPeriodId: 'p1',
        fullName: 'Concurrent Student',
        gender: 'MALE',
        birthPlace: 'Jakarta',
        birthDate: new Date().toISOString(),
        address: 'Test Address',
        fatherName: 'Father',
      } as any,
      false
    );

    // Verify wave status was updated to FULL and flagged as auto-filled by
    // capacity (so a later `deleteRegistrant` may reopen it).
    expect(prisma.admissionWave.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { status: 'FULL', fullByCapacity: true },
    });
  });

  it('should apply unit scoping in getRegistrants for UNIT_ADMIN or STAFF and bypass for SUPER_ADMIN', async () => {
    vi.mocked(prisma.registrant.findMany as any).mockResolvedValue([]);
    vi.mocked(prisma.registrant.count).mockResolvedValue(0);

    // UNIT_ADMIN caller with unitId 'unit-sd'
    await service.getRegistrants(
      { page: 1, limit: 10 },
      { id: 'usr-admin', role: 'UNIT_ADMIN', unitId: 'unit-sd' }
    );

    expect(prisma.registrant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          admissionPeriod: { unitId: 'unit-sd' },
        }),
      })
    );

    // SUPER_ADMIN caller
    await service.getRegistrants(
      { page: 1, limit: 10 },
      { id: 'usr-super', role: 'SUPER_ADMIN', unitId: null }
    );

    expect(prisma.registrant.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {},
      })
    );
  });

  it('should leave wave status unchanged when registeredCount remains below quota after increment', async () => {
    const mockPeriod = {
      id: 'p1',
      academicYear: { name: '2024/2025' },
      unit: { name: 'SD IT' },
      unitId: 'u1',
      registrationFee: 100000,
    };

    vi.mocked(prisma.admissionPeriod.findUnique).mockResolvedValue(mockPeriod as any);
    vi.mocked(prisma.admissionWave.count as any).mockResolvedValue(1);
    vi.mocked(prisma.admissionWave.findMany as any).mockResolvedValue([
      { id: 'w1', quota: 10, registeredCount: 5, status: 'OPEN' },
    ]);
    vi.mocked(prisma.admissionWave.updateMany as any).mockResolvedValue({ count: 1 });
    // Re-read shows 6/10 registered (still under quota)
    vi.mocked(prisma.admissionWave.findUnique as any).mockResolvedValue({
      id: 'w1',
      quota: 10,
      registeredCount: 6,
      status: 'OPEN',
    });
    vi.mocked(prisma.registrant.count).mockResolvedValue(0);
    (vi.mocked(prisma.registrant.create) as any).mockImplementation(({ data }: any) =>
      Promise.resolve({ ...data, id: 'r2' })
    );

    await service.createRegistrant(
      {
        admissionPeriodId: 'p1',
        fullName: 'Student 2',
        gender: 'MALE',
        birthPlace: 'Jakarta',
        birthDate: new Date().toISOString(),
        address: 'Test Address',
        fatherName: 'Father',
      } as any,
      false
    );

    // Verify wave status was NOT updated to FULL
    expect(prisma.admissionWave.update).not.toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { status: 'FULL' },
    });
  });

  it('should persist OCR notes and status summary on public document upload', async () => {
    const crypto = await import('crypto');
    const { config } = await import('../../../config');
    const registrantId = '11111111-1111-4111-8111-111111111111';
    const tsHex = Date.now().toString(16);
    const hmacHex = crypto
      .createHmac('sha256', config.jwt.secret)
      .update(`${registrantId}:${tsHex}`)
      .digest('hex')
      .slice(0, 16);
    const validToken = `${tsHex}.${hmacHex}`;

    vi.mocked(prisma.registrant.findUnique).mockResolvedValue({
      id: registrantId,
      registrationNo: 'REG-001',
    } as any);
    vi.mocked(prisma.registrantDocument.count as any).mockResolvedValue(0);
    vi.mocked(prisma.registrantDocument.create as any).mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'doc-1', ...data })
    );

    const dataUri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const expectedSha = crypto
      .createHash('sha256')
      .update(Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64'))
      .digest('hex');

    await service.createPublicRegistrantDocumentService({
      registrantId,
      type: 'KK',
      url: dataUri,
      registrationToken: validToken,
      ocrNotes: ['NIK tidak cocok', 'Kertas tampak rusak'],
      ocrStatus: 'MISMATCH',
    });

    // The note must carry the verification status so reviewers see the mismatch,
    // and the fingerprint of the bytes actually stored.
    expect(prisma.registrantDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          notes: `[Hasil Verifikasi: MISMATCH] NIK tidak cocok | Kertas tampak rusak [SHA-256: ${expectedSha}]`,
        }),
      })
    );
  });

  it('stores no hash for a URL-based upload', async () => {
    const crypto = await import('crypto');
    const { config } = await import('../../../config');
    const registrantId = '11111111-1111-4111-8111-111111111111';
    const tsHex = Date.now().toString(16);
    const hmacHex = crypto
      .createHmac('sha256', config.jwt.secret)
      .update(`${registrantId}:${tsHex}`)
      .digest('hex')
      .slice(0, 16);
    const validToken = `${tsHex}.${hmacHex}`;

    vi.mocked(prisma.registrant.findUnique).mockResolvedValue({
      id: registrantId,
      registrationNo: 'REG-001',
    } as any);
    vi.mocked(prisma.registrantDocument.count as any).mockResolvedValue(0);
    vi.mocked(prisma.registrantDocument.create as any).mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'doc-1', ...data })
    );

    await service.createPublicRegistrantDocumentService({
      registrantId,
      type: 'KK',
      url: 'https://example.com/kk.png',
      registrationToken: validToken,
      ocrNotes: ['Dokumen akan diperiksa manual'],
      ocrStatus: 'WARNING',
    });

    // The row stores a URL, not bytes, so there is nothing to fingerprint.
    expect(prisma.registrantDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          notes: '[Hasil Verifikasi: WARNING] Dokumen akan diperiksa manual',
        }),
      })
    );
  });

  it('should refuse a cross-unit UNIT_ADMIN from reading a registrant (403)', async () => {
    vi.mocked(prisma.registrant.findUnique).mockResolvedValue({
      id: 'reg-1',
      admissionPeriod: { unitId: 'unit-1' },
    } as any);

    const crossUnitAdmin = {
      id: 'admin-2',
      role: 'UNIT_ADMIN',
      roleCode: 'SDIT_ADMIN',
      unitId: 'unit-2',
    };

    await expect(service.getRegistrantById('reg-1', crossUnitAdmin)).rejects.toThrow(
      'Access to this unit is not allowed'
    );
  });

  it('should refuse a cross-unit UNIT_ADMIN from updating a registrant status (403)', async () => {
    vi.mocked(prisma.registrant.findUnique).mockResolvedValue({
      id: 'reg-1',
      admissionPeriod: { unitId: 'unit-1' },
    } as any);

    const crossUnitAdmin = {
      id: 'admin-2',
      role: 'UNIT_ADMIN',
      roleCode: 'SDIT_ADMIN',
      unitId: 'unit-2',
    };

    await expect(
      service.updateRegistrantStatus('reg-1', { status: 'REJECTED' }, crossUnitAdmin)
    ).rejects.toThrow('Access to this unit is not allowed');
  });

  it('should refuse non-SUPER_ADMIN with a missing unitId from listing registrants (403, never unscoped)', async () => {
    const unitlessActor = {
      id: 'usr-nounit',
      role: 'UNIT_ADMIN',
      roleCode: 'SDIT_ADMIN',
      unitId: null,
    };

    await expect(
      service.getRegistrants({ page: 1, limit: 10 }, unitlessActor as any)
    ).rejects.toThrow('Access to this unit is not allowed');

    // The unscoped query must never run — otherwise the actor would see EVERY
    // unit's registrants.
    expect(prisma.registrant.findMany).not.toHaveBeenCalled();
    expect(prisma.registrant.count).not.toHaveBeenCalled();
  });

  it('should refuse a cross-unit UNIT_ADMIN from creating an admission period (403)', async () => {
    const crossUnitAdmin = {
      id: 'admin-2',
      role: 'UNIT_ADMIN',
      roleCode: 'SDIT_ADMIN',
      unitId: 'unit-2',
    };

    await expect(
      service.createAdmissionPeriod(
        {
          name: 'SPMB 2026',
          unitId: 'unit-1',
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(),
          registrationFee: 0,
          academicYearId: 'ay-2026',
          isActive: true,
        } as any,
        crossUnitAdmin
      )
    ).rejects.toThrow('Access to this unit is not allowed');

    expect(prisma.admissionPeriod.create).not.toHaveBeenCalled();
  });

  it('should refuse a cross-unit UNIT_ADMIN from creating a registrant in another unit period (403)', async () => {
    const crossUnitAdmin = {
      id: 'admin-2',
      role: 'UNIT_ADMIN',
      roleCode: 'SDIT_ADMIN',
      unitId: 'unit-2',
    };
    vi.mocked(prisma.admissionPeriod.findUnique).mockResolvedValue({
      id: 'p-1',
      unitId: 'unit-1',
    } as any);

    await expect(
      service.createRegistrant(
        {
          admissionPeriodId: 'p-1',
          fullName: 'Anak Lintas Unit',
          gender: 'MALE',
          birthPlace: 'Jakarta',
          birthDate: new Date().toISOString(),
          address: 'Alamat',
          fatherName: 'Ayah',
        } as any,
        true,
        crossUnitAdmin
      )
    ).rejects.toThrow('Access to this unit is not allowed');
  });

  describe('public registrant consent (UU PDP 27/2022 Pasal 20, 25)', () => {
    const openPeriod = {
      id: 'p1',
      unitId: 'u1',
      registrationFee: 0,
      academicYear: { name: '2026/2027' },
      unit: { name: 'SD IT' },
      isActive: true,
      startDate: new Date(Date.now() - 86_400_000),
      endDate: new Date(Date.now() + 86_400_000),
    };

    const publicData = {
      admissionPeriodId: 'p1',
      fullName: 'Anak Publik',
      gender: 'MALE',
      birthPlace: 'Bandung',
      birthDate: new Date('2012-01-01').toISOString(),
      address: 'Jl. Contoh No. 1',
      fatherName: 'Ayah',
      motherName: 'Ibu',
    } as any;

    it('records the consent time, version and IP on the public path', async () => {
      vi.mocked(prisma.admissionPeriod.findUnique).mockResolvedValue(openPeriod as any);
      // The version the registrant read must exist.
      vi.mocked(prisma.privacyPolicyVersion.findUnique).mockResolvedValue({
        version: 2,
      } as any);
      vi.mocked(prisma.registrant.count).mockResolvedValue(0);
      (vi.mocked(prisma.registrant.create) as any).mockImplementation(({ data }: any) =>
        Promise.resolve({ ...data, id: 'r1' })
      );
      vi.mocked(prisma.paymentType.findFirst).mockResolvedValue({ id: 'pt1' } as any);

      await service.createPublicRegistrantService(publicData, {
        version: 2,
        ip: '203.0.113.7',
      });

      expect(prisma.registrant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            consentAt: expect.any(Date),
            consentVersion: '2',
            consentIp: '203.0.113.7',
          }),
        })
      );
    });

    it('refuses a consent naming a version that was never published', async () => {
      vi.mocked(prisma.admissionPeriod.findUnique).mockResolvedValue(openPeriod as any);
      vi.mocked(prisma.privacyPolicyVersion.findUnique).mockResolvedValue(null as any);

      await expect(
        service.createPublicRegistrantService(publicData, { version: 99 })
      ).rejects.toThrow(/Versi kebijakan privasi tidak dikenal/);

      // The row must not be written when the consent is invalid.
      expect(prisma.registrant.create).not.toHaveBeenCalled();
    });

    it('does not record a consent on the admin-created path', async () => {
      vi.mocked(prisma.admissionPeriod.findUnique).mockResolvedValue(openPeriod as any);
      vi.mocked(prisma.registrant.count).mockResolvedValue(0);
      (vi.mocked(prisma.registrant.create) as any).mockImplementation(({ data }: any) =>
        Promise.resolve({ ...data, id: 'r2' })
      );
      vi.mocked(prisma.paymentType.findFirst).mockResolvedValue({ id: 'pt1' } as any);

      await service.createRegistrant(publicData, true, {
        id: 'admin-1',
        role: 'UNIT_ADMIN',
        roleCode: 'SDIT_ADMIN',
        unitId: 'u1',
      });

      const call = vi.mocked(prisma.registrant.create).mock.calls[0][0] as any;
      expect(call.data.consentAt).toBeUndefined();
      expect(call.data.consentVersion).toBeUndefined();
      expect(call.data.consentIp).toBeUndefined();
    });
  });
});
