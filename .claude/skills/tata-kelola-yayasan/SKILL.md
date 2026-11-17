---
name: tata-kelola-yayasan
description: Tata kelola Yayasan Pesantren Cipansor di aplikasi — organ yayasan (Pembina, Pengurus, Pengawas) menurut UU 16/2001, kepala unit dan Kiai, rantai perencanaan RPJP → Renstra → RKA Yayasan → RKA Unit beserta alur pengesahannya, Perjanjian Kinerja (PK) dan atasan penilai, serta aturan rangkap jabatan. Use when touching the perencanaan or performance-management (kinerja/PK) modules, the yayasan roles or unit heads, a ratification or approval flow, or when asked who drafts, reviews, ratifies or evaluates what — and before proposing any change to that chain, because most of it is a settled decision.
---

# Tata kelola yayasan

Sebagian besar isi skill ini adalah **keputusan pengguna yang sudah diriset**.
Rinciannya, lengkap dengan dasar hukum, ada di `.claude/memory/decisions/`.
Jangan mengusulkan ulang tanpa alasan baru. Skill ini peta yang menyatukannya
dan menunjuk ke kodenya.

## Struktur

| Organ / jabatan | Kode peran | Perannya di aplikasi |
|---|---|---|
| **Pembina** | `YAYASAN_PEMBINA` | Menetapkan atau mengembalikan RPJP, Renstra, dan RKA Yayasan (UU 16/2001 Ps. 28 ayat 2 huruf c–d). Tidak menyusun, dan tidak punya PK. |
| **Pengurus** — Ketua, Sekretaris, Bendahara, Anggota | `YAYASAN_KETUA`, `_SEKRETARIS`, `_BENDAHARA`, `_ANGGOTA` (`PENGURUS_ROLE_CODES`) | Menyusun dokumen yayasan (Ps. 31). **Ketua** mengajukan dan meneruskannya atas nama Pengurus, mengesahkan RKA Unit, dan menjadi atasan penilai kepala unit. Tanggung jawabnya kolektif, jadi tidak ada PK: kontraknya adalah RKA Yayasan. |
| **Pengawas** | `YAYASAN_PENGAWAS` | Mereviu, tidak memveto (Ps. 40 ayat 1). Tidak punya PK, dan tidak menjadi atasan penilai. |
| Kepala unit | `*_KEPALA_SEKOLAH` | Menyusun RKA Unit (bersama admin unit). PK-nya menginduk RKA Unit yang sudah disahkan. |
| Pimpinan Pesantren (Kiai) | `PESANTREN_PENGASUH` | Kepala unit pesantren, dan juga Pembina (dua penugasan). Tidak ada Direktur Pesantren. |
| Super Admin | `SUPER_ADMIN` | Menyusun dokumen boleh, tetapi **tidak** mengajukan, mereviu, atau menetapkan dokumen yayasan. Ia pengelola sistem, bukan organ. |

**Rangkap jabatan.** Melintasi organ dilarang: Pembina, Pengurus, dan Pengawas
tidak boleh saling merangkap (UU 16/2001 Ps. 29). Pengecekannya di
`findOrganConflict` (`apps/api/src/utils/role-eligibility.ts`), dipanggil saat
peran diberikan. Rangkap *di dalam* satu organ boleh, mis. Ketua sekaligus
Bendahara. Kiai boleh sekaligus Pembina, karena pimpinan pesantren adalah
pelaksana (Ps. 35 ayat 3), bukan organ. Sebagai Pembina, ia tidak mengesahkan
dokumen unit pesantrennya sendiri.

**Unit.** TK Qur'an, SD IT, SMP IT, SMA Qur'an. Unit adalah yang menerbitkan
kelulusannya sendiri, jadi **asrama bukan unit**. Takhosus akan menjadi unit
kelima (`UnitType.PESANTREN`), tetapi **belum dibangun**. Sampai itu ada,
semua peran pesantren ditugaskan di unit SMP IT.

## Rantai perencanaan

