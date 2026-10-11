# Panduan Pengguna — cara menyusun

Kerangka: Diátaxis (tutorial · panduan tugas · rujukan · penjelasan) dengan
daftar periksa mutu ISO/IEC/IEEE 26514:2022 (edisi ketiga, berlaku 2026) dan
IEC/IEEE 82079-1:2019 (acuan normatif 26514 untuk *information for use*).
Alasannya di `standar-dan-alasan.md`.
Templatnya: `assets/template-panduan.md` (bagian umum + buklet peran) dan
`assets/template-kartu-tugas.md`.

Repo sudah punya aturan penulisan panduan di skill `panduan-peran` (bagian
*Menulis panduan pengguna untuk staf*). Skill ini **memakai aturan itu**, tidak
menggantikannya. Bila `.claude/skills/panduan-peran/SKILL.md` ada di repo yang
di-clone, baca dulu.

## Bentuk terbitan

Jangan menulis satu buku raksasa untuk semua peran. Terbitkan sebagai:

1. **Panduan Pengguna — Bagian Umum** (semua peran): tentang panduan, mulai
   memakai aplikasi, konsep dasar, glosarium, bantuan.
2. **Buklet per keluarga peran**, masing-masing berdiri sendiri: Guru, Wali
   Kelas & tugas tambahan, Tata Usaha, Bendahara, Admin Unit, Kepala Sekolah,
   Pendidik Pesantren (musyrif, muhafidz, ustadz), Organ Yayasan, Wali Santri,
   Santri/Siswa, Alumni, Komite, Super Admin.

Keluarga peran yang berlaku *hari ini* dibaca dari kode (skill `panduan-peran`
dan `role-menus.ts --families`), bukan dari daftar di atas — daftar di atas
hanya contoh. Bila pengguna belum menyebut peran, **tanyakan satu kali** peran
mana yang didahulukan; jangan mencoba menulis semuanya dalam satu putaran.

## Tiga tingkat verifikasi — putuskan sebelum menulis satu langkah pun

Panduan yang berisi langkah karangan lebih buruk daripada tanpa panduan. Repo
ini mencatat pelajarannya: *"dibangun lebih lebar daripada yang dipakai"* dan
*"halaman ada ≠ fitur jalan"* (`breadth-over-depth`), dan aturan emas 11:
*katakan "selesai" hanya bila seseorang bisa mengkliknya, dan katakan seberapa
jauh*.

| Tingkat | Syarat | Yang boleh ditulis | Penanda di dokumen |
|---|---|---|---|
| **T1 Terverifikasi** | Tumpukan lokal atau staging **berjalan**, langkah dijalankan dengan akun demo peran itu, tangkapan layar asli | Langkah lengkap + gambar | tidak ada penanda |
| **T2 Dari kode** | Tidak bisa menjalankan aplikasi; langkah dirunut dari `navigation.ts`, halaman, komponen, dan rute API | Kartu tugas dengan jalur menu (dicetak dari kode) dan langkah yang *masuk akal dari kode* | `⚠ Belum dicoba di aplikasi berjalan` pada **setiap** kartu, dan dinyatakan di Riwayat Revisi |
| **T3 Tidak ada akses** | Hanya deskripsi dari pengguna | Kerangka + daftar pertanyaan untuk pengguna; **tanpa langkah** | `[ISI: …]` — dokumen belum boleh disebut selesai |

**Uji kemampuan dulu — jangan menganggap T1 mustahil, jangan menganggapnya mudah.** Jalankan ini dan catat hasilnya
di Riwayat Revisi:

```bash
command -v docker psql pnpm node        # ada semua?
pnpm --filter api db:generate           # mesin Prisma terunduh? (pernah diblokir di sandbox chat: binaries.prisma.sh)
pnpm --filter web exec playwright --version
```

