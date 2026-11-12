# Kesalahan yang sudah terjadi (dan pemeriksa yang menangkapnya)

Tiap baris adalah cacat nyata yang pernah lolos ke laporan; kode pemeriksa di
`check_report.py` (atau pemindai) menangkapnya.

| Cacat | Akibat | Pemeriksa |
|---|---|---|
| Temuan `F-nn` kehilangan salah satu dari lima butir (mis. Rekomendasi) | Register tak lengkap; pembaca tak tahu arah perbaikan | `read()` — "butir wajib hilang — rekomendasi" |
| Skor CVSS ditulis berbeda dari vektornya | Laporan tak dapat diverifikasi; peringkat dikarang | `cvss_base()` + "skor tertulis X ≠ vektor Y" |
| Peringkat tidak cocok dengan pita skor (skor 7.5 ditulis "Rendah") | Temuan tinggi disamarkan | "peringkat '…' ≠ pita skor 7.5 (high)" |
| Skor tanpa vektor CVSS | Tak dapat diverifikasi mesin | `--final` → ERROR "tidak ada Vektor CVSS"; draf → WARN |
| Vektor ada tanpa skor tertulis | Skor tak terverifikasi mesin | `--final` → ERROR "tanpa skor tertulis"; draf → WARN |
| Peringkat tak dikenali (mis. "Urgent") | Pita skor tak dapat dibandingkan | "peringkat '…' tidak dikenali (critical/high/medium/low/none)" |
| Baris Bagian 4 hilang/berlebih atau peringkat/statusnya melenceng dari Register | Ringkasan publik bertentangan dengan Register | `summary_table()` — "ringkasan: F-01 … ≠ Register …" |
| Baris Bagian 4 mencantumkan temuan berstatus terbuka | Temuan terbuka bocor ke ringkasan publik | `summary_errors()` — "tabel Ringkasan publik mencantumkan … terbuka" |
| `Status: Belum ditutup` dibaca sebagai selesai | Temuan terbuka lolos ke ringkasan publik | `canonical_status()` — penyangkalan → "open" |
| ID temuan dipakai dua kali | Satu temuan menimpa yang lain di Register | `read()` — "F-01: ID temuan ganda" |
| Bagian 2.5 hilang atau dikosongkan | Batas uji tak terlihat pembaca | "bagian wajib hilang: 2.5 …" / `--final` → ERROR kosong |
| Satu edisi bahasa punya `F-nn` yang tidak ada di edisi lain | Tiga laporan yang berbeda, bukan satu | `parity()` — "F-01 ada di id tetapi tidak di en" |
| Peringkat/status berbeda antar bahasa untuk temuan yang sama | Pembaca berbeda bahasa melihat keparahan berbeda | `parity()` — "peringkat berbeda"/"status berbeda" |
| Bagian wajib hilang (mis. 9 uji ulang) | Laporan tak lengkap untuk auditor | `read()` — "bagian wajib hilang: …" |
| Kredensial/host/IP/identitas tertinggal di teks publik | Kebocoran di repo publik | `scan_sensitive.scan()` |
| `[ISI]`/`TODO` tertinggal di laporan final | Laporan setengah jadi dikirim | `--final` → ERROR |

## Cara memakai tabel ini

Bila pemeriksa mencetak `ERROR`, pesannya sering memuat nilai yang benar (skor
dari vektor, tingkat kanonik yang cocok). Pakai itu; jangan menebak. Bila sebuah
cacat baru lolos, tambahkan barisnya di sini **dan** uji regresinya di
`test_check_report.py` — gerbang tanpa uji adalah gerbang yang tak teruji.
