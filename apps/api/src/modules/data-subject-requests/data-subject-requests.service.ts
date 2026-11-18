import crypto from 'crypto';
import fs from 'fs/promises';
import { Prisma, type DataSubjectRequest } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { Errors } from '@/middleware/error';
import { notificationService } from '@/modules/notifications';
import { uploadPathFromUrl } from '@/utils/letter-uploaded-file';
import {
  DATA_SUBJECT_REQUEST_DUE_HOURS,
  DATA_SUBJECT_REQUEST_ERASURE_DEFAULT_DAYS,
  DATA_SUBJECT_REQUEST_STATUS_LABELS,
  DATA_SUBJECT_REQUEST_TYPE_LABELS,
  DATA_SUBJECT_VERIFICATION_CODE_LENGTH,
  DATA_SUBJECT_VERIFICATION_MAX_ATTEMPTS,
  DATA_SUBJECT_VERIFICATION_TTL_MINUTES,
  type CreateGuardianDataSubjectRequestInput,
  type CreatePublicDataSubjectRequestInput,
  type DataSubjectRequestAction,
  type DataSubjectRequestDTO,
  type DataSubjectRequestSummaryDTO,
  type DataSubjectRequestType,
  type ListDataSubjectRequestsQuery,
  type PublicDataSubjectRequestCreatedDTO,
  type PublicDataSubjectRequestVerifiedDTO,
  type UpdateDataSubjectRequestStatusInput,
  type VerifyPublicDataSubjectRequestInput,
} from '@cipansor/shared';

/**
 * Alur hak subjek data (UU 27/2022 Pasal 30, 32, 33, 35, 40, 43–44).
 *
 * Tiga keputusan membentuk berkas ini, dan ketiganya dijelaskan di tempatnya
 * masing-masing: tenggat yang DISIMPAN (`computeDueAt`), kode verifikasi yang
 * dikirim ke kontak yang SUDAH terdaftar (`submitPublicRequest`), dan
 * penghapusan yang menahan diri pada data yang masih diwajibkan retensi
 * (`executeErasure`).
 *
 * Yang tidak dikerjakan di sini: apa pun yang menghapus catatan permintaan itu
 * sendiri. Sebuah permintaan penghapusan yang menghapus jejak bahwa ia pernah
 * ada membuat yayasan tidak dapat membuktikan kepatuhannya justru pada
 * permintaan yang paling mungkin dipersoalkan.
 */

/** Baris dengan relasi yang dibutuhkan pemetaan DTO. */
const DSR_INCLUDE = {
  subjectStudent: { include: { user: { select: { name: true } } } },
  subjectRegistrant: {
    select: { fullName: true, name: true, registrationNo: true },
  },
  subjectUser: { select: { name: true, email: true } },
  handledBy: { select: { id: true, name: true } },
} satisfies Prisma.DataSubjectRequestInclude;

type DsrWithRelations = Prisma.DataSubjectRequestGetPayload<{ include: typeof DSR_INCLUDE }>;

/** Status yang mengakhiri alur; pengingat tenggat berhenti di sini. */
const CLOSED_STATUSES = ['COMPLETED', 'REJECTED'] as const;

/** Apakah sebuah status menutup alur — dipakai penyaring daftar dan penutupan. */
function isClosed(status: string): boolean {
  return (CLOSED_STATUSES as readonly string[]).includes(status);
}

/**
 * Tenggat pemenuhan untuk satu jenis permintaan.
 *
 * **Disimpan pada baris, bukan dihitung setiap kali dibaca.** Tenggat adalah
 * janji yang dibuat pada saat permintaan diterima. Bila ia dihitung ulang saat
 * dibaca, mengubah angka di sini akan mengubah tenggat permintaan yang sudah
 * lampau — dan sebuah janji yang bergerak mengikuti kode tidak dapat dipakai
 * untuk menilai apakah janji itu ditepati.
 *
 * Penghapusan sengaja tidak memakai 3×24 jam. Pasal 43–44 membatasinya pada
 * kewajiban retensi: yang boleh dihapus hanya data yang tidak wajib disimpan,
 * dan menilai itu butuh waktu. Tenggatnya karena itu adalah tinjauan retensi,
 * bukan hitungan jam.
 */
export function computeDueAt(type: DataSubjectRequestType, now: Date = new Date()): Date {
  if (type === 'ERASURE') {
    return new Date(
      now.getTime() + DATA_SUBJECT_REQUEST_ERASURE_DEFAULT_DAYS * 24 * 60 * 60 * 1000
    );
  }
  return new Date(now.getTime() + DATA_SUBJECT_REQUEST_DUE_HOURS * 60 * 60 * 1000);
}

/**
 * Nomor permintaan yang dapat didiktekan lewat telepon: `DSR-2026-0001`.
 *
 * Dihitung dari jumlah baris tahun berjalan, bukan dari urutan basis data.
 * Perlombaan antara dua permintaan pada detik yang sama diselesaikan oleh
 * batasan unik `request_no`: yang kalah menerima P2002 dan pengajuan itu gagal
 * dengan 500 — pemohon mengulang dari awal. (Belum ada retry di sisi peladen.)
 */
async function nextRequestNo(now: Date): Promise<string> {
  const year = now.getFullYear();
  const prefix = `DSR-${year}-`;
  const count = await prisma.dataSubjectRequest.count({
    where: { requestNo: { startsWith: prefix } },
  });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
}

function hashVerificationCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * Bandingkan kode verifikasi tanpa membocorkan waktu.
 *
 * `===` pada string berhenti pada karakter pertama yang berbeda, jadi lama
 * jawabannya menceritakan berapa digit awal yang sudah benar. Perbedaannya
 * mikroskopis lewat jaringan, tetapi ini bukan tempat untuk menghemat.
 */
