# Audit Dokumen Aplikasi Cipansor

Tanggal: 29 September 2026 · Basis kode: `aefc719` · Diaudit: hasil skill `dokumen-aplikasi-cipansor` yang dijalankan
OpenHands (DeepSeek) atas skill rancangan Sonnet · Auditor: Claude · Cara: setiap klaim dibandingkan dengan kode
(`grep`, `role-menus.ts`, `schema.prisma`, `scheduler.ts`), setiap berkas biner dibuka dan dirender.

Berkas ini menggantikan evaluasi diri sebelumnya, yang menilai hampir semuanya "Sesuai" dan tidak pernah membuka PDF
yang dihasilkannya.

# 1. Putusan

**Belum layak diserahkan kepada pengurus, donor, atau auditor.** Kerangkanya benar (arc42, C4, Diátaxis) dan sebagian besar isi
cocok dengan kode. Tetapi berkas jadinya rusak, sejumlah klaim teknis dikarang, dua dokumen membocorkan
hal yang repo sendiri putuskan untuk tidak dicatat, dan panduan "dari kode" memuat langkah yang keliru pada kartu
andalannya. Setelah perbaikan di bagian 6, isi dan berkasnya lolos pemeriksa mesin; yang tersisa ada di bagian 8.

# 2. Temuan berat

| # | Temuan | Bukti |
|---|---|---|
| 1 | **Semua 14 tabel di `.docx` dan PDF rusak.** Kepala tabel hijau tanpa teks, sel kosong, isi sel tercecer sebagai paragraf sebaris-sebaris, judul bab tertelan ke sel terakhir. Lampiran A (katalog modul) menjadi 17 halaman satu nilai per baris. PDF 67 halaman; yang benar 24. | Buka halaman 3, 8, 10, 27, 29, 44 PDF lama. `python-docx`: tabel 1 berukuran 2×5 dengan seluruh sel kosong. Dibangun ulang dari Markdown yang sama: 24 halaman, tabel utuh. |
| 2 | **Alamat rute karangan.** Diagram SPMB menulis `POST /admissions/public/register`; yang ada `POST /api/admissions/public/registrants`. | `admissions.routes.ts` |
| 3 | **Diagram persuratan tak sesuai kode.** Langkah "tandatangani" tanpa rute, `submit` dilewati, verifikasi ditulis ke halaman web bukan ke API. | Rute nyata: `.../letters/:id/submit`, `.../review`, `/api/esign/letters/:letterId/sign`, `/api/esign/verify-pdf` |
| 4 | **"14 pekerjaan terjadwal" salah.** Ada 15 entri jadwal atas 13 berkas; `asset-depreciation.job` tidak dijadwalkan (dipanggil dari modul `inventory`). Angka itu memang hasil `collect_facts.py` yang menghitung berkas `*.job.ts` — skrip menyesatkan, dokumen mempercayainya. | `jobs/scheduler.ts`, `inventory.service.ts` |
| 5 | **ERD fiktif.** `ROLE_ASSIGNMENT`, `ENROLLMENT`, `KELAS` bukan model; relasi ditebak. Yang nyata: `UserRoleAssignment`, `ClassEnrollment`, `Class`. | `schema.prisma` |
| 6 | **Kebocoran.** Bab 11 menulis "satu tabel menampilkan NIK penuh" (cacat privasi yang masih terbuka), "13 rute memeriksa izin vs 670 memeriksa kelompok lama" (peta lemahnya kontrol akses), dan angka `1.457 res.json / 399 ApiResponse` dari catatan tanggal lain. Manual guru menulis "perbaikan #585; produksi menyusul" — menyebut perbaikan mana yang belum di produksi, padahal `progress.md` sengaja tidak mencatatnya. Bab 11 sendiri berjanji tidak membuka butir terbuka. | `known-issues.md`, `progress.md` |
| 7 | **Kartu andalan manual guru keliru.** Status ditulis "Alpa" (tombolnya **Tidak Hadir**, dan berbentuk ikon); penyebab tombol Simpan nonaktif dikarang ("belum ada perubahan"; kode: daftar kosong atau sedang menyimpan); pesan hasil ditulis samar; kartu perilaku tidak membedakan isian wajib (santri, kategori, isi catatan) dari yang opsional; jalur menu tercetak `\`/attendance/record\``. | `attendance/record/page.tsx`, `homeroom/behavior/page.tsx` |
| 8 | **Panduan Umum menyesatkan pengguna.** Ubah kata sandi ditulis di *Settings* (halaman itu justru berkata "hubungi IT Support"); tempatnya **Profile → Keamanan → Ubah Password**. Tombol keluar ditulis "Keluar"; layarnya **Logout**. Tabel status memakai nama enum (`Menunggu (PENDING)`). | `header.tsx`, `profile/page.tsx`, `settings/page.tsx` |
| 9 | **Evaluasi diri tak jujur.** Menilai C4 "Sesuai" padahal tingkat 3 tak ada dan panah tanpa label; menilai "23 baris keputusan bertaut" sebagai Sesuai padahal satu berkas (`akreditasi-unit.md`) tampil dua kali dan dua berkas persuratan digabung dalam satu baris, sehingga 23 = 23 kebetulan; "angka cocok persis" dijadikan bukti akurasi padahal skrip yang sama yang mengukur dan memeriksa. | bagian 3 lama |

