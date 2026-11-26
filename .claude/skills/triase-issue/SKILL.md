---
name: triase-issue
description: How a person or an agent other than the `Triase issue` automation helps triage issues in this repository — verify the premise against `main`, look for duplicates, check the real state of every dependency, weigh type and priority with evidence (`docs/LABELS.md`), judge readiness, turn an owner decision into researched options, and write ONE comment per issue with the verdict, the evidence and the exact ask. Only `cipansor-bot` applies labels, so this never labels or unlabels; the comment wakes the triage automation. Use when asked to "triase", "triase ulang", "cek issue", "kenapa issue ini blocked/question", "beri arahan implementasi", or to go through the issues carrying a label; not for writing a new issue (`buat-issue`) or reviewing a PR (`tinjau-pr`).
---

# Membantu triase issue

**Alur kerja issue dan PR di repo ini:** `buat-issue` → triase (`Triase issue`; dibantu skill `triase-issue`) → `ready` → `buat-pr` → tinjauan (`Gerbang tinjau PR`; dibantu skill `tinjau-pr`) → merge oleh pemilik.

**Siapa memutuskan apa.** `Triase issue` (SDLC 15) adalah satu-satunya triase
dan satu-satunya yang memasang label lewat `cipansor-bot`. Prompt-nya ada di
`scripts/deploy-sdlc-agents.py` (`TAILS["SDLC 15"]`), dan aturan labelnya di
`docs/LABELS.md`. Skill ini untuk orang atau agen lain yang membantu: ia
mengumpulkan bukti, menilai, dan menulis **satu komentar** yang membangunkan
triase lewat jembatan triase (`docs/LABELS.md` aturan 11). Ia tidak
menggantikan triase.

## 1. Baca semuanya sekali

- Body, semua komentar (termasuk ringkasan bot di bawah penanda
  `<!-- sdlc:triase -->`), label, dan PR yang menautkannya.
- Untuk sekumpulan issue (mis. semua yang `blocked`), daftarkan dulu, lalu baca
  satu per satu. Jangan menilai dari judul.

## 2. Periksa premisnya di `main`

- `git fetch origin main`, lalu baca kodenya. Tulis `berkas:baris` beserta
  commit yang dibaca; jangan menulis dari ingatan.
- **Bug:** reproduksi bila bisa, minimal dengan uji kecil atau perintah; sebut
  apakah ini regresi atau cacat lama.
- Tanyakan juga apakah premisnya benar, atau justru ada opsi "tidak perlu sama
  sekali".

## 3. Duplikat dan issue terkait

Cari issue terbuka dan tertutup dengan istilah, berkas, atau gejala yang sama.
Tautkan yang ditemukan. Yang menetapkan `duplicate` tetap triase.

## 4. Ketergantungan: periksa keadaan sebenarnya

- Untuk setiap nomor di `Bergantung pada:` (body maupun komentar triase),
  periksa apakah issue atau PR itu masih terbuka atau sudah digabung.
- **Penghalang yang sudah digabung bukan penghalang lagi.** Tidak ada otomasi
  yang mencabut `blocked` saat penghalangnya tertutup, jadi komentar inilah
  yang membangunkannya.
- Bila daftar ketergantungan di komentar triase berbeda dari body issue, sebut
  perbedaannya. Body issue yang ditulis sebagai spesifikasi adalah sumber
  kebenarannya.

## 5. Tipe, prioritas, kesiapan (rubrik `docs/LABELS.md`)

- **Tipe:** tepat satu. Tipe dari formulir adalah maksud pelapor; triase boleh
  mengoreksinya.
- **Prioritas:** di atas `medium` wajib berbukti: path, jumlah unit/peran yang
  terdampak, tenggat, atau id run. Bila ragu, pilih yang lebih rendah dan tulis
  alasannya. `critical` hanya untuk layanan mati, kehilangan data, atau celah
  yang aktif bisa dieksploitasi.
- **Kesiapan:**
  - `ready` hanya bila tujuannya jelas, kriterianya bisa diamati, tidak ada
    pertanyaan terbuka, dan tidak ada penghalang terbuka;
  - `blocked` bila ada ketergantungan yang belum selesai;
  - `question` bila ada keputusan atau pertanyaan yang belum dijawab.

  `ready` tidak pernah berdampingan dengan `question` atau `blocked`
  (`docs/LABELS.md` aturan 8).

