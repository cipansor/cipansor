---
name: google-ad-grants
description: Google Ad Grants untuk Yayasan Pesantren Cipansor — kelayakan (yayasan, bukan sekolah), aturan kepatuhan bulanan (CTR 5%, kualitas kata kunci, sitelink, geo-targeting, konversi), perubahan program 2025–2026 (Performance Max, AI Max), cara memakai $10.000/bulan secara optimal, struktur kampanye, dan celah teknis situs yang harus ditutup lebih dulu (GA4/GTM host-aware, penandaan konversi; robots.txt bukan penghalang). Use when asked how to use, set up, optimize, or stay compliant with Google Ad Grants; when building the landing pages, conversion tracking, or analytics the grant needs; or before touching anything that affects the grant (landing page, robots, host-split, public prefixes).
---

# Google Ad Grants — Cipansor

Program Google Ad Grants memberi lembaga nonprofit hingga **$10.000/bulan**
iklan penelusuran gratis (Search; sejak 2025 juga Performance Max di Search +
Maps). Skill ini memuat yang **tidak** ada di kode: cara memakainya agar
efektif, efisien, dan **tetap patuh** — plus celah di repo ini yang harus
ditutup sebelum iklan dijalankan serius.

Riwayat audit dan sumber ada di akhir; ringkasnya di tabel kepatuhan.

## Fakta kelayakan yang menentukan segalanya

