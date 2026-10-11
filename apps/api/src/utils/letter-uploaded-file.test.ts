import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  uploadFilenameFromUrl,
  uploadPathFromUrl,
  readUploadedPdfBytes,
} from './letter-uploaded-file';

vi.mock('fs/promises', () => ({
  default: { readFile: vi.fn() },
}));

const ROOT = path.join(process.cwd(), 'public', 'uploads');

beforeEach(() => vi.clearAllMocks());

describe('nama berkas dari URL unggahan', () => {
  it('mengambil nama berkas dari pathname, bukan dari host', () => {
    expect(uploadFilenameFromUrl('https://portal.cipansor.or.id/uploads/abc-123.pdf')).toBe(
      'abc-123.pdf'
    );
  });

  /**
   * Host berbeda antar lingkungan (localhost, staging, produksi). Kalau yang
   * dipakai adalah URL utuhnya, berkas yang sama tidak lagi ditemukan hanya
   * karena host-nya berubah.
   */
  it('mengabaikan host dan kueri', () => {
    expect(uploadFilenameFromUrl('http://localhost:4000/uploads/abc-123.pdf?v=2')).toBe(
      'abc-123.pdf'
    );
  });

  it('menolak URL tanpa bagian /uploads/', () => {
    expect(uploadFilenameFromUrl('https://example.com/other/abc.pdf')).toBeNull();
  });

  /**
   * Perjalanan direktori adalah serangan, bukan kesalahan ketik. Nama unggahan
   * selalu dihasilkan server (UUID + ekstensi), jadi apa pun dengan pemisah
   * jalur atau `..` bukan berkas yang pernah ditulis sistem.
   */
  it('menolak perjalanan direktori', () => {
    expect(uploadFilenameFromUrl('https://x.test/uploads/..%2F..%2Fetc%2Fpasswd')).toBeNull();
    expect(uploadFilenameFromUrl('https://x.test/uploads/../../etc/passwd')).toBeNull();
    expect(uploadFilenameFromUrl('https://x.test/uploads/foo/bar.pdf')).toBeNull();
  });

  it('menolak fileUrl yang bukan URL', () => {
    expect(uploadFilenameFromUrl('not a url')).toBeNull();
    expect(uploadFilenameFromUrl(null)).toBeNull();
    expect(uploadFilenameFromUrl(undefined)).toBeNull();
  });
});

describe('alamat absolut berkas unggahan', () => {
  it('berada di dalam akar unggahan', () => {
    expect(uploadPathFromUrl('https://x.test/uploads/abc.pdf')).toBe(path.join(ROOT, 'abc.pdf'));
  });

  it('null bila nama berkasnya tidak sah', () => {
    expect(uploadPathFromUrl('https://x.test/uploads/../../etc/passwd')).toBeNull();
  });
});

describe('membaca byte PDF unggahan', () => {
  it('mengembalikan byte berkas yang sah', async () => {
    const pdf = Buffer.from('%PDF-1.7\n%%EOF');
    vi.mocked(fs.readFile).mockResolvedValue(pdf as any);

    const out = await readUploadedPdfBytes('https://x.test/uploads/abc.pdf');

    expect(out.equals(pdf)).toBe(true);
  });

  /**
   * Yang ditandatangani adalah naskahnya. Menandatangani apa pun yang bukan
   * PDF — atau byte kosong karena berkasnya hilang — akan menghasilkan surat
   * yang tidak dapat diverifikasi siapa pun.
   */
  it('menolak berkas yang bukan PDF', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('GIF89a') as any);
    await expect(readUploadedPdfBytes('https://x.test/uploads/abc.pdf')).rejects.toThrow(
      /bukan PDF/i
    );
  });

  it('menolak berkas yang sudah tidak ada', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
    await expect(readUploadedPdfBytes('https://x.test/uploads/abc.pdf')).rejects.toThrow(
      /tidak ada di penyimpanan/i
    );
  });

  it('menolak fileUrl yang tidak menunjuk ke unggahan', async () => {
    await expect(readUploadedPdfBytes('https://x.test/other/abc.pdf')).rejects.toThrow(
      /tidak dapat ditemukan/i
    );
  });
});
