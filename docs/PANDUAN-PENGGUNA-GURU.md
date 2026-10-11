# Riwayat Revisi

| Versi | Tanggal | Basis aplikasi | Tingkat verifikasi | Perubahan |
|---|---|---|---|---|
| 0.1 | 29 September 2026 | commit `aefc719` | dari kode, belum dicoba di aplikasi berjalan | Penyusunan awal |
| 0.2 | 29 September 2026 | commit `aefc719` | dari kode, belum dicoba di aplikasi berjalan | Langkah dan nama tombol diperiksa ulang satu per satu ke kode layar; pesan yang dikutip disalin dari kode; istilah pengembang dan nomor PR dikeluarkan; kartu izin dipersempit ke wali kelas |
| 0.3 | 29 September 2026 | commit `1a0e6b1e` (kode identik dengan `aefc719`) | dari kode, belum dicoba di aplikasi berjalan | Nama butir menu **Mengajar** ditulis persis seperti layar ("Siswa") supaya tidak terbaca sebagai prosa. Isi kartu tidak berubah |
| 0.4 | 30 September 2026 | aplikasi berjalan dari kode PR #512 (setelah `main` `2377f5fb`) | **T1 — terverifikasi di aplikasi berjalan** | Keempat kartu dijalankan dengan akun demo `sdit.walikelas@` pada tumpukan lokal (PostgreSQL + API :3001 + web :3000); langkah, nama tombol, dan pesan dicocokkan ulang dengan layar sungguhan dan tangkapan layar disematkan. Pita ⚠ dibuka; Riwayat Revisi mencatat tingkat T1 |

> **Tingkat verifikasi T1.** Semua kartu tugas di bawah sudah **dijalankan pada
> aplikasi berjalan** dengan akun demo wali kelas SD IT (absensi harian, tindak
> lanjut Alpa, catatan perilaku, dan memutuskan izin). Tiap langkah diverifikasi
> terhadap layar sungguhan dan tiap kartu memuat tangkapan layar asli. Bila Anda
> menemukan layar yang berbeda dari gambar di sini, laporkan kepada admin unit.

# 1. Tentang Buklet Ini

Buklet ini untuk **guru** (`*_GURU`, `*_GURU_BK`) di semua unit — TK Qur'an,
SD IT, SMP IT, dan SMA Qur'an. Bagian umum (masuk, dasbor, konsep, glosarium)
ada di *Panduan Pengguna — Bagian Umum*.

Buklet ini menjelaskan versi aplikasi terbaru per 29 September 2026. Aplikasi
yang Anda pakai mungkin belum memuat semua perubahan itu; bila layar Anda
berbeda dari yang dijelaskan, tanyakan kepada admin unit apakah versi terbaru
sudah dipasang. Di beberapa layar, santri masih tertulis **Siswa**; buklet ini
menulis nama tombol dan judul persis seperti di layar.

## 1.1 Siapa Anda di aplikasi

Sebagai guru, dasbor awal Anda adalah halaman **Dashboard** di bawah kelompok
**Ringkasan**. Menu Anda memuat kelompok **Mengajar** ("Tahfidz", "Kelas Saya",
"Siswa", "Absensi", "Mutabaah Yaumiyah", "Portfolio Siswa") dan, bila Anda ditunjuk
wali kelas sebuah kelas pada tahun ajaran berjalan, kelompok tambahan **Wali
Kelas**. Wali kelas bukan peran terpisah: ia melekat pada kelas, sehingga
kelompok itu bisa muncul dan hilang sesuai penugasan Anda.

## 1.2 Yang bisa dan tidak bisa Anda lakukan

- Anda melihat kelas dan mata pelajaran yang Anda ampu; guru lain tidak.
- Anda **mengisi absensi** kelas yang Anda ajar maupun kelas yang Anda wali.
- Sebagai wali kelas Anda memutuskan izin **santri harian** di kelas Anda.
  Izin santri mukim diputuskan musyrif santri itu (lihat buklet Pendidik
  Pesantren). Kepala unit hanya turun tangan untuk izin lebih dari 7 hari,
  santri tanpa pembimbing, atau mengambil alih.
