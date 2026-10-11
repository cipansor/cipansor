# derajat-kecepatan-naskah

> KEPUTUSAN 2026-10-09 (pengguna): naskah dinas punya **tiga** derajat
> kecepatan — **Sangat Segera** (hari yang sama, batas 24 jam), **Segera**
> (2 × 24 jam), **Biasa** (menurut urutan). Tidak ada derajat keempat.

## Asal keputusan

#628 menambah `LetterUrgency.KILAT` dan mengganti label `URGENT` dari "Amat
Segera" menjadi "Sangat Segera" (2 × 24 jam), dengan alasan "Kilat terpaksa
dicatat sebagai Segera". Premis itu keliru: pedoman yang dirujuk menyatakan
**Amat Segera/Kilat adalah satu derajat** (24 jam), dan skema `main` sudah
menyimpannya sebagai `URGENT`. Akibatnya setiap surat lama "Amat Segera" akan
tampil satu tingkat lebih rendah, tanpa pemberitahuan.

Pengguna diberi tiga pilihan (tiga derajat sesuai pedoman; empat derajat
dengan data lama dipindah ke Kilat; biarkan seperti PR) dan memilih tiga
derajat dengan nama **Sangat Segera, Segera, Biasa**.

## Aturannya

- `URGENT` = **Sangat Segera** = derajat 24 jam yang dalam pedoman disebut
  "Amat Segera/Kilat". *Amat* dan *sangat* bersinonim; arti baris lama tidak
  berubah, hanya labelnya.
- `IMMEDIATE` = Segera (2 × 24 jam); `NORMAL` = Biasa.
- Label hanya dari `LETTER_URGENCY_LABELS` (`packages/shared`), satu sumber.
- Sistem saat ini **tidak** menghitung tenggat dari derajat ini; derajat hanya
  label, warna lencana, dan hitungan "mendesak" di beranda E-Office.

## Sumber

- Permenpan-RB 80/2012 (Pedoman Tata Naskah Dinas Instansi Pemerintah),
  bagian "Kecepatan Penyampaian": a. Amat Segera/Kilat — diselesaikan/
  disampaikan pada hari yang sama, batas 24 jam; b. Segera — 2 × 24 jam;
  c. Biasa — menurut urutan diterima bagian pengiriman. Bagian penerimaan
  surat di peraturan yang sama menyebut "kilat, sangat segera, segera, dan
  biasa" — tidak konsisten di dalam dokumennya sendiri, dan tidak memberi batas
  waktu untuk "sangat segera". Dicabut Permenpan-RB 15/2017; isinya tetap
  menjadi rujukan pedoman instansi.
- Peraturan ANRI 5/2021 (Pedoman Umum Tata Naskah Dinas) **tidak** memuat daftar
  derajat kecepatan (diperiksa dari teks lengkapnya, 2026-10-09).