function codeMatches(provided: string, expectedHash: string): boolean {
  const providedHash = Buffer.from(hashVerificationCode(provided), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (providedHash.length !== expected.length) return false;
  return crypto.timingSafeEqual(providedHash, expected);
}

/**
 * Sisakan yang cukup untuk dikenali pemiliknya, bukan untuk ditebak orang lain.
 *
 * Telepon: empat angka terakhir saja — itu yang membuat pemiliknya yakin
 * pesannya sampai ke nomor yang benar. Surel: satu huruf awal dan domainnya,
 * karena domain itulah yang memberitahu apakah kodenya menuju kotak yang
 * memang dipakai keluarga; bagian lokalnya justru yang mengidentifikasi orang.
 *
 * **Yang disamarkan bukan hiasan.** Jawaban endpoint publik memuatnya, dan
 * pemohon di formulir itu belum terbukti siapa — nomor pendaftaran dan tanggal
 * lahir sudah ia pegang, tetapi kontak orang tua bukan miliknya untuk dibaca.
 */
export function maskContact(contact: string): string {
  const trimmed = contact.trim();
  const at = trimmed.indexOf('@');
  if (at > 0) {
    const local = trimmed.slice(0, at);
    const domain = trimmed.slice(at);
    return `${local.slice(0, 1)}${'•'.repeat(Math.max(1, local.length - 1))}${domain}`;
  }
  if (trimmed.length <= 4) return '••••';
  return `${'•'.repeat(trimmed.length - 4)}${trimmed.slice(-4)}`;
}

function readActions(row: { actions: Prisma.JsonValue }): DataSubjectRequestAction[] {
  const raw = row.actions;
  if (!Array.isArray(raw)) return [];
  return raw as unknown as DataSubjectRequestAction[];
}

function toDTO(row: DsrWithRelations, now: Date = new Date()): DataSubjectRequestDTO {
  const overdue = !isClosed(row.status) && row.dueAt < now;
  return {
    id: row.id,
    requestNo: row.requestNo,
    type: row.type,
    status: row.status,
    subjectCategory: row.subjectCategory,
    subjectLabel: row.subjectLabel,
    requesterName: row.requesterName,
    requesterContact: row.requesterContact,
    requesterRelation: row.requesterRelation,
    detail: row.detail,
    rejectionReason: row.rejectionReason,
    dueAt: row.dueAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    overdue,
    handledBy: row.handledBy ? { id: row.handledBy.id, name: row.handledBy.name } : null,
    actions: readActions(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSummaryDTO(row: DsrWithRelations, now: Date = new Date()): DataSubjectRequestSummaryDTO {
  const overdue = !isClosed(row.status) && row.dueAt < now;
  return {
    id: row.id,
    requestNo: row.requestNo,
    type: row.type,
    status: row.status,
    subjectCategory: row.subjectCategory,
    subjectLabel: row.subjectLabel,
    requesterName: row.requesterName,
    rejectionReason: row.rejectionReason ?? null,
    dueAt: row.dueAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    overdue,
    handledBy: row.handledBy ? { id: row.handledBy.id, name: row.handledBy.name } : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Satu tindakan pembuka, supaya setiap permintaan punya riwayat sejak lahir. */
function openingAction(
  actorName: string,
  actorId: string | null,
  at: Date
): DataSubjectRequestAction {
  return { at: at.toISOString(), byId: actorId, byName: actorName, from: null, to: 'RECEIVED' };
}

/**
 * Apakah aktor berhak mengajukan permintaan atas nama santri ini.
 *
 * Wali lewat tautan `StudentParent` (yang sama dengan yang dipakai portal wali
 * untuk membuka profil anaknya), dan petugas pelindungan data lewat izinnya —
 * petugas menerima permintaan lisan dan mencatatkannya, dan itu memang
 * pekerjaannya. Santri yang sudah dewasa mewakili dirinya sendiri lewat
 * `subjectCategory = GUARDIAN` dengan id penggunanya sendiri.
 */
async function assertCanActForStudent(
  actorUserId: string,
  studentId: string,
  hasPdpPermission: boolean
): Promise<{ studentId: string; nis: string; userId: string; name: string }> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, nis: true, userId: true, user: { select: { name: true } } },
  });
  if (!student) throw Errors.notFound('Santri');

  if (!hasPdpPermission) {
    const link = await prisma.studentParent.findUnique({
      where: { studentId_parentId: { studentId, parentId: actorUserId } },
      select: { id: true },
    });
    if (!link) {
      throw Errors.forbidden('Anda tidak memiliki akses ke data santri ini');
    }
  }

  return {
    studentId: student.id,
    nis: student.nis,
    userId: student.userId,
    name: student.user.name,
  };
}

/**
 * Nama petugas untuk riwayat tindakan.
 *
 * Dibaca di layanan, bukan di controller: controller hanya membawa identitas
 * sesi, dan satu-satunya lapisan yang menyentuh Prisma adalah layanan
 * (`apps/api/AGENTS.md`). Nama adalah bagian dari bukti tindakan, jadi ia tetap
 * tercatat meskipun penggunanya sudah tidak ada — karena itu ada pengganti yang
 * dapat dibaca, bukan string kosong.
 */
export async function resolveActorName(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return user?.name ?? 'Petugas';
}

/**
 * Ajukan permintaan sebagai pemohon yang sudah punya akun (wali atau santri).
 *
 * Tenggat dihitung di sini, sekali, dan disimpan. Yang mengubahnya nanti hanya
 * keputusan petugas — bukan pembacaan berikutnya.
 */
export async function submitGuardianRequest(
  input: CreateGuardianDataSubjectRequestInput,
  actor: { userId: string; name: string; hasPdpPermission: boolean }
): Promise<DataSubjectRequestDTO> {
  const now = new Date();
  const dueAt = computeDueAt(input.type, now);

  let subjectStudentId: string | null = null;
  let subjectRegistrantId: string | null = null;
  let subjectUserId: string | null = null;
  let subjectLabel: string;

  if (input.subjectCategory === 'STUDENT') {
    if (!input.subjectStudentId) {
      throw Errors.validation('Santri yang dimintakan wajib dipilih', [
        { field: 'subjectStudentId', message: 'Santri yang dimintakan wajib dipilih' },
      ]);
    }
    const student = await assertCanActForStudent(
      actor.userId,
      input.subjectStudentId,
      actor.hasPdpPermission
    );
    subjectStudentId = student.studentId;
    subjectLabel = `${student.name} (NIS ${student.nis})`;
  } else if (input.subjectCategory === 'REGISTRANT') {
    throw Errors.validation('Permintaan atas data pendaftaran diajukan lewat formulir publik', [
      {
        field: 'subjectCategory',
        message: 'Permintaan atas data pendaftaran diajukan lewat formulir publik',
      },
    ]);
  } else {
    subjectUserId = actor.userId;
    const me = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true, email: true },
    });
    if (!me) throw Errors.notFound('Pengguna');
    subjectLabel = `${me.name} (${me.email})`;
  }

  const created = await prisma.$transaction(async (tx) => {
    const requestNo = await nextRequestNo(now);
    return tx.dataSubjectRequest.create({
      data: {
        requestNo,
        type: input.type,
        subjectCategory: input.subjectCategory,
        subjectStudentId,
        subjectRegistrantId,
        subjectUserId,
        subjectLabel,
        requesterUserId: actor.userId,
        requesterName: actor.name,
        requesterContact: 'akun portal',
        requesterRelation: input.requesterRelation ?? null,
        detail: input.detail,
        dueAt,
        actions: [openingAction(actor.name, actor.userId, now)] as unknown as Prisma.InputJsonValue,
      },
      include: DSR_INCLUDE,
    });
  });

  await notifyRequester(created, 'Permintaan Anda tercatat');
  return toDTO(created, now);
}