- Data santri hanya tampil sebatas kelas dan unit Anda.

## 1.3 Tugas dalam buklet ini

| Tugas | Seberapa sering | Menu |
|---|---|---|
| Mencatat absensi harian | Harian | Wali Kelas → Absensi Harian |
| Menindaklanjuti Alpa | Harian saat ada Alpa | Wali Kelas → Tindak Lanjut Absensi |
| Menulis catatan perilaku | Sesuai kejadian | Wali Kelas → Catatan Perilaku |
| Memutuskan izin santri harian | Sesuai pengajuan | Wali Kelas → Perizinan |

# 2. Tugas

## Mencatat absensi harian

**Tujuan.** Mencatat kehadiran santri satu kelas untuk satu tanggal.

**Siapa.** Wali kelas dari kelas itu, guru yang mengajar di kelas itu, dan operator
unit. Guru lain tidak dapat mengisi.

**Jalur menu.** Wali Kelas → Absensi Harian (`/attendance/record`). Guru
pengampu yang bukan wali kelas: Mengajar → Absensi (`/attendance`), lalu klik
tombol **Isi Absensi Harian** di kanan atas halaman.

**Sebelum mulai.** Anda sudah ditugaskan sebagai wali kelas atau pengajar di
sebuah kelas pada tahun ajaran berjalan, dan santri sudah terdaftar di kelas
itu.

**Langkah.**

1. Buka **Absensi Harian** lewat jalur menu di atas.
   *Halaman terbuka pada kelas pertama di daftar kelas Anda, lengkap dengan daftar santrinya.*
2. Bila perlu kelas lain, buka pilihan **Kelas** dan pilih satu. Nama tiap kelas
   diikuti "Wali Kelas" atau "Mengajar".
   *Daftar santri berganti mengikuti kelas.*
3. Bila perlu tanggal lain, klik tombol tanggal dan pilih tanggalnya. Hari ini
   dapat dipilih; tanggal sesudah hari ini tidak.
   *Bila tanggal itu sudah pernah diisi, muncul peringatan kuning bahwa data kehadiran untuk tanggal ini sudah ada dan menyimpan akan memperbaruinya.*
4. Untuk tiap santri, klik satu tombol status. Tombolnya berbentuk ikon; arahkan
   kursor untuk melihat namanya: **Hadir**, **Tidak Hadir**, **Terlambat**,
   **Sakit**, atau **Izin**.
   *Tombol yang dipilih berwarna dan angka ringkasan berubah.*
5. Untuk mengisi sekaligus, klik **Semua Hadir** atau **Semua Tidak Hadir**,
   lalu ubah santri yang berbeda.
6. Bila perlu, isi kolom **Keterangan** di samping nama santri.
7. Klik **Simpan Kehadiran**.
   *Muncul pesan "Kehadiran disimpan:" diikuti jumlah data baru dan yang diperbarui. Menyimpan ulang pada tanggal yang sama memperbarui register itu.*

![Gambar 1. Halaman Absensi Harian dengan daftar santri dan tombol status.](screens/absensi-harian/02-absensi-harian.png){width=14cm}

*Gambar 1. Halaman Absensi Harian dengan daftar santri dan tombol status.*

![Gambar 2. Pesan "Kehadiran disimpan" setelah Simpan Kehadiran.](screens/absensi-harian/04-simpan.png){width=14cm}

*Gambar 2. Pesan "Kehadiran disimpan" setelah Simpan Kehadiran.*

**Hasilnya, dan giliran siapa berikutnya.** Register tersimpan. Santri yang
tercatat **Tidak Hadir** tanpa keterangan muncul di daftar tindak lanjut
pemiliknya (wali kelas untuk santri harian, musyrif untuk santri mukim) dengan
sebutan Alpa; lihat kartu berikutnya.

**Bila tidak berhasil.**

