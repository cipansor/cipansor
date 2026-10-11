# Dokumen Teknis Aplikasi — cara menyusun

Kerangka: arc42 (12 bab) + diagram C4 tingkat 1–3 dalam Mermaid. Alasannya di
`standar-dan-alasan.md`. Templatnya: `assets/template-teknis.md` — salin, lalu
isi tiap `[ISI: …]` dari sumber di bawah.

**Pembaca:** pengurus yayasan (ringkasan eksekutif, bab 1, 3, 10), pengelola
sistem (bab 5–7, 11, lampiran operasional), pengembang baru (bab 4–9). Tulis
ringkasan eksekutif dan bab 1 untuk pengurus tanpa latar teknis; bab 5 ke atas
boleh teknis.

**Ukuran yang wajar:** 20–30 halaman `.docx`. Ringkasan eksekutif ≤ 350 kata.
Bab 1–4 bersama ≤ 5 halaman. Bila lebih panjang, ada yang disalin dari repo
(dilarang) atau modul dicatat satu per satu di bab utama (dilarang).

## Sebelum menulis

```bash
python scripts/collect_facts.py <repo> --out fakta          # facts.md + facts.json
git -C <repo> log -1 --format='%h %ad' --date=short          # commit + tanggal untuk Riwayat Revisi
```

Baca, berurutan: `docs/ARCHITECTURE.md`, `docs/deploy-azure.md`,
`.claude/memory/progress.md`, `known-issues.md`, `INDEX.md`, dan `decisions/*.md`.
Dokumen teknis **merangkum dan menautkan**; tidak menyalin.

## Cara kerja: satu bab, satu putaran

Untuk **setiap** bab: (1) baca sumbernya, (2) tulis ke berkas, (3) jalankan pemeriksa,
(4) perbaiki sampai tak ada ERROR, (5) baru bab berikutnya. Menulis semua bab lalu
memeriksa di akhir menghasilkan puluhan kesalahan sekaligus dan model cenderung
menambalnya dengan kalimat samar.

```bash
python scripts/check_docs.py naskah.md --kind teknis --repo <repo> --facts fakta/facts.json
```

Kode pemeriksa (mis. `rute-tak-ada`) dijelaskan di `kesalahan-yang-sudah-terjadi.md`.

## Kontrak bab

Tiap baris = apa yang **wajib** ada, dari mana sumbernya, dan pemeriksa mana yang menjaganya.