- Semua ada dan `db:generate` sukses → kerjakan **T1** lewat skill `stack` (`.claude/skills/stack/SKILL.md`): PostgreSQL,
  `db:push`, `db:seed` dengan `E2E_FIXED_2FA=1`, API :3001, web :3000; lalu skrip Playwright pendek yang masuk sebagai
  akun demo peran itu, membuka halaman, mengisi formulir dengan data contoh, dan mengambil gambar per layar penentu.
  `apps/web/scripts/screenshot-roles.ts` mengambil gambar menu tiap peran.
- Salah satunya gagal → **T2**, dan tulis di Riwayat Revisi *perintah mana yang gagal dan pesannya*. Jangan menghabiskan
  waktu mencari jalan memutar; bila pengguna ingin T1, katakan apa yang perlu diizinkan (mis. domain
  `binaries.prisma.sh` di daftar jaringan) — keputusannya milik pengguna.
- `role-menus.ts` tetap bisa dijalankan tanpa basis data, jadi jalur menu selalu dicetak dari kode:
  `cd apps/web && ../api/node_modules/.bin/tsx scripts/role-menus.ts SMPIT_GURU`.

**Tidak ada tingkat "kira-kira".** Bila sebuah langkah tidak bisa dipastikan
dari kode, tulis "[ISI: konfirmasi langkah ini — …]" dan laporkan.

## Resep T2 — merunut langkah dari kode

Untuk tiap tugas, baca berurutan:

1. **Menu** — `role-menus.ts` untuk peran itu (jalur persis, dan apakah grupnya bersyarat,
   mis. *Wali Kelas — hanya bagi yang menjalankan tugas itu*). Bila peran lain (guru mapel) tidak
   melihat butir itu, cari jalur lain: biasanya tombol di halaman induk (mis. **Isi Absensi Harian**
   di halaman Kehadiran). Tulis **kedua** jalur.
2. **Halaman** — `apps/web/src/app/<rute>/page.tsx`: judul, nama tombol, label isian, `placeholder`,
   teks `toast`, teks `Alert`, ke mana `router.push` setelah simpan.
3. **Hook data** — `apps/web/src/hooks/use-*.ts`: label status, pesan hasil (mis. `describeAttendanceSave`).
4. **Aturan siapa** — `authorize(...)` di `*.routes.ts` dan penjaga di service; keputusan di `decisions/`.

**Perangkap T2 (semuanya sudah terjadi pada uji skill ini):**

- **Keadaan awal salah dibaca.** Menulis "bila hanya punya satu kelas, kelas itu terpilih" padahal kode
  memilih kelas *pertama* apa pun jumlahnya. Untuk tiap isian, baca **nilai bawaan, pra-pilihan, dan
  kondisi `disabled`** dari kode, jangan menyimpulkan dari label.
- **Satu jalur menu untuk semua peran.** Guru mapel dan wali kelas punya jalur berbeda ke halaman yang sama.
- **Pesan yang dikarang.** Salin teks pesan dari kode (`toast.*`, `Alert`), jangan memparafrasekannya
  di dalam tanda kutip.
- **Tanggal/angka ambang.** "Tanggal esok tidak bisa dipilih" harus ada di kode (`disabled={(d) => d > new Date()}`),
  bukan asumsi.

- **Tombol berbentuk ikon.** Tombol status absensi hanya ikon; namanya muncul sebagai `title`/`aria-label`. Tulis:
  "tombolnya berbentuk ikon; arahkan kursor untuk melihat namanya". Cari `size="sm" className="w-10 h-10"`, `aria-label`.
- **Nama status ≠ nama di daftar lain.** Tombol menyebut **Tidak Hadir**, daftar tindak lanjut menyebut **Alpa**. Salin
  label dari komponen layar yang sedang dijelaskan, bukan dari layar lain.