| Yang terlihat | Penyebab umum | Yang perlu dilakukan |
|---|---|---|
| "Pilih kelas terlebih dahulu" | Belum ada kelas terpilih | Pilih kelas dari pilihan **Kelas**, lalu klik **Simpan Kehadiran** lagi |
| "Tidak ada kelas untuk dicatat" | Anda belum menjadi wali kelas atau mengajar di kelas mana pun pada tahun ajaran ini | Minta admin unit memeriksa penugasan Anda |
| **Simpan Kehadiran** tidak dapat diklik | Daftar santri kosong (kelas belum dipilih atau belum ada santri terdaftar), atau penyimpanan sedang berjalan | Pilih kelas; bila daftar tetap kosong, hubungi admin unit |

**Ketersediaan.** Ada pada versi aplikasi yang dijelaskan buklet ini (lihat bagian 1).

## Menindaklanjuti Alpa

**Tujuan.** Menghubungi wali santri yang anaknya Alpa tanpa keterangan dan
mencatat hasilnya.

**Siapa.** Wali kelas (santri harian) atau musyrif (santri mukim).

**Jalur menu.** Wali Kelas → Tindak Lanjut Absensi (`/attendance/follow-ups`).

**Sebelum mulai.** Ada Alpa tanpa keterangan dalam 7 hari terakhir.

**Langkah.**

1. Buka **Tindak Lanjut Absensi**.
   *Daftar Alpa tanpa keterangan dalam 7 hari terakhir untuk santri kelas perwalian Anda, lengkap dengan kontak wali.*
2. Hubungi wali memakai tautan telepon atau WhatsApp pada baris santri itu.
3. Klik **Catat hasil** pada baris itu.
   *Muncul kotak "Catat hasil tindak lanjut".*
4. Pada **Cara menghubungi**, pilih satu: **Telepon**, **WhatsApp**, **Bertemu langsung**, atau **Lainnya**.
5. Pada **Hasilnya**, pilih satu: **Sakit**, **Izin**, **Tanpa keterangan**, atau **Wali tidak terhubungi**.
6. Bila perlu, isi **Catatan (opsional)**.
7. Klik **Simpan**.

![Gambar 3. Daftar Alpa tanpa keterangan di Tindak Lanjut Absensi.](screens/tindak-lanjut-alpa/04-daftar-tindak-lanjut.png){width=14cm}

*Gambar 3. Daftar Alpa tanpa keterangan di Tindak Lanjut Absensi.*

![Gambar 4. Kotak Catat hasil tindak lanjut: cara menghubungi dan hasilnya.](screens/tindak-lanjut-alpa/05-kotak-catat-hasil.png){width=14cm}

*Gambar 4. Kotak Catat hasil tindak lanjut: cara menghubungi dan hasilnya.*

**Hasilnya, dan giliran siapa berikutnya.** Pilihan **Sakit** atau **Izin**
mengubah absensi santri itu menjadi Sakit atau Izin. **Tanpa keterangan**
membiarkannya tetap Alpa dan menyelesaikan tindak lanjut. **Wali tidak
terhubungi** membiarkannya di daftar agar dicoba lagi.

**Bila tidak berhasil.**

| Yang terlihat | Penyebab umum | Yang perlu dilakukan |
|---|---|---|
| "Tidak ada Alpa yang perlu Anda tindak lanjuti" | Tidak ada Alpa tanpa keterangan dalam 7 hari terakhir | Tidak ada tindakan |
| Santri mukim tidak ada di daftar Anda | Tindak lanjut santri mukim ada pada musyrifnya | Musyrifnya yang menindaklanjuti |

**Ketersediaan.** Ada pada versi aplikasi yang dijelaskan buklet ini (lihat bagian 1).

## Menulis catatan perilaku

**Tujuan.** Mencatat perilaku santri, positif maupun yang perlu perhatian.

**Siapa.** Wali kelas dari santri itu.

**Jalur menu.** Wali Kelas → Catatan Perilaku (`/homeroom/behavior`).

**Langkah.**

1. Buka **Catatan Perilaku**.
   *Daftar catatan kelas Anda tampil.*
2. Klik **Tambah Catatan**.
   *Muncul kotak "Tambah Catatan Perilaku".*
3. Di **Pilih siswa**, pilih santrinya.
4. Di **Kategori**, pilih kategorinya.
5. Isi **Apa yang terjadi?**
6. Bila perlu, isi **Apa yang sudah atau akan dilakukan?**
7. Klik **Simpan**.
   *Catatan tersimpan dan tampil di daftar.*

