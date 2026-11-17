# struktur-organisasi-dan-identitas

> Keputusan pengguna 2026-09-29, sesudah audit realm/group/sub group/unit organisasi — unit Pesantren dibuat (rumah Kiai, musyrif, ustadz, muhafidz, TU Pesantren, santri takhosus-only); satu pohon organisasi maks 3 tingkat (Yayasan → Unit → Bidang) dengan jabatan terpisah dari pemegangnya; Model A bertahap tetapi menyeluruh, dijaga uji "baseline hanya boleh menyusut"; Google Workspace: OU per kebijakan, grup diturunkan otomatis dari Cipansor; jalur identitas Cipansor → Google → Microsoft ditegaskan ulang dengan riset.

**Pertanyaan pengguna:** apakah pengaturan, implementasi, penggunaan, dan
pembagian realm, group, sub group, unit organisasi, dan lainnya sudah sesuai
best practice — dan selaras dengan akun Google Workspace for Nonprofits dan
Microsoft for Nonprofits yayasan.

## Yang diukur (2026-09-29, `main`)

- **53 kode peran; 35 di antaranya salinan per unit dari 10 fungsi** (ADMIN,
  GURU, KEPALA_SEKOLAH, TATA_USAHA, BENDAHARA, ORANG_TUA, KOMITE ×4; SISWA ×3;
  GURU_BK, ALUMNI ×2), tertulis sebagai 357 literal di 27 berkas non-uji
  (`navigation.ts`, `rbac.ts`, rute unit usaha, akun demo, layanan auth, …).
- **`Realm` mengulang `UnitType`.** Jenis unit tertulis di empat tempat (enum
  `Realm`, `UnitType`, awalan kode peran, label realm di web), dan
  `roles.service` menebak realm dari awalan kode.
- **Empat struktur untuk satu konsep:** `Unit`; `Department` (tiga baris, tak
  seorang pun tertaut); `OrgUnit` + `OrgPosition` (seed berisi "Direktorat
  Pendidikan"/"Direktur Pendidikan", padahal tidak ada Direktur —
  [`pimpinan-pesantren-kiai`](pimpinan-pesantren-kiai.md)); `BusinessUnit`
  (kantin dan laundry tercatat di bawah SMP IT, padahal `Realm` dan `UnitType`
  juga punya `UNIT_USAHA`). Jabatan juga teks bebas di `Staff.position`.
- **Tidak ada unit Pesantren.** Seed hanya membuat TK, SD, SMP, SMA; Kiai,
  musyrif, ustadz, muhafidz, dan TU Pesantren ditugaskan ke SMP IT.
- **Lingkup unit diputuskan lima cara:** `req.user.unitId` langsung (158),
  `seesAllUnits` (82), `resolveUnitId` (41), `listUnitScope`/`assertReachesUnit`/
  `writeUnitScope` (36), `isFoundationScopedRole` (10). Sekitar 35 daftar peran
  hidup di luar `@cipansor/shared`, sebagian kembar (`LEADERSHIP_ROLES` ≈
  `SECOND_FACTOR_ROLE_CODES`).
- **Otorisasi tiga lapis:** 468 panggilan `authorize()` memakai ember lama
  `UserRole`, 91 memakai kode peran atau daftar, 18 membaca tabel izin.
- **Yang sudah benar:** penugasan (`UserRoleAssignment`: orang + peran + unit +
  utama + aktif + kedaluwarsa) sama dengan pola *Membership* W3C ORG dan
  `roles` (peran, org) OneRoster; satu yayasan = satu tenant (tak perlu realm
  per tenant); satu kepala per unit, tak ada pengguna dengan dua peran utama.

## Keputusannya

1. **Unit Pesantren dibuat** (`UnitType.PESANTREN`, nilai yang sudah ada):
   rumah Kiai sebagai kepalanya, musyrif, ustadz, muhafidz, TU Pesantren, dan
   santri takhosus-only. Menjalankan dua keputusan yang sudah ada
   ([`unit-vs-asrama-vs-takhosus`](unit-vs-asrama-vs-takhosus.md): takhosus =
   unit PESANTREN; [`pimpinan-pesantren-kiai`](pimpinan-pesantren-kiai.md):
   Kiai = kepala unit). Pesantren sebagai badan penyelenggara (NSPP) tetap
   `Foundation`; asrama tetap bukan unit. Migrasi data diuji dulu di salinan
   produksi.
2. **Satu pohon organisasi, paling dalam tiga tingkat:** Yayasan → Unit →
   Bidang (Kurikulum, Kesiswaan, TU, Keuangan, …). Bidang dibuat hanya bila
   sungguh dipakai. `Department` dan `OrgUnit` digabung menjadi satu.
   **Jabatan (posisi) terpisah dari pemegangnya**, dengan masa jabatan — pola
   *Post* + *Membership* W3C ORG. "Direktur" dihapus dari seed. Unit usaha
   menjadi simpul di pohon yang sama, tidak menumpang di SMP IT.
