import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';

vi.mock('@/lib/prisma', () => ({
  prisma: { letterUpload: { upsert: vi.fn() } },
}));
vi.mock('@/lib/redis', () => ({ redis: {} }));

import { matchesMagicBytes, verifyStoredFile, uploadsAuth, recordUploadOwnership } from './upload';
import { prisma } from '@/lib/prisma';
import { generateAccessToken } from '@/lib/jwt';
import { ApiError } from './error';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const pdf = Buffer.from('%PDF-1.7\n%');
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom')]);
const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00]);
const ogg = Buffer.from('OggS\x00\x02');
const mp3Id3 = Buffer.from('ID3\x04\x00');
const mp3Sync = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
const phpScript = Buffer.from('<?php system($_GET["c"]); ?>');

describe('matchesMagicBytes', () => {
  it.each([
    ['image/png', png],
    ['image/jpeg', jpeg],
    ['application/pdf', pdf],
    ['image/webp', webp],
    ['audio/wav', wav],
    ['video/mp4', mp4],
    ['audio/mp4', mp4],
    ['audio/webm', webm],
    ['audio/ogg', ogg],
    ['audio/mpeg', mp3Id3],
    ['audio/mpeg', mp3Sync],
  ] as const)('accepts genuine %s content', (mime, buf) => {
    expect(matchesMagicBytes(mime, buf)).toBe(true);
  });

  it('rejects content that does not match the declared type', () => {
    expect(matchesMagicBytes('image/png', phpScript)).toBe(false);
    expect(matchesMagicBytes('image/jpeg', png)).toBe(false);
    expect(matchesMagicBytes('application/pdf', jpeg)).toBe(false);
    // RIFF container of the wrong flavour
    expect(matchesMagicBytes('image/webp', wav)).toBe(false);
  });

  it('rejects MIME types outside the allow-list entirely', () => {
    expect(matchesMagicBytes('text/html', Buffer.from('<html>'))).toBe(false);
    expect(matchesMagicBytes('application/x-php', phpScript)).toBe(false);
  });
});

