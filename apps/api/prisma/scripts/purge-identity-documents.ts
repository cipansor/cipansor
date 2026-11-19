/**
 * Hapus foto KTP yang tidak boleh lagi disimpan — jalur perintah.
 *
 * Sejak #455 pekerjaannya **terjadwal di dalam API** setiap hari pukul 02.30
 * WIB (`src/jobs/scheduler.ts`), dan logikanya ada satu tempat saja:
 * `purgeIdentityDocuments` di `src/jobs/identity-purge.job.ts`. Berkas ini
 * hanyalah cara memanggilnya dengan tangan — untuk `--dry-run`, untuk
 * menjalankannya di luar jadwal setelah sesuatu diperbaiki, dan untuk membaca
 * hasilnya sebagai daftar alih-alih sebagai satu baris log.
 *
 *     pnpm --filter api db:purge-identity-documents [--dry-run]
 *
 * **Bukan untuk dijalankan di dalam kontainer produksi.** Image-nya memasang
 * dependensi produksi saja, jadi `tsx` tidak ada di sana — berkas ini ikut
 * tersalin tetapi tidak dapat dijalankan. Di produksi jalurnya adalah pekerjaan
 * terjadwal, atau `purgeIdentityDocuments` yang sudah terkompilasi lewat
 * `require('./dist/jobs')`.
 *
 * Dulu di sinilah seluruh logikanya, dengan komentar yang menolak penjadwal
 * dalam proses karena "perintah yang tidak dijalankan meninggalkan jejak di
 * crontab yang dapat diperiksa". Crontab-nya kemudian diperiksa, dan kosong:
 * tidak ada yang pernah menjadwalkannya sama sekali, sehingga retensi tujuh
 * tahun itu sebuah kolom, bukan janji yang ditepati. Yang membuat sebuah
 * pekerjaan dapat diperiksa bukan tempat penjadwalnya melainkan catatan yang
 * ditinggalkannya — dan itu kini ada di `audit_logs`.
 */
import { createPrismaClient } from '../client';
import { purgeIdentityDocuments } from '../../src/jobs/identity-purge.job';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const prisma = createPrismaClient();
  try {
    const summary = await purgeIdentityDocuments(prisma, { dryRun });
    const suffix = dryRun ? ' (dry run — tidak menghapus apa pun)' : '';

    console.log(`${summary.expired.length} berkas identitas melewati masa simpannya${suffix}.`);
    for (const row of summary.expired) {
      const until = row.retainUntil?.toISOString().slice(0, 10) ?? '-';
      console.log(`  ${row.ownerName} — batas simpan ${until}`);
    }

    if (summary.backfilled > 0) {
      console.log(
        `${summary.backfilled} baris tanpa batas simpan diberi batas menurut kebijakan${suffix}.`
      );
    }

    console.log(
      `${summary.onDiskCount} berkas di disk, ${summary.referencedCount} dirujuk ` +
        `basis data, ${summary.orphans.length} yatim${suffix}.`
    );
    for (const orphan of summary.orphans) {
      const written = orphan.modifiedAt.toISOString().slice(0, 10);
      console.log(`  ${orphan.fileName} — ditulis ${written}, tanpa baris`);
    }

    if (!dryRun) {
      const total = summary.expired.length + summary.orphans.length;
      if (total > 0) console.log(`${total} berkas dihapus.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
