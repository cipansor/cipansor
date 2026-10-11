# Dokumentasi Cipansor

Peta seluruh dokumentasi **Sistem Informasi Cipansor**. Dokumen di sini disusun
menurut **siapa yang membacanya**, bukan menurut jenis berkasnya, supaya pembaca
menemukan jalannya tanpa menebak nama berkas.

Bahasa mengikuti pembaca: dokumen yang dibaca staf, pengurus, dan penerima serah
terima ditulis dalam bahasa Indonesia; catatan teknis internal dalam bahasa
Inggris. Keduanya sengaja hidup berdampingan di sini.

> Aturan gaya dan arsitektur untuk **menulis kode** ada di `AGENTS.md` akar dan
> `AGENTS.md` tiap paket, bukan di `docs/`. Folder ini memuat dokumen untuk
> **manusia**: pengurus, staf, pengelola sistem, pengembang, auditor, donor.

## Mulai dari mana

| Kalau Anda… | Buka |
|---|---|
| pengurus yayasan, auditor, atau donor — butuh gambaran sistem menyeluruh | [`DOKUMEN-TEKNIS.md`](./DOKUMEN-TEKNIS.md) |
| guru atau staf — butuh cara memakai aplikasi sehari-hari | [`PANDUAN-PENGGUNA-UMUM.md`](./PANDUAN-PENGGUNA-UMUM.md) |
| guru — buku panduan peran | [`PANDUAN-PENGGUNA-GURU.md`](./PANDUAN-PENGGUNA-GURU.md) |
| musyrif — membina santri mukim | [`PANDUAN-PENGGUNA-MUSYRIF.md`](./PANDUAN-PENGGUNA-MUSYRIF.md) |
| wali santri — memantau anak | [`PANDUAN-PENGGUNA-WALI-SANTRI.md`](./PANDUAN-PENGGUNA-WALI-SANTRI.md) |
| tata usaha — layanan administrasi unit | [`PANDUAN-PENGGUNA-TATA-USAHA.md`](./PANDUAN-PENGGUNA-TATA-USAHA.md) |
| bendahara — tagihan, pembayaran, akuntansi | [`PANDUAN-PENGGUNA-BENDAHARA.md`](./PANDUAN-PENGGUNA-BENDAHARA.md) |
| kepala unit — akademik dan kepegawaian unit | [`PANDUAN-PENGGUNA-KEPALA-UNIT.md`](./PANDUAN-PENGGUNA-KEPALA-UNIT.md) |
| pengurus yayasan — mutu, risiko, dan keuangan yayasan | [`PANDUAN-PENGGUNA-PENGURUS-YAYASAN.md`](./PANDUAN-PENGGUNA-PENGURUS-YAYASAN.md) |
| santri — hafalan, ibadah, ujian, dan kegiatan harian | [`PANDUAN-PENGGUNA-SANTRI.md`](./PANDUAN-PENGGUNA-SANTRI.md) |
| pengembang baru — butuh peta kode | [`ARCHITECTURE.md`](./ARCHITECTURE.md), lalu `AGENTS.md` akar |
| mengelola server produksi | [`DEPLOYMENT.md`](./DEPLOYMENT.md), [`deploy-azure.md`](./deploy-azure.md) |
| membangun aplikasi Android orang tua | [`MOBILE_API.md`](./MOBILE_API.md) |

## 1. Dokumen aplikasi — serah terima, audit, hibah, pelatihan

Dihasilkan dari kode oleh skill `.claude/skills/dokumen-aplikasi-cipansor`, dengan
pemeriksa mesin yang mencocokkan rute, angka, label layar, dan model data terhadap
kode yang sebenarnya. Tiap dokumen punya sumber Markdown **dan** terbitan
`.docx`/`.pdf` bersampul logo yayasan.

