# Email keluar — setup Gmail API

Bagaimana sistem Cipansor mengirim email, dan langkah persisnya untuk
mengaktifkannya lewat Gmail API tanpa sandi aplikasi.

Ringkasnya:

- **Pengirim** (`From`) — `noreply@cipansor.or.id`. Kotak surat otomatis, tidak
  dibaca manusia.
- **Tujuan balasan** (`Reply-To`) — `halo@cipansor.or.id`. Ke sinilah balasan
  wali santri sampai, baik yang tidak sengaja menekan "Balas" maupun yang
  memang ingin bertanya.

Kedua alamat dipisah di setiap template dan disetel di satu tempat
(`config.mail`), bukan ditulis ulang per-template.

---

## Kenapa Gmail API, bukan sandi aplikasi

|                                   | Sandi aplikasi (SMTP)            | Service account (Gmail API)                     |
| --------------------------------- | -------------------------------- | ----------------------------------------------- |
| Bentuk kredensial                 | 16 karakter, setara password     | Kunci RSA                                       |
| Cakupan akses                     | **Seluruh** kotak surat akun itu | Hanya `gmail.send`                              |
| Bisa baca inbox?                  | Ya                               | **Tidak**                                       |
| Bisa dipakai login?               | Pada beberapa alur, ya           | Tidak                                           |
| Mensyaratkan 2FA di akun pengirim | Ya                               | Tidak                                           |
| Dicabut dari mana                 | Ganti sandi akun                 | Admin console, per-scope                        |
| Kalau bocor                       | Penyerang memegang kotak surat   | Penyerang hanya bisa mengirim, dan bisa dicabut |

Karena itu urutan pemilihan transport di `email-transport.ts` adalah **Gmail API
→ SMTP → log-only**. SMTP tetap ada sebagai cadangan, tapi bukan pilihan utama.

---

## Apakah gratis?

**Ya, untuk pemakaian yayasan ini.**

- **Gmail API sendiri tidak dipungut biaya.** Tidak ada tarif per-panggilan.
  Yang berlaku adalah _kuota_, bukan tagihan.
- **Google Cloud project** yang menampung service account juga gratis selama
  Anda hanya mengaktifkan Gmail API. Kartu kredit **tidak** diperlukan untuk
  mengaktifkan Gmail API (berbeda dengan sebagian layanan Cloud lain).
- **Kuota yang berlaku** (Google Workspace, per akun pengirim, per 24 jam):
  - **2.000 penerima/hari** untuk akun Workspace berbayar/nonprofit.
  - Kuota Gmail API dihitung dalam _quota units_; `messages.send` memakai 100
    unit, dengan batas 1.200.000 unit/menit per project — jauh di atas
    kebutuhan sistem ini.
- **Skala Cipansor hari ini:** 107 akun dan 14 santri. Bahkan bila setiap
  setoran tahfidz, setiap pembayaran, dan satu pengumuman ke semua orang
  dikirim dalam sehari, jumlahnya ratusan — bukan ribuan. Kuota 2.000/hari
  tidak akan tersentuh.

Yang perlu diawasi bukan biaya, melainkan **batas 2.000 penerima/hari** kalau
suatu saat daftar wali santri tumbuh besar dan ada pengumuman massal harian.

---

## Langkah-langkah di Google Console

Anda perlu dua konsol: **Google Cloud Console** (membuat service account) dan
**Google Admin console** (mengizinkan service account itu bertindak sebagai
`noreply@`).

### Masuk pakai akun yang mana?

**Keduanya dibuka dengan `admin@cipansor.or.id`** — akun super admin Workspace.
Bukan `noreply@`.

- Langkah 6 (domain-wide delegation) **hanya bisa** dilakukan super admin.
  `noreply@` tidak punya wewenang itu.
- `noreply@` **tidak pernah perlu login ke mana pun** agar ini bekerja. Justru
  itu intinya: service account bertindak _sebagai_ dia tanpa memakai
  passwordnya. Kotak surat itu memang tidak dijaga siapa-siapa, dan tidak
  seharusnya dipakai membuka konsol.
- Kepemilikan project ikut akun pembuatnya. Project yang dimiliki kotak surat
  fungsional akan ikut hilang bila suatu saat kotak surat itu dihapus; dimiliki
  admin yayasan, project-nya tetap ada dan tetap bisa dikelola.