| Bab | Wajib memuat | Sumber (perintah/berkas) | Dijaga oleh |
|---|---|---|---|
| **Ringkasan eksekutif** | 4 paragraf: apa itu Cipansor · angka kunci + commit · **Yang sudah berjalan** (per kemampuan) · **Yang perlu diketahui pembaca** (kategori utang). ≤ 350 kata | `README.md`, `progress.md`, `facts.md` | `angka-salah` |
| **1 Pendahuluan** | 1.1 tujuan · 1.2 tabel pemangku kepentingan (organ, kepala unit, guru, pendidik pesantren, staf, wali, santri, alumni/komite, pengunjung) · 1.3 3–5 tujuan mutu berurutan · 1.4 cara membaca dokumen | `README.md`, skill `panduan-peran` | struktur arc42 |
| **2 Batasan** | tabel Jenis · Batasan · Sumber: Teknis (versi dari `facts.md`), Organisasi, Hukum (**hanya yang tertulis di repo**), Konvensi, Operasional | `facts.md → Stack`; `decisions/`; `docs/deploy-azure.md` | — |
| **3 Konteks** | **C4-1** berlabel · satu kalimat "apa yang dilihat" · **3.1 Di luar lingkup** (tiap butir: apa · mengapa · rujukan) | prefiks env di `facts.md`; `docs/MOBILE_API.md`; `roadmap.md` | `c4-hilang`, `c4-panah-tanpa-label` |
| **4 Strategi** | tabel Tujuan · Pendekatan · Keputusan terkait, 6–8 baris | `docs/ARCHITECTURE.md`, `AGENTS.md` | — |
| **5 Blok bangunan** | 5.1 **C4-2** · 5.2 **C4-3** + diagram lapisan modul + **dua** ukuran tata letak · 5.3 tabel modul menurut ranah (**semua** modul tercantum) | `app.ts`, `middleware/`, `facts.md` | `ukuran-tata-letak`, `modul-tak-tercantum` |
| **6 Runtime** | 4–6 skenario; tiap skenario: diagram `sequenceDiagram` + satu paragraf; alamat lengkap `METODE /api/…` | routes → controller → service dari modul terkait (resep di bawah) | `rute-tak-ada`, `job-tak-terjadwal`, `angka-salah` |
| **7 Penempatan** | diagram penempatan · rilis tiga tahap · 7.1 jumlah kunci env + kelompok (nama saja) | `docs/deploy-azure.md`, `.github/workflows/`, `facts.md → env` | `diagram-id-ganda`, `sensitif-*` |
| **8 Lintas-bidang** | satu butir bertebal per konsep (autentikasi, otorisasi, validasi, amplop, galat, data pribadi, bahasa, migrasi, pengujian, penjadwal), tiap butir menyebut berkas kodenya | `apps/api/src/middleware/`, `lessons/`, `panduan-peran` | — |
| **9 Keputusan** | **tepat satu baris per berkas** di `decisions/`; ringkasan Indonesia ≤ 30 kata (apa, bukan mengapa) | `ls .claude/memory/decisions/`; paragraf pembuka tiap berkas | `keputusan-hilang`, `keputusan-ganda`, `ringkasan-panjang` |
| **10 Kualitas** | tabel `Mutu · Skenario (pemicu → respons) · Ukuran/ambang · Bukti · Status`; bukti = berkas nyata | `.github/workflows/`, `*.guard.test.ts`, `docs/deploy-azure.md` | `mutu-skenario`, `mutu-tanpa-angka` |
| **11 Risiko** | tabel `Kategori · Ringkasan · Dampak · Arah`; **kategori dan dampak saja** | `known-issues.md`, `roadmap.md` | `risiko-topik-peka`, `risiko-rinci`, `produksi-tertinggal` |
| **12 Glosarium** | hanya istilah yang benar-benar dipakai dokumen | `istilah-dan-penamaan.md` | — |
| **Lampiran A** | tabel modul dari `facts.md`; **tiap baris** dicocokkan dengan kode: jumlah baris = jumlah modul, jumlah handler = hitungan `router.*` di `*.routes.ts`, alamat mount = `app.ts`, penandaan Prisma di route/controller = kode | `facts.json → api.modules` | `lampiran-a-jumlah`, `lampiran-a-handler`, `lampiran-a-mount`, `lampiran-a-layering` |
| **Lampiran B** | ERD 10–20 entitas, **nama = nama model Prisma**, relasi dari `@relation` | `apps/api/prisma/schema.prisma` | `erd-model-fiktif` |
| **Lampiran C** | env: nama + fungsi, tanpa nilai | `facts.md → env` | `sensitif-*` |
| **Lampiran D** | prosedur ringkas + tautan `docs/DEPLOYMENT.md` | — | — |
| **Lampiran E** | tabel Hal · Sumber, termasuk berkas yang dibaca untuk tiap skenario bab 6 | — | — |

### Resep bab 6 (skenario runtime) — jangan dikira-kira

1. Pilih alur dari daftar template. Temukan modulnya: `ls apps/api/src/modules | grep -i <kata>`.
2. Baca rute: `grep -n "router\." apps/api/src/modules/<modul>/*.routes.ts` — **salin** metode dan alamatnya.
3. Baca controller lalu service untuk urutan kejadian (siapa memanggil siapa, apa yang disimpan).
4. Gambar `sequenceDiagram`: tiap panah dari klien ke API memakai alamat dari langkah 2, dengan awalan `/api/<mount>`
   (mount ada di `facts.json → api.modules[].mount`).
