<!--
KARTU TUGAS — satu tugas, dalam istilah kerja pembaca ("Mencatat absensi harian",
bukan "Modul attendance"). Salin blok di bawah untuk tiap tugas. Aturan lengkap:
references/panduan-pengguna.md → "Kartu tugas".

TIAP kalimat yang menyebut layar harus punya sumber di kode. Urutan kerja untuk satu kartu:
  1. `cd apps/web && ../api/node_modules/.bin/tsx scripts/role-menus.ts <KODE_PERAN>` → jalur menu.
  2. Buka apps/web/src/app/<rute>/page.tsx: judul, nama tombol, label isian, nilai bawaan,
     kondisi `disabled`, teks toast/Alert. SALIN, jangan parafrase.
  3. Buka hook di apps/web/src/hooks/use-*.ts untuk label status dan pesan hasil.
  4. Jalankan check_docs.py --kind pengguna --trace jejak.md; periksa bahwa berkas di jejak.md memang layar itu.
Jalur menu ditulis "Grup → Butir (`/rute`)" — dengan tanda ` BIASA. Jangan menulis \` (tanda lolos).

T2 (tidak bisa menjalankan aplikasi): pertahankan banner ⚠, JANGAN menyisipkan tangkapan layar karangan.
T1: hapus banner ⚠ dan sisipkan gambar asli.
-->

## [ISI: Nama tugas]

> ⚠ **Belum dicoba di aplikasi berjalan.** Langkah disusun dari kode pada commit [ISI: hash].

**Tujuan.** [ISI: satu kalimat, bahasa kerja pembaca.]

**Siapa.** [ISI: keluarga peran dan unit bila relevan — hasil empat lapis, bukan tebakan.]

**Jalur menu.** [ISI: Grup → Butir (`/rute`) — dicetak dari role-menus.ts untuk penugasan utama. Bila peran lain
mencapai halaman yang sama lewat jalur berbeda (mis. tombol di halaman induk), tulis KEDUANYA.
Bila tidak ada di menu: "tidak ada di menu — buka `/rute`".]

**Sebelum mulai.** [ISI: prasyarat — data apa yang harus sudah ada; giliran siapa sebelumnya.]

**Langkah.**

1. [ISI: SATU tindakan. Klik **Nama Tombol** — persis seperti di layar.]
   *[ISI: hasil yang terlihat.]*
2. [ISI]
   *[ISI]*
3. [ISI]
   *[ISI]*

![Gambar [ISI: n]. [ISI: layar penentu]](screens/[ISI: peran]/[ISI: tugas]-01.png){width=14cm}

**Hasilnya, dan giliran siapa berikutnya.** [ISI: status baru (label layar) dan pihak berikutnya.]

**Bila tidak berhasil.**

| Yang terlihat | Penyebab umum | Yang perlu dilakukan |
|---|---|---|
| [ISI: pesan PERSIS dari kode, dalam tanda kutip] | [ISI: kondisi dari kode, mis. `disabled={…}`] | [ISI] |

**Ketersediaan.** Ada pada versi aplikasi yang dijelaskan buklet ini (lihat bagian 1).
