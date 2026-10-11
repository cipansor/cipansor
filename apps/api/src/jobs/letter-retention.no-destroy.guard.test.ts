import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Penjaga **batas keras**: peninjauan retensi tidak boleh memusnahkan arsip.
 *
 * Jadwal Retensi Arsip adalah instrumen yang disahkan; memusnahkan arsip
 * menuntut penilaian dan berita acara (UU 43/2009 Pasal 51–52 dan PP 28/2012). Yang
 * boleh dilakukan sistem adalah **mendaftar** naskah yang retensinya habis dan
 * mencatat bahwa ia meninjau. Menghapus naskah — yang justru merupakan bukti
 * dari apa yang pernah diterbitkan — bukanlah keputusan sebuah pekerjaan
 * terjadwal.
 *
 * Uji ini bukan uji perilaku melainkan penjaga sumber: ia membaca berkas
 * pekerjaannya dan menolak setiap operasi yang menghapus atau memusnahkan.
 * Alasannya sederhana — bahayanya muncul sebagai satu baris `deleteMany` yang
 * tampak wajar saat ditambahkan, dan tidak ada uji perilaku yang gagal ketika
 * baris itu masuk. Yang gagal adalah arsip, bertahun kemudian.
 */

const JOBS_DIR = __dirname;
const RETENTION_JOB = readFileSync(join(JOBS_DIR, 'letter-retention.job.ts'), 'utf8');
const RETENTION_CLI = readFileSync(
  resolve(JOBS_DIR, '..', '..', 'prisma', 'scripts', 'review-letter-retention.ts'),
  'utf8'
);

