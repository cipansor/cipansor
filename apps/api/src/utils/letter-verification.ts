import { prisma } from '@/lib/prisma';
import {
  canonicalVersionOf,
  publicKeyFingerprint,
  verifyRevocation,
  verifySignature,
} from '@/utils/esign';

export async function verifyLetterByToken(token: string) {
  const signature = await prisma.letterSignature.findUnique({
    where: { verificationToken: token },
    select: {
      // Kunci publik dibaca agar sidik jarinya dapat ditampilkan — bukan untuk
      // mengirim kuncinya sendiri.
      publicKey: true,
      signerId: true,
      signedAt: true,
      revokedAt: true,
      revokedReason: true,
      revokedById: true,
      revokedByRoleCode: true,
      /**
       * Nama pencabut saat mencabut, supaya halaman ini menyebut nama yang sama
       * dengan yang tercetak pada salinan bercap DICABUT — bukan nama akun
       * pencabut hari ini, yang bisa sudah berganti.
       */
      revokedByName: true,
      revocationSignature: true,
      revocationPublicKey: true,
      signature: true,
      algorithm: true,
      digest: true,
      id: true,
      /**
       * Garis kewenangan penandatanganan. Ikut dibaca karena ia bagian dari
       * payload yang ditandatangani: verifier yang tidak meneruskannya akan
       * melaporkan setiap naskah a.n./u.b./Plt./Plh. sebagai berubah.
       */
      signingAuthorityForm: true,
      representedOffice: true,
      /**
       * Bentuk kanonik yang dipakai saat menandatangani. Wajib dibaca: sebuah
       * tanda tangan lama dibuat atas byte `v1` (tanpa ruas garis kewenangan),
       * dan memverifikasinya dengan `v2` menolak tanda tangan yang sah. Baris
       * yang belum memilikinya berarti `v1`.
       */
      canonicalVersion: true,
      /**
       * Nama dan jabatan saja — NIP tidak diambil, apalagi dikirim.
       *
       * Halaman verifikasi ini terbuka untuk umum. Yang perlu dijawabnya adalah
       * "benarkah naskah ini ditandatangani, oleh siapa, dan masih berlakukah"
       * — bukan "berapa nomor induk pegawainya". Nomor induk adalah keterangan
       * internal, dan sebuah endpoint publik yang mengembalikannya menjadikan
       * setiap surat yang beredar sebagai jalan mengumpulkannya.
       */
      signer: {
        select: {
          name: true,
          staff: { select: { position: true } },
        },
      },
      revokedBy: { select: { name: true } },
      letter: {
        select: {
          id: true,
          letterNumber: true,
          agendaNumber: true,
          date: true,
          type: true,
          nature: true,
          subject: true,
          content: true,
          status: true,
          authoringTrack: true,
          unitId: true,
          unit: { select: { name: true } },
        },
      },
    },
  });

  if (!signature) {
    return { found: false as const };
  }

  const l = signature.letter;
  const intact = verifySignature(
    signature.publicKey,
    signature.signature,
    {
      letterId: l.id,
      letterNumber: l.letterNumber,
      date: l.date,
      type: l.type,
      nature: l.nature,
      subject: l.subject,
      content: l.content,
      unitId: l.unitId,
      signerId: signature.signerId,
      signedAt: signature.signedAt,
      signingAuthorityForm: signature.signingAuthorityForm,
      representedOffice: signature.representedOffice,
    },
    canonicalVersionOf(signature.canonicalVersion)
  );

  const isPublicNature = l.nature === 'PUBLIC';
  const isValid = intact && !signature.revokedAt;

  /**
   * Pencabutannya sendiri dibuktikan, bukan sekadar dipercaya.
   *
   * Sebuah CRL adalah struktur data yang ditandatangani penerbitnya (RFC 5280),
   * dan pencabutan di sini pun begitu: pencabut menandatangani pernyataannya
   * dengan kuncinya sendiri. Halaman publik karena itu dapat mengatakan bahwa
   * pencabutan ini benar dinyatakan oleh pejabat yang namanya tercantum —
   * termasuk bahwa alasan yang terbaca itu memang alasan yang ditandatanganinya,
   * bukan teks yang disunting kemudian.
   *
   * Bernilai `null` untuk pencabutan yang tercatat sebelum tanda tangan
   * pencabutan diberlakukan; itu bukan kegagalan verifikasi, hanya ketiadaan
   * bukti tambahan.
   */
  let revocationVerified: boolean | null = null;
  if (signature.revokedAt) {
    if (signature.revocationSignature && signature.revocationPublicKey) {
      revocationVerified = verifyRevocation(
        signature.revocationPublicKey,
        {
          signatureId: signature.id,
          letterId: l.id,
          revokedById: signature.revokedById ?? '',
          revokedByRoleCode: signature.revokedByRoleCode ?? null,
          revokedAt: signature.revokedAt,
          reason: signature.revokedReason ?? '',
        },
        signature.revocationSignature
      );
    }
  }

  let reason: string | undefined;
  if (!intact) {
    reason = 'Isi naskah telah diubah setelah ditandatangani.';
  } else if (signature.revokedAt) {
    reason = signature.revokedReason
      ? `Naskah telah dicabut: ${signature.revokedReason}`
      : 'Naskah telah dicabut.';
  }

  return {
    found: true as const,
    valid: isValid,
    isValid,
    intact,
    revoked: !!signature.revokedAt,
    isRevoked: !!signature.revokedAt,
    revokedAt: signature.revokedAt,
    revokedReason: signature.revokedReason,
    revokedByName: signature.revokedByName ?? signature.revokedBy?.name ?? null,
    revocationVerified,
    letterNumber: l.letterNumber || l.agendaNumber || '-',
    letterType: l.type,
    nature: l.nature,
    // Hanya untuk surat biasa; selebihnya cukup dibuktikan keasliannya.
    subject: isPublicNature ? l.subject : null,
    date: l.date,
    unitName: l.unit?.name ?? null,
    signerName: signature.signer.name,
    signer: {
      name: signature.signer.name,
      position: signature.signer.staff?.position || 'Pejabat / Guru Yayasan',
    },
    /**
     * Garis kewenangan yang dinyatakan penanda tangan, dibaca dari rekaman
     * tanda tangannya — bukan dari kolom surat, karena inilah nilai yang ikut
     * ditandatangani dan yang tercetak pada naskahnya.
     */
    signingAuthorityForm: signature.signingAuthorityForm,
    representedOffice: signature.representedOffice,
    letter: {
      letterNumber: l.letterNumber || l.agendaNumber || '-',
      subject: isPublicNature ? l.subject : null,
      date: l.date,
      status: l.status,
      unitName: l.unit?.name ?? '-',
      /**
       * Bukan rincian teknis, melainkan bagian dari jawabannya.
       *
       * Verifikasi ini membuktikan satu hal dengan pasti: byte yang diunggah
       * pembaca adalah byte yang ditandatangani. Apa yang dibuktikannya
       * *tentang buku agenda* berbeda menurut jalur penyusunannya — pada
       * naskah GENERATED metadata dan isinya berasal dari satu sumber
       * sehingga tidak mungkin berselisih, sedangkan pada naskah UPLOADED
       * tidak ada pemeriksaan yang dapat menjamin itu. Halaman yang
       * menampilkan keduanya dengan kalimat yang sama menjanjikan lebih
       * daripada yang dibuktikannya.
       */
      authoringTrack: l.authoringTrack,
    },
    signedAt: signature.signedAt,
    algorithm: signature.algorithm,
    digest: signature.digest,
    /**
     * Sidik jari kunci yang menandatangani naskah ini — bukan kunci hari ini,
     * melainkan kunci yang tersalin pada rekaman tanda tangannya. Sama seperti
     * sidik jari sertifikat (RFC 5280 §4.2.1.2): pembaca dapat mencatatnya
     * sekali dan membandingkannya pada setiap naskah berikutnya dari orang
     * yang sama.
     */
    signerKeyFingerprint: publicKeyFingerprint(signature.publicKey),
    reason,
  };
}
