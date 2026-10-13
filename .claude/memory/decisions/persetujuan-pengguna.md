# persetujuan-pengguna

> Keputusan pengguna 2026-09-29 — setiap pengguna Sistem Informasi Cipansor
> menyetujui Syarat & Ketentuan, Kebijakan Privasi, dan batasan regulasi
> **sekali**, di halaman khusus sesudah login. Menolak = keluar (logout).
>
> **Diubah untuk pegawai 2026-10-09 (D1).** Pemrosesan data pegawai —
> termasuk swafoto dan lokasi absen — berdasar **perjanjian kerja dan
> kepentingan sah** (UU 27/2022 Ps. 20 ayat 2 huruf b dan f), bukan
> persetujuan. Pegawai **membaca** pemberitahuan privasi dan S&K sekali sesudah
> login, ditandai "sudah membaca" per versi; yang keberatan dicatat admin unit
> sebagai pengecualian; **tidak ada logout**. Alasannya: persetujuan pegawai
> kepada pemberi kerjanya tidak bebas, dan "menolak = logout" menghalangi orang
> bekerja. Bagi pengguna lain aturan 2026-09-29 tetap.

Ini tempat mencatatnya. Sebelumnya belum ada halaman Syarat & Ketentuan
maupun Kebijakan Privasi di portal; dokumen ini yang menyebutkannya pertama
kali.

## Aturannya

| Hal | Diputuskan |
|---|---|
| Kapan muncul | Sekali, tepat sesudah login, sebelum portal bisa dipakai |
| Bentuk | Halaman khusus (`/persetujuan`), bukan pop up yang bisa ditutup |
| Isi | Syarat & Ketentuan, Kebijakan Privasi (termasuk selfie + geolokasi absensi), batasan regulasi |
| Versi | Disetujui **per versi**. Versi baru → diminta lagi |
| Menolak | Keluar (logout) dan kembali ke halaman masuk — **kecuali pegawai** (2026-10-09): pegawai tidak menolak, ia membaca; keberatannya dicatat admin unit |
| Bukti | `UserConsent`: siapa, versi berapa, kapan, dari alamat IP mana |
| Siapa yang menyunting teks | Super Admin (versi baru, tidak menyunting yang sudah disetujui) |

## Kenapa halaman, bukan pop up

Pop up bisa ditutup dengan ESC, diblokir, atau tidak terbaca di layar kecil.
Persetujuan yang harus **wajib** tidak boleh punya jalan keluar diam-diam.
Halaman khusus juga memberi ruang untuk membaca teksnya.

## Kenapa per versi

Persetujuan berlaku untuk teks yang dibaca saat itu. Kalau teksnya berubah,
persetujuan lama tidak lagi menaunginya — jadi pengguna diminta lagi. Menyunting
teks yang sudah disetujui akan membuat bukti persetujuan berbohong.

## Dasarnya (diriset 2026-09-29, jangan diulang)

- **UU 27/2022 (PDP).** Persetujuan harus spesifik dan berdasarkan informasi
  yang jelas; pemrosesan selfie dan geolokasi pegawai termasuk data pribadi.
  Karena itu consent dicatat, dan absensi selfie punya masa simpan
  ([`absensi-pegawai.md`](absensi-pegawai.md)).
- **PP 71/2019 (PSE).** Penyelenggara sistem elektronik wajib menyediakan
  syarat dan ketentuan serta kebijakan privasi yang dapat dibaca pengguna.
- **Kebiasaan portal Indonesia** — layar "Syarat & Ketentuan" di awal masuk,
  dengan tombol Setuju / Tidak setuju yang mengakhiri sesi bila ditolak.

## Yang sudah ada dan yang belum

Belum ada. Yang perlu dibangun: model `UserConsent`, model/versi teks
persetujuan, endpoint `GET /consent/current` + `POST /consent/accept`, halaman
`/persetujuan` di web, dan gerbang di `middleware.ts` supaya portal tidak bisa
dibuka sebelum disetujui. Rinciannya di [`../roadmap.md`](../roadmap.md).
