---
name: panduan-peran
description: Panduan per peran pengguna Cipansor — siapa tiap peran di yayasan, menu dan dasbor yang ia lihat (dicetak langsung dari kode, tidak disalin), lingkup datanya, dan cara menjawab "bagaimana/bisakah peran X melakukan Y" lewat empat lapis pemeriksaan. Use when writing the menu path a report must give (golden rule 11), answering how a role does something in the app, building or reviewing a page or feature for a role, checking what a role should or should not see, drafting a user manual (panduan pengguna) for staff, or before changing navigation.ts, rbac.ts or a role's permissions.
---

# Panduan per peran

Sistem ini punya 53 kode peran (2026-09-26). Kebanyakan adalah fungsi yang sama yang
diulang per unit (`TKQ_`, `SDIT_`, `SMPIT_`, `SMAQ_` × Admin, Kepala Sekolah,
Guru, TU, …), dan semuanya jatuh ke **13 keluarga menu**. Skill ini memuat
yang *tidak* tertulis di kode: peran itu siapa di yayasan, dan cara memeriksa
apa yang bisa ia lakukan. Menu dan hak aksi selalu dibaca dari kode.

## Sumber kebenaran — baca, jangan salin

| Pertanyaan | Sumbernya |
|---|---|
| Kode peran apa saja yang ada | `enum RoleCode` di `apps/api/prisma/schema.prisma` |
| Pengelompokan peran (admin, pengurus, kepala sekolah, TU, …) | `packages/shared/src/roles.ts` — dipakai API dan web |
| Menu dan dasbor sebuah peran | `getNavigationForRoleCode` (`apps/web/src/config/navigation.ts`) dan `getDashboardForRole` (`apps/web/src/lib/rbac.ts`) — **cetak dengan skrip di bawah** |
| Halaman web yang boleh dibuka | `roleRouteAccess` per bucket di `apps/web/src/lib/rbac.ts`, ditegakkan `apps/web/middleware.ts` |
| Aksi yang boleh dilakukan | API: `authorize(...)` di `*.routes.ts` tiap modul, izin per kode peran di `apps/api/src/modules/roles/permissions.ts`, dan penjaga di service (mis. `canAuthorUnitPlan`) |
| Baris data yang terlihat | `seesAllUnits` / `isFoundationScopedRole` / `CROSS_UNIT_SCOPE_ROLES` di `apps/api/src/utils/resolve-unit-id.ts` |
| Akun untuk mencoba | `DEMO_ACCOUNTS` di `packages/shared/src/types/demo-accounts.ts` (stack lokal dan staging) |

**Mencetak menu** — dari `apps/web`, sesudah `pnpm install` dan build `shared`:

```bash
../api/node_modules/.bin/tsx scripts/role-menus.ts --families        # kode peran per keluarga menu
../api/node_modules/.bin/tsx scripts/role-menus.ts SMPIT_TATA_USAHA  # satu peran: dasbor + pohon menu
../api/node_modules/.bin/tsx scripts/role-menus.ts > /tmp/menus.md   # semua akun demo
```

Butir yang rutenya ditolak middleware untuk peran itu ditandai `⛔ bounces`.
Pada 2026-09-25 jumlahnya **0**, sejalan dengan uji kontrak menu↔RBAC
(`.claude/memory/lessons/rbac-nav-contract.md`).

## Cara kerja peran

- **Satu orang bisa punya beberapa penugasan.** Penugasan **utama** (`isPrimary`)
  menentukan menu (sidebar), halaman yang boleh dibuka (middleware
  `getEffectiveRole`), dan `req.user.role` di API. Kalau pengguna berganti
  peran, menunya ikut berganti. Contohnya Kiai, yang juga Pembina: dua
  penugasan, dua menu.
- **Dua lapis di web.** Kode peran memilih *menu*; enam bucket lama
  (`SUPER_ADMIN`, `UNIT_ADMIN`, `TEACHER`, `STAFF`, `STUDENT`, `PARENT`) memilih
  *halaman* yang boleh dibuka. Organ yayasan masuk bucket `UNIT_ADMIN`. Kepala
  sekolah dan Kiai masuk `TEACHER`. Komite dan Alumni tidak ada di
  `ROLE_CODE_TO_LEGACY`, jadi jatuh ke kolom `users.role`, yang oleh seed diisi
  `STAFF` / `STUDENT`.
- **Lebar data ≠ kuasa.** Organ yayasan, peran pesantren, dan staf lintas unit
  (Perawat, Pustakawan, Keamanan, Laboran) melihat semua unit. Apa yang boleh
  mereka *lakukan* tetap diputuskan daftar izinnya. Peran lain terkunci pada
  unitnya.
