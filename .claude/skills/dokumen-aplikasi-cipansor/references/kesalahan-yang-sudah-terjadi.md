# Kesalahan yang sudah terjadi — dan cara skrip menangkapnya

Semua entri di bawah **pernah terbit** pada percobaan pertama skill ini (29 September 2026) dan lolos karena
tidak ada yang memeriksanya terhadap kode. Tiap entri: gejala · akar · pemeriksa · cara yang benar. Bacalah sebelum
menulis; jalankan `check_docs.py` sesudah tiap bab. Kolom *Pemeriksa* menyebut kode pesan yang akan Anda lihat.

## A. Fakta yang tidak cocok dengan kode

| # | Gejala | Akar | Pemeriksa | Yang benar |
|---|---|---|---|---|
| A1 | Diagram menulis `POST /admissions/public/register`; rute itu tidak ada (yang ada `/public/registrants`) | Alamat ditulis dari nama fitur, bukan dibaca dari `*.routes.ts` | `rute-tak-ada` (mencetak alamat terdekat) | `grep -n "router\." …/<modul>.routes.ts`, salin alamatnya |
| A2 | "14 pekerjaan terjadwal"; sebenarnya 15 entri cron atas 13 berkas, dan `asset-depreciation.job` tidak dijadwalkan (dipanggil dari `inventory`) | Menghitung berkas `*.job.ts` dan menyebutnya "terjadwal" | `angka-salah`, `job-tak-terjadwal` | "N entri jadwal atas M berkas" dari `facts.md → jobs` |
| A3 | "66 dari 93 modul punya tata letak lengkap" sementara repo sendiri mencatat 22 dari 93 | Dua definisi berbeda dicampur; yang lebih longgar dipilih tanpa menyebut definisinya | `ukuran-tata-letak` | Sebut keduanya: 66 punya empat berkas, 24 punya lima bagian (dengan `index.ts`) |
| A4 | ERD berisi `ROLE_ASSIGNMENT`, `ENROLLMENT`, `KELAS` yang bukan model | Nama diterjemahkan/dikarang, relasi ditebak | `erd-model-fiktif` | Nama model persis dari `schema.prisma`; relasi dari `@relation` |
| A5 | Langkah "tandatangani" pada diagram persuratan tanpa rute; `submit` dilewati | Alur diringkas dari ingatan | `rute-tak-ada` (bila dipaksa METODE), resep bab 6 | Baca routes → controller → service; tiap panah = rute nyata |
| A6 | "Rilis produksi belum dijalankan sejak 27 September" | Tanggal *persetujuan ditunda* dibaca sebagai tanggal rilis | tidak otomatis | Kutip persis; ragu → jangan tulis |
| A7 | Bab 5.3 tidak menyebut `students`, `parent`, `meals`, `paud-report`, `scholarship` | Daftar "contoh modul" dibuat dari ingatan | `modul-tak-tercantum` | Kelompokkan **semua** modul dari `facts.json` |
| A8 | Angka `1.457 res.json / 399 ApiResponse` dan `13 rute vs 670` muncul tanpa sumber | Disalin dari `known-issues.md` (ukuran tanggal lain) | `risiko-rinci`; aturan angka | Angka hanya dari `facts.json`, atau sebut sumber + tanggalnya |
| A9 | Tabel status memakai `Menunggu (PENDING)` | Templat meminta "enum status modul terkait" | `nama-enum` | Label layar dari `hooks/use-*.ts` |
| A10 | Menu avatar ditulis "Keluar"; layarnya "Logout". Ubah kata sandi ditulis di "Settings"; sebenarnya Profile → Keamanan | Label diterjemahkan/ditebak dari nama menu | `label-layar` (sebagian), jejak `--trace` | Cari labelnya: `grep -rn "Logout" apps/web/src` |
| A11 | Kartu absensi: status "Alpa" sebagai tombol (tombolnya **Tidak Hadir**, berbentuk ikon); penyebab `Simpan` nonaktif dikarang ("belum ada perubahan") | Kartu T2 disusun tanpa membaca `page.tsx` sampai selesai | `label-layar`, `pesan-karangan`; resep T2 | Baca nilai bawaan, `disabled`, label, toast dari `page.tsx` |
| A12 | Pesan "Tidak memiliki akses" dikutip dalam tanda kutip; tak ada di kode | Pesan diparafrase lalu dikutip | `pesan-karangan` | Salin persis dari toast/Alert/pesan API |
| A13 | Dua gambar di buklet santri sama-sama menampilkan Jurnal Ibadah: "Papan Peringkat" (langkahnya `goto /ibadah`) dan "Kelola Target" (halaman sebenarnya `/ibadah/targets`) | Langkah alur tidak menunjuk halaman yang dimaksud; tak seorang pun membuka gambarnya | tak otomatis — `screenshot-flow.ts` hanya memeriksa `see`, bukan apakah tangkapan cocok dengan judul kartu | Arahkan langkah `goto` ke halaman yang benar (`/ibadah/leaderboard`, `/ibadah/targets`) dan **buka gambarnya** sebelum menyerahkan; `see` yang cocok tidak menjamin layarnya benar |
| A14 | Bab 1 menulis "~1.412 hulu rute API"; angka nyata 1.413 (rute `POST /api/certificates/:id/generate-pdf` ditambahkan di pohon kerja) | Angka ditulis saat pengukuran lama, tak ada pola pemeriksa untuknya | `angka-salah` — kini ada pola `(\d[\d.]*)\s+hulu rute` → `api.handler_count_approx` | Tulis angka dari `facts.json` dan sebut basis commitnya; jangan menyunting angka dengan tangan |
| A15 | Lampiran A punya **94 baris = 94 modul** (jumlah benar) tetapi **lima barisnya basi**: `certificates` 9 (kode 10), `rewards` 9 (10), `violations` 7 (8), `hr` 37 (42), `organisasi` 11 (12) | Pemeriksa lama hanya membandingkan **jumlah baris**, bukan isi tiap baris; modul bertambah rute tetapi baris lampirannya tidak diukur ulang | `lampiran-a-handler`, `lampiran-a-mount`, `lampiran-a-layering` (kini ada) | Ukur ulang Lampiran A baris demi baris dari `facts.json`; **jumlah yang cocok bukan bukti isi yang cocok** (bandingkan C5) |

