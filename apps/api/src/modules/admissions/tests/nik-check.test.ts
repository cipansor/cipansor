import { describe, expect, it } from 'vitest';
import { checkNik, readNikIdentity } from '@cipansor/shared';
import { createRegistrantSchema } from '../admissions.schema';

/**
 * NIK memuat tanggal lahir dan jenis kelaminnya sendiri (Dukcapil: digit 7–12
 * adalah DD MM YY, dan DD ditambah 40 untuk perempuan). Memeriksanya menangkap
 * salah ketik NIK dan salah isi tanggal lahir tanpa membaca gambar sama sekali
 * — butir 2 keputusan pemilik di #842.
 */

// 320123 | 01 10 23 | 0001 → wilayah, lalu lahir 1 Oktober 2023, laki-laki.
const NIK_MALE = '3201230110230001';
// Tanggal 1 + 40 = 41 menandai perempuan: 1 Oktober 2023, perempuan.
const NIK_FEMALE = '3201234110230001';

describe('readNikIdentity', () => {
  it('reads the birth date and sex of a male NIK', () => {
    expect(readNikIdentity(NIK_MALE)).toEqual({
      birthDay: 1,
      birthMonth: 10,
      birthYearShort: 23,
      gender: 'MALE',
    });
  });

  it('subtracts the 40 that marks a female NIK', () => {
    expect(readNikIdentity(NIK_FEMALE)).toEqual({
      birthDay: 1,
      birthMonth: 10,
      birthYearShort: 23,
      gender: 'FEMALE',
    });
  });

  it('rejects a NIK that is not 16 digits', () => {
    expect(readNikIdentity('320123011023000')).toBeNull();
    expect(readNikIdentity('32012301102300011')).toBeNull();
    expect(readNikIdentity('320123011023000A')).toBeNull();
  });

  it('rejects a month that does not exist', () => {
    expect(readNikIdentity('3201230113230001')).toBeNull();
  });

  it('rejects a day that does not exist in its month', () => {
    expect(readNikIdentity('3201233102230001')).toBeNull();
    expect(readNikIdentity('3201233104230001')).toBeNull();
  });

  it('rejects 29 February in a year that was not a leap year', () => {
    // 2023 (and 1923) had 28 days in February.
    expect(readNikIdentity('3201232902230001')).toBeNull();
  });

  it('rejects day 00', () => {
    expect(readNikIdentity('3201230002230001')).toBeNull();
  });

  it('rejects day 40, which would be a female day 0', () => {
    expect(readNikIdentity('3201234002230001')).toBeNull();
  });

  it('accepts 29 February in a leap year, including the year 00', () => {
    // 1900 was not a leap year, but 2000 was — and no one was born on
    // 29 February 1900, so the century-less `00` must read as 2000.
    expect(readNikIdentity('3201232902240001')).toMatchObject({
      birthDay: 29,
      birthMonth: 2,
    });
    expect(readNikIdentity('3201232902000001')).toMatchObject({
      birthDay: 29,
      birthMonth: 2,
    });
  });
});