/**
 * Ajukan permintaan lewat formulir publik (pendaftar SPMB tanpa akun).
 *
 * **Data subjek tidak diungkap pada langkah ini, dan itu disengaja.** Pemohon
 * membuktikan dua hal yang hanya diketahui keluarga pendaftar: nomor
 * pendaftaran dan tanggal lahir anak. Keduanya mudah bocor — nomor pendaftaran
 * tercetak di kartu, tanggal lahir ada di banyak berkas. Karena itu jawabannya
 * hanya nomor permintaan dan ke mana kode dikirim; data baru dibuka setelah
 * kode itu benar-benar tiba di kontak yang sudah terdaftar (Pasal 33: identitas
 * yang tidak dapat dipastikan harus ditolak).
 *
 * Kode dikirim ke kontak TERDAFTAR, bukan ke kontak yang dituliskan pemohon.
 * Mengirim ke kontak yang dituliskan pemohon akan menyerahkan verifikasi
 * kepada orang yang justru sedang diverifikasi.
 */
export async function submitPublicRequest(
  input: CreatePublicDataSubjectRequestInput
): Promise<PublicDataSubjectRequestCreatedDTO> {
  const now = new Date();

  const registrant = await prisma.registrant.findUnique({
    where: { registrationNo: input.registrationNo },
    select: {
      id: true,
      fullName: true,
      name: true,
      birthDate: true,
      phone: true,
      email: true,
      parentPhone: true,
      parentEmail: true,
    },
  });

  // Galat yang sama untuk "nomor tidak ada" dan "tanggal lahir salah". Membedakan
  // keduanya akan menjadikan endpoint ini alat untuk memeriksa apakah sebuah
  // nomor pendaftaran benar-benar ada — tanpa perlu memegang datanya.
  const notFound = Errors.validation('Data pendaftaran tidak cocok', [
    { field: 'registrationNo', message: 'Nomor pendaftaran dan tanggal lahir tidak cocok' },
  ]);
  if (!registrant) throw notFound;

  const sameDay =
    registrant.birthDate.toISOString().slice(0, 10) === input.birthDate.toISOString().slice(0, 10);
  if (!sameDay) throw notFound;

  const contact =
    registrant.parentPhone || registrant.phone || registrant.parentEmail || registrant.email;
  if (!contact) {
    // Tanpa kontak terdaftar tidak ada kanal untuk membuktikan identitas, dan
    // permintaan tanpa verifikasi tidak boleh dibuka. Petugas menanganinya
    // secara luring; jawabannya tetap menjelaskan jalannya, bukan menggantung.
    throw Errors.validation(
      'Tidak ada kontak terdaftar untuk verifikasi. Silakan hubungi petugas pelindungan data pribadi.',
      [{ field: 'registrationNo', message: 'Kontak terdaftar tidak tersedia' }]
    );
  }

  const code = String(crypto.randomInt(0, 10 ** DATA_SUBJECT_VERIFICATION_CODE_LENGTH)).padStart(
    DATA_SUBJECT_VERIFICATION_CODE_LENGTH,
    '0'
  );
  const dueAt = computeDueAt(input.type, now);
  const subjectLabel = `${registrant.fullName || registrant.name} (No. ${input.registrationNo})`;

  const created = await prisma.$transaction(async (tx) => {
    const requestNo = await nextRequestNo(now);
    return tx.dataSubjectRequest.create({
      data: {
        requestNo,
        type: input.type,
        subjectCategory: 'REGISTRANT',
        subjectRegistrantId: registrant.id,
        subjectLabel,
        requesterName: input.requesterName,
        requesterContact: input.requesterContact,
        requesterRelation: input.requesterRelation ?? null,
        detail: input.detail,
        dueAt,
        verificationCodeHash: hashVerificationCode(code),
        verificationExpiresAt: new Date(
          now.getTime() + DATA_SUBJECT_VERIFICATION_TTL_MINUTES * 60 * 1000
        ),
        actions: [
          openingAction(input.requesterName, null, now),
        ] as unknown as Prisma.InputJsonValue,
      },
      select: { requestNo: true, dueAt: true },
    });
  });

  const delivered = await sendVerificationCode(contact, code, created.requestNo);
  if (!delivered) {
    // Baris yang dibuat dibuang kembali: permintaan tanpa kode yang terkirim
    // adalah permintaan yang tidak dapat diverifikasi siapa pun, dan
    // membiarkannya berarti keluarga melihat "kode terkirim" sementara tidak
    // ada kode yang pernah tiba. Pemohon mengulang dari awal, dengan kontak
    // terdaftar yang benar-benar dapat dijangkau.
    await prisma.dataSubjectRequest.deleteMany({ where: { requestNo: created.requestNo } });
    throw Errors.validation(
      'Kode verifikasi tidak dapat dikirim ke kontak yang terdaftar pada data pendaftaran. ' +
        'Coba lagi sebentar lagi, atau hubungi panitia SPMB untuk memperbarui kontaknya.'
    );
  }

  return {
    requestNo: created.requestNo,
    dueAt: created.dueAt.toISOString(),
    verificationSentTo: maskContact(contact),
  };
}

