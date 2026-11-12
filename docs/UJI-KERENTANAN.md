# Prosedur Uji Kerentanan Internal

> **Catatan penting.** Dokumen ini memuat **prosedur** dan **ringkasan netral**
> — bukan laporan temuan. Selama repositori ini publik, **laporan penuh**
> (daftar temuan `F-nn` beserta peringkat, langkah, dan bukti) disimpan **di
> luar repo** dan tidak di-commit (keputusan maintainer **K37**, 2026-11-09;
> `decisions/otomasi-armada.md` butir 5; `docs/SDLC-FLOW.md` invarian 9;
> `SECURITY.md`).

## 1. Mengapa prosedur ini ada

Yayasan Pesantren Cipansor menyimpan **data pribadi anak** (NIK, No. KK, NIK
orang tua, penghasilan orang tua) dan **data keuangan** di sistemnya. Pengurus,
auditor, dan donor memerlukan bukti bahwa sistem diuji keamanan secara
**terukur dan berulang**, bukan sekali lalu ditinggalkan. Dokumen ini adalah
prosedur bakunya; skill
[`.claude/skills/uji-kerentanan-cipansor`](../.claude/skills/uji-kerentanan-cipansor/SKILL.md)
memuat templat dan pemeriksa mesinnya.

## 2. Batas yang mengikat

| Batas | Isi |
|---|---|
| **Otorisasi** | Uji dijalankan atas izin **Ketua Yayasan Pesantren Cipansor**. Tanpa izin tertulis, tidak ada uji. |
| **Lingkup** | *Gray-box*: penguji boleh membaca kode dan menjalankan aplikasi **lokal dengan data seed**. **Tidak** menyentuh staging maupun produksi. |
| **Tanpa uji merusak** | Tanpa DoS/banjir permintaan, tanpa mengubah atau menghapus data nyata, tanpa mengakses rahasia produksi, tanpa rekayasa sosial. |
| **Redaksi** | Teks publik tidak memuat langkah eksploitasi, kredensial, alamat IP, nama/ID sumber daya cloud, jalur host, kelemahan yang masih terbuka, maupun data pribadi. |
| **Penyimpanan** | Laporan penuh (bukti mentah + daftar temuan) tinggal di **Lampiran Rahasia di luar repo**. Yang di-commit hanya prosedur ini dan ringkasan netral (§5). |
| **Temuan** | Temuan keamanan dibuka sebagai **GitHub security advisory privat**, bukan issue publik (`SECURITY.md`). Perbaikannya lewat PR publik yang ditulis **netral** — aturannya, bukan celahnya. |

## 3. Kerangka laporan penuh (disimpan di luar repo)

Laporan penuh mengikuti praktik standar (OWASP WSTG, NIST SP 800-115, PTES) dan
terdiri atas **Ringkasan Eksekutif** + **Bagian 1–10** + lampiran:

1. Pendahuluan & Otorisasi
2. Lingkup & Metodologi
3. Arsitektur & Permukaan Serangan
4. Ringkasan Temuan
5. Register Temuan
6. Kontrol yang Terverifikasi Baik
7. Pemetaan OWASP Top 10 + OWASP API Security Top 10
8. Peta Jalan Perbaikan
9. Rencana Uji Ulang
10. Penanganan Bukti

Tiap temuan `F-nn` membawa **lima butir**: **Peringkat** (CVSS v3.1 indikatif),
**Kategori** OWASP, **Sumber** (*Diuji langsung* / *Terdokumentasi*), **Status**,
dan **Rekomendasi**. Peringkat dan status **wajib sama** bila laporan ditulis
dalam lebih dari satu bahasa — dibandingkan pada tingkat kanonik (mis.
`Tinggi` = `High` = `عالٍ`), bukan pada teks.

### 3.1 Batas yang wajib dinyatakan (Bagian 2.5)

Laporan wajib menyebut apa yang **membatasi** hasilnya: cakupan sampel, alat
pemindai otomatis yang **dijalankan** maupun yang **tidak**, dan perbedaan
lingkungan uji versus produksi. Bagian ini tidak boleh dikosongkan dan tidak
boleh dikarang "hijau": bila suatu alat tidak dijalankan, tulis demikian.

## 4. Alur kerja

1. **Izin** — konfirmasi otorisasi Ketua Yayasan (§2).
2. **Ukur basis** — catat **commit + tanggal** yang diuji; ia tercetak di
   sampul dan Bagian 1.1 laporan penuh.
3. **Jalankan** — nyalakan aplikasi lokal dengan data seed (skill `stack`),
   jalankan pemeriksaan terhadap kode dan aplikasi berjalan.
4. **Susun temuan** — tiap temuan `F-nn` dengan lima butir (§3); peringkat
   indikatif lewat CVSS v3.1.
