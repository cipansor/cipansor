import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const COMPOSE = fs.readFileSync(path.join(REPO_ROOT, 'docker-compose.yml'), 'utf8');
const DOCKERFILE = fs.readFileSync(path.join(REPO_ROOT, 'apps', 'api', 'Dockerfile'), 'utf8');
const ENTRYPOINT = fs.readFileSync(
  path.join(REPO_ROOT, 'apps', 'api', 'docker-entrypoint.sh'),
  'utf8'
);

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

// The store resolves its directory from the working directory at import, so
// each run gets a throwaway one and never writes into the checkout.
let tmp: string;
let cwd: string;
let store: typeof import('./attendance-photo-store');

beforeAll(async () => {
  cwd = process.cwd();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'att-photo-'));
  process.chdir(tmp);
  vi.resetModules();
  store = await import('./attendance-photo-store');
});

afterAll(() => {
  process.chdir(cwd);
  fs.rmSync(tmp, { recursive: true, force: true });
});

const storePath = () => store.ATTENDANCE_PHOTO_RELATIVE_DIR.split(path.sep).join('/');

describe('the store survives a redeploy and is never served statically', () => {
  // Every selfie disappearing on the next deploy raises no error: the rows keep
  // pointing at files that are gone. Each deployment file must persist the path.
  it('docker compose mounts a named volume at the path the code writes', () => {
    expect(COMPOSE).toContain(`:/app/apps/api/${storePath()}`);
  });

  it('the image creates and owns the directory before a volume lands on it', () => {
    expect(DOCKERFILE).toMatch(new RegExp(`mkdir[^\\n]*${storePath()}`, 'm'));
    expect(DOCKERFILE).toMatch(new RegExp(`chown[\\s\\S]*?${storePath()}`, 'm'));
  });

  it('App Service links it into the persistent directory like the others', () => {
    expect(ENTRYPOINT).toMatch(new RegExp(`for d in [^;\\n]*${storePath()}`));
  });

  it('is outside public/, which /uploads serves to every signed-in account', () => {
    expect(storePath().startsWith('public/')).toBe(false);
  });
});

describe('a photo backs a punch only when it is fresh, the caller’s, and on disk', () => {
  it('accepts a photo the caller just took', async () => {
    const now = new Date();
    const ref = await store.storeAttendancePhoto(USER, JPEG, 'image/jpeg', now);
    expect(await store.attendancePhotoRefusal(ref, USER, now)).toBeNull();
  });

  it('refuses someone else’s photo', async () => {
    const now = new Date();
    const ref = await store.storeAttendancePhoto(OTHER, JPEG, 'image/jpeg', now);
    expect(await store.attendancePhotoRefusal(ref, USER, now)).toMatch(/tidak dikenal/);
  });

  it('refuses a photo older than the window', async () => {
    const taken = new Date('2026-10-09T01:00:00Z');
    const ref = await store.storeAttendancePhoto(USER, JPEG, 'image/jpeg', taken);
    const later = new Date(taken.getTime() + store.ATTENDANCE_PHOTO_MAX_AGE_MS + 1);
    expect(await store.attendancePhotoRefusal(ref, USER, later)).toMatch(/kedaluwarsa/);
  });

  it('refuses a well-formed name that points at no file', async () => {
    const now = new Date();
    const made = `${USER}.${now.getTime()}.0123456789abcdef.jpg`;
    expect(await store.attendancePhotoRefusal(made, USER, now)).toMatch(/tidak ditemukan/);
  });

  it('refuses anything that is not a name the store writes', async () => {
    for (const ref of ['../../etc/passwd', 'https://example.test/a.jpg', `${USER}.jpg`]) {
      expect(await store.attendancePhotoRefusal(ref, USER)).toMatch(/tidak dikenal/);
    }
  });
});

describe('what the store accepts', () => {
  it('checks the bytes, not only the declared type', () => {
    expect(store.looksLikeImage(JPEG, 'image/jpeg')).toBe(true);
    expect(store.looksLikeImage(Buffer.from('<svg/>'), 'image/jpeg')).toBe(false);
    expect(store.looksLikeImage(JPEG, 'image/png')).toBe(false);
  });

  it('keeps the file readable by its own process only', async () => {
    const ref = await store.storeAttendancePhoto(USER, JPEG, 'image/jpeg');
    const mode = fs.statSync(path.join(tmp, store.ATTENDANCE_PHOTO_RELATIVE_DIR, ref)).mode;
    expect(mode & 0o077).toBe(0);
  });

  it('reads back what it stored, and deletes it idempotently', async () => {
    const ref = await store.storeAttendancePhoto(USER, JPEG, 'image/jpeg');
    const read = await store.readAttendancePhoto(ref);
    expect(read.mimeType).toBe('image/jpeg');
    expect(read.buffer.equals(JPEG)).toBe(true);
    await store.deleteAttendancePhoto(ref);
    await store.deleteAttendancePhoto(ref);
    expect((await store.listAttendancePhotos()).map((f) => f.ref)).not.toContain(ref);
  });
});
