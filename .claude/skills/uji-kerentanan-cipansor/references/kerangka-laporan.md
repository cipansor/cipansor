# Kerangka laporan uji kerentanan

Kerangka ini mengikuti praktik standar (OWASP WSTG, NIST SP 800-115, PTES).
Ringkasan Eksekutif + Bagian 1–10 + lampiran.

## Ringkasan Eksekutif

Untuk pengurus dan donor, bukan penguji. Tiga paragraf: (a) apa yang diuji dan
atas izin siapa; (b) berapa temuan per peringkat (kritis/tinggi/sedang/rendah)
dan berapa yang sudah ditutup; (c) arah perbaikan utama. **Tanpa** langkah
eksploitasi.

## Bagian 1 — Pendahuluan & Otorisasi

Tujuan uji; **pemberi izin** (Ketua Yayasan) dan tanggal izin; penyusun; **commit
+ tanggal** yang diuji (dari `git rev-parse HEAD`); tanggal uji. 1.3 menyatakan
batas "tanpa uji merusak" secara eksplisit.

## Bagian 2 — Lingkup & Metodologi

Yang diuji (modul, permukaan) dan yang **tidak**. Lingkungan: aplikasi lokal +
data seed, bukan staging/produksi. Metodologi: gray-box (baca kode + jalankan).

**2.5 — Batas yang memengaruhi hasil (wajib).** Cakupan sampel; alat pemindai
otomatis yang dijalankan **dan yang tidak**; perbedaan lingkungan uji vs
produksi (mis. rate-limit mati pada `NODE_ENV=development`). Bagian ini tidak
boleh kosong dan tidak boleh dikarang "hijau".

## Bagian 3 — Arsitektur & Permukaan Serangan

Monorepo `apps/api` (Express 5, Prisma, JWT), `apps/web` (Next.js), PostgreSQL,
Redis. Permukaan: API REST, halaman web, unggahan berkas, autentikasi, situs
publik. Rujuk `docs/ARCHITECTURE.md` dan `docs/DOKUMEN-TEKNIS.md` C4-1/2.

## Bagian 4 — Ringkasan Temuan

Tabel: `F-nn` | Peringkat | Kategori OWASP | Status. **Wajib sama** dengan
Register (Bagian 5); pemeriksa menolak ketidakcocokan.

## Bagian 5 — Register Temuan

Satu blok per temuan, dengan judul `## F-nn <judul>` dan lima butir:

```markdown
## F-01 <judul singkat>

- Peringkat: Tinggi (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N = 7.5)
- Kategori: A01 Broken Access Control
- Sumber: Diuji langsung
- Status: Terbuka
- Rekomendasi: <arah perbaikan, tanpa langkah eksploitasi>
```

Skor **harus** cocok dengan vektor (`check_report.py` menghitungnya ulang), dan
peringkat harus cocok dengan pita skor. Bila temuan ditutup, ganti Status.

## Bagian 6 — Kontrol yang Terverifikasi Baik

Kontrol yang diuji dan **lulus**, dengan bukti `berkas:baris`. Ini bagian yang
menenangkan auditor: bukan "tidak ada temuan", tetapi "kontrol ini terbukti
bekerja".

## Bagian 7 — Pemetaan OWASP

Tabel pemetaan temuan ke OWASP Top 10 (2021) dan OWASP API Security Top 10
(2023). Satu temuan boleh memetakan ke lebih dari satu.

## Bagian 8 — Peta Jalan Perbaikan

Urutan perbaikan menurut peringkat dan ketergantungan; siapa mengerjakan.

## Bagian 9 — Rencana Uji Ulang

Kapan uji ulang dijalankan (setelah temuan tinggi ditutup, sebelum rilis besar)
dan apa yang diperiksa ulang.

## Bagian 10 — Penanganan Bukti

Di mana bukti mentah disimpan (di luar repo), siapa yang boleh membukanya, dan
kapan dihapus. Bukti mentah **tidak** pernah masuk repo.

## Lampiran

Alat dan versi yang dipakai; daftar periksa WSTG; daftar sumber (bila ada).
