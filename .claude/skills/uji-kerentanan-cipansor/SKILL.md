---
name: uji-kerentanan-cipansor
description: Menjalankan dan melaporkan uji kerentanan internal untuk Sistem Informasi Cipansor (repo cipansor/cipansor) — prosedur, batas otorisasi, kerangka laporan Ringkasan Eksekutif + Bagian 1–10 (OWASP WSTG/NIST SP 800-115/PTES), lima butir per temuan F-nn (Peringkat CVSS v3.1, Kategori OWASP, Sumber, Status, Rekomendasi), paritas lintas bahasa (id/en/ar RTL), redaksi untuk repo publik, dan pemeriksa mesin `check_report.py`. Laporan penuh disimpan DI LUAR repo selama repo publik; `docs/` hanya memuat prosedur + ringkasan netral. Gunakan setiap kali diminta laporan/uji kerentanan, uji keamanan internal, register temuan, pemetaan OWASP Top 10 / API Top 10, atau pembaruan prosedur/laporan itu untuk Cipansor — juga untuk pengurus, auditor, donor, atau penilaian PDP.
---

# Uji Kerentanan Cipansor

Laporan uji keamanan yang **terukur dan berulang** untuk sistem yang menyimpan
data pribadi anak (NIK, KK, NIK orang tua, penghasilan) dan data keuangan.

## Aturan yang tidak boleh dilanggar

1. **Otorisasi dulu.** Uji dijalankan atas izin **Ketua Yayasan**. Tanpa izin
   tertulis, tidak ada uji. Izin dan lingkupnya masuk Bagian 1.
2. **Repo publik sampai rilis.** Laporan penuh (temuan `F-nn` + peringkat +
   langkah + bukti) **tidak** di-commit; ia tinggal di luar repo. Yang publik
   hanya prosedur dan ringkasan netral **tanpa temuan yang masih terbuka**
   (keputusan **K37**, `decisions/otomasi-armada.md` butir 5, `docs/SDLC-FLOW.md`
   invarian 9, `SECURITY.md`).
3. **Temuan ke advisory privat**, bukan issue publik. Perbaikan lewat PR publik
   yang ditulis **netral** — aturannya, bukan celahnya.
4. **Tanpa uji merusak.** Tanpa DoS, tanpa mengubah/menghapus data nyata, tanpa
   rahasia produksi, tanpa rekayasa sosial. Uji di aplikasi lokal + data seed.
5. **Angka dan kontrol dari kode, bukan ingatan.** Sebut **commit + tanggal**
   yang diuji. Kontrol yang diklaim "terverifikasi baik" harus dapat ditunjuk
   `berkas:baris`-nya.
6. **Belum "selesai" sebelum pemeriksa mesin bersih.** `check_report.py` 0 ERROR
   untuk tiap edisi, dan `--parity` 0 ERROR bila ada lebih dari satu bahasa.
7. **Katakan batasnya.** Bagian 2.5 menyatakan cakupan sampel, alat pemindai yang
   dijalankan/tidak, dan perbedaan lingkungan uji vs produksi. Tidak dikarang
   "hijau".

## Alur

### 1. Siapkan — gerbang: izin + basis kode tercatat

Konfirmasi otorisasi (§Aturan 1). Catat **commit + tanggal** yang diuji. Bila
memperbarui prosedur di `docs/`, bacalah `docs/UJI-KERENTANAN.md` yang sudah ada
dan `docs/DOKUMEN-TEKNIS.md` bab 11 (kategori risiko) sebagai konteks.

### 2. Susun laporan penuh (di luar repo) — gerbang: `check_report.py` 0 ERROR

Salin `assets/template-laporan.md` ke salinan **di luar repo**. Ikuti kerangka
Ringkasan Eksekutif + Bagian 1–10 + lampiran. Tiap temuan `F-nn` membawa lima
butir:

