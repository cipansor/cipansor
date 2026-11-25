import { describe, it, expect } from 'vitest';
import type { ExpiredRegistrant, RegistrantRetentionSummary } from './registrant-retention.job';
import { retentionReportLines } from './registrant-retention.report';

function row(id: string, registrationNo: string): ExpiredRegistrant {
  return {
    registrantId: id,
    registrationNo,
    status: 'REJECTED',
    waveId: 'w-1',
    closeDay: '2026-01-31',
    retentionStart: new Date('2026-05-01T00:00:00.000Z'),
  };
}

function summary(overrides: Partial<RegistrantRetentionSummary> = {}): RegistrantRetentionSummary {
  const held = row('minta-akses', 'MINTA-AKSES');
  const plain = row('biasa', 'BIASA');
  return {
    dryRun: true,
    expired: [held, plain],
    deleted: [],
    failed: [],
    withheld: 1,
    held: [held],
    ...overrides,
  };
}

describe('retentionReportLines', () => {
  it('menandai pendaftar yang ditahan, bukan "boleh dihapus"', () => {
    const lines = retentionReportLines(summary(), { dryRun: true });

    expect(lines[0]).toContain('2 pendaftar melewati masa simpannya');
    expect(lines[0]).toContain('dry run');
    expect(lines[1]).toBe('1 ditahan karena permintaan hak subjek terbuka.');

    const heldLine = lines.find((line) => line.includes('MINTA-AKSES'));
    expect(heldLine).toContain('DITAHAN — permintaan hak subjek terbuka');
    expect(heldLine).not.toContain('boleh dihapus sejak');

    const plainLine = lines.find((line) => line.includes('BIASA'));
    expect(plainLine).toContain('boleh dihapus sejak');
  });

  it('melaporkan jumlah yang dihapus dan kegagalan pada jalan sungguhan', () => {
    const lines = retentionReportLines(
      summary({
        dryRun: false,
        deleted: [row('biasa', 'BIASA')],
        failed: [{ registrantId: 'gagal', registrationNo: 'GAGAL', reason: 'terkunci' }],
        withheld: 0,
        held: [],
      }),
      { dryRun: false }
    );

    expect(lines).toContain('1 pendaftar dihapus beserta dokumennya.');
    expect(lines).toContain('  GAGAL GAGAL: terkunci');
    expect(lines.join('\n')).not.toContain('dry run');
  });
});
