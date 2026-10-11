---
name: naskah-dinas
description: Naskah dinas elektronik (E-Office) dan Tanda Tangan Elektronik (TTE) Cipansor — jenis naskah, alur konsep → paraf → tanda tangan → kirim atau disposisi → arsip, penomoran, kunci TTE dan verifikasi identitas penandatangan, PDF yang ditandatangani dan arsip byte-nya, verifikasi publik lewat unggah PDF (bukan QR/token), pencabutan naskah, dan batas standarnya (UU ITE, PP 71/2019, AATL). Use when touching the correspondence or esign modules, the letter PDF generator, the public verification page, revocation, or answering how a letter moves and who may sign, revoke or verify it — and before "restoring" a QR landing page or proposing a PSrE, both of which are settled.
---

# Naskah dinas dan TTE

Keadaan fitur ini **sekarang**. Riwayat audit, rencana PR, dan sumber-sumber
standarnya ada di `docs/EOFFICE_ESIGN_PLAN.md` (1.300 baris). Rujuk bagiannya
kalau butuh alasan yang lebih dalam. Keputusan yang mengikat ada di
`.claude/memory/decisions/` (daftarnya di bawah).

## Model naskah

- **Jenis** (`LetterType`): Surat Dinas, Nota Dinas, Surat Keputusan, Surat
  Tugas, Surat Edaran, Surat Undangan, Surat Keterangan, Berita Acara,
  Pengumuman.
- **Klasifikasi keamanan** empat tingkat (Biasa, Terbatas, Rahasia, Sangat
  Rahasia) dan **kode klasifikasi arsip** (`FilingClassification`).
- **Agenda** masuk dan keluar dipisah, per unit, per tahun ajaran, dengan bulan
  angka Romawi.
- **Nomor terbit hanya saat naskah meninggalkan DRAFT**, di dalam transaksi
  yang sama. Konsep tidak menghabiskan nomor, jadi buku agenda tidak berlubang.

**Siapa ikut:** siswa, orang tua, komite, dan alumni tidak bisa menjadi
peserta (`EXCLUDED_CORRESPONDENCE_ROLES`). TU, kepala sekolah, dan admin unit
menangani surat unitnya sebagai bagian tugasnya (`LETTER_UNIT_SCOPE_ROLES`).
Keduanya ada di `packages/shared/src/roles.ts` dan dibaca UI maupun
`apps/api/src/utils/letter-access.ts`.

## Alur status (`LetterStatus`)

```
Surat keluar:
DRAFT ─ajukan─► PENDING_REVIEW ─paraf berjenjang─► READY_TO_SIGN ─TTE─► SIGNED ─kirim─► SENT ─► ARCHIVED
                    │                                                (modul esign)
                    └─► REVISION_NEEDED ─sunting, ajukan ulang─► PENDING_REVIEW

Surat masuk:
dicatat ─disposisi─► DISPOSED ─► ARCHIVED
```

- **Paraf berjenjang dengan urutan giliran.** Semua pemaraf selain penanda
  tangan harus setuju sebelum penanda tangan boleh menandatangani.
- Transisi memakai `SELECT … FOR UPDATE` dan diperiksa ulang di dalam
  transaksi. Setiap langkah menambah satu baris `LetterFlowEvent`, yang hanya
  bertambah.
- **Disposisi** bisa ke banyak penerima, dengan instruksi, tenggat, catatan
  hasil, dan `completedAt`. Disposisi bisa bertingkat (`parentDispositionId`).
- **Tembusan** diatur lewat `/letters/:id/tembusan`.
- Syarat tiap transisi ada di `correspondence.service.ts` (`submitForReview`,
  `processReview`, `resubmitLetter`, `dispatchLetter`, `createDisposition`,
  `archiveLetter`) dan `esign.service.ts` (`signLetter`). Baca di sana sebelum
  menjanjikan sebuah transisi.

## TTE — kunci dan identitas

