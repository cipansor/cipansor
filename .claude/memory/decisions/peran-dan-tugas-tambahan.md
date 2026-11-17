# peran-dan-tugas-tambahan

> Keputusan pengguna 2026-09-26 — kode peran = fungsi seseorang; tugas tambahan (wakasek, wali kelas, guru wali, kepala perpustakaan/lab, pembina, panitia) = relasi atau penugasan, bukan kode peran. `*_WAKASEK` dan `*_WALI_KELAS` digabung ke `*_GURU`. Sesi konseling rahasia dibaca konselornya dan guru BK unit; kepala sekolah hanya rujukannya.

**Pertanyaan pengguna:** "di Cipansor belum ada wakasek, apa perlu ditiadakan
saja?" Jawabannya ya, dan alasannya berlaku untuk semua tugas tambahan.

## Peran adalah fungsi, tugas tambahan adalah relasi

| | Contoh | Tempatnya di sistem |
|---|---|---|
| **Fungsi** — pekerjaan pokok seseorang | guru, guru BK, kepala sekolah, tata usaha, bendahara, musyrif | kode peran (`RoleCode`), satu per unit |
| **Tugas tambahan** — dipegang seorang guru di atas fungsinya, berganti tiap tahun | wakasek, wali kelas, guru wali, kepala perpustakaan/lab, pembina ekskul, panitia SPMB | relasi ke hal yang ia pegang (kelas, murid dampingan, ruang) atau penugasan berbatas waktu (Model A di `roadmap.md`) |

Dasarnya (sudah diriset 2026-09-26, jangan diulang):

- **Regulasi menyebutnya tugas tambahan guru, bukan jabatan tersendiri.**
  Permendikbud 15/2018 Ps. 4 ayat 7; Permendikdasmen 11/2025 dan Kepmendikdasmen
  221/P/2025 memberi ekuivalensi jam: wakasek, kepala perpustakaan dan kepala
  laboratorium 12 JTM; wali kelas, pembina OSIS/ekskul dan koordinator 2 JTM.
- **Dapodik mencatat wali kelas pada rombel**, sebagai isian "Guru/Wali Kelas"
  per tahun ajaran, bukan sebagai jenis PTK. Di Cipansor itu
  `Class.homeroomTeacherId`. Dapodik 2025C: SD tidak menginput wakasek, SMP
  paling banyak 3, SMA paling banyak 4.
- **Guru wali** (Permendikdasmen 11/2025 Ps. 9): guru mata pelajaran SMP/SMA
  mendampingi murid dampingannya sejak masuk sampai lulus, 2 JTM. Kalau
  dijalankan, ia relasi guru → murid, bukan peran.
- **Praktik umum.** OneRoster (1EdTech) memodelkan wali kelas sebagai jenis kelas
  dan guru sebagai keanggotaan berdurasi. OWASP Authorization Cheat Sheet:
  *"Prefer Attribute and Relationship Based Access Control over RBAC"*.

**Kode peran untuk sebuah tugas menyimpang dari relasi yang ia namai.** Di seed
pernah ada akun "Wali Kelas" yang bukan wali kelas kelas mana pun, dan akun
"Guru" yang justru wali kelas. Pemutus izin (#568) dan rapor sudah membaca
relasinya, bukan perannya.

## Yang diputuskan

1. **`*_WAKASEK` dihapus.** Keempatnya hanya dipegang akun demo, menunya menu
   guru, dan tidak ada layar atau aturan khusus wakasek. Dilaksanakan #575: semua
   penugasan pindah ke `*_GURU` unit yang sama.
2. **`*_WALI_KELAS` dihapus sebagai peran; wali kelas = `Class.homeroomTeacherId`.**
   Juga #575. Perilakunya menyusul:
   - menu Wali Kelas tampil hanya bagi wali kelas sebuah kelas di tahun ajaran aktif;
   - dasbor kelas, catatan murid dan perilaku dibuka oleh wali kelas kelas itu,
     dan dibaca kepala sekolah serta admin unitnya.
3. **Guru BK tetap peran** (fungsi, bukan tugas tambahan). Ia hanya ada di SMP IT
   dan SMA Qur'an; di TK dan SD, wali kelas yang membimbing.
4. **Sesi konseling bertanda rahasia** (#574):

   | Siapa | Sesi rahasia unitnya |
   |---|---|
   | konselor sesi itu, guru BK unit | seluruhnya; boleh mengubah |
   | kepala sekolah unit | bahwa sesi itu ada, kategori, status, jadwal, dan **rujukannya**; judul, isi, catatan dan observasi tidak; tidak boleh mengubah |
   | selain itu — guru lain, admin unit, organ yayasan, super admin, unit lain | tidak dikirim; halamannya 404 |

   Wali membaca yang dibagikan kepadanya lewat portal orang tua. Dasarnya: data
   kesehatan dan data anak adalah data pribadi yang bersifat spesifik (UU
   27/2022 Ps. 4). Hitungan di kartu memakai saringan yang sama dengan daftar.

## Guru wali dijalankan — dijawab pengguna 2026-09-27

SMP IT dan SMA Qur'an **sudah menjalankan guru wali, dengan SK**. Ia dibangun
seperti wali kelas: relasi guru → murid dampingan yang berlaku per tahun
ajaran, catatan pendampingan, dan menu yang muncul hanya bagi guru yang punya
dampingan — bukan kode peran. Berbeda dari wali kelas: dampingannya lintas
kelas dan berlanjut sampai lulus (Permendikdasmen 11/2025 Ps. 9, 2 JTM per
minggu, tugas pokok guru SMP/SMA sejak TA 2025/2026 —
[Disdik KBB](https://disdikkbb.org/perbedaan-guru-wali-dengan-guru-wali-kelas/)).
Belum dibangun; urutannya di `roadmap.md`.

## Masih terbuka

- Wakasek per bidang, kepala perpustakaan/lab dan panitia SPMB sebagai
  penugasan berbatas waktu — bagian dari Model A.
