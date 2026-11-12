# Standar acuan dan alasan

| Standar | Dipakai untuk |
|---|---|
| **OWASP WSTG** (Web Security Testing Guide) | daftar periksa pengujian; kategori uji |
| **OWASP Top 10 (2021)** | kategori temuan aplikasi web |
| **OWASP API Security Top 10 (2023)** | kategori temuan API (permukaan utama Cipansor) |
| **NIST SP 800-115** | metodologi uji teknis (perencanaan, pelaksanaan, pelaporan) |
| **NIST SP 800-63B-4** | autentikasi, 2FA, kebijakan sandi |
| **CVSS v3.1** | peringkat indikatif temuan (vektor + skor) |
| **PTES** (Penetration Testing Execution Standard) | tahapan uji |
| **UU 27/2022 (PDP)** | perlindungan data pribadi — dasar mengapa data anak diperlakukan ketat |
| **UU ITE** | kerangka hukum tanda tangan elektronik dan data elektronik |

## Mengapa CVSS dihitung mesin, bukan ditulis tangan

Skor yang ditulis berbeda dari vektornya adalah laporan yang tidak dapat
diverifikasi. `check_report.py` menghitung ulang skor dasar dari vektor
(`cvss_base()`, rumus CVSS v3.1 §7.1 termasuk `roundup`) dan menolak
ketidakcocokan; peringkat juga harus cocok dengan pita skornya. Ini menutup
temuan yang "peringkatnya" dikarang lebih rendah dari buktinya.

## Mengapa paritas lintas bahasa dibandingkan pada tingkat kanonik

Tiga edisi yang menilai temuan yang sama secara berbeda adalah tiga laporan yang
berbeda — pembaca Inggris bisa melihat "High" di tempat pembaca Arab melihat
"متوسط". Pemeriksa membandingkan **himpunan ID + peringkat + status** yang
dinormalkan ke tingkat kanonik, bukan teksnya.

## Mengapa laporan penuh di luar repo

Selama repo publik, laporan yang menyebut temuan yang masih terbuka memberi
penyerang peta jalan. `decisions/otomasi-armada.md` butir 5 dan
`docs/SDLC-FLOW.md` invarian 9 menetapkan temuan keamanan → advisory privat;
perbaikannya lewat PR publik **netral** (aturannya, bukan celahnya). Yang di-commit
hanya prosedur + ringkasan netral kontrol yang terbukti baik.

## Yang sengaja tidak dipakai

- **Peringkat kualitatif tanpa CVSS.** Tidak dapat diverifikasi; satu orang
  menyebut "tinggi", orang lain "sedang", tanpa dasar yang sama.
- **Laporan satu berkas tiga bahasa.** Label sampul/footer/`core_properties.language`
  hanya bisa satu nilai per bangun; karena itu satu sumber per bahasa.
- **Pemindai otomatis sebagai satu-satunya dasar.** Ia menangkap pola mekanis;
  "kelemahan produksi yang masih terbuka" tidak tertangkap regex dan bergantung
  pada penilaian penulis.
