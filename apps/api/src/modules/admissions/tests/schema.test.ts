import { describe, expect, it } from 'vitest';
import {
  updateAdmissionPeriodSchema,
  createPublicRegistrantSchema,
  createRegistrantSchema,
} from '../admissions.schema';

/**
 * UU PDP 27/2022 Pasal 20 dan 25: data pribadi anak tidak boleh dikirim lewat
 * formulir publik tanpa persetujuan orang tua/wali. `consent` sengaja
 * `literal(true)`, jadi tidak menyetujui = bentuk permintaan yang tidak sah.
 */
describe('createPublicRegistrantSchema — parental consent', () => {
  const base = {
    admissionPeriodId: '00000000-0000-0000-0000-000000000000',
    fullName: 'Anak Contoh',
    gender: 'MALE' as const,
    birthPlace: 'Bandung',
    birthDate: '2012-01-01T00:00:00.000Z',
    address: 'Jl. Contoh No. 1',
    fatherName: 'Ayah Contoh',
    motherName: 'Ibu Contoh',
  };

  it('accepts a submission that consents and names the policy version', () => {
    const parsed = createPublicRegistrantSchema.parse({
      ...base,
      consent: true,
      consentVersion: 1,
    });
    expect(parsed.consent).toBe(true);
    expect(parsed.consentVersion).toBe(1);
  });

  it('rejects a submission with no consent field', () => {
    const result = createPublicRegistrantSchema.safeParse({
      ...base,
      consentVersion: 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a submission where consent is false', () => {
    const result = createPublicRegistrantSchema.safeParse({
      ...base,
      consent: false,
      consentVersion: 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a submission without a policy version', () => {
    const result = createPublicRegistrantSchema.safeParse({
      ...base,
      consent: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive policy version', () => {
    const result = createPublicRegistrantSchema.safeParse({
      ...base,
      consent: true,
      consentVersion: 0,
    });
    expect(result.success).toBe(false);
  });

  it('leaves the admin path free of the consent requirement', () => {
    // The unit's admin collects the data offline; the paper form, not this
    // schema, carries the consent. So `createRegistrantSchema` must NOT demand
    // one, or every admin-created registrant would break.
    const result = createRegistrantSchema.safeParse(base);
    expect(result.success).toBe(true);
  });
});

describe('admissions update schemas (Zod 4 partial-overwrite regression)', () => {
  describe('updateAdmissionPeriodSchema', () => {
    it('does not leak quota/registrationFee defaults when only name is sent', () => {
      const parsed = updateAdmissionPeriodSchema.parse({ name: 'PPDB 2026' });
      expect(parsed).toEqual({ name: 'PPDB 2026' });
    });

    it('parses an empty object to only the keys actually sent', () => {
      expect(updateAdmissionPeriodSchema.parse({})).toEqual({});
    });

    it('keeps explicitly provided defaulted fields', () => {
      const parsed = updateAdmissionPeriodSchema.parse({ quota: 120, registrationFee: 250000 });
      expect(parsed).toEqual({ quota: 120, registrationFee: 250000 });
    });
  });
});