| Dokumen | Pembaca | Kerangka |
|---|---|---|
| [`DOKUMEN-TEKNIS.md`](./DOKUMEN-TEKNIS.md) | pengurus, pengelola sistem, pengembang baru, auditor/donor | arc42 (12 bab) + C4 tingkat 1–3, 11 diagram |
| [`PANDUAN-PENGGUNA-UMUM.md`](./PANDUAN-PENGGUNA-UMUM.md) | staf dan guru | Diátaxis: tutorial, konsep, rujukan |
| [`PANDUAN-PENGGUNA-GURU.md`](./PANDUAN-PENGGUNA-GURU.md) | guru | Diátaxis: buklet peran, kartu tugas |
| [`PANDUAN-PENGGUNA-MUSYRIF.md`](./PANDUAN-PENGGUNA-MUSYRIF.md) | musyrif | Diátaxis: buklet peran, kartu tugas |
| [`PANDUAN-PENGGUNA-WALI-SANTRI.md`](./PANDUAN-PENGGUNA-WALI-SANTRI.md) | wali santri | Diátaxis: buklet peran, kartu tugas |
| [`PANDUAN-PENGGUNA-TATA-USAHA.md`](./PANDUAN-PENGGUNA-TATA-USAHA.md) | tata usaha | Diátaxis: buklet peran, kartu tugas |
| [`PANDUAN-PENGGUNA-BENDAHARA.md`](./PANDUAN-PENGGUNA-BENDAHARA.md) | bendahara | Diátaxis: buklet peran, kartu tugas |
| [`PANDUAN-PENGGUNA-KEPALA-UNIT.md`](./PANDUAN-PENGGUNA-KEPALA-UNIT.md) | kepala unit | Diátaxis: buklet peran, kartu tugas |
| [`PANDUAN-PENGGUNA-PENGURUS-YAYASAN.md`](./PANDUAN-PENGGUNA-PENGURUS-YAYASAN.md) | pengurus yayasan | Diátaxis: buklet peran, kartu tugas |
| [`PANDUAN-PENGGUNA-SANTRI.md`](./PANDUAN-PENGGUNA-SANTRI.md) | santri | Diátaxis: buklet peran, kartu tugas |
| [`EVALUASI-DOKUMEN.md`](./EVALUASI-DOKUMEN.md) | penulis dan pemeriksa dokumen | audit dokumen terhadap kode: temuan, akar masalah, yang belum selesai |

Bacalah `EVALUASI-DOKUMEN.md` sebelum memperbarui dokumen: ia mencatat apa yang
sudah salah dan mengapa, termasuk tingkat verifikasi tiap panduan (T1/T2/T3).

## 2. Catatan teknis hidup — pengembang dan pengelola sistem

Ditulis dan dirawat bersama kode; berubah saat kode berubah.

| Dokumen | Isi |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | gambaran monorepo: `apps/api`, `apps/web`, `packages/shared` — "peta"-nya; aturan rinci ada di `AGENTS.md` |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | cara men-deploy ke production di VM: prasyarat, Docker, migrasi, pemantauan, keamanan |
| [`deploy-azure.md`](./deploy-azure.md) | rencana dan langkah pindah dari VM tunggal ke Azure App Service |
| [`MOBILE_API.md`](./MOBILE_API.md) | kontrak API untuk aplikasi Android portal orang tua (autentikasi bearer, endpoint, FCM) |
| [`EMAIL_SETUP.md`](./EMAIL_SETUP.md) | cara sistem mengirim email (Gmail API): langkah persis penyiapan kredensial |

## 3. Rencana dan desain — belum tentu jadi

Usulan dan hasil audit yang mendahului implementasi. Setelah dikerjakan, bagian
yang sudah jadi dipindahkan ke catatan hidup di atas atau ke kode.

| Dokumen | Isi |
|---|---|
| [`EOFFICE_ESIGN_PLAN.md`](./EOFFICE_ESIGN_PLAN.md) | audit dan rencana E-Office serta tanda tangan elektronik (TTE): temuan, standar, keputusan |
| [`planning/chatbot-design.md`](./planning/chatbot-design.md) | desain dan pertimbangan chatbot layanan pelanggan |

## 4. Tangkapan layar

`images/` memuat 78 tangkapan layar antarmuka (PNG) yang dirujuk `README.md` akar
dan dokumen lain. `screens/` memuat gambar per dokumen, disalin oleh
`screens_manifest.py` dari tangkapan alur yang **lolos** pada aplikasi berjalan;
hanya gambar yang benar-benar dirujuk naskah yang masuk git. Atlas lengkap per
peran dan tangkapan mentah adalah artefak hasil bangun, tidak dilacak. Cara
menangkapnya ada di skill `screenshot-roles`.

## Konvensi folder ini

- **Sumber adalah Markdown.** Hanya `.md` yang dilacak git; `.docx` dan
  `.pdf` dihasilkan darinya dan **tidak** disunting maupun di-commit. Biner
  dibangun ulang saat dibutuhkan untuk dikirim ke pengurus, donor, atau auditor
  — git menampilkannya sebagai "Binary files differ", jadi menyimpannya di repo
  tidak menambah kemampuan meninjau apa pun.
- **Nama dokumen terbit memakai HURUF-BESAR** (`DOKUMEN-TEKNIS.md`); catatan
  kerja dan rencana memakai huruf kecil (`deploy-azure.md`,
  `planning/chatbot-design.md`). Beberapa dokumen lama seperti `ARCHITECTURE.md`
  dan `MOBILE_API.md` mengikuti gaya HURUF_BESAR dengan garis bawah.