# 3. Temuan menengah

- **Ukuran tata letak modul rosier daripada repo sendiri.** Dokumen: "66 dari 93 tata letak lengkap"; `known-issues.md`: 22 dari 93 (lima bagian, termasuk `index.ts`; kini 24). Dua definisi dicampur tanpa disebut.
- **Bab 5.3 melewatkan modul inti** (`students`, `parent`, `meals`, `paud-report`, `scholarship`).
- **Bab 9 memuat `akreditasi-unit.md` dua kali** (baris kedua bahkan menambah klaim yang hanya sebagian ada di berkasnya); jumlah baris tampak cocok karena dua berkas lain digabung dalam satu baris.
- **Bab 10 bukan skenario mutu.** Tanpa ukuran; satu baris berupa cacat (optimizer gambar), satu kalimat berbalik ("…tidak merges").
- **Tanggal salah baca:** "rilis produksi belum dijalankan sejak 27 September" — itu tanggal persetujuan ditunda.
- **Diagram penempatan** memakai id `Prod` untuk simpul dan subgraph (simpul hilang), tanpa Redis padahal teksnya menyebut empat kontainer. **C4-2** menggambar `packages/shared` sebagai kontainer (ia pustaka).
- **"tiga bahasa (Indonesia, Inggris, Arab, Arab RTL)"**; "layanan publik seperti prasekolah".
- **Manual staf tanpa satu pun tangkapan layar**, sementara repo punya 78.

# 4. Kritik atas desain, proses bisnis, dan tampilan

**Desain dokumen.** Dokumen teknis terasa seperti templat yang diisi, bukan argumen. Ringkasan eksekutif pandai
menyebut "utang" tetapi tidak memberi pengurus keputusan atau risiko yang bisa ditindak. Bab 6 (nilai jual dokumen ini)
adalah bab yang paling sedikit diverifikasi dan paling banyak salah. Tabel modul menjelaskan apa yang ada, bukan mengapa
dipisah begitu.

**Proses bisnis yang digambarkan.** Manual guru mencampur peran: kartu "Memutuskan izin santri" menulis untuk musyrif dan
wali kelas sekaligus di buklet Guru, padahal musyrif bukan guru (kode peran terpisah) dan kartu itu hanya benar untuk wali
kelas. Alur absensi tidak menghubungkan kartu-kartunya (Tidak Hadir → daftar tindak lanjut sebagai Alpa → hasil mengubah
absensi) sehingga pembaca tak melihat prosesnya sebagai satu rantai. Manual mencetak "Ketersediaan: `main`" per kartu —
kata yang tak berarti bagi guru, dan berisi informasi yang tidak boleh keluar.

**Tampilan.** Sampul dan logo baik. PDF memakai font serif cadangan (Calibri tak ada; Carlito tak terpasang). Tabel
rusak (temuan 1). ERD 15 entitas dirender terlalu kecil untuk dibaca. Label pada diagram urutan masuk terpotong di tepi kiri (kini diperpendek).
Daftar isi terisi, tetapi nomor halamannya mengikuti tabel yang rusak, jadi tak berguna.

# 5. Yang sudah baik

- Pilihan kerangka (arc42 + C4 + Diátaxis) dan alasannya; keputusan "satu sumber Markdown, biner diturunkan".
- Disiplin kejujuran pada niat: tingkat verifikasi T1/T2/T3, banner ⚠, aturan sensitif, `collect_facts.py` tanpa membaca nilai env.
- Jalur menu di manual guru **cocok** dengan `role-menus.ts` (dicek untuk `SMPIT_GURU`).
- Alur 6.1 (masuk + 2FA) dan 6.3 (pengesahan RPJP → Renstra → RKA) cocok dengan rute di kode.
- Dua cacat skrip yang ditemukan (`-w` pada mermaid-cli, keterangan gambar) nyata dan diperbaiki dengan benar.

# 6. Akar masalah pada skill, dan perbaikannya