```
RPJP            20 th   unitId null     disusun Pengurus · ditetapkan Pembina
└─ Renstra       5 th   unitId null     sama
   └─ RKA Yayasan 1 th  unitId null     sama — satu yang aktif per tahun (konsolidasi)
      └─ RKA Unit 1 th  unitId terisi   disusun kepala sekolah / admin unit · disahkan Ketua
```

Empat tingkat, **bukan tiga**. Jangan usulkan RKA unit langsung di bawah
Renstra. Alasannya di `decisions/rka-dua-tingkat.md`.

**Pengesahan dokumen yayasan** (RPJP, Renstra, RKA Yayasan). Tahapnya ada di
kolom `review_stage` (`PlanReviewStage`), bukan di status:

```
Ketua ajukan ──► DIREVIU_PENGAWAS ──► HASIL_REVIU ──► DIAJUKAN_PEMBINA ──► DITETAPKAN
 /review/submit    Pengawas: /review/result   Ketua: /review/propose   Pembina: /review/decide
                                                                            └─► DIKEMBALIKAN
```

- Setiap langkah adalah *compare-and-set* atomik ditambah satu baris
  `plan_review_events` yang hanya bertambah. Kalau dua tab menekan bersamaan,
  satu menang.
- Selama di tangan Pengawas atau Pembina, dokumen **terkunci**.
- **Yang sudah disahkan beku.** Hanya DRAFT yang boleh dihapus, karena
  menghapus ikut menghapus riwayat pengesahannya.
- Setiap langkah memeriksa **kode peran** pelakunya (`requireOrgan`): Ketua
  atas nama Pengurus, lalu Pengawas, lalu Pembina. Karena itu Super Admin
  tidak bisa menjalankan satu langkah pun.
- RKA Unit tidak lewat tahap-tahap ini: Ketua mengesahkannya dengan satu
  tombol (`/approve`, hanya `YAYASAN_KETUA`), dan `/approve` menolak semua
  dokumen yayasan.
- Kontrak keempat langkah ada di `@cipansor/shared` (`schemas/planning.ts`).

**Siapa boleh menyusun** (`perencanaan.controller.ts`): `canAuthorFoundationPlan`
mengizinkan Super Admin dan Pengurus, tidak Pembina dan tidak Pengawas.
`canAuthorUnitPlan` mengizinkan kepala sekolah dan admin unit itu, plus
Pengurus dan Super Admin. Guru dan staf ikut sebagai *kolaborator* yang
diundang ke draf. Membaca: dokumen yayasan terbaca siapa pun yang lolos rute (semua
bucket kecuali siswa dan orang tua); dokumen unit terbaca oleh unitnya dan
oleh peran yang melihat semua unit (`seesAll`).

## Perjanjian Kinerja (PK)

- **Organ yayasan tidak membuat PK** (`ORGAN_TANPA_PK` di `pk.service.ts`).
  Kalau muncul ide "PK yayasan": dokumen itu sudah ada, namanya RKA Yayasan.
- **PK menginduk dokumen, bukan PK atasan**, bila atasannya organ. Kepala unit
  → Ketua: PK wajib menyebut `strategicPlanId` berupa **RKA** milik **unitnya
  sendiri** yang sudah **disahkan** (APPROVED/IN_PROGRESS). Pegawai yayasan
  menginduk RKA Yayasan.
- PK bawahan biasa (guru → kepala sekolah) menuntut atasan sudah punya PK yang
  disetujui untuk periode yang sama.