## 6. Keputusan yang milik pemilik

Bila jalan keluarnya pilihan pemilik, ikuti aturan emas 12. Riset dulu dengan
sumber; keputusan di `.claude/memory/decisions/` tidak diriset ulang. Lalu
sajikan pilihan dengan rekomendasi di urutan pertama, termasuk "tidak perlu
sama sekali" bila nyata. Claude menanyakannya lewat `AskUserQuestion`. Jawaban
pemilik dicatat di komentar dengan tanggalnya.

## 7. Tulis satu komentar per issue

Struktur yang disarankan:

1. basmalah;
2. `## Pemeriksaan ulang — <tanggal>` (atau `## Keputusan pemilik — <tanggal>`);
3. putusan: tipe, prioritas, kesiapan, masing-masing dengan bukti;
4. **kriteria penerimaan final** — daftar ber-kotak-centang (`- [ ]` / `- [x]`),
   satu baris per kriteria, dengan tiap butir yang dipertajam, ditambah, atau
   diralat triase ditandai **pada butir itu sendiri**, dan ringkasan menyebut
   koreksinya. Di komentar ini daftar itu masih **usulan** — belum menggantikan
   apa pun dan belum dibaca hilir. **Hanya daftar di body yang berlaku**:
   daftar yang sama baru **menggantikan** daftar formulir issue (bukan
   salinannya) setelah `Triase issue` menuliskannya ke blok
   `<!-- sdlc:triase -->` pada body saat memasang `ready` — daftar itulah yang
   dibaca `Tiket jadi PR` (SDLC 06) dan `Gerbang tinjau PR` (SDLC 18), bukan
   daftar di komentar. Karena daftar formulir tetap terlihat di atas ringkasan
   di body, sebutkan bahwa hanya daftar final itu yang berlaku;
5. penghalang yang tersisa beserta apa yang dibutuhkan dari masing-masing;
6. arah implementasi: langkah pertama, risiko (migrasi atas data produksi,
   pasangan PR menurut aturan emas 9), dan pemecahan menjadi issue anak bila
   perlu (PR yang hanya `Refs` selalu merah);
7. permintaan yang persis kepada triase, mis. "**Mohon triase ulang:** …".

Prosa Bahasa Indonesia. Bila agen menulis atas nama akun manusia, nyatakan itu
dalam satu baris penutup. Bila perlu meralat, sunting komentar Anda sendiri,
jangan menumpuk komentar baru.

## 8. Batas

- **Jangan memasang atau mencabut label apa pun** — hanya `cipansor-bot` yang
  melabeli, dan `label-guard` mencabut label dari akun lain. Untuk issue `ready`
  atau `in-progress` (di luar jangkauan triase), sebut `@cipansor-bot` dengan
  koreksi yang diminta.
- Jangan menyunting ringkasan bot di bawah `<!-- sdlc:triase -->`, dan jangan
  menulis ulang body issue orang lain kecuali pemilik atau pelapor memintanya.
- Jangan menutup issue kecuali pemilik memutuskannya. Tutup dengan alasan yang
  tepat (`completed` / `not_planned`) dan komentar yang menyebut sebabnya.
- **Setiap komentar manusia membangunkan satu run triase.** Kolamnya dibatasi
  (`MAX_INFLIGHT=3` di `issue-triage-bridge.sh`; sisanya antre ke sapuan per
  jam). Komentari banyak issue sekaligus hanya bila diminta, dan sebutkan bahwa
  antreannya akan terisi.
- Kerentanan yang bisa dieksploitasi tidak dirinci di komentar publik; arahkan
  ke advisory privat (`SECURITY.md`), kecuali pemilik memutuskan lain untuk
  issue itu.

## Ringkas

Baca semuanya → periksa premis di `main` (dengan `berkas:baris`) → duplikat →
keadaan nyata setiap penghalang → tipe, prioritas, dan kesiapan menurut
`docs/LABELS.md` → **kriteria penerimaan final ber-kotak-centang** (usulan di
komentar; mengikat hanya setelah `Triase issue` menuliskannya ke body) dengan
koreksi ditandai pada butirnya → keputusan pemilik sebagai pilihan berisi
riset → **satu komentar** dengan putusan, bukti, kriteria final, arah, dan
permintaan triase ulang → tanpa label.
