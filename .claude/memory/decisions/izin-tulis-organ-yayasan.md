# izin-tulis-organ-yayasan

> Keputusan pemilik 2026-11-10 (#991) — **organ yayasan menulis hanya lewat alur
> kewenangannya**, bukan lewat kelompok peran lama `UNIT_ADMIN`. Keputusan
> pemilik 2026-11-16 (#1020, opsi **A**) — `YAYASAN_SEKRETARIS` **kehilangan**
> izin `STUDENT_UPDATE`; ubah data santri bukan salah satu alur kewenangan organ.

## Asas tulis organ (2026-11-10, #991)

Organ yayasan — Pembina, Pengurus, Pengawas — **membaca luas, mengubah
sesuatu yang menjadi wewenangnya saja**. Alur kewenangan itu: perencanaan dan
pengesahan (RPJP, Renstra, RKA Yayasan, RKA Unit), Rapat Pembina, e-office dan
naskah dinas termasuk pencabutan, Perjanjian Kinerja, profil yayasan,
pengawasan internal, dan kewenangan penggajian.

Pekerjaan harian unit tetap dipegang pelaksana unit. Sebelumnya keenam peran
organ lolos setiap rute tulis yang menerima `UserRole.UNIT_ADMIN`, karena
`LEGACY_ROLE_EXPANSION.UNIT_ADMIN` memuat semuanya dan `deriveLegacyRole`
memberi organ `req.user.role = 'UNIT_ADMIN'`. #991 menutup jalur itu; rincian
teknisnya (guard per kelompok rute, `authorizeDecision`) ada di issue itu.

## Kasus `STUDENT_UPDATE` (2026-11-16, #1020)

`YAYASAN_SEKRETARIS` sebelumnya memegang `STUDENT_UPDATE`, bertentangan dengan
niat kelompok `YAYASAN_OVERSIGHT` dan asas 2026-11-10.

**Keputusan (opsi A):** cabut `STUDENT_UPDATE`; Sekretaris tetap memegang
`STUDENT_VIEW` dan kini identik dengan `YAYASAN_PENGAWAS`.

Ditolak:

- **(B) pertahankan, batasi cakupan unit** — Sekretaris memang memelihara data
  santri untuk unit tertentu. Ditolak: pekerjaan harian unit dipegang pelaksana
  unit, bukan organ.
- **(C) pertahankan apa adanya** — Ditolak: bertentangan dengan niat
  `permissions.ts` dan asas 2026-11-10.
- **(D) tidak perlu sama sekali** — kebutuhan Sekretaris sudah dilayani peran
  lain (mis. Tata Usaha unit). Tidak dipilih; `STUDENT_VIEW` tetap ada.

## Yang mengikat kode

- `apps/api/src/modules/roles/permissions.ts` — `YAYASAN_SEKRETARIS:
[...YAYASAN_OVERSIGHT]`. Setiap peran organ baru yang menyentuh tulis harus
  lebih dulu membuktikan alurnya ada di daftar asas di atas.
- Uji: `apps/api/src/modules/roles/tests/student-update-permission.test.ts`
  (matriks + `PUT /students/:id` → 403) dan e2e
  `apps/web/e2e/sekretaris-student-update.spec.ts` (tombol Edit baris hilang).
