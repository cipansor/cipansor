# Riwayat Revisi

| Versi | Tanggal | Basis aplikasi | Tingkat verifikasi | Perubahan |
|---|---|---|---|---|
| 0.1 | 29 September 2026 | commit `aefc719` | dari kode, belum dicoba di aplikasi berjalan | Penyusunan awal |
| 0.2 | 29 September 2026 | commit `aefc719` | dari kode, belum dicoba di aplikasi berjalan | Jalur ubah kata sandi dikoreksi (Profile → Keamanan, bukan Settings); nama menu dan tombol dicocokkan ke layar (Logout); nama enum basis data diganti label layar; istilah pengembang dikeluarkan |
| 0.3 | 29 September 2026 | commit `1a0e6b1e` (kode identik dengan `aefc719`) | dari kode, belum dicoba di aplikasi berjalan | Diperiksa ulang dengan pemeriksa skill terbaru; tidak ada isi yang berubah |
| 0.4 | 30 September 2026 | aplikasi berjalan dari kode PR #512 (setelah `main` `2377f5fb`) | **T1 — terverifikasi di aplikasi berjalan** | Bab "Mulai Memakai Aplikasi" (2.1–2.6) dijalankan dengan akun demo pada tumpukan lokal (PostgreSQL + API :3001 + web :3000). Dua koreksi dari layar sungguhan: ikon lonceng **membuka halaman Notifikasi Saya** (bukan panel), dan halaman pertama berlabel **Dashboard**. Tangkapan layar disematkan; pita ⚠ dibuka. Bab konsep dan rujukan (3–5) tetap disusun dari kode |

> **Tingkat verifikasi.** Bab **Mulai Memakai Aplikasi** (2.1–2.6) sudah
> **dijalankan pada aplikasi berjalan** dengan akun demo dan memuat tangkapan
> layar asli (T1). Bab **Konsep** dan **Rujukan** (3–5) disusun dengan membaca
> kode dan aturan yayasan, belum dijalankan per peran. Hanya orang yang memakai
> peran itu yang dapat memastikan sisanya.

# 1. Tentang Panduan Ini

## 1.1 Untuk siapa

Panduan ini untuk pegawai Yayasan Pesantren Cipansor yang memakai portal
Cipansor setiap hari: guru, wali kelas, tenaga administrasi, bendahara, kepala
unit, pendidik pesantren, dan pengurus yayasan. Setelah membaca panduan ini Anda
dapat masuk ke aplikasi, mengenal dasbor dan menu, serta menyelesaikan tugas
harian sesuai peran Anda.

## 1.2 Cara memakai panduan

Panduan ini disusun **per tugas**, bukan per menu. Cari tugas Anda (mis.
"Mencatat absensi harian"), lalu ikuti langkahnya. Setiap tugas berdiri sendiri,
jadi Anda tidak perlu membacanya berurutan.

## 1.3 Konvensi penulisan

| Tampilan | Arti |
|---|---|
| **Masuk** | Nama tombol atau isian, persis seperti di layar |
| Mengajar → Absensi | Jalur menu: klik menu pertama, lalu butir berikutnya |
| *Status menjadi "Menunggu Paraf"* | Hasil yang seharusnya tampak setelah sebuah langkah |
| ⚠ Belum dicoba di aplikasi berjalan | Langkah disusun dari kode dan belum diuji pada aplikasi yang berjalan |
| Ketersediaan | Fitur ada pada versi aplikasi yang dijelaskan panduan ini (bagian 1.4) |

## 1.4 Versi aplikasi yang dijelaskan

Panduan ini menjelaskan versi terbaru aplikasi per 29 September 2026. Aplikasi
yang Anda pakai mungkin belum memuat semua perubahan itu; bila layar Anda
berbeda dari yang dijelaskan, tanyakan kepada admin unit apakah versi terbaru
sudah dipasang. Tampilan dapat berubah antar versi. Di beberapa layar, santri
masih tertulis **Siswa** dan sebagian menu berbahasa Inggris; panduan ini
menulis nama tombol dan menu persis seperti di layar.

# 2. Mulai Memakai Aplikasi

## 2.1 Coba pertama kali (5 menit)