| Akar | Perbaikan yang diterapkan |
|---|---|
| Aturan berupa prosa; tak ada yang memeriksa kalimat terhadap kode | `scripts/check_docs.py`: mencocokkan rute, angka, nama model ERD, label layar, pesan, kartu tugas, tabel, id diagram, bab 9/10/11; `--trace` mencetak berkas:baris tiap label |
| Berkas biner dibangun di lingkungan yang merusaknya dan tak diperiksa | `build_docs.py` memverifikasi `.docx` (jumlah tabel, sel/kepala kosong, gambar) dan PDF; pengisian daftar isi yang merusak dibuang; `--pdf` |
| Lingkungan tak diperiksa (LibreOffice tanpa Writer memuat semuanya dengan galat) | `scripts/check_env.py` sebelum menulis; mencetak perintah pasang |
| Templat membawa bug (id `Prod` ganda, Sentry dan `lib/realtime.ts` yang sudah dihapus, "enum status", "Tersedia: produksi/main") lalu disalin setia | Templat ditulis ulang: C4-1/2/3 berlabel, kolom `Ukuran`, label layar bukan enum, satu kalimat ketersediaan |
| Skrip ukur menyesatkan | `collect_facts.py`: `scheduled_job_files` vs berkas job; `four_file_modules` vs `five_part_modules`; rute per modul; ringkasan keputusan tak terpotong |
| Skill khusus lingkungan chat (`/mnt/skills/…`, `present_files`, klaim "T1 mustahil di sandbox") dipasang di repo | `SKILL.md` ditulis ulang: perintah yang jalan di repo mana pun, uji kemampuan alih-alih asumsi |
| Kesalahan tak tercatat | `references/kesalahan-yang-sudah-terjadi.md`: 29 entri dengan kode pemeriksa |

Dokumen: rute, alur persuratan, hitungan job, ERD, bab 5.3, 9, 10, 11, dua diagram, dan kartu-kartu manual diperbaiki dari
kode; berkas `.docx`/`.pdf` dibangun ulang dengan pemeriksa bersih.

# 7. Apakah skill perlu lebih detail dan presisi agar model yang lebih kecil bekerja rapi?

**Ya — tetapi bukan dengan lebih banyak prosa.** Skill lama panjang dan sudah detail; kegagalannya bukan kekurangan
uraian, melainkan bahwa semua kepatuhan bergantung pada penilaian model. Model yang lebih kecil lebih literal: ia menyalin
templat termasuk bugnya, menjumlah apa yang mudah dihitung, dan menilai dirinya sendiri terlalu murah hati. Yang berhasil:

1. **Pindahkan penilaian ke skrip** yang menjawab pertanyaan ya/tidak terhadap kode (rute ada? model ada? label ada?).
2. **Gerbang di setiap langkah:** perintah yang harus keluar 0 sebelum lanjut, satu bab per putaran.
3. **Kontrak bab:** untuk tiap bab, apa yang wajib ada, dari perintah apa sumbernya, dan pemeriksa mana yang menjaganya.
4. **Contoh benar dan salah dari kegagalan nyata** (katalog), bukan nasihat umum.
5. **Templat yang benar**, karena templat adalah instruksi yang paling setia diikuti.
6. **Pesan galat yang menunjuk jawabannya** ("yang ada di sekitarnya: …") supaya model memilih, tidak menebak.
7. **Lingkungan diperiksa dulu**, dan hasil biner diperiksa mesin sesudahnya — karena model tanpa penglihatan tak bisa "melihat" PDF.

Yang tidak dilakukan: menambah aturan gaya panjang. Semakin banyak aturan prosa, semakin sedikit yang diikuti.

# 8. Yang belum selesai

| Hal | Mengapa | Siapa |
|---|---|---|
| Panduan naik ke T1 (dicoba di aplikasi berjalan, dengan tangkapan layar) | **Sebagian selesai (2026-09-30).** Panduan Umum bab 2 dan seluruh kartu kedelapan buklet peran sudah T1 dengan tangkapan layar asli dari alur yang lolos. Sisa: bab konsep/rujukan Panduan Umum | penyusun berikut dengan skill `stack` |
| Buklet peran lain (pesantren, TU, bendahara, kepala unit, organ, wali, santri) | **Selesai (2026-09-30):** kedelapan buklet terbit — Guru, Musyrif, Wali Santri, Tata Usaha, Bendahara, Kepala Unit, Pengurus Yayasan, Santri. | selesai |
| Biner `.docx`/`.pdf` di git | Tiga salinan per dokumen bisa menyimpang dan git tidak bisa menampilkan isinya; **diputuskan (2026-09-29): biner tidak dilacak** — hanya `.md` di git, biner dibangun ulang saat dibutuhkan | selesai |
| Pembangunan dokumen di CI | Tidak lagi perlu: biner tidak dilacak, jadi tak ada "biner basi" yang harus dicegah | — |
| Uji oleh satu guru sungguhan | ISO 26514 meminta panduan diuji pada pembaca | yayasan |