Satu-satunya syarat pada `noreply@` adalah **ada** — lihat langkah 7.

### 1. Buat atau pilih project — Google Cloud Console

1. Buka <https://console.cloud.google.com/>.
2. Klik pemilih project di kiri atas → **New Project**.
3. Isi:
   - _Project name_: **Cipansor Mailer**
   - _Project ID_: `cipansor-mailer` — kalau ditolak, biarkan Google
     menambahkan angka (`cipansor-mailer-482913`). ID ini **unik di seluruh
     Google Cloud**, bukan hanya di organisasi Anda, jadi nama sesederhana ini
     mungkin sudah dipakai orang lain. Isinya tidak penting bagi sistem —
     tidak ada satu pun variabel di `.env` yang memuat ID project.

     Nama tampilan project boleh diganti kapan saja; **ID-nya permanen.** Jadi
     bila ragu soal penamaan, yang perlu dipikirkan hanya kolom ID.

   - _Organization / Location_: `cipansor.or.id` bila muncul; kalau tidak,
     **No organization** (lihat catatan di bawah).
4. **Create**, lalu pastikan project ini yang aktif di pemilih project.

**Satu project untuk satu keperluan.** Menamainya `cipansor-mailer` dan bukan
`cipansor` secara umum itu disengaja: di dalamnya ada service account yang
boleh mengirim email atas nama domain. Kalau suatu saat kunci itu bocor atau
project-nya perlu dihapus, tidak ada integrasi lain yang ikut terbawa.
Integrasi Google berikutnya sebaiknya punya project sendiri.

#### Kalau diminta "request access" saat memilih organisasi

Menjadi **super admin Workspace tidak otomatis memberi hak di Google Cloud** —
keduanya sistem izin yang terpisah. Yang muncul biasanya permintaan salah satu
peran berikut:

| Peran                                                                      | Untuk apa                                                             |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Project Creator** (`roles/resourcemanager.projectCreator`)               | membuat project di bawah organisasi — ini yang Anda butuhkan sekarang |
| **Organization Administrator** (`roles/resourcemanager.organizationAdmin`) | memberikan peran kepada orang lain di tingkat organisasi              |

Anda adalah adminnya, jadi **jangan mengirim permintaan ke siapa pun** —
berikan sendiri perannya: Cloud Console → **IAM & Admin → IAM**, ganti cakupan
di kiri atas dari project ke **organisasi** `cipansor.or.id`, **Grant access**,
principal `admin@cipansor.or.id`, peran **Project Creator**. Kalau tombol itu
pun tidak bisa ditekan, berikan dulu **Organization Administrator** kepada diri
sendiri — seorang super admin Workspace berwenang melakukannya justru untuk
kasus seperti ini.

**Jalan pintas yang sah:** pilih **No organization**. Semuanya tetap bekerja —
service account, delegasi domain, dan pengiriman email tidak peduli project itu
berada di bawah organisasi atau tidak. Konsekuensinya hanya soal tata kelola:
project menjadi milik pribadi akun pembuatnya alih-alih milik yayasan, sehingga
tidak ikut terwarisi bila akun itu suatu saat ditutup. Untuk mulai berjalan hari
ini itu sepadan; pindahkan ke organisasi belakangan bila perlu.

### 2. Aktifkan Gmail API

1. Menu → **APIs & Services** → **Library**.
2. Cari **Gmail API** → **Enable**.
3. Tidak perlu mengisi tagihan. Tidak perlu mengisi OAuth consent screen —
   layar itu untuk aplikasi yang meminta izin ke pengguna, sedangkan service
   account tidak melalui layar persetujuan.

### 3. Buat service account