3. **Model A bertahap, tetapi menyeluruh — tak ada yang boleh terlewat.**
   Satu fungsi per PR: Bendahara dulu (satu peran berlingkup unit, diputuskan
   2026-09-25), lalu Guru, Kepala Sekolah, Admin, TU, Komite,
   Orang Tua, Siswa, Guru BK, Alumni. Lingkup unit menjadi satu pintu yang
   membaca pohon organisasi; semua daftar peran pindah ke `@cipansor/shared`;
   `Realm` dihapus paling akhir. **Kelengkapannya dijaga uji penjaga dengan
   baseline yang hanya boleh menyusut** (pola
   `web-api-contract.guard.test.ts`): literal kode per unit, pemakaian ember
   `UserRole`, daftar peran di luar shared, dan pembacaan lingkup di luar
   pintu tunggal. Selesai berarti baseline itu nol.
4. **Google Workspace: OU per kebijakan, grup otomatis.** Tiap orang di tepat
   satu OU menurut aturan yang berlaku baginya — `/Staf`, `/Santri SMA`,
   `/Santri SMP` (terbatas), `/Akun Darurat` — bukan cermin pohon unit. Grup
   (mis. guru per unit, per kelas) dibuat dan diperbarui otomatis dari
   penugasan dan relasi di Cipansor, tidak diurus tangan.
5. **Jalur identitas Cipansor → Google → Microsoft tetap** (keputusan
   2026-09-23, ditegaskan ulang dengan riset di bawah). Bila kelak butuh grup
   atau Teams per unit di Microsoft 365, Cipansor menulis langsung lewat
   Microsoft Graph untuk grup saja.

## Dasarnya (diriset 2026-09-29, jangan diulang)

- **Sistem HR/data induk adalah sumber kebenaran** siklus masuk–pindah–keluar;
  direktori dan aplikasi menerima darinya (Microsoft Learn, *Plan cloud HR
  application to Microsoft Entra user provisioning*; *What is HR-driven
  provisioning*). SPMB, staf, dan santri lahir di Cipansor, jadi Cipansor
  pertama.
- **Microsoft di tengah tidak gratis.** Hibah Business Premium (termasuk Entra
  ID P1) dihentikan 1 Juli 2025; yang gratis tinggal Business Basic sampai 300
  (pengumuman Microsoft Tech Community, *Business Premium & Office 365 E1 grant
  discontinuation*). Entra ID Free: SSO tak terbatas, grup, MFA — tetapi
  provisioning otomatis ke aplikasi lain (termasuk Google), provisioning masuk
  dari sistem HR/API, grup dinamis, dan Conditional Access butuh P1 (halaman
  harga Microsoft Entra; *API-driven inbound provisioning concepts*). Santri
  tidak boleh memegang lisensi nonprofit, jadi akun santri tak bisa lewat
  Entra secara sah.
- **Arah sinkronisasi:** Google → Microsoft 365 hanya pengguna, bukan
  keanggotaan grup (Google Admin Help 7365072); Entra → Google membawa
  pengguna, grup, keanggotaan, dan OU tetapi butuh P1 (Microsoft Learn,
  *Configure Google Workspace for automatic user provisioning*).
- **Google Workspace:** satu pengguna di satu OU, kebijakan diwariskan; grup
  untuk akses dan komunikasi, boleh banyak; buat OU hanya bila kebijakannya
  berbeda, 2–3 tingkat cukup (Google Admin Help 4352075).
- **Keycloak:** realm = batas isolasi identitas antar-tenant; grup berjenjang,
  subgrup mewarisi role mapping induknya (Red Hat build of Keycloak, *Server
  Administration Guide*, bab 7).
- **Entra:** peran = izin × lingkup (administrative unit) × waktu; *least
  privilege*; MFA untuk semua admin; tinjau akses berkala (Microsoft Learn,
  *Best practices for Microsoft Entra roles*).
- **W3C ORG** (Organization Ontology): `OrganizationalUnit` bermakna hanya di
  dalam induknya; `Post` = jabatan lepas dari orangnya; `Membership` = agen +
  organisasi + peran + masa (`memberDuring`).
- **NIST RBAC** (INCITS 359-2012, R2022): core, hierarki, pemisahan tugas
  statis dan dinamis. **RBAC saja** berujung "ledakan peran"; hubungan
  (wali kelas–kelas, musyrif–santri) lebih tepat dimodelkan sebagai relasi
  (ReBAC), seperti yang sudah dilakukan pemutus izin santri.
- **1EdTech OneRoster 1.2:** org berjenjang (parent/children), pengguna punya
  banyak (peran, org).
- **Dapodik:** satu kepala sekolah per satuan pendidikan; tugas tambahan hanya
  diakui di satuan induk PTK.
- **belajar.id** (Kemendikdasmen): akun Google Workspace for Education untuk
  guru dan siswa Dapodik; sejak 13 April 2026 sebagian akun diturunkan ke
  "Gmail Only"/"SSO Only". Dikelola pemerintah, bukan yayasan — pelengkap,
  bukan tulang punggung identitas.
- **Microsoft Entra External ID** gratis untuk 50.000 pengguna aktif bulanan
  pertama — pilihan untuk identitas eksternal (wali, pendaftar SPMB), bukan
  staf (Microsoft Learn, *External ID pricing*).
