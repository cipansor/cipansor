import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

/**
 * Where clock-in selfies are kept.
 *
 * Not `public/uploads`. That directory is served to every signed-in account —
 * `uploadsAuth` is authentication, not authorization — so a santri or a wali
 * holding a valid token could open any file in it. A selfie is a facial image,
 * specific personal data under UU 27/2022 (PDP) Ps. 4, so nothing serves this
 * directory statically: the only reader is the endpoint that checks who is
 * asking and records the read.
 *
 * Exported because the value is a contract with the deployment, not an internal
 * detail: the Dockerfile, `docker-entrypoint.sh` and `docker-compose.yml` must
 * persist exactly this path, or every selfie disappears on the next deploy while
 * the attendance rows still point at it. The test next to this file compares
 * them.
 */
export const ATTENDANCE_PHOTO_RELATIVE_DIR = path.join('private', 'attendance');

const STORE_DIR = path.join(process.cwd(), ATTENDANCE_PHOTO_RELATIVE_DIR);

const ACCEPTED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MIME_OF: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export const MAX_ATTENDANCE_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * How long a taken photo stays usable for a punch. Long enough to take the
 * photo, read the location and press the button on a slow phone; short enough
 * that yesterday's selfie cannot be replayed today.
 */
export const ATTENDANCE_PHOTO_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * A photo that no punch ever used is removed after this long. The file is
 * written before the punch that refers to it, so a fresh file always looks
 * unused for a moment; a day is far beyond that moment.
 */
export const ATTENDANCE_PHOTO_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * `<userId>.<taken at, epoch ms>.<16 hex>.<ext>` — written by the server only.
 * The owner and the time are read back from the name, which a client cannot
 * forge: a name it makes up points at no file.
 */
const REF =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{13})\.([0-9a-f]{16})\.(jpg|png|webp)$/;

export function isAcceptedAttendancePhoto(mimeType: string): boolean {
  return mimeType in ACCEPTED;
}

/**
 * Does the buffer start like the image type it claims to be? The multipart
 * `Content-Type` is whatever the client wrote; the bytes are not.
 */
export function looksLikeImage(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === 'image/webp') {
    return (
      buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
      buffer.subarray(8, 12).toString('latin1') === 'WEBP'
    );
  }
  return false;
}

export function parseAttendancePhotoRef(ref: string): { userId: string; takenAt: Date } | null {
  const match = REF.exec(ref);
  if (!match) return null;
  return { userId: match[1], takenAt: new Date(Number(match[2])) };
}

/** Store a photo taken by `userId` and return its reference. */
export async function storeAttendancePhoto(
  userId: string,
  buffer: Buffer,
  mimeType: string,
  now = new Date()
): Promise<string> {
  const extension = ACCEPTED[mimeType];
  if (!extension) throw new Error(`Jenis berkas tidak diterima: ${mimeType}`);
  const ref = `${userId}.${now.getTime()}.${crypto.randomBytes(8).toString('hex')}.${extension}`;
  if (!REF.test(ref)) throw new Error('Pengguna tidak sah untuk foto absen');

  await fs.mkdir(STORE_DIR, { recursive: true, mode: 0o700 });
  // 0600: nothing but this process reads it back, through the checked endpoint.
  await fs.writeFile(path.join(STORE_DIR, ref), buffer, { mode: 0o600 });
  return ref;
}

/**
 * Why a reference may not back a punch by `userId` at `now`, or null when it
 * may: it must be a server-written name, taken by that user, within
 * `ATTENDANCE_PHOTO_MAX_AGE_MS`, and the file must exist. Whether another punch
 * already used it is the caller's question — that lives in the database.
 */
export async function attendancePhotoRefusal(
  ref: string,
  userId: string,
  now = new Date()
): Promise<string | null> {
  const parsed = parseAttendancePhotoRef(ref);
  if (!parsed || parsed.userId !== userId) return 'Foto absen tidak dikenal; ambil foto lagi';
  const age = now.getTime() - parsed.takenAt.getTime();
  if (age < 0 || age > ATTENDANCE_PHOTO_MAX_AGE_MS) {
    return 'Foto absen sudah kedaluwarsa; ambil foto lagi';
  }
  try {
    await fs.access(path.join(STORE_DIR, ref));
  } catch {
    return 'Foto absen tidak ditemukan; ambil foto lagi';
  }
  return null;
}

/** Read a stored photo back. The name comes from the database, never a request. */
export async function readAttendancePhoto(
  ref: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const match = REF.exec(ref);
  if (!match) throw new Error('Nama foto absen tidak sah');
  return { buffer: await fs.readFile(path.join(STORE_DIR, ref)), mimeType: MIME_OF[match[4]] };
}

/** Delete a stored photo. A file that is already gone is not a failure. */
export async function deleteAttendancePhoto(ref: string): Promise<void> {
  if (!REF.test(ref)) return;
  try {
    await fs.unlink(path.join(STORE_DIR, ref));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

/** Every photo on disk, for the sweep that removes the ones no punch used. */
export async function listAttendancePhotos(): Promise<{ ref: string; modifiedAt: Date }[]> {
  let entries;
  try {
    entries = await fs.readdir(STORE_DIR, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const found: { ref: string; modifiedAt: Date }[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !REF.test(entry.name)) continue;
    const stat = await fs.stat(path.join(STORE_DIR, entry.name));
    found.push({ ref: entry.name, modifiedAt: stat.mtime });
  }
  return found;
}
