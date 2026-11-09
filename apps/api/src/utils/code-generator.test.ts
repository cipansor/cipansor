import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

const { mockPrisma } = vi.hoisted(() => {
  return {
    mockPrisma: {
      purchaseRequest: {
        findFirst: vi.fn(),
      },
      asset: {
        findFirst: vi.fn(),
      },
    },
  };
});

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}));

import { generateUniqueCode, generateBulkUniqueCodes } from '@/utils/code-generator';

describe('code-generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-10-15'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateUniqueCode', () => {
    it('should generate correct code for assets when no previous record exists', async () => {
      mockPrisma.asset.findFirst.mockResolvedValue(null);

      const code = await generateUniqueCode('AST', 'assets');

      expect(code).toBe('AST-202410-0001');
      expect(mockPrisma.asset.findFirst).toHaveBeenCalledWith({
        where: { code: { startsWith: 'AST-202410-' } },
        orderBy: { code: 'desc' },
        select: { code: true },
      });
    });

    it('should generate correct code for assets when previous record exists', async () => {
      mockPrisma.asset.findFirst.mockResolvedValue({ code: 'AST-202410-0042' });

      const code = await generateUniqueCode('AST', 'assets');

      expect(code).toBe('AST-202410-0043');
    });
  });

  describe('generateBulkUniqueCodes', () => {
    it('should generate multiple codes sequentially', async () => {
      mockPrisma.asset.findFirst.mockResolvedValue({ code: 'AST-202410-0010' });

      const codes = await generateBulkUniqueCodes('AST', 'assets', 3);

      expect(codes).toHaveLength(3);
      expect(codes).toEqual(['AST-202410-0011', 'AST-202410-0012', 'AST-202410-0013']);
      expect(mockPrisma.asset.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should return empty array if count is 0 or less', async () => {
      const codes = await generateBulkUniqueCodes('AST', 'assets', 0);
      expect(codes).toEqual([]);
      expect(mockPrisma.asset.findFirst).not.toHaveBeenCalled();
    });

    it('should use provided transaction client', async () => {
      const mockTx = {
        asset: {
          findFirst: vi.fn().mockResolvedValue({ code: 'AST-202410-0050' }),
        },
        purchaseRequest: {
          findFirst: vi.fn(),
        },
      };

      const codes = await generateBulkUniqueCodes('AST', 'assets', 2, mockTx as any);

      expect(codes).toEqual(['AST-202410-0051', 'AST-202410-0052']);
      expect(mockTx.asset.findFirst).toHaveBeenCalledTimes(1);
      expect(mockPrisma.asset.findFirst).not.toHaveBeenCalled();
    });
  });
});

/**
 * Kode PR/AST dicetak ke dokumen resmi dan label aset fisik, jadi bulan dan
 * tahunnya harus mengikuti kalender WIB (Asia/Jakarta), bukan jam host.
 * Kontainer API tidak menetapkan `TZ`, jadi `getMonth()`/`getFullYear()`
 * membaca UTC dan kode yang dibuat pukul 00:00–06:59 WIB memakai bulan —
 * bahkan tahun — kemarin (issue #881).
 *
 * Berkas ini mengunci instan-instannya seperti dilaporkan di issue.
 */
describe('code-generator — kalender WIB', () => {
  const previousTz = process.env.TZ;

  beforeAll(() => {
    // Produksi menjalankan kontainer tanpa TZ, yaitu UTC. Paksa itu di sini
    // supaya tes gagal andai kode kembali membaca zona host.
    process.env.TZ = 'UTC';
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterAll(() => {
    vi.useRealTimers();
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const cases: Array<{ instant: string; wib: string; expected: string }> = [
    // 1 Nov 2026 00:30 WIB — server UTC masih 31 Okt.
    { instant: '2026-10-31T17:30:00Z', wib: '1 Nov 2026 00:30 WIB', expected: '202611' },
    // Sisi lain batas: 31 Okt 2026 23:59:59 WIB masih Oktober.
    { instant: '2026-10-31T16:59:59Z', wib: '31 Okt 2026 23:59 WIB', expected: '202610' },
    // 1 Jan 2027 00:30 WIB — server UTC masih 31 Des 2026 (tahun juga salah).
    { instant: '2026-12-31T17:30:00Z', wib: '1 Jan 2027 00:30 WIB', expected: '202701' },
    // 1 Agu 2026 00:30 WIB — server UTC masih 31 Jul 2026.
    { instant: '2026-07-31T17:30:00Z', wib: '1 Agu 2026 00:30 WIB', expected: '202608' },
  ];

  it.each(cases)(
    '$instant ($wib) memakai bulan $expected untuk PR dan AST',
    async ({ instant, expected }) => {
      vi.setSystemTime(new Date(instant));
      mockPrisma.purchaseRequest.findFirst.mockResolvedValue(null);
      mockPrisma.asset.findFirst.mockResolvedValue(null);

      await expect(generateUniqueCode('PR', 'purchase_requests')).resolves.toBe(
        `PR-${expected}-0001`
      );
      await expect(generateUniqueCode('AST', 'assets')).resolves.toBe(`AST-${expected}-0001`);

      expect(mockPrisma.purchaseRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { code: { startsWith: `PR-${expected}-` } } })
      );
      expect(mockPrisma.asset.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { code: { startsWith: `AST-${expected}-` } } })
      );
    }
  );

  it('permintaan 1 Nov 00:30 WIB membuka urutan November, bukan melanjutkan Oktober', async () => {
    vi.setSystemTime(new Date('2026-10-31T17:30:00Z'));
    // Satu kode Oktober sudah ada; query yang benar menyaring prefix November,
    // jadi baris ini tidak boleh ikut terhitung.
    mockPrisma.purchaseRequest.findFirst.mockResolvedValue(null);
    mockPrisma.asset.findFirst.mockResolvedValue(null);

    await expect(generateUniqueCode('PR', 'purchase_requests')).resolves.toBe('PR-202611-0001');
    await expect(generateUniqueCode('AST', 'assets')).resolves.toBe('AST-202611-0001');
    expect(mockPrisma.purchaseRequest.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: { startsWith: 'PR-202610-' } } })
    );
  });

  it('jam server WIB dan UTC memberi kode yang sama pada instan yang sama', async () => {
    const instant = '2026-12-31T17:30:00Z';
    mockPrisma.asset.findFirst.mockResolvedValue(null);

    vi.setSystemTime(new Date(instant));
    process.env.TZ = 'Asia/Jakarta';
    const onWibServer = await generateUniqueCode('AST', 'assets');
    process.env.TZ = 'UTC';
    const onUtcServer = await generateUniqueCode('AST', 'assets');

    expect(onUtcServer).toBe(onWibServer);
    expect(onUtcServer).toBe('AST-202701-0001');
  });
});
