# Kontrak API Aplikasi Mobile (Android) — Portal Orang Tua

Fondasi backend untuk aplikasi Android Cipansor (visi PR #298). Semua endpoint
sudah tersedia dan teruji di API; aplikasi Flutter tinggal mengonsumsinya.

Base URL: `https://<host>/api` — autentikasi Bearer JWT (login → access +
refresh token). Semua respons berbentuk `{ success, data, ... }`.

**Aplikasi mobile harus menandai dirinya sebagai klien bearer.** Portal web
tidak lagi menerima token di badan respons: API menaruh sesinya di cookie
`HttpOnly` yang tak bisa dibaca JavaScript, dan mengembalikan `{ user }` saja.
Klien yang tidak memegang cookie (Flutter) mengirim header `X-Client: bearer`
pada `POST /auth/login`, `POST /auth/2fa/login`, dan `POST /auth/refresh`, lalu
menerima `accessToken`/`refreshToken` di badan respons seperti sebelumnya —
termasuk `tempToken` pada langkah 2FA. Tanpa header itu, `tempToken` tidak
dikirim dan aplikasi tidak dapat menyelesaikan tantangan 2FA.

## 1. Autentikasi

| Endpoint                                              | Keterangan                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `POST /auth/login` `{email, password}`                | Orang tua login. Admin ber-2FA mendapat `requiresTwoFactor + tempToken`. |
| `POST /auth/refresh` `{refreshToken}`                 | Perpanjang sesi.                                                         |
| `PUT /notifications/fcm-token` `{token}`              | Daftarkan token push FCM perangkat (kirim `{token: null}` saat logout).  |
| `POST /notifications/push/subscribe` `{subscription}` | Simpan langganan Web Push peramban (per perangkat).                      |
| `POST /notifications/push/unsubscribe` `{endpoint}`   | Hapus langganan Web Push untuk satu endpoint.                            |

## 2. Capaian anak (role PARENT)

| Endpoint                                                            | Keterangan                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /parent/children`                                              | Daftar anak.                                                                         |
| `GET /parent/children/:studentId/weekly-progress`                   | Ringkasan mingguan: kehadiran, tahfidz (ziyadah/murojaah/nilai), perilaku, akademik. |
| `GET /parent/children/:studentId/tahfidz` / `attendance` / `grades` | Detail per domain.                                                                   |

## 3. Tagihan & pembayaran SPP

| Endpoint                                   | Keterangan                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /parent/children/:studentId/finance`  | Tagihan + ringkasan pembayaran anak.                                                                                                                                                                                                                                                             |
| `POST /finance/invoices/:id/payment-proof` | **Upload bukti transfer** — body `{amount, method, referenceNo?, proofUrl, notes?}`. Membuat Payment `PENDING_VERIFICATION`; kepemilikan diverifikasi (orang tua hanya bisa membayar tagihan anaknya). Unggah berkas gambarnya sendiri via `POST /upload` lalu pakai URL-nya sebagai `proofUrl`. |

`dueDate` adalah sebuah **tanggal**, bukan jam. Bentuknya berbeda saat menulis
dan saat membaca:

- **Menulis** (`POST /finance/invoices`, `PUT /finance/invoices/:id`): kirim
  **`YYYY-MM-DD`** (mis. `2026-08-10`). Timestamp ISO seperti
  `2026-08-10T12:00:00Z` **ditolak** dengan 400.
- **Membaca** (`GET /parent/children/:studentId/finance`): setiap tagihan
  mengembalikan `dueDate` sebagai **timestamp ISO** (mis.
  `2026-08-10T00:00:00.000Z`), bukan string tanggal. Ambil sepuluh aksara
  pertama (`YYYY-MM-DD`) sebagai tanggalnya; jangan menafsirkan jamnya.

Bulan penagihan otomatis bulanan dan pengingat SPP mengikuti **kalender WIB**,
bukan kalender server.

### Alur verifikasi (maker-checker Tata Usaha)

```
PENDING_VERIFICATION → (TU unit memverifikasi) → TU_APPROVED
TU_APPROVED → (admin unit — orang berbeda — mengesahkan) → FINAL_APPROVED
PENDING/TU_APPROVED → REJECTED (dengan alasan)
```

- Tagihan & jurnal akuntansi hanya ter-update saat `FINAL_APPROVED`
  (idempotent — tidak mungkin terposting dua kali).
- Saat `FINAL_APPROVED`, orang tua & santri menerima notifikasi
  **"Pembayaran SPP Berhasil"** (in-app + email + WhatsApp bila provider
  dikonfigurasi). Saat `REJECTED`, notifikasi berisi alasan penolakan.
- Halaman TU web: `/finance/verification`.

## 4. Notifikasi

| Endpoint                             | Keterangan                        |
| ------------------------------------ | --------------------------------- |
| `GET /parent/notifications`          | Daftar notifikasi + unread count. |
| `PUT /parent/notifications/:id/read` | Tandai dibaca.                    |

**Pengingat tagihan otomatis**, dua jalur yang saling melengkapi:

- **Bulanan (tanggal 1, 06:00 WIB).** `jobs/spp-reminder.job.ts` mengirim
  pengingat tagihan SPP bulan berjalan ke orang tua santri yang tagihannya belum
  lunas (in-app + WhatsApp bila provider dikonfigurasi).
- **Jelang jatuh tempo (harian, 08:00 WIB).** Tugas `payment-reminder` penjadwal
  notifikasi mengingatkan **sekali per tagihan** saat tagihan memasuki jendela
  tujuh hari sebelum jatuh tempo (kunci `payment-reminder:<id>`), bukan tiga kali
  pada H-7/H-3/H-1.

WhatsApp lewat transport yang belum dikonfigurasi (mis. `SIMULATOR`) tidak
benar-benar terkirim. Hanya notifikasi ber-`dedupeKey` (mis. jalur
`payment-reminder`) yang menyimpan status pengiriman per kanal: transport
log-only dicatat `PENDING`, kesalahan transport dicatat `FAILED` — keduanya
bukan `SENT`. Percobaan ulangnya terikat jendela seleksi tugas itu
(`dueDate: { gte: now, lte: now + 7 hari }`): selama tagihan masih terpilih, run
harian berikutnya mencoba kanal yang belum `SENT`; begitu tanggal jatuh tempo
terlewati, tagihan keluar dari seleksi dan status `PENDING`/`FAILED` itu tidak
pernah dicoba lagi (pada praktiknya percobaan terakhir jatuh pada run sehari
sebelum jatuh tempo, karena `dueDate` disimpan pada tengah malam UTC). Jalur SPP
bulanan (`jobs/spp-reminder.job.ts`) **tidak** menyimpan status itu sama sekali,
jadi pengingat yang gagal pada tanggal 1 tidak pernah dicoba ulang; jangan
menganggapnya terkirim sampai provider disetel, dan kirim ulang secara manual
bila provider baru diaktifkan setelah tanggal 1.

## 5. Konfigurasi server (env)

| Variabel                                                      | Fungsi                                            |
| ------------------------------------------------------------- | ------------------------------------------------- |
| `WA_PROVIDER` = `META` \| `FONNTE` \| `WABLAS` \| `SIMULATOR` | Provider WhatsApp (default SIMULATOR = log saja). |
| `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`                       | Kredensial Meta Cloud API.                        |

## Status implementasi mobile

**Aplikasi mobile dikirim sebagai PWA (Progressive Web App)** dari `apps/web`,
menggantikan rencana Flutter terpisah di PR #298. Alasannya: web app sudah
matang dan terintegrasi penuh dengan API ini, sehingga satu basis kode langsung
menjadi aplikasi yang dapat dipasang di layar utama (Android/iOS) tanpa stack
Dart terpisah, toko aplikasi, atau CI mobile tambahan.

Yang sudah ada di repo:

- `apps/web/public/manifest.json` — nama, `id`, `scope`, ikon 72–512 dengan
  entri `maskable` terpisah (aman untuk topeng OS), `screenshots` (wide + narrow
  untuk Richer Install UI), `display: standalone`, shortcuts. Orientasi tidak
  dikunci agar tablet bisa lanskap.
- `apps/web/public/icons/icon-*.png` + `icons/maskable-*.png` — set ikon
  aplikasi dan rendisi maskable-nya. Dibuat ulang oleh
  `apps/web/scripts/gen-pwa-assets.py` saat logo berubah.
- `apps/web/public/sw.js` — service worker: navigasi network-first dengan
  *navigation preload* + fallback `offline.html`, `/api/**` selalu ke jaringan
  (tidak pernah di-cache agar data auth/sesi selalu segar). `_next/static/**`
  cache-first (nama ber-hash), aset statis lain stale-while-revalidate, dua
  cache dibatasi jumlah entri. Versi baru **tidak** langsung `skipWaiting()`;
  menunggu sampai pengguna menyetujui muat ulang.
- `ServiceWorkerRegister` + `InstallPrompt` + `UpdatePrompt`
  (`components/pwa/*`) di root layout — registrasi SW (produksi saja), tombol
  "Pasang aplikasi" (dengan panduan Share-sheet di iOS, yang tidak pernah
  memicu `beforeinstallprompt`), dan banner "Versi baru tersedia".
- `useWebPush` (`hooks/use-web-push.ts`) + kartu "Notifikasi Push di Perangkat
  Ini" di `/notifications/settings` — langganan Web Push per perangkat, terhubung
  ke `POST /notifications/push/{subscribe,unsubscribe}` dan tabel
  `push_subscriptions`. Kunci publik VAPID dibaca dari
  `GET /notifications/push/config`.
- Pengiriman push: setiap notifikasi lonceng baru dikirim ke perangkat
  penerima oleh `push-dispatch.service.ts` (tiap 15 detik), mengikuti
  preferensi tersimpan (`GET/PATCH /notifications/preferences`) dan jam tenang
  WIB. Kesehatan, konseling, pelanggaran, aduan, dan temuan
  pengawasan/risiko tampil generik di layar kunci. Keputusan dan alasannya:
  `.claude/memory/decisions/notifikasi-push.md`.
- Metadata iOS (`appleWebApp`, apple-touch-icon) + `themeColor`.

Portal Orang Tua (`/parent/*`) adalah target utama mobile dan sudah responsif
(sidebar Sheet di layar kecil).

**Langkah lanjut opsional (butuh kredensial/tooling di luar repo):**

- **Kunci VAPID per lingkungan:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
  (rahasia), dan `VAPID_SUBJECT` di API. Satu pasangan untuk tiap lingkungan,
  tidak pernah dipakai bersama. Selama kunci kosong, push mati dan kartunya
  berkata begitu.
- **APK Play Store:** bungkus PWA yang sama dengan Capacitor (≈95% reuse) —
  butuh Android SDK/signing (dibangun di luar environment ini).