**Temuan sampingan di aplikasi (bukan di dokumen), ditemukan saat mencocokkan label:** halaman Profile → Keamanan masih
menganjurkan "ganti password secara berkala (minimal setiap 3 bulan)", bertentangan dengan keputusan sandi (diganti karena
kejadian, bukan kalender); pesan validasi "Password baru minimal 8 karakter" tidak menyebut batas 15 karakter tanpa 2FA; menu avatar
berbahasa Inggris (Profile, Settings, Logout) padahal portal diputuskan berbahasa Indonesia; beberapa layar masih menulis
"Siswa" alih-alih santri. Semuanya perlu dicatat di `known-issues.md` oleh pemilik repo.

# 9. Tindak lanjut 2026-09-30

Sesi ini menaikkan panduan ke T1, menerbitkan dua buklet peran baru, dan
memeriksa ulang pilihan standar.

**T1 — dijalankan pada aplikasi berjalan.** Tumpukan lokal (PostgreSQL + Redis,
API :3001, web :3000) dijalankan; akun demo dipakai per peran. Sebelas alur
tangkapan layar (`screenshot-flow.ts`) dijalankan dan **semuanya lolos**:
`masuk-dan-kenal-aplikasi`, `masuk-verifikasi-dua-langkah`, `absensi-harian`,
`tindak-lanjut-alpa`, `catatan-perilaku`, `izin-santri-harian`,
`izin-santri-mukim`, `pantau-anak-wali`, `setoran-tahfidz-musyrif`,
`pengesahan-rka-yayasan`, dan `persuratan-tte`. Empat alur baru dibuat untuk sesi
ini (`masuk-verifikasi-dua-langkah`, `izin-santri-mukim`, `pantau-anak-wali`,
`setoran-tahfidz-musyrif`).

**Koreksi yang hanya terlihat saat dijalankan** (bukan dari kode):
- Ikon lonceng header **membuka halaman Notifikasi Saya**, bukan panel melayang
  seperti yang tertulis sebelumnya di Panduan Umum.
- Halaman pertama setelah masuk berlabel **Dashboard**.
- Layar Santri Binaan musyrif masih berjudul **Students**; kartu ditulis apa
  adanya dengan catatan.
- Formulir tahfidz meminta **Tipe**, **Nilai**, **Surah**, dan **Ayat Awal/Akhir**;
  **Tanggal** sudah terisi hari ini, jadi langkah tanggal tidak diperlukan.
