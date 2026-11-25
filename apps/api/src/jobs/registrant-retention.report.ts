import { wibDayOf } from '../utils/wib';
import type { RegistrantRetentionSummary } from './registrant-retention.job';

/**
 * Baris keluaran untuk jalur perintah retensi. Dipisahkan dari skrip supaya
 * label "ditahan" dan "boleh dihapus" dapat diuji tanpa database.
 */
export function retentionReportLines(
  summary: RegistrantRetentionSummary,
  { dryRun }: { dryRun: boolean }
): string[] {
  const suffix = dryRun ? ' (dry run — tidak menghapus apa pun)' : '';
  const lines = [`${summary.expired.length} pendaftar melewati masa simpannya${suffix}.`];

  if (summary.withheld) {
    lines.push(`${summary.withheld} ditahan karena permintaan hak subjek terbuka.`);
  }

  const heldIds = new Set(summary.held.map((row) => row.registrantId));
  for (const row of summary.expired) {
    const label = heldIds.has(row.registrantId)
      ? 'DITAHAN — permintaan hak subjek terbuka'
      : `boleh dihapus sejak ${wibDayOf(row.retentionStart)} WIB`;
    lines.push(
      `  ${row.registrationNo} — ${row.status}, gelombang ditutup ${row.closeDay}, ${label}`
    );
  }

  if (!dryRun) {
    lines.push(`${summary.deleted.length} pendaftar dihapus beserta dokumennya.`);
  }

  for (const row of summary.failed) {
    lines.push(`  GAGAL ${row.registrationNo}: ${row.reason}`);
  }

  return lines;
}