- **Atasan penilai** (#553): bukan pemilik PK sendiri, dan harus memegang
  peran aktif di `SUPERVISOR_CANDIDATE_ROLE_CODES`: pegawai
  (`performance-management/staff-roles.ts`), tanpa Pembina dan Pengawas. Daftar calonnya memberi *usulan*: kepala unit → Ketua;
  guru/staf → kepala sekolah unitnya. Usulan, bukan paksaan.
- **Aturan akar rantai.** Setiap penjaga yang menuntut prasyarat harus
  menjawab: apa yang memenuhinya untuk elemen *pertama*? Kalau jawabannya
  "elemen sebelumnya", tidak ada PK yang bisa dibuat. Pernah terjadi (#415),
  lihat `.claude/memory/lessons/guard-tests-that-measure-the-wrong-thing.md`.

## Di aplikasi

| Tugas | Halaman | Jalur menu (2026-09-25) |
|---|---|---|
| Menyusun, mengajukan, mereviu, dan menetapkan rencana | `/perencanaan`, `/perencanaan/[id]` | *Perencanaan & Kinerja → Perencanaan Strategis*: Super Admin, admin unit, organ yayasan, dan kepala sekolah (sejak 2026-09-25; sebelumnya organ hanya lewat URL dan kepala sekolah ditolak web). Kiai mencapainya lewat penugasan Pembina-nya. |
| Peta strategi | `/perencanaan/strategy-map` | di bawah Perencanaan Strategis |
| PK dan evaluasinya | `/kinerja/pk`, `/kinerja/evaluasi` | *Kinerja → Manajemen Kinerja → Perjanjian Kinerja* (organ, kepala sekolah, guru, staf); *Perencanaan & Kinerja → …* (admin) |

Cetak menu sebuah peran dengan skill `panduan-peran` sebelum menulis jalur
menu. Tabel ini ikut basi setiap kali menu berubah.

## Kode

- Perencanaan: `apps/api/src/modules/perencanaan/` (controller: gerbang baca
  dan tulis; service: aturan induk dan keunikan), web `apps/web/src/app/perencanaan/`.
- PK: `apps/api/src/modules/performance-management/pk.service.ts`, web `apps/web/src/app/kinerja/`.
- Peran dan rangkap: `packages/shared/src/roles.ts`, `apps/api/src/utils/role-eligibility.ts`.
- Uji alur: `apps/web/e2e/perencanaan-pengesahan.spec.ts` (membuka lewat URL,
  jadi celah menu tidak tertangkap di sana).

## Belum dimodelkan

- Keputusan Pembina sebagai keputusan **rapat**. Sekarang satu akun Pembina
  yang menekan tombol.
- Aturan per kolom untuk rencana yang sedang berjalan: kepala rencana
  IN_PROGRESS masih bisa diubah penyusunnya.
- Pengurus yang digaji (pengecualian Ps. 5 UU 28/2004), yang mungkin perlu PK.
- Unit pesantren (takhosus).

## Keputusan yang mengikat

`.claude/memory/decisions/`:
- `pengesahan-dokumen-yayasan.md` — alur dan dasar hukum;
- `rka-dua-tingkat.md` — empat tingkat;
- `pk-organ-yayasan-tanpa-kontrak.md` — organ tanpa PK;
- `pimpinan-pesantren-kiai.md` — Kiai, tanpa Direktur;
- `unit-vs-asrama-vs-takhosus.md` — apa itu unit;
- `struktur-organisasi-dan-identitas.md` — unit Pesantren, satu pohon organisasi maks 3 tingkat, jabatan terpisah dari pemegangnya, OU/grup Google;
- `pengawasan-dan-rapat-pembina.md` — pemberhentian sementara Pengurus (Ps. 43), WBS, keputusan rapat Pembina;
- `izin-tulis-organ-yayasan.md` — asas tulis organ: organ yayasan menulis hanya lewat alur kewenangannya (#991); Sekretaris Pengurus kehilangan `STUDENT_UPDATE` (#1020).

Pasal-pasal Anggaran Dasar yayasan yang dibaca sistem — kuorum rapat tiap organ, siapa bertindak untuk organ (Ketua Umum **bersama** satu Pengurus lain), pemberhentian sementara, laporan tahunan — ada di [`anggaran-dasar.md`](anggaran-dasar.md) (akta pendirian 2012; akta perubahan belum diketahui).

Keputusan baru di domain ini disimpan sebagai berkas di `decisions/` dan
didaftarkan di sini.
