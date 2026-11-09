import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A sanad's certificate number carries the month it was issued in
 * (`SANAD-YYYYMM-…`), and the number is printed on the paper and checked on the
 * public verify page. The API container runs in UTC, so `getMonth()` stamped
 * the previous month — and on 1 January the previous year — on a sanad issued
 * between 00:00 and 06:59 WIB on the 1st (#883). The month is the WIB one.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sanadRecord: { findUnique: vi.fn() },
    digitalCertificate: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { generateCertificate } from '../sanad-certificate.service';

const db = prisma as unknown as {
  sanadRecord: { findUnique: ReturnType<typeof vi.fn> };
  digitalCertificate: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

const SANAD = {
  id: 'sanad-1',
  juz: 30,
  grade: 'JAYYID',
  certifiedAt: new Date('2026-10-30T00:00:00.000Z'),
  enrollment: {
    student: {
      id: 'student-1',
      nis: '2026001',
      user: { name: 'Aisyah' },
      unit: null,
    },
    halaqoh: null,
  },
  teacher: { id: 'teacher-1', name: 'Ust. Ahmad', email: 't@example.org' },
};

const prevTz = process.env.TZ;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TZ = 'UTC';
  vi.useFakeTimers({ toFake: ['Date'] });
  db.sanadRecord.findUnique.mockResolvedValue(SANAD);
  // No certificate yet, so a number is minted.
  db.digitalCertificate.findFirst.mockResolvedValue(null);
  db.digitalCertificate.create.mockImplementation(async ({ data }) => ({ ...data }));
});

afterEach(() => {
  vi.useRealTimers();
  if (prevTz === undefined) delete process.env.TZ;
  else process.env.TZ = prevTz;
});

const minted = async () => {
  await generateCertificate({ sanadId: 'sanad-1' } as never, { userId: 'u-admin' });
  return db.digitalCertificate.create.mock.calls[0][0].data.certificateNumber as string;
};

describe('sanad certificate number follows the WIB month', () => {
  it('stamps November on a sanad issued at 00:30 WIB on 1 November', async () => {
    vi.setSystemTime(new Date('2026-10-31T17:30:00.000Z')); // 1 Nov 2026 00:30 WIB
    expect(await minted()).toMatch(/^SANAD-202611-[0-9A-F]{8}$/);
  });

  it('stamps January of the new year at 00:30 WIB on 1 January', async () => {
    vi.setSystemTime(new Date('2026-12-31T17:30:00.000Z')); // 1 Jan 2027 00:30 WIB
    expect(await minted()).toMatch(/^SANAD-202701-/);
  });

  it('keeps the month until 23:59 WIB on its last day', async () => {
    vi.setSystemTime(new Date('2026-10-31T16:59:00.000Z')); // 31 Oct 2026 23:59 WIB
    expect(await minted()).toMatch(/^SANAD-202610-/);
  });
});
