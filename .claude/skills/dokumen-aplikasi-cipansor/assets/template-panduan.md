<!--
TEMPLAT PANDUAN PENGGUNA — Sistem Informasi Cipansor.
Dua bentuk dalam satu berkas; pakai salah satu per terbitan:
  (A) BAGIAN UMUM  — untuk semua peran (hapus bagian B)
  (B) BUKLET PERAN — satu keluarga peran (hapus bagian A)
Isi tiap [ISI: …] dari sumber di references/panduan-pengguna.md. Hapus komentar ini.
Judul/versi/sampul diberikan lewat opsi build_docs.py.
Tingkat verifikasi (T1/T2/T3) WAJIB dinyatakan di Riwayat Revisi.

PEMBACANYA BUKAN PENGEMBANG. Di seluruh teks (kecuali Riwayat Revisi dan banner ⚠) DILARANG:
nama enum basis data (PENDING, APPROVED), nomor PR (#585), kata main/cabang/commit/staging/produksi,
kode HTTP (403), jalur berkas kode. Tulis label yang TAMPIL DI LAYAR. Setelah tiap bagian selesai:
  python scripts/check_docs.py naskah.md --kind pengguna --repo <repo> --facts facts.json --trace jejak.md
-->

<!-- ======================= (A) BAGIAN UMUM ======================= -->

# Riwayat Revisi

| Versi | Tanggal | Basis aplikasi | Tingkat verifikasi | Perubahan |
|---|---|---|---|---|
| [ISI: 0.1] | [ISI: tanggal] | commit [ISI: hash] | [ISI: T1 terverifikasi di aplikasi berjalan / T2 dari kode, belum dicoba / campuran — sebut bagian mana] | Penyusunan awal |

# 1. Tentang Panduan Ini

## 1.1 Untuk siapa

[ISI: pembaca panduan ini dan apa yang bisa mereka lakukan setelah membacanya.]

## 1.2 Cara memakai panduan

Panduan ini disusun **per tugas**, bukan per menu. Cari tugas Anda di daftar isi, lalu ikuti langkahnya.

## 1.3 Konvensi penulisan

| Tampilan | Arti |
|---|---|
| **Simpan** | Nama tombol atau isian, persis seperti di layar |
| Kinerja → Manajemen Kinerja | Jalur menu: klik menu pertama, lalu turun ke butir berikutnya |
| *Status menjadi Menunggu Paraf* | Hasil yang seharusnya tampak setelah sebuah langkah |
| ⚠ Belum dicoba di aplikasi berjalan | Langkah disusun dari kode dan belum diuji pada aplikasi yang berjalan |
| Ketersediaan | Fitur ada pada versi aplikasi yang dijelaskan panduan ini (bagian 1.4) |

## 1.4 Versi aplikasi yang dijelaskan

[ISI: tanggal versi yang dijelaskan (commit hanya di Riwayat Revisi). Tulis: "Aplikasi yang Anda pakai mungkin belum memuat semua perubahan; bila layar Anda berbeda, tanyakan admin unit." JANGAN menyebut perbaikan atau fitur mana yang belum di produksi.]

# 2. Mulai Memakai Aplikasi

## 2.1 Membuka aplikasi dan masuk

[ISI: dari layar nyata. Sertakan Gambar 1 — halaman masuk.]

## 2.2 Verifikasi dua langkah (untuk peran yang diwajibkan)

[ISI: hanya untuk peran yang diwajibkan (decisions/autentikasi-2fa-dan-sandi.md). Sumber: halaman login dan halaman Profile → tab Keamanan.]

## 2.3 Mengenal dasbor, menu, dan notifikasi

[ISI: apa itu dasbor per peran; menu di sisi kiri; notifikasi. Jangan menyalin pohon menu.]

## 2.4 Mengubah kata sandi dan profil

[ISI: cari di kode DI MANA layar itu berada (grep "Ubah Password" apps/web/src) — jangan menebak dari nama menu. Salin aturan panjang kata sandi dari packages/shared/src/password-policy.ts.]

## 2.5 Keluar

[ISI]

# 3. Konsep yang Perlu Diketahui

## 3.1 Mengapa menu setiap orang berbeda

[ISI: satu halaman — peran menentukan menu; satu orang bisa punya beberapa penugasan, yang utama menentukan menu.]

## 3.2 Persetujuan berjenjang

[ISI: siapa menyusun, siapa memeriksa, siapa mengesahkan; dokumen yang sudah disahkan dibekukan. Sumber: decisions/pengesahan-dokumen-yayasan.md.]

## 3.3 Data santri dan privasi

[ISI: siapa boleh melihat apa; wali santri hanya melihat data anaknya. Sumber: panduan-peran, prisma-include-leaks-pii.md.]

# 4. Rujukan

## 4.1 Arti status

| Status di layar | Arti | Giliran siapa |
|---|---|---|
| [ISI: LABEL yang tampil (mis. "Menunggu"), dicari di hooks/use-*.ts — BUKAN nama enum] | [ISI] | [ISI] |

## 4.2 Peran dan tanggung jawab singkat

| Kelompok peran | Tugas utama di aplikasi |
|---|---|
| [ISI: dari panduan-peran, ringkas] | [ISI] |

## 4.3 Pesan yang sering muncul

| Pesan | Artinya | Yang perlu dilakukan |
|---|---|---|
| [ISI: teks PERSIS dari toast / Alert / pesan API di kode; jangan diparafrasekan atau dipendekkan] | [ISI] | [ISI] |

## 4.4 Glosarium

| Istilah | Arti |
|---|---|
| [ISI: ejaan yayasan — Tahfidz, Tahsin, Takhosus, Kitab Kuning; istilah pesantren tidak diterjemahkan] | [ISI] |

# 5. Bantuan

[ISI: ke peran mana bertanya (bukan nama orang), dan cara melaporkan kekeliruan panduan.]

# Lampiran — Belum Tersedia atau Dalam Perbaikan

| Tugas | Keadaan | Sumber |
|---|---|---|
| [ISI: alur yang dicatat known-issues.md; jangan disajikan seolah jalan] | [ISI] | [ISI] |


<!-- ======================= (B) BUKLET PERAN ======================= -->

# Riwayat Revisi

| Versi | Tanggal | Basis aplikasi | Tingkat verifikasi | Perubahan |
|---|---|---|---|---|
| [ISI: 0.1] | [ISI: tanggal] | commit [ISI: hash] | [ISI: T1 / T2 / campuran] | Penyusunan awal |

# 1. Tentang Buklet Ini

Buklet ini untuk **[ISI: keluarga peran, mis. Guru]**. Bagian umum (masuk, dasbor, konsep, glosarium) ada di *Panduan Pengguna — Bagian Umum*.

## 1.1 Siapa Anda di aplikasi

[ISI: peran ini siapa di yayasan; kode peran yang termasuk; dasbor awalnya. Sumber: panduan-peran, role-menus.ts --families.]

## 1.2 Yang bisa dan tidak bisa Anda lakukan

[ISI: hasil empat lapis (menu → halaman → rute API → service dan data). Sebut aturan yang bergantung
baris, bukan hanya peran — mis. izin santri diputuskan musyrif atau wali kelas santri itu.]

## 1.3 Tugas dalam buklet ini

| Tugas | Seberapa sering | Menu |
|---|---|---|
| [ISI: daftar tugas dalam istilah kerja] | [ISI: harian / bulanan / tahunan] | [ISI: Grup → Butir, dicetak dari role-menus.ts] |

# 2. Tugas

[ISI: satu kartu per tugas — salin assets/template-kartu-tugas.md untuk tiap tugas.]

# 3. Bila Ada Masalah

[ISI: masalah umum lintas tugas untuk peran ini, dan ke mana melapor.]