5. Langkah yang terjadi **di dalam** API (menghitung hash, memeriksa kata sandi) ditulis sebagai panah `A->>A:` tanpa METODE.
6. Jika sebuah langkah tak punya rute yang bisa Anda tunjuk (mis. "tandatangani"), **cari** rutenya (`grep -rn "sign" …`);
   jangan menulis kata kerja bebas di panah. Contoh yang pernah salah: menulis `POST /admissions/public/register` padahal
   rutenya `/public/registrants`.
7. Jalankan `check_docs.py`; `rute-tak-ada` mencetak alamat terdekat yang sebenarnya.

### Resep bab 9 (keputusan)

Untuk tiap berkas `decisions/*.md`: baca paragraf pembuka → tulis **satu kalimat Indonesia ≤ 30 kata** tentang apa yang
diputuskan. Jangan memotong di tengah kalimat; jangan menambah alasan atau tanggal yang tak ada di berkas; jangan
membuat dua baris untuk satu berkas (pernah terjadi: `akreditasi-unit.md` dua kali). Dua berkas yang sangat berkaitan boleh
satu baris; yang dihitung pemeriksa adalah kemunculan nama berkas, bukan jumlah baris.

### Resep bab 10 (kualitas): contoh baris yang benar

| Mutu | Skenario (pemicu → respons) | Ukuran / ambang | Bukti | Status |
|---|---|---|---|---|
| Keamanan: akses | Rute tulis yang dapat dijangkau tanpa sesi → dijaga Turnstile | 0 rute tulis publik tanpa Turnstile di luar daftar pengecualian | `public-routes-gated.test.ts` | Terbukti |

Contoh yang **salah** (pernah terbit): "Kode berbahaya yang lolos pemeriksaan otomatis tidak merges" — kalimatnya
bertentangan dengan dirinya, tanpa ukuran. Dan: "Satu gambar Next.js tidak dioptimasi" — itu **cacat**, bukan skenario
mutu; letakkan di bab 11.

Bila tak ada ambang: tulis "belum ditetapkan" — itu jujur dan dicatat sebagai utang. Jangan mengarang angka RTO/RPO.

### Resep bab 11 (risiko): apa yang boleh ditulis

| Boleh | Tidak boleh |
|---|---|
| "Kontrol akses: daftar izin yang dapat disunting belum sejalan dengan pemeriksaan sebenarnya. Dampak: sedang." | "13 rute memeriksa izin, 670 memeriksa kelompok lama" (peta lemahnya kontrol akses) |
| "Data pribadi: minimalisasi belum merata. Dampak: sedang–tinggi." | "Satu tabel menampilkan NIK penuh" (kelemahan yang masih terbuka; baris `known-issues.md` menyebutnya) |
| "12 modul memanggil Prisma dari rute/controller" (angka dari `facts.md`) | "1.457 res.json mentah terhadap 399 ApiResponse" (angka dari `known-issues.md` tanggal lain; bukan dari `facts.json`) |
| "Belum ada layanan pemantauan galat" | "Produksi belum memuat perbaikan #585" (daftar celah; `progress.md` sengaja tidak mencatatnya) |

Aturan: ragu apakah butir masih terbuka di produksi → **jangan tulis, laporkan** ke pengguna butir mana yang ditahan.

## Aturan angka

- Semua angka berasal dari `facts.json` dan disebut bersama commit + tanggalnya. `check_docs.py` menolak angka modul,
  model, enum, peran, halaman, kunci, dan pekerjaan terjadwal yang berbeda dari `facts.json`.
- Angka dari `known-issues.md`/`progress.md` **bukan** ukuran commit ini. Kutip hanya bila disebut sumber dan tanggalnya,
  atau ukur ulang dengan skrip.
- "Tata letak lengkap" punya dua definisi: **empat berkas** (routes, controller, service, schema) dan **lima bagian**
  (ditambah `index.ts`; ukuran `known-issues.md`). Sebut keduanya, atau sebut definisinya.
- "Pekerjaan terjadwal" ≠ jumlah berkas `*.job.ts`. Tulis: "N entri jadwal atas M berkas"; berkas yang tak dijadwalkan
  (dipanggil dari service) disebut terpisah.