![Gambar 5. Daftar Catatan Perilaku kelas perwalian dengan tombol Tambah Catatan.](screens/catatan-perilaku/01-daftar-catatan.png){width=14cm}

*Gambar 5. Daftar Catatan Perilaku kelas perwalian dengan tombol Tambah Catatan.*

![Gambar 6. Kotak Tambah Catatan Perilaku: pilih santri, kategori, dan isi catatan.](screens/catatan-perilaku/02-kotak-tambah-catatan.png){width=14cm}

*Gambar 6. Kotak Tambah Catatan Perilaku: pilih santri, kategori, dan isi catatan.*

**Hasilnya, dan giliran siapa berikutnya.** Catatan tersimpan pada santri itu.
Catatan yang perlu perhatian dihitung pada ringkasan halaman ini.

**Bila tidak berhasil.**

| Yang terlihat | Penyebab umum | Yang perlu dilakukan |
|---|---|---|
| "Lengkapi siswa, kategori dan isi catatan" | Santri, kategori, atau isi catatan masih kosong | Isi ketiganya, lalu klik **Simpan** lagi |

**Ketersediaan.** Ada pada versi aplikasi yang dijelaskan buklet ini (lihat bagian 1).

## Memutuskan izin santri harian

**Tujuan.** Menyetujui atau menolak permohonan izin santri harian di kelas
Anda.

**Siapa.** Wali kelas untuk santri harian. Santri mukim diputuskan musyrifnya
(buklet Pendidik Pesantren). Kepala unit hanya untuk izin lebih dari 7 hari,
santri tanpa pembimbing, atau mengambil alih.

**Jalur menu.** Wali Kelas → Perizinan (`/permits`). Izin yang menunggu Anda
dikumpulkan lewat penyaring **Perlu keputusan saya**.

**Langkah.**

1. Buka **Perizinan** dan aktifkan penyaring **Perlu keputusan saya**.
   *Daftar izin yang menunggu keputusan Anda.*
2. Untuk menyetujui, klik **Setujui** pada baris izinnya, lalu klik **Setujui**
   pada kotak konfirmasi "Setujui izin".
   *Muncul pesan "Izin disetujui".*
3. Untuk menolak, klik **Tolak** pada baris izinnya, tuliskan alasannya di
   kotak "Tolak izin", lalu klik **Tolak**.
   *Muncul pesan "Izin ditolak".*

![Gambar 7. Kotak konfirmasi "Setujui izin" sebelum keputusan disimpan.](screens/izin-santri-harian/12-setujui.png){width=14cm}

*Gambar 7. Kotak konfirmasi "Setujui izin" sebelum keputusan disimpan.*

**Hasilnya, dan giliran siapa berikutnya.** Izin yang disetujui menunggu pintu
gerbang mencatat keberangkatan dan kepulangan santri; izin yang ditolak kembali
ke pemohon beserta alasannya.

**Bila tidak berhasil.**

| Yang terlihat | Penyebab umum | Yang perlu dilakukan |
|---|---|---|
| Izin tidak ada di daftar | Bukan tanggung jawab Anda | Pemutus yang benar adalah wali kelas atau musyrif santri itu |
| Tombol **Setujui** dan **Tolak** tidak ada | Izin sudah diputuskan, atau di luar lingkup Anda | Muat ulang halaman; bila tetap, tanyakan admin unit |

**Ketersediaan.** Ada pada versi aplikasi yang dijelaskan buklet ini (lihat bagian 1).

# 3. Bila Ada Masalah

- **Tidak bisa membuka halaman.** Laporkan ke admin unit; sebutkan jalur menu
  dan pesan yang muncul.
- **Tombol tampil tetapi tindakan ditolak.** Aplikasi memeriksa lagi di server;
  laporkan kepada admin unit.
- **Data terlihat salah atau kosong.** Pastikan tahun ajaran dan kelas benar,
  lalu laporkan bila masih salah.

Ke mana melapor: **admin unit** Anda (bukan nama orang tertentu).
