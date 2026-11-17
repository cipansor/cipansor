import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import type {
  CreatePrivacyPolicyVersionInput,
  ListPrivacyPolicyVersionsQuery,
  PrivacyPolicyCurrentDTO,
  PrivacyPolicyVersionSummaryDTO,
} from '@cipansor/shared';

/**
 * Kebijakan Privasi publik yang berversi (UU PDP 27/2022 Pasal 30, 35).
 *
 * Teksnya di basis data, bukan di kode, karena isinya diputuskan yayasan lewat
 * versi baru (decisions/persetujuan-pengguna.md). Modul ini hanya menyimpan,
 * menerbitkan, dan membaca; ia tidak pernah menyunting versi lama — persetujuan
 * pendaftar menunjuk nomor versi, dan mengubah teks yang sudah disetujui akan
 * membuat bukti persetujuan berbohong.
 *
 * `effectiveAt` boleh di masa depan: yayasan dapat menerbitkan teks yang mulai
 * berlaku saat rilis. Yang "berlaku" di sini adalah versi tertinggi yang
 * `effectiveAt`-nya sudah lewat; bila belum ada yang lewat, versi tertinggi
 * tetap ditampilkan supaya halaman publik tidak pernah kosong sebelum hari
 * pertama.
 */

/** Bentuk baris Prisma yang kita butuhkan, agar pemetaannya jelas satu tempat. */
interface VersionRow {
  version: number;
  effectiveAt: Date;
  bodyId: string;
  bodyEn: string;
  bodyAr: string;
  summaryId: string;
  summaryEn: string;
  summaryAr: string;
}

function toCurrentDTO(row: VersionRow): PrivacyPolicyCurrentDTO {
  return {
    version: row.version,
    effectiveAt: row.effectiveAt.toISOString(),
    texts: {
      id: { body: row.bodyId, summary: row.summaryId },
      en: { body: row.bodyEn, summary: row.summaryEn },
      ar: { body: row.bodyAr, summary: row.summaryAr },
    },
  };
}

/**
 * Versi yang berlaku sekarang.
 *
 * Yang dipilih: versi tertinggi yang `effectiveAt`-nya sudah lewat. Bila semua
 * versi masih di masa depan (penerbitan sebelum rilis), versi tertinggi dipakai
 * apa adanya — halaman publik tidak boleh kosong. `null` hanya bila belum ada
 * versi sama sekali, dan pemanggil memperlakukannya sebagai "belum diterbitkan".
 */
export async function getCurrentPolicy(): Promise<PrivacyPolicyCurrentDTO | null> {
  const now = new Date();
  const effective = await prisma.privacyPolicyVersion.findFirst({
    where: { effectiveAt: { lte: now } },
    orderBy: { version: 'desc' },
  });
  if (effective) return toCurrentDTO(effective);

  const latest = await prisma.privacyPolicyVersion.findFirst({
    orderBy: { version: 'desc' },
  });
  return latest ? toCurrentDTO(latest) : null;
}

/** Nomor versi yang berlaku, untuk memvalidasi `consentVersion`. Null bila belum ada. */
export async function getCurrentVersionNumber(): Promise<number | null> {
  const current = await getCurrentPolicy();
  return current?.version ?? null;
}

/** Daftar versi (layar admin), terbaru dulu. */
export async function listVersions(query: ListPrivacyPolicyVersionsQuery): Promise<{
  data: PrivacyPolicyVersionSummaryDTO[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const { page, limit } = query;
  const [total, rows] = await Promise.all([
    prisma.privacyPolicyVersion.count(),
    prisma.privacyPolicyVersion.findMany({
      orderBy: { version: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { createdBy: { select: { id: true, name: true } } },
    }),
  ]);

  return {
    data: rows.map((row) => ({
      id: row.id,
      version: row.version,
      effectiveAt: row.effectiveAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      summary: row.summaryId,
      createdBy: row.createdBy ?? null,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/** Satu versi lengkap menurut nomornya (riwayat admin). */
export async function getVersion(version: number): Promise<PrivacyPolicyCurrentDTO | null> {
  const row = await prisma.privacyPolicyVersion.findUnique({ where: { version } });
  return row ? toCurrentDTO(row) : null;
}

/**
 * Terbitkan versi baru (Super Admin).
 *
 * Nomornya dihitung peladen (`max(version) + 1`), bukan dikirim pemanggil:
 * nomor yang diketik manusia adalah nomor yang akan salah. Membaca nomor
 * tertinggi dan menyisipkan barisnya adalah dua operasi; dua permintaan
 * bersamaan bisa membaca nomor yang sama, dan batas unik `version` menolak
 * salah satunya dengan 409 walaupun isiannya sah. Karena itu penyisipan diulang
 * saat benturan itu terjadi (pola yang sama dengan `createRegistrant`), sehingga
 * penerbitan bersamaan menghasilkan dua nomor berurutan, bukan satu kegagalan.
 * Versi lama tidak pernah disentuh — barisnya tetap ada sebagai teks yang
 * disetujui pendaftar dahulu.
 */
export async function createVersion(
  input: CreatePrivacyPolicyVersionInput,
  actor: { sub: string }
): Promise<PrivacyPolicyCurrentDTO> {
  const MAX_ATTEMPTS = 5;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const latest = await prisma.privacyPolicyVersion.findFirst({
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;
    try {
      const row = await prisma.privacyPolicyVersion.create({
        data: {
          version: nextVersion,
          bodyId: input.bodies.id,
          bodyEn: input.bodies.en,
          bodyAr: input.bodies.ar,
          summaryId: input.summaries.id,
          summaryEn: input.summaries.en,
          summaryAr: input.summaries.ar,
          effectiveAt: input.effectiveAt,
          createdById: actor.sub,
        },
      });
      return toCurrentDTO(row);
    } catch (err) {
      lastError = err;
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        Array.isArray((err.meta as { target?: string[] } | undefined)?.target) &&
        (err.meta as { target: string[] }).target.includes('version')
      ) {
        // Another publish took this number between our read and our insert.
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * Pastikan `consentVersion` yang dikirim pendaftar benar-benar ada.
 *
 * Dipakai gerbang persetujuan SPMB: persetujuan harus menunjuk teks yang nyata
 * dibaca, bukan nomor karangan. Bila belum ada versi sama sekali (yayasan belum
 * menerbitkan teks), pendaftaran publik memang belum boleh berjalan — dan itu
 * yang dikatakan galat ini.
 */
export async function assertVersionExists(version: number): Promise<void> {
  const row = await prisma.privacyPolicyVersion.findUnique({
    where: { version },
    select: { version: true },
  });
  if (!row) {
    throw Errors.badRequest(
      'Versi kebijakan privasi tidak dikenal. Muat ulang halaman pendaftaran.'
    );
  }
}
