---
name: dokumen-aplikasi-cipansor
description: Menyusun dokumen aplikasi Sistem Informasi Cipansor (repo ypcipansor/cipansor) — (1) Dokumen Teknis Aplikasi berkerangka arc42 dengan diagram C4 tingkat 1–3, dan (2) Panduan Pengguna / manual book berkerangka Diátaxis per peran dan per tugas — dari kode yang sebenarnya, dengan pemeriksa mesin yang mencocokkan rute, angka, label layar, dan model data terhadap kode, serta pemindaian data sensitif. Keluaran Markdown untuk docs/ dan .docx/.pdf bersampul logo yayasan. Gunakan setiap kali diminta dokumen teknis, dokumentasi sistem/arsitektur, dokumen serah terima, panduan pengguna, manual book, panduan per peran (guru, TU, bendahara, wali santri, dst.), atau pembaruan dokumen-dokumen itu, untuk aplikasi/sistem informasi/portal Cipansor — juga untuk hibah, donor, auditor, vendor, atau pelatihan staf.
---

# Dokumen Aplikasi Cipansor

Dua terbitan dari satu sumber Markdown (`docs/`):

| Terbitan | Pembaca | Kerangka | Baca dulu |
|---|---|---|---|
| **Dokumen Teknis** | pengurus, pengelola sistem, pengembang baru, auditor/donor | arc42 (12 bab) + C4-1/2/3 | `references/dokumen-teknis.md`, `assets/template-teknis.md` |
| **Panduan Pengguna** | staf, guru, pendidik, wali santri | Diátaxis: bagian umum + buklet per peran | `references/panduan-pengguna.md`, `assets/template-panduan.md`, `assets/template-kartu-tugas.md` |

Bacalah `references/kesalahan-yang-sudah-terjadi.md` sekali sebelum menulis: itu 29 kesalahan nyata dari percobaan
pertama skill ini, tiap satu dengan pemeriksa yang menangkapnya. `references/standar-dan-alasan.md` hanya bila
pengguna bertanya "kenapa begini".

## Lima aturan yang tidak boleh dilanggar

1. **Angka dari `facts.json`, bukan ingatan dan bukan `known-issues.md`.** Sebut commit + tanggalnya.
2. **Semua yang bukan angka juga dibaca dari kode:** alamat rute (dari `*.routes.ts`), nama tombol dan pesan (dari
   `apps/web/src`), nama model (dari `schema.prisma`), jadwal (dari `scheduler.ts`). Kalimat yang terdengar benar tetapi
   tak bisa Anda tunjuk berkas dan barisnya **tidak boleh ditulis**. Tidak yakin → tulis apa yang kode katakan, atau tanyakan.
3. **Repo publik sampai rilis; dokumen dikirim keluar.** Jangan menulis kredensial, nama/ID sumber daya cloud, IP, jalur host,
   kelemahan yang masih terbuka, detail insiden, data pribadi — dan **jangan menyebut perbaikan mana yang belum di produksi**.
4. **Hasil belum "selesai" sebelum pemeriksa mesin bersih.** `check_docs.py` 0 ERROR, `build_docs.py` kode keluar 0 tanpa
   "GAGAL", `scan_sensitive.py` bersih. Jangan menulis "Sesuai/selesai" berdasarkan penilaian sendiri.
5. **Katakan seberapa jauh — kepada pengguna, di percakapan.** Panduan: T1 (dicoba di aplikasi berjalan) / T2 (dari kode, tiap
   kartu bertanda ⚠) / T3 (kerangka saja). Status per kemampuan (cabang / `main` / staging / produksi) dilaporkan di
   percakapan; **tidak dicetak di manual staf**.

## Alur

Kerjakan berurutan. Tiap langkah punya **gerbang**: perintah yang harus berhasil sebelum lanjut.

### 0. Tentukan permintaan (tanya paling banyak satu kali, hanya bila benar-benar tak jelas)

- Jenis: teknis / panduan / keduanya (bawaan: keduanya). Format: Markdown di `docs/` (bawaan di repo) dan
  `.docx`/`.pdf` bila untuk dicetak atau dikirim keluar.