- **Penyebab `disabled` yang dikarang.** Tulis kondisi persis dari kode (`disabled={a || b.length === 0}` → "daftar kosong
  atau sedang menyimpan"), bukan tebakan ("belum ada perubahan").
- **Kata umum ditebalkan seolah label.** `**kelas**`, `**tanggal**` bukan label; label sebenarnya `Kelas` (pilihan) atau
  tombol tanggal. Tebalkan hanya teks yang benar-benar tampil.
- **Jalur yang salah ke layar yang benar.** Ubah kata sandi ada di **Profile → tab Keamanan → Ubah Password**, bukan
  Settings. Sebelum menulis "di menu X", `grep -rn "<judul kartu>" apps/web/src` untuk menemukan halaman yang sebenarnya.
- **Dua gambar, satu layar.** Dua kartu dalam **satu** buklet yang gambarnya berasal dari halaman yang sama hampir selalu
  berarti salah satu langkahnya menunjuk halaman keliru — inilah gejala yang membuat kartu "Papan Peringkat" dan "Kelola
  Target" sama-sama menampilkan Jurnal Ibadah (`/ibadah` alih-alih `/ibadah/leaderboard` dan `/ibadah/targets`). Pembaca
  menemukannya lebih cepat daripada pemeriksa, jadi **buka gambarnya sebelum menyerahkan**; `see` yang cocok hanya
  membuktikan teksnya ada di layar, bukan bahwa layarnya benar. Pemeriksa menandainya sebagai WARN
  `gambar-halaman-kembar` (dari `url` di manifes).
- **Label menu bahasa Inggris dari menu.** Menu avatar berbunyi **Profile**, **Settings**, **Logout** (bukan "Keluar").
  Tulis apa adanya; jangan menerjemahkan.
- **Nama enum di teks pengguna** (`Menunggu (PENDING)`). Pengguna tidak melihat enum; cari label di `hooks/use-*.ts`.

**Gambar yang sama di dua buklet berbeda tidak apa-apa.** Wali kelas dan musyrif sama-sama melihat Kehadiran → Tindak
Lanjut; bendahara, kepala unit, dan TU sama-sama memakai halaman Pengumuman. Tiap buklet berdiri sendiri, dan pembacanya
tidak membuka buklet peran lain — jadi mengulang gambarnya benar. Yang salah adalah dua kartu dalam **satu** buklet
menampilkan layar yang sama, karena itu berarti salah satu kartunya salah alamat, bukan sekadar berbagi halaman.
`check_docs.py` memeriksa **per berkas**, jadi ia hanya menandai kasus yang kedua.

`check_docs.py --kind pengguna --trace jejak.md` menangkap sebagian besar ini secara mekanis (`label-layar`, `pesan-karangan`,
`nama-enum`, `halaman-tak-ada`, `backtick-lolos`) dan menulis jejak berkas:baris tiap label. **Batasnya:** label yang
kebetulan ada di layar lain lolos; karena itu buka berkas di jejak dan pastikan itu layar yang dimaksud.

Karena perangkap ini, **setiap kartu T2 tetap bertanda ⚠** sampai seorang pengguna sungguhan mencobanya.

## Pembacanya bukan pengembang

Di seluruh teks pengguna (kecuali Riwayat Revisi dan banner ⚠) dilarang: nama enum basis data, nomor PR/isu, kata
`main`/cabang/commit/staging/produksi, kode HTTP, jalur berkas kode, dan menyebut perbaikan mana yang belum di produksi
(itu daftar celah; `progress.md` sengaja tidak mencatatnya). **Ketersediaan** ditulis sekali di bagian "Tentang", dalam
bahasa pengguna: "Buklet ini menjelaskan versi terbaru per <tanggal>. Aplikasi yang Anda pakai mungkin belum memuat semua
perubahan; bila layar Anda berbeda, tanyakan admin unit." Kartu menulis: "Ada pada versi aplikasi yang dijelaskan buklet ini."
Status cabang/`main`/staging/produksi per kemampuan dilaporkan **kepada pengguna di percakapan**, bukan dicetak di manual.

## Kartu tugas (unit dasar panduan)

Satu kartu = satu tugas dalam istilah kerja pembaca ("Mencatat absensi harian",
bukan "Modul attendance"). Empat bagian wajib + tiga opsional:

| Bagian | Isi | Sumber |
|---|---|---|
| **Tujuan** | Satu kalimat, bahasa kerja pembaca | wawancara / `decisions/` |
| **Siapa** | Keluarga peran (dan unit bila relevan) | `panduan-peran`, `authorize(...)` di `*.routes.ts` |
| **Jalur menu** | `Grup → Butir → Sub-butir`, persis seperti tertera (sebagian judul masih Inggris — tulis apa adanya). Dicetak dari `role-menus.ts` untuk **penugasan utama** | `role-menus.ts` |
| **Langkah** | Bernomor; **satu tindakan per langkah**; nama tombol/kolom persis seperti layar; hasil yang terlihat ditulis miring | aplikasi berjalan (T1) atau kode (T2) |
| *Hasil & giliran berikutnya* | "Status menjadi *Menunggu Paraf*; giliran pemaraf pertama" | kode service + `decisions/` |
| *Bila tidak berhasil* | 2–4 masalah paling umum + penyebab + apa yang harus dilakukan | uji, `lessons/`, pesan galat di kode |
| *Ketersediaan* | Satu kalimat baku: "Ada pada versi aplikasi yang dijelaskan buklet ini." (bukan cabang/`main`/produksi) | bagian "Pembacanya bukan pengembang" |

Bila halamannya **tidak ada di menu perannya**, katakan: "tidak ada di menu —
buka `/…`", dan catat sebagai celah (jangan dikarang jalurnya). Bila
`known-issues.md` mencatat alurnya rusak, tulis batasannya di kartu atau
keluarkan kartunya dan masukkan ke Lampiran *Belum tersedia*.

Jangan menyalin pohon menu lengkap ke panduan; tautkan tugasnya saja.

## Memilih tugas untuk satu buklet

1. Cetak menu peran: `role-menus.ts <KODE_PERAN>` untuk tiap kode peran dalam keluarga itu.
2. Ambil butir yang berupa **pekerjaan berulang** (isi, catat, putuskan, setujui, kirim), bukan butir yang hanya membaca.
3. Untuk tiap butir, temukan penulisnya: `grep -n "authorize(" apps/api/src/modules/<modul>/*.routes.ts` — bila peran ini
   tak ada di daftar, jangan tulis kartunya.
4. Urutkan menurut frekuensi (harian → tahunan). 4–8 kartu per buklet; sisanya masuk "Tugas yang menyusul".
5. Butir yang `known-issues.md` sebut rusak masuk Lampiran *Belum tersedia*, bukan kartu.

## Empat pertanyaan "bisakah peran X melakukan Y?"

Sebelum menulis "Guru dapat …", lolos-kan empat lapis (skill `panduan-peran`):
menu → halaman (`canAccessRoute`) → rute API (`authorize`) → service & lingkup
data. Ada aksi yang bergantung **baris**, bukan peran (izin santri diputuskan
musyrif atau wali kelas santri itu; absensi kelas oleh wali kelas dan guru yang
mengajar di kelas itu). Tulis aturannya, bukan sekadar "guru bisa".

## Struktur Bagian Umum

1. **Tentang panduan ini** — siapa pembacanya; cara memakai; konvensi (tombol
   dalam **tebal**, jalur menu dengan panah, ⚠ untuk yang belum diverifikasi);
   tanggal versi aplikasi yang dijelaskan (commit hanya di Riwayat Revisi); cara melapor kekeliruan.
2. **Mulai** (tutorial): membuka aplikasi; masuk; verifikasi dua langkah untuk
   admin; mengenal dasbor, menu, dan notifikasi; mengubah kata sandi dan profil;
   keluar. Semua dari layar nyata.
3. **Konsep** (penjelasan, tiap konsep ≤ satu halaman): mengapa menu tiap orang
   berbeda; persetujuan berjenjang; apa yang dilihat wali santri dan apa yang
   tidak; perlindungan data santri.
4. **Rujukan**: arti status; daftar peran singkat; pesan galat umum; glosarium
   (ejaan yayasan: Tahfidz, Tahsin, Takhosus, Kitab Kuning; istilah pesantren tidak
   diterjemahkan).
5. **Bantuan**: ke siapa bertanya (peran, bukan nama orang), dan cara melapor.

## Tangkapan layar

- Satu gambar per **layar penentu**, bukan per langkah. Lebih dari tiga gambar
  per kartu berarti kartunya terlalu besar — pecah.
- Hanya dari **akun demo** dengan **data contoh**. Tidak pernah data santri,
  wali, atau pegawai sungguhan. Wajah, nama, nomor: tak boleh.
- Pola nama: `screens/<peran>/<tugas>-<nn>.png`; keterangan bernomor:
  "Gambar 3. Formulir absensi harian".
- Bila gambar tak bisa dibuat (T2), **jangan menyisipkan gambar kosong atau
  gambar dari fitur lain**. Tulis `[ISI: tangkapan layar formulir …]`.
- Di `.docx`: lebar maksimal 15 cm; format PNG.

## Gaya bahasa

Minimalisme (Carroll): pembaca sibuk, jadi potong basa-basi dan mulai dari
tindakan. Satu topik, satu tujuan; yang bisa ditemukan sendiri tidak dijelaskan.

- Perintah pendek: "Klik **Simpan**." Bukan "Anda dapat mengklik tombol Simpan
  untuk menyimpan."
- Satu tindakan per langkah; hasil yang terlihat dalam *miring*.
- Nama tombol, menu, kolom: persis layar. Jangan menerjemahkan yang di layar
  masih Inggris.
- *Santri* dan *wali santri* di seluruh panduan portal (keputusan yayasan
  2026-09-27); *murid/peserta didik* hanya dalam format negara (rapor, SPMB,
  Dapodik/EMIS, ijazah).
- Istilah pesantren tidak diterjemahkan; jelaskan di glosarium.
- Hindari jargon (API, token, endpoint) di panduan untuk staf dan wali.
- Jangan menjanjikan fitur yang belum ada. Ketersediaan ditulis apa adanya.
- Tanggal: "28 September 2026".

## Daftar periksa sebelum menyerahkan (semuanya perintah)

```bash
python scripts/check_docs.py naskah.md --kind pengguna --repo <repo> --facts fakta/facts.json --final --trace jejak.md   # 0 ERROR
python scripts/scan_sensitive.py naskah.md                                                                              # bersih
python scripts/build_docs.py naskah.md --out keluaran --format docx --pdf --commit <hash> …                             # kode keluar 0
```

`.docx`/`.pdf` adalah artefak (diabaikan `.gitignore`); bangun saat dibutuhkan, jangan commit.

Lalu, dengan mata: buka `jejak.md` dan pastikan tiap label berasal dari layar yang dimaksud; bandingkan satu kartu
dengan `page.tsx`-nya baris demi baris (nilai bawaan, `disabled`, teks toast).

- [ ] Tingkat verifikasi tiap bagian dinyatakan di **Riwayat Revisi**, beserta hasil uji kemampuan
- [ ] Bila T2: **tiap** kartu bertanda ⚠
- [ ] Peran & lingkup data tiap tugas lolos empat lapis
- [ ] Tak ada tangkapan layar berisi data sungguhan
- [ ] Alur yang dicatat rusak di `known-issues.md` tidak dipresentasikan sebagai jalan
- [ ] (Ideal) satu orang dari peran itu mencoba kartu tanpa bantuan — ISO 26514 meminta panduan diuji pada pembaca
