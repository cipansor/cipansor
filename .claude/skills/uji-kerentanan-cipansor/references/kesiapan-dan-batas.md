# Kesiapan, batas, dan kejujuran

## Gerbang kesiapan — sebelum satu kalimat ditulis

Periksa apa yang **ada** dan katakan apa yang **tidak ada** — jangan dikarang
hijau.

| Alat | Untuk | Bila tidak ada |
|---|---|---|
| `git` | mencatat commit + tanggal yang diuji | wajib ada; tanpa commit, laporan tak dapat dirujuk |
| aplikasi lokal (skill `stack`) | menguji alur berjalan, bukan hanya kode | uji jadi *dokumentasi* saja; katakan di 2.5 |
| pemindai DAST (mis. ZAP) | memindai permukaan berjalan | tulis "tidak dijalankan" di 2.5; jangan klaim hasilnya |
| `scan_sensitive.py` + `.github/scripts/check-sensitive.py` | redaksi | wajib; jalankan sebelum menyerahkan |
| `check_report.py` | gerbang struktur + CVSS + paritas | wajib |

## Batas uji yang wajib dinyatakan

- **Otorisasi:** Ketua Yayasan. Tanpa itu, tidak ada uji.
- **Lingkup:** aplikasi lokal + data seed. **Tidak** menyentuh staging/produksi.
- **Tanpa uji merusak:** tanpa DoS, tanpa ubah/hapus data nyata, tanpa rahasia
  produksi, tanpa rekayasa sosial.
- **Redaksi:** teks publik tanpa langkah eksploitasi, kredensial, IP, nama/ID
  sumber daya cloud, jalur host, kelemahan terbuka, data pribadi.

## Kejujuran tingkat verifikasi

Tiap klaim kontrol punya tingkat: **terbukti** (diuji dan lulus, dengan bukti),
**sebagian** (diuji sebagian), atau **belum** (belum diuji). Jangan menulis
"terverifikasi" untuk yang belum diuji. Bagian 2.5 mencatat apa yang membatasi
hasil; Ringkasan tidak boleh membesar-besarkan.

## Uji redaksi satu-pertanyaan

Untuk tiap kalimat, tanyakan: *"Bila penyerang membaca ini, apakah ia maju satu
langkah?"* Bila ya — langkah eksploitasi, nama modul + celahnya, kredensial,
host, IP — pindahkan ke laporan penuh di luar repo, dan tulis di publik hanya
**aturannya** ("endpoint admin wajib memeriksa izin"), bukan celahnya.

## Yang tidak boleh ada di `docs/`

- Daftar temuan yang masih terbuka (peringkat, modul, langkah).
- Nama host, IP, nama/ID sumber daya cloud, kredensial.
- Data pribadi santri/wali.
- "Rencana perbaikan yang belum ada di produksi" (lihat peringatan
  `docs/README.md`).