- **Kunci Ed25519 per penanda tangan.** Kunci privat disegel AES-256-GCM di
  bawah KEK dari scrypt (`utils/esign.ts`, `esign-lifecycle.ts`).
- **Passphrase TTE terpisah dari sandi akun**, dan tidak pernah disimpan, bahkan
  dalam bentuk hash. Jadi sesi yang dibajak tidak bisa menandatangani.
- Kunci publik disalin ke setiap tanda tangan. Karena itu merotasi atau
  mencabut kunci tidak membuat naskah lama tampak palsu.
- **Jenis pengajuan** (`ENROLLMENT` atau `RENEWAL`) ditentukan server dari
  keadaan kunci. Masa berlaku (`grantedDays`) dipilih penyetuju per pengajuan.
  Salah passphrase berulang membuat kunci terkunci sementara.
- **Identitas di balik kunci:** `UserIdentity` berisi nama sesuai KTP, NIK,
  dan tempat/tanggal lahir, ditambah pindaian KTP. Pengajuan ditolak bila data
  belum lengkap. Super Admin memeriksa pindaian itu saat memutuskan, dan setiap
  pembacaannya tercatat. Pindaian tidak disajikan rute statis mana pun, dan
  disimpan `IDENTITY_DOCUMENT_RETENTION_YEARS` tahun (bawaan 7) **sejak kunci
  berakhir** (`utils/identity-document-store.ts`).