/**
 * Verifikasi kode permintaan publik.
 *
 * Percobaan dibatasi dan dihitung pada baris: tanpa batas, enam angka dapat
 * ditebak dengan mencoba terus, dan verifikasi yang dapat ditebak sama saja
 * dengan tidak ada verifikasi — justru ia yang membuka data anak orang lain.
 *
 * **Hitungannya naik secara atomik, di dalam transaksi, di bawah kunci baris.**
 * Menghitung dari nilai yang dibaca sebelum transaksi membuat percobaan yang
 * berjalan bersamaan sama-sama melihat angka lama dan menulis angka yang sama:
 * lima percobaan menjadi lima kali lebih banyak, dan batasnya hanya berlaku
 * bagi penyerang yang mencoba satu per satu. `FOR UPDATE` menyerialkan
 * pembacaan dan penulisan, sehingga setiap percobaan benar-benar menambah satu.
 *
 * **Galatnya dilempar SETELAH transaksi dikukuhkan, bukan dari dalamnya.**
 * `throw` di dalam `$transaction` membatalkan seluruh transaksi — termasuk
 * kenaikan `verificationAttempts` yang baru saja ditulis untuk percobaan yang
 * gagal. Akibatnya batas lima percobaan tidak pernah tersimpan, dan penyerang
 * dapat menebak kode selama masa berlakunya. Karena itu transaksinya
 * mengembalikan penanda hasil, dan galatnya dilempar setelah commit.
 */
export async function verifyPublicRequest(
  input: VerifyPublicDataSubjectRequestInput
): Promise<PublicDataSubjectRequestVerifiedDTO> {
  const now = new Date();

  const invalid = Errors.validation('Kode verifikasi tidak berlaku', [
    { field: 'code', message: 'Kode verifikasi salah atau sudah kedaluwarsa' },
  ]);

  const outcome = await prisma.$transaction(
    async (
      tx
    ): Promise<
      | { kind: 'invalid' }
      | { kind: 'forbidden' }
      | { kind: 'ok'; value: PublicDataSubjectRequestVerifiedDTO }
    > => {
      // Kunci barisnya lebih dulu: `$executeRaw` karena kunci mengembalikan
      // `void`, yang tidak dapat dideserialkan `$queryRaw`.
      await tx.$executeRaw`SELECT id FROM data_subject_requests WHERE request_no = ${input.requestNo} FOR UPDATE`;

      const row = await tx.dataSubjectRequest.findUnique({
        where: { requestNo: input.requestNo },
        select: {
          id: true,
          requestNo: true,
          status: true,
          dueAt: true,
          type: true,
          verificationCodeHash: true,
          verificationExpiresAt: true,
          verificationAttempts: true,
          actions: true,
        },
      });

      if (!row || !row.verificationCodeHash) return { kind: 'invalid' };
      if (row.status !== 'RECEIVED') return { kind: 'invalid' };
      if (!row.verificationExpiresAt || row.verificationExpiresAt < now) return { kind: 'invalid' };
      if (row.verificationAttempts >= DATA_SUBJECT_VERIFICATION_MAX_ATTEMPTS) {
        return { kind: 'forbidden' };
      }

      const attempts = row.verificationAttempts + 1;
      const ok = codeMatches(input.code, row.verificationCodeHash);

      if (!ok) {
        await tx.dataSubjectRequest.update({
          where: { id: row.id },
          data: { verificationAttempts: attempts },
        });
        return { kind: 'invalid' };
      }

      const actions = readActions(row as { actions: Prisma.JsonValue });
      actions.push({
        at: now.toISOString(),
        byId: null,
        byName: 'Pemohon (verifikasi mandiri)',
        from: 'RECEIVED',
        to: 'VERIFIED',
      });

      const updated = await tx.dataSubjectRequest.update({
        where: { id: row.id },
        data: {
          status: 'VERIFIED',
          verifiedAt: now,
          verificationAttempts: attempts,
          // Kode dibuang setelah dipakai. Ia tidak punya kegunaan kedua, dan
          // hash yang tertinggal hanya menambah satu rahasia untuk dijaga.
          verificationCodeHash: null,
          verificationExpiresAt: null,
          actions: actions as unknown as Prisma.InputJsonValue,
        },
        select: { requestNo: true, status: true, dueAt: true },
      });

      return {
        kind: 'ok',
        value: {
          requestNo: updated.requestNo,
          status: updated.status,
          dueAt: updated.dueAt.toISOString(),
        },
      };
    }
  );

  if (outcome.kind === 'invalid') throw invalid;
  if (outcome.kind === 'forbidden') {
    throw Errors.forbidden(
      'Batas percobaan verifikasi tercapai. Hubungi petugas pelindungan data pribadi.'
    );
  }
  return outcome.value;
}