describe('verifyStoredFile', () => {
  // verifyStoredFile only touches paths inside the configured upload directory,
  // so fixtures must live there too (upload.ts creates it on import).
  const uploadDir = path.join(process.cwd(), 'public/uploads');

  function tmpFile(content: Buffer): string {
    const p = path.join(uploadDir, `upload-test-${Date.now()}-${Math.random()}`);
    fs.writeFileSync(p, content);
    return p;
  }

  it('keeps a file whose bytes match its declared type', async () => {
    const p = tmpFile(png);
    const ok = await verifyStoredFile({ path: p, mimetype: 'image/png' } as Express.Multer.File);
    expect(ok).toBe(true);
    expect(fs.existsSync(p)).toBe(true);
    fs.unlinkSync(p);
  });

  it('deletes a file whose bytes do not match (renamed script as image)', async () => {
    const p = tmpFile(phpScript);
    const ok = await verifyStoredFile({ path: p, mimetype: 'image/png' } as Express.Multer.File);
    expect(ok).toBe(false);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('rejects a path outside the upload directory without touching it', async () => {
    // A traversal attempt must fail before any read or unlink, so a file the
    // app does not own is left alone.
    const outside = path.join(os.tmpdir(), `upload-test-outside-${Date.now()}-${Math.random()}`);
    fs.writeFileSync(outside, png);
    try {
      const ok = await verifyStoredFile({
        path: outside,
        mimetype: 'image/png',
      } as Express.Multer.File);
      expect(ok).toBe(false);
      expect(fs.existsSync(outside)).toBe(true);
    } finally {
      fs.unlinkSync(outside);
    }
  });

  it('rejects a sibling directory whose path shares the upload prefix', async () => {
    // `public/uploads-evil` starts with `public/uploads` but is not inside it.
    const siblingDir = `${uploadDir}-evil`;
    const sibling = path.join(siblingDir, `upload-test-sibling-${Date.now()}`);
    fs.mkdirSync(siblingDir, { recursive: true });
    fs.writeFileSync(sibling, png);
    try {
      const ok = await verifyStoredFile({
        path: sibling,
        mimetype: 'image/png',
      } as Express.Multer.File);
      expect(ok).toBe(false);
      expect(fs.existsSync(sibling)).toBe(true);
    } finally {
      fs.rmSync(siblingDir, { recursive: true, force: true });
    }
  });

  it('rejects a `..` traversal that escapes the upload directory', async () => {
    const escaping = path.join(uploadDir, '..', '..', `upload-test-escape-${Date.now()}`);
    const resolvedOutside = path.resolve(escaping);
    fs.writeFileSync(resolvedOutside, png);
    try {
      const ok = await verifyStoredFile({
        path: escaping,
        mimetype: 'image/png',
      } as Express.Multer.File);
      expect(ok).toBe(false);
      expect(fs.existsSync(resolvedOutside)).toBe(true);
    } finally {
      fs.unlinkSync(resolvedOutside);
    }
  });

  it('rejects the upload directory itself as a path', async () => {
    const ok = await verifyStoredFile({
      path: uploadDir,
      mimetype: 'image/png',
    } as Express.Multer.File);
    expect(ok).toBe(false);
    expect(fs.existsSync(uploadDir)).toBe(true);
  });

  it('accepts a genuine file given as a path relative to the cwd', async () => {
    const abs = tmpFile(png);
    const relative = path.relative(process.cwd(), abs);
    try {
      const ok = await verifyStoredFile({
        path: relative,
        mimetype: 'image/png',
      } as Express.Multer.File);
      expect(ok).toBe(true);
      expect(fs.existsSync(abs)).toBe(true);
    } finally {
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    }
  });

  it('rejects a symlink inside the upload directory that points outside it', async () => {
    // Lexical containment cannot see this; the realpath check must, and the
    // target must survive untouched.
    const outside = path.join(
      os.tmpdir(),
      `upload-test-link-target-${Date.now()}-${Math.random()}`
    );
    fs.writeFileSync(outside, png);
    const link = path.join(uploadDir, `upload-test-link-${Date.now()}`);
    try {
      fs.symlinkSync(outside, link);
      const ok = await verifyStoredFile({
        path: link,
        mimetype: 'image/png',
      } as Express.Multer.File);
      expect(ok).toBe(false);
      expect(fs.existsSync(outside)).toBe(true);
    } finally {
      fs.rmSync(link, { force: true });
      fs.unlinkSync(outside);
    }
  });
});

describe('recordUploadOwnership', () => {
  const uploadDir = path.join(process.cwd(), 'public/uploads');
  const ownerFile = () => path.join(uploadDir, `upload-owner-${Date.now()}-${Math.random()}`);

  it('mencatat pemilik dan mempertahankan berkasnya', async () => {
    vi.mocked(prisma.letterUpload.upsert).mockResolvedValue({} as never);
    const p = ownerFile();
    fs.writeFileSync(p, pdf);

    const ok = await recordUploadOwnership({ filename: 'abc.pdf', path: p }, 'user-1');

    expect(ok).toBe(true);
    expect(prisma.letterUpload.upsert).toHaveBeenCalledWith({
      where: { filename: 'abc.pdf' },
      create: { filename: 'abc.pdf', userId: 'user-1' },
      update: {},
    });
    expect(fs.existsSync(p)).toBe(true);
    fs.unlinkSync(p);
  });

  /**
   * Bila pencatatan gagal, unggahan itu gagal — bukan sukses dengan URL yang
   * pasti ditolak saat suratnya ditandatangani. Berkasnya ikut dihapus supaya
   * tidak menempati ruang tanpa pernah dapat dipakai.
   */
  it('mengembalikan false dan menghapus berkas bila pencatatan gagal', async () => {
    vi.mocked(prisma.letterUpload.upsert).mockRejectedValue(new Error('db down'));
    const p = ownerFile();
    fs.writeFileSync(p, pdf);

    const ok = await recordUploadOwnership({ filename: 'abc.pdf', path: p }, 'user-1');

    expect(ok).toBe(false);
    expect(fs.existsSync(p)).toBe(false);
  });

  /**
   * Penghapusan terbatas pada direktori unggahan.
   *
   * `path` datang bersama permintaan; menghapusnya apa adanya adalah jalur
   * penghapusan berkas sembarang (CodeQL js/path-injection). `recordUploadOwnership`
   * karena itu menyusun ulang path dari `path.basename` **dan** memastikan
   * hasilnya sama dengan `path` yang diberikan, sehingga sebuah path yang
   * menunjuk ke luar `public/uploads` tidak pernah tersentuh.
   */
  it('tidak menghapus berkas di luar direktori unggahan', async () => {
    vi.mocked(prisma.letterUpload.upsert).mockRejectedValue(new Error('db down'));
    const outside = path.join(os.tmpdir(), `upload-owner-outside-${Date.now()}`);
    fs.writeFileSync(outside, pdf);

    const ok = await recordUploadOwnership({ filename: 'abc.pdf', path: outside }, 'user-1');

    expect(ok).toBe(false);
    expect(fs.existsSync(outside)).toBe(true);
    fs.unlinkSync(outside);
  });

  /**
   * Berkas milik permintaan lain tidak boleh ikut terhapus.
   *
   * `path.basename` saja membuat sebuah path di luar direktori yang kebetulan
   * berbagi nama dasar menunjuk unggahan milik orang lain — sehingga kegagalan
   * pencatatan satu permintaan menghapus berkas permintaan lain (CWE-73).
   */
  it('tidak menghapus unggahan lain yang kebetulan senama', async () => {
    vi.mocked(prisma.letterUpload.upsert).mockRejectedValue(new Error('db down'));
    const sharedName = `upload-owner-collide-${Date.now()}`;
    const otherRequestFile = path.join(uploadDir, sharedName);
    fs.writeFileSync(otherRequestFile, pdf);

    const ok = await recordUploadOwnership(
      { filename: sharedName, path: path.join(os.tmpdir(), sharedName) },
      'user-1'
    );

    expect(ok).toBe(false);
    expect(fs.existsSync(otherRequestFile)).toBe(true);
    fs.unlinkSync(otherRequestFile);
  });
});

describe('uploadsAuth', () => {
  const payload = {
    id: 'u1',
    sub: 'u1',
    email: 'u1@example.com',
    roleId: 'r1',
    roleCode: 'SUPER_ADMIN',
    unitId: null,
    permissions: [],
    role: 'SUPER_ADMIN',
  };
  const res = {} as Response;

  function run(req: Partial<Request>) {
    const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
    uploadsAuth({ headers: {}, query: {}, cookies: {}, ...req } as Request, res, next);
    return next;
  }

  it('rejects requests without any token with 401', () => {
    const next = run({});
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).statusCode).toBe(401);
  });

  it('rejects a garbage token with 401', () => {
    const next = run({ headers: { authorization: 'Bearer not-a-jwt' } });
    expect((next.mock.calls[0][0] as ApiError).statusCode).toBe(401);
  });

  it('accepts a valid access token via Authorization header', () => {
    const token = generateAccessToken(payload);
    const next = run({ headers: { authorization: `Bearer ${token}` } });
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a valid token in ?token= — the log-leaking fallback is gone', () => {
    const token = generateAccessToken(payload);
    const next = run({ query: { token } as Request['query'] });
    expect((next.mock.calls[0][0] as ApiError).statusCode).toBe(401);
  });

  it('accepts a valid access token from the HttpOnly session cookie', () => {
    // The browser cannot put a token in the URL or a header for an <img>; it
    // sends this cookie automatically. This is the path the web app now uses.
    const token = generateAccessToken(payload);
    const next = run({ cookies: { cipansor_at: token } });
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects temporary 2FA tokens', () => {
    const token = generateAccessToken({ ...payload, isTemp: true });
    const next = run({ cookies: { cipansor_at: token } });
    expect((next.mock.calls[0][0] as ApiError).statusCode).toBe(401);
  });
});
