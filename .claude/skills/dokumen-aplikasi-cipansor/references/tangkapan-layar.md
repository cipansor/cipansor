# Tangkapan layar dan alur proses — dokumen bergambar

Dokumen bergambar dibuat dengan **dua skill satu jalur kerja** (keputusan pengguna 2026-09-29,
`.claude/memory/decisions/dokumentasi-bergambar.md`): skill ini menulis dan memeriksa; skill `screenshot-roles`
memegang alat tangkapnya (`screenshot-flow.ts`); skill `stack` menyalakan aplikasi. Tidak ada rig yang disalin ke sini.

## Tiga lapis gambar

| Lapis | Isi | Dibuat oleh | Masuk git? |
|---|---|---|---|
| **1. Kartu tugas** | satu gambar per **layar penentu** (≤ 4 per kartu), dengan kotak merah pada tombol yang dimaksud | alur JSON, subperintah `flow` | **Ya**, hanya yang tersemat |
| **2. Alur proses** (storyboard) | satu proses bisnis dari awal sampai akhir, satu gambar per tahap, dengan siapa · yang terjadi · giliran berikutnya | alur JSON lintas-akun, `flow` + `screens_manifest.py storyboard` | **Ya**, hanya yang tersemat |
| **3. Atlas Layar** | satu gambar tiap halaman menu tiap akun demo, sebagai dokumen tersendiri | `atlas` + `screens_manifest.py atlas-md` | **Tidak** — artefak hasil bangun |

