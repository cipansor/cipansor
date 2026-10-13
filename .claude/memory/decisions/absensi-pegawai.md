# absensi-pegawai

> Keputusan pengguna 2026-09-29 — absensi pegawai: selfie + geotag saat masuk
> dan pulang; shift dan jam kerja diatur Super Admin dan Admin Unit; potongan
> diambil dari tunjangan, **tidak pernah** dari gaji pokok; batas dan dasar
> hitungnya punya pengaturan; cuti mengikuti UU Ketenagakerjaan.

Ini aturan untuk **pegawai** (guru, staf, pimpinan). Aturan untuk **santri**
berada di [`absensi-harian.md`](absensi-harian.md) — beda orang, beda aturan,
jangan disatukan.

## Aturannya

| Hal | Diputuskan | Status di kode (2026-09-29; PR #630, belum merge) |
|---|---|---|
| Bukti masuk/pulang | Selfie **dan** lokasi (geotag) — keduanya bisa diwajibkan atau tidak per unit lewat `AttendancePolicy`. **Mati sampai admin menyalakannya** (2026-10-09) | Unit tanpa baris kebijakan tidak mewajibkan apa pun, dan sejak 2026-10-09 itu disengaja dan terlihat: Pengaturan menandai "Belum diatur", halaman *Absen Saya* menyebut apa yang diwajibkan. Swafoto disimpan di `private/attendance`, tidak pernah di `public/uploads`; satu foto untuk satu absen, diambil pemanggil, paling lama 10 menit; dibuka satu per satu oleh pemiliknya atau admin unitnya, dan setiap pembukaan tercatat |
| Siapa yang diwajibkan | Pengaturan per unit: per **peran** atau per **orang** (`AttendanceExemption`); tanpa baris berarti wajib. **Semua pegawai bergaji** mendapat *Absen Saya* — guru, staf, kepala sekolah, musyrif, ustadz, muhafidz; **Pimpinan Pesantren dikecualikan bawaan** (baris pengecualian yang ditulis migrasi, bisa dihapus admin) (2026-10-09) | Ada; pengecualian berbasis peran selalu yayasan-wide — admin unit tidak bisa mengecualikan peran di unitnya |
| Jam kerja | `WorkWeekConfig` per unit: hari kerja, jam per hari, jam pulang Jumat — bukan Senin–Jumat hardcode | Ada; kalau barisnya belum ada, kode jatuh ke Senin–Sabtu 7 jam (tidak aman) |
| Shift | `WorkShift` + `ShiftAssignment` (per orang, rentang tanggal) + `ShiftRotation` (piket bergilir, `cycleDays`) | Ada |
| Shift lintas tengah malam | Ada (`crossesMidnight`); check-out hari berikutnya mencari baris masuk yang belum ditutup | Ada. `findOpenCheckInRow` mencari baris hari ini lalu baris kemarin yang belum ditutup untuk shift lintas tengah malam |
| Potongan | Dari **tunjangan**, bukan gaji pokok. Basis (`TUNJANGAN_KEHADIRAN`, kode komponen, `UPAH_SEHARI`, …), bentuk (`NOMINAL`/`PERSENTASE`/`PRORATA`/`PENGALI`/`BERTINGKAT`/`FORMULA`), batas per hari/bulan, dasar hukum — semuanya baris `PayrollPolicyRule` | Mesin ada; `classification === 'POKOK'` (atau kode literal) menentukan gaji pokok, dan cap tunjangan bersih dari potongan yang sudah ada |
| Batas potongan | `PayrollGuardConfig`: maks % potongan, min % gaji pokok yang harus tetap utuh, dan UMK. **Batasnya ditegakkan, bukan sekadar peringatan.** 50% (PP 36/2021 Ps. 65) adalah plafon keras: skema menolak lebih, mesin memotong lebih, dan unit tanpa baris pun mendapatnya | Cap tunjangan ditegakkan (`deductionCapFor`); breach gaji pokok memblokir dengan alasan override — benar |
| Cuti tahunan | Per **tahun kalender**, jatah dari `LeaveTypeConfig` (bukan 12 hari hardcode) | Ada. `annualQuota` dari `LeaveTypeConfig.entitlementDays`, 12 hanya sebagai jalan terakhir |
| Cuti melahirkan/ayah/menikah/kematian | `LeaveTypeConfig` per tipe: jatah, dibayar atau tidak, wajib dokumen atau tidak | Model + endpoint ada; **tanpa UI** (`/hr/leave-type-configs` yatim) |
| Libur nasional | Diambil dari API publik lalu **disimpan** ke kalender; sumber dan URL-nya pengaturan, bukan kode | Ada. Hasil tarikan masuk sebagai **draf** (`isDraft`), diabaikan absensi/payroll sampai disetujui admin; impor dan tinjauan dibatasi unit pemanggil |
| Koreksi absensi | Hanya Super Admin dan Admin Unit, **wajib alasan**, **berjejak audit** | Sebagian. `reason` wajib dan `AuditLog` ditulis; **belum ada UI koreksi**, dan `delete` masih hard delete |
| Retensi selfie | **1 tahun** (default), diatur per unit; job retensi benar-benar berjalan | Ada. Job harian; satu nomor dari `AttendancePolicy` lalu `RetentionPolicy`; satu foto untuk satu absen, dihapus dari `private/attendance` lalu rujukannya dikosongkan; foto yang tak pernah dipakai disapu sesudah sehari; baris yang masih tertaut cuti APPROVED dipertahankan |
| Foto dari galeri | Swafoto diambil langsung dari kamera. Memilih berkas hanya muncul bila kamera tidak dapat dibuka, dan absen itu ditandai **FILE** untuk ditinjau admin unit (2026-10-09) | Dibangun 2026-10-09 |
| Retensi catatan absen | **Paling singkat 10 tahun** — catatan ini dasar penggajian (UU KUP Ps. 28 ayat 11) | Skema menolak di bawahnya; job retensi tidak pernah menghapus lebih muda dari itu (2026-10-09) |
| Dasar pemrosesan swafoto & lokasi | **Perjanjian kerja + kepentingan sah** (UU PDP Ps. 20 ayat 2 huruf b dan f), dengan pemberitahuan privasi pegawai yang ditandai "sudah membaca" per versi; keberatan dicatat admin unit; **tidak** logout (D1, 2026-10-09 — menggantikan "persetujuan, menolak = logout" untuk pegawai). Lihat [`persetujuan-pengguna.md`](persetujuan-pengguna.md) | Pemberitahuan **belum** dibangun; karena itu swafoto dan lokasi tetap mati sampai ada |

## Standar praktik (diriset 2026-09-29, jangan diulang)

| Hal | Standar | Sumber |
|---|---|---|
| Cara mencatat | **Exception-based recording** — yang dicatat adalah penyimpangan (alpa/terlambat/lembur), sisanya dianggap hadir; bukan semua orang diketik tiap hari | Ecotime, SutiSoft, HiveDesk |
| Shift lintas tengah malam | Hari kerja dihitung dari **jam mulai**; pasangan clock-in/clock-out **tidak boleh terpotong tengah malam** — satu baris, bukan dua potongan | NGTECO, TrackLabs, Open Time Clock, SAP SuccessFactors |
| Luar zona | Wajib ada **antrean peninjauan manajer**; absen di luar zona ditinjau, bukan otomatis tidak dibayar | Cogniver, Trackobit |
| Anti-kecurangan | Berlapis, bukan satu: deteksi **mock location**, pengikatan perangkat (device binding), plausibilitas gerak; selfie = pencegah praktis | Optatech, MiHCM, Trackobit |
| Mode offline | Absen disimpan lokal dengan **timestamp asli**, disinkron saat jaringan kembali | TimeClock365, AttendancePay |
| Edit & persetujuan | **Segregation of duties**: pengedit timesheet ≠ penyetuju; edit retroaktif lewat persetujuan supervisor dan tercatat (nilai lama/baru, aktor, waktu) | PwC timekeeping audit, ZenGRC, Timesheets.com |
| Pembulatan & toleransi | Boleh membulatkan ke 5/6/15 menit **hanya bila netral**; bila tidak netral, bulatkan ke pihak pekerja; tren 2026: bayar per menit | FLSA 29 CFR 785.48(b), Workforce.com, TimeTrex |

## Yang diminta pengguna (kata-katanya)

1. "Buat pengaturannya saja di super admin dan admin unit agar fleksibel bisa
   diatur atur dari apa saja dan batasannya berapa." → `PayrollPolicyRule` +
   `PayrollGuardConfig` dengan editor lengkap, tanpa nilai hardcode.
2. "Jam kerja dibuat pengaturannya saja di super admin dan admin unit agar
   fleksibel." → `WorkWeekConfig` per unit.
3. "Ya ada [pegawai shift malam]." → shift lintas tengah malam harus jalan.
4. "Buat pengaturannya saja di super admin dan admin unit agar fleksibel."
   (cuti) → `LeaveTypeConfig`.
5. "Coba apa ada tidak API publik untuk mendapatkan libur nasional resmi
   Indonesia." → ada; riset di bawah.
6. "Buat pengaturannya saja … siapa saja [yang diwajibkan selfie], kalau
   menurut saya bagaimana kalau disimpan selama 1 tahun? Untuk consent tertulis
   … halaman awal setelah login … wajib disetujui, kalau menolak maka logout."
7. "Yang boleh mengubah absensi yang sudah tercatat hanya super admin atau
   admin unit, wajib ada alasan + jejak audit."

## Libur nasional — riset 2026-09-29

Tidak ada API pemerintah resmi. Yang ada, dari yang paling layak dipakai:

| Sumber | Bentuk | Catatan |
|---|---|---|
| `https://api-hari-libur.vercel.app/api?year=2026` | JSON, tanpa kunci | [andifahruddinakas/api-hari-libur](https://github.com/andifahruddinakas/api-hari-libur) — di-scrape dari tanggalan.com, diperbarui tiap tanggal 1. Dipakai modul Odoo publik sebagai sumber utama |
| `https://api.kemendesa.link/libur-nasional` | HTML (halaman Next.js), bukan API JSON | Sumber data: SKB 3 Menteri. **Jangan** di-scrape |
| `api-harilibur` (kresnasatya) | JSON | Sudah tidak dirawat, domain berganti-ganti |

**Keputusan:** pakai `api-hari-libur.vercel.app` sebagai **nilai default** URL
sumber, disimpan di pengaturan (`Setting` key `holiday.source_url`) sehingga
Super Admin bisa menggantinya tanpa deploy. Karena sumbernya pihak ketiga,
hasil tarikan **disimpan dulu sebagai draf** di kalender untuk ditinjau admin,
dan bila API mati, kalender yang sudah tersimpan tetap dipakai. Libur nasional
dan cuti bersama **tidak boleh** menghasilkan potongan `ABSENT`.

## Dasarnya (diriset 2026-09-29, jangan diulang)

> **Koreksi 2026-09-29.** Versi pertama bagian ini menulis "PP 36/2021 Ps. 32"
> untuk batas potongan dan menyebut "1/173 upah sebulan" untuk lembur tanpa
> PP-nya. Keduanya keliru dan sudah dibetulkan di bawah. Komentar di
> `apps/api/src/modules/payroll/attendance-deduction.service.ts` masih memuat
> kutipan yang salah itu; betulkan bersama implementasinya.

- **Pemotongan upah.** UU 13/2003 Ps. 95: pemotongan hanya karena permintaan
  tertulis pekerja, kewajiban hukum, atau putusan. **PP 36/2021** Ps. 58–65:
  jenis potongan yang sah (Ps. 63 — denda, ganti rugi, uang muka, sewa, utang,
  kelebihan bayar), **batas total 50% tiap pembayaran upah (Ps. 65)**, dan
  denda hanya sah bila jenis pelanggaran, besarannya, dan penggunaan dananya
  tertulis di PK/Peraturan Perusahaan/PKB (Ps. 59–60). Karena itu potongan
  harus tetap di sisi tunjangan, batasnya ditegakkan mesin, dan tiap aturan
  potongan wajib punya dasar hukum tertulis.
- **Upah lembur (PP 35/2021).** Ps. 26: paling lama 4 jam/hari, 18 jam/minggu.
  Ps. 31: 1,5× upah sejam untuk jam pertama, 2× untuk jam berikutnya. **Ps. 32:
  upah sejam = 1/173 × upah sebulan**, dasar 100% bila upah = pokok + tunjangan
  tetap, atau 75% total bila pokok + tunjangan tetap < 75% total. Wajib ada
  perintah dan persetujuan lembur. **Konsekuensi:** menghitung 1/173 dari
  *tunjangan saja* — yang dilakukan kode sekarang — membayar lembur di bawah
  ketentuan. Dasar lembur tidak boleh dikarang; ini berbeda dari dasar
  potongan, yang boleh lebih ketat dari hukum.
- **Cuti tahunan.** UU 13/2003 Ps. 79 (jo. UU 6/2023): **paling sedikit 12 hari
  kerja** setelah 12 bulan terus-menerus. 12 adalah lantai, bukan angka bebas:
  `LeaveTypeConfig` boleh menaikkannya, tidak menurunkannya.
- **Cuti melahirkan** UU 13/2003 Ps. 82 (3 bulan); cuti ayah, menikah,
  kematian menurut kebiasaan/persetujuan — jadi `LeaveTypeConfig`, bukan enum
  mati.
- **PDP (UU 27/2022).** Selfie dan koordinat adalah **data pribadi spesifik**
  (Ps. 4). Wajib persetujuan eksplisit tertulis/terekam (Ps. 20, 22) dan
  pengendali **wajib membuktikan** persetujuan itu (Ps. 24); hak akses (Ps. 7),
  hapus (Ps. 8, 43), tarik persetujuan → hentikan pemrosesan ≤ 3×24 jam
  (Ps. 40); **wajib mengakhiri pemrosesan saat masa retensi tercapai**
  (Ps. 42(1)a); dan **DPIA** untuk data spesifik, pemantauan sistematis, atau
  skala besar (Ps. 34). Karena itu consent wajib, retensi foto default 1 tahun,
  dan job retensi bukan pilihan.
  **Dikoreksi 2026-10-09 (D1):** untuk pegawai, dasarnya bukan persetujuan,
  melainkan perjanjian kerja + kepentingan sah (Ps. 20 ayat 2 huruf b dan f),
  dengan pemberitahuan yang dibaca per versi — lihat tabel keputusan di bawah.

## Yang sudah ada dan yang belum

Dibangun di `apps/api/src/modules/hr` (absensi pegawai) dan
`apps/api/src/modules/payroll` (potongan): model `StaffAttendance`,
`AttendanceRecord`, `AttendanceSite`, `WorkShift`, `ShiftAssignment`,
`ShiftRotation`, `WorkWeekConfig`, `AttendancePolicy`, `AttendanceExemption`,
`PayrollPolicyRule`, `PayrollGuardConfig`, `RetentionPolicy`, `LeaveTypeConfig`;
halaman *Kepegawaian → Absensi Pegawai*, *Absen Saya*, dan *Pengaturan Absensi*.

Cacat yang masih terbuka sesudah audit kedua (2026-10-09) ada di
[`../known-issues.md`](../known-issues.md); urutan pengerjaannya di
[`../roadmap.md`](../roadmap.md). Keputusan di atas tetap mengikat; status tiap
butir ada di kolom ketiga tabel pertama.

## Keputusan 2026-10-09 (pilihan ganda, sesudah riset)

| Soal | Diputuskan | Alasan dan sumber |
|---|---|---|
| D1 — dasar pemrosesan swafoto dan lokasi pegawai | Perjanjian kerja + kepentingan sah, dengan pemberitahuan per versi; keberatan dicatat admin unit; tanpa logout | UU PDP Ps. 20 ayat 2 menyediakan dasar selain persetujuan; persetujuan pegawai kepada pemberi kerja tidak bebas (relasi kuasa), dan "menolak = logout" menghalangi orang bekerja. Citra wajah adalah data spesifik (Ps. 4) → DPIA (Ps. 34) |
| Unit yang belum mengatur kebijakan | Swafoto dan lokasi **mati** sampai admin menyalakan, sesudah pemberitahuan privasi terbit; layar menandai "belum diatur" | Data spesifik tidak dikumpulkan sebelum pemberitahuannya ada; kegagalan-terbuka yang diam-diam diganti keadaan yang terlihat |
| Foto dari galeri | Kamera langsung; galeri hanya bila kamera tak tersedia, ditandai FILE untuk ditinjau | Foto galeri tidak membuktikan kehadiran hari itu; tanpa uji *liveness*, swafoto adalah pencegah, bukan bukti (Regula, *Liveness Detection*) |
| Siapa memakai *Absen Saya* | Semua pegawai bergaji; Pimpinan Pesantren dikecualikan bawaan | Prinsip PR ini sendiri ("setiap pegawai absen untuk dirinya"); pengecualian adalah pengaturan, bukan menu yang hilang |

Lokasi dari peramban **tidak dapat** dibedakan dari lokasi palsu (hanya
aplikasi native yang punya `isMock`); karena itu "di luar lokasi" adalah bahan
tinjauan, dan REJECT hanya menolak posisi yang tetap di luar setelah
ketelitian GPS diperhitungkan.