5. **Periksa mesin** — `check_report.py` harus lulus: struktur temuan lengkap,
   skor CVSS cocok dengan vektornya, tabel Ringkasan sama dengan Register, dan
   tidak ada pola sensitif.
6. **Redaksi** — buang langkah eksploitasi, kredensial, IP, nama sumber daya
   cloud, dan data pribadi sebelum apa pun masuk `docs/`.
7. **Terbitkan temuan** — buka **advisory privat**; perbaikan lewat PR publik
   netral. Perbarui **ringkasan netral** (§5) tanpa menambah temuan terbuka.

## 5. Ringkasan netral (satu-satunya bagian yang publik)

Ringkasan netral menyatakan **bahwa** sistem diuji dan **kontrol apa** yang
terverifikasi baik — tanpa menyebut temuan yang masih terbuka. Berikut
kontrol yang terverifikasi baik pada kode saat ini. Tiap baris menyebut
**bukti di kode** dan **uji yang menjalankannya** (dengan berkas uji), bukan
sekadar berkas yang menamainya — pembaca dapat memeriksa sendiri hasilnya.

| Kontrol | Bukti di kode | Uji yang menjalankannya |
|---|---|---|
| Header keamanan HTTP | `helmet()` dipasang sebelum router (`apps/api/src/app.ts:136`) | aplikasi mengaktifkannya tanpa syarat; tidak ada uji khusus |
| CORS berdaftar | `buildCorsMiddleware(config.cors.origins)` — daftar asal, bukan `*` (`apps/api/src/app.ts:137`, `apps/api/src/config/cors.ts`) | `cors.test.ts` — "splits the comma-separated list", "strips a trailing slash" |
| Perlindungan CSRF | Cookie sesi `HttpOnly` + header *double-submit*; permintaan tak-aman tanpa header yang cocok ditolak (`apps/api/src/middleware/csrf.ts:31`) | `session-cookies.test.ts` — "sets HttpOnly access, refresh and routing cookies, plus a readable CSRF cookie" |
| Batas laju permintaan | Limiter global + limiter khusus `/uploads` (`apps/api/src/app.ts:224`, `apps/api/src/middleware/rate-limit.ts`) | `rate-limit.test.ts` — "runs its own limiter first, then auth, in production" |
| Berkas tersimpan bersifat privat | `/uploads` dijaga token akses di **semua** lingkungan (`uploadsAuth`, `apps/api/src/app.ts:202`) | `rate-limit.test.ts` — "omits the production limiter in development and test, keeping auth" |
| Validasi masukan di tepi | Skema Zod per modul, `validate`/`validateQuery` (`apps/api/src/middleware/validate.ts:24,38`) | `validated-query.test.ts` — "every module that validates its query also reads the validated result" |
| Kendali akses berbasis peran | `RoleCode` + izin; keputusan di `decisions/` dan skill `panduan-peran` | uji lingkup peran per modul (mis. `account-actions-scope.test.ts`, `subjects-access.test.ts`) |
| Autentikasi dua langkah | 2FA untuk akun organ yayasan (`decisions/autentikasi-2fa-dan-sandi.md`) | `second-factor-roles.test.ts` — "cannot turn it off" |
| Verifikasi anti-bot | Cloudflare Turnstile pada alur publik (`apps/api/src/middleware/turnstile.ts`) | `turnstile.middleware.test.ts` — "menghentikan permintaan yang tokennya ditolak" |
| Rahasia tidak di repo | `.github/scripts/check-sensitive.py` menolak kredensial, host sumber daya, IP, dan jalur host di Markdown | uji skill dokumen `test_tooling.py` |

> Ringkasan ini menyebut **kontrol yang terbukti ada**, bukan klaim bahwa tidak
> ada temuan. Temuan yang masih terbuka dilacak di advisory privat dan di
> `docs/DOKUMEN-TEKNIS.md` bab 11 sebagai kategori risiko internal.

## 6. Standar acuan

OWASP WSTG, OWASP Top 10 (2021), OWASP API Security Top 10 (2023), NIST SP
800-115, NIST SP 800-63B-4, CVSS v3.1, PTES, UU 27/2022 (PDP), dan UU ITE.

## 7. Uji ulang

Uji ulang dijadwalkan setelah perbaikan temuan berstatus tinggi selesai dan
sebelum rilis besar. Rencana uji ulang adalah Bagian 9 laporan penuh, sehingga
temuan yang sudah diperbaiki dapat ditutup dengan bukti.

## Riwayat Revisi

| Versi | Tanggal | Basis kode | Perubahan | Penyusun |
|---|---|---|---|---|
| 0.1 | 12 November 2026 | `main` (lihat commit PR) | Penyusunan awal: prosedur, batas, kerangka laporan penuh, ringkasan netral kontrol terverifikasi | Agen OpenHands |

> **Catatan.** Ringkasan netral di §5 dibaca dari kode; perbarui bila kontrolnya
> berubah, dengan mengukur ulang, bukan menyunting ingatan.
