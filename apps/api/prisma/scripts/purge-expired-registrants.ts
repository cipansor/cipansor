/**
 * Hapus data pendaftar SPMB yang tidak menjadi santri — jalur perintah.
 *
 * Pekerjaannya **terjadwal di dalam API** setiap hari pukul 03.30 WIB
 * (`src/jobs/scheduler.ts`), dan logikanya ada satu tempat saja:
 * `purgeExpiredRegistrants` di `src/jobs/registrant-retention.job.ts`. Berkas
 * ini hanyalah cara memanggilnya dengan tangan — untuk `--dry-run`, untuk
 * menjalankannya di luar jadwal setelah sesuatu diperbaiki, dan untuk membaca
 * hasilnya sebagai daftar alih-alih sebagai satu baris log.
 *
 *     pnpm --filter api db:purge-expired-registrants [--dry-run]
 *
 * **Bukan untuk dijalankan di dalam kontainer produksi.** Image-nya memasang
 * dependensi produksi saja, jadi `tsx` tidak ada di sana. Di produksi jalurnya
 * adalah pekerjaan terjadwal, atau `purgeExpiredRegistrants` yang sudah
 * terkompilasi lewat `require('./dist/jobs')`.
 */
import { createPrismaClient } from '../client';
import { purgeExpiredRegistrants } from '../../src/jobs/registrant-retention.job';
import { wibDayOf } from '../../src/utils/wib';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const prisma = createPrismaClient();
  try {
    const summary = await purgeExpiredRegistrants(prisma, { dryRun });
    const suffix = dryRun ? ' (dry run — tidak menghapus apa pun)' : '';

    console.log(`${summary.expired.length} pendaftar melewati masa simpannya${suffix}.`);
    for (const row of summary.expired) {
      console.log(
        `  ${row.registrationNo} — ${row.status}, gelombang ditutup ${row.closeDay}, ` +
          `boleh dihapus sejak ${wibDayOf(row.retentionStart)} WIB`
      );
    }

    if (!dryRun) {
      console.log(`${summary.deleted.length} pendaftar dihapus beserta dokumennya.`);
    }

    for (const row of summary.failed) {
      console.log(`  GAGAL ${row.registrationNo}: ${row.reason}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
