import { describe, it, expect } from 'vitest';
import { SigningAuthorityForm as PrismaForm } from '@prisma/client';
import {
  SIGNING_AUTHORITY_ABBREVIATION,
  SIGNING_AUTHORITY_LABELS,
  SELECTABLE_SIGNING_AUTHORITY_FORMS,
  SigningAuthorityForm as SharedForm,
  requiresRepresentedOffice,
  signingAuthorityLines,
} from '@cipansor/shared';

/**
 * Cermin enum yang tidak boleh retak.
 *
 * `SigningAuthorityForm` ada dua kali: sekali di `schema.prisma` sebagai kolom
 * basis data, sekali di `@cipansor/shared` supaya halaman verifikasi publik dan
 * formulir penandatanganan dapat menyebut bentuknya tanpa menarik Prisma ke
 * dalam bundel browser. Tidak ada apa pun dalam sistem tipe yang menghubungkan
 * keduanya, dan penyimpangannya bukan galat kompilasi melainkan naskah yang
 * tercetak dengan bentuk yang salah — atau halaman verifikasi yang membaca
 * `.label` dari `undefined` dan jatuh.
 */
describe('SigningAuthorityForm — Prisma dan shared harus sama persis', () => {
  it('anggotanya sama, tanpa kurang maupun lebih di salah satu sisi', () => {
    expect(Object.values(SharedForm).sort()).toEqual(Object.values(PrismaForm).sort());
  });

  it('setiap nilai punya singkatan dan keterangan yang dapat dibaca', () => {
    for (const value of Object.values(PrismaForm)) {
      const label = SIGNING_AUTHORITY_LABELS[value as unknown as SharedForm];
      expect(label, `tidak ada keterangan untuk ${value}`).toBeDefined();
      expect(label.label.length).toBeGreaterThan(0);
      expect(label.summary.length).toBeGreaterThan(0);
      expect(label.authority.length).toBeGreaterThan(0);
      expect(SIGNING_AUTHORITY_ABBREVIATION[value as unknown as SharedForm]).toBeDefined();
    }
  });

  it('hanya NONE yang tidak menuntut jabatan yang diwakili', () => {
    expect(requiresRepresentedOffice(SharedForm.NONE)).toBe(false);
    for (const form of SELECTABLE_SIGNING_AUTHORITY_FORMS) {
      if (form === SharedForm.NONE) continue;
      expect(requiresRepresentedOffice(form), `${form} harus menuntut jabatan`).toBe(true);
    }
  });
});

/**
 * Susunan baris yang tercetak — bentuk yang dibaca orang di atas kertas.
 *
 * Yang diuji adalah aturan penulisannya, bukan perender PDF-nya: singkatan
 * garis kewenangan mendahului jabatan yang diwakili, dan u.b. hanya bermakna
 * setelah a.n. (pelimpahan dua tingkat) — bukan bentuk yang berdiri sendiri.
 */
describe('signingAuthorityLines', () => {
  it('a.n. menaruh jabatan yang diwakili di baris pertama', () => {
    expect(
      signingAuthorityLines({
        form: SharedForm.ATAS_NAMA,
        representedOffice: "Kepala SMA Qur'an Cipansor",
        signerOffice: 'Sekretaris Yayasan',
      })
    ).toEqual(["a.n. Kepala SMA Qur'an Cipansor", 'Sekretaris Yayasan,']);
  });

  it('u.b. selalu didahului a.n., tidak berdiri sendiri', () => {
    const lines = signingAuthorityLines({
      form: SharedForm.UNTUK_BELIAU,
      representedOffice: 'Ketua Yayasan',
      signerOffice: 'Kepala Biro Umum',
    });
    expect(lines[0]).toBe('a.n. Ketua Yayasan');
    expect(lines[1]).toBe('u.b. Kepala Biro Umum,');
  });

  it('Plt. dan Plh. mencetak jabatannya langsung, tanpa a.n.', () => {
    expect(
      signingAuthorityLines({
        form: SharedForm.PELAKSANA_TUGAS,
        representedOffice: 'Kepala SD IT',
        signerOffice: 'Wakil Kepala',
      })
    ).toEqual(['Plt. Kepala SD IT,']);
    expect(
      signingAuthorityLines({
        form: SharedForm.PELAKSANA_HARIAN,
        representedOffice: 'Kepala SD IT',
        signerOffice: 'Wakil Kepala',
      })
    ).toEqual(['Plh. Kepala SD IT,']);
  });

  it('tanpa jabatan yang diwakili, bentuk apa pun jatuh kembali ke jabatan penanda tangan', () => {
    expect(
      signingAuthorityLines({
        form: SharedForm.ATAS_NAMA,
        representedOffice: null,
        signerOffice: 'Sekretaris Yayasan',
      })
    ).toEqual(['Sekretaris Yayasan,']);
  });

  it('NONE hanya mencetak jabatan penanda tangan', () => {
    expect(signingAuthorityLines({ form: SharedForm.NONE, signerOffice: 'Ketua Yayasan' })).toEqual(
      ['Ketua Yayasan,']
    );
  });
});