## Aturan kepekaan (repo publik sampai rilis)

Sensitif = yang bisa dipakai penyerang: kredensial dan statusnya, kunci, token, connection string, **nama dan id
sumber daya cloud**, IP, jalur host, **kelemahan yang masih terbuka di produksi**, detail insiden, data pribadi.

- Sebut **jenis** layanan ("basis data PostgreSQL terkelola"), bukan nama/ID sumber dayanya. Jangan menyebut topologi
  jaringan ("jaringan privat") tanpa perlu.
- Variabel lingkungan: **nama dan fungsi**, tidak pernah nilai atau contoh yang menyerupai nilai.
- Akun demo dan kata sandinya tidak masuk dokumen.
- **Status per kemampuan, bukan per perbaikan.** Jangan menulis perbaikan atau nomor PR mana yang belum di produksi.
- Jalankan `scripts/scan_sensitive.py` dan `python .github/scripts/check-sensitive.py` (repo). Keduanya mekanis; bab 11
  tetap harus dibaca dengan mata.

## Diagram

- Mermaid, keterangan `%% caption: …` di baris pertama. Diagram C4 diawali `C4-1:`, `C4-2:`, `C4-3:`.
- **Tiap panah diberi label** (`A -->|"kata kerja"| B`). C4 mewajibkannya; tanpa label pembaca menebak.
- **C4-1** Konteks: sistem sebagai satu kotak, orang dan sistem luar di sekelilingnya. **C4-2** Kontainer: hal yang
  berjalan sendiri (**bukan** pustaka seperti `packages/shared`). **C4-3** Komponen: isi satu kontainer (API).
- Id simpul harus unik dan **tidak sama dengan id subgraph** (`Prod[...]` dan `subgraph Prod` → salah satunya hilang).
- Titik koma di teks `sequenceDiagram` memecah pernyataan; pakai koma.
- Label berisi kurung/titik dua/kutip: bungkus kutip ganda `A["Teks (dengan kurung)"]`; baris baru `<br/>`.
- Diagram lebar mengecil dan tak terbaca: pecah, atau `LR` → `TB`. ERD: ≤ 20 entitas.
- Tiap diagram diikuti satu kalimat yang mengatakan apa yang harus dilihat.
- Sistem luar digambar **hanya bila kode memanggilnya** (cek prefiks env di `facts.md`). Sentry, Socket.IO, dan Flutter
  sudah dihapus/tidak ada — jangan digambar dari ingatan.

## Gaya

- Bahasa Indonesia baku, kalimat aktif ≤ 25 kata, satu gagasan per kalimat. Paragraf: kalimat topik → bukti (berkas atau
  angka) → artinya bagi pembaca.
- Istilah teknis tetap Inggris (API, middleware, commit) dan masuk glosarium pada kemunculan pertama.
- *Santri*, bukan *murid*; *murid/peserta didik* hanya untuk format negara (rapor, SPMB, Dapodik/EMIS).
- Tiap tabel angka: sebut sumber dan commit di bawahnya. Catatan penting: `> **Catatan.**` atau `> **Batasan.**`.
- Tanggal: "29 September 2026". Bentuk daftar: kalimat pengantar dulu, lalu butir.
- Jangan menyalin teks Inggris dari repo ke prosa (pemeriksa `bahasa-inggris`).

## Daftar periksa sebelum menyerahkan (semuanya perintah)

```bash
python scripts/check_docs.py naskah.md --kind teknis --repo <repo> --facts fakta/facts.json --final   # 0 ERROR
python scripts/scan_sensitive.py naskah.md                                                            # bersih
python scripts/build_docs.py naskah.md --out keluaran --format docx --pdf … --commit <hash>          # kode keluar 0, tanpa "GAGAL"
```

`.docx`/`.pdf` adalah artefak (diabaikan `.gitignore`); bangun saat dibutuhkan, jangan commit.

Terakhir, baca dengan mata: ringkasan eksekutif, bab 11, dan satu skenario bab 6 dibandingkan dengan kodenya.