- **Hasil bangun tidak dilacak git** (lihat `.gitignore`): `fakta/` (angka
  terukur dari kode), `diagrams/` (gambar Mermaid berhash), `alur/` (berkas
  kerja tangkapan layar), dan biner `*.docx`/`*.pdf`. Yang dilacak: `.md`.

## Membangun ulang dokumen aplikasi

Markdown adalah sumbernya. Alat ada di
`.claude/skills/dokumen-aplikasi-cipansor/scripts/`; alur lengkap dan aturannya
di `SKILL.md` skill itu.

```bash
S=.claude/skills/dokumen-aplikasi-cipansor/scripts
python3 $S/check_env.py                                   # perkakas lengkap? (LibreOffice harus punya komponen Writer)
python3 $S/collect_facts.py . --out docs/fakta            # ukur ulang kode -> fakta/facts.json
python3 $S/check_docs.py docs/DOKUMEN-TEKNIS.md --kind teknis \
  --repo . --facts docs/fakta/facts.json --final          # 0 ERROR
python3 $S/build_docs.py docs/DOKUMEN-TEKNIS.md --out docs \
  --format docx --pdf --title "Dokumen Teknis Aplikasi" --subtitle "Sistem Informasi Cipansor" \
  --version 0.3 --status Draf --commit <hash> --logo apps/web/public/logo.png
python3 $S/scan_sensitive.py docs/DOKUMEN-TEKNIS.md docs/PANDUAN-PENGGUNA-*.md
```

Untuk panduan pengguna pakai `--kind pengguna` (dan `--trace jejak.md` untuk
melihat dari berkas mana tiap nama tombol berasal). Bila `build_docs.py`
mencetak `GAGAL`, jangan menyerahkan hasilnya.

> Pindai **dokumen yang dihasilkan ini**, jangan seluruh `docs/*.md`. Catatan
> operasional seperti `DEPLOYMENT.md` dan `EMAIL_SETUP.md` sengaja memuat
> contoh *placeholder* (sandi contoh, nama host contoh) yang sudah disetujui
> `.github/scripts/check-sensitive.py`; menyapu semuanya membuat pemindai
> melaporkan contoh yang memang diizinkan, dan lama-lama orang berhenti
> membacanya. Untuk seluruh repo, pemeriksa resminya adalah
> `python .github/scripts/check-sensitive.py`.

## Menjaga dokumen tetap akurat

Dokumen di bagian 1 **dihasilkan, bukan diketik ulang**: ukur ulang kode, periksa,
lalu bangun kembali — jangan menyunting angka di dalam `.docx`. Tiap dokumen
mencatat commit basisnya di sampul dan riwayat revisi.

> Sebelum dokumen dibagikan ke luar (donor, auditor, vendor), jalankan
> `scan_sensitive.py` dan baca bab Risiko & Utang Teknis dengan mata. Repositori
> ini publik sampai rilis: jangan memuat kredensial, host, IP, kelemahan yang
> masih terbuka, ataupun daftar perbaikan yang belum ada di produksi.

## Status dokumen aplikasi

Draf 0.8 dokumen teknis, basis kode commit `9b0efdc5` plus pohon kerja (perbaikan
modul `certificates`, `rewards`, `violations`, dan `hr` belum dikomit). Panduan
pengguna kini berperingkat **T1** pada bagian yang sudah dijalankan: bab "Mulai
Memakai Aplikasi" pada Panduan Umum, dan seluruh kartu tugas **delapan buklet
peran** — **Guru**, **Musyrif**, **Wali Santri**, **Tata Usaha**, **Bendahara**,
**Kepala Unit**, **Pengurus Yayasan**, dan **Santri** — masing-masing memuat
tangkapan layar asli dari alur yang lolos pada aplikasi berjalan. Bab konsep dan
rujukan Panduan Umum masih berperingkat **T2** (disusun dari kode, belum diuji
sebagai bacaan konsep). Yang belum dikerjakan ada di
[`EVALUASI-DOKUMEN.md`](./EVALUASI-DOKUMEN.md), bagian 12.

Seluruh keluaran lolos pemeriksa mesin pada 30 September 2026: `check_docs.py`
0 ERROR/0 WARN untuk kesepuluh dokumen, `scan_sensitive.py` bersih, PDF tanpa
halaman kosong (28 halaman dokumen teknis; 9–19 halaman tiap buklet). Pemeriksa
`check_docs.py` mencocokkan angka "hulu rute API" terhadap `facts.json` dan,
sejak pemeriksaan ulang terakhir, **memeriksa tiap baris Lampiran A** (jumlah
handler, alamat mount, penandaan Prisma di route/controller) — bukan hanya
jumlah barisnya, yang pernah menyembunyikan lima baris basi.
