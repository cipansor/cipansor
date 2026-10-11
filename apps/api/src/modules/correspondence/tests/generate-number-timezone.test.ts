import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { CorrespondenceService } from '../correspondence.service';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agendaNumber: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const AGENDA = {
  id: 'agenda-1',
  unitId: 'unit-1',
  academicYearId: 'year-1',
  type: 'SKET',
  lastNumber: 10,
  format: '[NO]/[TYPE]/Y-CPS/[ROMAN]/[YEAR]',
};

/**
 * Nomor agenda/surat dicetak ke berkas resmi, jadi bulan dan tahun harus
 * mengikuti kalender WIB (Asia/Jakarta), bukan jam host. Kontainer API tidak
 * menetapkan `TZ`, jadi `getMonth()`/`getFullYear()` membaca UTC dan nomor
 * yang dibuat pukul 00:00–07:00 WIB memakai bulan — bahkan tahun — kemarin.
 *
 * Berkas ini mengunci instan-instannya seperti dilaporkan di issue #743.
 */
describe('CorrespondenceService.generateNumber — kalender WIB', () => {
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
    vi.mocked(prisma.agendaNumber.findUnique).mockResolvedValue(AGENDA as any);
    vi.mocked(prisma.agendaNumber.update).mockResolvedValue({ lastNumber: 11 } as any);
  });

  const cases: Array<{ instant: string; wib: string; expected: string }> = [
    // 1 Nov 2026 00:30 WIB — server UTC masih 31 Okt.
    {
      instant: '2026-10-31T17:30:00Z',
      wib: '1 Nov 2026 00:30 WIB',
      expected: '011/SKET/Y-CPS/XI/2026',
    },
    // Sisi lain batas: 31 Okt 2026 23:59:59 WIB masih Oktober.
    {
      instant: '2026-10-31T16:59:59Z',
      wib: '31 Okt 2026 23:59 WIB',
      expected: '011/SKET/Y-CPS/X/2026',
    },
    // 1 Jan 2027 00:30 WIB — server UTC masih 31 Des 2026 (tahun juga salah).
    {
      instant: '2026-12-31T17:30:00Z',
      wib: '1 Jan 2027 00:30 WIB',
      expected: '011/SKET/Y-CPS/I/2027',
    },
    // 1 Feb 2027 00:30 WIB — server UTC masih 31 Jan 2027.
    {
      instant: '2027-01-31T17:30:00Z',
      wib: '1 Feb 2027 00:30 WIB',
      expected: '011/SKET/Y-CPS/II/2027',
    },
  ];

  it.each(cases)('$instant ($wib) menghasilkan $expected', async ({ instant, expected }) => {
    vi.setSystemTime(new Date(instant));
    const result = await CorrespondenceService.generateNumber('unit-1', 'SKET', 'year-1');
    expect(result).toBe(expected);
  });

  it('jam server WIB dan UTC memberi nomor yang sama pada instan yang sama', async () => {
    const instant = '2026-12-31T17:30:00Z';
    vi.setSystemTime(new Date(instant));
    process.env.TZ = 'Asia/Jakarta';
    const onWibServer = await CorrespondenceService.generateNumber('unit-1', 'SKET', 'year-1');
    process.env.TZ = 'UTC';
    const onUtcServer = await CorrespondenceService.generateNumber('unit-1', 'SKET', 'year-1');
    expect(onUtcServer).toBe(onWibServer);
    expect(onUtcServer).toBe('011/SKET/Y-CPS/I/2027');
  });
});