- Panduan: peran mana didahulukan. Jangan menulis semua peran dalam satu putaran; terbitkan Bagian Umum + satu–dua buklet.
- Baru atau pembaruan? Ada dokumen lama atau `facts.json` lama → **mode pembaruan** (langkah 8).
- Keputusan yang milik pengguna (mis. menambah/mengubah kebijakan): riset dulu, lalu beri pilihan berganda (`AGENTS.md`, aturan 12).

### 1. Siapkan lingkungan — gerbang: `python scripts/check_env.py` keluar 0

```bash
python scripts/check_env.py            # semua terbaca OK? bila ada PERLU: jalankan perintah "pasang:" yang dicetak
python scripts/check_env.py --md-only  # bila hanya Markdown yang diminta
```

Repo sudah ada di sesi? Pakai itu. Belum: `git clone --depth 1 https://github.com/ypcipansor/cipansor.git` (jangan `web_fetch`
ke github.com). Clone gagal → minta pengguna mengunggah zip; jangan menulis dari README saja.

### 2. Ukur — gerbang: `facts.md` ada dan commit tercetak

```bash
python scripts/collect_facts.py <repo> --out fakta
```

Baca `fakta/facts.md`. Lalu baca (ringkas, jangan salin): `docs/ARCHITECTURE.md`, `.claude/memory/progress.md`,
`known-issues.md`, `INDEX.md`, `decisions/*.md`; skill repo `panduan-peran`, `stack`, `screenshot-roles` bila ada.

### 2b. Tangkap layar (bila dokumen atau alur harus bergambar)

Panduan T1 dan "Alur proses" memerlukan gambar dari aplikasi yang berjalan. Baca `references/tangkapan-layar.md` (lapisan gambar, format
alur JSON, perintah, aturan menyemat) dan `references/katalog-proses.md` (proses, akun, spec untuk ditiru). Ringkas: nyalakan aplikasi
(skill `stack`) → tulis `docs/alur/<nama>.flow.json` → jalankan `screenshot-flow.ts flow` (skill `screenshot-roles`) →
`screens_manifest.py select` (hanya gambar yang tersemat masuk git) → `check_docs.py`. Atlas Layar (semua halaman per akun) adalah
artefak hasil bangun, tidak di-commit.

### 3. Susun, satu bab (atau satu kartu) per putaran — gerbang: `check_docs.py` 0 ERROR

Salin templat ke `naskah/`. Pecah per bab bila nyaman (`00-…md`, `01-…md`), gabung dengan `cat naskah/*.md > naskah.md`.
Untuk **tiap** bab/kartu: baca sumbernya → tulis → jalankan pemeriksa → perbaiki → lanjut.

```bash
python scripts/check_docs.py naskah.md --kind teknis   --repo <repo> --facts fakta/facts.json
python scripts/check_docs.py naskah.md --kind pengguna --repo <repo> --facts fakta/facts.json --trace jejak.md
```

Pemeriksa mencetak `ERROR  L123  [kode]  pesan`. Kode itu dijelaskan di `references/kesalahan-yang-sudah-terjadi.md`; pesannya
sering memuat alamat/nama yang benar — pakai itu. Dokumen teknis: ikuti **kontrak bab** di `references/dokumen-teknis.md`.
Panduan: putuskan tingkat verifikasi lebih dulu (uji kemampuan di `references/panduan-pengguna.md`), lalu kartu demi kartu.