Mengapa tiga lapis, bukan "semua gambar di semua tempat": panduan gaya Google menyarankan gambar secukupnya, dan Microsoft
menyarankan tangkapan layar hanya bila menghemat kata dan menambah kejelasan
([Google](https://developers.google.com/style/images), [Microsoft](https://learn.microsoft.com/en-us/writing-style-guide-msft-internal/images-video/screenshots));
gambar buatan tangan cepat basi, jadi semuanya dihasilkan dari aplikasi yang berjalan. Kelengkapan ("semua halaman")
dipenuhi atlas, bukan dengan menjejalkan ratusan gambar ke kartu.

Ukuran (diukur 2026-09-29): 65 akun demo, 1.748 halaman menu (154 alamat unik). Satu akun ≈ 24 halaman ≈ 40 detik dan
≈ 3,6 MB `.docx`. Semua akun ≈ satu jam lebih dan ratusan MB — jalankan per keluarga akun, jangan `all` tanpa perlu.

## Prasyarat (periksa dulu)

1. `python scripts/check_env.py` sudah OK (Chromium, pandoc, mmdc, LibreOffice Writer, `pip install pillow` untuk mengecilkan gambar).
2. Aplikasi berjalan dan **diisi dengan `E2E_FIXED_2FA=1`** (skill `stack`; skrip repo `bash scripts/dev-up.sh` bila jalurnya cocok
   dan lihat catatan NODE_ENV di skill itu). Uji: `curl -s localhost:3001/health` dan `curl -s -o /dev/null -w '%{http_code}' localhost:3000/login`.
3. Semua perintah dijalankan dari `apps/web`:

```bash
cd apps/web
export PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome    # sesuaikan dengan yang ada
SHOT="../api/node_modules/.bin/tsx ../../.claude/skills/screenshot-roles/scripts/screenshot-flow.ts"
```

## Perintah

```bash
$SHOT plan  sdit.walikelas@cipansor.or.id                       # daftar halaman akun itu (tanpa browser)
$SHOT flow  ../docs/alur/absensi-harian.flow.json --out /tmp/capture   # satu atau lebih alur
$SHOT atlas sdit.walikelas@cipansor.or.id --out /tmp/capture     # atau beberapa akun, atau: all
```

Hasil di `<out>/<alur>/<langkah>.png` + `flow-report.json`, dan `<out>/atlas/<akun>/<halaman>.png` + `atlas-report.json`.
Kode keluar 1 bila ada langkah/halaman gagal. Taruh keluaran **di luar repo** (`/tmp/capture`); tangkapan mentah tidak pernah di-commit.

Akun ditulis sebagai **e-mail akun demo** (`sdit.walikelas@cipansor.or.id`), bukan kode peran: beberapa akun berbagi satu
kode peran (`sdit.guru`, `sdit.walikelas`, `sdit.wakasek` semuanya `SDIT_GURU`) dan hanya wali kelas yang punya kelas sendiri.
Daftar akun: `packages/shared/src/types/demo-accounts.ts`. Kata sandi tidak pernah ditulis di alur.

## Menulis alur (`*.flow.json`, tempatnya `docs/alur/`)

Contoh yang sudah diuji dan berhasil: `assets/contoh-alur/absensi-harian.flow.json` (satu akun, 6 langkah) dan
`assets/contoh-alur/pengesahan-rka-yayasan.flow.json` (empat akun bergantian, setup lewat API, 12 langkah). **Salin lalu ubah.**

Bidang langkah (semua opsional kecuali `id`; urutan pelaksanaan: `as` → `goto` → `click` → `fill` → `press` → `actions` → `wait` → `see` → foto):

| Bidang | Arti |
|---|---|
| `id` | `NN-kata-kunci`, unik; jadi nama berkas `NN-kata-kunci.png` |
| `as` | e-mail akun demo; membuka sesi baru (ganti pelaku). Langkah pertama **wajib** `as` |
| `goto` | alamat halaman, mis. `/attendance/record` |
| `click` | yang diklik. Teks polos = tombol/tautan/tab/menu/kotak centang/teks dengan nama itu. Objek: `{"role":"button","name":"Simpan","exact":true,"nth":0}`, `{"label":"…"}`, `{"placeholder":"…"}`, `{"text":"…"}`, `{"testid":"…"}`, `{"css":"…"}` |
| `fill` | `{"target": <penunjuk>, "value": "…"}` |
| `press`, `wait` | tombol papan ketik; jeda milidetik (jarang perlu) |
| `actions` | daftar aksi **berurutan**, bila urutannya penting: `[{"fill": …}, {"click": …}]` mengisi dulu lalu mengklik. Bidang datar `click`/`fill`/`press` selalu berurutan klik → isi → tombol, jadi langkah yang harus **mengisi di dalam kotak lalu mengklik tombolnya** memakai `actions` (contoh: `03-kirim-ke-pengawas` pada `pengesahan-rka-yayasan.flow.json`) |
| `see` | **teks yang harus terlihat** sebelum foto. Bila tidak ada, langkah **gagal**. Ini bukti bahwa layar berkata seperti yang ditulis manual |
| `not_see` | teks yang tidak boleh terlihat |
| `shot` | `"after"` (bawaan, sesudah aksi) · `"before"` (sebelum aksi, sasaran dikotaki) · `false` (tanpa foto) |
| `highlight` | penunjuk yang dikotaki merah pada foto |
| `area` | apa yang difoto: seluruh jendela (bawaan) · `"main"` (isi halaman tanpa sidebar; teks lebih besar di manual, tetapi toast di luar `<main>` tak ikut) · penunjuk, mis. `{"role":"dialog"}` |
| `caption` | keterangan gambar, satu kalimat, bahasa manual |

Bidang alur: `name`, `title`, `steps`, dan `setup` — data yang harus ada sebelum layar pertama, dibuat lewat API sebagai pengguna
sungguhan (seperti spec e2e): `{"as":…,"method":"POST","path":"/perencanaan","body":{…},"save":{"plan":"data.id"}}`.
`save` memetakan nama variabel ke jalur bertitik pada jawaban (`data.classes.0.name`). Variabel dipakai sebagai `{{plan}}` di
`goto`, `value`, `see`, `body`. Bawaan: `{{stamp}}` (unik per jalan), `{{year}}` (tahun jauh ke depan), `{{today}}`.

### Menerjemahkan spec e2e menjadi alur (cara tercepat dan paling andal)

`apps/web/e2e/*.spec.ts` sudah memuat alur bisnis yang **berjalan** dan label persis layar. Buka spec-nya (lihat
`katalog-proses.md`) dan terjemahkan:

| Di spec e2e | Di alur |
|---|---|
| `injectSession(page, await apiLogin(…))` | `"as": "<e-mail akun>"` |
| `page.goto("/x")` | `"goto": "/x"` |
| `getByRole("button", { name: "Simpan", exact: true }).click()` | `"click": {"role":"button","name":"Simpan","exact":true}` |
| `getByRole("link", { name: "Perizinan" }).click()` | `"click": "Perizinan"` |
| `getByLabel("Hasil reviu").fill("…")` | `"fill": {"target":{"label":"Hasil reviu","exact":true},"value":"…"}` |
| `expect(x.getByText("…")).toBeVisible()` | `"see": ["…"]` |
| `expect(…).toHaveCount(0)` | `"not_see": ["…"]` |
| `page.getByRole("dialog")` | `"area": {"role":"dialog"}` |
| `apiRequest(session, "POST", "/x", body)` sebelum tes | `setup` |
| `test.describe.configure({ mode: "serial" })` | satu alur, langkah berurutan |

### Aturan alur yang baik

- 4–12 langkah; **satu tahap bermakna per gambar**. Langkah tanpa gambar (mengisi, memilih) pakai `"shot": false`.
- Selalu beri `see` pada langkah yang mengubah layar; pilih teks yang **akan Anda kutip di manual** (pesan, judul, status).
- Alur boleh dijalankan ulang (basis data demo dipakai berulang): jangan bergantung pada keadaan yang hanya benar sekali.
  Data unik pakai `{{stamp}}`.
- Hanya akun demo dan data contoh. Jangan menangkap layar berisi data sungguhan. Jangan menulis kata sandi atau token di JSON.
- Keterangan (`caption`) memakai kata yang sama dengan teks manual.

### Bila langkah gagal

Runner mencetak yang di layar **dalam kata-kata** (url, judul, heading, tombol, tautan, label, alert) dan menyimpan
`<langkah>.FAILED.png`. Baca daftar tombol/label itu dan perbaiki penunjuk atau `see`; jangan menebak. Penyebab umum:
(1) teks `see` beda huruf/ejaan dengan layar; (2) toast sudah hilang — taruh teks toast di `see` pada langkah yang memicunya
(runner menunggu teks itu, bukan jaringan diam); (3) dua tombol bernama sama — pakai `nth` atau `area`; (4) prasyarat data belum ada
— tambahkan `setup`; (5) akun salah — wali kelas pemilik kelas adalah `*.walikelas@`, bukan `*.guru@`.

## Menyemat di dokumen

```bash
python scripts/screens_manifest.py select --md docs/PANDUAN-PENGGUNA-GURU.md --capture /tmp/capture
```

`select` menyalin **hanya** gambar yang dirujuk naskah, mengecilkannya (lebar ≤ 1280 px, 256 warna; ≈ 145 → 55 KB), menolak gambar
dari langkah yang GAGAL, menulis `screens/manifest.json`, dan merekam `url` halaman tiap gambar. Dua peringatan yang harus
Anda tanggapi, bukan diabaikan:

- **`PERINGATAN: N gambar diambil dari halaman yang sama (…/ibadah)`** — biasanya salah satu kartu menunjuk langkah yang
  keliru. Inilah gejala yang meloloskan "Papan Peringkat" dan "Kelola Target" sama-sama berisi layar `/ibadah` (A13 di
  `kesalahan-yang-sudah-terjadi.md`): arahkan `goto` langkah itu ke halaman yang benar (`/ibadah/leaderboard`,
  `/ibadah/targets`) lalu tangkap ulang. `check_docs.py` mengulang peringatan yang sama sebagai `gambar-halaman-kembar`.
- **`Catatan: N entri manifes … tidak lagi dirujuk naskah mana pun`** — manifes menumpuk entri basi setelah gambar diganti.
  Tambahkan `--prune` untuk membuangnya.

Gambar yang tidak dirujuk tidak masuk git. **`see` yang cocok bukan bukti layarnya benar** — buka gambarnya sebelum
menyerahkan; pemeriksa hanya melihat teks, bukan isi gambar.

Bentuk di naskah (jalur relatif terhadap naskah; **baris kosong** antara gambar dan keterangan; alt = keterangan):

```markdown
![Gambar 1. Halaman Absensi Harian dengan daftar santri dan tombol status.](screens/absensi-harian/02-absensi-harian.png){width=14cm}

*Gambar 1. Halaman Absensi Harian dengan daftar santri dan tombol status.*
```

`check_docs.py` menjaga: gambar ada · alt ≥ 12 karakter · keterangan miring tepat sesudahnya · ≤ 400 KB (peringatan) / 1 MB (galat) ·
lebar ≤ 1600 · berasal dari `manifest.json` (bukan gambar sembarang) · **kartu tanpa ⚠ (T1) wajib bergambar** · kartu ⚠ yang sudah
bergambar diingatkan untuk dinaikkan · ≤ 4 gambar per kartu.

**Naik dari T2 ke T1:** sebuah kartu boleh kehilangan banner ⚠ hanya bila langkahnya dijalankan sungguh (alur `flow` lolos, semua `see`
terpenuhi) dan gambarnya tersemat. Sesudah alur lolos, **bandingkan kartu dengan `flow-report.json`**: urutan langkah, nama tombol, pesan,
dan ke mana halaman berpindah sesudah Simpan. Kartu T2 yang keliru harus diperbaiki, bukan hanya diberi gambar. Ubah juga Riwayat Revisi
(tingkat verifikasi T1, tanggal, hasil).

## Alur proses (storyboard)

```bash
python scripts/screens_manifest.py storyboard --report /tmp/capture/<alur>/flow-report.json --out naskah/alur-<nama>.md
```

Menghasilkan bagian `## Alur proses: …` dengan penanda `<!-- alur: <nama> -->` dan satu `### Tahap N — …` per langkah bergambar
(gambar, keterangan, dan `[ISI]` untuk **Siapa · Yang terjadi · Giliran berikutnya**). Ganti semua `[ISI]` dengan teks layar yang
dikutip dari `see`; jangan mengubah jalur gambar. `check_docs.py` menuntut tiap tahap punya gambar dan ketiga bagian itu, minimal 2 tahap.
Letakkan alur di Bagian **"Proses bisnis"** panduan (per keluarga peran yang terlibat) atau sebagai buklet "Alur Proses"; jalankan
`select` sesudahnya.

## Atlas Layar (lengkap, bukan untuk git)

```bash
$SHOT atlas <akun...> --out /tmp/capture
python scripts/screens_manifest.py atlas-md --capture /tmp/capture --account sdit.walikelas --out /tmp/capture/atlas-sdit-walikelas.md
python scripts/build_docs.py /tmp/capture/atlas-sdit-walikelas.md --out /tmp/capture/out --format docx --pdf --resource-path /tmp/capture \
  --title "Atlas Layar — Guru wali kelas SD IT" --subtitle "Sistem Informasi Cipansor" --version 0.1 --commit <hash> --logo apps/web/public/logo.png
```

Satu bagian per kelompok menu, satu gambar per halaman, dengan alamat dan (bila bermasalah saat ditangkap) catatan masalahnya.
Halaman kelompok tugas (Wali Kelas) hanya ditangkap untuk akun `*.walikelas`. Bagikan `.docx`/`.pdf` sebagai artefak; jangan di-commit
(naskah antara memuat jalur mesin).

Atlas juga **pemeriksa mutu**: halaman yang "bounce", 404, atau galat konsol tertulis di `atlas-report.json`. Halaman seperti itu jangan
dijelaskan sebagai jalan di manual; masukkan ke Lampiran "Belum tersedia" atau catat di `known-issues.md`.

## Bila Anda tidak dapat melihat gambar

Bukti bahwa layar benar adalah **`see`**, bukan penilaian visual. Jangan menyatakan gambar "bagus" atau "terbaca". Laporkan jumlah gambar,
alur yang lolos/gagal, dan bahwa gambar tidak dilihat oleh model; mintalah pengguna membuka `screens/` dan satu halaman PDF.