Ikuti urutan ini sekali untuk membiasakan diri. Anda hanya membaca; tidak ada
perubahan data.

1. Buka **portal.cipansor.or.id**, isi **Email** dan **Password**, klik **Masuk**.
   *Anda tiba di dasbor peran Anda.*
2. Perhatikan menu kiri. Kelompok teratas adalah pekerjaan harian Anda; klik
   salah satu butirnya.
   *Halaman tugas itu terbuka.*
3. Klik ikon lonceng di header.
   *Halaman **Notifikasi Saya** terbuka.*
4. Klik avatar (kanan atas), lalu **Profile**. Lihat halamannya tanpa mengubah
   apa pun.
   *Halaman profil terbuka dengan dua tab: **Profil** dan **Keamanan**.*
5. Klik avatar lagi, lalu **Logout**.
   *Anda kembali ke halaman masuk.*

![Gambar 1. Halaman masuk: isi Email dan Password, lalu klik Masuk.](screens/masuk-dan-kenal-aplikasi/01-halaman-masuk.png){width=14cm}

*Gambar 1. Halaman masuk: isi Email dan Password, lalu klik Masuk.*

![Gambar 2. Dasbor peran setelah masuk.](screens/masuk-dan-kenal-aplikasi/02-dasbor-peran.png){width=14cm}

*Gambar 2. Dasbor peran setelah masuk.*

![Gambar 3. Ikon lonceng membuka halaman Notifikasi Saya.](screens/masuk-dan-kenal-aplikasi/04-notifikasi.png){width=14cm}

*Gambar 3. Ikon lonceng membuka halaman Notifikasi Saya.*

Setelah mencoba, lanjutkan ke bagian tugas sesuai peran Anda (bagian 4.5).

## 2.2 Membuka aplikasi dan masuk

1. Buka **portal.cipansor.or.id** di peramban.
2. Isi **Email** dengan alamat surel yayasan Anda.
3. Isi **Password** dengan kata sandi Anda.
4. Klik **Masuk**.
   *Bila berhasil, Anda masuk ke dasbor peran Anda.*

Halaman situs publik (cipansor.or.id) tidak memiliki kotak masuk; masuk selalu
dari portal.

## 2.3 Verifikasi dua langkah (bila diwajibkan)