| Butir | Isi |
|---|---|
| Peringkat | CVSS v3.1 indikatif — **vektor + skor** (`CVSS:3.1/AV:…` = `7.5`) |
| Kategori | OWASP Top 10 / API Top 10 |
| Sumber | *Diuji langsung* / *Terdokumentasi* |
| Status | Terbuka / Ditutup / Dimitigasi / Diterima |
| Rekomendasi | arah perbaikan, tanpa langkah eksploitasi |

```bash
python scripts/check_report.py /luar/repo/LAPORAN.md --final            # 0 ERROR
```

Pemeriksa memverifikasi: struktur bagian lengkap, lima butir tiap temuan, **skor
CVSS cocok dengan vektornya**, dan peringkat cocok dengan pita skornya
(`<4 rendah`, `4–6.9 sedang`, `7–8.9 tinggi`, `≥9 kritis`).

### 3. Tiga bahasa (bila diminta) — gerbang: `--parity` 0 ERROR

Satu sumber Markdown per bahasa (id kanonik, en, ar RTL). Himpunan ID `F-nn`
**sama** di ketiga edisi, dan tiap ID berperingkat + berstatus **sama** pada
tingkat kanonik (`Tinggi` = `High` = `عالٍ`), bukan pada teks.

```bash
python scripts/check_report.py id.md en.md ar.md --parity               # 0 ERROR
```

### 4. Redaksi — gerbang: pemindai bersih

```bash
python scripts/check_report.py naskah-publik.md --summary --final      # ringkasan: tolak temuan terbuka + pindai sensitif
python ../../../.github/scripts/check-sensitive.py docs/UJI-KERENTANAN.md
```

`--summary` melewati bagian wajib (ringkasan bukan laporan penuh) tetapi
**menolak** temuan `F-nn` berstatus terbuka/mitigasi/diterima — hanya temuan
yang **sudah ditutup** boleh tampil di teks publik (K37).

`check_report.py` memakai pola `scan_sensitive.py` (kunci, JWT, connection
string, host cloud, IP, jalur host, NIK/telepon). Pemindai hanya menangkap pola
mekanis — **baca dengan mata** bagian yang menyebut kelemahan.

### 5. Terbitkan

- **Laporan penuh** → di luar repo; temuan tinggi → advisory privat.
- **`docs/UJI-KERENTANAN.md`** → prosedur + ringkasan netral kontrol terverifikasi
  baik; perbarui bila kontrolnya berubah.
- Registrasi skill di tabel Skills `AGENTS.md` dan peta `docs/README.md`.

## Berkas dalam skill ini

| Berkas | Fungsi |
|---|---|
| `scripts/check_report.py` | Pemeriksa naskah: bagian wajib, lima butir temuan, skor CVSS vs vektor, pita peringkat, paritas antar bahasa, pindai sensitif |
| `scripts/test_check_report.py` | Uji regresi pemeriksa — jalankan `python scripts/test_check_report.py` |
| `references/kerangka-laporan.md` | Isi tiap bagian 1–10 + lampiran; lima butir temuan; resep Ringkasan |
| `references/standar-dan-alasan.md` | Standar acuan (OWASP/NIST/PTES/CVSS) dan mengapa dipilih |
| `references/kesiapan-dan-batas.md` | Gerbang kesiapan (alat mana wajib ada lebih dulu), batas uji, kejujuran tingkat verifikasi, uji redaksi |
| `references/kesalahan-yang-sudah-terjadi.md` | Kesalahan nyata + kode pemeriksa yang menangkapnya |
| `assets/template-laporan.md` | Kerangka siap isi |

## Bila model Anda kecil

- Satu bagian per putaran; jalankan `check_report.py` sesudah **tiap** temuan.
- Salin vektor CVSS dan skornya; jangan menebak — pemeriksa menolak ketidakcocokan.
- Bila sebuah kalimat tak bisa Anda dukung dengan `berkas:baris`, hapus kalimatnya.
- Jangan menambal pemeriksa agar lulus; perbaiki isinya.
