import crypto from 'crypto';

/**
 * Tanda tangan elektronik mandiri untuk surat keluar.
 *
 * Bentuknya sengaja seperti tanda tangan sungguhan, bukan sekadar penanda
 * "sudah disetujui": ada kunci privat milik penanda tangan, dibuka dengan
 * passphrase yang hanya dia tahu, dan hasil tanda tangannya bisa diperiksa
 * ulang oleh siapa pun tanpa perlu percaya pada basis data kami.
 *
 * Empat keputusan yang menentukan bentuk modul ini:
 *
 * 1. **Passphrase tidak pernah disimpan, dalam bentuk apa pun.** Ia hanya
 *    dipakai untuk menurunkan kunci pembuka (KEK) yang mendekripsi kunci
 *    privat di memori, lalu dibuang. Menyimpan hash-nya pun tidak dilakukan:
 *    bukti passphrase benar adalah kunci privat berhasil didekripsi
 *    (AES-GCM gagal autentikasi bila salah), sehingga tidak ada bahan
 *    tambahan yang bisa dicuri untuk ditebak offline.
 *
 * 2. **Berbeda dari password akun dan OTP.** Password membuka sesi; passphrase
 *    membubuhkan tanda tangan. Menyamakannya berarti siapa pun yang sempat
 *    memakai sesi yang terbuka bisa menandatangani surat.
 *
 * 3. **Yang ditandatangani adalah ringkasan (digest) naskah, bukan nomor
 *    suratnya saja.** Bila isi surat diubah setelah ditandatangani, digest
 *    berubah dan tanda tangan otomatis tidak lagi cocok — inilah yang membuat
 *    tanda tangan bermakna.
 *
 * 4. **Kunci publik ikut disalin ke tiap tanda tangan.** Bila kelak penanda
 *    tangan mengganti/mencabut kuncinya, surat lama tetap dapat diverifikasi
 *    dengan kunci yang dipakai saat itu.
 *
 * KDF memakai scrypt (RFC 7914) yang tersedia di Node inti dan bersifat
 * memory-hard. Argon2id sedikit lebih disukai secara umum, tetapi menambah
 * dependensi biner; scrypt dengan parameter di bawah ini sudah memadai dan
 * parameternya disimpan bersama kunci sehingga bisa dinaikkan kelak tanpa
 * membuat kunci lama tak terbaca.
 */

export const ESIGN_ALGORITHM = 'Ed25519';
const CIPHER = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

/** Parameter scrypt. Disimpan per kunci agar dapat dinaikkan tanpa migrasi. */
export const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, keylen: 32 } as const;
// 128 * N * r ≈ 33 MB; default maxmem Node (32 MB) tepat di bawahnya.
const SCRYPT_MAXMEM = 96 * 1024 * 1024;

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
  keylen: number;
}

export interface EncryptedKeyMaterial {
  algorithm: string;
  publicKey: string; // SPKI, base64
  encryptedPrivateKey: string; // base64
  kdfSalt: string; // base64
  kdfParams: ScryptParams;
  iv: string; // base64
  authTag: string; // base64
}

/**
 * Bahan kunci yang baru dibangkitkan, plus sidik jarinya.
 *
 * Sidik jari dihitung dari `publicDer` yang baru lahir, bukan di pemanggil dari
 * field objek ini. Bila pemanggil yang menghitungnya, analisis alir data
 * (CodeQL) melihat "passphrase → objek → field → hash" dan melaporkan hash
 * sandi yang lemah, padahal yang di-hash adalah byte publik. Dihitung sekali di
 * titik kunci itu lahir, jalur itu tidak pernah ada.
 */
export interface GeneratedKeyMaterial extends EncryptedKeyMaterial {
  fingerprint: string;
}

export class EsignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EsignError';
  }
}