/** Operasi Prisma yang menghapus baris, dalam bentuk apa pun. */
const DESTRUCTIVE = /\.(delete|deleteMany|drop|truncate)\s*\(/;

/**
 * Menghapus `Letter`/`LetterSignature` lewat klien Prisma **apa pun namanya**.
 *
 * `prisma.letter.deleteMany(` hanyalah satu penyambung. Penghapusan yang sama
 * dapat ditulis dari klien transaksi (`tx.letter.delete(`), dari klien di dalam
 * `$transaction`, atau dari variabel yang diberi nama lain — dan pola lama yang
 * hanya mengenali `prisma.` melewatkan semuanya. Yang dicari adalah pasangan
 * `<apa pun>.letter`/`.letterSignature` dengan `.delete`/`.deleteMany`, bukan
 * nama penerimanya.
 */
const PRISMA_LETTER_DELETE = /\b[\w$]+\.letter(?:Signature)?\.(?:delete|deleteMany)\s*\(/;

/** SQL mentah yang menghapus tabel arsip, lewat `$executeRaw`/`$queryRaw` apa pun. */
const RAW_LETTER_DELETE =
  /\$(?:executeRaw|executeRawUnsafe|queryRaw|queryRawUnsafe)[\s\S]{0,200}?\bDELETE\s+FROM\s+["`]?(?:letters|letter_signatures|letter_signed_documents)\b/i;

/**
 * SQL mentah yang menghapus. Ditulis terpisah karena `$executeRaw` sendiri
 * tidak menghapus apa pun — yang berbahaya adalah `DELETE`/`DROP`/`TRUNCATE`
 * di dalamnya, dan itu tidak tertangkap pola di atas.
 */
const RAW_DESTRUCTIVE =
  /\$(?:executeRaw|executeRawUnsafe|queryRaw|queryRawUnsafe)\b[\s\S]{0,200}?\b(?:DELETE\s+FROM|DROP\s+TABLE|TRUNCATE)\b/i;

/**
 * Menulis status yang berarti "dimusnahkan".
 *
 * `DISPOSED` adalah status surat yang sah — disposisi surat masuk menetapkannya
 * — dan justru karena itu pekerjaan retensi **tidak** boleh menulisnya: yang
 * boleh dilakukannya hanyalah membacanya sebagai salah satu status arsip.
 * `destroyed` tidak ada di sistem, tetapi menuliskannya ke sebuah model berarti
 * menandai arsip sebagai musnah. Pola ini menuntut bentuk penulisan (`status:`
 * atau sebuah bidang `destroyed:`), bukan sekadar kemunculan katanya, supaya
 * penyaring baca `['SIGNED', …, 'DISPOSED']` tidak ikut tertangkap.
 */
const DESTRUCTIVE_STATUS_WRITE =
  /\bstatus\s*:\s*(?:LetterStatus\.)?['"]?(?:DISPOSED|DESTROYED)['"]?|\bdestroyed\s*:/i;

describe('peninjauan retensi tidak memusnahkan (batas keras)', () => {
  it('pekerjaan retensi tidak memanggil operasi penghapusan', () => {
    expect(RETENTION_JOB).not.toMatch(DESTRUCTIVE);
    expect(RETENTION_JOB).not.toMatch(RAW_DESTRUCTIVE);
    expect(RETENTION_JOB).not.toMatch(PRISMA_LETTER_DELETE);
    expect(RETENTION_JOB).not.toMatch(RAW_LETTER_DELETE);
  });

  it('CLI retensi tidak memanggil operasi penghapusan', () => {
    expect(RETENTION_CLI).not.toMatch(DESTRUCTIVE);
    expect(RETENTION_CLI).not.toMatch(RAW_DESTRUCTIVE);
    expect(RETENTION_CLI).not.toMatch(PRISMA_LETTER_DELETE);
    expect(RETENTION_CLI).not.toMatch(RAW_LETTER_DELETE);
  });

  /**
   * Pekerjaan dan CLI tidak **menandai** arsip sebagai musnah.
   *
   * Menghapus baris hanyalah satu cara memusnahkan; menulis `DISPOSED` (atau
   * sebuah bidang `destroyed`) ke atasnya sama saja menghilangkannya dari arsip
   * yang hidup. Keduanya harus lolos dari penjaga ini, dan §2.12 menyebutkan
   * keduanya — dulu hanya yang pertama yang benar-benar diperiksa.
   */
  it('pekerjaan dan CLI retensi tidak menulis status musnah', () => {
    expect(RETENTION_JOB).not.toMatch(DESTRUCTIVE_STATUS_WRITE);
    expect(RETENTION_CLI).not.toMatch(DESTRUCTIVE_STATUS_WRITE);
  });

  it('pekerjaan retensi menyatakan sendiri bahwa ia tidak memusnahkan', () => {
    // Dokumentasi yang menyertainya adalah bagian dari batasnya: siapa pun yang
    // menambahkan penghapusan harus lebih dulu menghapus kalimat ini, dan itu
    // memaksa keputusannya terlihat.
    expect(RETENTION_JOB).toMatch(/tidak pernah[\s\S]{0,40}menghapus|tidak memusnahkan/i);
  });

  /**
   * Tidak ada modul non-uji di API yang menghapus `Letter` atau tanda tangannya.
   *
   * Penghapusan yang sah (mis. menghapus surat yang masih DRAFT) tidak ada di
   * sini; bila kelak ditambahkan, ia harus membawa pengecualiannya sendiri yang
   * terlihat di uji ini — bukan menyelinap lewat celah.
   *
   * Yang dipindai adalah **seluruh** `apps/api/src`, bukan hanya `src/jobs/`:
   * batasnya adalah "sistem tidak memusnahkan naskah", dan penghapusan yang
   * muncul di modul surat sama berbahayanya dengan yang muncul di pekerjaan
   * retensi. Dua bentuk yang dulu luput kini tertangkap — penghapusan lewat
   * klien transaksi (`tx.letter.deleteMany(`) dan lewat SQL mentah
   * (`$executeRaw\`DELETE FROM letters …\``) — dan keduanya diuji terpisah di
   * bawah supaya polanya tidak diam-diam menyempit lagi.
   */
  it('tidak ada kode non-uji yang menghapus Letter / LetterSignature', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === 'node_modules' || entry === 'dist') continue;
          walk(full);
          continue;
        }
        if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
        const source = readFileSync(full, 'utf8');
        if (PRISMA_LETTER_DELETE.test(source) || RAW_LETTER_DELETE.test(source)) {
          offenders.push(full);
        }
      }
    };
    walk(resolve(JOBS_DIR, '..'));

    expect(offenders).toEqual([]);
  });

  /**
   * Pola penjaganya sendiri diuji, bukan hanya dipercaya.
   *
   * Sebuah penjaga yang lebih sempit daripada yang didokumentasikan adalah
   * penjaga yang tidak menjaga: uji ini memberi pola-pola itu contoh yang
   * **harus** tertangkap, termasuk bentuk transaksi dan SQL mentah yang dulu
   * luput, dan satu contoh sah yang **tidak boleh** tertangkap — daftar status
   * baca yang memuat `DISPOSED`.
   */
  it('pola penjaga menangkap penghapusan transaksi dan SQL mentah', () => {
    expect(`await tx.letter.deleteMany({ where: { status: 'DRAFT' } })`).toMatch(
      PRISMA_LETTER_DELETE
    );
    expect(`await prisma.letterSignature.delete({ where: { id } })`).toMatch(PRISMA_LETTER_DELETE);
    expect('await tx.$executeRaw`DELETE FROM letters WHERE id = ${id}`').toMatch(RAW_LETTER_DELETE);
    expect('await tx.$executeRawUnsafe("DELETE FROM letter_signatures")').toMatch(
      RAW_LETTER_DELETE
    );
    // Bentuk sah yang harus tetap lolos: penyaring baca atas status arsip.
    expect(
      `const RETENTION_STATUSES = ['SIGNED', 'SENT', 'ARCHIVED', 'DISPOSED'] as const;`
    ).not.toMatch(DESTRUCTIVE_STATUS_WRITE);
    // ... tetapi penulisan status itu harus tertangkap.
    expect(`await tx.letter.update({ data: { status: 'DISPOSED' } })`).toMatch(
      DESTRUCTIVE_STATUS_WRITE
    );
    expect(`await tx.letter.update({ data: { destroyed: true } })`).toMatch(
      DESTRUCTIVE_STATUS_WRITE
    );
  });
});
