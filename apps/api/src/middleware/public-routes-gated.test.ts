import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Setiap rute TULIS yang dapat dijangkau tanpa sesi harus dijaga Turnstile —
 * atau berada di daftar kecuali di bawah, dengan alasannya tertulis.
 *
 * **Mengapa ini ada.** Turnstile pertama kali dipasang pada tiga endpoint,
 * dipilih dengan cara membaca kode dan mengingat. Audit yang sesungguhnya
 * menemukan sembilan, jadi enam terlewat — termasuk pendaftaran SPMB publik dan
 * form donasi. Cara memilih yang mengandalkan ingatan gagal diam-diam dan gagal
 * lagi setiap kali ada rute publik baru. Berkas ini memindai pohon rutenya
 * sendiri, sehingga rute publik berikutnya yang lupa dijaga menjadi uji merah,
 * bukan temuan yang menunggu seseorang berpikir untuk mencarinya.
 *
 * **Komentar dibuang lebih dulu, dan itu bukan kerapian.** Percobaan pertama
 * mencari `router.use(authenticate)` di dalam sumber mentah dan menemukannya di
 * dalam sebuah komentar dokumentasi yang menyebut nama pemanggilan itu — lalu
 * menyimpulkan `/esign/verify-pdf` berada di belakang tembok autentikasi
 * padahal tidak. Sebuah alat audit yang salah baca lebih buruk daripada tidak
 * ada alat sama sekali: ia meyakinkan.
 */

const MODULES_DIR = path.join(__dirname, '..', 'modules');

/**
 * Rute tulis publik yang SENGAJA tanpa Turnstile.
 *
 * Menambah baris di sini adalah keputusan yang harus dijelaskan, bukan cara
 * membuat uji ini hijau.
 */
const DELIBERATELY_UNGATED: Record<string, string> = {
  'auth.routes.ts POST /refresh':
    'Dipanggil peramban di latar belakang tanpa antarmuka, dan refresh token ITU SENDIRI kredensialnya. ' +
    'Tantangan tidak dapat diselesaikan di dalam XHR senyap, jadi memasang gerbang di sini akan memutus ' +
    'setiap perpanjangan sesi. Dijaga authLimiter.',
  'student.routes.ts POST /id-cards/verify':
    'Endpoint pemindai QR untuk petugas, tanpa halaman web yang memanggilnya — captcha adalah alat yang ' +
    'salah untuk konsumen mesin dan akan mematikannya. Dijaga defaultLimiter.',
  'admissions.routes.ts POST /public/registrants/:registrantId/documents':
    'Unggah dokumen pasca-pendaftaran. Izinnya adalah `registrationToken` bertanda-tangan HMAC (kadaluarsa ' +
    '2 jam) yang hanya dicetak peladen di `/public/registrants` — permukaan yang SUDAH dijaga ' +
    "`requireTurnstile('spmb-daftar')`. Jadi permintaan ini hanya dapat muncul dari pendaftaran yang sudah " +
    'lulus Turnstile, dan menyelesaikan tantangan kedua tepat setelah menyerahkan formulir yang sudah tervet ' +
    'adalah permusuhan tanpa tambahan perlindungan. Dijaga registrationToken + documentUploadLimiter.',
  'admissions.routes.ts POST /public/parse-document':
    'Bantuan OCR tanpa status yang dipanggil peramban pada langkah Dokumen, sebelum pendaftaran dibuat. Tidak ' +
    'menulis apa pun ke DB — hanya memvalidasi data yang dikirim pengunjung sendiri. Mesinnya Tesseract.js ' +
    '(WASM) lokal dengan traineddata yang dibundel, jadi tidak ada gambar yang keluar sistem. Dijaga ' +
    'documentOcrLimiter (6/menit/IP) begitu mesin dinyalakan. Menuntut Turnstile di sini akan gagal-tertutup ' +
    'pada langkah unggah bagi pengunjung yang jaringannya memfilter challenges.cloudflare.com, padahal ' +
    'permintaan ini tidak membuat baris.',
  'data-subject-requests.routes.ts POST /public/verify':
    'Langkah KEDUA alur permintaan data pribadi. Permintaannya sendiri hanya dapat lahir dari POST /public ' +
    'yang sudah dijaga requireTurnstile, jadi tidak ada permintaan yang dapat diverifikasi tanpa satu ' +
    'tantangan diselesaikan lebih dulu. Yang dijaga di sini adalah dua batas yang mengikat pada barisnya: ' +
    'DATA_SUBJECT_VERIFICATION_MAX_ATTEMPTS percobaan per permintaan, dan dataSubjectLimiter 5 permintaan ' +
    'per menit per IP. Menuntut tantangan kedua tepat setelah pemohon menyalin kode dari WhatsApp-nya akan ' +
    'menggagalkan-tertutup keluarga yang jaringannya memfilter challenges.cloudflare.com, tanpa menutup ' +
    'penebakan yang sudah dibatasi lima percobaan itu.',
};

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) ?? []).length))
    .replace(/\/\/[^\n]*/g, '');
}