- Rantai "isi identitas → ajukan → disetujui" diuji dari ujung ke ujung di
  `esign.identity-chain.test.ts`. Rantai ini pernah buntu total (#449),
  karena dua uji masing-masing hanya menguji separuh rantai.

**Di mana (2026-09-25):**
- **Penanda tangan:** *avatar (kanan atas) → Settings → tab Akun → Tanda
  Tangan Elektronik*. Di sana ia mengajukan, mengaktifkan, dan mengganti
  passphrase.
- **Super Admin:** *Sistem → Tanda Tangan Elektronik* (`/settings/esign`), untuk
  memutuskan pengajuan dan mencabut kunci.
- **Menandatangani:** di halaman naskahnya (`/e-office/letter/[id]`), saat
  statusnya READY_TO_SIGN.
- **E-Office** ada di menu dengan grup berbeda per keluarga peran: *Sarana &
  Layanan*, *Informasi*, atau *Administrasi*. Cetak menunya dengan skill
  `panduan-peran`.

## PDF yang ditandatangani

- PDF dibuat server sebagai **vektor** (`utils/generate-letter-pdf.ts`). Byte
  final **diarsipkan dalam transaksi yang sama** dengan tanda tangannya.
  Unduhan menyajikan byte itu, bukan hasil render ulang.
- **Setiap perubahan tata letak adalah migrasi.** SHA-256 contoh naskah dipaku
  di `generate-letter-pdf.test.ts`. Surat yang ditandatangani sebelum arsip ada
  ditutup dengan `pnpm --filter api db:archive-letters` (`--dry-run` dulu).
  Skrip ini hanya mengarsipkan surat yang hasil render ulangnya sama persis
  dengan `pdfHash`, dan melaporkan yang menyimpang. Jalankan **sebelum**
  menggelar perubahan generator.
- **Huruf Arab di badan naskah ditolak** dengan pesan yang menyebut karakternya
  (`assertRenderable`). Font standar hanya WinAnsi, dan tanpa mesin *shaping*
  huruf Arab tercetak terpisah-pisah dan urutannya terbalik. Rencananya PR-7
  (harfbuzzjs), atau jalur penyusunan DOCX (§5b(a), tahap 1 sudah dikirim di
  #454).
- **Tidak ada NIP** di blok tanda tangan maupun di halaman verifikasi
  (diputuskan 2026-09-03).
- **Jalur `UPLOADED`** (penyusun mengekspor PDF sendiri lalu mengunggahnya):
  yang ditandatangani adalah byte unggahan itu, dengan visualisasi TTE
  dicap di atasnya — bukan render ulang sistem. Berkas yang diunggah harus
  **tercatat milik rantai surat itu** (`LetterUpload`, CWE-639); berkas tanpa
  catatan pemilik ditolak, sebab kepemilikannya tidak dapat dibuktikan.
  Jalur penyusunan (`GENERATED`/`UPLOADED`) ikut ditampilkan di halaman
  verifikasi, karena jaminannya berbeda.

## Bentuk kanonik dan versinya

`canonicalPayload` adalah **byte yang ditandatangani**. Ia pernah berubah —
garis kewenangan (a.n./u.b./Plt./Plh.) menambah dua ruas — sehingga
`canonicalPayload(payload, version)` menyimpan `v1` dan `v2` berdampingan.
`LetterSignature.canonicalVersion` mencatat versi yang dipakai; baris lama
bernilai `NULL` dan diperlakukan sebagai `v1` (`canonicalVersionOf`). Verifikasi
**wajib** memakai versi tersimpan, bukan bentuk terkini: memverifikasi tanda
tangan `v1` dengan aturan `v2` menolaknya sebagai berubah. Menambah ruas baru
pada payload berarti menaikkan `CURRENT_CANONICAL_VERSION`, bukan menyunting
`v1`.

## Retensi — mendaftar, tidak pernah memusnahkan

- **Jadwal Retensi Arsip** disalin dari JRA ke `FilingClassification.retention`
  (tahun). Pekerjaan mingguan (`letter-retention.job.ts`, Senin 05:00 WIB) dan
  perintah `pnpm --filter api db:retention-review` menghitung naskah yang
  melewati masa retensinya, dan **hanya itu**.
- **Tidak ada tombol musnah, dan itu batas keras.** Pemusnahan arsip menuntut
  prosedur yang benar dan berita acara (UU 43/2009 Pasal 51–52 jo. PP 28/2012),
  bukan pekerjaan terjadwal. Penjaganya bukan sekadar niat:
  `letter-retention.no-destroy.guard.test.ts` menolak `delete`/`deleteMany`/
  SQL `DELETE` di pekerjaan/CLI retensi, dan menolak modul non-uji mana pun yang
  menghapus `Letter`/`LetterSignature`. Halaman `/e-office/retention` menyajikan
  daftar usul dan ekspornya untuk rapat penilaian.
- Daftarnya dibatasi cakupan akses (`letterScopeWhere`): TU satu sekolah tidak
  melihat perihal naskah Rahasia unit lain.
- **Naskah yang dicabut tetap dikenali saat diunggah.** Salinan bercap DICABUT
  byte-nya berbeda dari `pdfHash`, jadi `verifyByPdfBuffer` mencocokkannya lewat
  `revokedSha256` yang disimpan pada arsip saat pencabutan dicatat
  (`utils/letter-revoked-copy.ts`), lalu meneruskannya ke `verifyByToken` agar
  jawabannya "dicabut", bukan "tidak terdaftar". Cap karangan siapa pun tetap
  dijawab "tidak terdaftar", sebab yang dipercaya hash-nya, bukan teksnya.

## Verifikasi publik — unggah PDF, bukan QR

- `/public/verify-letter`: pengunjung mengunggah PDF, lolos Turnstile
  (`requireTurnstile('verify-letter')`) dan pembatas laju, lalu server
  membandingkan SHA-256 byte-nya dengan `LetterSignature.pdfHash`
  (`POST /api/esign/verify-pdf`).
- **`/verifikasi/[token]` sengaja dihapus.** Token hanya membuktikan "ada surat
  dengan token ini", bukan "dokumen di tangan Anda adalah surat itu". Terbukti
  di produksi: satu bit dibalik, jawabannya `found: false`. **Jangan
  dipulihkan.**
- QR di naskah berisi **alamat halaman verifikasi, tanpa token**
  (`letterVerificationUrl()`), dengan lambang yayasan di tengahnya.
- Naskah yang dicabut tetap terverifikasi sebagai *ditemukan, utuh, dicabut*.
  Pencabutannya **dibuktikan** secara kriptografis (`revocationVerified`),
  bukan sekadar dipercaya.
- **Status kunci** (`/public/verify-key`, `GET /esign/public/key-status?fingerprint=…`)
  menjawab apakah **kunci** yang menandatangani masih berlaku (aktif /
  kedaluwarsa / dicabut, dengan kode sebab RFC 5280) dari sidik jari SPKI-DER
  yang tercetak di setiap halaman verifikasi. Ia **tentang kunci, bukan
  dokumen** — sehingga tidak dapat menjadi oracle token yang dihapus §1
  rencana. Ini menutup AATL ICA7.

## Pencabutan naskah

- **Siapa boleh** — tabelnya di
  `packages/shared/src/types/letter-revocation-authority.ts`, dibaca server dan
  UI:
  - setiap orang boleh mencabut tanda tangannya sendiri;
  - Pengawas: juga naskah Pengurus dan seluruh jabatan unit;
  - Pembina: juga naskah Pembina mana pun, termasuk pendahulunya;
  - Ketua, Sekretaris, Bendahara: hanya naskahnya sendiri;
  - **Super Admin: sama sekali tidak.** Ia hanya boleh mencabut *kunci*,
    dengan kode sebab RFC 5280.
- **Mencabut adalah pernyataan bertanda tangan.** Pencabut memakai passphrase
  dan kuncinya sendiri (`signRevocation`), sehingga menyunting alasannya
  kemudian membatalkan tanda tangan itu.
- Naskah yang dicabut **tetap bisa dicetak, dengan cap DICABUT**
  (`stampRevoked`). Capnya dibubuhkan pada salinan, dan hanya setelah render
  ulang cocok dengan `pdfHash`.
- **Mengajukan ≠ memutuskan.** Siapa pun yang boleh membaca naskah boleh
  mengajukan permohonan pencabutan (`LetterRevocationRequest`). Pihak yang
  berwenang memutuskannya di halaman naskah itu sendiri.
- Istilahnya "Pencabutan Naskah Dinas", bukan "cabut tanda tangan".

## Batas standar — jangan menjanjikan lebih

- **Garis kewenangan (a.n./u.b./Plt./Plh.) tercetak, tetapi tata kelolanya
  belum diputuskan.** Bentuknya ada di `SELECTABLE_SIGNING_AUTHORITY_FORMS`
  dan dapat dipilih penanda tangan yang sudah ditunjuk; sistem **tidak**
  memvalidasi surat kuasa atau SK penunjukan apa pun, karena memang tidak
  menyimpannya. Yang belum dijawab yayasan: siapa boleh menandatangani a.n.
  siapa, kapan tiap bentuk berlaku, dan — pertanyaan yang paling tajam —
  apakah pelimpahan itu cukup. **Anggaran Dasar Pasal 18 ayat 1** menyatakan
  Pengurus mewakili yayasan hanya sebagai **Ketua Umum bersama satu anggota
  Pengurus lain**, sehingga naskah yang mewakili yayasan ke pihak luar
  menuntut **dua** tanda tangan; satu tanda tangan Ketua belum memenuhi
  pasal itu. Karena itu a.n./u.b./Plt./Plh. **tidak boleh** diperlakukan
  sebagai pengganti penanda tangan kedua sampai yayasan memutuskannya.
  Keputusan ini terbuka di `docs/EOFFICE_ESIGN_PLAN.md` §6 butir 2 —
  **jangan ditutup tanpa keputusan yayasan.**
- TTE ini **tidak tersertifikasi** menurut PP 71/2019. Keputusan yayasan
  2026-09-03: **tetap memakai kunci sendiri, tanpa PSrE**. Keputusan itu
  sekaligus menunda segel elektronik dan kalimat kaki baku BSrE. Kalimat BSrE
  **tidak boleh disalin**, karena menyebut sertifikat yang tidak kita punya.
- **Ed25519 tidak menghalangi PAdES.** ETSI TS 119 312 V2.1.1 Tabel A.1
  mencantumkan EdDSA sebagai *shall support*; yang tidak menerimanya adalah
  **AATL**, program keanggotaan CA yang memang bukan sasaran yayasan. Mengganti
  ke RSA/ECDSA adalah pilihan interoperabilitas Acrobat, bukan syarat PAdES.
- Belum ada stempel waktu RFC 3161, dan **PAdES B-B ditunda (opsi b,
  2026-09-29)** sampai yayasan menetapkan penyedia TSA — tanpa stempel waktu
  tepercaya, pertanyaan "apakah kuncinya masih berlaku *saat* menandatangani"
  belum bisa dijawab. Lihat `decisions/esign-standards-ceiling.md`.
- Visualisasi TTE menurut aturan Indonesia minimal berisi QR, nama, dan
  jabatan. Logo tidak bisa menggantikan QR.

## Masih terbuka untuk yayasan

Dari `docs/EOFFICE_ESIGN_PLAN.md` §6:
- **kewenangan tanda tangan dan tanda tangan bersama:** siapa boleh
  menandatangani a.n. siapa, kapan u.b./Plt./Plh. berlaku, dan apakah naskah
  yang mewakili yayasan ke luar menuntut dua tanda tangan (Anggaran Dasar
  Pasal 18 ayat 1) — bentuknya sudah tercetak, tata kelolanya belum diputuskan;
- naskah mana yang harus terverifikasi di luar pesantren (menentukan perlu
  tidaknya PSrE, dan kapan PAdES B-B dibuka kembali);
- berapa lama naskah bertanda tangan dan arsip PDF-nya disimpan;
- huruf Arab di badan naskah (PR-7, atau jalur DOCX);
- berapa lama naskah yang dicabut masih bisa diunduh;
- konfirmasi identitas resmi yayasan (nama sesuai pengesahan, NPWP, alamat)
  terhadap dokumennya.

## Kode

| Bagian | Berkas |
|---|---|
| Persuratan | `apps/api/src/modules/correspondence/` (routes, service, `signed-pdf.ts`) |
| TTE, verifikasi, pencabutan | `apps/api/src/modules/esign/`, `apps/api/src/utils/esign.ts`, `esign-lifecycle.ts` |
| PDF | `apps/api/src/utils/generate-letter-pdf.ts` (+ uji hash yang dipaku) |
| Web | `apps/web/src/app/e-office/`, `apps/web/src/app/public/verify-letter/`, `apps/web/src/app/settings/esign/`, `apps/web/src/components/settings/esign-panel.tsx` |
| Aturan bersama | `packages/shared/src/roles.ts`, `packages/shared/src/types/letter-revocation-authority.ts` |

## Keputusan yang mengikat

`.claude/memory/decisions/`:
- `eoffice-revocation-authority.md` — siapa boleh mencabut;
- `eoffice-revocation-mechanics.md` — passphrase, cap DICABUT, permohonan;
- `eoffice-verify-by-upload-not-qr.md` — unggah PDF, bukan token;
- `esign-standards-ceiling.md` — AATL, PSrE, riset yang jangan diulang.
- `derajat-kecepatan-naskah.md` — tiga derajat: Sangat Segera (24 jam), Segera
  (2 × 24 jam), Biasa; tidak ada Kilat terpisah.
- `surat-keterangan-lewat-eoffice.md` — surat keterangan santri dibuat sebagai
  naskah E-Office yang terisi dari data santri, bukan dicetak dengan nomor
  buatan browser.

Keputusan baru di domain ini disimpan sebagai berkas di `decisions/` dan
didaftarkan di sini.