## B. Kebocoran dan kepekaan

| # | Gejala | Akar | Pemeriksa | Yang benar |
|---|---|---|---|---|
| B1 | Bab 11: "satu tabel menampilkan NIK penuh" | Baris `known-issues.md` dirangkum mentah | `risiko-topik-peka` | Kategori + dampak saja; ragu → tahan dan laporkan |
| B2 | Bab 11: "13 rute memeriksa izin vs 670 memeriksa kelompok lama" | Detail peta otorisasi ikut tersalin | `risiko-rinci` | "Daftar izin belum sejalan dengan pemeriksaan sebenarnya. Dampak sedang." |
| B3 | Manual guru: "perbaikan #585; produksi menyusul" | Status cabang/main/produksi dicetak di manual | `nomor-pr`, `produksi-tertinggal`, `istilah-pengembang` | Satu kalimat versi di "Tentang"; status dilaporkan ke pengguna di percakapan |
| B4 | Diagram penempatan menyebut "jaringan privat" | Detail postur jaringan tidak perlu | tinjauan manual | Sebut jenis layanan saja |

## C. Struktur, bentuk, dan tampilan

| # | Gejala | Akar | Pemeriksa | Yang benar |
|---|---|---|---|---|
| C1 | **Semua tabel di `.docx`/PDF rusak**: kepala hijau tanpa teks, sel kosong, isi tercecer sebagai paragraf (Lampiran A: 17 halaman satu nilai per baris), judul bab masuk ke sel | Berkas biner dibangun di lingkungan yang merusaknya (LibreOffice tanpa komponen Writer / round-trip); tak seorang pun membuka hasilnya | `build_docs.py` → `verify_docx` (GAGAL), `verify_pdf` | Bangun ulang; bila `verify_docx` gagal jangan menyerahkan; lihat pesan |
| C2 | Jalur menu tercetak `\`/attendance/record\`` | Templat menampilkan backtick di dalam backtick; model meniru | `backtick-lolos` | `Grup → Butir (`/rute`)` |
| C3 | Diagram penempatan: `Prod[...]` dan `subgraph Prod` (simpul "Produksi" hilang) | Bug ada di templat; model menyalinnya | `diagram-id-ganda` | Id simpul unik, ≠ id subgraph |
| C4 | Tiga "diagram C4" tanpa label pada panah; tingkat 3 (komponen) tidak ada tetapi evaluasi menulis "Sesuai" | Daftar periksa tidak mekanis; penilaian sendiri terlalu murah hati | `c4-hilang`, `c4-panah-tanpa-label` | Keterangan `C4-1/2/3`, tiap panah berlabel; `packages/shared` bukan kontainer |
| C5 | Bab 9: `akreditasi-unit.md` muncul dua kali sementara dua berkas persuratan digabung dalam satu baris, hingga "23 baris = 23 berkas" cocok secara kebetulan | Jumlah baris dijadikan ukuran, bukan pemetaan berkas ke baris | `keputusan-ganda` | Tepat satu baris per berkas |
| C6 | Bab 10 tanpa ukuran; satu baris berupa cacat ("optimizer gambar tidak jalan") dan satu kalimat berbalik ("…tidak merges") | Tabel templat tidak meminta ukuran | `mutu-skenario`, `mutu-tanpa-angka` | Kolom `Ukuran / ambang`; cacat ke bab 11 |
| C7 | "tiga bahasa (Indonesia, Inggris, Arab, Arab RTL)" | Butir ganda dalam daftar berhitung | `hitungan-daftar` | "Indonesia, Inggris, Arab; Arab kanan ke kiri" |
| C8 | ERD 15 entitas dirender sangat kecil | Terlalu lebar untuk satu halaman | tinjauan | ≤ 20 entitas, `TB` bila perlu |
| C9 | Satu diagram gagal dirender (`Class` adalah kata kunci Mermaid) tetapi build tetap "OK" dan diagram terbit sebagai blok kode | `Class` diganti `KELAS` di percobaan pertama (itulah asal ERD fiktif A4); kegagalan hanya berupa peringatan | `build_docs.py` kini GAGAL bila ada diagram gagal | Tulis `"Class"` dengan tanda kutip; nama model tetap nama Prisma |