Istilah: *santri*/*wali santri* (murid/peserta didik hanya format negara); ejaan yayasan (Tahfidz, Tahsin, Takhosus, Kitab
Kuning); istilah pesantren tidak diterjemahkan; nama tombol dan menu **persis seperti layar** (juga yang berbahasa Inggris).

### 4. Periksa akhir — gerbang: semuanya bersih

```bash
python scripts/check_docs.py naskah.md --kind <teknis|pengguna> --repo <repo> --facts fakta/facts.json --final   # 0 ERROR
python scripts/scan_sensitive.py naskah.md                                                                       # bersih
python <repo>/.github/scripts/check-sensitive.py                                                                 # bersih (aturan repo)
```

`--final` menjadikan sisa `[ISI]`/`TODO` sebagai ERROR. Lalu baca dengan mata: ringkasan eksekutif, bab 11, dan satu skenario bab 6
(atau satu kartu) dibandingkan dengan kodenya baris demi baris. Pemeriksa adalah batas bawah, bukan pengganti membaca.

### 5. Bangun — gerbang: kode keluar 0 dan tidak ada baris `GAGAL`

```bash
python scripts/build_docs.py naskah.md --out keluaran --format both --pdf --name <nama> \
  --title "Dokumen Teknis Aplikasi" --subtitle "Sistem Informasi Cipansor" --version 0.1 --status Draf \
  --commit <hash> --author "<penyusun>" --logo <repo>/apps/web/public/logo.png
```

`build_docs.py` memeriksa dirinya sendiri: jumlah tabel sumber = tabel `.docx`, tak ada tabel/kepala kosong, gambar terpasang,
daftar isi ada; pengisian daftar isi lewat LibreOffice yang merusak berkas **dibuang** (dipakai cadangan sebelumnya);
PDF diperiksa (kepala tabel terbaca, tak ada halaman kosong). Peringatan `PERINGATAN`/`PERINGATAN PDF` **dilaporkan** ke
pengguna, tidak diabaikan. Jangan menyunting `.docx` hasil; perbaiki Markdown lalu bangun ulang.

`.docx`/`.pdf` adalah **artefak, bukan berkas yang dilacak**: `.gitignore` mengabaikannya, dan hanya `.md` yang masuk git.
Biner dibangun ulang saat dibutuhkan untuk dikirim ke pengurus/donor/auditor. Karena git menampilkan biner sebagai
"Binary files differ", menyimpannya di git tidak menambah kemampuan meninjau apa pun — sumber `.md` yang ditinjau.
(Tidak ada lagi `*.build.json`; tidak ada lagi pemeriksaan "biner basi".)

### 6. Lihat hasilnya (bila Anda dapat melihat gambar)

Render halaman PDF ke gambar (`pymupdf`: `page.get_pixmap(dpi=60)`), lalu lihat sampul, daftar isi, satu halaman tabel, satu
diagram. Bila tidak dapat melihat gambar, gerbang langkah 5 adalah satu-satunya bukti tampilan — katakan itu apa adanya.

### 7. Serahkan

Taruh keluaran di `docs/` (`.md` sebagai sumber — itulah yang dilacak git; `.docx`, `.pdf`, `diagrams/`, `fakta/`
sebagai hasil bangun, diabaikan `.gitignore`), lalu ikuti aturan repo: cabang fitur, komit dengan pesan jelas, jangan
mendorong ke `main`; perubahan hanya dokumen tidak menjalankan CI kode.

**Penamaan di `docs/`** (satu berkas, satu nama; `.docx`/`.pdf` senama dibangun di samping `.md`-nya, tidak dilacak):

| Terbitan | Nama |
|---|---|
| Dokumen Teknis | `DOKUMEN-TEKNIS.md` (biner: `DOKUMEN-TEKNIS.docx`, `.pdf`) |
| Panduan Pengguna, bagian umum | `PANDUAN-PENGGUNA-UMUM.md` (biner senama) |
| Panduan Pengguna, per peran | `PANDUAN-PENGGUNA-<PERAN>.md`, mis. `PANDUAN-PENGGUNA-GURU.md` (biner senama) |
| Audit dokumen | `EVALUASI-DOKUMEN.md` |

`docs/README.md` adalah peta seluruh dokumentasi; **perbarui ia** bila terbitan atau namanya berubah (tabel "Mulai dari
mana" dan bagian "Dokumen aplikasi"). Hasil bangun `fakta/`, `diagrams/`, `alur/`, `*.docx`, `*.pdf` **tidak** dilacak git
(lihat `.gitignore`).

Laporan singkat ke pengguna, **apa adanya**:

- basis kode (commit + tanggal) dan format yang dibuat;
- tingkat verifikasi tiap bagian panduan (T1/T2/T3) dan hasil uji kemampuan; untuk T2, siapa yang sebaiknya mencobanya;
- butir yang **ditahan** karena sensitif, peringatan build, dan `[ISI]` yang tersisa;
- status tiap kemampuan yang dijelaskan (cabang / `main` / staging / produksi) dan jalur menu untuk mencapainya;
- yang belum dikerjakan (mis. buklet peran lain) dan langkah berikutnya.

Jangan menutup dengan ringkasan isi dokumen; pengguna bisa membukanya.

### 8. Mode pembaruan

```bash
python scripts/collect_facts.py <repo> --out fakta-baru --compare fakta/facts.json
```

`perubahan.md` mencantumkan angka yang bergeser serta modul/keputusan/peran yang baru atau hilang. Tinjau ulang **hanya**
bagian yang menyebut hal-hal itu, jalankan langkah 3–5, naikkan versi, isi Riwayat Revisi (commit lama → baru), simpan
`facts.json` baru di samping dokumen.

## Bila model Anda kecil: cara kerja yang mengurangi kesalahan

- Satu bab/kartu per putaran; jalankan pemeriksa sesudah **tiap** putaran. Jangan menulis semuanya lalu memeriksa.
- Salin, jangan parafrase: alamat rute, label, pesan, nama model, angka. Parafrase adalah sumber hampir semua kesalahan di katalog.
- Bila pemeriksa mencetak "yang ada di sekitarnya: …", pilih dari daftar itu; jangan menebak variasi lain.
- Bila sebuah kalimat tak bisa Anda dukung dengan `berkas:baris`, hapus kalimatnya. Dokumen pendek yang benar lebih baik daripada
  dokumen panjang yang sebagian karangan.
- Jangan menambal pemeriksa (mis. menambah baris agar jumlah cocok). Perbaiki isinya.
- Templat adalah rangka yang pernah cocok dengan kode; ia bisa tertinggal. Verifikasi tiap nama di dalamnya terhadap `facts.md`.

## Berkas dalam skill ini

| Berkas | Fungsi |
|---|---|
| `scripts/check_env.py` | Memeriksa perkakas (pandoc, mmdc, Chromium, LibreOffice **Writer**, uno, font) dan mencetak perintah pasang |
| `scripts/collect_facts.py` | Mengukur repo → `facts.json`/`facts.md` (modul, model, peran, rute, job terjadwal vs berkas job, env, keputusan); `--compare` untuk pembaruan. Hanya pustaka standar; hanya **nama** variabel lingkungan |
| `scripts/check_docs.py` | Pemeriksa naskah terhadap kode: rute, angka, ERD, label layar, pesan, kartu, tabel, diagram, bab 9/10/11, jejak sumber (`--trace`) |
| `scripts/scan_sensitive.py` | Memindai md/txt/html/docx dari pola sensitif (kunci, JWT, connection string, host cloud, IP, jalur host, sandi demo, NIK/telepon) |
| `scripts/build_docs.py` | Markdown → `.docx` (sampul, daftar isi, tabel, diagram, header/footer) dan/atau `.md`/`.pdf`; memverifikasi hasilnya. Keluaran adalah artefak, tidak dilacak git |
| `scripts/update_toc.py` | Mengisi daftar isi `.docx` lewat LibreOffice (dipanggil `build_docs.py`) |
| `references/dokumen-teknis.md` | Kontrak tiap bab arc42, resep bab 6/9/10/11, aturan angka, kepekaan, diagram |
| `references/panduan-pengguna.md` | T1/T2/T3 + uji kemampuan, resep T2 dan perangkapnya, kartu tugas, memilih tugas, audiens, tangkapan layar |
| `references/tangkapan-layar.md` | Tiga lapis gambar, alur JSON (DSL), menerjemahkan spec e2e, menyemat, storyboard, atlas |
| `references/katalog-proses.md` | Proses bisnis: akun demo, halaman, spec e2e; mana yang sudah diuji |
| `scripts/screens_manifest.py` | `select` (hanya gambar tersemat), `storyboard`, `atlas-md` |
| `assets/contoh-alur/` | Dua alur JSON yang sudah lolos pada aplikasi berjalan |
| `references/kesalahan-yang-sudah-terjadi.md` | Katalog kesalahan nyata + kode pemeriksa + cara yang benar |
| `references/standar-dan-alasan.md` | Riset standar, alasan, yang sengaja tidak dipakai |
| `assets/template-*.md` | Kerangka siap isi (teknis, panduan, kartu tugas) |
