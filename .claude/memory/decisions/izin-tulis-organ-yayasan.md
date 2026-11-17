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

`YAYASAN_SEKRETARIS` adalah **satu-satunya** peran organ yang memegang izin
non-baca: `STUDENT_UPDATE`. Itu bertentangan dengan niat kelompoknya sendiri —
komentar `permissions.ts` menyebut organ "read broadly, change nothing" — dan
bertentangan dengan asas 2026-11-10: ubah data santri bukan alur kewenangan
organ.

Cakupannya luas, bukan sempit: `seesAllUnits()` (`resolve-unit-id.ts`) melewatkan
filter unit untuk peran berlingkup yayasan, dan `student.service.ts` memakainya
sebagai satu-satunya filter unit. Jadi bila izin itu bertahan, Sekretaris dapat
mengubah data santri di **seluruh unit** (TKQ, SD IT, SMP IT, SMA Qur'an).

**Keputusan (opsi A, disarankan triase):** cabut `STUDENT_UPDATE` dari
`YAYASAN_SEKRETARIS`. Sekretaris tetap **melihat** daftar santri lewat
`STUDENT_VIEW` di `YAYASAN_OVERSIGHT`; hanya tulisnya yang hilang. Sekretaris
kini identik dengan `YAYASAN_PENGAWAS` (baseline `YAYASAN_OVERSIGHT`).

Ditolak:

- **(B) pertahankan, batasi cakupan unit** — Sekretaris memang memelihara data
  santri untuk unit tertentu. Ditolak: pekerjaan harian unit dipegang pelaksana
  unit, bukan organ.
- **(C) pertahankan apa adanya** — akses seluruh unit diterima. Ditolak:
  bertentangan dengan niat `permissions.ts` dan asas 2026-11-10.
- **(D) tidak perlu sama sekali** — kebutuhan Sekretaris sudah dilayani peran
  lain (mis. Tata Usaha unit). Tidak dipilih; `STUDENT_VIEW` tetap ada.

## Yang mengikat kode

- `apps/api/src/modules/roles/permissions.ts` — `YAYASAN_SEKRETARIS:
[...YAYASAN_OVERSIGHT]`. Setiap peran organ baru yang menyentuh tulis harus
  lebih dulu membuktikan alurnya ada di daftar asas di atas.
- Uji: `apps/api/src/modules/roles/tests/student-update-permission.test.ts`
  (matriks + `PUT /students/:id` → 403) dan e2e
  `apps/web/e2e/sekretaris-student-update.spec.ts` (tombol Edit baris hilang).

## Catatan penyebaran

Peta izin di `permissions.ts` adalah sumber di dalam kode. Saat runtime, daftar
izin yang dibawa token login dibaca dari kolom `roles.permissions` di basis
data; kolom itu diisi oleh `prisma/seed.ts`. Karena itu setiap perubahan peta
izin perlu disertai penyegaran peran pada lingkungan yang bersangkutan (lewat
seed atau sinkronisasi peran) agar berlaku.