- **Halaman "Roles & Permissions" belum mengatur akses.** Super Admin bisa
  membuat peran dan mencentang izin (`roles.permissions`), tetapi hanya 13 rute
  API yang membacanya (`hasPermission`). 670 rute lain memakai bucket
  (`authorize`), dan menu tidak membacanya sama sekali. Jangan menjawab "atur
  saja lewat centang". Arah perbaikannya adalah Model A di `roadmap.md`: satu
  izin per fitur dan aksi, lingkup data dari penugasan, menu diturunkan dari
  izin, dan pemisahan tugas dikunci di kode.
- **Halaman terbuka ≠ aksi diizinkan.** Tombol dijaga lagi oleh API. Sebaliknya
  juga bisa terjadi: API mengizinkan, tetapi web menolak (lihat celah di bawah).

## 13 keluarga menu (diukur 2026-09-25)

| Keluarga | Kode peran | Dasbor · bucket | Siapa di yayasan |
|---|---|---|---|
| Super Admin | `SUPER_ADMIN` | `/dashboard` · SUPER_ADMIN | Pengelola sistem: akun, peran, kunci TTE. **Bukan** organ — tidak mengesahkan dokumen yayasan dan tidak mencabut naskah. |
| Admin unit (TK, SD) | `TKQ_ADMIN`, `SDIT_ADMIN` | `/dashboard` · UNIT_ADMIN | Administrator akun & peran unit; menyusun RKA Unit. |
| Admin unit (SMP, SMA) | `SMPIT_ADMIN`, `SMAQ_ADMIN` | sama | Sama; menunya berbeda dari TK/SD pada butir yang ber-`roleCodes`. |
| Organ yayasan | `YAYASAN_PEMBINA`, `_KETUA`, `_SEKRETARIS`, `_BENDAHARA`, `_ANGGOTA`, `_PENGAWAS` | `/dashboard` · UNIT_ADMIN | Pembina, Pengurus, Pengawas (UU 16/2001) — skill `tata-kelola-yayasan`. Lingkup seluruh yayasan. |
| Kepala sekolah | `*_KEPALA_SEKOLAH` | `/dashboard` · TEACHER | Kepala unit: menyusun RKA Unit, menandatangani naskah unit, atasan penilai PK guru. |
| Guru | `*_GURU`, `*_GURU_BK` | `/teacher` · TEACHER | Satu menu untuk semuanya. Grup Wali Kelas di menu itu tampil hanya bagi wali kelas sebuah kelas tahun ajaran berjalan (#579; `role-menus.ts` menandainya *only with the homeroom duty*). Wakasek dan wali kelas adalah tugas tambahan seorang guru, bukan kode peran (digabung ke `*_GURU` 2026-09-26); wali kelas = `Class.homeroomTeacherId` ([`peran-dan-tugas-tambahan`](../../memory/decisions/peran-dan-tugas-tambahan.md)). |
| Pimpinan Pesantren | `PESANTREN_PENGASUH` | `/teacher` · TEACHER | Kiai, kepala unit pesantren — skill `tata-kelola-yayasan`. |
| Pendidik pesantren | `USTADZ`, `MUSYRIF`, `MUHAFIDZ` | `/teacher` · TEACHER | Satu peran per tugas, bukan per jenis kelamin (musyrif = wali kamar + murabbi). |
| Staf | `*_TATA_USAHA`, `*_BENDAHARA`, `PESANTREN_TATA_USAHA`, `PUSTAKAWAN`, `PERAWAT`, `KEAMANAN`, `LABORAN`, `BUSINESS_*` | `/staff` · STAFF | **Satu menu bersama** untuk sembilan fungsi. Butir layanan di grup *Sarana & Layanan* (Perpustakaan, Inventaris, Kantin & Koperasi, Laundry, Unit Usaha) hanya tampil untuk peran yang menjalankannya. |
| Komite | `*_KOMITE` | `/reports` · STAFF | Komite sekolah: membaca, tidak mengelola. |
| Orang tua | `*_ORANG_TUA` | `/parent` · PARENT | Wali santri: data anaknya sendiri. |
| Siswa | `SDIT_SISWA`, `SMPIT_SISWA`, `SMAQ_SISWA` | `/student` · STUDENT | TK tidak punya peran siswa. |
| Alumni | `SMPIT_ALUMNI`, `SMAQ_ALUMNI` | `/alumni` · STUDENT | Direktori, dokumen, sanad, kontribusi. |

Kode peran yang tidak cocok dengan keluarga mana pun mendapat menu cadangan
(Dashboard, Notifications, Settings). Kalau menambah kode peran, tambahkan juga
kelompoknya di `roles.ts` (ada uji sinkron) dan keluarganya di `navigation.ts`.

## Menulis jalur menu (aturan emas 11)

1. Cetak menu **penugasan utama** orang itu dengan skrip di atas.
2. Tulis `Grup → Butir → Sub-butir` persis seperti yang tertera, dalam
   bahasanya, karena sebagian judul masih berbahasa Inggris ("Students",
   "Settings"). Contoh: *Kinerja → Manajemen Kinerja → Perjanjian Kinerja*.
3. Halaman yang dibuka dari header (avatar, kanan atas) ditulis begitu:
   *avatar → Settings → tab Akun → Tanda Tangan Elektronik*.
4. Kalau halaman itu tidak ada di menu perannya, **katakan itu**: "tidak ada di
   menu — buka `/…`". Catat sebagai celah di `known-issues.md`, jangan
   dikarang.
5. Sebutkan statusnya: di cabang, sudah di `main`, di staging, atau di
   produksi.

## "Bisakah peran X melakukan Y?" — empat lapis

Jawab "ya" hanya kalau keempatnya lolos. Sebutkan lapis mana yang menolak.

1. **Menu** — apakah butirnya ada (`role-menus.ts`)?
2. **Halaman** — apakah `canAccessRoute(bucket, path)` lolos (`rbac.ts`)?
3. **Rute API** — apakah `authorize(...)` di `*.routes.ts` menerima bucket-nya?
4. **Service dan data** — penjaga di service (siapa pemilik, tahap, unit) dan
   lingkup barisnya.

Contoh yang ditemukan dengan cara ini (2026-09-25): kepala sekolah dan RKA Unit
lolos lapis 3 dan 4 (`canAuthorUnitPlan` sengaja mengizinkannya), tetapi
**ditolak di lapis 2**, dan tautannya tidak ada di lapis 1. Uji e2e-nya tetap
hijau karena membuka halaman lewat URL. Diperbaiki dengan `roleCodeRouteAccess`
di `rbac.ts`: halaman tambahan per kode peran, di atas bucket, supaya halaman
dibuka untuk satu peran tanpa ikut terbuka bagi seluruh bucket.

**Lapis 4 bisa bergantung pada baris, bukan peran.** "Bisakah wali kelas
menyetujui izin?" tidak punya jawaban per peran sejak #568: izin santri
diputuskan musyrif santri itu (santri mukim; koordinator asrama bila ia
pulang atau menginap) atau wali kelasnya, jadi guru yang sama boleh untuk satu
anak dan 403 untuk anak lain. Jawab dengan menyebut
aturannya ([`pemutus-izin-santri`](../../memory/decisions/pemutus-izin-santri.md)),
dan di layar lihat baris "Diputuskan oleh …" pada izin itu. Pengumuman juga
begitu: guru menerbitkan hanya ke kelas yang ia ajar atau walikan, musyrif ke
santri mukim binaannya
([`siaran-pengumuman`](../../memory/decisions/siaran-pengumuman.md)); pilihan
yang ditawarkan ke seseorang terbaca di `GET /announcements/compose`.

Hal yang sama berlaku untuk **data perwalian** dan **absensi harian**
(#579, #580). Data perwalian sebuah kelas dibaca oleh wali kelasnya, serta
kepala sekolah dan admin unitnya; guru lain mendapat 404. Absensi harian
sebuah kelas dicatat oleh wali kelasnya, guru yang punya jadwal di kelas itu,
dan admin unit; kepala sekolah membaca. Untuk "bisakah guru X mengisi
absensi kelas Y", lihat `GET /attendance/me/classes` atas nama guru itu.

## Celah yang diketahui

Di `.claude/memory/known-issues.md` → "Access that is too narrow": halaman
"Roles & Permissions" mengedit daftar yang hampir tidak dibaca. Halamannya kini
mengatakan itu sendiri. Hapus baris ini begitu entrinya di `known-issues.md`
dihapus.

## Menulis panduan pengguna untuk staf

Panduan untuk *orang* disusun per tugas, bukan per menu:

- **Tujuan** — satu kalimat, dengan istilah kerja mereka ("mengajukan RKA
  unit", bukan "POST /perencanaan").
- **Siapa** — keluarga peran, dan unit bila relevan.
- **Jalur menu** — menurut aturan di atas.
- **Langkah** — yang benar-benar diklik; ambil dari aplikasi yang berjalan,
  bukan dari ingatan.
- **Hasilnya, dan giliran siapa berikutnya** — mis. "status menjadi
  *Menunggu Paraf*; giliran pemaraf pertama".

Tangkapan layar dibuat dengan skill `screenshot-roles`, dari akun demo di
stack lokal atau staging. Panduan untuk dibaca orang disimpan di `docs/`, atau
dibuat sebagai `.docx` kalau diminta. Jangan menyalin pohon menu lengkap ke
panduan, karena pohon itu berubah setiap ada PR menu. Tautkan tugasnya saja.

Alur yang melibatkan beberapa peran ada di skill domainnya:
`tata-kelola-yayasan` (perencanaan, pengesahan, PK) dan `naskah-dinas`
(persuratan dan TTE).
