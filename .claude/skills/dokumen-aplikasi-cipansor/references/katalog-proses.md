# Katalog proses bisnis — untuk alur bergambar

Tiap proses: akun demo, halaman, dan spec e2e yang sudah memuat langkah **yang berjalan** beserta label persis layar.
Terjemahkan spec ke `*.flow.json` dengan tabel di `tangkapan-layar.md`. Status: **Diuji** = alurnya sudah dijalankan pada aplikasi
berjalan (29 September 2026); **Dari spec** = langkah dibaca dari spec e2e dan belum dijalankan sebagai alur.

| Proses | Status | Akun (e-mail demo) dan giliran | Halaman utama | Spec untuk ditiru |
|---|---|---|---|---|
| Absensi harian → tindak lanjut Alpa | **Diuji** (`assets/contoh-alur/absensi-harian.flow.json`) | `sdit.walikelas@` (wali kelas SD 1A) | `/attendance` → `/attendance/record` → `/attendance/follow-ups` | `attendance-recording.spec.ts` |
| Pengesahan RKA Yayasan | **Diuji** (`assets/contoh-alur/pengesahan-rka-yayasan.flow.json`) | `yayasan.ketua@` → `yayasan.pengawas@` → `yayasan.ketua@` → `yayasan.pembina@` | `/perencanaan/{{plan}}` (dokumen dibuat lewat `setup`) | `perencanaan-pengesahan.spec.ts` |
| Izin santri (ajukan → putuskan → gerbang) | Dari spec | `smpit.ortu@` (wali) → `pesantren.musyrif@` (koordinator asrama putra) → `sarana.keamanan@`; santri harian: wali → `sdit.walikelas@`, kepala `sdit.kepala@` | `/parent/permits` ("Ajukan Izin", "Kirim Pengajuan") → `/permits` ("Perlu keputusan saya", "Setujui") → `/permits/gate` ("Pos gerbang", "Periksa", "Catat keluar", "Catat kembali") | `permits.spec.ts`, `permit-koordinator-asrama.spec.ts` |
| SPMB → kelas → tagihan | Dari spec | pendaftar: `"as": "publik"` (tanpa login) → admin SPMB (`sdit.admin@` atau `super.admin@`) | `/public/spmb` (tab pendaftaran dan "Cek Status") → `/spmb` → `/spmb/registrations/[id]` (verifikasi, nilai, terima, onboarding) → kelas dan tagihan | `spmb-workflow.spec.ts` (alur penuh), `admission-to-class-to-finance.spec.ts` |

Catatan yang sudah ditemukan:
- Alur yang memakai wali kelas harus memakai `*.walikelas@`, bukan `*.guru@` (hanya wali kelas yang punya kelas sendiri di data awal).
- Halaman publik SPMB: judul "Pendaftaran SPMB Pesantren Cipansor"; tombol "Daftar SPMB", "Cek Status", "Pilih unit tujuan",
  "Pilih jenis kelamin", "Sebelumnya", "Selanjutnya"; isian "Nama Lengkap", "Tempat Lahir", "Tanggal Lahir", "NIK", "Nomor Kartu Keluarga".
  Isi hanya data contoh; jangan NIK sungguhan.
- Proses lain (persuratan + TTE, verifikasi pembayaran SPP, setoran tahfidz, RKA Unit): turunkan dengan cara yang sama — cari spec di
  `apps/web/e2e`, baca skill `naskah-dinas`/`tata-kelola-yayasan`/`panduan-peran`, jalankan `plan` untuk akun yang terlibat.
- Jalankan alur satu per satu; jangan menganggap sebuah proses "selesai" sebelum `flow-report.json` `ok: true` dan kartu/tahapnya
  dibandingkan dengan laporan itu.
