# Kesalahan yang sudah terjadi (dan pemeriksa yang menangkapnya)

Tiap baris adalah cacat nyata yang pernah lolos ke laporan; kode pemeriksa di
`check_report.py` (atau pemindai) menangkapnya.

| Cacat | Akibat | Pemeriksa |
|---|---|---|
| Temuan `F-nn` kehilangan salah satu dari lima butir (mis. Rekomendasi) | Register tak lengkap; pembaca tak tahu arah perbaikan | `read()` — "butir wajib hilang — rekomendasi" |
| Skor CVSS ditulis berbeda dari vektornya | Laporan tak dapat diverifikasi; peringkat dikarang | `cvss_base()` + "skor tertulis X ≠ vektor Y" |
| Peringkat tidak cocok dengan pita skor (skor 7.5 ditulis "Rendah") | Temuan tinggi disamarkan | "peringkat '…' ≠ pita skor 7.5 (high)" |
| Skor tanpa vektor CVSS | Tak dapat diverifikasi mesin | WARN "tidak ada Vektor CVSS" |
| Satu edisi bahasa punya `F-nn` yang tidak ada di edisi lain | Tiga laporan yang berbeda, bukan satu | `parity()` — "F-01 ada di id tetapi tidak di en" |
| Peringkat/status berbeda antar bahasa untuk temuan yang sama | Pembaca berbeda bahasa melihat keparahan berbeda | `parity()` — "peringkat berbeda"/"status berbeda" |
| Bagian wajib hilang (mis. 2.5 batas, atau 9 uji ulang) | Laporan tak lengkap untuk auditor | `read()` — "bagian wajib hilang: …" |
| Kredensial/host/IP/identitas tertinggal di teks publik | Kebocoran di repo publik | `scan_sensitive.scan()` |
| `[ISI]`/`TODO` tertinggal di laporan final | Laporan setengah jadi dikirim | `--final` → ERROR |

## Cara memakai tabel ini

Bila pemeriksa mencetak `ERROR`, pesannya sering memuat nilai yang benar (skor
dari vektor, tingkat kanonik yang cocok). Pakai itu; jangan menebak. Bila sebuah
cacat baru lolos, tambahkan barisnya di sini **dan** uji regresinya di
`test_check_report.py` — gerbang tanpa uji adalah gerbang yang tak teruji.