Verifikasi dua langkah (2FA) **wajib** bagi peran admin unit, organ yayasan, dan
kepala unit; staf dan wali santri diundang mengaktifkannya (boleh memilih "Nanti
saja").

1. Setelah email dan password benar, aplikasi meminta kode dari aplikasi
   autentikator Anda.
   *Muncul layar permintaan kode enam angka.*
2. Buka aplikasi autentikator, lalu ketik kodenya.
   *Anda masuk dan sesi berlanjut.*

![Gambar 4. Layar Verifikasi Dua Langkah meminta kode dari aplikasi autentikator.](screens/masuk-verifikasi-dua-langkah/04-klik-masuk.png){width=14cm}

*Gambar 4. Layar Verifikasi Dua Langkah meminta kode dari aplikasi autentikator.*

Bila akun Anda wajib 2FA tetapi belum menyiapkannya, aplikasi mengarahkan Anda
menyiapkannya setelah email dan password benar (memindai kode QR dengan aplikasi
autentikator).

## 2.4 Mengenal dasbor, menu, dan notifikasi

- **Dashboard** adalah halaman pertama setelah masuk; isinya berbeda per peran
  (guru di `/teacher`, staf di `/staff`, kepala unit di `/dashboard`, wali
  santri di `/parent`, dan seterusnya).
- **Menu** ada di sisi kiri dan berkelompok. Kelompok yang muncul bergantung
  pada peran **utama** Anda.
- **Notifikasi** ada di ikon lonceng pada header; ikon itu **membuka halaman
  Notifikasi Saya** yang memuat kotak masuk pribadi Anda.

## 2.5 Mengubah kata sandi dan profil

Klik avatar (kanan atas), lalu **Profile**. Nama dan data profil ada di tab
**Profil**; kata sandi ada di tab **Keamanan**, pada kartu **Ubah Password**:
isi **Password Lama**, **Password Baru**, dan **Konfirmasi Password Baru**, lalu
klik **Ubah Password**. Kata sandi minimal 15 karakter, atau 8 karakter bila
verifikasi dua langkah aktif; kalimat pendek yang mudah Anda ingat paling baik,
dan tidak perlu huruf besar, angka, atau simbol. Hindari kata sandi yang umum
atau memuat nama akun. (Halaman **Settings** tidak dipakai untuk kata sandi.)
Tidak ada tombol "lupa sandi" mandiri — bila lupa kata sandi, minta admin unit
mengirim tautan reset dari menu Pengguna.

![Gambar 5. Tab Keamanan pada halaman profil memuat kartu Ubah Password.](screens/masuk-dan-kenal-aplikasi/05b-tab-keamanan.png){width=14cm}

*Gambar 5. Tab Keamanan pada halaman profil memuat kartu Ubah Password.*

## 2.6 Keluar

Klik avatar (kanan atas), lalu **Logout**. Sesi berakhir; jangan biarkan
aplikasi terbuka di komputer bersama.

# 3. Konsep yang Perlu Diketahui

## 3.1 Mengapa menu setiap orang berbeda

Menu Anda ditentukan oleh **peran utama** Anda. Satu orang bisa punya beberapa
penugasan (mis. guru yang juga wali kelas, atau Kiai yang juga Pembina), tetapi
hanya penugasan utama yang menentukan menu. Karena itu, sebagian tugas muncul
sebagai **grup bersyarat**: grup **Wali Kelas** hanya tampil bagi guru yang
benar-benar wali kelas sebuah kelas pada tahun ajaran berjalan.

## 3.2 Hak akses: halaman dan tindakan berbeda

Bisa membuka halaman tidak berarti boleh melakukan tindakannya. Aplikasi
memeriksa lagi setiap tindakan di server. Sebaliknya, kadang tombol tampil
meski server menolak — bila itu terjadi, laporkan ke pengelola sistem.

## 3.3 Data santri dan privasi

Wali santri hanya melihat data anaknya sendiri. Sebagian data bergantung pada
**baris**, bukan hanya peran: misalnya izin santri mukim diputuskan oleh
musyrifnya, sedangkan izin santri harian oleh wali kelasnya. Aplikasi tidak
pernah menampilkan data santri lintas unit kepada peran yang terkunci pada satu
unit. Jangan membagikan tangkapan layar berisi data santri.

# 4. Rujukan

## 4.1 Arti status (perizinan)

| Status di layar | Arti | Giliran siapa |
|---|---|---|
| Menunggu | Baru diajukan | Pemutus: musyrif atau wali kelas santri itu |
| Disetujui | Sudah diputuskan | Santri menunggu pintu gerbang |
| Ditolak | Ditolak dengan alasan | Pemohon membaca alasan |
| Selesai | Sudah keluar dan kembali | — |
| Dibatalkan | Dibatalkan pemohon | — |

## 4.2 Peran dan tanggung jawab singkat

| Kelompok peran | Tugas utama di aplikasi |
|---|---|
| Organ yayasan | Mengesahkan dokumen strategis dan anggaran, pengawasan, risiko, kepatuhan syariah |
| Kepala unit | Menyusun RKA unit, akademik, menilai kinerja guru |
| Guru | Mengajar, absensi, penilaian, laporan harian; wali kelas menindaklanjuti absensi dan perilaku |
| Pendidik pesantren | Tahfidz, ibadah, perizinan santri mukim, asrama |
| Tata usaha / bendahara | Administrasi, keuangan, verifikasi pembayaran |
| Wali santri | Memantau perkembangan, tagihan, izin, laporan harian anak |
| Santri | Hafalan, ujian, jadwal, portofolio |

## 4.3 Pesan yang sering muncul

| Pesan | Artinya | Yang perlu dilakukan |
|---|---|---|
| "Terlalu banyak percobaan kode. Coba lagi dalam 15 menit." | Kode verifikasi dua langkah salah terlalu sering | Tunggu 15 menit, lalu coba lagi |
| "Terlalu banyak permintaan reset password. Silakan coba lagi nanti." | Permintaan tautan reset terlalu sering | Tunggu, lalu coba lagi |
| "Anda tidak memiliki akses ke data anak ini" | Anda mencoba membuka data santri yang bukan anak Anda | Periksa akun yang dipakai; hubungi admin unit bila keliru |
| "Data tidak ditemukan" | Data sudah dihapus atau di luar lingkup Anda | Muat ulang halaman |

Pesan lain berbeda menurut layar; kartu tugas di buklet peran mencantumkan pesan
yang muncul pada tugas itu.

## 4.4 Glosarium

| Istilah | Arti |
|---|---|
| Santri | Sebutan pelajar di seluruh portal Cipansor |
| Wali santri | Orang tua/penanggung jawab santri |
| Wali kelas | Guru yang membina satu kelas; tugas tambahan, bukan peran terpisah |
| Musyrif | Pembimbing asrama |
| Muhafidz | Pembimbing hafalan |
| Tahfidz | Program menghafal Al-Qur'an |
| Tahsin | Perbaikan bacaan |
| Takhosus | Program khusus (takhassus) |
| Kitab Kuning | Kajian kitab klasik pesantren |
| Mutabaah Yaumiyah | Catatan ibadah harian santri |
| SPMB | Sistem Penerimaan Murid Baru |
| TTE | Tanda Tangan Elektronik |

## 4.5 Peta tugas menurut peran

Tabel ini adalah **rujukan** (Diátaxis): dari peran ke tugas dan ke bukletnya.
Tanda "—" berarti tugas itu tidak menjadi kewajiban peran tersebut.

| Peran | Tugas harian utama | Buklet |
|---|---|---|
| Guru | Absensi, penilaian, laporan harian/Mutabaah | Panduan Pengguna — Guru |
| Wali kelas (guru dengan penugasan) | Absensi harian, tindak lanjut Alpa, catatan perilaku, putuskan izin | Panduan Pengguna — Sekolah (menyusul) |
| Pendidik pesantren (musyrif, muhafidz, ustadz) | Tahfidz, ibadah, putuskan izin santri mukim, asrama | Panduan Pengguna — Pesantren (menyusul) |
| Tata usaha / bendahara / pustakawan / perawat / keamanan / pengelola unit usaha | Administrasi, keuangan, layanan | Panduan Pengguna — Administrasi & Layanan (menyusul) |
| Kepala unit / kepala sekolah | RKA unit, akademik, penilaian kinerja, izin panjang | Panduan Pengguna — Kepemimpinan Unit (menyusul) |
| Organ yayasan (Pembina, Pengurus, Pengawas) | Pengesahan dokumen, pengawasan, risiko, kepatuhan syariah | Panduan Pengguna — Tata Kelola Yayasan (menyusul) |
| Wali santri | Perkembangan anak, tagihan, izin, laporan harian | Panduan Pengguna — Wali Santri (menyusul) |
| Santri | Hafalan, ujian, jadwal, portofolio | Panduan Pengguna — Santri (menyusul) |

Buklet per peran disusun dengan pola yang sama seperti buklet Guru: satu bab
tugas berisi kartu tugas (tujuan, siapa, jalur menu, langkah, hasil, jika gagal,
ketersediaan).

# 5. Bantuan

Bila panduan ini keliru atau kurang, laporkan kepada **admin unit** Anda, yang
meneruskannya ke pengelola sistem (Super Admin). Sebutkan halaman, tombol, dan
apa yang Anda harapkan terjadi. Untuk masalah akun (lupa sandi, akun terkunci),
hubungi admin unit; mereka dapat mengirim tautan reset dari menu **Pengguna**.

# Lampiran — Belum Tersedia atau Dalam Perbaikan

| Tugas | Keadaan | Sumber |
|---|---|---|
| Pesan Orang Tua (wali kelas) | Alur belum tersambung ke API | `known-issues.md` |
| Jadwal kelas dan guru | Sebagian panggilan API belum cocok | `known-issues.md` |
| Halaman Karyawan (HR) | Halaman belum tersambung | `known-issues.md` |
| Halaman Sertifikat | Alamat tujuan belum tersedia | `known-issues.md` |
| Pengaturan notifikasi | Belum menyimpan ke server | `known-issues.md` |