1. Menu → **APIs & Services** → **Credentials**.
2. **+ Create credentials** → **Service account**.
3. Isi ketiganya:

   | Kolom                         | Isi               | Catatan                                                                                                                                                                                                                                                        |
   | ----------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | _Service account name_        | `Cipansor Mailer` | Label tampilan. **Bisa diubah** kapan saja.                                                                                                                                                                                                                    |
   | _Service account ID_          | `cipansor-mailer` | **Permanen.** Ini jadi awalan alamatnya — konsol langsung menampilkan hasilnya di bawah kolom: `cipansor-mailer@<project-id>.iam.gserviceaccount.com`. Huruf kecil, angka, dan tanda hubung; 6–30 karakter. Inilah nilai `GOOGLE_SERVICE_ACCOUNT_EMAIL` nanti. |
   | _Service account description_ | lihat di bawah    | Opsional bagi Google, **tidak opsional bagi Anda**.                                                                                                                                                                                                            |

   Deskripsi adalah satu-satunya tempat yang menjelaskan benda ini kepada
   admin berikutnya, yang mungkin bertahun-tahun lagi melihat sebuah akun
   robot tak dikenal di daftar IAM dan bertanya-tanya apakah aman dihapus.
   Salin ini:

   ```
   Mengirim email notifikasi Sistem Informasi Cipansor sebagai
   noreply@cipansor.or.id melalui Gmail API (scope gmail.send,
   domain-wide delegation). Dipakai container cipansor-api.
   JANGAN HAPUS: mematikan seluruh email sistem.
   ```

4. **Create and continue** → langkah "Grant this service account access to
   project" **dilewati saja** (Continue) — tidak ada peran IAM yang dibutuhkan.
   Izin yang dipakai datang dari Workspace, bukan dari IAM.
5. **Done**.

### Jangan tertukar: tiga identitas yang berbeda

Baca ini sebelum mengambil kuncinya — inilah dua hal yang paling sering
tertukar.

| Yang Anda isi                  | Isinya apa                                                                                                                                         | Contoh                                                    | Dari mana                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Alamat **robot**, dibuat otomatis oleh Google. Selalu berakhiran `.iam.gserviceaccount.com` dan **tidak bisa** dibuat beralamat `@cipansor.or.id`. | `cipansor-mailer@cipansor-mailer.iam.gserviceaccount.com` | Field `client_email` di file kunci JSON |
| `GMAIL_SENDER`                 | Kotak surat **manusia** yang ditiru robot itu. Inilah yang muncul sebagai pengirim.                                                                | `noreply@cipansor.or.id`                                  | Alamat Workspace Anda sendiri           |
| Client ID (Unique ID)          | Angka panjang, dipakai **hanya** di Admin console untuk domain-wide delegation                                                                     | `114857392017465829301`                                   | Field `client_id` di file kunci JSON    |

Robot itu tidak punya kotak surat sendiri. Yang membuatnya boleh mengirim
_sebagai_ `noreply@cipansor.or.id` adalah izin delegasi di langkah 6 — itulah
sebabnya kedua alamat ini berbeda dan keduanya diperlukan.

**Karena itu, jangan beri service account ID `noreply`.** Godaannya besar —
tugasnya memang mengirim sebagai noreply — tetapi hasilnya dua alamat yang nyaris
kembar:

```
noreply@cipansor.iam.gserviceaccount.com     ← robot
noreply@cipansor.or.id                       ← kotak surat
```

Keduanya harus masuk ke variabel yang _berbeda_, dan tertukarnya persis
menghasilkan `unauthorized_client` — kesalahan yang paling mahal waktunya di
seluruh panduan ini, karena pesannya tidak menyebut-nyebut soal alamat. ID
`cipansor-mailer` membuat keduanya mustahil tertukar sekilas pandang.

### Private key ≠ client secret

`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` **bukan** client secret.

- **Client secret** (`GOCSPX-…`, satu baris pendek) berasal dari
  _APIs & Services → Credentials → **OAuth 2.0 Client IDs**_. Itu jenis
  kredensial yang berbeda, dipakai untuk alur SMTP OAuth2 cadangan, dan **tidak
  bisa** melakukan domain-wide delegation.
- **Private key** berasal dari _APIs & Services → Credentials → **Service
  Accounts**_ → buka akunnya → tab **Keys** → _Add key_ → _Create new key_ →
  **JSON**. Yang terunduh adalah berkas seperti ini:

  ```json
  {
    "type": "service_account",
    "project_id": "cipansor-mailer",
    "private_key_id": "abc123…",
    "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg…\n-----END PRIVATE KEY-----\n",
    "client_email": "cipansor-mailer@cipansor-mailer.iam.gserviceaccount.com",
    "client_id": "114857392017465829301",
    "token_uri": "https://oauth2.googleapis.com/token"
  }
  ```

