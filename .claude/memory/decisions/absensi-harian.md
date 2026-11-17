# absensi-harian

> Keputusan pengguna 2026-09-27 — register harian diisi di kelas oleh wali kelas atau guru yang mengajar di kelas itu (admin unit cadangan); satu halaman; tindak lanjut otomatis dengan pemilik yang sudah ada (wali kelas untuk murid harian, musyrif untuk santri mukim); tanpa guru piket. 2026-09-28: parameter tanda pola

**Pertanyaan pengguna:** "Apa memang perlu ada guru piket? Apa tidak sebaiknya
pakai otomatis saja dari sistem?" Jawabannya: sebagian besar otomatis, tetapi
satu langkah tetap butuh orang, dan orang itu sudah ada.

## Aturannya

| Langkah | Siapa atau apa |
|---|---|
| Mengisi register kelas, sekali di awal hari | wali kelas, guru yang punya jadwal di kelas itu, admin unit (#580) |
| Izin yang disetujui dan kunjungan UKS | mengisi register otomatis dengan Izin/Sakit (sudah berjalan) |
| Kelas belum mengisi register 30 menit sesudah jam pertama | sistem mengingatkan guru jam itu dan wali kelas |
| Murid ditandai Alpa atau Terlambat | sistem memberi tahu walinya seketika (wali bisa menjawab atau mengajukan izin); santri mukim → **musyrifnya juga**, seketika |
| Sampai sore belum ada keterangan | tugas tindak lanjut untuk **wali kelas** (murid harian) atau **musyrif** (santri mukim); hasil kontaknya dicatat |
| Pola: ≥10% hari tidak hadir, atau sering terlambat (parameter di bawah) | ditandai untuk wali kelas dan guru BK; santri mukim → **musyrifnya juga** |
| Kepala sekolah | membaca rekap; tidak mengisi register |

- **Satu halaman untuk satu register.** *Mengajar → Absensi → Input
  Kehadiran* (`/attendance/record`) adalah halamannya. Butir *Wali Kelas →
  Absensi Harian* membuka halaman yang sama dengan kelas perwaliannya terpilih.
  `/homeroom/attendance` dialihkan permanen (penghapusan disetujui).
- **Tidak ada guru piket di sistem.** "Jadwal Piket" di Cipansor adalah piket
  santri, bukan guru. Sekolah yang tetap menjalankan guru piket di lapangan
  tidak terganggu.
- **Santri mukim yang Alpa di kelas seharusnya ada di dalam pondok.** Karena
  itu musyrifnya harus tahu seketika, bukan hanya walinya yang jauh di rumah.
  Inilah bedanya dengan sekolah harian.

## Tanda pola — diputuskan pengguna 2026-09-28

Keempatnya pilihan yang direkomendasikan:

1. **Yang dihitung: semua ketidakhadiran — Alpa, Sakit, dan Izin.** Begitu
   *persistent absence* dihitung DfE (*Working together*, 2024) dan *chronic
   absence* dihitung [Attendance Works](https://www.attendanceworks.org/chronic-absence/addressing-chronic-absence/3-tiers-of-intervention/):
   anak kehilangan pelajaran apa pun alasannya, dan sakit yang berulang justru
   perlu dilihat.
2. **Periode: semester berjalan, dan baru dinilai sesudah 10 hari
   tercatat**, supaya satu hari absen di minggu pertama tidak langsung menjadi
   10%. Attendance Works: 2–4 hari absen di bulan pertama sudah tanda dini
   ("Why September Matters"). Batas semester sama dengan rapor: semester
   ganjil dari hari pertama tahun ajaran, genap dari 1 Januari WIB
   (`apps/api/src/utils/semester.ts`).
3. **Sering terlambat: 3 kali dalam 30 hari (bergulir).** Pola tata tertib
   sekolah di Indonesia yang umum: terlambat tiga kali → orang tua dipanggil.
4. **Santri mukim: wali kelas, guru BK, dan musyrifnya** — musyrif memegang
   pengasuhan harian, aturan yang sama dengan pemutus izin dan tindak lanjut
   Alpa.

Tiap pola diberitahukan **sekali per semester** (pukul 16:00 WIB); halaman
*Pola Kehadiran* menunjukkannya selama pola itu masih berlaku. Guru BK hanya
ada di SMP IT dan SMA Qur'an; di TK dan SD tanda pola sampai ke wali kelas
(dan musyrif).

## Dasarnya (diriset 2026-09-27, jangan diulang)

- **Register diambil sekali di kelas, pada awal sesi**, dan terbuka paling
  lama 30 menit. Sesudah itu murid dicatat terlambat atau tidak hadir. Sekolah
  menghubungi orang tua **pada hari pertama** ketidakhadiran tanpa keterangan
  (DfE, [*Working together to improve school attendance*](https://assets.publishing.service.gov.uk/media/66bf300da44f1c4c23e5bd1b/Working_together_to_improve_school_attendance_-_August_2024.pdf),
  2024, §42, §290, §299).
- **Pemberitahuan otomatis ke orang tua terbukti berhasil.** Uji acak di 22
  sekolah: kehadiran kelas naik 12% dan kegagalan mata pelajaran turun 27%
  ([Bergman & Chan, *J. Human Resources* 2021](https://jhr.uwpress.org/content/56/1/125)).
- **Otomasi untuk semua, orang untuk pengecualian.** Tiga tingkat Attendance
  Works: pesan otomatis → kontak pribadi bila melewati ambang → penanganan
  intensif; ambang ketidakhadiran kronis 10% hari
  ([Attendance Works](https://www.attendanceworks.org/chronic-absence/addressing-chronic-absence/3-tiers-of-intervention/)).
- **Pesan otomatis saja tidak cukup.** Ketidakhadiran tanpa keterangan bisa
  menjadi tanda pertama anak dalam bahaya, jadi harus ada orang bernama yang
  menindaklanjutinya bila wali tidak menjawab (KCSIE; DfE §42).
- **Di sekolah Indonesia** guru mapel atau wali kelas mengisi presensi; guru
  piket merekap, mencatat keterlambatan dan menghubungi orang tua
  ([MySCH](https://mysch.id/absensi)). Sistem ini mengambil alih rekap dan
  pemberitahuannya, dan tindak lanjutnya dipegang pembimbing yang sudah punya
  relasi dengan anak itu.
- **Surat dokter tidak diwajibkan menyeluruh** (DfE §374) — lihat
  `pemutus-izin-santri.md`.

## Yang sudah ada dan yang belum

Semuanya dibangun: siapa yang mengisi register (#580), satu halaman (#585),
pemberitahuan Alpa/Terlambat ke wali dan musyrif dengan kotak masuk pribadi
(#587), tugas tindak lanjut dengan catatan kontak (#588), pengingat register
(#590), dan tanda pola (*Wali Kelas → Pola Kehadiran*, *Pengasuhan → Pola
Kehadiran*).