function deriveKey(passphrase: string, salt: Buffer, params: ScryptParams): Buffer {
  return crypto.scryptSync(passphrase.normalize('NFKC'), salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

/**
 * Syarat minimum passphrase.
 *
 * Sengaja mensyaratkan panjang, bukan campuran simbol: aturan komposisi
 * mendorong orang membuat "P@ssw0rd!" yang pendek dan mudah ditebak, sedangkan
 * panjang adalah yang benar-benar menaikkan biaya penebakan.
 */
export const MIN_PASSPHRASE_LENGTH = 12;

export function assertPassphraseStrength(passphrase: string): void {
  const p = passphrase.normalize('NFKC');
  if (p.length < MIN_PASSPHRASE_LENGTH) {
    throw new EsignError(`Passphrase tanda tangan minimal ${MIN_PASSPHRASE_LENGTH} karakter.`);
  }
  if (/^\s|\s$/.test(passphrase)) {
    throw new EsignError('Passphrase tidak boleh diawali atau diakhiri spasi.');
  }
}

/** Buat pasangan kunci baru dan kunci privatnya disegel dengan passphrase. */
export function createKeyMaterial(passphrase: string): GeneratedKeyMaterial {
  assertPassphraseStrength(passphrase);

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privateDer = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
  const publicDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;

  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const kek = deriveKey(passphrase, salt, SCRYPT_PARAMS);

  const cipher = crypto.createCipheriv(CIPHER, kek, iv);
  const sealed = Buffer.concat([cipher.update(privateDer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    algorithm: ESIGN_ALGORITHM,
    // Dihitung oleh fungsi yang **tidak** memegang passphrase sama sekali —
    // lihat catatan pada `fingerprintOfSigningKey`. Memanggil
    // `publicKeyFingerprint` di sini akan menyatukan kembali jalur
    // "passphrase → objek → hash" yang justru ingin diputus.
    fingerprint: fingerprintOfSigningKey(publicDer),
    publicKey: publicDer.toString('base64'),
    encryptedPrivateKey: sealed.toString('base64'),
    kdfSalt: salt.toString('base64'),
    kdfParams: { ...SCRYPT_PARAMS },
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Buka kunci privat dengan passphrase.
 *
 * Kegagalan autentikasi AES-GCM adalah satu-satunya penanda passphrase salah —
 * tidak ada perbandingan hash terpisah yang bisa dijadikan oracle.
 */
function unsealPrivateKey(material: EncryptedKeyMaterial, passphrase: string): crypto.KeyObject {
  const salt = Buffer.from(material.kdfSalt, 'base64');
  const iv = Buffer.from(material.iv, 'base64');
  const authTag = Buffer.from(material.authTag, 'base64');
  const kek = deriveKey(passphrase, salt, material.kdfParams);

  try {
    const decipher = crypto.createDecipheriv(CIPHER, kek, iv);
    decipher.setAuthTag(authTag);
    const der = Buffer.concat([
      decipher.update(Buffer.from(material.encryptedPrivateKey, 'base64')),
      decipher.final(),
    ]);
    return crypto.createPrivateKey({ key: der, type: 'pkcs8', format: 'der' });
  } catch {
    throw new EsignError('Passphrase tanda tangan salah.');
  }
}

/** Ganti passphrase tanpa mengganti kunci — surat lama tetap terverifikasi. */
export function rewrapKeyMaterial(
  material: EncryptedKeyMaterial,
  currentPassphrase: string,
  nextPassphrase: string
): EncryptedKeyMaterial {
  assertPassphraseStrength(nextPassphrase);
  const privateKey = unsealPrivateKey(material, currentPassphrase);
  const privateDer = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;

  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const kek = deriveKey(nextPassphrase, salt, SCRYPT_PARAMS);
  const cipher = crypto.createCipheriv(CIPHER, kek, iv);
  const sealed = Buffer.concat([cipher.update(privateDer), cipher.final()]);

  return {
    ...material,
    encryptedPrivateKey: sealed.toString('base64'),
    kdfSalt: salt.toString('base64'),
    kdfParams: { ...SCRYPT_PARAMS },
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

/** Naskah yang ditandatangani, dalam bentuk kanonik. */
export interface SignablePayload {
  letterId: string;
  letterNumber: string | null;
  date: Date | string;
  type: string;
  nature: string;
  subject: string;
  content: string | null;
  unitId: string;
  signerId: string;
  signedAt: Date | string;
  /**
   * Garis kewenangan penandatanganan (a.n./u.b./Plt./Plh.), bila ada.
   *
   * Ikut ditandatangani karena ia **tercetak pada naskah**: mengubahnya setelah
   * penandatanganan sama dengan mengubah naskahnya. Opsional supaya tanda
   * tangan yang dibuat sebelum kolom ini ada tetap terverifikasi — verifier
   * yang tidak menemukannya memakai string kosong, bukan melempar.
   */
  signingAuthorityForm?: string | null;
  /** Jabatan yang diwakili, mis. "Kepala SMA Qur'an Cipansor". */
  representedOffice?: string | null;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/**
 * Versi bentuk kanonik yang **ditandatangani saat ini**.
 *
 * Naik ke `v2` ketika garis kewenangan (a.n./u.b./Plt./Plh.) masuk: `v1`
 * berakhir pada `signedAt`, `v2` menambahkan `signingAuthorityForm` dan
 * `representedOffice`. Menambahkannya pada penanda `v1` yang sama akan
 * mengubah pesan yang ditandatangani dan membuat setiap tanda tangan lama gagal
 * diverifikasi — jadi bentuk lamanya dipertahankan utuh di bawah ini.
 */
export const CURRENT_CANONICAL_VERSION = 2;

/**
 * Bentuk kanonik naskah — apa yang sebenarnya ditandatangani.
 *
 * Diawali penanda versi supaya format ini dapat berubah kelak tanpa membuat
 * tanda tangan lama gagal diverifikasi: verifier membaca versinya dan memakai
 * aturan yang sesuai.
 *
 * Isi surat diwakili ringkasannya (SHA-256), bukan teks utuhnya, agar payload
 * tetap ringkas dan bebas dari persoalan baris baru/encoding — namun tetap
 * mengikat: satu huruf berubah, ringkasannya berubah.
 *
 * `version` memilih aturan yang dipakai. `1` adalah bentuk asli (berakhir di
 * `signedAt`); `2` menambahkan garis kewenangan. Verifikasi tanda tangan lama
 * harus memakai `1`, sebab tanda tangannya dibuat atas byte `v1` dan menambah
 * dua ruas kosong saja sudah mengubah pesannya.
 */
export function canonicalPayload(
  p: SignablePayload,
  version: number = CURRENT_CANONICAL_VERSION
): string {
  const contentHash = crypto
    .createHash('sha256')
    .update(p.content ?? '', 'utf8')
    .digest('hex');

  const base = [
    `cipansor-esign/v${version}`,
    p.letterId,
    p.letterNumber ?? '',
    iso(p.date).slice(0, 10),
    p.type,
    p.nature,
    p.subject,
    contentHash,
    p.unitId,
    p.signerId,
    iso(p.signedAt),
  ];

  // Bentuk asli berakhir di `signedAt`. Ruas garis kewenangan hanya ada sejak
  // v2; menambahkannya pada v1 (walaupun kosong) mengubah pesan yang
  // ditandatangani dan menolak tanda tangan yang sah.
  if (version >= 2) {
    base.push(p.signingAuthorityForm ?? '', p.representedOffice ?? '');
  }

  return base.join('\n');
}

/**
 * Versi kanonik yang harus dipakai untuk **memverifikasi** sebuah tanda tangan.
 *
 * `letterSignature.canonicalVersion` menyimpannya saat menandatangani. Baris
 * yang belum memilikinya (NULL) ditandatangani sebelum versi disimpan — dan
 * satu-satunya bentuk yang ada saat itu adalah `v1`, jadi `1` adalah jawaban
 * yang benar untuk mereka.
 *
 * Pemanggil yang memegang barisnya sebaiknya memakai `signature.canonicalVersion
 * ?? 1` langsung; fungsi ini untuk jalur yang tidak membawa kolomnya.
 */
export function canonicalVersionOf(storedVersion: number | null | undefined): number {
  return storedVersion ?? 1;
}

export function digestOf(payload: string): string {
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Sidik jari kunci publik — yang membuat kunci "dapat disebut namanya".
 *
 * Bentuknya mengikuti sidik jari sertifikat X.509 supaya orang dapat
 * membandingkan kunci secara lisan atau tercetak tanpa menyalin blok base64
 * sepanjang beberapa baris. SBOM, kunci SSH, dan kunci GPG semua melakukan hal
 * yang sama.
 *
 * **Yang di-hash adalah SPKI DER utuh, dengan SHA-256.** Ini disengaja dan
 * berbeda dari dua konstruksi yang mirip namanya, agar tidak disalahpahami:
 *
 *   - RFC 5280 §4.2.1.2 `keyIdentifier` adalah hash **SHA-1 atas
 *     subjectPublicKey** (bit string kunci mentah), bukan atas seluruh SPKI.
 *   - Sidik jari sertifikat umumnya adalah hash atas **seluruh sertifikat**.
 *
 * Kita memakai SHA-256 (SHA-1 kini dianggap lemah untuk keperluan baru), dan
 * menampilkannya dalam bentuk pasangan heksadesimal berhuruf besar dipisah
 * titik dua yang sudah dikenali orang. Karena itu jangan menghitung ulang
 * angka ini dengan alat yang menghasilkan keyIdentifier SHA-1 — hasilnya akan
 * berbeda. Format kanonik yang tersimpan dan dicari adalah bentuk di sini.
 *
 * CodeQL pernah menandai pemanggilnya `js/insufficient-password-hash` karena
 * melihat "passphrase → bahan kunci → field → hash". Peringatan itu **keliru**
 * — yang di-hash adalah SPKI **publik**, bukan sandi. Karena komentar penekan
 * `// codeql[…]` tidak lagi dihormati, jalur itu diputus di sumbernya:
 * `createKeyMaterial` memakai `fingerprintOfSigningKey(publicDer)`, yang hanya
 * menerima byte SPKI dan tidak pernah menyentuh objek bahan kunci. Passphrase
 * sendiri tidak pernah di-hash; ia melalui scrypt (`SCRYPT_PARAMS`, N=2^15) di
 * `deriveKey`, dan hasilnya yang mengenkripsi kunci privat.
 */
export function publicKeyFingerprint(publicKey: string): string {
  const der = Buffer.from(publicKey, 'base64');
  const digest = crypto.createHash('sha256').update(der).digest('hex');
  return (digest.toUpperCase().match(/.{2}/g) ?? []).join(':');
}

/**
 * Sidik jari dari SPKI **DER** yang sudah dilepas dari bahan kunci.
 *
 * Perbedaan dengan `publicKeyFingerprint` bukan pada hasilnya — keduanya
 * meng-hash SPKI yang sama dan mengembalikan bentuk yang sama — melainkan pada
 * **apa yang dipegang pemanggilnya**. `createKeyMaterial` memegang passphrase
 * di dalam badannya; bila ia memanggil `publicKeyFingerprint` (yang menerima
 * `string`, hasil `toString('base64')` dari objek bahan kunci), analisis alir
 * data membaca rantai "passphrase → bahan kunci → field → hash" dan melaporkan
 * hash sandi yang lemah. Laporan itu keliru — yang di-hash adalah byte publik —
 * tetapi menyangkalnya di komentar tidak lagi dihormati perkakasnya.
 *
 * Karena itu jalurnya diputus secara struktural: fungsi ini hanya menerima
 * `Buffer` SPKI, tidak pernah menyentuh bahan kunci, dan dengan begitu tidak
 * ada jalan dari passphrase ke `createHash`.
 */
export function fingerprintOfSigningKey(spkiDer: Buffer): string {
  const digest = crypto.createHash('sha256').update(spkiDer).digest('hex');
  return (digest.toUpperCase().match(/.{2}/g) ?? []).join(':');
}

/**
 * Terima sidik jari dari pengguna dalam bentuk apa pun yang wajar, keluarkan
 * bentuk kanonik yang tersimpan.
 *
 * Orang mengetik ulang sidik jari dari kertas, dari layar, atau menempelkannya
 * dari halaman verifikasi — dengan atau tanpa titik dua, huruf besar atau
 * kecil, kadang dengan spasi. Semua itu sidik jari yang sama, dan menolaknya
 * karena bentuk bukan hanya memindahkan pekerjaan format ke pembaca. Bentuk
 * kanoniknya tetap pasangan heksadesimal berhuruf besar dengan pemisah titik
 * dua, agar sama dengan `publicKeyFingerprint`.
 *
 * Masukan yang bukan heksadesimal (setelah pemisah dibuang) ditolak sebagai
 * "tidak dikenal" oleh pemanggil, bukan dilempar: layanan ini publik, dan
 * masukan asal-asalan adalah hal yang wajar datang ke sana.
 */
export function normaliseFingerprint(input: string): string {
  const hex = input.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return (hex.match(/.{2}/g) ?? []).join(':');
}

export interface SignResult {
  signature: string; // base64
  digest: string; // hex
  publicKey: string; // base64, disalin ke rekaman tanda tangan
  algorithm: string;
  /** Bentuk kanonik yang dipakai; disimpan agar verifikasi memakai aturan yang sama. */
  canonicalVersion: number;
}

/** Tandatangani naskah. Passphrase hanya hidup selama pemanggilan ini. */
export function signPayload(
  material: EncryptedKeyMaterial,
  passphrase: string,
  payload: SignablePayload
): SignResult {
  const privateKey = unsealPrivateKey(material, passphrase);
  const canonical = canonicalPayload(payload, CURRENT_CANONICAL_VERSION);
  const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey);

  return {
    signature: signature.toString('base64'),
    digest: digestOf(canonical),
    publicKey: material.publicKey,
    algorithm: material.algorithm,
    canonicalVersion: CURRENT_CANONICAL_VERSION,
  };
}

/**
 * Periksa keaslian tanda tangan.
 *
 * Memakai kunci publik yang tersimpan pada rekaman tanda tangan, bukan kunci
 * milik pengguna saat ini — sehingga pencabutan atau penggantian kunci tidak
 * membuat surat yang sudah sah menjadi "palsu".
 *
 * `version` memilih bentuk kanonik yang dipakai saat tanda tangan dibuat. Ini
 * **wajib benar**: sebuah tanda tangan lama dibuat atas byte `v1`, dan
 * merekonstruksinya dengan `v2` (yang menambah dua ruas) menghasilkan pesan
 * yang berbeda sehingga kunci yang sah menolaknya. Pemanggil membacanya dari
 * `letterSignature.canonicalVersion` (`canonicalVersionOf`), bukan menebaknya.
 */
export function verifySignature(
  publicKeyBase64: string,
  signatureBase64: string,
  payload: SignablePayload,
  version: number = CURRENT_CANONICAL_VERSION
): boolean {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      type: 'spki',
      format: 'der',
    });
    return crypto.verify(
      null,
      Buffer.from(canonicalPayload(payload, version), 'utf8'),
      publicKey,
      Buffer.from(signatureBase64, 'base64')
    );
  } catch {
    return false;
  }
}

/** Tandatangani hash byte PDF secara langsung dengan Ed25519. */
export function signPdfHash(
  material: EncryptedKeyMaterial,
  passphrase: string,
  pdfHashHex: string
): string {
  const privateKey = unsealPrivateKey(material, passphrase);
  const signature = crypto.sign(null, Buffer.from(pdfHashHex, 'utf8'), privateKey);
  return signature.toString('base64');
}

/**
 * Bentuk kanonik pernyataan pencabutan.
 *
 * Pencabutan adalah pernyataan kriptografis, bukan kolom status. Sebuah CRL pun
 * struktur data yang ditandatangani dan diberi stempel waktu (RFC 5280), dan
 * karena itu pencabutan di sini pun ditandatangani: dengan begitu halaman
 * verifikasi publik dapat *membuktikan* bahwa surat ini dicabut oleh pejabat
 * yang namanya tercantum, bukan sekadar mempercayai satu baris basis data.
 *
 * Yang diikat: tanda tangan mana yang dicabut, oleh siapa, dalam jabatan apa,
 * kapan, dan dengan alasan apa. Mengubah salah satunya membatalkan tanda
 * tangannya — termasuk mengubah alasan yang telanjur dibaca publik.
 */
export interface RevocationStatement {
  signatureId: string;
  letterId: string;
  revokedById: string;
  revokedByRoleCode: string | null;
  revokedAt: Date;
  reason: string;
}

export function canonicalRevocation(r: RevocationStatement): string {
  return [
    `signature:${r.signatureId}`,
    `letter:${r.letterId}`,
    `by:${r.revokedById}`,
    `role:${r.revokedByRoleCode ?? '-'}`,
    `at:${r.revokedAt.toISOString()}`,
    `reason:${r.reason}`,
  ].join('\n');
}

/** Tandatangani pernyataan pencabutan dengan kunci pencabutnya sendiri. */
export function signRevocation(
  material: EncryptedKeyMaterial,
  passphrase: string,
  statement: RevocationStatement
): Omit<SignResult, 'canonicalVersion'> {
  const canonical = canonicalRevocation(statement);
  const digest = digestOf(canonical);
  const privateKey = unsealPrivateKey(material, passphrase);
  const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey);
  return {
    algorithm: ESIGN_ALGORITHM,
    publicKey: material.publicKey,
    digest,
    signature: signature.toString('base64'),
  };
}

/** Benarkah pencabutan ini dinyatakan oleh pemegang kunci itu? */
export function verifyRevocation(
  publicKeyBase64: string,
  statement: RevocationStatement,
  signatureBase64: string
): boolean {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      type: 'spki',
      format: 'der',
    });
    return crypto.verify(
      null,
      Buffer.from(canonicalRevocation(statement), 'utf8'),
      publicKey,
      Buffer.from(signatureBase64, 'base64')
    );
  } catch {
    return false;
  }
}

/** Verifikasi tanda tangan Ed25519 atas hash byte PDF. */
export function verifyPdfHashSignature(
  publicKeyBase64: string,
  pdfHashHex: string,
  signatureBase64: string
): boolean {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      type: 'spki',
      format: 'der',
    });
    return crypto.verify(
      null,
      Buffer.from(pdfHashHex, 'utf8'),
      publicKey,
      Buffer.from(signatureBase64, 'base64')
    );
  } catch {
    return false;
  }
}

/**
 * Token verifikasi yang dimuat QR.
 *
 * Acak 160 bit, bukan turunan dari id surat: token yang bisa ditebak berarti
 * daftar surat bisa disisir lewat halaman publik. Tidak memuat data surat apa
 * pun — QR hanya menunjuk, halaman verifikasilah yang memutuskan apa yang
 * layak ditampilkan.
 */
export function newVerificationToken(): string {
  return crypto.randomBytes(20).toString('base64url');
}

/** Perlindungan tebak-passphrase: penundaan bertingkat lalu penguncian. */
export const MAX_PASSPHRASE_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export function lockoutUntil(failedAttempts: number, now = new Date()): Date | null {
  if (failedAttempts < MAX_PASSPHRASE_ATTEMPTS) return null;
  return new Date(now.getTime() + LOCKOUT_MINUTES * 60_000);
}