| Entitas | Layak Google for Nonprofits? | Dasar |
|---|---|---|
| **Sekolah** (SD IT, SMP IT, SMA Qur'an sebagai institusi akademik) | ❌ Tidak | Dikecualikan eksplisit |
| **Yayasan** terdaftar Menkumham | ✅ Ya | "Foundations (yayasan) approved as legal entities by the Ministry of Law and Human Rights" |
| **Cabang filantropis** lembaga pendidikan | ✅ Ya | "philanthropic arms of educational organizations are eligible" |

**Yang memegang grant adalah YAYASAN, bukan sekolah-sekolahnya.** Verifikasi
nonprofit lewat mitra Google **Goodstack** (TechSoup/Percent sudah tidak
dipakai). Semua iklan wajib dibingkai sebagai **misi sosial-keagamaan-pendidikan
yayasan** — bukan "jualan sekolah". Promosi pendaftaran santri (SPMB) tetap
boleh selama dibingkai sebagai program pendidikan/beasiswa yayasan, bukan
pendaftaran murid sekolah X.

## Aturan kepatuhan — jangan pernah dilanggar

Pelanggaran = **deaktivasi sementara**, bukan sekadar peringatan. Diperiksa
setiap bulan.

| Aturan | Ambang | Konsekuensi |
|---|---|---|
| CTR tingkat akun | **≥ 5%**/bulan | 2 bulan berturut <5% → deaktivasi |
| Konversi bermakna | **≥ 1/bulan** | Deaktivasi |
| Kata kunci satu kata | Dilarang (kecuali brand sendiri / istilah medis) | Kata kunci ditolak |
| Kata kunci terlalu generik | Dilarang ("charity", "donate", "berita hari ini") | Kata kunci ditolak |
| Quality Score | Tidak boleh 1–2 | Pause/hapus |
| Grup iklan per kampanye | **≥ 2** | Peringatan non-compliance |
| Sitelink | **≥ 2 aset aktif** | Peringatan non-compliance |
| Geo-targeting | Wajib di semua kampanye | Peringatan non-compliance |
| Smart Bidding | Maximize Conversions / Target CPA / ROAS (akun ≥ 22 Apr 2019) | Google mengubah bid otomatis |
| Aktivitas akun | Login ≥1×/bulan, ubah ≥1×/90 hari | Akun dianggap terlantar |
| Survei tahunan | Wajib dijawab | Deaktivasi |
| Situs | HTTPS, konten unik, tanpa AdSense/affiliate, landing bukan PDF, 1 domain | Non-compliance |

**Jarum paling berbahaya adalah CTR 5%.** Kuncinya bukan menambah kata kunci,
tapi **membuang** kata kunci bervolume besar tetapi CTR rendah. Kampanye brand
(kata kunci nama yayasan sendiri) hampir selalu CTR >5% dan menaikkan
rata-rata akun — jadikan penyelamat.

## Mekanisme anggaran — sering disalahpahami

- $10.000/bulan = batas **±$329/hari**; **sisa hari ini tidak mengalir ke
  besok**. "Menghemat" = membuang grant.
- Ini **plafon, bukan jatah**. Belanja nyata bergantung volume pencarian,
  kualitas iklan, dan struktur. Akun kecil wajar hanya terpakai
  $500–$3.000/bulan.
- Manual/CPC biasa dibatasi **$2/klik**; batas ini **hilang** kalau memakai
  Maximize Conversions.
- Target realistis = **kualitas trafik**, bukan menghabiskan $10.000.

## Perubahan program 2025–2026 — jangan pakai panduan lama

- **Performance Max (PMax)** tersedia sejak Jan 2025, tetapi untuk Ad Grants
  **hanya tayang di Search + Google Maps** (bukan Display/YouTube/Gmail).
- **AI Max untuk kampanye Search** di-rollout ke Ad Grants (2025, penuh awal
  2026): menaruh iklan di **AI Overviews**, memperluas match type, mengizinkan
  *final URL expansion*.
- **AI Overviews menggerus klik** pada kueri informasional → bergeser ke kueri
  ber-intent tinggi (donasi, daftar, hubungi).
- **Verifikasi pengiklan makin ketat (2026, bertahap s.d. 2028)**; kebijakan
  *Limited Ad Serving* kini mencakup Search.

## Playbook memakai grant secara optimal

### Struktur akun
- **1 kampanye = 1 tema**; semua grup iklan di dalamnya menuju **satu landing
  page**.
- Tiap kampanye **≥2 grup iklan**; tiap grup **5–10 kata kunci rapat tema**.
- Pakai **Responsive Search Ads (RSA)** — banyak headline & deskripsi.
- Tiap kampanye: **≥2 sitelink**, **geo-targeting**, dan **matikan opsi Display
  Network** di dalam kampanye Search (default menyala → melanggar).

### Kata kunci — long-tail, bukan volume
- ❌ "sekolah islam" → ✅ "SMP Islam terpadu di Kadipaten Majalengka",
  "pesantren tahfidz untuk anak", "biaya masuk SMA Qur'an".
- Pakai **phrase/exact match**; broad match hanya bila diawasi ketat + Smart
  Bidding.
- **Kata kunci negatif** diperiksa **mingguan** — ini penjaga CTR 5% dan
  penghemat anggaran. Contoh global sejak awal: *lowongan kerja, gratis,
  download, pdf, contoh, arti, nama pesantren/sekolah lain*.

### Bidding
- Mulai **Maximize Conversions**. Bila perlu dorong volume, **Target CPA**
  (mis. $500). Jangan ubah selama masa learning 5–7 hari.

### Konversi — jantung efektivitas sekaligus syarat wajib
Definisikan **≥1 aksi bermakna/bulan**. Kandidat di aplikasi Cipansor:
- **Formulir SPMB terkirim** (menampilkan nomor registrasi) → konversi utama
  terbaik.
- **Formulir donasi/wakaf terkirim** (menampilkan jumlah donasi) → konversi
  donasi.
- **Klik WhatsApp / telepon / email** dari `/kontak` → konversi mikro.
- **Unduh brosur SPMB** → konversi mikro.
- ❌ Jangan jadikan "waktu di situs" / "kunjungan beranda" sebagai konversi
  utama.

**Cara menandai konversi di repo ini — bukan lewat halaman "terima kasih".**
Kedua form sukses adalah **dialog di halaman yang sama**, bukan halaman
terpisah: SPMB (`public/spmb/spmb-form.tsx`) dan donasi
(`wakaf-infaq/donation-portal.tsx`) memanggil `setSuccessData(...)` lalu
merender `<Dialog open={!!successData}>`. **Tidak ada navigasi**, jadi pemicu
berbasis *pageview* (URL konfirmasi) tidak akan pernah menyala. Tandai konversi
di **titik sukses program** — tepat sesudah panggilan API sukses, di dalam
handler — lewat `window.gtag('event', …)` (atau `dataLayer.push`) dengan nama
event khusus (mis. `spmb_submit`). Itu lebih tahan lama daripada URL dan tetap
benar walau UI-nya kelak berubah jadi halaman penuh.

### Landing page
- Jangan arahkan semua ke beranda. Ad → halaman yang **persis** menjawab kata
  kuncinya.
- HTTPS, mobile-friendly, cepat, CTA jelas, sedikit tautan keluar, **bukan
  PDF**. Pemicu konversi **tidak** bergantung pada halaman "terima kasih" —
  lihat catatan di atas (keduanya dialog).

## Rencana kampanye Cipansor (dibingkai misi yayasan)

| Kampanye | Tema | Landing | Konversi |
|---|---|---|---|
| A. Wakaf & Infaq | wakaf pendidikan, infaq pesantren, sedekah | `/wakaf-infaq` | form donasi |
| B. Program Unggulan | pesantren tahfidz, pendidikan Islam terpadu | `/program-unggulan`, `/unit/*` | kunjungi unit |
| C. Pendaftaran Santri (SPMB) | pendaftaran pesantren 2027, SPMB SMP IT, biaya masuk | `/public/spmb` | submit SPMB |
| D. Brand | "cipansor", "yayasan pesantren cipansor" | `/` | — (penjaga CTR) |
| E. Local/Maps (PMax) | layanan yayasan di Kadipaten/Majalengka | `/kontak`, `/unit` | klik WA/telepon |

Geo-targeting: Majalengka + radius Jawa Barat untuk kampanye lokal; lebih luas
hanya untuk brand/program. Aset: sitelink *Pendaftaran SPMB · Wakaf & Infaq ·
Program Unggulan · Lokasi & Kontak*; callout *Terakreditasi · Tahfidz 30 Juz ·
NPSN terdaftar*; structured snippet *Unit: TK Qur'an, SD IT, SMP IT, SMA
Qur'an*.

**Landing SPMB selalu memakai host publik** (`cipansor.or.id/public/spmb`),
bukan portal — iklan hanya menunjuk domain yang disetujui, dan portal
`noindex`.

## Celah teknis di repo ini — tutup sebelum iklan serius

Satu hal **belum ada** dan menjadi prasyarat (diperiksa 2026-10-05):

1. **Tidak ada GA4 / GTM / gtag sama sekali** di `apps/web`. Tanpa ini tidak
   ada conversion tracking → akun berisiko dideaktivasi, dan Smart Bidding
   buta. Di `.env.example` masih tersisa `GOOGLE_ANALYTICS_ID` yang **tidak
   dibaca kode mana pun** (bukan di `docker-compose.yml`, bukan di workflow) —
   itu sisa niat, bukan tanda analitik setengah jalan. Jangan
   mengaktifkannya; bangun penandaan konversi host-aware seperti di atas.

Satu hal lagi **bukan** prasyarat, walaupun mudah disangka begitu:

- **Tidak ada `robots.txt` / `robots.ts`, dan itu tidak menghalangi crawling.**
  Google memperlakukan robots.txt yang menjawab 4xx "seolah tidak ada file
  robots.txt yang sah", artinya tanpa batasan crawl
  ([Google Search Central, robots.txt spec](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec)).
  Landing page sudah crawlable. Host portal tetap tidak terindeks, karena
  `layout.tsx` memasang meta `noindex, nofollow` di sana (`indexableHost`).
  Yang hilang hanya baris `Sitemap:` yang mengumumkan
  `apps/web/src/app/sitemap.ts` (sudah selaras dengan `publicPrefixes`).
  Sitemap tetap bisa didaftarkan langsung di Search Console. `robots.ts` yang
  host-aware boleh ditambahkan sebagai perapian: publik `allow` + `Sitemap:`,
  portal `disallow: /`. Kalau ditambahkan, **jangan** pernah `disallow` di host
  publik.

**Jebakan host — mudah salah.** Satu build melayani **dua host**
(`cipansor.or.id` publik dan `portal.cipansor.or.id`). Tag analitik **hanya
boleh aktif di host publik**; kalau dipasang menyeluruh, aktivitas staf/santri
di portal mengotori data dan berisiko privasi. Bangun **host-aware**, mengikuti
pola yang sudah ada di `apps/web/src/lib/host-split.ts` (mis.
`pwaEnabledForHost`, `indexableHost`).

Tiga hal yang harus dipahami sebelum menandai konversi:

- **Form SPMB juga hidup di host portal.** Matcher middleware
  (`apps/web/middleware.ts`) mengecualikan semua path yang diawali `/public`,
  jadi middleware (termasuk host-split) tidak pernah berjalan untuk
  `/public/spmb` — ia dilayani di **kedua** host (di portal pun tidak menabrak
  sesi staf). Tag khusus host publik karena itu **tidak menghitung** submit yang
  dibuat di portal. Untuk grant ini **tidak masalah**, karena iklan selalu
  menunjuk host publik; jangan pasang tag menyeluruh hanya untuk mengejar kasus
  itu.
- **Pelacak tidak butuh sesi.** `/public/spmb/track` memakai **nomor
  pendaftaran + tanggal lahir**, bukan sesi, jadi ia bekerja di host mana pun
  tanpa login (matcher middleware memang mengecualikan `/public/*`). Alasan
  tetap mengarahkan tautan ke host publik **bukan** "kalau tidak, diminta
  login", melainkan karena host publik adalah alamat **kanonik yang terindeks**
  (`sitemap.ts`), sedangkan portal `noindex` — alamat portal hanya duplikat.
- **Sesi memang tidak melintasi host** (`host-split.ts`), tetapi ini berlaku
  untuk fitur portal yang butuh login (mis. portal wali), **bukan** untuk
  pelacak publik.

Landing page publik yang sudah hidup & layak dipakai: `/`, `/profil`,
`/profil/pimpinan`, `/profil/legalitas`, `/program-unggulan`, `/unit`
(+per-unit), `/campus`, `/activities`, `/berita` (+artikel), `/galeri`,
`/wakaf-infaq`, `/kontak`, `/public/spmb`, `/public/spmb/track`. Unit: TK
Qur'an, SD IT, SMP IT, SMA Qur'an + tahfidz.

## Ritme pengelolaan (efisien: 30–60 menit/bulan)

| Ritme | Yang dikerjakan |
|---|---|
| Mingguan | Cek CTR akun (≥5%?); pause kata kunci CTR rendah bervolume tinggi; tambah kata kunci negatif dari Search Terms |
| Bulanan | Pastikan ≥1 konversi; pause kata kunci QS 1–2; uji 1–2 varian RSA; login akun; cek status "not billed" (jangan masukkan kartu kredit ke akun grant) |
| Per 90 hari | Ubah nyata (bid/kata kunci/iklan); audit struktur (≥2 grup/kampanye, ≥2 sitelink) |
| Tahunan | Jawab survei Google; perbarui data SPMB & brosur |

Audit akun penuh **tiap 6 bulan**. Tetapkan **1–2 penanggung jawab** (jangan
bergantung pada satu pribadi), pakai **akun khusus** (mis. `ads@cipansor.or.id`,
bukan akun pribadi), dan mulai dari akses **Read-only**.

## Keputusan yang masih terbuka (milik pengguna)

1. **Pengelola:** staf TU + checklist/skrip audit (hemat) vs API (butuh
   developer token + OAuth) vs agensi.
2. **Konversi utama:** submit SPMB vs form donasi vs keduanya.
3. **Prioritas pesan:** wakaf/infaq (paling kuat & aman dari kebijakan misi) vs
   pendaftaran santri vs keduanya.

## Jangan diulang

- Jangan mendaftar sebagai **sekolah** (ditolak) — daftar sebagai **yayasan**.
- Jangan membingkai iklan seperti **iklan bisnis** (melanggar kebijakan
  misi).
- Jangan pasang analitik di **kedua host**.
- Jangan masukkan **kartu kredit** ke akun grant.
- Jangan andalkan "set dan lupakan" — grant hilang di bulan ke-4 karena lalai,
  bukan gagal saat mendaftar.

## Sumber

- [Ad Grants Policy Compliance Guide](https://support.google.com/nonprofits/answer/9314402?hl=en)
- [Account management policy](https://support.google.com/nonprofits/answer/117827?hl=en)
- [Set up conversion tracking](https://support.google.com/nonprofits/answer/9841491?hl=en)
- [Eligibility – Indonesia](https://support.google.com/nonprofits/answer/3215869?hl=id&co=GENIE.CountryCode%3DID)
- [Google Ad Grants](https://www.google.com/grants)
- [Limited Ad Serving (2026)](https://support.google.com/adspolicy/answer/17344822?hl=en)
- Praktisi: [Getting Attention](https://gettingattention.org/google-ad-grants) ·
  [Whole Whale (PMax & Maps)](https://wholewhale.com/resources/google-maps-placements-for-ad-grants) ·
  [Big Sea 2026](https://bigsea.co/articles/get-google-ad-grants-nonprofit) ·
  [Elevation 2026](https://www.elevationweb.org/blog/google-ad-grants) ·
  [Digital Tabby (27 tips)](https://digitaltabby.com/google-ad-grant-tips) ·
  [Cause Inspired (AI Max)](https://causeinspiredmedia.com/google-news/can-you-use-ai-max-with-google-ad-grants-and-how-can-it-help-nonprofits)