**Kalau Anda tidak punya berkas yang memuat `-----BEGIN PRIVATE KEY-----`,
berarti yang dibuat adalah OAuth 2.0 Client ID, bukan service account.** Ulangi
dari langkah 3. Di halaman _Credentials_ ada tiga bagian terpisah — _API Keys_,
_OAuth 2.0 Client IDs_, dan _Service Accounts_ — dan yang dipakai di sini adalah
bagian ketiga.

### 4. Ambil kunci JSON

1. Di daftar **Service Accounts**, klik akun yang baru dibuat.
2. Tab **Keys** → **Add key** → **Create new key** → pilih **JSON** → **Create**.
3. Berkas `.json` terunduh. **Ini satu-satunya salinan** — Google tidak
   menyimpannya. Simpan di tempat aman, jangan pernah masuk ke repositori.

Dari berkas itu Anda butuh tiga nilai: `client_email`, `private_key`, dan
`client_id`.

#### Kalau muncul "Service account key creation is disabled"

```
An Organization Policy that blocks service accounts key creation has been
enforced on your organization.
Enforced Organization Policies IDs: iam.disableServiceAccountKeyCreation
```

Ini bukan kesalahan Anda. Organisasi Google Cloud yang baru dibuat otomatis
mendapat sejumlah kebijakan _Secure by Default_, dan salah satunya melarang
pengunduhan kunci service account. Alasannya masuk akal: kunci yang diunduh
tidak pernah kedaluwarsa, dan sekali bocor tetap berlaku sampai seseorang ingat
mencabutnya.

**Matikan kebijakan itu untuk project ini saja — bukan untuk seluruh
organisasi.**

1. Beri diri Anda peran **Organization Policy Administrator**
   (`roles/orgpolicy.policyAdmin`): **IAM & Admin → IAM**, ganti cakupan ke
   organisasi `cipansor.or.id`, **Grant access**, principal
   `admin@cipansor.or.id`. (Sama seperti Project Creator di langkah 1 — peran
   Cloud tidak datang sendiri dari status super admin Workspace.)
2. **IAM & Admin → Organization Policies**.
3. Di pemilih resource di kiri atas, pilih **project** `Cipansor` — bukan
   organisasinya. Ini bagian yang menentukan: mengubahnya di tingkat project
   membuat seluruh sisa organisasi tetap terlindungi.
4. Cari **Disable service account key creation**
   (`iam.disableServiceAccountKeyCreation`) → **Manage policy**.
5. Pilih **Override parent's policy** → **Off** / _Not enforced_ → **Set
   policy**.
6. Tunggu sebentar (perubahannya butuh beberapa saat untuk menyebar), lalu
   ulangi langkah 4 di atas.

**Nyalakan kembali setelah kuncinya di tangan.** Kembalikan pilihan itu ke
_Inherit parent's policy_. Kunci yang sudah ada tetap berfungsi; yang dilarang
hanyalah pembuatan kunci **baru** — yang justru pertahanan yang Anda inginkan.
Catat di suatu tempat bahwa langkah ini perlu diulang bila kelak kuncinya
dirotasi.

Dua alternatif, bila Anda tidak ingin menyentuh kebijakan organisasi:

- **Project di luar organisasi.** Kebijakan organisasi hanya berlaku pada
  resource di dalamnya. Sebuah project tanpa induk organisasi tidak terkena —
  lihat catatan "No organization" di langkah 1. Konsekuensinya tetap sama:
  project jadi milik akun pembuatnya.
- **Tanpa kunci sama sekali** (paling aman, paling banyak kerjanya). Server ini
  berjalan di VM Azure, dan Google mendukung _Workload Identity Federation_
  dengan Azure sebagai penyedia identitas: aplikasi menukar token identitas VM
  dengan token Google, sehingga tidak ada kunci yang pernah tersimpan di mana
  pun. Ini perlu menyiapkan workload identity pool di Google, managed identity
  di Azure, dan jalur kode kedua di `google-service-account.ts` — sepadan bila
  suatu saat ada waktunya, berlebihan untuk mengaktifkan email hari ini.

### 5. Catat Client ID (Unique ID) service account

1. Masih di halaman service account, tab **Details**.
2. Salin **Unique ID** — angka panjang, mis. `114857392017465829301`.

Nilai inilah yang dipakai di Admin console, **bukan** alamat emailnya.

### 6. Izinkan delegasi domain — Google Admin console