describe('checkNik', () => {
  it('accepts an empty NIK — a child may not have one yet', () => {
    expect(
      checkNik({
        nationalId: '',
        birthDate: '2023-10-01T00:00:00.000Z',
        gender: 'MALE',
      })
    ).toEqual({ status: 'empty' });
    expect(checkNik({})).toEqual({ status: 'empty' });
  });

  it('accepts a NIK that agrees with the birth date and the sex', () => {
    expect(
      checkNik({
        nationalId: NIK_MALE,
        birthDate: '2023-10-01T00:00:00.000Z',
        gender: 'MALE',
      })
    ).toEqual({ status: 'match' });
    expect(
      checkNik({
        nationalId: NIK_FEMALE,
        birthDate: '2023-10-01T00:00:00.000Z',
        gender: 'FEMALE',
      })
    ).toEqual({ status: 'match' });
  });

  it('reports the format when the NIK is not 16 digits', () => {
    expect(checkNik({ nationalId: '12345', birthDate: '2023-10-01', gender: 'MALE' })).toEqual({
      status: 'invalid-format',
    });
  });

  it('reports the date when the digits hold no real birth date', () => {
    expect(
      checkNik({
        nationalId: '3201230113230001',
        birthDate: '2023-10-01',
        gender: 'MALE',
      })
    ).toEqual({ status: 'invalid-date' });
  });

  it('reports an impossible date instead of a mismatch', () => {
    // 29 February 2023 does not exist, so the NIK is wrong — not merely
    // different from the birth date filled in.
    expect(
      checkNik({
        nationalId: '3201232902230001',
        birthDate: '2023-02-28T00:00:00.000Z',
        gender: 'MALE',
      })
    ).toEqual({ status: 'invalid-date' });
  });

  it('skips an unreadable birth date instead of reporting a mismatch', () => {
    // Documented behaviour: both callers validate the date's shape first.
    expect(
      checkNik({
        nationalId: NIK_MALE,
        birthDate: 'not-a-date',
        gender: 'MALE',
      })
    ).toEqual({ status: 'match' });
    expect(
      checkNik({
        nationalId: NIK_MALE,
        birthDate: new Date('not-a-date'),
        gender: 'MALE',
      })
    ).toEqual({ status: 'match' });
  });

  it('reports a birth date that disagrees with the NIK', () => {
    expect(
      checkNik({
        nationalId: NIK_MALE,
        birthDate: '2023-10-02T00:00:00.000Z',
        gender: 'MALE',
      })
    ).toEqual({ status: 'mismatch', fields: ['birthDate'] });
  });

  it('reports a sex that disagrees with the NIK', () => {
    expect(
      checkNik({
        nationalId: NIK_FEMALE,
        birthDate: '2023-10-01T00:00:00.000Z',
        gender: 'MALE',
      })
    ).toEqual({ status: 'mismatch', fields: ['gender'] });
  });

  it('reports both when neither matches', () => {
    expect(
      checkNik({
        nationalId: NIK_FEMALE,
        birthDate: '2019-01-05T00:00:00.000Z',
        gender: 'MALE',
      })
    ).toEqual({ status: 'mismatch', fields: ['birthDate', 'gender'] });
  });

  it('compares only the last two digits of the birth year', () => {
    // NIK does not carry the century: 2001 and 1901 both read as `01`.
    expect(
      checkNik({
        nationalId: '3201230110010001',
        birthDate: '2001-10-01T00:00:00.000Z',
        gender: 'MALE',
      })
    ).toEqual({ status: 'match' });
  });
});

describe('createRegistrantSchema — NIK against the birth date and sex', () => {
  const base = {
    admissionPeriodId: '00000000-0000-0000-0000-000000000000',
    fullName: 'Anak Contoh',
    gender: 'MALE' as const,
    birthPlace: 'Bandung',
    birthDate: '2023-10-01T00:00:00.000Z',
    address: 'Jl. Contoh No. 1',
    fatherName: 'Ayah Contoh',
    motherName: 'Ibu Contoh',
  };

  const nationalIdMessages = (result: {
    success: boolean;
    error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
  }) =>
    (result.error?.issues ?? [])
      .filter((issue) => issue.path[0] === 'nationalId')
      .map((issue) => issue.message);

  it('accepts a registrant with no NIK', () => {
    expect(createRegistrantSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a NIK that matches', () => {
    expect(createRegistrantSchema.safeParse({ ...base, nationalId: NIK_MALE }).success).toBe(true);
  });

  it('rejects a NIK that is not 16 digits', () => {
    const result = createRegistrantSchema.safeParse({
      ...base,
      nationalId: '1234',
    });
    expect(result.success).toBe(false);
    expect(nationalIdMessages(result)).toEqual(['NIK harus 16 digit angka']);
  });

  it('rejects a birth date that disagrees with the NIK', () => {
    const result = createRegistrantSchema.safeParse({
      ...base,
      birthDate: '2023-10-02T00:00:00.000Z',
      nationalId: NIK_MALE,
    });
    expect(result.success).toBe(false);
    expect(nationalIdMessages(result)).toEqual([
      'Tanggal lahir pada NIK tidak sama dengan tanggal lahir yang diisi. Bila NIK memang tidak sesuai, kosongkan isian NIK — pendaftaran tetap dapat dikirim.',
    ]);
  });

  it('rejects a sex that disagrees with the NIK', () => {
    const result = createRegistrantSchema.safeParse({
      ...base,
      nationalId: NIK_FEMALE,
    });
    expect(result.success).toBe(false);
    expect(nationalIdMessages(result)).toEqual([
      'Jenis kelamin pada NIK tidak sama dengan jenis kelamin yang dipilih. Bila NIK memang tidak sesuai, kosongkan isian NIK — pendaftaran tetap dapat dikirim.',
    ]);
  });
});
