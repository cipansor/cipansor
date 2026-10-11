import {
  LetterFlowAction,
  LetterStatus,
  Prisma,
  SigningKeyRequestKind,
  SigningKeyRequestStatus,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { Db } from '@/lib/prisma';
import { comparePassword } from '@/lib/password';
import { Errors } from '@/middleware/error';
import { eventBus } from '@/lib/event-bus';
import {
  assertIdentityReadyToRequest,
  IdentityError,
  isWellFormedNik,
  missingIdentityFields,
  nikBirthDateMismatch,
  normaliseNik,
} from '@/utils/signer-identity';
import {
  deleteIdentityDocument,
  identityDocumentRetainUntil,
  isAcceptedIdentityDocument,
  readIdentityDocument,
  storeIdentityDocument,
} from '@/utils/identity-document-store';
import crypto from 'crypto';
import {
  createKeyMaterial,
  lockoutUntil,
  newVerificationToken,
  normaliseFingerprint,
  rewrapKeyMaterial,
  signPayload,
  signPdfHash,
  signRevocation,
  verifyPdfHashSignature,
  type EncryptedKeyMaterial,
  type ScryptParams,
  type SignablePayload,
  EsignError,
  MAX_PASSPHRASE_ATTEMPTS,
} from '@/utils/esign';
import {
  generateLetterPdfBuffer,
  stampSignatureVisualisation,
  stampRevoked,
  LetterPdfError,
  LETTER_PDF_GENERATOR,
  LETTER_PDF_RELATIONS,
} from '@/utils/generate-letter-pdf';
import { verifyLetterByToken } from '@/utils/letter-verification';
import { matchRevokedCopy } from '@/utils/letter-revoked-copy';
import { readUploadedPdfBytes } from '@/utils/letter-uploaded-file';
import { assertLetterUploadOwnedBy } from '@/utils/letter-upload-ownership';
import { assertLetterAccess, type LetterActor } from '@/utils/letter-access';
import {
  LetterRevocationRequestStatus,
  SigningKeyRevocationCode,
  SigningAuthorityForm,
  LetterAuthoringTrack,
} from '@prisma/client';
import {
  requiresRepresentedOffice,
  type SigningAuthorityForm as SharedSigningAuthorityForm,
} from '@cipansor/shared';
import {
  RevocationError,
  actorMayRevoke,
  assertKeyRevocable,
  assertSignatureRevocable,
  normalizeReason,
  type RevocationActor,
} from '@/utils/esign-revocation';
import {
  REVOCATION_DECIDER_ROLES,
  mayRevokeSignature as mayRevokeSignatureByOffice,
} from '@/utils/letter-revocation-authority';
import {
  DEFAULT_VALIDITY_DAYS,
  SigningKeyState,
  assertCanSign,
  assertValidityDays,
  canRequestRenewal,
  daysUntilExpiry,
  effectiveState,
  expiryFrom,
  needsNewIssuance,
  renewedExpiry,
} from '@/utils/esign-lifecycle';

/** Baris kunci → bahan kriptografi yang dimengerti utils/esign. */
function toMaterial(key: {
  algorithm: string;
  publicKey: string;
  encryptedPrivateKey: string;
  kdfSalt: string;
  kdfParams: Prisma.JsonValue;
  iv: string;
  authTag: string;
}): EncryptedKeyMaterial {
  return {
    algorithm: key.algorithm,
    publicKey: key.publicKey,
    encryptedPrivateKey: key.encryptedPrivateKey,
    kdfSalt: key.kdfSalt,
    kdfParams: key.kdfParams as unknown as ScryptParams,
    iv: key.iv,
    authTag: key.authTag,
  };
}

/**
 * Catat percobaan passphrase yang gagal, dan kunci bila sudah terlalu sering.
 *
 * Dilakukan di luar transaksi penandatanganan supaya hitungannya tetap
 * bertambah walaupun operasi utamanya dibatalkan — kalau tidak, menebak
 * passphrase menjadi gratis.
 */
async function recordFailedAttempt(keyId: string, current: number) {
  const failed = current + 1;
  await prisma.userSigningKey.update({
    where: { id: keyId },
    data: { failedAttempts: failed, lockedUntil: lockoutUntil(failed) },
  });
}

async function clearFailedAttempts(keyId: string) {
  await prisma.userSigningKey.update({
    where: { id: keyId },
    data: { failedAttempts: 0, lockedUntil: null, lastUsedAt: new Date() },
  });
}

/**
 * Arsipkan status kunci aktif sebelum dihapus, lalu hapus.
 *
 * Penerbitan ulang kunci menghapus baris `UserSigningKey` (satu kunci aktif per
 * pengguna). Tanpa langkah ini, sidik jari yang tercetak pada surat-surat lama
 * kehilangan sumbernya: layanan status publik (AATL ICA7) menjawab "tidak
 * dikenal", padahal suratnya masih dapat diverifikasi karena tanda tangannya
 * menyimpan salinan kunci publiknya sendiri. Yang seharusnya terbaca adalah
 * EXPIRED (atau REVOKED beserta sebabnya), bukan UNKNOWN.
 *
 * Yang disalin hanya metadata publik — tanpa kunci privat, salt, iv, atau tag.
 * `upsert` menjaga pemanggilan berulang (dan jalur persetujuan yang berjalan
 * dua kali) tidak menggandakan sidik jari yang sama.
 */
async function archiveActiveKey(client: Db, userId: string): Promise<void> {
  const key = await client.userSigningKey.findUnique({ where: { userId } });
  if (!key || !key.fingerprint) {
    await client.userSigningKey.deleteMany({ where: { userId } });
    return;
  }

  await client.signingKeyStatusRecord.upsert({
    where: { fingerprint: key.fingerprint },
    create: {
      userId: key.userId,
      fingerprint: key.fingerprint,
      algorithm: key.algorithm,
      approvedAt: key.approvedAt,
      expiresAt: key.expiresAt,
      revokedAt: key.revokedAt,
      revokedReason: key.revokedReason,
      revocationCode: key.revocationCode,
    },
    update: {
      // Kunci yang sama tidak berubah; perbarui metadata kalau ada pencabutan
      // atau perpanjangan terakhir yang belum sempat tercatat.
      approvedAt: key.approvedAt,
      expiresAt: key.expiresAt,
      revokedAt: key.revokedAt,
      revokedReason: key.revokedReason,
      revocationCode: key.revocationCode,
    },
  });

  await client.userSigningKey.deleteMany({ where: { userId } });
}

/**
 * Terjemahkan penolakan aturan pencabutan menjadi galat HTTP yang semestinya.
 *
 * Tanpa ini `RevocationError` jatuh ke penangan umum sebagai 500, dan operator
 * yang alasannya kurang sepuluh karakter membaca "Internal server error"
 * alih-alih kalimat yang memberitahunya apa yang harus diperbaiki.
 */
/**
 * Siapa saja yang berwenang memutus pencabutan atas tanda tangan ini.
 *
 * Dicari dari penugasan peran yang masih aktif, bukan dari daftar yang
 * ditanam di kode: jabatan berpindah orang, dan permohonan harus sampai ke
 * mejanya yang sekarang.
 */
async function deciderIdsFor(signerId: string, signerRoleCode: string | null): Promise<string[]> {
  const candidates = await prisma.userRoleAssignment.findMany({
    where: {
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      role: { code: { in: [...REVOCATION_DECIDER_ROLES] } },
    },
    select: { userId: true, role: { select: { code: true } } },
  });

  const ids = new Set<string>([signerId]);
  for (const c of candidates) {
    if (
      mayRevokeSignatureByOffice(
        { userId: signerId, roleCode: signerRoleCode },
        { userId: c.userId, roleCode: c.role.code }
      )
    ) {
      ids.add(c.userId);
    }
  }
  return [...ids];
}

function asHttpError(error: unknown): unknown {
  if (!(error instanceof RevocationError)) return error;
  return error.forbidden ? Errors.forbidden(error.message) : Errors.badRequest(error.message);
}

/**
 * Hapus berkas KTP seorang pemohon sekarang juga, dan catat bahwa ia dihapus.
 *
 * Hanya untuk jalur yang benar-benar mengakhiri kegunaannya: pengajuan yang
 * **ditolak** (tidak ada kunci yang terbit, jadi tidak ada yang perlu
 * dipertanggungjawabkan) dan data identitas yang **diubah** (berkasnya
 * membuktikan data yang sudah tidak berlaku).
 *
 * Pengajuan yang **disetujui** tidak lewat sini — berkasnya disimpan sampai
 * `ktpRetainUntil`, karena "tunjukkan kartu yang Anda periksa" adalah
 * pertanyaan yang baru muncul bertahun-tahun kemudian dan hash tidak dapat
 * menjawabnya.
 *
 * `ktpDeletedAt` disimpan justru supaya penghapusannya dapat ditunjukkan:
 * kolom kosong tidak dapat membedakan "sudah dihapus" dari "tidak pernah ada".
 */
async function discardIdentityDocument(userId: string): Promise<void> {
  const identity = await prisma.userIdentity.findUnique({
    where: { userId },
    select: { ktpFileName: true },
  });
  if (!identity?.ktpFileName) return;

  await deleteIdentityDocument(identity.ktpFileName);
  await prisma.userIdentity.update({
    where: { userId },
    data: { ktpFileName: null, ktpDeletedAt: new Date() },
  });
}

export const EsignService = {
  /** Ringkasan kunci milik pengguna, untuk halaman pengaturan. */
  async myStatus(userId: string) {
    const identity = await prisma.userIdentity.findUnique({ where: { userId } });
    const key = await prisma.userSigningKey.findUnique({
      where: { userId },
      select: {
        id: true,
        algorithm: true,
        approvedAt: true,
        expiresAt: true,
        revokedAt: true,
        revokedReason: true,
        lockedUntil: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    const pendingRequest = await prisma.signingKeyRequest.findFirst({
      where: { userId, status: SigningKeyRequestStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });

    const approvedEnrolment = await prisma.signingKeyRequest.findFirst({
      where: {
        userId,
        status: SigningKeyRequestStatus.APPROVED,
        kind: SigningKeyRequestKind.ENROLLMENT,
      },
      orderBy: { decidedAt: 'desc' },
      select: { id: true },
    });

    // Kunci yang sudah disetujui tetapi belum pernah dibuka passphrase-nya
    // masih menunggu pengguna menetapkan passphrase.
    const state = key ? effectiveState(key) : null;

    return {
      /**
       * Keadaan identitas, dikirim bersama keadaan kunci.
       *
       * Halaman e-sign harus dapat mengatakan *mengapa* tombol pengajuan tidak
       * tersedia sebelum ditekan. Menyembunyikan alasannya sampai server
       * menolak berarti pemohon menekan tombol, membaca penolakan, lalu mencari
       * sendiri formulir mana yang harus diisi.
       */
      identity: {
        /** NIK sengaja tidak dikirim balik; pemiliknya sudah mengetahuinya. */
        legalName: identity?.legalName ?? null,
        birthPlace: identity?.birthPlace ?? null,
        birthDate: identity?.birthDate ?? null,
        hasNik: !!identity?.nik,
        missingFields: missingIdentityFields(identity),
        verifiedAt: identity?.verifiedAt ?? null,
        /**
         * Keadaan berkas KTP, tanpa berkasnya.
         *
         * Pemiliknya perlu tahu tiga hal: apakah ia sudah mengunggah, apakah
         * berkasnya masih ada, dan kapan ia dihapus. Yang tidak perlu ia lihat
         * adalah gambarnya — ia sudah memegang kartunya, dan setiap jalur yang
         * dapat mengembalikannya adalah satu jalur lagi yang terbuka bila
         * sesinya dibajak.
         */
        ktpUploadedAt: identity?.ktpUploadedAt ?? null,
        ktpDeletedAt: identity?.ktpDeletedAt ?? null,
        ktpRetainUntil: identity?.ktpRetainUntil ?? null,
        hasKtpOnFile: !!identity?.ktpFileName,
      },
      /**
       * Persetujuan sudah ada dan passphrase-nya belum ditetapkan.
       *
       * Halaman pengaturan menawarkan kotak passphrase berdasarkan
       * `!hasKey && !pendingRequest`, yang juga benar bagi orang yang belum
       * pernah mengajukan apa pun — sehingga kotak "Tetapkan passphrase" tampil
       * berdampingan dengan kotak "Ajukan penerbitan", dan tombolnya pasti
       * ditolak `activateKey` dengan "Belum ada persetujuan penerbitan". Ini
       * ruas yang membuat halaman itu dapat menawarkan langkah yang memang
       * sedang berlaku, bukan menebaknya.
       */
      approvedAwaitingActivation: !key && !!approvedEnrolment,
      hasKey: !!key,
      state,
      expiresAt: key?.expiresAt ?? null,
      daysUntilExpiry: key ? daysUntilExpiry(key) : null,
      revokedReason: key?.revokedReason ?? null,
      lockedUntil: key?.lockedUntil ?? null,
      lastUsedAt: key?.lastUsedAt ?? null,
      canRequestRenewal: canRequestRenewal(key ?? null),
      needsNewIssuance: needsNewIssuance(key ?? null),
      pendingRequest: pendingRequest
        ? { id: pendingRequest.id, kind: pendingRequest.kind, createdAt: pendingRequest.createdAt }
        : null,
    };
  },

  /**
   * Isi atau perbarui identitas sendiri.
   *
   * Pemohonlah yang mengetik datanya; yang menyatakannya benar adalah orang
   * lain. Setiap perubahan pada keempat ruasnya **mengosongkan kembali
   * verifikasinya**, sebab yang dinyatakan seorang penyetuju adalah data *yang
   * itu* sudah dicocokkan dengan kartu identitas — bukan bahwa orangnya pernah
   * diperiksa sekali seumur hidup. Tanpa aturan itu, seseorang dapat lolos
   * verifikasi dengan datanya sendiri lalu menggantinya menjadi milik orang
   * lain, dan kunci berikutnya terbit atas nama yang tidak pernah diperiksa.
   *
   * Tidak dapat diubah selama masih ada kunci yang hidup: identitas itulah yang
   * mendasari kunci tersebut, dan mengubahnya diam-diam akan membuat surat yang
   * sudah ditandatangani merujuk kepada orang yang berbeda dari yang diperiksa.
   */
  async saveMyIdentity(
    userId: string,
    input: { legalName: string; nik: string; birthPlace: string; birthDate: string }
  ) {
    const key = await prisma.userSigningKey.findUnique({
      where: { userId },
      select: { revokedAt: true, expiresAt: true },
    });
    const keyIsLive = !!key && !key.revokedAt && (!key.expiresAt || key.expiresAt > new Date());
    if (keyIsLive) {
      throw Errors.badRequest(
        'Kunci tanda tangan Anda masih berlaku, sehingga identitas yang mendasarinya ' +
          'tidak dapat diubah. Hubungi Super Admin bila ada data yang keliru.'
      );
    }

    const nik = normaliseNik(input.nik);
    if (!isWellFormedNik(nik)) {
      throw Errors.badRequest('NIK harus terdiri atas 16 angka.');
    }

    const birthDate = new Date(input.birthDate);
    if (Number.isNaN(birthDate.getTime())) {
      throw Errors.badRequest('Tanggal lahir tidak sah.');
    }

    // Satu NIK tidak boleh mendasari dua akun penandatangan; pencabutan salah
    // satunya tidak akan menghentikan yang lain.
    const claimedElsewhere = await prisma.userIdentity.findFirst({
      where: { nik, userId: { not: userId } },
      select: { id: true },
    });
    if (claimedElsewhere) {
      throw Errors.conflict(
        'NIK ini sudah terdaftar pada akun lain. Satu NIK hanya dapat mendasari satu ' +
          'akun penandatangan.'
      );
    }

    // Berkas KTP yang menyertai data lama ikut dibuang: ia diunggah untuk
    // membuktikan data *yang itu*, dan data itu sudah tidak berlaku.
    const previous = await prisma.userIdentity.findUnique({
      where: { userId },
      select: { ktpFileName: true },
    });
    if (previous?.ktpFileName) {
      await deleteIdentityDocument(previous.ktpFileName);
    }

    const data = {
      legalName: input.legalName.trim(),
      nik,
      birthPlace: input.birthPlace.trim(),
      birthDate,
      // Data berubah, maka verifikasinya gugur — lihat komentar di atas.
      verifiedAt: null,
      verifiedById: null,
      verificationNote: null,
      ktpFileName: null,
      ktpSha256: null,
      ktpUploadedAt: null,
      ktpRetainUntil: null,
      ktpDeletedAt: previous?.ktpFileName ? new Date() : null,
    };

    const identity = await prisma.userIdentity.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    return {
      ...identity,
      nik: undefined,
      // Diperiksa di sini, bukan ditolak: NIK menyandikan tanggal lahir, jadi
      // ketidakcocokan berarti salah satunya salah ketik — tetapi kekeliruan
      // pencatatan kependudukan juga ada, dan memblokir pejabat yang sah karena
      // NIK-nya sendiri tidak konsisten lebih merugikan daripada melaporkannya.
      warning: nikBirthDateMismatch(nik, birthDate),
    };
  },

  /**
   * Unggah foto KTP sebagai bukti identitas.
   *
   * Satu-satunya jalur pembuktian, dan itu disengaja. Pilihan "kartu
   * ditunjukkan langsung" dan "dikenali pribadi" pernah ada di sini, dan
   * keduanya tidak meninggalkan apa pun yang dapat diperiksa: seorang penyetuju
   * dapat memilihnya tanpa melakukan apa pun, dan catatan yang tersimpan
   * berbunyi "karena saya bilang begitu". Pilihan yang tanpa bukti mengubah
   * seluruh gerbang ini menjadi sekadar klik — dan menuntut seratusan staf
   * lintas unit mendatangi Super Admin satu per satu bukan alur yang dapat
   * dijalankan siapa pun.
   *
   * Berkasnya berumur pendek: ia dihapus begitu pengajuannya diputuskan.
   */
  async uploadIdentityDocument(userId: string, file: Express.Multer.File) {
    if (!isAcceptedIdentityDocument(file.mimetype)) {
      throw Errors.badRequest('Berkas harus berupa gambar (JPG, PNG, WebP) atau PDF.');
    }

    const identity = await prisma.userIdentity.findUnique({ where: { userId } });
    if (!identity) {
      throw Errors.badRequest('Lengkapi dulu data identitas Anda sebelum mengunggah foto KTP.');
    }
    if (identity.verifiedAt) {
      throw Errors.badRequest(
        'Identitas Anda sudah diverifikasi; foto KTP tidak perlu diunggah lagi.'
      );
    }

    // Unggahan baru menggantikan yang lama, dan yang lama benar-benar dihapus
    // — bukan sekadar kehilangan rujukannya di basis data.
    if (identity.ktpFileName) {
      await deleteIdentityDocument(identity.ktpFileName);
    }

    const stored = await storeIdentityDocument(file.buffer, file.mimetype);

    await prisma.userIdentity.update({
      where: { userId },
      data: {
        ktpFileName: stored.fileName,
        ktpSha256: stored.sha256,
        ktpUploadedAt: new Date(),
        ktpDeletedAt: null,
      },
    });

    return { uploadedAt: new Date(), sha256: stored.sha256 };
  },

  /**
   * Baca foto KTP seorang pemohon — hanya untuk Super Admin, dan tercatat.
   *
   * Kewenangannya ditegakkan di rute (`isSuperAdmin`); yang ada di sini adalah
   * bagian yang tidak boleh hilang bersama perubahan rute: **setiap pembacaan
   * dicatat.** "Hanya Super Admin yang dapat melihatnya" adalah janji yang
   * memerlukan catatan sebelum siapa pun dapat memeriksanya — termasuk memeriksa
   * apakah seorang Super Admin membukanya di luar keperluan memutuskan.
   */
  async readIdentityDocument(subjectUserId: string, readerId: string) {
    const identity = await prisma.userIdentity.findUnique({
      where: { userId: subjectUserId },
      select: { ktpFileName: true, ktpDeletedAt: true },
    });

    if (!identity?.ktpFileName) {
      throw Errors.notFound(
        identity?.ktpDeletedAt
          ? 'Foto KTP sudah dihapus setelah pengajuannya diputuskan.'
          : 'Pemohon belum mengunggah foto KTP.'
      );
    }

    const buffer = await readIdentityDocument(identity.ktpFileName);

    await prisma.auditLog.create({
      data: {
        userId: readerId,
        action: 'READ',
        entity: 'UserIdentity.ktp',
        entityId: subjectUserId,
      },
    });

    return {
      buffer,
      contentType: identity.ktpFileName.endsWith('.pdf')
        ? 'application/pdf'
        : identity.ktpFileName.endsWith('.png')
          ? 'image/png'
          : identity.ktpFileName.endsWith('.webp')
            ? 'image/webp'
            : 'image/jpeg',
    };
  },

  /**
   * Ajukan penerbitan atau perpanjangan.
   *
   * Jenis pengajuan ditentukan server dari keadaan kunci, bukan dari yang
   * dikirim klien: kalau klien boleh memilih, kunci yang sudah kedaluwarsa
   * bisa "diperpanjang" dan lolos dari pemeriksaan ulang yang justru menjadi
   * alasan adanya masa berlaku.
   */
  async requestKey(userId: string, reason?: string) {
    const existing = await prisma.signingKeyRequest.findFirst({
      where: { userId, status: SigningKeyRequestStatus.PENDING },
    });
    if (existing) {
      throw Errors.badRequest('Pengajuan Anda sebelumnya masih menunggu keputusan.');
    }

    /**
     * Identitas dulu, kunci kemudian.
     *
     * Ditolak di sini, sebelum apa pun tercatat, dan dengan menyebut ruas mana
     * yang kurang. Kunci yang terbit untuk akun tanpa identitas menghasilkan
     * tanda tangan yang membuktikan pengetahuan passphrase dan tidak lebih —
     * sedangkan seluruh gunanya adalah membuktikan siapa yang menandatangani.
     *
     * Yang **tidak** dituntut di sini adalah identitas yang sudah
     * terverifikasi, dan itu disengaja: verifikasinya justru terjadi di
     * `decideRequest`, atas pengajuan ini. Menuntutnya lebih dulu membuat
     * keduanya saling menunggu dan tidak seorang pun memperoleh kunci.
     *
     * Berlaku untuk perpanjangan juga: masa berlaku ada supaya identitas
     * diperiksa ulang. `saveMyIdentity` menggugurkan verifikasi setiap kali
     * datanya berubah, jadi perpanjangan atas data yang sudah bergeser tetap
     * kembali melewati pencocokan Super Admin.
     */
    const identity = await prisma.userIdentity.findUnique({ where: { userId } });
    try {
      assertIdentityReadyToRequest(identity);
    } catch (e) {
      if (e instanceof IdentityError) throw Errors.badRequest(e.message);
      throw e;
    }

    const key = await prisma.userSigningKey.findUnique({ where: { userId } });

    let kind: SigningKeyRequestKind;
    if (needsNewIssuance(key)) {
      kind = SigningKeyRequestKind.ENROLLMENT;
    } else if (canRequestRenewal(key)) {
      kind = SigningKeyRequestKind.RENEWAL;
    } else {
      throw Errors.badRequest(
        'Kunci tanda tangan Anda masih berlaku dan belum memasuki masa perpanjangan.'
      );
    }

    const request = await prisma.signingKeyRequest.create({
      data: { userId, kind, reason, status: SigningKeyRequestStatus.PENDING },
    });

    eventBus.emit('notification:send', {
      userId,
      type: 'INFO',
      title: 'Pengajuan Tanda Tangan Elektronik Terkirim',
      message:
        kind === SigningKeyRequestKind.RENEWAL
          ? 'Pengajuan perpanjangan kunci tanda tangan Anda menunggu persetujuan Super Admin.'
          : 'Pengajuan penerbitan kunci tanda tangan Anda menunggu persetujuan Super Admin.',
      data: { requestId: request.id },
    });

    return request;
  },

  /** Antrean pengajuan untuk Super Admin. */
  async listRequests(status?: SigningKeyRequestStatus) {
    return prisma.signingKeyRequest.findMany({
      where: status ? { status } : undefined,
      include: {
        // Identitas ikut, karena inilah yang sedang diputuskan. NIK termasuk:
        // rute ini hanya terbuka bagi Super Admin, dan mencocokkan NIK dengan
        // kartu identitas adalah pekerjaan yang diminta darinya.
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            identity: {
              select: {
                legalName: true,
                nik: true,
                birthPlace: true,
                birthDate: true,
                verifiedAt: true,
                verificationNote: true,
                verifiedBy: { select: { name: true } },
                // Berkasnya sendiri tidak ikut — ia dibaca lewat endpointnya
                // sendiri, yang memeriksa kewenangan dan mencatat pembacaannya.
                ktpUploadedAt: true,
                ktpDeletedAt: true,
                ktpRetainUntil: true,
                ktpSha256: true,
              },
            },
          },
        },
        decidedBy: { select: { name: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  },

  /**
   * Putusan Super Admin.
   *
   * Menyetujui perpanjangan langsung memperpanjang masa berlaku kunci yang ada
   * — kuncinya tidak diganti, sehingga surat-surat lama tetap terverifikasi.
   * Menyetujui penerbitan hanya membuka pintu: kuncinya baru benar-benar dibuat
   * ketika pemiliknya menetapkan passphrase, karena hanya dia yang boleh tahu.
   */
  async decideRequest(
    requestId: string,
    deciderId: string,
    approve: boolean,
    grantedDays?: number,
    note?: string,
    identityVerification?: { note?: string }
  ) {
    const request = await prisma.signingKeyRequest.findUnique({ where: { id: requestId } });
    if (!request) throw Errors.notFound('Pengajuan tidak ditemukan');
    if (request.status !== SigningKeyRequestStatus.PENDING) {
      throw Errors.badRequest('Pengajuan ini sudah diputuskan.');
    }

    if (!approve) {
      // Ditolak berarti tidak ada kunci yang terbit, jadi foto KTP-nya tidak
      // lagi membuktikan apa pun — dan data pribadi yang disimpan tanpa
      // keperluan adalah kewajiban tanpa manfaat.
      await discardIdentityDocument(request.userId);

      const rejected = await prisma.signingKeyRequest.update({
        where: { id: requestId },
        data: {
          status: SigningKeyRequestStatus.REJECTED,
          decidedById: deciderId,
          decidedAt: new Date(),
          decisionNote: note,
        },
      });
      eventBus.emit('notification:send', {
        userId: request.userId,
        type: 'WARNING',
        title: 'Pengajuan Tanda Tangan Ditolak',
        message: note ? `Pengajuan ditolak: ${note}` : 'Pengajuan tanda tangan Anda ditolak.',
        data: { requestId },
      });
      return rejected;
    }

    const days = grantedDays ?? DEFAULT_VALIDITY_DAYS;
    assertValidityDays(days);

    /**
     * Menyetujui berarti menyatakan siapa orangnya.
     *
     * Persetujuan di sini adalah satu-satunya saat seorang manusia menyatakan
     * bahwa akun ini benar-benar orang yang diakuinya. Kalau identitasnya belum
     * pernah dicocokkan, penyetuju harus mengatakan **bagaimana** ia
     * mencocokkannya — kartu ditunjukkan langsung, pindaian diperiksa, atau
     * dikenali pribadi. Catatan itulah yang lestari: ia menjawab "atas dasar apa
     * kunci ini terbit" bertahun-tahun kemudian, berukuran beberapa baris, dan
     * tidak menjadi sasaran bila basis data ini bocor — tidak seperti pindaian
     * kartunya.
     *
     * Identitas yang sudah terverifikasi tidak wajib diperiksa ulang: setiap
     * perubahan datanya sudah menggugurkan verifikasinya sendiri
     * (`saveMyIdentity`), jadi verifikasi yang masih berdiri memang menyatakan
     * data yang sekarang.
     */
    const identity = await prisma.userIdentity.findUnique({
      where: { userId: request.userId },
    });
    const missing = missingIdentityFields(identity);
    if (missing.length > 0) {
      throw Errors.badRequest(
        `Identitas pemohon belum lengkap (${missing.join(', ')}), sehingga kunci tidak ` +
          'dapat diterbitkan atas namanya. Minta pemohon melengkapinya lebih dahulu.'
      );
    }
    if (!identity!.verifiedAt) {
      if (!identity!.ktpFileName) {
        throw Errors.badRequest(
          'Pemohon belum mengunggah foto KTP, sehingga identitasnya tidak dapat ' +
            'dicocokkan. Minta pemohon mengunggahnya lebih dahulu.'
        );
      }
      if (!identityVerification) {
        throw Errors.badRequest(
          'Identitas pemohon belum diverifikasi. Buka foto KTP-nya, cocokkan dengan ' +
            'data yang diisi, lalu nyatakan kecocokannya saat menyetujui.'
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      if (identityVerification) {
        await tx.userIdentity.update({
          where: { userId: request.userId },
          data: {
            verifiedAt: new Date(),
            verifiedById: deciderId,
            verificationNote: identityVerification.note ?? null,
          },
        });
      }

      /**
       * Batas simpan berkas KTP, dihitung dari akhir masa berlaku kuncinya.
       *
       * Bukan dari hari ini: praktik baku menghitung retensi bukti registrasi
       * *setelah sertifikatnya berhenti berlaku*, sebab selama kunci masih
       * dapat menandatangani, dasar penerbitannya masih dapat dipersoalkan.
       * Pemohon tetap kehilangan aksesnya sekarang juga — yang disimpan ini
       * hanya terbaca oleh Super Admin, lewat endpoint yang mencatatnya.
       */
      const keyExpiry = expiryFrom(new Date(), days);
      await tx.userIdentity.update({
        where: { userId: request.userId },
        data: { ktpRetainUntil: identityDocumentRetainUntil(keyExpiry) },
      });

      const approved = await tx.signingKeyRequest.update({
        where: { id: requestId },
        data: {
          status: SigningKeyRequestStatus.APPROVED,
          decidedById: deciderId,
          decidedAt: new Date(),
          decisionNote: note,
          grantedDays: days,
        },
      });

      if (request.kind === SigningKeyRequestKind.RENEWAL) {
        const key = await tx.userSigningKey.findUnique({ where: { userId: request.userId } });
        if (key) {
          await tx.userSigningKey.update({
            where: { id: key.id },
            data: { expiresAt: renewedExpiry(key, days), approvedById: deciderId },
          });
        }
      } else {
        // Penerbitan: arsipkan status kunci lama lalu hapus (kedaluwarsa/dicabut)
        // supaya pemiliknya bisa menetapkan passphrase baru. Tanda tangan lama
        // tidak terpengaruh — masing-masing menyimpan salinan kunci publiknya.
        await archiveActiveKey(tx, request.userId);
      }

      return approved;
    });

    return result;
  },

  /**
   * Tetapkan passphrase dan terbitkan kunci, setelah pengajuan disetujui.
   *
   * Kunci baru dibuat di sini — bukan saat disetujui — karena passphrase-nya
   * hanya boleh diketahui pemiliknya.
   */
  async activateKey(userId: string, passphrase: string) {
    const approved = await prisma.signingKeyRequest.findFirst({
      where: {
        userId,
        status: SigningKeyRequestStatus.APPROVED,
        kind: SigningKeyRequestKind.ENROLLMENT,
      },
      orderBy: { decidedAt: 'desc' },
    });
    if (!approved) {
      throw Errors.badRequest('Belum ada persetujuan penerbitan kunci tanda tangan untuk Anda.');
    }

    const existing = await prisma.userSigningKey.findUnique({ where: { userId } });
    if (existing && !needsNewIssuance(existing)) {
      throw Errors.badRequest('Anda sudah memiliki kunci tanda tangan yang aktif.');
    }

    const material = createKeyMaterial(passphrase);
    const days = approved.grantedDays ?? DEFAULT_VALIDITY_DAYS;
    const now = new Date();

    await archiveActiveKey(prisma, userId);
    const key = await prisma.userSigningKey.create({
      data: {
        userId,
        algorithm: material.algorithm,
        publicKey: material.publicKey,
        fingerprint: material.fingerprint,
        encryptedPrivateKey: material.encryptedPrivateKey,
        kdfSalt: material.kdfSalt,
        kdfParams: material.kdfParams as unknown as Prisma.InputJsonValue,
        iv: material.iv,
        authTag: material.authTag,
        approvedById: approved.decidedById,
        approvedAt: approved.decidedAt ?? now,
        expiresAt: expiryFrom(now, days),
      },
    });

    return { id: key.id, expiresAt: key.expiresAt, state: effectiveState(key) };
  },

  /**
   * Ganti passphrase.
   *
   * Menuntut dua bukti sekaligus: passphrase lama (bahwa Anda pemilik kunci)
   * dan password akun (bahwa ini benar-benar Anda, bukan sesi yang tertinggal
   * terbuka di komputer bersama). Salah satu saja tidak cukup — keduanya
   * menjawab pertanyaan yang berbeda.
   *
   * Kuncinya tidak diganti, hanya disegel ulang, sehingga surat-surat lama
   * tetap terverifikasi.
   */
  async changePassphrase(
    userId: string,
    currentPassphrase: string,
    accountPassword: string,
    newPassphrase: string
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user?.passwordHash || !(await comparePassword(accountPassword, user.passwordHash))) {
      throw Errors.unauthorized('Password akun salah.');
    }

    const key = await prisma.userSigningKey.findUnique({ where: { userId } });
    if (!key) throw Errors.badRequest('Anda belum memiliki kunci tanda tangan.');
    assertCanSign(key);

    let rewrapped;
    try {
      rewrapped = rewrapKeyMaterial(toMaterial(key), currentPassphrase, newPassphrase);
    } catch (error) {
      if (error instanceof EsignError) {
        await recordFailedAttempt(key.id, key.failedAttempts);
      }
      throw error;
    }

    await prisma.userSigningKey.update({
      where: { id: key.id },
      data: {
        encryptedPrivateKey: rewrapped.encryptedPrivateKey,
        kdfSalt: rewrapped.kdfSalt,
        kdfParams: rewrapped.kdfParams as unknown as Prisma.InputJsonValue,
        iv: rewrapped.iv,
        authTag: rewrapped.authTag,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    return { success: true };
  },

  /**
   * Daftar kunci yang pernah diterbitkan — kewenangan Super Admin.
   *
   * Ada karena pencabutan menuntutnya. Rutenya sudah lama tersedia, tetapi
   * tanpa daftar ini tidak ada satu pun tempat di dalam aplikasi yang
   * menyebutkan siapa saja pemegang kunci — sehingga passphrase yang bocor atau
   * pejabat yang berhenti hanya dapat dicabut lewat basis data langsung.
   *
   * Statusnya dihitung di sini, bukan dibaca dari kolom, sama seperti di
   * halaman pengaturan pemiliknya (utils/esign-lifecycle.ts).
   */
  async listKeys() {
    const keys = await prisma.userSigningKey.findMany({
      select: {
        id: true,
        userId: true,
        algorithm: true,
        approvedAt: true,
        expiresAt: true,
        lastUsedAt: true,
        lockedUntil: true,
        revokedAt: true,
        revokedReason: true,
        createdAt: true,
        user: {
          select: {
            name: true,
            email: true,
            unit: { select: { name: true } },
            staff: { select: { position: true } },
            // Peran utama saja, sekadar untuk dikenali di daftar. Kewenangan
            // tidak pernah dibaca dari sini — itu urusan middleware.
            userRoles: {
              where: { isActive: true },
              select: { role: { select: { code: true } } },
              orderBy: { isPrimary: 'desc' },
              take: 1,
            },
          },
        },
        approvedBy: { select: { name: true } },
        revokedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const now = new Date();
    return keys.map((k) => ({
      id: k.id,
      userId: k.userId,
      name: k.user.name,
      email: k.user.email,
      roleCode: k.user.userRoles[0]?.role.code ?? null,
      position: k.user.staff?.position ?? null,
      unitName: k.user.unit?.name ?? null,
      algorithm: k.algorithm,
      state: effectiveState(k, now),
      approvedAt: k.approvedAt,
      approvedByName: k.approvedBy?.name ?? null,
      expiresAt: k.expiresAt,
      daysUntilExpiry: daysUntilExpiry(k, now),
      lastUsedAt: k.lastUsedAt,
      lockedUntil: k.lockedUntil,
      revokedAt: k.revokedAt,
      revokedReason: k.revokedReason,
      revokedByName: k.revokedBy?.name ?? null,
      createdAt: k.createdAt,
    }));
  },

  /**
   * Cabut kunci (Super Admin).
   *
   * **Mencabut kunci tidak mencabut surat.** Setiap tanda tangan menyimpan
   * salinan kunci publiknya sendiri, jadi surat yang telanjur sah tetap
   * terverifikasi — dan memang begitu yang dikehendaki untuk pergantian pejabat
   * atau kunci yang kedaluwarsa.
   *
   * Untuk passphrase yang bocor, itu justru bukan yang diinginkan: siapa pun
   * yang memegang passphrase itu bisa saja telah menandatangani surat sebelum
   * kebocorannya diketahui. Karena itu pemanggil mendapat kembali daftar surat
   * yang ditandatangani dengan kunci ini beserta jumlahnya — supaya yang
   * mencabut melihat sendiri seberapa luas akibatnya dan dapat memutuskan mana
   * yang perlu dicabut satu per satu, bukan menyangka pekerjaannya sudah
   * selesai.
   */
  async revokeKey(
    userId: string,
    actorId: string,
    reason: string,
    code: SigningKeyRevocationCode = SigningKeyRevocationCode.AFFILIATION_CHANGED
  ) {
    const key = await prisma.userSigningKey.findUnique({ where: { userId } });
    if (!key) throw Errors.notFound('Kunci tanda tangan tidak ditemukan');

    let trimmed: string;
    try {
      trimmed = normalizeReason(reason);
      assertKeyRevocable(key);
    } catch (e) {
      throw asHttpError(e);
    }

    const revokedAt = new Date();
    await prisma.userSigningKey.update({
      where: { id: key.id },
      data: { revokedAt, revokedReason: trimmed, revocationCode: code, revokedById: actorId },
    });

    // Surat yang ditandatangani dengan kunci ini — dicocokkan pada salinan
    // kunci publiknya, bukan sekadar pada penandatangannya, karena orang yang
    // sama bisa pernah memegang kunci lain sebelumnya.
    const signedWithThisKey = await prisma.letterSignature.findMany({
      where: { signerId: userId, publicKey: key.publicKey, revokedAt: null },
      select: {
        id: true,
        signedAt: true,
        letter: { select: { id: true, letterNumber: true, subject: true, date: true } },
      },
      orderBy: { signedAt: 'desc' },
      take: 200,
    });

    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'REVOKE',
        entity: 'UserSigningKey',
        entityId: key.id,
        newValues: {
          revokedAt: revokedAt.toISOString(),
          revokedReason: trimmed,
          keyHolderId: userId,
          revocationCode: code,
          lettersStillValid: signedWithThisKey.length,
        },
      },
    });

    eventBus.emit('notification:send', {
      userId,
      type: 'WARNING',
      title: 'Kunci Tanda Tangan Dicabut',
      message: `Kunci tanda tangan elektronik Anda dicabut: ${trimmed}`,
      data: {},
    });

    return {
      success: true,
      revokedAt,
      revokedReason: trimmed,
      revocationCode: code,
      /**
       * Hanya kebocoran kunci yang membuat surat-surat lama meragukan.
       *
       * Untuk pejabat yang berhenti atau kunci yang diterbitkan ulang, surat
       * yang telanjur sah tetap sah — dan memang harus tetap sah. Membedakannya
       * di sini menghindarkan petugas dari dua kekeliruan yang berlawanan:
       * mencabut belasan naskah yang sebenarnya tidak apa-apa, atau membiarkan
       * naskah yang ditandatangani dengan kunci bocor tetap berlaku.
       */
      lettersNeedReview: code === SigningKeyRevocationCode.KEY_COMPROMISE,
      affectedLetterCount: signedWithThisKey.length,
      affectedLetters: signedWithThisKey.map((s) => ({
        signatureId: s.id,
        letterId: s.letter.id,
        letterNumber: s.letter.letterNumber,
        subject: s.letter.subject,
        date: s.letter.date,
        signedAt: s.signedAt,
      })),
    };
  },

  /**
   * Cabut tanda tangan pada sebuah surat.
   *
   * Menarik kembali surat yang telanjur beredar adalah kebutuhan tata usaha
   * yang biasa — SK salah orang, nomor ganda, keputusan yang dibatalkan. Skema
   * dan halaman verifikasi publik sudah lama siap menampilkannya; yang tidak
   * pernah ada adalah jalan untuk melakukannya, sehingga satu-satunya cara
   * adalah menyunting basis data.
   *
   * Barisnya tidak dihapus. Surat yang sudah beredar harus tetap bisa dijawab
   * statusnya kepada siapa pun yang mengunggahnya — dan jawaban "dicabut,
   * dengan alasan ini" jauh lebih berguna daripada "tidak terdaftar", yang
   * berbunyi persis seperti jawaban untuk dokumen palsu.
   */
  async revokeLetterSignature(
    letterId: string,
    actor: RevocationActor,
    reason: string,
    passphrase: string
  ) {
    const letter = await prisma.letter.findUnique({
      where: { id: letterId },
      select: {
        id: true,
        status: true,
        letterNumber: true,
        subject: true,
        createdById: true,
        /**
         * Termasuk yang sudah dicabut, sengaja.
         *
         * Menyaring `revokedAt: null` di sini akan membuat surat yang tanda
         * tangannya sudah dicabut tampak seperti surat yang belum pernah
         * ditandatangani — dan itulah kalimat yang akan dibaca operatornya.
         * Barisnya diambil apa adanya supaya aturan di
         * `utils/esign-revocation.ts` yang menjawab, dengan sebab yang benar.
         */
        signatures: {
          orderBy: { signedAt: 'desc' },
          select: { id: true, signerId: true, signerRoleCode: true, revokedAt: true },
        },
      },
    });
    if (!letter) throw Errors.notFound('Surat tidak ditemukan');

    const target = letter.signatures[0] ?? null;
    let trimmed: string;
    try {
      // Wewenang lebih dulu: yang tidak berwenang tidak perlu diberi tahu
      // panjang alasan yang benar, apalagi bahwa suratnya memang sudah dicabut.
      assertSignatureRevocable(target, actor);
      trimmed = normalizeReason(reason);
    } catch (e) {
      throw asHttpError(e);
    }

    /**
     * Passphrase pencabut, bukan passphrase penandatangan.
     *
     * Dua sebab. Pertama, ia membuktikan kehadiran pribadi: menarik surat resmi
     * tidak boleh cukup dengan sesi yang tertinggal terbuka di komputer
     * bersama. Kedua, pernyataan pencabutannya ditandatangani, sehingga halaman
     * verifikasi publik dapat membuktikannya — sama seperti CRL ditandatangani
     * penerbitnya (RFC 5280).
     *
     * Memakai kunci pencabut, bukan kunci penandatangan, sekaligus menutup
     * kasus yang justru menjadi alasan fitur ini ada: passphrase yang bocor,
     * atau pejabat yang sudah tidak ada. Kunci Pengawas tidak terpengaruh oleh
     * bocornya kunci Ketua.
     */
    const key = await prisma.userSigningKey.findUnique({ where: { userId: actor.id } });
    try {
      assertCanSign(key);
    } catch {
      throw Errors.badRequest(
        'Anda memerlukan kunci tanda tangan elektronik yang masih berlaku untuk mencabut naskah. ' +
          'Ajukan penerbitan kunci kepada Super Admin terlebih dahulu.'
      );
    }

    const revokedAt = new Date();
    const statement = {
      signatureId: target!.id,
      letterId: letter.id,
      revokedById: actor.id,
      revokedByRoleCode: actor.roleCode,
      revokedAt,
      reason: trimmed,
    };

    let signedRevocation;
    try {
      signedRevocation = signRevocation(toMaterial(key!), passphrase, statement);
    } catch (error) {
      if (error instanceof EsignError) {
        await recordFailedAttempt(key!.id, key!.failedAttempts);
        const left = MAX_PASSPHRASE_ATTEMPTS - (key!.failedAttempts + 1);
        throw Errors.unauthorized(
          left > 0
            ? `Passphrase tanda tangan salah. Sisa percobaan: ${left}.`
            : 'Passphrase salah. Kunci tanda tangan dikunci sementara.'
        );
      }
      throw error;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const sig = await tx.letterSignature.update({
        where: { id: target!.id },
        data: {
          revokedAt,
          revokedReason: trimmed,
          revokedById: actor.id,
          revokedByRoleCode: actor.roleCode,
          revocationDigest: signedRevocation.digest,
          revocationSignature: signedRevocation.signature,
          revocationPublicKey: signedRevocation.publicKey,
        },
      });

      await tx.letterFlowEvent.create({
        data: {
          letterId: letter.id,
          actorId: actor.id,
          action: LetterFlowAction.SIGNATURE_REVOKED,
          fromStatus: letter.status,
          toStatus: letter.status,
          note: `Naskah dinas dicabut: ${trimmed}`,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'REVOKE',
          entity: 'LetterSignature',
          entityId: sig.id,
          newValues: {
            revokedAt: revokedAt.toISOString(),
            revokedReason: trimmed,
            letterId: letter.id,
            letterNumber: letter.letterNumber,
          },
        },
      });

      return sig;
    });

    await clearFailedAttempts(key!.id);

    /**
     * Catat hash salinan bercap DICABUT (bila arsipnya ada).
     *
     * Pencocokan berkas yang diunggah ke halaman verifikasi mencari salinan
     * bercap; sebelumnya ia membuat ulang cap itu pada setiap permintaan dan
     * hanya memeriksa 200 tanda tangan tercabut terbaru — begitu pencabutan
     * melewati 200, salinan resmi yang lebih tua dijawab "tidak terdaftar".
     * Menyimpan hashnya di sini membuat pencocokan tepat dan tanpa batas.
     *
     * **Nama pencabut dibekukan di sini.** Cap mencetak namanya, dan selama
     * nama itu dibaca dari `users.name` pada setiap unduhan, satu penggantian
     * nama menisbikan setiap salinan bercap yang sudah beredar: byte-nya
     * berubah, hashnya tak lagi cocok. Karena itu namanya disimpan pada baris
     * tanda tangan bersama hashnya, dan kedua jalur cap membacanya dari sana.
     *
     * Usaha terbaik: arsip yang hilang atau rusak tidak menggagalkan
     * pencabutan — pencabutan itu sendiri sudah tercatat dan sah. Yang
     * kehilangan hanyalah pengenalan salinan bercap untuk naskah ini, dan
     * jalur cadangan (membuat ulang cap, terbatas) masih menanganinya.
     */
    try {
      const archived = await prisma.letterSignedDocument.findUnique({
        where: { signatureId: updated.id },
        select: { bytes: true, sha256: true },
      });
      if (archived) {
        const archivedBytes = Buffer.from(archived.bytes);
        // Arsip yang tidak lagi utuh tidak boleh menjadi dasar cap.
        if (crypto.createHash('sha256').update(archivedBytes).digest('hex') === archived.sha256) {
          const revoker = await prisma.user.findUnique({
            where: { id: actor.id },
            select: { name: true },
          });
          const revokedByName = revoker?.name ?? null;
          const stamped = await stampRevoked(archivedBytes, {
            reason: trimmed,
            revokedAt,
            revokedByName,
          });
          await prisma.letterSignature.update({
            where: { id: updated.id },
            data: {
              revokedByName,
              revokedSha256: crypto.createHash('sha256').update(stamped).digest('hex'),
            },
          });
        }
      }
    } catch {
      // Sengaja ditelan: pencabutan sudah sah; ini hanya mempercepat dan
      // memperluas pengenalan salinan bercap.
    }

    /**
     * Status surat sengaja tidak diubah.
     *
     * Surat ini memang pernah ditandatangani dan memang pernah beredar;
     * mengembalikannya ke DRAFT akan menghapus kenyataan itu dari buku agenda.
     * Yang menentukan sah atau tidaknya adalah tanda tangannya, dan di situlah
     * pencabutan dicatat — dibaca oleh halaman verifikasi publik, oleh naskah
     * yang dicetak, dan oleh riwayat alur surat di atas.
     */

    // Penandatangan diberi tahu bila bukan dia sendiri yang mencabut; pembuat
    // konsep selalu, karena dialah yang biasanya harus menerbitkan gantinya.
    const notify = new Set<string>();
    if (target!.signerId !== actor.id) notify.add(target!.signerId);
    if (letter.createdById && letter.createdById !== actor.id) notify.add(letter.createdById);

    const label = letter.letterNumber || letter.subject || 'Surat';
    for (const userId of notify) {
      eventBus.emit('notification:send', {
        userId,
        type: 'WARNING',
        title: 'Naskah Dinas Dicabut',
        message: `Naskah dinas ${label} dicabut: ${trimmed}`,
        data: { letterId: letter.id },
      });
    }

    return {
      success: true,
      signatureId: updated.id,
      revokedAt: updated.revokedAt,
      revokedReason: updated.revokedReason,
    };
  },

  /**
   * Bubuhkan tanda tangan pada surat.
   *
   * Hanya penandatangan yang ditunjuk, hanya ketika surat sudah sampai
   * gilirannya, dan hanya dengan passphrase yang benar.
   */
  async signLetter(
    letterId: string,
    userId: string,
    passphrase: string,
    signerRoleCode?: string | null,
    authority?: { form?: SigningAuthorityForm | null; representedOffice?: string | null }
  ) {
    const letter = await prisma.letter.findUnique({
      where: { id: letterId },
      include: { reviewers: { orderBy: { order: 'asc' } } },
    });
    if (!letter) throw Errors.notFound('Surat tidak ditemukan');

    const mine = letter.reviewers.find((r) => r.reviewerId === userId);
    if (!mine?.isSigner) {
      throw Errors.forbidden('Anda bukan penandatangan surat ini.');
    }
    if (letter.status !== LetterStatus.READY_TO_SIGN) {
      throw Errors.badRequest(`Surat belum siap ditandatangani (status: ${letter.status}).`);
    }

    // Verify that caller is the current pending reviewer in turn order and no non-signer reviewers remain pending
    const pendingReviewers = letter.reviewers.filter((r) => r.status !== 'APPROVED');
    const pendingNonSigners = pendingReviewers.filter((r) => !r.isSigner);
    if (pendingNonSigners.length > 0) {
      throw Errors.forbidden(
        `Surat belum selesai ditinjau oleh seluruh pemeriksa/paraf sebelum ditandatangani.`
      );
    }

    const currentTurn = pendingReviewers[0];
    if (currentTurn && currentTurn.reviewerId !== userId) {
      throw Errors.forbidden(
        `Belum giliran Anda. Menunggu verifikator urutan ${currentTurn.order} terlebih dahulu.`
      );
    }

    const key = await prisma.userSigningKey.findUnique({ where: { userId } });
    assertCanSign(key);

    /**
     * Garis kewenangan dinormalkan dan diperiksa di sini, bukan di skema.
     *
     * Bentuk selain NONE menuntut jabatan yang diwakili: tanpa jabatan itu,
     * `signingAuthorityLines` tidak dapat mencetak apa pun dan bloknya jatuh
     * kembali ke bentuk biasa — naskah yang menyatakan dirinya "a.n." tetapi
     * tidak menyebut siapa yang diwakili adalah naskah yang salah. Lebih baik
     * menolaknya di sini dengan kalimat yang jelas daripada mencetak blok yang
     * menyesatkan.
     *
     * Yang **tidak** diperiksa: keberadaan surat kuasa atau SK penunjukan yang
     * mendasari bentuk itu. Sistem tidak memilikinya; bentuknya adalah
     * pernyataan penanda tangan yang dipublikasikan, sama seperti
     * `signerRoleCode`.
     */
    const authorityForm: SigningAuthorityForm = authority?.form ?? SigningAuthorityForm.NONE;
    const representedOffice = authority?.representedOffice?.trim() || null;
    if (
      requiresRepresentedOffice(authorityForm as unknown as SharedSigningAuthorityForm) &&
      !representedOffice
    ) {
      throw Errors.badRequest(
        'Jabatan yang diwakili wajib diisi untuk penandatanganan a.n./u.b./Plt./Plh.'
      );
    }

    const signedAt = new Date();
    const payload: SignablePayload = {
      letterId: letter.id,
      letterNumber: letter.letterNumber,
      date: letter.date,
      type: letter.type,
      nature: letter.nature,
      subject: letter.subject,
      content: letter.content,
      unitId: letter.unitId,
      signerId: userId,
      signedAt,
      signingAuthorityForm: authorityForm,
      representedOffice,
    };

    /**
     * Berkas naskah `UPLOADED` harus milik rantai surat ini (CWE-639).
     *
     * Diperiksa sebelum apa pun ditandatangani atau ditulis: `fileUrl` dapat
     * menunjuk unggahan milik orang lain, dan yang ditandatangani adalah byte
     * berkas itu. Yang berhak adalah penyusun (pengunggah naskahnya) dan para
     * peninjau yang ditugaskan; berkas yang tidak tercatat pemiliknya ditolak,
     * sebab kepemilikannya tidak dapat dibuktikan.
     */
    if (letter.authoringTrack === LetterAuthoringTrack.UPLOADED) {
      await assertLetterUploadOwnedBy(letter.fileUrl, [
        letter.createdById,
        ...letter.reviewers.map((r) => r.reviewerId),
      ]);
    }

    let signed;
    try {
      signed = signPayload(toMaterial(key!), passphrase, payload);
    } catch (error) {
      if (error instanceof EsignError) {
        await recordFailedAttempt(key!.id, key!.failedAttempts);
        const left = MAX_PASSPHRASE_ATTEMPTS - (key!.failedAttempts + 1);
        throw Errors.unauthorized(
          left > 0
            ? `Passphrase tanda tangan salah. Sisa percobaan: ${left}.`
            : 'Passphrase salah. Kunci tanda tangan dikunci sementara.'
        );
      }
      throw error;
    }

    let result;
    try {
      result = await prisma.$transaction(
        async (tx) => {
          // Lock letter row and re-verify reviewer state under concurrency
          await tx.$executeRaw`SELECT id FROM letters WHERE id = ${letterId} FOR UPDATE`;

          const txLetter = await tx.letter.findUnique({
            where: { id: letterId },
            include: { reviewers: { orderBy: { order: 'asc' } } },
          });
          if (!txLetter) throw Errors.notFound('Surat tidak ditemukan');

          const txMine = txLetter.reviewers.find((r) => r.reviewerId === userId);
          if (!txMine?.isSigner) {
            throw Errors.forbidden('Anda bukan penandatangan surat ini.');
          }
          if (txLetter.status !== LetterStatus.READY_TO_SIGN) {
            throw Errors.badRequest(
              `Surat belum siap ditandatangani (status: ${txLetter.status}).`
            );
          }

          const pendingReviewers = txLetter.reviewers.filter((r) => r.status !== 'APPROVED');
          const pendingNonSigners = pendingReviewers.filter((r) => !r.isSigner);
          if (pendingNonSigners.length > 0) {
            throw Errors.forbidden(
              'Surat belum selesai ditinjau oleh seluruh pemeriksa/paraf sebelum ditandatangani.'
            );
          }

          const currentTurn = pendingReviewers[0];
          if (currentTurn && currentTurn.reviewerId !== userId) {
            throw Errors.forbidden(
              `Belum giliran Anda. Menunggu verifikator urutan ${currentTurn.order} terlebih dahulu.`
            );
          }

          const signature = await tx.letterSignature.create({
            data: {
              letterId: txLetter.id,
              signerId: userId,
              algorithm: signed.algorithm,
              publicKey: signed.publicKey,
              digest: signed.digest,
              signature: signed.signature,
              verificationToken: newVerificationToken(),
              signedAt,
              // Jabatan saat menandatangani, bukan jabatan orang itu hari ini:
              // kewenangan mencabut diukur terhadap naskah siapa ini, dan sebuah SK
              // yang ditandatangani Ketua tetap naskah Ketua walaupun
              // penandatangannya kemudian menjabat yang lain.
              signerRoleCode: signerRoleCode ?? null,
              // Garis kewenangan saat menandatangani. Milik baris tanda tangan,
              // bukan surat: bentuk yang dipakai saat itu tidak boleh berubah
              // setelahnya, dan nilainya ikut ditandatangani.
              signingAuthorityForm: authorityForm,
              representedOffice,
              canonicalVersion: signed.canonicalVersion,
            },
          });

          await tx.letterReviewer.update({
            where: { id: txMine.id },
            data: { status: 'APPROVED', reviewedAt: signedAt },
          });
          await tx.letter.update({
            where: { id: txLetter.id },
            data: { status: LetterStatus.SIGNED },
          });
          await tx.letterFlowEvent.create({
            data: {
              letterId: txLetter.id,
              actorId: userId,
              action: LetterFlowAction.SIGNED,
              fromStatus: txLetter.status,
              toStatus: LetterStatus.SIGNED,
              note: 'Ditandatangani secara elektronik.',
            },
          });

          /**
           * The PDF hash is part of signing, not an afterthought to it.
           *
           * This used to sit after the transaction inside a `try/catch` whose body
           * was a single `console.error`. When PDF generation failed for any
           * reason the letter was still committed as SIGNED with `pdfHash = NULL`
           * — and because uploading the PDF is the only supported way to verify a
           * letter, that letter could never be proven genuine again. Worse, the
           * public page does not say "our system had a problem"; it says the
           * document "tidak terdaftar dalam sistem resmi ... atau telah mengalami
           * perubahan". A genuine letter was publicly accused of being forged, and
           * nothing surfaced it.
           *
           * Generating inside the transaction means a failure rolls the signature
           * back and the signer sees an error, which is the honest outcome: either
           * a letter is signed and verifiable, or it is not signed at all.
           */
          const fullLetter = await tx.letter.findUnique({
            where: { id: letterId },
            include: {
              /**
               * Relasi yang dibaca penghasil PDF, dari satu tetapan bersama.
               *
               * Jalur ini dan jalur pengunduhan (`correspondence/signed-pdf`)
               * merender naskah yang sama, dan hash byte inilah yang menjadi dasar
               * verifikasi publik. Ketika `unit`, `attachments`, atau `recipients`
               * hanya diambil salah satunya, yang satu mencetak baris Lampiran dan
               * blok Tembusan sedangkan yang lain tidak — byte-nya berbeda, dan
               * surat yang sah dilaporkan kepada publik sebagai berubah.
               */
              ...LETTER_PDF_RELATIONS,
              signatures: {
                include: {
                  signer: {
                    // Nama saja: naskah tidak lagi mencetak NIP, dan mengambil
                    // yang tidak dicetak hanya menyebarkannya lebih jauh.
                    select: { name: true },
                  },
                },
              },
            },
          });
          if (!fullLetter) throw Errors.notFound('Surat tidak ditemukan');

          /**
           * Naskah yang ditandatangani, dari jalur penyusunannya.
           *
           * Dua jalur menghasilkan naskah yang ditandatangani, dan keduanya
           * harus menghasilkan **byte yang sama** di sini, saat ditandatangani,
           * dan di `signed-pdf`, saat diunduh — hash byte inilah dasar
           * verifikasi publik.
           *
           * - `GENERATED` (bawaan): sistem menyusun naskahnya dari isian
           *   formulir.
           * - `UPLOADED`: penyusun menyusun naskahnya di luar sistem lalu
           *   mengunggah PDF-nya. Byte unggahan itulah naskahnya, jadi yang
           *   ditandatangani adalah byte tersebut, ditambah cap visualisasi TTE
           *   (QR + keterangan) di halaman terakhir. Cap itu bagian dari byte
           *   yang di-hash, sehingga ia tidak dapat dilepas tanpa membatalkan
           *   tanda tangannya.
           *
           * Sebelum ini, jalur `UPLOADED` ada tetapi tidak pernah membaca
           * berkas unggahannya: yang di-hash adalah naskah hasil render sistem,
           * dan berkas penyusun hanya menempel sebagai "Berkas unggahan
           * penyusun". Dua dokumen berbeda dengan bobot yang sama, dan hanya
           * satu yang berlaku.
           */
          const isUploadedTrack = fullLetter.authoringTrack === LetterAuthoringTrack.UPLOADED;

          /**
           * Nama penanda tangan untuk cap, diambil dari relasi yang sudah
           * terbaca — bukan dari `signature`, yang hanya memuat kolomnya
           * sendiri tanpa relasi `signer`.
           */
          const signerName =
            fullLetter.signatures?.find((s) => s.id === signature.id)?.signer?.name ?? null;

          const pdfBuffer = isUploadedTrack
            ? await stampSignatureVisualisation(await readUploadedPdfBytes(fullLetter.fileUrl), {
                signedAt,
                signerName,
                signerTitle: fullLetter.senderTitle,
              })
            : await generateLetterPdfBuffer(fullLetter);

          /**
           * Penanda asal byte untuk pembaca arsip.
           *
           * `LETTER_PDF_GENERATOR` menyebut versi penghasil naskah; untuk jalur
           * unggahan, penghasilnya adalah penyusunnya sendiri, dan cap kita
           * yang menambahkan visualisasi. Menyimpan asalnya membuat sebuah
           * naskah dapat dibedakan tanpa membuka PDF-nya.
           */
          const generator = isUploadedTrack
            ? `${LETTER_PDF_GENERATOR}+unggahan`
            : LETTER_PDF_GENERATOR;

          const pdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
          const pdfSignature = signPdfHash(toMaterial(key!), passphrase, pdfHash);

          const withPdf = await tx.letterSignature.update({
            where: { id: signature.id },
            data: { pdfHash, pdfSignature },
          });

          /**
           * Byte-nya diarsipkan, bukan dijanjikan dapat dibuat ulang.
           *
           * `pdfHash` adalah SHA-256 dari byte ini, dan verifikasi publik bekerja
           * dengan menghitung ulang hash berkas yang diunggah. Sebelum ini tidak
           * ada berkas yang disimpan: setiap unduhan membuat ulang naskahnya, jadi
           * seluruh sistem verifikasi bertumpu pada janji bahwa penghasil PDF akan
           * mengeluarkan byte yang identik selamanya. Kenaikan versi `pdf-lib`,
           * satu spasi di kop surat, atau build ICU yang berbeda cukup untuk
           * membatalkan seluruh surat yang pernah ditandatangani sekaligus.
           *
           * Menaruhnya di dalam transaksi ini disengaja, dengan alasan yang sama
           * seperti hash-nya: sebuah surat SIGNED yang arsipnya gagal ditulis
           * adalah surat yang tidak dapat dicetak sesuai aslinya, dan itu bukan
           * keadaan yang boleh dibiarkan lolos diam-diam.
           */
          await tx.letterSignedDocument.create({
            data: {
              signatureId: signature.id,
              // Prisma `Bytes` menerima Uint8Array; Buffer Node tidak menyempit
              // ke `Uint8Array<ArrayBuffer>` karena bisa saja beralas
              // SharedArrayBuffer. Menyalinnya sekali jauh lebih murah daripada
              // sebuah `as`.
              bytes: new Uint8Array(pdfBuffer),
              sha256: pdfHash,
              byteSize: pdfBuffer.length,
              generator,
            },
          });

          return withPdf;
        },
        // Rendering the naskah is part of this transaction now; the default 5s
        // ceiling is tight for a multi-page letter on a cold container.
        { timeout: 20_000 }
      );
    } catch (e) {
      // An unrenderable naskah is the author's to fix, not a server fault.
      if (e instanceof LetterPdfError) throw Errors.badRequest(e.message);
      throw e;
    }

    await clearFailedAttempts(key!.id);

    return {
      id: result.id,
      verificationToken: result.verificationToken,
      signedAt: result.signedAt,
    };
  },

  /**
   * Ajukan pencabutan naskah dinas.
   *
   * Mengajukan dan memutuskan sengaja dipisah. Yang paling mungkin lebih dulu
   * menemukan nomor surat ganda adalah petugas tata usaha, bukan pejabat yang
   * berwenang mencabutnya — dan tanpa saluran ini ia tidak punya jalan sama
   * sekali selain memberi tahu secara lisan. Bentuknya sama dengan pencabutan
   * sertifikat pada RFC 5280 dan pada prosedur BSrE: pemohon menulis alasannya,
   * penerbit yang memutuskan.
   *
   * Siapa pun yang boleh membaca suratnya boleh mengajukan. Mengajukan tidak
   * mengubah apa pun pada suratnya.
   */
  async requestRevocation(
    letterId: string,
    actor: LetterActor,
    reason: string,
    attachmentUrl?: string
  ) {
    await assertLetterAccess(actor, letterId);

    let trimmed: string;
    try {
      trimmed = normalizeReason(reason);
    } catch (e) {
      throw asHttpError(e);
    }

    const letter = await prisma.letter.findUnique({
      where: { id: letterId },
      select: {
        id: true,
        letterNumber: true,
        subject: true,
        signatures: {
          orderBy: { signedAt: 'desc' },
          select: { id: true, signerId: true, signerRoleCode: true, revokedAt: true },
        },
      },
    });
    if (!letter) throw Errors.notFound('Surat tidak ditemukan');

    const target = letter.signatures[0] ?? null;
    if (!target) {
      throw Errors.badRequest('Surat ini belum ditandatangani secara elektronik.');
    }
    if (target.revokedAt) {
      throw Errors.badRequest('Naskah ini sudah dicabut sebelumnya.');
    }

    const pending = await prisma.letterRevocationRequest.findFirst({
      where: { signatureId: target.id, status: LetterRevocationRequestStatus.PENDING },
    });
    if (pending) {
      throw Errors.badRequest('Sudah ada permohonan pencabutan yang menunggu keputusan.');
    }

    const request = await prisma.letterRevocationRequest.create({
      data: {
        letterId: letter.id,
        signatureId: target.id,
        requesterId: actor.id,
        reason: trimmed,
        attachmentUrl,
      },
    });

    // Yang berwenang memutuskan diberi tahu; permohonan yang tidak sampai ke
    // mejanya sama saja dengan tidak ada saluran.
    const label = letter.letterNumber || letter.subject || 'Surat';
    for (const userId of await deciderIdsFor(target.signerId, target.signerRoleCode)) {
      if (userId === actor.id) continue;
      eventBus.emit('notification:send', {
        userId,
        type: 'WARNING',
        title: 'Permohonan Pencabutan Naskah Dinas',
        message: `Ada permohonan pencabutan atas ${label}: ${trimmed}`,
        data: { letterId: letter.id, requestId: request.id },
      });
    }

    return request;
  },

  /** Permohonan yang menunggu keputusan — hanya yang boleh diputus pemanggil. */
  async listRevocationRequests(actor: RevocationActor, status?: LetterRevocationRequestStatus) {
    const requests = await prisma.letterRevocationRequest.findMany({
      where: status ? { status } : undefined,
      include: {
        requester: { select: { id: true, name: true, email: true } },
        decidedBy: { select: { name: true } },
        letter: { select: { id: true, letterNumber: true, subject: true, date: true } },
        signature: {
          select: {
            id: true,
            signerId: true,
            signerRoleCode: true,
            revokedAt: true,
            signer: { select: { name: true } },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });

    // Menyaring di sini, bukan di basis data: kewenangan adalah aturan
    // kelembagaan yang tinggal di satu tabel yang dapat dibaca, bukan sebuah
    // klausa WHERE yang tersebar.
    return requests.filter((r) =>
      actorMayRevoke(
        {
          signerId: r.signature.signerId,
          signerRoleCode: r.signature.signerRoleCode,
          revokedAt: null,
        },
        actor
      )
    );
  },

  /**
   * Putuskan permohonan pencabutan.
   *
   * Menyetujui berarti mencabut, di sini dan sekarang, dengan passphrase
   * pemutusnya — jadi tidak ada keadaan "sudah disetujui tetapi belum dicabut"
   * yang bisa tertinggal.
   */
  async decideRevocation(
    requestId: string,
    actor: RevocationActor,
    approve: boolean,
    opts: { note?: string; passphrase?: string; reason?: string } = {}
  ) {
    const request = await prisma.letterRevocationRequest.findUnique({
      where: { id: requestId },
      include: {
        signature: { select: { id: true, signerId: true, signerRoleCode: true, revokedAt: true } },
      },
    });
    if (!request) throw Errors.notFound('Permohonan tidak ditemukan');
    if (request.status !== LetterRevocationRequestStatus.PENDING) {
      throw Errors.badRequest('Permohonan ini sudah diputuskan.');
    }

    try {
      assertSignatureRevocable(request.signature, actor);
    } catch (e) {
      throw asHttpError(e);
    }

    if (!approve) {
      const rejected = await prisma.letterRevocationRequest.update({
        where: { id: requestId },
        data: {
          status: LetterRevocationRequestStatus.REJECTED,
          decidedById: actor.id,
          decidedAt: new Date(),
          decisionNote: opts.note,
        },
      });
      eventBus.emit('notification:send', {
        userId: request.requesterId,
        type: 'INFO',
        title: 'Permohonan Pencabutan Ditolak',
        message: opts.note
          ? `Permohonan pencabutan ditolak: ${opts.note}`
          : 'Permohonan pencabutan naskah Anda ditolak.',
        data: { letterId: request.letterId, requestId },
      });
      return rejected;
    }

    if (!opts.passphrase) {
      throw Errors.badRequest('Passphrase tanda tangan Anda diperlukan untuk mencabut naskah.');
    }

    const revoked = await EsignService.revokeLetterSignature(
      request.letterId,
      actor,
      opts.reason ?? request.reason,
      opts.passphrase
    );

    const approved = await prisma.letterRevocationRequest.update({
      where: { id: requestId },
      data: {
        status: LetterRevocationRequestStatus.APPROVED,
        decidedById: actor.id,
        decidedAt: new Date(),
        decisionNote: opts.note,
        reason: opts.reason ?? request.reason,
      },
    });

    eventBus.emit('notification:send', {
      userId: request.requesterId,
      type: 'INFO',
      title: 'Permohonan Pencabutan Disetujui',
      message: 'Naskah yang Anda mohonkan telah dicabut.',
      data: { letterId: request.letterId, requestId },
    });

    return { ...approved, revocation: revoked };
  },

  /** Pemohon menarik permohonannya sendiri sebelum diputuskan. */
  async withdrawRevocationRequest(requestId: string, requesterId: string) {
    const request = await prisma.letterRevocationRequest.findUnique({ where: { id: requestId } });
    if (!request) throw Errors.notFound('Permohonan tidak ditemukan');
    if (request.requesterId !== requesterId) {
      throw Errors.forbidden('Hanya pemohon yang dapat menarik permohonannya.');
    }
    if (request.status !== LetterRevocationRequestStatus.PENDING) {
      throw Errors.badRequest('Permohonan ini sudah diputuskan.');
    }
    return prisma.letterRevocationRequest.update({
      where: { id: requestId },
      data: { status: LetterRevocationRequestStatus.WITHDRAWN },
    });
  },

  /**
   * Verifikasi publik lewat token QR.
   *
   * **Tidak pernah mengembalikan isi surat.** QR menempel pada lembar yang bisa
   * saja bertanda "Sangat Rahasia"; halaman yang menampilkan isinya kepada
   * siapa pun yang memindai justru membocorkan surat yang derajat
   * kerahasiaannya ada untuk mencegah hal itu. Yang dijawab hanyalah pertanyaan
   * yang memang ditanyakan pemindai: benar surat ini terbit dari Yayasan,
   * ditandatangani siapa, kapan, dan masih utuh atau tidak.
   *
   * Perihal pun hanya ditampilkan untuk surat bersifat Biasa.
   */
  /**
   * Inti aturan verifikasi yang dipakai bersama.
   *
   * **Tidak dirutekan sebagai endpoint publik.** Menjawab keabsahan dari sebuah
   * token saja berarti menyatakan sesuatu tentang dokumen yang tidak pernah
   * diperiksa; jalan masuk publik satu-satunya adalah `verifyByPdfBuffer`, yang
   * lebih dulu mengikat hash byte berkas yang diunggah. Fungsi ini dipanggil
   * dari sana setelah ikatan itu terbukti.
   */
  async verifyByToken(token: string) {
    return verifyLetterByToken(token);
  },

  /**
   * Verifikasi publik lewat buffer file PDF yang diunggah.
   *
   * Mencari token verifikasi atau mencocokkan rekaman tanda tangan di DB,
   * lalu memanggil verifyLetterByToken agar tetap menjaga aturan kerahasiaan.
   */
  async verifyByPdfBuffer(pdfBuffer: Buffer) {
    // 1. Calculate SHA-256 byte hash of uploaded PDF
    const uploadedHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

    // 2. Direct DB lookup by indexed pdfHash
    const signature = await prisma.letterSignature.findUnique({
      where: { pdfHash: uploadedHash },
      select: {
        verificationToken: true,
        publicKey: true,
        pdfHash: true,
        pdfSignature: true,
      },
    });

    if (!signature || !signature.pdfHash || !signature.pdfSignature) {
      /**
       * Berkas bercap DICABUT tidak dicari lewat `pdfHash`.
       *
       * Salinan yang diunduh setelah pencabutan membawa cap "DICABUT"
       * (`stampRevoked`), dan cap itu **mengubah byte-nya** — jadi hashnya tidak
       * akan pernah sama dengan `pdfHash` yang ditandatangani. Tanpa cabang ini,
       * berkas bercap resmi dari sistem sendiri dijawab "tidak terdaftar atau
       * telah diubah": naskah yang justru paling perlu dijelaskan statusnya
       * dituduh palsu. Persis kelas jawaban keliru yang dihindari di tempat lain.
       *
       * Pengenalan dilakukan dengan **membuat ulang capnya** dari byte arsip dan
       * membandingkan hash — bukan dengan mempercayai teks "DICABUT" di dalam
       * berkas, sebab teks itu dapat ditempel siapa saja ke PDF karangan.
       */
      const revoked = await matchRevokedCopy(pdfBuffer, uploadedHash);
      if (revoked) return EsignService.verifyByToken(revoked.verificationToken);

      return {
        found: false as const,
        isValid: false,
        isRevoked: false,
        reason:
          'Dokumen PDF tidak terdaftar dalam sistem resmi Yayasan Pesantren Cipansor atau telah mengalami perubahan.',
        letter: null,
        signer: null,
      };
    }

    // 3. Verify the Ed25519 signature over the *uploaded* byte hash. The row
    //    was fetched by `pdfHash === uploadedHash`, so the two are equal by
    //    construction; naming `uploadedHash` here keeps the binding explicit
    //    rather than reading back the same field we looked the row up by.
    const isSigValid = verifyPdfHashSignature(
      signature.publicKey,
      uploadedHash,
      signature.pdfSignature
    );

    if (!isSigValid) {
      return {
        found: false as const,
        isValid: false,
        isRevoked: false,
        reason: 'Tanda tangan digital pada dokumen PDF tidak valid atau telah dimanipulasi.',
        letter: null,
        signer: null,
      };
    }

    // 4. Ikatan dokumen sudah terbukti; baru sekarang aturan kerahasiaan dan
    //    status surat dijalankan lewat inti yang sama.
    return EsignService.verifyByToken(signature.verificationToken);
  },

  /**
   * Layanan status kunci publik (AATL ICA7).
   *
   * Menjawab pertanyaan yang tidak dapat dijawab oleh halaman verifikasi
   * dokumen: **"apakah kunci yang menandatangani surat ini masih berlaku?"**
   * Penerima yang memegang PDF menganggur — misalnya arsip lama — dapat
   * menanyakan sidik jari kunci yang tercetak di halaman verifikasi, tanpa
   * mengunggah ulang dokumennya.
   *
   * **Yang dijawab adalah kunci, bukan surat.** Masukannya sidik jari
   * (pengenal publik yang sudah tampil di halaman verifikasi), dan keluarannya
   * hanya keadaan kunci itu: aktif, kedaluwarsa, dicabut beserta sebabnya,
   * atau tidak dikenal. Tidak ada nomor surat, tidak ada perihal, tidak ada
   * nama penandatangan. Itulah yang membedakannya dari endpoint berbasis token
   * yang pernah dihapus: sebuah token dapat disisir untuk menemukan surat,
   * sedangkan sidik jari adalah turunan dari kunci publik yang memang sudah
   * dibagikan.
   *
   * Karena masukannya 32 byte acak, oracle "kunci ini terdaftar atau tidak"
   * tidak dapat disisir; yang membocorkan sesuatu hanyalah sidik jari yang
   * sudah diketahui pemanggil.
   *
   * **Kunci yang sudah digantikan tetap dijawab.** Penerbitan ulang kunci
   * menghapus baris `UserSigningKey`-nya, tetapi surat yang ditandatangani
   * dengannya masih menyimpan salinan kunci publik itu dan masih dapat
   * diverifikasi. Karena itu riwayatnya dibaca dari `signingKeyStatusRecords`
   * — tanpa itu, pemegang arsip melihat UNKNOWN untuk kunci yang sebenarnya
   * sekadar kedaluwarsa.
   */
  async publicKeyStatus(fingerprintInput: string, now = new Date()) {
    const fingerprint = normaliseFingerprint(fingerprintInput);

    const select = {
      algorithm: true,
      approvedAt: true,
      expiresAt: true,
      revokedAt: true,
      revocationCode: true,
    } as const;

    // Kunci aktif lebih dulu — ia yang menjawab status terkini bagi pemilik
    // yang masih memegang kuncinya. Bila tidak ada, jatuh ke riwayat.
    const active = await prisma.userSigningKey.findUnique({
      where: { fingerprint },
      select,
    });
    const key =
      active ??
      (await prisma.signingKeyStatusRecord.findUnique({ where: { fingerprint }, select }));

    if (!key) {
      return { found: false as const, status: 'UNKNOWN' as const };
    }

    const state = effectiveState(
      {
        revokedAt: key.revokedAt,
        approvedAt: key.approvedAt,
        expiresAt: key.expiresAt,
      },
      now
    );

    /**
     * Terjemahkan keadaan internal ke kode status publik.
     *
     * `PENDING_APPROVAL` sengaja menjadi `ACTIVE`: kunci yang belum disetujui
     * belum dapat menandatangani apa pun, sehingga tidak akan pernah muncul di
     * surat — membeberkan bahwa ada pengajuan yang tertunda hanya membocorkan
     * urusan internal.
     *
     * Kunci yang sudah digantikan (`active` null) tidak pernah dilaporkan
     * `ACTIVE`: kunci privatnya sudah dihapus, jadi ia tidak dapat
     * menandatangani naskah baru. Surat yang ditandatangani selama masa
     * berlakunya tetap sah — dan itu yang dijawab `EXPIRED`, bukan UNKNOWN.
     */
    const status =
      state === SigningKeyState.REVOKED
        ? ('REVOKED' as const)
        : state === SigningKeyState.EXPIRED || !active
          ? ('EXPIRED' as const)
          : ('ACTIVE' as const);

    return {
      found: true as const,
      status,
      algorithm: key.algorithm,
      /**
       * Sebab pencabutan publik (RFC 5280 §5.3.1). Hanya `KEY_COMPROMISE`
       * yang membuat surat-surat lama menjadi meragukan; sebab lain berarti
       * surat lama tetap sah. Karena itu kode ini wajib ikut — tanpa itu,
       * "DICABUT" menyamakan pemegang yang berhenti dengan kunci yang bocor.
       */
      revocationCode: key.revokedAt ? key.revocationCode : null,
      // Tanpa `revokedReason`: itu teks bebas yang ditulis Super Admin untuk
      // catatan internal ("diduga bocor dari komputer bersama", nama orang,
      // kejadian), dan endpoint ini terbuka tanpa masuk. Daftar pencabutan
      // RFC 5280 pun hanya membuka kodenya (§5.3.1); kode itulah yang
      // menjawab pertanyaan pembaca: apakah naskah lama masih sah.
      revokedAt: key.revokedAt,
      expiresAt: key.expiresAt,
    };
  },
};

export type { SigningKeyState };