Langkah ini yang membuat service account boleh bertindak sebagai
`noreply@cipansor.or.id`. Tanpa ini, semua pengiriman ditolak dengan
`unauthorized_client`.

1. Buka <https://admin.google.com/> sebagai super admin `cipansor.or.id`.
2. **Security** → **Access and data control** → **API controls**.
3. Di bagian _Domain-wide delegation_, klik **Manage domain-wide delegation**.
4. **Add new**.
5. Isi:
   - _Client ID_: **Unique ID** dari langkah 5.
   - _OAuth scopes_: `https://www.googleapis.com/auth/gmail.send`

     Persis satu scope ini. Jangan tambahkan `gmail.readonly` atau
     `https://mail.google.com/` — sistem tidak memerlukannya, dan cakupan yang
     lebih luas berarti kerusakan yang lebih besar bila kunci bocor.
6. **Authorize**.

Perubahan delegasi kadang butuh beberapa menit untuk menyebar.

### 7. Pastikan kotak surat pengirim ada

`noreply@cipansor.or.id` harus benar-benar ada di Workspace, dan sebaiknya
sebagai **user tersendiri**, bukan alias.

Alasannya: yang ditiru service account (`sub` pada permintaan token) harus
berupa akun pengguna nyata di domain. Alamat alias tidak selalu diterima di
posisi itu, dan kalaupun tokennya terbit, Gmail dapat menulis ulang header
`From` menjadi alamat utama pemilik alias — sehingga email tetap terkirim tapi
bukan atas nama yang Anda maksud. Kalau alamat itu sama sekali tidak ada, Google
menolak dengan `unauthorized_client` meski langkah 6 sudah benar.

Membuat user tersendiri memakai satu lisensi, dan Workspace for Nonprofits
menyediakannya jauh lebih banyak dari yang yayasan perlukan.

Kalau Anda tetap ingin memakai alias, setel `GMAIL_SENDER` ke **alamat utama**
pemilik alias, dan pastikan alias itu terdaftar sebagai _Send mail as_ yang
terverifikasi pada akun tersebut — barulah `MAIL_FROM` boleh memakai alamat
aliasnya. Uji satu kiriman nyata dan periksa header `From` yang benar-benar
sampai; jangan berasumsi.

Begitu juga `halo@cipansor.or.id` harus ada dan **dibaca orang** — bisa berupa
user biasa atau _Google Group_ berisi staf TU. Ke sinilah balasan wali santri
akan masuk.

### 8. Isi konfigurasi di server

Di `.env` pada host produksi (berkas ini tidak pernah masuk git):

```dotenv
MAIL_FROM=Yayasan Pesantren Cipansor <noreply@cipansor.or.id>
MAIL_REPLY_TO=halo@cipansor.or.id

GOOGLE_SERVICE_ACCOUNT_EMAIL=cipansor-mailer@cipansor-mailer.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----\n"
GMAIL_SENDER=noreply@cipansor.or.id
```

Menyalin private key dengan tangan adalah tempat langkah ini paling sering
gagal, jadi ada skrip pembantu yang mencetak ketiga barisnya sekaligus dari
berkas JSON:

```bash
scripts/gmail-key-to-env.sh ~/Downloads/cipansor-mailer-abc123.json
```

Skrip itu juga mencetak **Client ID** untuk Admin console, dan berhenti dengan
pesan yang jelas bila yang diberikan ternyata berkas OAuth client, bukan service
account. Tidak ada yang ditulis ke mana pun — keluarannya untuk Anda tempelkan
sendiri ke `.env`.

Catatan penting soal format:

- **`MAIL_FROM` tanpa tanda kutip.** Nilai di `.env` dan di
  `docker-compose.yml` dibaca apa adanya; tanda kutip akan ikut terkirim
  sebagai bagian dari nama pengirim, sehingga penerima melihat
  `' Yayasan Pesantren Cipansor'`.
- **`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` ditulis satu baris**, dengan `\n`
  sebagai dua karakter literal (backslash dan huruf n), dibungkus tanda kutip
  ganda. Nilai ini bisa disalin langsung dari field `private_key` di berkas
  JSON. Aplikasi mengubah `\n` kembali menjadi baris baru saat membaca.

Lalu terapkan:

```bash
docker compose up -d api
```