## D. Proses

| # | Gejala | Akar | Yang benar |
|---|---|---|---|
| D1 | Evaluasi diri menilai hampir semuanya "Sesuai" sambil kerusakan C1 ada di PDF yang dihasilkan | Menilai dokumen terhadap standar, tidak terhadap kode maupun hasil render | Penilaian = keluaran pemeriksa mesin; nilai "Sesuai" hanya bila `check_docs.py`, `verify_docx`, `verify_pdf` bersih |
| D2 | "Angka cocok persis" dijadikan bukti akurasi | Skrip yang sama mengukur dan memeriksa (sirkular) | Bukti akurasi = klaim yang **bukan** angka (rute, label, nama model) diperiksa terhadap kode |
| D3 | Skill menyebut jalur `/mnt/skills/...`, `present_files`, `ask_user_input_v0` (khusus chat) sementara dijalankan di repo | Skill ditulis untuk satu lingkungan lalu dipasang di repo | `SKILL.md` kini berisi perintah yang jalan di repo mana pun; jalur khusus lingkungan tidak ada |
| D4 | Templat memuat Sentry dan `lib/realtime.ts` yang sudah dihapus | Templat membeku pada satu tanggal | Templat menyuruh memverifikasi tiap sistem luar terhadap `facts.md`; cek `progress.md` untuk yang dihapus |
| D5 | `.docx`/`.pdf` ikut di-commit dan bisa berbeda dari `.md` | Tiga salinan yang tak bisa ditinjau (git: "Binary files differ") | `.docx`/`.pdf` tidak lagi dilacak: hanya `.md` yang masuk git, biner dibangun ulang saat dibutuhkan |
