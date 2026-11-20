import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('../admissions.service', () => ({
  createRegistrant: vi.fn().mockResolvedValue({ id: 'reg-1' }),
  createPublicRegistrantService: vi.fn().mockResolvedValue({
    id: 'reg-1',
    registrationNo: 'PSB-2027-0001',
    registrationToken: 'token',
  }),
}));

import * as service from '../admissions.service';
import { createPublicRegistrant, createRegistrant } from '../admissions.controller';

// 320123 | 01 10 23 | 0001 → lahir 1 Oktober 2023, laki-laki.
const NIK_MALE = '3201230110230001';

const base = {
  admissionPeriodId: '00000000-0000-0000-0000-000000000000',
  fullName: 'Anak Contoh',
  gender: 'MALE',
  birthPlace: 'Bandung',
  birthDate: '2023-10-01T00:00:00.000Z',
  address: 'Jl. Contoh No. 1',
  fatherName: 'Ayah Contoh',
  motherName: 'Ibu Contoh',
};

function call(body: unknown, user?: Record<string, unknown>) {
  const req = {
    params: {},
    body,
    ip: '203.0.113.7',
    user,
  } as unknown as Request;
  const json = vi.fn();
  const res = {
    json,
    status: vi.fn().mockReturnValue({ json }),
  } as unknown as Response;
  const next = vi.fn() as NextFunction & ReturnType<typeof vi.fn>;
  return { req, res, next };
}

// The admin path reads `req.user` before it parses the body.
const admin = {
  sub: 'u1',
  roleCode: 'SUPER_ADMIN',
  unitId: null,
  permissions: [],
};

/** The messages the 400 will carry, as `middleware/error.ts` renders them. */
const zodMessages = (error: ZodError) =>
  error.issues.filter((issue) => issue.path[0] === 'nationalId').map((issue) => issue.message);

describe('POST /admissions — NIK against the birth date and sex', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('public path', () => {
    const body = (extra: Record<string, unknown>) => ({
      ...base,
      consent: true,
      consentVersion: 1,
      ...extra,
    });

    it('accepts a NIK that agrees with the form', async () => {
      const { req, res, next } = call(body({ nationalId: NIK_MALE }));
      await createPublicRegistrant(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(service.createPublicRegistrantService).toHaveBeenCalled();
    });

    it('accepts a registrant with no NIK', async () => {
      const { req, res, next } = call(body({}));
      await createPublicRegistrant(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(service.createPublicRegistrantService).toHaveBeenCalled();
    });

    it('answers 400 when the NIK is not 16 digits', async () => {
      const { req, res, next } = call(body({ nationalId: '1234' }));
      await createPublicRegistrant(req, res, next);

      expect(service.createPublicRegistrantService).not.toHaveBeenCalled();
      const error = next.mock.calls[0][0];
      expect(error).toBeInstanceOf(ZodError);
      expect(zodMessages(error)).toEqual(['NIK harus 16 digit angka']);
    });

    it('answers 400 when the birth date disagrees with the NIK', async () => {
      const { req, res, next } = call(
        body({ nationalId: NIK_MALE, birthDate: '2023-10-02T00:00:00.000Z' })
      );
      await createPublicRegistrant(req, res, next);

      expect(service.createPublicRegistrantService).not.toHaveBeenCalled();
      expect(zodMessages(next.mock.calls[0][0])).toEqual([
        'Tanggal lahir pada NIK tidak sama dengan tanggal lahir yang diisi. Bila NIK memang tidak sesuai, kosongkan isian NIK — pendaftaran tetap dapat dikirim.',
      ]);
    });

    it('answers 400 when the sex disagrees with the NIK', async () => {
      const { req, res, next } = call(body({ nationalId: NIK_MALE, gender: 'FEMALE' }));
      await createPublicRegistrant(req, res, next);

      expect(service.createPublicRegistrantService).not.toHaveBeenCalled();
      expect(zodMessages(next.mock.calls[0][0])).toEqual([
        'Jenis kelamin pada NIK tidak sama dengan jenis kelamin yang dipilih. Bila NIK memang tidak sesuai, kosongkan isian NIK — pendaftaran tetap dapat dikirim.',
      ]);
    });
  });

  describe('admin path — the unit collects the data offline', () => {
    it('refuses the same mismatch the public form refuses', async () => {
      const { req, res, next } = call({ ...base, nationalId: NIK_MALE, gender: 'FEMALE' }, admin);
      await createRegistrant(req, res, next);

      expect(service.createRegistrant).not.toHaveBeenCalled();
      expect(next.mock.calls[0][0]).toBeInstanceOf(ZodError);
    });

    it('still accepts a registrant with no NIK and no consent', async () => {
      const { req, res, next } = call(base, admin);
      await createRegistrant(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(service.createRegistrant).toHaveBeenCalled();
    });
  });
});
