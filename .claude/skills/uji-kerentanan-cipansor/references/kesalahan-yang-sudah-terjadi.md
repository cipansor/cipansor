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
| Baris Bagian 4 hilang/berlebih atau peringkat/kategori/statusnya melenceng dari Register | Ringkasan publik bertentangan dengan Register | `summary_table()` + perbandingan baris — "ringkasan: F-01 … ≠ Register …" |
| ID sama muncul dua kali di tabel Bagian 4 (mis. "Ditutup" lalu "Terbuka", atau sebaliknya) | Baris terbuka disembunyikan oleh baris pertama/terakhir | `summary_table()` mengumpulkan status **setiap** baris ID itu; ID ganda dilaporkan |
| Baris Bagian 4 tanpa kolom status | ID/peringkat/kategori temuan terbuka terbit tanpa kesalahan | `summary_errors()` — baris tanpa status dihitung terbuka |
| Kategori berbeda kode OWASP kedua (mis. tabel `A01, A03` vs Register `A01, A02`) | Pemetaan OWASP temuan keliru | `_categories_match()` membandingkan **himpunan** kode, bukan kode pertama saja |
| Dua kategori Arab berbeda (tanpa kode OWASP) dianggap sama | Ringkasan dan Register bertentangan lolos | `_norm_text()` mempertahankan huruf Arab (normalisasi Unicode), bukan membuangnya |
| Bagian 4 berjudul tingkat tiga (`### 4. …`) | Pemeriksaan bagian wajib menerimanya, tetapi perbandingan baris dulu dilewati | `summary_table()` menerima heading tingkat 1–3, sama dengan pemeriksaan bagian wajib |
| Tabel Bagian 4 berisi temuan yatim (Register kosong) | Baris temuan yang tak ada di Register lolos | perbandingan baris kini jalan tanpa syarat "ada temuan" |
| Baris Bagian 4 mencantumkan temuan berstatus terbuka | Temuan terbuka bocor ke ringkasan publik | `summary_errors()` — "tabel Ringkasan publik mencantumkan … terbuka" |
| `Status: Belum ditutup` dibaca sebagai selesai | Temuan terbuka lolos ke ringkasan publik | `canonical_status()` — penyangkalan → "open" |
| ID temuan dipakai dua kali | Satu temuan menimpa yang lain di Register | `read()` — "F-01: ID temuan ganda" |
| Bagian 2.5 hilang atau dikosongkan | Batas uji tak terlihat pembaca | "bagian wajib hilang: 2.5 …" / `--final` → ERROR kosong |
| Bagian 2.5 diisi lewat subjudul (`### 2.5.1`) | Dulu terbaca "kosong" (positif palsu) | `_heading_body()` membaca sampai heading setingkat/lebih tinggi, jadi isi subbagian ikut |
| Bagian 2.5 hanya berisi subjudul tanpa uraian | Batas uji kosong lolos (baris judul dihitung isi) | `read()` membuang baris heading sebelum menguji isi 2.5 |
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
