import { describe, it, expect } from 'vitest';
import { isAllowedSignatureUrl } from './signature-url';
import { createCertificateSchema } from '../modules/certificates/certificates.schema';

/**
 * `signatureUrl` is rendered as `<img src>` on the certificate detail page, so
 * a value the server accepts is a URL the *browser of whoever opens the
 * certificate* will fetch. The guard's job is to keep that fetch on a host the
 * yayasan controls; anything else is a stored request-to-attacker-host.
 */
describe('isAllowedSignatureUrl', () => {
  it('accepts a same-site path', () => {
    expect(isAllowedSignatureUrl('/uploads/signature.png')).toBe(true);
  });

  it('accepts an absolute URL on an application host', () => {
    expect(isAllowedSignatureUrl('https://cipansor.or.id/uploads/signature.png')).toBe(true);
    expect(isAllowedSignatureUrl('https://portal.cipansor.or.id/uploads/signature.png')).toBe(true);
  });

  it('refuses an arbitrary host', () => {
    expect(isAllowedSignatureUrl('https://evil.example/signature.png')).toBe(false);
    expect(isAllowedSignatureUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
  });

  it('refuses a scheme the browser would not fetch as an image over http(s)', () => {
    expect(isAllowedSignatureUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedSignatureUrl('data:image/png;base64,AAAA')).toBe(false);
  });

  it('refuses a protocol-relative URL, which can point at any host', () => {
    expect(isAllowedSignatureUrl('//evil.example/signature.png')).toBe(false);
  });

  it('refuses a host that only looks like an application host', () => {
    expect(isAllowedSignatureUrl('https://cipansor.or.id.evil.example/x.png')).toBe(false);
  });
});

describe('createCertificateSchema signatureUrl', () => {
  const base = {
    studentId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    certificateType: 'TAHFIDZ',
    title: 'Sertifikat Tahfidz',
    issueDate: '2026-09-01T00:00:00.000Z',
    signatoryName: 'Ust. Ahmad',
    signatoryTitle: 'Musyrif',
  };

  it('accepts a same-site signature path', () => {
    const parsed = createCertificateSchema.parse({ ...base, signatureUrl: '/uploads/ttd.png' });
    expect(parsed.signatureUrl).toBe('/uploads/ttd.png');
  });

  it('rejects a signature URL on a foreign host', () => {
    const result = createCertificateSchema.safeParse({
      ...base,
      signatureUrl: 'https://evil.example/ttd.png',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed signature URL', () => {
    const result = createCertificateSchema.safeParse({ ...base, signatureUrl: 'not a url' });
    expect(result.success).toBe(false);
  });

  it('allows the field to be omitted', () => {
    expect(createCertificateSchema.safeParse(base).success).toBe(true);
  });
});
