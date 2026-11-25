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
import { retentionReportLines } from '../../src/jobs/registrant-retention.report';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const prisma = createPrismaClient();
  try {
    const summary = await purgeExpiredRegistrants(prisma, { dryRun });
    for (const line of retentionReportLines(summary, { dryRun })) {
      console.log(line);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