interface RouteCall {
  method: string;
  routePath: string;
  body: string;
  index: number;
}

/** Ambil setiap `router.<method>(...)`, termasuk yang ditulis multi-baris. */
function routeCalls(source: string): RouteCall[] {
  const found: RouteCall[] = [];
  const pattern = /router\.(get|post|put|patch|delete)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    let i = match.index + match[0].length;
    let depth = 1;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') depth -= 1;
      i += 1;
    }
    const body = source.slice(match.index + match[0].length, i - 1);
    const pathMatch = body.match(/'([^']*)'/);
    if (!pathMatch) continue;
    found.push({
      method: match[1]!.toUpperCase(),
      routePath: pathMatch[1]!,
      body,
      index: match.index,
    });
  }
  return found;
}

function routeFiles(): string[] {
  const files: string[] = [];
  for (const dir of fs.readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const full = path.join(MODULES_DIR, dir.name);
    for (const entry of fs.readdirSync(full)) {
      if (entry.endsWith('.routes.ts')) files.push(path.join(full, entry));
    }
  }
  return files.sort();
}

/** Rute yang terdaftar sebelum `router.use(authenticate)` dan tanpa penjaga sebaris. */
function publicWriteRoutes(): Array<{ key: string; gated: boolean }> {
  const results: Array<{ key: string; gated: boolean }> = [];

  for (const file of routeFiles()) {
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    const gateMatch = source.match(/router\.use\(\s*authenticate\s*[,)]/);
    const gateIndex = gateMatch?.index ?? Number.MAX_SAFE_INTEGER;

    for (const call of routeCalls(source)) {
      if (call.method === 'GET') continue;
      if (call.index >= gateIndex) continue;

      const guardedInline = /authenticate|authorize|isSuperAdmin|isAdmin|requirePermission/.test(
        call.body
      );
      if (guardedInline) continue;

      results.push({
        key: `${path.basename(file)} ${call.method} ${call.routePath}`,
        gated: call.body.includes('requireTurnstile'),
      });
    }
  }
  return results;
}

describe('rute tulis publik dijaga Turnstile', () => {
  it('menemukan permukaan publiknya sama sekali (penjaga atas penjaganya)', () => {
    // Kalau pemindainya rusak — regex meleset, direktori pindah — ia akan
    // mengembalikan daftar kosong dan setiap harapan di bawah lolos tanpa
    // memeriksa apa pun. Hijau karena tidak melihat apa-apa adalah kegagalan
    // yang paling mudah tidak disadari.
    const routes = publicWriteRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(9);

    // Dan ia harus menemukan yang sudah pasti ada di sana.
    const keys = routes.map((r) => r.key);
    expect(keys).toContain('auth.routes.ts POST /login');
    expect(keys).toContain('esign.routes.ts POST /verify-pdf');
  });

  it('setiap rute tulis publik dijaga, atau terdaftar dengan alasan', () => {
    const ungated = publicWriteRoutes()
      .filter((r) => !r.gated)
      .filter((r) => !(r.key in DELIBERATELY_UNGATED))
      .map((r) => r.key);

    expect(
      ungated,
      `Rute tulis berikut dapat dijangkau tanpa sesi dan tanpa Turnstile.\n` +
        `Pasang requireTurnstile, atau tambahkan ke DELIBERATELY_UNGATED beserta alasannya:\n` +
        ungated.map((k) => `  - ${k}`).join('\n')
    ).toEqual([]);
  });

  it('daftar kecualinya tidak memuat rute yang sudah tidak ada', () => {
    // Alasan yang menunjuk rute yang sudah dihapus akan tetap terbaca sebagai
    // keputusan sadar oleh pembaca berikutnya.
    const keys = new Set(publicWriteRoutes().map((r) => r.key));
    const stale = Object.keys(DELIBERATELY_UNGATED).filter((k) => !keys.has(k));

    expect(stale, `Daftar kecuali menyebut rute yang tidak ada lagi: ${stale.join(', ')}`).toEqual(
      []
    );
  });
});
