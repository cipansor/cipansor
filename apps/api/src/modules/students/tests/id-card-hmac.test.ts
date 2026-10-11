import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StudentIdCardService } from '../id-card.service';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    studentCardState: {
      findUnique: vi.fn(),
    },
  },
}));

describe('StudentIdCardService HMAC QR Code', () => {
  const mockStudent = {
    id: 'student-uuid-1',
    nis: '2026001',
    nisn: '0012345678',
    name: 'Ahmad Fulan',
    unitId: 'unit-smp-1',
    unitName: 'SMP IT Cipansor',
    validUntil: new Date(Date.now() + 86400000 * 30), // 30 days ahead
    cardId: 'card-state-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // A generated card is ACTIVE by default; individual tests override.
    (prisma.studentCardState.findUnique as any).mockResolvedValue({
      id: mockStudent.cardId,
      studentId: mockStudent.id,
      status: 'ACTIVE',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('generates a valid HMAC-signed QR code string embedding the card id', () => {
    const qrData = StudentIdCardService.generateQRCodeData(mockStudent);

    expect(qrData).toMatch(/^cipansor:\/\/[A-Za-z0-9_-]+#[a-f0-9]{16}$/);

    const payloadPart = qrData.replace('cipansor://', '').split('#')[0];
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    expect(payload.cid).toBe(mockStudent.cardId);
  });

  it('successfully verifies a valid 16-char HMAC QR code string for an ACTIVE card', async () => {
    const qrData = StudentIdCardService.generateQRCodeData(mockStudent);
    const verification = await StudentIdCardService.verifyQRCodeData(qrData);

    expect(verification.valid).toBe(true);
    expect(verification.studentId).toBe(mockStudent.id);
    expect(verification.nis).toBe(mockStudent.nis);
    expect(verification.expired).toBe(false);
  });

  it('rejects legacy 8-char HMAC or un-signed QR code string', async () => {
    const qrData16 = StudentIdCardService.generateQRCodeData(mockStudent);
    const [payloadPart, hmac16] = qrData16.replace('cipansor://', '').split('#');
    const legacyQrData = `cipansor://${payloadPart}#${hmac16.substring(0, 8)}`;

    const verification = await StudentIdCardService.verifyQRCodeData(legacyQrData);

    expect(verification.valid).toBe(false);
    expect(verification.message).toMatch(/wajib HMAC 16 karakter/);
  });

  it('rejects tampered QR code payload with invalid HMAC signature', async () => {
    const qrData = StudentIdCardService.generateQRCodeData(mockStudent);
    const [, hmacHash] = qrData.replace('cipansor://', '').split('#');

    // Create tampered payload JSON
    const tamperedPayloadObj = {
      sid: 'student-uuid-tampered',
      nis: '9999999',
      exp: Date.now() + 86400000,
    };
    const tamperedBase64 = Buffer.from(JSON.stringify(tamperedPayloadObj)).toString('base64url');
    const tamperedQrData = `cipansor://${tamperedBase64}#${hmacHash}`;

    const verification = await StudentIdCardService.verifyQRCodeData(tamperedQrData);

    expect(verification.valid).toBe(false);
    expect(verification.message).toMatch(/HMAC tidak cocok/);
  });

  it('detects expired student card QR code', async () => {
    const expiredStudent = {
      ...mockStudent,
      validUntil: new Date(Date.now() - 86400000), // 1 day in the past
    };
    const qrData = StudentIdCardService.generateQRCodeData(expiredStudent);
    const verification = await StudentIdCardService.verifyQRCodeData(qrData);

    expect(verification.valid).toBe(false);
    expect(verification.expired).toBe(true);
    expect(verification.message).toMatch(/kedaluwarsa/);
  });

  it('rejects a card whose StudentCardState row was REVOKED by a regeneration, even if not expired', async () => {
    const qrData = StudentIdCardService.generateQRCodeData(mockStudent);
    (prisma.studentCardState.findUnique as any).mockResolvedValue({
      id: mockStudent.cardId,
      studentId: mockStudent.id,
      status: 'REVOKED',
      revokedAt: new Date().toISOString(),
      revokeReason: 'superseded_by_regeneration',
    });

    const verification = await StudentIdCardService.verifyQRCodeData(qrData);

    expect(verification.valid).toBe(false);
    expect(verification.expired).toBe(false);
    expect(verification.message).toMatch(/tidak berlaku.*dicabut|diregenerasi/i);
  });

  it('rejects a card whose StudentCardState row is EXPIRED', async () => {
    const qrData = StudentIdCardService.generateQRCodeData(mockStudent);
    (prisma.studentCardState.findUnique as any).mockResolvedValue({
      id: mockStudent.cardId,
      studentId: mockStudent.id,
      status: 'EXPIRED',
    });

    const verification = await StudentIdCardService.verifyQRCodeData(qrData);

    expect(verification.valid).toBe(false);
    expect(verification.expired).toBe(true);
    expect(verification.message).toMatch(/kedaluwarsa/);
  });

  it('rejects a QR payload that carries no card identifier', async () => {
    const noCardStudent = { ...mockStudent, cardId: undefined };
    const qrData = StudentIdCardService.generateQRCodeData(noCardStudent);

    const verification = await StudentIdCardService.verifyQRCodeData(qrData);

    expect(verification.valid).toBe(false);
    expect(verification.message).toMatch(/identitas kartu tidak ditemukan/);
    expect(prisma.studentCardState.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a card id that does not belong to the student in the payload', async () => {
    const qrData = StudentIdCardService.generateQRCodeData(mockStudent);
    (prisma.studentCardState.findUnique as any).mockResolvedValue({
      id: mockStudent.cardId,
      studentId: 'someone-else',
      status: 'ACTIVE',
    });

    const verification = await StudentIdCardService.verifyQRCodeData(qrData);

    expect(verification.valid).toBe(false);
    expect(verification.message).toMatch(/data kartu tidak cocok/);
  });

  it('issues a public verification URL that embeds a verifiable signed payload', async () => {
    // The QR printed on the physical card must be an https URL (so a phone
    // camera offers to open the verification page), not a bare `cipansor://`
    // scheme. The signed `cipansor://…` string lives in the URL's `data`
    // query param, which `/public/verify-card` extracts and verifies.
    //
    // The host comes from `config.publicSiteUrl` (`PUBLIC_SITE_URL`), which a
    // developer's local `.env` sets to `http://localhost:3000` — the right
    // value for the local stack, the wrong one for this assertion. Pin it so
    // the test states the production contract rather than the machine's env.
    vi.stubEnv('PUBLIC_SITE_URL', 'https://cipansor.or.id');
    vi.resetModules();
    const { StudentIdCardService: Fresh } = await import('../id-card.service');

    const qrData = Fresh.generateQRCodeData(mockStudent);
    const verificationUrl = Fresh.generateVerificationUrl(qrData);

    expect(verificationUrl).toMatch(/^https:\/\/[^/]+\/public\/verify-card\?data=/);

    const dataParam = new URL(verificationUrl).searchParams.get('data');
    expect(dataParam).toBe(qrData);

    const verification = await Fresh.verifyQRCodeData(dataParam!);
    expect(verification.valid).toBe(true);
  });
});
