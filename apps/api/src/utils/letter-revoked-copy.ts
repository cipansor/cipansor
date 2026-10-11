import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { stampRevoked } from '@/utils/generate-letter-pdf';

/**
 * Mengenali berkas PDF yang merupakan **salinan bercap DICABUT** dari sistem.
 *
 * Salinan yang diunduh setelah pencabutan membawa cap "DICABUT" pada setiap
 * halamannya (`stampRevoked`), dan cap itu mengubah byte-nya. Akibatnya hash
 * berkas yang diunggah pemverifikasi tidak pernah sama dengan `pdfHash` yang
 * ditandatangani — sehingga tanpa pengenalan ini, berkas resmi keluaran sistem
 * sendiri dijawab "tidak terdaftar atau telah diubah". Naskah yang justru
 * paling perlu dijelaskan statusnya dituduh palsu, dan itu kelas jawaban keliru
 * yang dihindari di seluruh halaman verifikasi.
 *
 * **Yang dipercaya bukan teksnya, melainkan hashnya.** Hash salinan bercap
 * disimpan pada baris tanda tangannya (`LetterSignature.revokedSha256`) saat
 * pencabutan dicatat, lalu hasilnya dibandingkan sebagai hash. Menempelkan
 * tulisan "DICABUT" ke PDF karangan karena itu tidak menolong pemalsu: sistem
 * tetap membandingkan hash, cap karangan itu tidak akan sama dengan cap yang
 * dihasilkan dari arsip, dan jawabannya tetap "tidak terdaftar".
 *
 * **Nama pencabut ikut membeku.** Cap mencetak nama pencabutnya, jadi hashnya
 * bergantung pada nama itu. Bila nama dibaca dari `User.name` pada setiap
 * unduhan, satu penggantian nama menisbikan setiap salinan bercap yang sudah
 * beredar — salinan resmi sistem sendiri dijawab "tidak terdaftar". Karena itu
 * `LetterSignature.revokedByName` menyimpan nama **saat mencabut**, dan kedua
 * jalur di bawah membacanya dari sana, bukan dari akun hari ini.
 *
 * **Kenapa disimpan, bukan dibuat ulang.** Versi sebelumnya membuat ulang cap
 * pada setiap permintaan, dibatasi 200 tanda tangan tercabut terbaru. Dua
 * kelemahan: biaya `stampRevoked` pada setiap unggahan, dan — yang lebih buruk —
 * begitu pencabutan melewati 200, salinan resmi yang lebih tua dijawab "tidak
 * terdaftar". Menyimpan hash salinan itu menutup keduanya: pencocokan menjadi
 * satu perbandingan tepat dan tanpa batas. Baris yang belum punya hash
 * (pencabutan lama) jatuh ke jalur cadangan yang membuat ulang cap, terbatas —
 * sama seperti perilaku sebelumnya, agar tidak ada yang berhenti dikenali.
 *
 * **Batasnya.** Hanya tanda tangan yang arsipnya ada (`letterSignedDocument`)
 * yang dapat dikenali; surat lama yang dicabut sebelum arsip ada tidak ikut
 * dikenali di sini. Jumlahnya kecil dan `db:archive-letters` menutupnya.
 */

/** Berapa tanda tangan tercabut yang diperiksa dalam jalur cadangan. */
const MAX_CANDIDATES = 200;

const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

export interface RevokedCopyMatch {
  verificationToken: string;
}

type RevokedCopyClient = {
  letterSignature: {
    /** Jalur cepat: cocokkan langsung pada hash salinan bercap yang tersimpan. */
    findFirst: (args: unknown) => Promise<{ verificationToken: string } | null>;
    /** Jalur cadangan: pencabutan lama yang belum punya hash salinan. */
    findMany: (args: unknown) => Promise<
      Array<{
        verificationToken: string;
        revokedAt: Date | null;
        revokedReason: string | null;
        revokedByName: string | null;
        revokedBy: { name: string | null } | null;
        document: { bytes: Uint8Array; sha256: string } | null;
      }>
    >;
  };
};

/**
 * Cari tanda tangan tercabut yang salinan bercapnya sama persis dengan berkas
 * yang diunggah. `null` bila tidak ada yang cocok.
 */
export async function matchRevokedCopy(
  pdfBuffer: Buffer,
  uploadedHash: string,
  client: RevokedCopyClient = prisma as unknown as RevokedCopyClient
): Promise<RevokedCopyMatch | null> {
  // Jalur cepat: hash salinan bercap sudah tersimpan saat pencabutan dicatat.
  const exact = await client.letterSignature.findFirst({
    where: { revokedAt: { not: null }, revokedSha256: uploadedHash },
    select: { verificationToken: true },
  });
  if (exact) return { verificationToken: exact.verificationToken };

  // Jalur cadangan: pencabutan yang tercatat sebelum hash salinan disimpan.
  const candidates = await client.letterSignature.findMany({
    where: {
      revokedAt: { not: null },
      revokedSha256: null,
      document: { isNot: null },
    },
    orderBy: { revokedAt: 'desc' },
    take: MAX_CANDIDATES,
    select: {
      verificationToken: true,
      revokedAt: true,
      revokedReason: true,
      revokedByName: true,
      revokedBy: { select: { name: true } },
      document: { select: { bytes: true, sha256: true } },
    },
  });

  for (const candidate of candidates) {
    if (!candidate.revokedAt || !candidate.document) continue;

    const archived = Buffer.from(candidate.document.bytes);
    // Cap selalu menambah byte (satu font, satu alur isi berisi perintah
    // tambahan), jadi salinan bercap tidak mungkin lebih kecil dari arsipnya.
    // Saringan ini gratis dan pasti: kandidat yang arsipnya sebesar atau lebih
    // besar dari berkas yang diunggah tidak mungkin menjadi asalnya.
    if (archived.length >= pdfBuffer.length) continue;
    // Arsip yang tidak lagi utuh tidak boleh menjadi dasar pencocokan: cap yang
    // dibuat dari byte rusak bukan cap yang diunduh penerimanya.
    if (sha256(archived) !== candidate.document.sha256) continue;

    const stamped = await stampRevoked(archived, {
      reason: candidate.revokedReason ?? 'Dicabut oleh pejabat yang berwenang.',
      revokedAt: candidate.revokedAt,
      // Nama yang membeku lebih dulu; `revokedBy.name` hanya untuk pencabutan
      // yang tercatat sebelum kolom nama ada.
      revokedByName: candidate.revokedByName ?? candidate.revokedBy?.name ?? null,
    });

    if (sha256(stamped) === uploadedHash) {
      return { verificationToken: candidate.verificationToken };
    }
  }

  return null;
}