/** Daftar untuk petugas pelindungan data pribadi. */
export async function listRequests(query: ListDataSubjectRequestsQuery): Promise<{
  data: DataSubjectRequestSummaryDTO[];
  total: number;
}> {
  const now = new Date();
  const where: Prisma.DataSubjectRequestWhereInput = {};
  // Penyaring saling MEMBATASI (AND), bukan saling menggantikan. Sebelumnya
  // `openOnly` menimpa `status` yang dipilih petugas, sehingga memilih
  // "Diterima" tetap menampilkan "Diproses" — dan memilih "Selesai" malah
  // menampilkan permintaan terbuka.
  if (query.type) where.type = query.type;
  if (query.subjectCategory) where.subjectCategory = query.subjectCategory;

  // Status: penyaring yang dipilih petugaslah yang berlaku. "Hanya yang belum
  // selesai" dan "terlambat" hanya MEMBATASI pilihannya — memilih status
  // terminal bersamanya berarti irisannya kosong, bukan daftar yang membantah
  // penyaringnya.
  if (query.status) {
    where.status = query.openOnly && isClosed(query.status) ? { in: [] } : query.status;
  } else if (query.openOnly || query.overdueOnly) {
    // Tanpa status yang dipilih, kedua penyaring itu menyiratkan "belum
    // selesai": permintaan yang sudah ditutup bukan lagi pekerjaan yang
    // menunggu, dan yang terlambat pun hanya bermakna selama masih terbuka.
    where.status = { notIn: [...CLOSED_STATUSES] };
  }

  if (query.overdueOnly) {
    where.dueAt = { lt: now };
  }

  const [rows, total] = await Promise.all([
    prisma.dataSubjectRequest.findMany({
      where,
      include: DSR_INCLUDE,
      // Yang belum selesai lebih dulu — itu daftar kerja — lalu tenggat
      // terdekat, sebab tenggat yang paling dekat adalah yang paling mendesak.
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.dataSubjectRequest.count({ where }),
  ]);

  return { data: rows.map((r) => toSummaryDTO(r, now)), total };
}

/** Satu permintaan lengkap dengan riwayat tindakannya. */
export async function getRequest(id: string): Promise<DataSubjectRequestDTO> {
  const row = await prisma.dataSubjectRequest.findUnique({ where: { id }, include: DSR_INCLUDE });
  if (!row) throw Errors.notFound('Permintaan');
  return toDTO(row);
}

/** Permintaan yang diajukan oleh pemohon yang sedang masuk. */
export async function listMyRequests(userId: string): Promise<DataSubjectRequestSummaryDTO[]> {
  const now = new Date();
  const rows = await prisma.dataSubjectRequest.findMany({
    where: { requesterUserId: userId },
    include: DSR_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map((r) => toSummaryDTO(r, now));
}

/**
 * Pindahkan status permintaan dan catat tindakannya.
 *
 * `REJECTED` wajib beralasan (Pasal 33) dan `COMPLETED` menutup alur. Yang
 * dijalankan saat menutup bergantung jenisnya: penarikan persetujuan benar-benar
 * menghentikan pemrosesan, penghapusan benar-benar menghapus apa yang boleh
 * dihapus, dan akses menghasilkan salinan data yang diserahkan ke pemohon.
 *
 * **Dua penjaga yang tidak boleh hilang.**
 *
 * 1. *Permintaan publik harus terverifikasi lebih dahulu.* Efek samping
 *    menutup — menghapus identitas, menyerahkan salinan data — tidak boleh
 *    berjalan atas permintaan yang kepemilikan kontaknya belum terbukti.
 *    Pemeriksaan status terminal saja tidak menutup itu: `RECEIVED` bukan
 *    status terminal, jadi permintaan anonim dapat dieksekusi. `verifiedAt`
 *    yang menjadi syaratnya (Pasal 33).
 * 2. *Barisnya dikunci dan dibaca ulang di dalam transaksi.* Membaca status dan
 *    riwayat sebelum transaksi membuat dua petugas yang menutup bersamaan
 *    sama-sama melihat `PROCESSING`, lalu masing-masing menulis array
 *    penggantinya: penutupan yang sudah berhasil tertimpa, atau riwayat
 *    tindakan pertama hilang. `FOR UPDATE` menyerialkan keduanya, sehingga yang
 *    kedua melihat status yang sudah berubah dan ditolak sebagai konflik.
 */
export async function updateStatus(
  id: string,
  input: UpdateDataSubjectRequestStatusInput,
  actor: { userId: string; name: string }
): Promise<{ request: DataSubjectRequestDTO; exportPayload?: unknown }> {
  const now = new Date();
  let exportPayload: unknown;

  const { updated, filesToDelete } = await prisma.$transaction(async (tx) => {
    // Kunci barisnya lebih dulu. `$executeRaw` (bukan `$queryRaw`): kunci
    // mengembalikan `void`, yang tidak dapat dideserialkan `$queryRaw`.
    await tx.$executeRaw`SELECT id FROM data_subject_requests WHERE id = ${id} FOR UPDATE`;

    const existing = await tx.dataSubjectRequest.findUnique({
      where: { id },
      include: DSR_INCLUDE,
    });
    if (!existing) throw Errors.notFound('Permintaan');

    if (isClosed(existing.status)) {
      throw Errors.conflict('Permintaan ini sudah selesai dan tidak dapat diubah lagi');
    }

    // Permintaan publik belum membuktikan siapa pemohonnya sampai kode yang
    // dikirim ke kontak terdaftar diverifikasi.
    if (!existing.requesterUserId && !existing.verifiedAt && input.status === 'COMPLETED') {
      throw Errors.conflict(
        'Permintaan publik harus diverifikasi lebih dahulu sebelum dapat diselesaikan'
      );
    }

    const actions = readActions(existing);
    actions.push({
      at: now.toISOString(),
      byId: actor.userId,
      byName: actor.name,
      from: existing.status,
      to: input.status,
      note: input.note,
    });

    let erasedFiles: string[] = [];
    if (input.status === 'COMPLETED') {
      if (existing.type === 'CONSENT_WITHDRAWAL') {
        await withdrawConsent(tx, existing, now);
      }
      if (existing.type === 'ERASURE') {
        erasedFiles = await executeErasure(tx, existing, actor, now);
      }
      if (existing.type === 'ACCESS') {
        exportPayload = await buildSubjectDataExport(existing);
      }
    }

    const row = await tx.dataSubjectRequest.update({
      where: { id },
      data: {
        status: input.status,
        rejectionReason: input.status === 'REJECTED' ? (input.note ?? null) : null,
        completedAt: isClosed(input.status) ? now : null,
        handledById: input.handledById ?? existing.handledById ?? actor.userId,
        actions: actions as unknown as Prisma.InputJsonValue,
      },
      include: DSR_INCLUDE,
    });

    return { updated: row, filesToDelete: erasedFiles };
  });

  // Berkas dihapus SETELAH transaksi dikukuhkan: menghapus berkas tidak dapat
  // dibatalkan, jadi ia tidak boleh berjalan di dalam transaksi yang mungkin
  // gagal dan meninggalkan baris yang masih menunjuk berkas yang sudah lenyap.
  if (filesToDelete.length) {
    await deleteStoredFiles(filesToDelete, updated.requestNo);
  }

  const statusLabel = DATA_SUBJECT_REQUEST_STATUS_LABELS[input.status] ?? input.status;
  await notifyRequester(
    updated,
    `Permintaan ${updated.requestNo} kini ${statusLabel}`,
    input.status === 'REJECTED' ? (input.note ?? null) : null
  );
  return { request: toDTO(updated, now), exportPayload };
}

/**
 * Hentikan pemrosesan atas dasar persetujuan (Pasal 40 ayat 2).
 *
 * Yang ditulis adalah `consentWithdrawnAt`; `consentAt` dan `consentVersion`
 * TIDAK disentuh. Pasal 21 menuntut kemampuan menunjukkan bahwa persetujuan
 * pernah ada dan sah, jadi menghapus buktinya justru menghapus kemampuan
 * membuktikan bahwa pemrosesan sebelumnya memiliki dasar. Yang berubah hanya
 * hak memproses ke depan.
 */
async function withdrawConsent(
  tx: Prisma.TransactionClient,
  request: DsrWithRelations,
  now: Date
): Promise<void> {
  if (request.subjectRegistrantId) {
    await tx.registrant.update({
      where: { id: request.subjectRegistrantId },
      data: { consentWithdrawnAt: now },
    });
    return;
  }

  // Subjek santri: penarikan berlaku atas pendaftaran yang menghantarnya masuk.
  // Pendaftaran itu yang memegang persetujuannya, bukan baris santri.
  if (request.subjectStudentId) {
    await tx.registrant.updateMany({
      where: { studentId: request.subjectStudentId, consentWithdrawnAt: null },
      data: { consentWithdrawnAt: now },
    });
  }
}

/**
 * Jalankan penghapusan (Pasal 43–44), sejauh yang boleh dihapus.
 *
 * **Yang dihapus adalah penanda langsung, bukan barisnya.** Baris santri,
 * pendaftaran, dan pengguna dipertahankan karena catatan akademik dan
 * keuangan yang menunjuk padanya masih diwajibkan retensi — dan karena
 * menghapus barisnya akan menghapus riwayat nilai, pembayaran, dan kehadiran
 * yang bukan milik pemohon untuk diputuskan. Yang hilang adalah kemampuan
 * menghubungkan baris itu dengan orangnya: nama, alamat, kontak, foto, NISN,
 * **NIK/KK/akta, dan identitas ayah, ibu, serta wali** — semuanya kolom
 * terpisah pada `Student`, sehingga mengosongkan nama saja meninggalkan orang
 * yang masih dapat dikenali lewat nomor identitasnya.
 *
 * **Berkasnya ikut dihapus, bukan hanya URL-nya.** Mengosongkan `photoUrl` atau
 * `fileUrl` menghentikan penunjuknya, tetapi berkasnya tetap ada di
 * `public/uploads` — dan `/uploads` menyajikannya kepada setiap akun yang sudah
 * masuk (`uploadsAuth` adalah autentikasi, bukan otorisasi). Siapa pun yang
 * menyimpan URL lama masih dapat mengambilnya. Karena itu jalur berkasnya
 * dikembalikan ke pemanggil untuk dihapus setelah transaksi ini dikukuhkan:
 * penghapusan berkas tidak dapat dibatalkan, jadi ia tidak boleh berjalan di
 * dalam transaksi yang mungkin gagal.
 *
 * Batas ini dicatat pada tindakan, dengan kata-kata, supaya keputusan itu
 * dapat diperiksa — bukan tersembunyi sebagai perilaku yang kebetulan.
 *
 * @returns URL berkas yang harus dihapus dari penyimpanan setelah commit.
 */
async function executeErasure(
  tx: Prisma.TransactionClient,
  request: DsrWithRelations,
  actor: { userId: string; name: string },
  now: Date
): Promise<string[]> {
  const marker = `Data dihapus (UU PDP, ${request.requestNo})`;
  const erased: string[] = [];
  const retained: string[] = [];
  const filesToDelete: string[] = [];

  if (request.subjectStudentId) {
    const student = await tx.student.findUnique({
      where: { id: request.subjectStudentId },
      select: { id: true, userId: true, photoUrl: true },
    });
    if (student) {
      if (student.photoUrl) filesToDelete.push(student.photoUrl);
      await tx.student.update({
        where: { id: student.id },
        data: {
          address: marker,
          parentName: marker,
          parentPhone: marker,
          parentEmail: null,
          birthPlace: marker,
          photoUrl: null,
          // NISN unik nasional dan tidak dapat dipertahankan sebagai penanda:
          // dua penghapusan akan bertabrakan. NIS dipertahankan karena rapor
          // dan buku induk menunjuknya, dan ia hanya unik per unit.
          nisn: null,
          // Nomor identitas: NIK, KK, akta. Masing-masing kolom tersendiri, dan
          // masing-masing cukup untuk mengenali anaknya kembali.
          nik: null,
          noKK: null,
          noAkta: null,
          // Identitas ayah, ibu, dan wali — nama maupun nomor identitasnya.
          fatherName: null,
          fatherNik: null,
          fatherBirthPlace: null,
          fatherBirthDate: null,
          fatherPhone: null,
          motherName: null,
          motherNik: null,
          motherBirthPlace: null,
          motherBirthDate: null,
          motherPhone: null,
          guardianName: null,
          guardianNik: null,
          guardianRelation: null,
          guardianPhone: null,
          // Alamat rinci dan data kesejahteraan yang menunjuk rumah tangganya.
          rt: null,
          rw: null,
          postalCode: null,
          kipNumber: null,
          specialNeeds: null,
          livingWith: null,
        },
      });
      await tx.user.update({
        where: { id: student.userId },
        data: {
          name: marker,
          email: `dihapus-${student.userId}@invalid.local`,
          phone: null,
          passwordHash: null,
          fcmToken: null,
          isActive: false,
          deletedAt: now,
        },
      });
      erased.push(
        'identitas santri',
        'NIK',
        'nomor KK',
        'nomor akta',
        'identitas ayah',
        'identitas ibu',
        'identitas wali',
        'alamat',
        'identitas akun',
        'foto',
        'NISN'
      );
      retained.push('NIS', 'nilai', 'kehadiran', 'keuangan', 'riwayat unit');
    }
  }

  if (request.subjectRegistrantId) {
    await tx.registrant.update({
      where: { id: request.subjectRegistrantId },
      data: {
        fullName: marker,
        name: marker,
        address: marker,
        phone: null,
        email: null,
        parentName: marker,
        parentPhone: marker,
        parentEmail: null,
        parentOccupation: null,
        birthPlace: marker,
        notes: null,
      },
    });
    // Berkas identitas pendaftar (KTP/KK/akta) tidak punya kegunaan setelah
    // pendaftarannya tidak lagi dihubungkan dengan orangnya. Berkasnya
    // dihapus dari penyimpanan; barisnya dipertahankan tanpa `fileUrl` supaya
    // riwayat unggahan tetap terbaca.
    const documents = await tx.registrantDocument.findMany({
      where: { registrantId: request.subjectRegistrantId },
      select: { fileUrl: true },
    });
    for (const doc of documents) {
      if (doc.fileUrl) filesToDelete.push(doc.fileUrl);
    }
    await tx.registrantDocument.updateMany({
      where: { registrantId: request.subjectRegistrantId },
      data: { fileUrl: null, notes: null },
    });
    erased.push('identitas pendaftar', 'berkas identitas');
    retained.push('nomor pendaftaran', 'status seleksi', 'keuangan');
  }

  if (request.subjectUserId) {
    await tx.user.update({
      where: { id: request.subjectUserId },
      data: {
        name: marker,
        email: `dihapus-${request.subjectUserId}@invalid.local`,
        phone: null,
        passwordHash: null,
        fcmToken: null,
        isActive: false,
        deletedAt: now,
      },
    });
    erased.push('identitas akun');
  }

  // Label subjek pada baris ini ikut kehilangan data pribadinya — kalau tidak,
  // nama yang baru saja dihapus tetap terbaca di daftar petugas.
  await tx.dataSubjectRequest.update({
    where: { id: request.id },
    data: { subjectLabel: `Subjek dihapus (${request.requestNo})` },
  });

  await tx.auditLog.create({
    data: {
      userId: actor.userId,
      action: 'ERASURE',
      entity: 'DataSubjectRequest',
      entityId: request.id,
      newValues: {
        erased,
        retained,
        filesDeleted: filesToDelete.length,
        executedAt: now.toISOString(),
      } as Prisma.InputJsonValue,
    },
  });

  logger.info('[PDP] Permintaan penghapusan dijalankan', {
    requestNo: request.requestNo,
    erased,
    retained,
    filesToDelete: filesToDelete.length,
    byUserId: actor.userId,
  });

  return filesToDelete;
}

/**
 * Hapus berkas unggahan yang ditunjuk sebuah URL, setelah transaksinya
 * dikukuhkan.
 *
 * Hanya jalur di dalam direktori unggahan yang pernah disentuh
 * (`uploadPathFromUrl` menolak yang lain), dan kegagalannya dicatat tanpa
 * membatalkan penghapusan yang sudah tercatat: barisnya sudah tidak menunjuk
 * berkasnya lagi, dan berkas yatim yang tersisa adalah temuan yang harus
 * terlihat, bukan galat yang harus menyembunyikan keberhasilan penghapusan.
 *
 * **Sebuah berkas hanya dihapus bila tidak ada baris LAIN yang masih
 * menunjuknya (CWE-639).** `RegistrantDocument.fileUrl` menerima URL pilihan
 * pendaftar lewat unggahan publik, dan `uploadPathFromUrl` hanya memeriksa
 * bentuk jalur — bukan pemiliknya. Tanpa pemeriksaan ini, seorang penyerang
 * dapat menempelkan URL unggahan orang lain pada dokumennya sendiri, lalu
 * meminta penghapusan: petugas yang menyelesaikannya akan menghapus berkas
 * korban. Karena transaksi di atas sudah mengosongkan penunjuk milik subjek
 * yang dihapus, keberadaan penunjuk lain setelah commit berarti berkas itu
 * bukan (hanya) miliknya — dan penghapusan dilewati.
 */
async function uploadStillReferenced(url: string): Promise<boolean> {
  for (const { model, field } of urlColumns()) {
    // Nama delegasi Prisma = nama model dengan huruf pertama kecil.
    const delegate = model.charAt(0).toLowerCase() + model.slice(1);
    const client = (
      prisma as unknown as Record<string, { count?: (args: unknown) => Promise<number> }>
    )[delegate];
    // Model tanpa `count` (tidak mungkin pada klien yang tergenerasi) dilewati,
    // bukan dianggap "tidak menunjuk": satu galat tak terduga di sini berarti
    // berkas yang tidak boleh hilang ikut terhapus.
    if (typeof client?.count !== 'function') continue;
    const count = await client.count({ where: { [field]: url } });
    if (count > 0) return true;
  }
  return false;
}

/**
 * Setiap kolom String bernama `…Url` pada skema, dari katalog Prisma (DMMF).
 *
 * Ditemukan dari skema, bukan dari daftar yang ditulis tangan: daftar tangan
 * akan ketinggalan setiap kali sebuah model baru menambah kolom URL — dan
 * justru pada kolom yang terlupa itulah berkas orang lain menempel.
 */
function urlColumns(): Array<{ model: string; field: string }> {
  return Prisma.dmmf.datamodel.models.flatMap((model) =>
    model.fields
      .filter(
        (field) => field.kind === 'scalar' && field.type === 'String' && /Url$/.test(field.name)
      )
      .map((field) => ({ model: model.name, field: field.name }))
  );
}

async function deleteStoredFiles(fileUrls: string[], requestNo: string): Promise<void> {
  for (const url of fileUrls) {
    const filePath = uploadPathFromUrl(url);
    if (!filePath) continue;
    try {
      if (await uploadStillReferenced(url)) {
        logger.warn('[PDP] Berkas masih ditunjuk baris lain; penghapusan dilewati', {
          requestNo,
        });
        continue;
      }
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      logger.warn('[PDP] Berkas identitas gagal dihapus dari penyimpanan', {
        requestNo,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Salinan data subjek untuk permintaan akses (Pasal 30, 32).
 *
 * Dikembalikan ke petugas yang menutup permintaan, bukan disimpan. Menyimpan
 * ekspor berisi data pribadi akan membuat satu lagi tempat yang harus
 * dilindungi dan dihapus pada waktunya — dan salinan yang tersimpan selalu
 * lebih lama hidupnya daripada keperluannya.
 *
 * Isinya sengaja hanya apa yang dibaca pemohon: identitas, pendaftaran, dan
 * ringkasan akademik. Riwayat internal (catatan konseling, disiplin) tidak
 * dimasukkan di sini; bila pemohon memintanya, itu permintaan tersendiri yang
 * dinilai petugas.
 */
async function buildSubjectDataExport(request: DsrWithRelations): Promise<unknown> {
  const generatedAt = new Date().toISOString();

  if (request.subjectStudentId) {
    const student = await prisma.student.findUnique({
      where: { id: request.subjectStudentId },
      select: {
        nis: true,
        nisn: true,
        gender: true,
        birthPlace: true,
        birthDate: true,
        address: true,
        parentName: true,
        parentPhone: true,
        parentEmail: true,
        status: true,
        entryYear: true,
        graduateYear: true,
        user: { select: { name: true, email: true, phone: true } },
        unit: { select: { name: true } },
        parents: {
          select: { relation: true, parent: { select: { name: true, email: true } } },
        },
      },
    });
    return {
      type: request.type,
      requestNo: request.requestNo,
      generatedAt,
      subjectCategory: 'STUDENT',
      personalData: student
        ? {
            name: student.user.name,
            email: student.user.email,
            phone: student.user.phone,
            nis: student.nis,
            nisn: student.nisn,
            gender: student.gender,
            birthPlace: student.birthPlace,
            birthDate: student.birthDate.toISOString().slice(0, 10),
            address: student.address,
            parentName: student.parentName,
            parentPhone: student.parentPhone,
            parentEmail: student.parentEmail,
            status: student.status,
            entryYear: student.entryYear,
            graduateYear: student.graduateYear,
            unit: student.unit.name,
            guardians: student.parents.map((p) => ({
              relation: p.relation,
              name: p.parent.name,
              email: p.parent.email,
            })),
          }
        : null,
      processingBasis:
        'Persetujuan orang tua/wali (Pasal 20, 25) dan pelaksanaan kontrak pendidikan',
    };
  }

  if (request.subjectRegistrantId) {
    const registrant = await prisma.registrant.findUnique({
      where: { id: request.subjectRegistrantId },
      select: {
        registrationNo: true,
        fullName: true,
        gender: true,
        birthPlace: true,
        birthDate: true,
        address: true,
        phone: true,
        email: true,
        previousSchool: true,
        parentName: true,
        parentPhone: true,
        parentEmail: true,
        status: true,
        consentAt: true,
        consentVersion: true,
        consentWithdrawnAt: true,
        documents: { select: { name: true, type: true, isVerified: true } },
      },
    });
    return {
      type: request.type,
      requestNo: request.requestNo,
      generatedAt,
      subjectCategory: 'REGISTRANT',
      personalData: registrant
        ? {
            registrationNo: registrant.registrationNo,
            fullName: registrant.fullName,
            gender: registrant.gender,
            birthPlace: registrant.birthPlace,
            birthDate: registrant.birthDate.toISOString().slice(0, 10),
            address: registrant.address,
            phone: registrant.phone,
            email: registrant.email,
            previousSchool: registrant.previousSchool,
            parentName: registrant.parentName,
            parentPhone: registrant.parentPhone,
            parentEmail: registrant.parentEmail,
            status: registrant.status,
            documents: registrant.documents,
          }
        : null,
      consent: registrant
        ? {
            givenAt: registrant.consentAt?.toISOString() ?? null,
            policyVersion: registrant.consentVersion,
            withdrawnAt: registrant.consentWithdrawnAt?.toISOString() ?? null,
          }
        : null,
      processingBasis: 'Persetujuan orang tua/wali (Pasal 20, 25)',
    };
  }

  const user = request.subjectUserId
    ? await prisma.user.findUnique({
        where: { id: request.subjectUserId },
        select: { name: true, email: true, phone: true, createdAt: true },
      })
    : null;

  return {
    type: request.type,
    requestNo: request.requestNo,
    generatedAt,
    subjectCategory: 'GUARDIAN',
    personalData: user
      ? {
          name: user.name,
          email: user.email,
          phone: user.phone,
          accountCreatedAt: user.createdAt.toISOString(),
        }
      : null,
    processingBasis: 'Pelaksanaan kontrak layanan portal dan persetujuan',
  };
}

/**
 * Beri tahu pemohon bahwa statusnya berubah.
 *
 * Kanalnya dipilih dari bentuk kontaknya, bukan dari kolom terpisah yang bisa
 * melenceng: alamat surel dikirimi surel, nomor telepon dikirimi WhatsApp, dan
 * pemohon yang mengajukan lewat akun mendapat pemberitahuan di lonceng portal.
 * Kegagalan pengiriman dicatat dan tidak membatalkan perubahan statusnya —
 * statusnya fakta, pengirimannya usaha.
 */
async function notifyRequester(
  request: {
    requestNo: string;
    requesterUserId: string | null;
    requesterContact: string;
    type: string;
  },
  title: string,
  rejectionReason: string | null = null
): Promise<void> {
  const base = `Permintaan ${DATA_SUBJECT_REQUEST_TYPE_LABELS[request.type as DataSubjectRequestType] ?? request.type} dengan nomor ${request.requestNo}.`;
  // Alasan penolakan ikut dikirim: Pasal 33 mengizinkan penolakan, tetapi
  // pemohon yang hanya tahu "ditolak" tidak dapat memperbaiki apa pun. Ia
  // ditulis di sini, bukan hanya disimpan untuk petugas.
  const message = rejectionReason ? `${base} Alasan: ${rejectionReason}` : base;
  try {
    if (request.requesterUserId) {
      await notificationService.send({
        channel: 'IN_APP',
        userId: request.requesterUserId,
        type: 'GENERAL',
        title,
        message,
      });
      return;
    }
    const contact = request.requesterContact;
    const channel = contact.includes('@') ? 'EMAIL' : 'WHATSAPP';
    await notificationService.send({
      channel,
      recipientEmail: channel === 'EMAIL' ? contact : undefined,
      recipientPhone: channel === 'WHATSAPP' ? contact : undefined,
      type: 'GENERAL',
      title,
      message,
    });
  } catch (error) {
    logger.warn('[PDP] Pemberitahuan ke pemohon gagal dikirim', {
      requestNo: request.requestNo,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Kirim kode verifikasi ke kontak yang sudah terdaftar pada data subjek.
 *
 * Mengembalikan `true` bila pengirimannya benar-benar berhasil. Ini bukan
 * formalitas: `notificationService.send` mengembalikan `success: false` alih-alih
 * melempar, sehingga `try/catch` saja melewatkan penolakan transport — dan
 * formulir yang menyatakan "kode terkirim" kepada keluarga yang tidak pernah
 * menerimanya meninggalkan mereka tanpa cara memverifikasi. Pemanggil memakai
 * hasil ini untuk memilih: laporkan tujuan pengiriman, atau minta kontak lain.
 */
async function sendVerificationCode(
  contact: string,
  code: string,
  requestNo: string
): Promise<boolean> {
  const channel = contact.includes('@') ? 'EMAIL' : 'WHATSAPP';
  try {
    const result = await notificationService.send({
      channel,
      recipientEmail: channel === 'EMAIL' ? contact : undefined,
      recipientPhone: channel === 'WHATSAPP' ? contact : undefined,
      type: 'GENERAL',
      priority: 'HIGH',
      title: 'Kode verifikasi permintaan data pribadi',
      message: `Kode verifikasi Anda: ${code}. Berlaku ${DATA_SUBJECT_VERIFICATION_TTL_MINUTES} menit. Jangan bagikan kode ini kepada siapa pun. Nomor permintaan: ${requestNo}.`,
    });
    return result.success;
  } catch (error) {
    logger.error('[PDP] Kode verifikasi gagal dikirim', {
      requestNo,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Dipakai uji: baris mentah untuk pemeriksaan kolom yang tidak masuk DTO. */
export async function findRawByRequestNo(requestNo: string): Promise<DataSubjectRequest | null> {
  return prisma.dataSubjectRequest.findUnique({ where: { requestNo } });
}