- Label **Ayat Awal**/**Ayat Akhir** memuat tanda bintang di layar (penanda wajib),
  sehingga pemeriksa label tidak menemukannya utuh. **Cacat pemeriksa diperbaiki**:
  `label_hits()` di `check_docs.py` kini menerima akhiran " *" pada label wajib,
  dan kartu kembali menulis labelnya persis.

**Buklet baru.** `PANDUAN-PENGGUNA-MUSYRIF.md` dan
`PANDUAN-PENGGUNA-WALI-SANTRI.md`, keduanya T1, memakai alur yang lolos. Jalur
menu dicetak dari `role-menus.ts` (`MUSYRIF`, `SDIT_ORANG_TUA`, `SMPIT_ORANG_TUA`).

**Standar diperiksa ulang** (`references/standar-dan-alasan.md`, bagian
"Pemeriksaan ulang 2026-09-30"): arc42 tetap 12 bab; C4 tingkat 3 dipertahankan
satu diagram lapisan (peringatan volatilitas Simon Brown dicatat); `llms.txt`
**tidak** dibuat karena ia fitur situs web, bukan dokumen aplikasi; docs-as-code
menuntut pemeriksa di CI — yang masih belum dijalankan di CI.

**Pemeriksa mesin (30 September 2026).** `check_docs.py` 0 ERROR untuk
DOKUMEN-TEKNIS (`--final`), PANDUAN-UMUM, -GURU, -MUSYRIF, -WALI-SANTRI;
`scan_sensitive.py` bersih (5 berkas); `build_docs.py` menghasilkan `.docx`/`.pdf`
untuk kelima panduan tanpa galat.

**Belum selesai.** Bab konsep/rujukan Panduan Umum masih T2; pemeriksa dokumen
belum berjalan di CI.

# 10. Tindak lanjut 2026-09-30 (kedua)

Sesi ini menyelesaikan lima buklet peran yang tersisa dan menutup satu cacat
mutu gambar.

**Buklet peran lengkap (8).** `PANDUAN-PENGGUNA-TATA-USAHA`, `-BENDAHARA`,
`-KEPALA-UNIT`, `-PENGURUS-YAYASAN`, dan `-SANTRI` menyusul `-GURU`, `-MUSYRIF`,
dan `-WALI-SANTRI`. Kelimanya T1: alur tangkapan (`layanan-tata-usaha`,
`keuangan-bendahara`, `kepemimpinan-kepala-unit`, `tata-kelola-yayasan`,
`keseharian-santri`) dijalankan pada aplikasi berjalan dan **semuanya lolos**;
tiap kartu memuat tangkapan layar asli. `docs/README.md` kini memetakan peran ke
bukletnya.

**Cacat mutu gambar yang ditemukan dan diperbaiki.** Dua gambar di buklet santri
sama-sama menampilkan layar Jurnal Ibadah: kartu **Papan Peringkat** (langkahnya
`goto /ibadah`) dan kartu **Kelola Target** (halaman sebenarnya
`/ibadah/targets`, bukan `/ibadah`). Kedua langkah alur diperbaiki
(`/ibadah/leaderboard`, `/ibadah/targets`), alur ditangkap ulang (17/17 lolos),
dan gambarnya diganti. Cacat ini **lolos semua pemeriksa** karena
`screenshot-flow.ts` hanya memeriksa teks `see`, bukan apakah tangkapan cocok
dengan judul kartunya — satu-satunya cara menemukannya adalah membuka gambarnya.
Pelajaran dicatat di `references/kesalahan-yang-sudah-terjadi.md` (A13).

**Pemeriksa diperkuat** (menutup kelas cacat di atas secara mekanis):
- `screens_manifest.py select` menulis `url` tiap gambar ke manifes dan
  memperingatkan bila dua gambar berasal dari halaman yang sama, plus opsi
  `--prune` untuk membuang entri manifes yang tak lagi dirujuk.
- `check_docs.py` menambah pemeriksa `gambar-halaman-kembar` (WARN) yang membaca
  `url` dari manifes.
- Peringatan itu **hanya menemukan kasus yang manifesnya baru** (membawa `url`);
  gambar lama tanpa `url` tidak diperiksa. Karena itu aturan menyemat tetap:
  **buka gambar sebelum menyerahkan**, `see` yang cocok tidak menjamin layarnya
  benar.

**Standar diperiksa ulang (ketiga).** Ditambahkan **IEC/IEEE 82079-1:2019**
sebagai acuan normatif 26514:2022 (standar horizontal → vertikal), yang
memperkuat *mengapa* buklet per peran dipilih: "lengkap, tidak berlebih" dan
pemulihan dari kesalahan di dalam prosedur. Yang tidak diambil: persyaratan
keselamatan produk dan pelabelan.

**Pemeriksa mesin (30 September 2026, kedua).** `check_docs.py` 0 ERROR/0 WARN
untuk **sepuluh** berkas (DOKUMEN-TEKNIS `--final` dan sembilan panduan);
`scan_sensitive.py` bersih; `build_docs.py` menghasilkan `.docx`/`.pdf` untuk
kesepuluh dokumen; PDF tanpa halaman kosong.

**Belum selesai.** Bab konsep/rujukan Panduan Umum masih T2; pemeriksa dokumen
belum berjalan di CI; sebagian gambar lama di manifes belum membawa `url`
sehingga pemeriksa halaman-kembar belum menjangkaunya.

# 11. Tindak lanjut 2026-09-30 (ketiga) — bangun ulang, satu angka bergeser, satu cacat pemeriksa

Sesi ini menjalankan alur skill dari awal atas pohon kerja saat ini: lingkungan
diperiksa, kode diukur ulang, dokumen dibangun ulang, dan pilihan standar
diperiksa ulang lewat riset web.

**Lingkungan.** `check_env.py` awalnya menandai empat kebutuhan wajib belum ada
(pandoc, mermaid-cli, LibreOffice Writer, python-docx). Semuanya dipasang
(`apt-get`, `npm -g`, `pip`); `check_env.py` kemudian melaporkan "Siap membangun".
Catatan: `uno` (untuk mengisi daftar isi otomatis) tetap tak dapat dimuat karena
`libreglo.so` tak ditemukan, jadi daftar isi `.docx` terisi saat dibuka di Word —
ini **bukan** kegagalan build, dan dilaporkan apa adanya.

**Angka bergeser, dan pemeriksa menangkapnya.** Pengukuran ulang
(`collect_facts.py --compare`) menunjukkan satu pergeseran: **~1.413 hulu rute API**
(dari ~1.412) karena rute `POST /api/certificates/:id/generate-pdf` ada di pohon
kerja tetapi belum dikomit. Angka itu ditulis di ringkasan bab 1 `DOKUMEN-TEKNIS.md`
dan **tidak diperiksa** oleh `check_docs.py` — ia hanya memeriksa modul, model,
enum, kode peran, halaman web, kunci env, dan hitungan pekerjaan terjadwal. Pola
baru `(\d[\d.]*)\s+hulu rute` → `api.handler_count_approx` ditambahkan; pemeriksa
kini menandai ERROR "1.412 hulu rute — facts.json mengukur 1413". Dokumen
dinaikkan ke **v0.7** (basis commit `18f853f2`) dan angkanya diperbaiki.

**Riset standar (ketiga).** Hasilnya tidak mengubah kerangka; yang diperbarui
adalah edisi acuan dan kesadaran perkakas — arc42 v9 (Juli 2025), C4 dengan
Structurizr sebagai acuan model-as-code dan D2 yang kini mengenal konsep C4,
ISO/IEC/IEEE 42010:2022, 26514:2022 (API/chatbot), MADR 4.0.0 (17 Sep 2024),
Diátaxis yang tetap hidup, serta perkakas lint 2026 (Vale, markdownlint, lychee,
cspell, textlint). Alasan tetap memakai pemeriksa sendiri alih-alih Vale/lychee
dicatat di `references/standar-dan-alasan.md`: yang diperiksa bukan gaya prosa,
melainkan kecocokan klaim dengan kode.

**Pemeriksa mesin (30 September 2026, ketiga).**

| Pemeriksa | Hasil |
|---|---|
| `check_docs.py --final` (DOKUMEN-TEKNIS) | 0 ERROR, 0 WARN |
| `check_docs.py --final` (sembilan panduan) | 0 ERROR, 0 WARN |
| `scan_sensitive.py` (berkas yang ditambahkan/diubah) | bersih |
| `build_docs.py --pdf` (DOKUMEN-TEKNIS, PANDUAN-UMUM, PANDUAN-GURU) | kode keluar 0, tanpa baris `GAGAL`; 11 diagram dirender, 0 gagal |

**Temuan sampingan (skrip repo, bukan dokumen).** `scripts/check-doc-refs.py`
melaporkan **77 tautan gambar menggantung** pada panduan, padahal berkasnya ada di
`docs/screens/…`. Akarnya: panduan menulis gambar dengan jalur relatif ke dokumen
(`screens/…`, benar untuk GitHub) sementara skrip menyelesaikannya relatif ke akar
repo. Dampaknya: skrip tak lagi menjalankan tugasnya untuk berkas panduan — ia
memeriksa hanya `docs/images/`, bukan `docs/screens/`. Ini **sudah ada di `main`**
(bukan regresi sesi ini), dan perbaikannya milik repo (ubah skrip agar mencoba
kedua basis, atau perlakukan `screens/` seperti `images/`), bukan milik dokumen.

**Belum selesai.** Bab konsep/rujukan Panduan Umum masih T2; pemeriksa dokumen
belum berjalan di CI; `uno` tak tersedia di lingkungan ini sehingga daftar isi
`.docx` terisi saat dibuka (F9), bukan saat dibangun; `check-doc-refs.py` perlu
diperbaiki agar mengenali jalur gambar relatif dokumen.

# 12. Tindak lanjut 2026-09-30 (keempat) — satu kelas cacat baru: jumlah cocok, isi basi

Sesi ini menjalankan alur skill atas pohon kerja saat ini (perbaikan modul
`certificates`, `rewards`, `violations`, `hr` belum dikomit), mengukur ulang,
mencari tahu standar terkini lewat web, lalu memperbarui.

**Kelas cacat yang ditemukan: pemeriksa Lampiran A hanya menghitung baris.**
`collect_facts.py` melaporkan pohon kerja berbeda dari pengukuran sebelumnya:
**~1.413 hulu rute API** (dari ~1.412) dan `has_tests_dir` yang kini `true` untuk
tiga modul. Yang lebih penting, **Lampiran A punya jumlah baris yang benar (94 =
94) tetapi lima barisnya basi**: modul `certificates`, `rewards`, `violations`,
`hr`, dan `organisasi` masih mencetak jumlah handler lama setelah modulnya
bertambah rute.

| Modul | Dokumen | Kode |
|---|---|---|
| certificates | 9 | 10 |
| rewards | 9 | 10 |
| violations | 7 | 8 |
| hr | 37 | 42 |
| organisasi | 11 | 12 |

Ini kelas yang sama dengan C5 (`akreditasi-unit.md` dua kali sehingga "23 = 23"
cocok secara kebetulan): **jumlah yang cocok bukan bukti isi yang cocok.**
Pemeriksa lama (`lampiran-a-jumlah`) hanya membandingkan panjang tabel, jadi
baris yang isinya salah lolos. Pemeriksa per baris ditambahkan
(`lampiran-a-handler`, `lampiran-a-mount`, `lampiran-a-layering`) yang
membandingkan tiap sel dengan `facts.json`; ia langsung menandai kelima baris,
yang lalu diukur ulang dari kode.

**Cacat format yang ikut tertangkap (buatan sesi ini, bukan bawaan).** Saat
menulis ulang tabel Lampiran A dengan skrip, potongan naskah disambung tanpa
baris kosong sehingga judul `# Lampiran B` menempel pada kalimat sebelumnya
(`… \`scholarship\`.# Lampiran B …`) dan `check_docs.py` langsung melaporkan
"Lampiran B tidak ada". Diperbaiki. Dicatat apa adanya: yang menangkapnya adalah
pemeriksa mesin, dan yang membuatnya adalah penyuntingan angka — bukan
`DOKUMEN-TEKNIS.md` di `main`.

**Pemeriksa mesin (30 September 2026, keempat).**

| Pemeriksa | Hasil |
|---|---|
| `check_docs.py --final` (sepuluh berkas) | 0 ERROR, 0 WARN |
| `scan_sensitive.py` (DOKUMEN-TEKNIS, README) | bersih |
| `scripts/check-doc-refs.py` | 1.821 rujukan = 1.821 berkas di disk; 0 menggantung, 0 yatim |

**Riset standar (keempat, lewat web).** Tidak ada edisi yang berganti dalam
sehari: arc42 tetap **v9 (Juli 2025)** — situsnya kini menonjolkan docs-as-code
sebagai cara pakai yang disarankan; C4 tetap tanpa edisi bernomor dengan
peringatan pembuatnya agar tingkat 3–4 tidak dirawat berlebihan (DDD Europe
2025); Diátaxis tetap empat mode, kini disorot relevansinya untuk agen/RAG;
ISO/IEC/IEEE 26514:2022 tetap edisi berlaku; MADR 4.0.0 masih template terkini;
docs-as-code 2026 menuntut gerbang di CI (lychee, markdownlint, Vale, cspell),
dengan ambang dimulai dari WARN. Rinciannya di
`references/standar-dan-alasan.md` bagian "Pemeriksaan ulang 2026-09-30
(ketiga)".

**Belum selesai (diperbarui).** Bab konsep/rujukan Panduan Umum masih T2;
pemeriksa dokumen belum berjalan di CI; `uno` tak tersedia sehingga daftar isi
`.docx` terisi saat dibuka (F9); `scripts/check-doc-refs.py` sudah diperbaiki di
pohon kerja (mencoba dua basis: relatif dokumen dan relatif akar) tetapi
perubahannya belum dikomit; `.docx`/`.pdf` belum dibangun ulang pada sesi ini
(hanya `.md` yang berubah, dan biner tidak dilacak git).

# 13. Tindak lanjut 2026-09-30 (kelima) — temuan Devin ditutup, perkakas diberi uji regresi

Sesi ini menindaklanjuti temuan tinjauan Devin (kontrol akses dan kecocokan
dokumen dengan kode), menambah uji regresi untuk perkakas dokumen, memeriksa
ulang standar lewat web, lalu memperbarui dokumen.

**Temuan Devin yang ditutup di kode.**

| Temuan | Tindakan |
|---|---|
| Sertifikat melewati pemeriksaan akses tingkat santri (CWE-863, tinggi) | `certificates.service.ts` diberi `assertStudentInScope`/`studentScope`: penerbitan dan pengunduhan PDF menolak santri di luar unit/kelas aktor. Diuji di `tests/` modul. |
| Admin unit mengatur hal yang bukan kewenangannya (hr.routes.ts) | `hr.service.ts` diberi `actorReachesUnit`/`isFoundationScopedRole`; peran berlingkup yayasan dijangkau, peran unit hanya untuk unitnya. |
| Kategori penghargaan kembali tanpa poin | `rewards.service.ts` `getRewardCategories` kini mengembalikan `points` dan `type` barisnya, bukan 0. |
| PDF sertifikat: deskripsi panjang menimpa tanda tangan | `generate-certificate-pdf.ts` membungkus deskripsi dan memberi ruang; uji baru `generate-certificate-pdf.test.ts`. |
| Panduan santri menyebut halaman target yang tidak ada | `PANDUAN-PENGGUNA-SANTRI.md`: bagian target ibadah ditulis sebagai "melihat" (halaman target memang lingkup unit, bukan aksi santri). |

**Cacat dokumen yang ditemukan dan diperbaiki sesi ini (akibat perbaikan kode di atas).**

1. **Rute yang sudah tidak ada masih dikutip.** Riwayat revisi v0.7 menyebut
   `POST /api/certificates/:id/generate-pdf`, padahal cabang ini menggantinya
   dengan `GET /api/certificates/:id/download`; `check_docs.py` menandai
   `rute-tak-ada`. Kalimat basis kode pada baris itu dihapus.
2. **Jumlah hulu rute bergeser kembali.** `facts.json` mengukur **1.412** hulu
   rute (bukan 1.413), karena rute generate-pdf yang menaikkannya sudah tidak
   ada. Ringkasan bab 1 dan Lampiran A diperbaiki.
3. **Lampiran A baris `certificates` basi.** Kode kini 9 handler (bukan 10,
   karena rute generate-pdf dilepas). Diperbaiki; pemeriksa per baris yang
   ditambahkan sesi sebelumnya yang menangkapnya.
4. **Gerbang angka menolak riwayat revisi.** Pemeriksa angka baru (v0.7) ikut
   membaca baris riwayat revisi, sehingga kalimat sejarah "~1.413 hulu rute API
   (dari ~1.412)" ditandai ERROR selamanya. Baris riwayat (`| 0.7 | … |`) kini
   dikecualikan: ia mencatat keadaan saat commit itu, bukan klaim tentang pohon
   sekarang. Perilaku ini dikunci uji.
5. **Label tab di jalur menu ditolak pemeriksa.** `PANDUAN-PENGGUNA-SANTRI.md`
   menulis tab **Target Aktif** di jalur menu, padahal pemeriksa hanya menerima
   label menu. Tab disebut di langkah, jalur menu cukup sampai halaman.

**Uji regresi perkakas (baru).** `scripts/test_tooling.py` (19 uji, `unittest`)
mengunci jalur yang selama ini tak beruji: normalisasi rute (`:id`/`{id}`/`[id]`
menjadi satu bentuk), pemisahan sel tabel yang menghormati pipa di dalam
backtick, hitungan tabel yang mengabaikan blok kode, gerbang rute
(terdaftar/lolos, tak terdaftar/ERROR, metode salah/ERROR dengan petunjuk), serta
`verify_docx`/`verify_pdf` (tabel kurang, judul bab di dalam sel, tanpa "Daftar
Isi", kepala tabel tak terbaca di PDF). Ini jawaban langsung atas temuan Devin
"perkakas dokumen tanpa cakupan regresi".

**Riset standar (kelima, lewat web).** Tidak ada edisi yang berganti: arc42
tetap **v9 (Juli 2025)** (arc42.org/download — v9 menambah terjemahan Tionghoa;
Jerman sudah 9.1), C4 tetap tanpa edisi bernomor, ISO/IEC/IEEE 42010:2022 tetap
edisi berlaku (menggantikan 42010:2011), ISO/IEC/IEEE 26514:2022 tetap edisi
berlaku (ISO menandainya *Edition 1*, terbit 2022-01, menggantikan 26514:2008
yang ditarik), MADR 4.0.0 tetap template terkini (17 Sep 2024). Satu koreksi
kecil dilakukan pada `references/standar-dan-alasan.md`: sebutan "edisi ketiga"
untuk 26514 diganti dengan penjelasan yang benar (edisi pertama dari judul 2022).

**Pemeriksa mesin (30 September 2026, kelima).**

| Pemeriksa | Hasil |
|---|---|
| `check_docs.py --final` (DOKUMEN-TEKNIS) | 0 ERROR, 0 WARN |
| `check_docs.py --final` (sembilan panduan) | 0 ERROR, 0 WARN |
| `scripts/test_tooling.py` | 19 uji, OK |
| `pnpm --filter api build:strict` | kode keluar 0 |
| `pnpm --filter api test` | 349 berkas / 3.419 uji lulus |
| `pnpm --filter web test` | 45 berkas / 640 uji lulus |
| `pnpm format:check` | bersih (tiga berkas diformat ulang) |
| `scripts/check-doc-refs.py` | 1.821 rujukan = 1.821 berkas; 0 menggantung |

**Belum selesai.** Bab konsep/rujukan Panduan Umum masih T2; pemeriksa dokumen
belum berjalan di CI; `uno` tak tersedia sehingga daftar isi `.docx` terisi saat
dibuka (F9); e2e Playwright untuk perbaikan `certificates`/`rewards`/`violations`
belum dijalankan karena Docker tak tersedia di lingkungan ini (uji API untuk
kedua sisi sudah ada).