Variabel-variabel ini sudah didaftarkan di blok `environment:` service `api`
pada `docker-compose.yml`. Menambah variabel di `.env` saja tidak cukup — kalau
tidak disebut di blok itu, nilainya tidak pernah sampai ke dalam container dan
fitur gagal diam-diam.

### 9. Pastikan sudah aktif

1. Masuk portal sebagai super admin → **Notifikasi** → **Pengaturan**.
2. Kartu **Server Email Keluar** harus menampilkan:
   - Metode: `Gmail API` (service account, tanpa sandi aplikasi) sebagai
     `noreply@cipansor.or.id`
   - Badge hijau **Email siap kirim**

   Kalau masih kuning **Email tidak terkirim — hanya dicatat di log**, berarti
   kredensial belum terbaca container. Periksa `docker compose exec api env |
grep GOOGLE_`.

3. Uji satu kiriman nyata: **Pengguna** → menu titik-tiga pada satu akun uji →
   **Kirim tautan reset password**. Email harus masuk, dengan pengirim
   `Yayasan Pesantren Cipansor` dan balasan mengarah ke `halo@`.

---

## Kalau gagal

| Pesan                            | Artinya                                                                                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unauthorized_client`            | Client ID belum diizinkan di Admin console (langkah 6), atau scope-nya tidak persis `gmail.send`, atau `GMAIL_SENDER` bukan user/alias nyata di domain.                                                                                             |
| `Delegation denied for <alamat>` | Delegasi ada, tetapi tidak mencakup alamat yang diminta. Periksa `GMAIL_SENDER`.                                                                                                                                                                    |
| `invalid_grant`                  | Jam server melenceng jauh, atau private key salah salin (baris `\n` hilang).                                                                                                                                                                        |
| Badge tetap kuning               | Variabel tidak sampai ke container — lihat catatan `environment:` di langkah 8.                                                                                                                                                                     |
| Email masuk spam                 | Pastikan SPF/DKIM/DMARC domain sudah disetel Workspace. Karena pengiriman lewat infrastruktur Gmail sebagai user domain, DKIM Workspace berlaku otomatis begitu diaktifkan di Admin console → Apps → Google Workspace → Gmail → Authenticate email. |

---

## Cadangan: SMTP

Kalau karena satu dan lain hal Gmail API tidak bisa dipakai, transport SMTP
tetap tersedia dan dipakai otomatis ketika kredensial Gmail kosong:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@cipansor.or.id
SMTP_PASS=<sandi aplikasi 16 karakter>
```

Sandi aplikasi mensyaratkan 2FA aktif pada akun pengirim, dan memberi pemegangnya
akses ke seluruh kotak surat — itulah sebabnya ini cadangan, bukan pilihan
utama.

Koneksi SMTP dipakai dengan _pooling_ (maksimum 5 koneksi, 10 pesan/detik)
karena pengumuman dikirim berkelompok 50 sekaligus dan Gmail menolak koneksi
serentak yang terlalu banyak.

---

## Kalau tidak ada yang dikonfigurasi

Sistem tidak error dan tidak menggantung: setiap email dicatat di log lalu
dibuang, dan halaman Pengaturan Notifikasi menyatakannya apa adanya
("Email tidak terkirim — hanya dicatat di log"). Ini keadaan produksi sebelum
perubahan ini — bedanya, dulu halaman itu tetap menampilkan badge hijau.

---

## Alur reset password

Terkait langsung dengan email, dan sengaja dibuat begini:

- **Tidak ada halaman "lupa password" publik.** Formulir yang bisa diisi
  siapa saja adalah cara gratis untuk membuat sistem mengirim email ke alamat
  mana pun, dan untuk menebak alamat mana yang punya akun.
- **Reset dimulai admin.** Pengguna yang lupa password menghubungi admin. Admin
  membuka **Pengguna**, menemukan orangnya, dan memilih **Kirim tautan reset
  password**.
- **Admin tidak pernah tahu password barunya.** Yang dikirim hanyalah tautan
  sekali pakai berumur 1 jam menuju `/reset-password` di portal; penggunalah
  yang memilih password baru.
- **Token disimpan sebagai SHA-256**, dihapus begitu dipakai, dan semua sesi
  lama diakhiri setelah password berganti.

Akun santri dan wali yang dibuat lewat alur SPMB memakai mekanisme yang sama,
dengan tautan berumur 24 jam.
