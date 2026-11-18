import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as service from '../data-subject-requests.service';
import { prisma } from '@/lib/prisma';
import { notificationService } from '@/modules/notifications';
import fs from 'fs/promises';

vi.mock('fs/promises', () => ({ default: { unlink: vi.fn() } }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    dataSubjectRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    registrant: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    student: { findUnique: vi.fn(), update: vi.fn() },
    studentParent: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    registrantDocument: {
      updateMany: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn(),
    },
    studentDocument: {
      count: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
    // `FOR UPDATE` mengunci baris lewat `$executeRaw`; mock harus punya
    // permukaannya, karena `tx` di sini adalah klien yang sama.
    $executeRaw: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock('@/modules/notifications', () => ({
  notificationService: { send: vi.fn().mockResolvedValue({ success: true }) },
}));

/** `$transaction(fn)` menjalankan `fn` dengan klien yang sama — cukup untuk uji. */
function txPassThrough() {
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: any) => fn(prisma)) as any);
}

const registrantRow = (over: Record<string, unknown> = {}) => ({
  id: 'reg-1',
  fullName: 'Ahmad Fauzi',
  name: 'Ahmad',
  registrationNo: 'SPMB-2026-0001',
  birthDate: new Date('2014-03-05T00:00:00.000Z'),
  phone: '081200000001',
  email: 'wali@example.com',
  parentPhone: '081200000002',
  parentEmail: 'ayah@example.com',
  ...over,
});

const requestRow = (over: Record<string, unknown> = {}) => ({
  id: 'dsr-1',
  requestNo: 'DSR-2026-0001',
  type: 'ACCESS',
  status: 'RECEIVED',
  subjectCategory: 'REGISTRANT',
  subjectLabel: 'Ahmad Fauzi (No. SPMB-2026-0001)',
  subjectUserId: null,
  subjectStudentId: null,
  subjectRegistrantId: 'reg-1',
  requesterUserId: null,
  requesterName: 'Siti',
  requesterContact: '081200000002',
  requesterRelation: 'Ibu',
  detail: 'Mohon salinan data pendaftaran anak saya.',
  rejectionReason: null,
  dueAt: new Date('2026-11-20T00:00:00.000Z'),
  completedAt: null,
  verifiedAt: null,
  verificationCodeHash: null,
  verificationExpiresAt: null,
  verificationAttempts: 0,
  handledById: null,
  handledBy: null,
  subjectStudent: null,
  subjectRegistrant: null,
  subjectUser: null,
  actions: [],
  createdAt: new Date('2026-11-17T00:00:00.000Z'),
  updatedAt: new Date('2026-11-17T00:00:00.000Z'),
  ...over,
});

describe('data-subject-requests — tenggat', () => {
  it('akses, koreksi, dan penarikan persetujuan diberi 3×24 jam', () => {
    const now = new Date('2026-11-17T00:00:00.000Z');
    for (const type of ['ACCESS', 'RECTIFICATION', 'CONSENT_WITHDRAWAL'] as const) {
      expect(service.computeDueAt(type, now).toISOString()).toBe('2026-11-20T00:00:00.000Z');
    }
  });

  it('penghapusan mengikuti tinjauan retensi, bukan 72 jam', () => {
    // Pasal 43–44 membatasi penghapusan pada kewajiban retensi, jadi tenggatnya
    // bukan hitungan jam yang sama dengan akses — permintaan yang masuk Jumat
    // pun tidak boleh dipaksa selesai dalam tiga hari kalender.
    const now = new Date('2026-11-17T00:00:00.000Z');
    const due = service.computeDueAt('ERASURE', now);
    expect(due.getTime()).toBeGreaterThan(service.computeDueAt('ACCESS', now).getTime());
    expect(due.toISOString()).toBe('2026-12-17T00:00:00.000Z');
  });
});

describe('data-subject-requests — penyamaran kontak', () => {
  it('menyisakan empat karakter terakhir saja', () => {
    // Telepon: empat angka terakhir saja. Surel: huruf awal dan domainnya,
    // sebab justru bagian lokalnya yang mengidentifikasi orang.
    expect(service.maskContact('081200000078')).toBe('••••••••0078');
    expect(service.maskContact('ayah@example.com')).toBe('a•••@example.com');
  });

  it('tidak membocorkan kontak pendek', () => {
    expect(service.maskContact('0812')).toBe('••••');
  });
});

describe('data-subject-requests — pengajuan publik', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txPassThrough();
  });

  const input = {
    type: 'ACCESS' as const,
    registrationNo: 'SPMB-2026-0001',
    birthDate: new Date('2014-03-05T00:00:00.000Z'),
    requesterName: 'Siti Aminah',
    requesterContact: '081200000002',
    detail: 'Mohon salinan data pendaftaran anak saya.',
  };

  it('tidak mengungkap data subjek sebelum verifikasi', async () => {
    vi.mocked(prisma.registrant.findUnique).mockResolvedValue(registrantRow() as any);
    vi.mocked(prisma.dataSubjectRequest.count).mockResolvedValue(0);
    vi.mocked(prisma.dataSubjectRequest.create).mockResolvedValue({
      requestNo: 'DSR-2026-0001',
      dueAt: new Date('2026-11-20T00:00:00.000Z'),
    } as any);

    const result = await service.submitPublicRequest(input);

    expect(Object.keys(result).sort()).toEqual(['dueAt', 'requestNo', 'verificationSentTo']);
    // Kontak terdaftar disamarkan; nomor pendaftaran dan tanggal lahir tidak
    // dikembalikan sama sekali.
    expect(result.verificationSentTo).not.toContain('081200000002');
  });

  it('mengirim kode ke kontak TERDAFTAR, bukan kontak yang ditulis pemohon', async () => {
    vi.mocked(prisma.registrant.findUnique).mockResolvedValue(registrantRow() as any);
    vi.mocked(prisma.dataSubjectRequest.count).mockResolvedValue(0);
    vi.mocked(prisma.dataSubjectRequest.create).mockResolvedValue({
      requestNo: 'DSR-2026-0001',
      dueAt: new Date('2026-11-20T00:00:00.000Z'),
    } as any);

    await service.submitPublicRequest({ ...input, requesterContact: 'penyerang@example.com' });

    const sent = vi.mocked(notificationService.send).mock.calls[0][0] as any;
    expect(sent.recipientPhone).toBe('081200000002');
    expect(JSON.stringify(sent)).not.toContain('penyerang@example.com');
  });

  it('menjawab galat yang sama untuk nomor tidak ada dan tanggal lahir salah', async () => {
    vi.mocked(prisma.registrant.findUnique).mockResolvedValueOnce(null as any);
    const missing = await service.submitPublicRequest(input).catch((e) => e);

    vi.mocked(prisma.registrant.findUnique).mockResolvedValueOnce(
      registrantRow({ birthDate: new Date('2015-01-01T00:00:00.000Z') }) as any
    );
    const wrongDate = await service.submitPublicRequest(input).catch((e) => e);

    // Membedakan keduanya menjadikan endpoint ini alat untuk memeriksa apakah
    // sebuah nomor pendaftaran benar-benar ada, tanpa perlu memegang datanya.
    expect(missing.statusCode).toBe(wrongDate.statusCode);
    expect(missing.message).toBe(wrongDate.message);
    expect(prisma.dataSubjectRequest.create).not.toHaveBeenCalled();
  });

  it('menolak permintaan tanpa kontak terdaftar, sebab tidak ada yang dapat diverifikasi', async () => {
    vi.mocked(prisma.registrant.findUnique).mockResolvedValue(
      registrantRow({ phone: null, email: null, parentPhone: null, parentEmail: null }) as any
    );

    await expect(service.submitPublicRequest(input)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(prisma.dataSubjectRequest.create).not.toHaveBeenCalled();
  });
});

describe('data-subject-requests — verifikasi kode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txPassThrough();
  });

  const future = new Date(Date.now() + 10 * 60 * 1000);

  it('menolak kode kedaluwarsa', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        verificationCodeHash: 'a'.repeat(64),
        verificationExpiresAt: new Date(Date.now() - 1000),
      }) as any
    );

    await expect(
      service.verifyPublicRequest({ requestNo: 'DSR-2026-0001', code: '123456' })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.dataSubjectRequest.update).not.toHaveBeenCalled();
  });

  it('berhenti menerima percobaan setelah batasnya tercapai', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        verificationCodeHash: 'a'.repeat(64),
        verificationExpiresAt: future,
        verificationAttempts: 5,
      }) as any
    );

    await expect(
      service.verifyPublicRequest({ requestNo: 'DSR-2026-0001', code: '123456' })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('mencatat percobaan yang gagal, sehingga batasnya bermakna', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        verificationCodeHash: 'a'.repeat(64),
        verificationExpiresAt: future,
        verificationAttempts: 2,
      }) as any
    );

    await expect(
      service.verifyPublicRequest({ requestNo: 'DSR-2026-0001', code: '000000' })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(prisma.dataSubjectRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { verificationAttempts: 3 } })
    );
  });

  it('kenaikan hitungan bertahan walau kode salah (galat dilempar setelah commit)', async () => {
    // Galat yang dilempar DARI DALAM `$transaction` membatalkan kenaikan
    // `verificationAttempts`, sehingga batas lima percobaan tidak pernah
    // tersimpan dan kode dapat ditebak selama masa berlakunya. Uji ini
    // memastikan penulisan itu terjadi di dalam transaksi yang DIKUKUHKAN:
    // transaksinya mengembalikan penanda, galatnya menyusul di luar.
    let committed = false;
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: any) => {
      const result = await fn(prisma);
      committed = true;
      return result;
    }) as any);
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        verificationCodeHash: 'a'.repeat(64),
        verificationExpiresAt: future,
        verificationAttempts: 0,
      }) as any
    );

    await expect(
      service.verifyPublicRequest({ requestNo: 'DSR-2026-0001', code: '000000' })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(committed, 'transaksi harus dikukuhkan, bukan dibatalkan oleh throw').toBe(true);
    expect(prisma.dataSubjectRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { verificationAttempts: 1 } })
    );
  });

  it('membuang kode setelah dipakai, dan tidak menerimanya lagi', async () => {
    // Hash dibuat dari kode yang sama dengan yang diuji.
    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256').update('123456').digest('hex');
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        verificationCodeHash: hash,
        verificationExpiresAt: future,
        status: 'RECEIVED',
      }) as any
    );
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue({
      requestNo: 'DSR-2026-0001',
      status: 'VERIFIED',
      dueAt: new Date('2026-11-20T00:00:00.000Z'),
    } as any);

    const result = await service.verifyPublicRequest({
      requestNo: 'DSR-2026-0001',
      code: '123456',
    });

    expect(result.status).toBe('VERIFIED');
    expect(prisma.dataSubjectRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'VERIFIED',
          verificationCodeHash: null,
          verificationExpiresAt: null,
        }),
      })
    );
  });
});

describe('data-subject-requests — daftar petugas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.dataSubjectRequest.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.dataSubjectRequest.count).mockResolvedValue(0 as any);
  });

  /** Penyaring yang benar-benar dikirim ke Prisma. */
  const whereOf = () => vi.mocked(prisma.dataSubjectRequest.findMany).mock.calls[0][0]!.where;

  it('memakai status yang dipilih petugas, bukan menggantinya dengan "belum selesai"', async () => {
    // Sebelumnya `openOnly` menimpa pilihan status, sehingga memilih "Diterima"
    // tetap menampilkan "Diproses".
    await service.listRequests({ status: 'RECEIVED', openOnly: true, page: 1, limit: 50 });
    expect(whereOf()).toMatchObject({ status: 'RECEIVED' });
  });

  it('mengosongkan hasil untuk kombinasi yang tidak punya irisan', async () => {
    // Status terminal bersama "hanya yang belum selesai" tidak beririsan:
    // jawabannya daftar kosong, bukan daftar yang membantah penyaringnya.
    await service.listRequests({ status: 'COMPLETED', openOnly: true, page: 1, limit: 50 });
    expect(whereOf()).toMatchObject({ status: { in: [] } });
  });

  it('membatasi permintaan terlambat pada yang belum selesai', async () => {
    await service.listRequests({ overdueOnly: true, page: 1, limit: 50 });
    expect(whereOf()).toMatchObject({
      status: { notIn: ['COMPLETED', 'REJECTED'] },
      dueAt: { lt: expect.any(Date) },
    });
  });

  it('menggabungkan status pilihan dengan penyaring terlambat, bukan memilih salah satu', async () => {
    await service.listRequests({
      status: 'PROCESSING',
      overdueOnly: true,
      page: 1,
      limit: 50,
    });
    expect(whereOf()).toMatchObject({
      status: 'PROCESSING',
      dueAt: { lt: expect.any(Date) },
    });
  });
});

describe('data-subject-requests — pelaksanaan hak saat ditutup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txPassThrough();
  });

  const actor = { userId: 'officer-1', name: 'Petugas PDP' };

  it('menolak menutup permintaan publik yang belum terverifikasi', async () => {
    // Permintaan publik tanpa `requesterUserId` dan tanpa `verifiedAt`: siapa
    // pun boleh mengisi nomor pendaftaran orang lain, jadi efek penutupan
    // (penghapusan, penyerahan salinan) tidak boleh berjalan atas namanya
    // sebelum kepemilikan kontaknya terbukti (Pasal 33).
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({ type: 'ERASURE', status: 'PROCESSING', requesterUserId: null }) as any
    );

    await expect(
      service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.dataSubjectRequest.update).not.toHaveBeenCalled();
  });

  it('menutup permintaan publik yang sudah terverifikasi', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        // RECTIFICATION tidak punya efek samping saat ditutup; yang diuji di
        // sini adalah gerbang verifikasinya, bukan pekerjaan penghapusan.
        type: 'RECTIFICATION',
        status: 'PROCESSING',
        requesterUserId: null,
        verifiedAt: new Date('2026-11-18T00:00:00.000Z'),
      }) as any
    );
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'RECTIFICATION', status: 'COMPLETED' }) as any
    );

    await expect(
      service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor)
    ).resolves.toBeTruthy();
  });

  it('memberi tahu pemohon dengan label status berbahasa Indonesia, bukan nilai mesin', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'RECTIFICATION',
        status: 'PROCESSING',
        requesterUserId: 'user-1',
      }) as any
    );
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'RECTIFICATION', status: 'REJECTED' }) as any
    );

    await service.updateStatus('dsr-1', { status: 'REJECTED', note: 'Dokumen kurang' }, actor);

    const sent = vi.mocked(notificationService.send).mock.calls[0][0] as any;
    expect(sent.title).toBe('Permintaan DSR-2026-0001 kini Ditolak');
    expect(sent.title).not.toContain('REJECTED');
    expect(sent.message).toContain('Alasan: Dokumen kurang');
  });

  it('penarikan persetujuan menghentikan pemrosesan tanpa menghapus bukti persetujuan', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'CONSENT_WITHDRAWAL',
        status: 'PROCESSING',
        // Diajukan lewat portal oleh pemohon yang sudah masuk: identitasnya
        // sudah terbukti, jadi tidak ada langkah verifikasi kode yang menahan.
        requesterUserId: 'usr-1',
      }) as any
    );
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'CONSENT_WITHDRAWAL', status: 'COMPLETED' }) as any
    );

    await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    const call = vi.mocked(prisma.registrant.update).mock.calls[0][0] as any;
    expect(call.data.consentWithdrawnAt).toBeInstanceOf(Date);
    // Pasal 21 menuntut kemampuan menunjukkan persetujuan pernah ada; kolom
    // buktinya tidak boleh ikut dihapus.
    expect(call.data).not.toHaveProperty('consentAt');
    expect(call.data).not.toHaveProperty('consentVersion');
  });

  it('penghapusan menghapus penanda langsung dan mempertahankan yang diwajibkan retensi', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'ERASURE',
        status: 'PROCESSING',
        requesterUserId: 'usr-1',
        subjectCategory: 'STUDENT',
        subjectRegistrantId: null,
        subjectStudentId: 'stu-1',
      }) as any
    );
    vi.mocked(prisma.student.findUnique).mockResolvedValue({
      id: 'stu-1',
      userId: 'usr-1',
      photoUrl: 'https://cdn/foto.jpg',
    } as any);
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ERASURE', status: 'COMPLETED' }) as any
    );

    await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    const student = vi.mocked(prisma.student.update).mock.calls[0][0] as any;
    expect(student.data.photoUrl).toBeNull();
    expect(student.data.parentPhone).not.toContain('0812');
    // NIS dipertahankan: rapor dan buku induk menunjuknya, dan ia hanya unik
    // per unit. NISN dibuang karena unik nasional.
    expect(student.data).not.toHaveProperty('nis');
    expect(student.data.nisn).toBeNull();

    const user = vi.mocked(prisma.user.update).mock.calls[0][0] as any;
    expect(user.data.isActive).toBe(false);
    expect(user.data.passwordHash).toBeNull();

    const audit = vi.mocked(prisma.auditLog.create).mock.calls[0][0] as any;
    expect(audit.data.action).toBe('ERASURE');
    // Apa yang dihapus DAN apa yang dipertahankan dicatat dengan kata-kata,
    // supaya batasnya dapat diperiksa, bukan tersembunyi sebagai perilaku.
    expect(audit.data.newValues.retained).toContain('nilai');
    expect(audit.data.newValues.erased).toContain('identitas santri');
  });

  it('tidak menghapus berkas yang masih ditunjuk baris lain (CWE-639)', async () => {
    // Penyerang menempelkan URL unggahan orang lain pada dokumennya sendiri,
    // lalu meminta penghapusan. Berkasnya masih ditunjuk baris lain, jadi
    // penghapusan harus dilewati — kalau tidak, petugas menghapus data korban.
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'ERASURE',
        status: 'PROCESSING',
        requesterUserId: 'usr-1',
        subjectCategory: 'STUDENT',
        subjectStudentId: 'stu-1',
        subjectRegistrantId: null,
      }) as any
    );
    vi.mocked(prisma.student.findUnique).mockResolvedValue({
      id: 'stu-1',
      userId: 'usr-1',
      photoUrl: 'https://portal.cipansor.or.id/uploads/berkas-korban.pdf',
    } as any);
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ERASURE', status: 'COMPLETED' }) as any
    );
    // Masih ada satu baris (mis. dokumen korban) yang menunjuk berkas yang sama.
    vi.mocked(prisma.studentDocument.count).mockResolvedValue(1);

    await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    expect(fs.unlink).not.toHaveBeenCalled();
  });

  it('menghapus berkas yang sudah tidak ditunjuk siapa pun', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'ERASURE',
        status: 'PROCESSING',
        requesterUserId: 'usr-1',
        subjectCategory: 'STUDENT',
        subjectStudentId: 'stu-1',
        subjectRegistrantId: null,
      }) as any
    );
    vi.mocked(prisma.student.findUnique).mockResolvedValue({
      id: 'stu-1',
      userId: 'usr-1',
      photoUrl: 'https://portal.cipansor.or.id/uploads/foto-santri.jpg',
    } as any);
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ERASURE', status: 'COMPLETED' }) as any
    );
    vi.mocked(prisma.studentDocument.count).mockResolvedValue(0);
    vi.mocked(fs.unlink).mockResolvedValue(undefined as never);

    await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    expect(fs.unlink).toHaveBeenCalledTimes(1);
  });

  it('penghapusan santri ikut menghapus pendaftaran SPMB yang menunjuknya', async () => {
    // `Registrant.studentId` diisi saat onboarding; baris pendaftaran menyimpan
    // salinan penuh data anak dan orang tuanya. Menghapus `Student` saja
    // meninggalkan salinan itu terbaca setelah permintaan dinyatakan selesai.
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'ERASURE',
        status: 'PROCESSING',
        requesterUserId: 'usr-1',
        subjectCategory: 'STUDENT',
        subjectStudentId: 'stu-1',
        subjectRegistrantId: null,
      }) as any
    );
    vi.mocked(prisma.student.findUnique).mockResolvedValue({
      id: 'stu-1',
      userId: 'usr-1',
      photoUrl: null,
    } as any);
    vi.mocked(prisma.registrant.findMany).mockResolvedValue([{ id: 'reg-1' }] as any);
    vi.mocked(prisma.registrantDocument.findMany).mockResolvedValue([
      { fileUrl: 'https://portal.cipansor.or.id/uploads/akta.pdf' },
    ] as any);
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ERASURE', status: 'COMPLETED' }) as any
    );

    await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    const registrant = vi.mocked(prisma.registrant.update).mock.calls[0][0] as any;
    expect(registrant.where.id).toBe('reg-1');
    expect(registrant.data.parentPhone).not.toContain('0812');
    // Berkas pendaftaran yang tertinggal ikut dijadwalkan untuk dihapus.
    expect(prisma.registrantDocument.updateMany).toHaveBeenCalled();
  });

  it('penghapusan pendaftar ikut menghapus santri yang tertaut', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'ERASURE',
        status: 'PROCESSING',
        requesterUserId: 'usr-1',
        subjectCategory: 'REGISTRANT',
        subjectStudentId: null,
        subjectRegistrantId: 'reg-1',
      }) as any
    );
    vi.mocked(prisma.registrant.findUnique).mockResolvedValue({ studentId: 'stu-1' } as any);
    vi.mocked(prisma.student.findUnique).mockResolvedValue({
      id: 'stu-1',
      userId: 'usr-2',
      photoUrl: null,
    } as any);
    vi.mocked(prisma.registrant.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ERASURE', status: 'COMPLETED' }) as any
    );

    await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    expect(vi.mocked(prisma.student.update).mock.calls[0][0]).toMatchObject({
      where: { id: 'stu-1' },
    });
  });

  it('menghapus berkas dokumen santri dan mengosongkan penunjuknya', async () => {
    // Akta, KK, KTP orang tua, rapor, pas foto hidup di `StudentDocument`.
    // Mengosongkan `Student.photoUrl` saja meninggalkan berkas-berkas itu
    // terbaca oleh siapa pun yang menyimpan URL lamanya.
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'ERASURE',
        status: 'PROCESSING',
        requesterUserId: 'usr-1',
        subjectCategory: 'STUDENT',
        subjectStudentId: 'stu-1',
        subjectRegistrantId: null,
      }) as any
    );
    vi.mocked(prisma.student.findUnique).mockResolvedValue({
      id: 'stu-1',
      userId: 'usr-1',
      photoUrl: null,
    } as any);
    vi.mocked(prisma.studentDocument.findMany).mockResolvedValue([
      { fileUrl: 'https://portal.cipansor.or.id/uploads/akta.pdf' },
      { fileUrl: 'https://portal.cipansor.or.id/uploads/kk.pdf' },
    ] as any);
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ERASURE', status: 'COMPLETED' }) as any
    );
    vi.mocked(prisma.studentDocument.count).mockResolvedValue(0);
    vi.mocked(fs.unlink).mockResolvedValue(undefined as never);

    await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    // Barisnya ditandai terhapus dan penunjuknya dikosongkan.
    const cleared = vi.mocked(prisma.studentDocument.updateMany).mock.calls[0][0] as any;
    expect(cleared.where.studentId).toBe('stu-1');
    expect(cleared.data.fileUrl).toBe('');
    expect(cleared.data.deletedAt).toBeInstanceOf(Date);
    // Berkasnya benar-benar dihapus dari penyimpanan.
    expect(fs.unlink).toHaveBeenCalledTimes(2);
  });

  it('mempertahankan arsip akademik (rapor, ijazah) saat penghapusan santri', async () => {
    // Rapor dan ijazah masih wajib disimpan (retensi), sama seperti nilai dan
    // kehadiran. Penghapusan hanya memutus kaitan identitasnya; arsipnya tidak
    // boleh kehilangan penunjuk maupun berkasnya. Pemilihan dan pembaruan
    // harus memakai predikat yang sama, jadi keduanya diuji.
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'ERASURE',
        status: 'PROCESSING',
        requesterUserId: 'usr-1',
        subjectCategory: 'STUDENT',
        subjectStudentId: 'stu-1',
        subjectRegistrantId: null,
      }) as any
    );
    vi.mocked(prisma.student.findUnique).mockResolvedValue({
      id: 'stu-1',
      userId: 'usr-1',
      photoUrl: null,
    } as any);
    // Hanya dokumen identitas yang boleh dihapus yang dikembalikan penyaring.
    vi.mocked(prisma.studentDocument.findMany).mockResolvedValue([
      { fileUrl: 'https://portal.cipansor.or.id/uploads/akta.pdf' },
    ] as any);
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ERASURE', status: 'COMPLETED' }) as any
    );
    vi.mocked(prisma.studentDocument.count).mockResolvedValue(0);
    vi.mocked(fs.unlink).mockResolvedValue(undefined as never);

    await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    // Kedua permintaan ke `studentDocument` mengecualikan jenis arsip.
    for (const call of [
      vi.mocked(prisma.studentDocument.findMany).mock.calls[0][0],
      vi.mocked(prisma.studentDocument.updateMany).mock.calls[0][0],
    ] as any[]) {
      expect(call.where.documentType.notIn).toEqual(
        expect.arrayContaining(['REPORT_CARD', 'DIPLOMA'])
      );
    }
    // Hanya berkas identitas yang dihapus dari penyimpanan.
    expect(fs.unlink).toHaveBeenCalledTimes(1);
  });

  it('mempertahankan rapor dan ijazah pendaftar saat penghapusan', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'ERASURE',
        status: 'PROCESSING',
        requesterUserId: 'usr-1',
        subjectCategory: 'REGISTRANT',
        subjectStudentId: null,
        subjectRegistrantId: 'reg-1',
      }) as any
    );
    vi.mocked(prisma.registrant.findUnique).mockResolvedValue({ studentId: null } as any);
    vi.mocked(prisma.registrantDocument.findMany).mockResolvedValue([
      { fileUrl: 'https://portal.cipansor.or.id/uploads/kk.pdf' },
    ] as any);
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ERASURE', status: 'COMPLETED' }) as any
    );
    vi.mocked(fs.unlink).mockResolvedValue(undefined as never);

    await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    for (const call of [
      vi.mocked(prisma.registrantDocument.findMany).mock.calls[0][0],
      vi.mocked(prisma.registrantDocument.updateMany).mock.calls[0][0],
    ] as any[]) {
      expect(call.where.type.notIn).toEqual(expect.arrayContaining(['rapor', 'ijazah']));
    }
  });

  it('permintaan yang sudah selesai tidak dapat diubah lagi', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({ status: 'COMPLETED' }) as any
    );

    await expect(
      service.updateStatus('dsr-1', { status: 'PROCESSING' }, actor)
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('permintaan akses yang ditutup menghasilkan salinan data, tanpa menyimpannya', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({ type: 'ACCESS', status: 'PROCESSING', requesterUserId: 'usr-1' }) as any
    );
    vi.mocked(prisma.registrant.findUnique).mockResolvedValue({
      registrationNo: 'SPMB-2026-0001',
      fullName: 'Ahmad Fauzi',
      gender: 'MALE',
      birthPlace: 'Bandung',
      birthDate: new Date('2014-03-05T00:00:00.000Z'),
      address: 'Jl. Contoh 1',
      phone: '0812',
      email: 'a@example.com',
      previousSchool: 'SD Contoh',
      parentName: 'Bapak',
      parentPhone: '0813',
      parentEmail: 'b@example.com',
      status: 'REGISTERED',
      consentAt: new Date('2026-01-01T00:00:00.000Z'),
      consentVersion: 2,
      consentWithdrawnAt: null,
      documents: [{ name: 'Akta', type: 'akta', isVerified: true }],
    } as any);
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ACCESS', status: 'COMPLETED' }) as any
    );

    const result = await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    expect(result.exportPayload).toMatchObject({
      subjectCategory: 'REGISTRANT',
      personalData: expect.objectContaining({ registrationNo: 'SPMB-2026-0001' }),
    });
    // Dasar pemrosesan ikut diserahkan: Pasal 30 menuntut yang bersangkutan
    // dapat mengetahui dasar dan tujuan pemrosesan, bukan hanya isinya.
    expect(JSON.stringify(result.exportPayload)).toContain('Pasal');
  });
});

describe('data-subject-requests — jalur wali', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txPassThrough();
  });

  const guardianInput = (over: Record<string, unknown> = {}) => ({
    type: 'ACCESS' as const,
    subjectCategory: 'STUDENT' as const,
    subjectStudentId: 'stu-1',
    detail: 'Mohon salinan data anak saya untuk keperluan sekolah.',
    ...over,
  });

  const guardianActor = { userId: 'wali-1', name: 'Bapak Wali', hasPdpPermission: false };

  it('wali dengan tautan StudentParent dapat mengajukan untuk santri tanggungannya', async () => {
    vi.mocked(prisma.student.findUnique).mockResolvedValue({
      id: 'stu-1',
      nis: '2024001',
      userId: 'usr-1',
      user: { name: 'Ahmad' },
    } as any);
    // Tautan wali -> santri ada.
    vi.mocked(prisma.studentParent.findUnique).mockResolvedValue({ id: 'link-1' } as any);
    vi.mocked(prisma.dataSubjectRequest.count).mockResolvedValue(0);
    vi.mocked(prisma.dataSubjectRequest.create).mockResolvedValue(
      requestRow({
        subjectCategory: 'STUDENT',
        subjectStudentId: 'stu-1',
        subjectRegistrantId: null,
        requesterUserId: 'wali-1',
        subjectLabel: 'Ahmad (NIS 2024001)',
      }) as any
    );

    const result = await service.submitGuardianRequest(guardianInput(), guardianActor);

    expect(result.subjectLabel).toBe('Ahmad (NIS 2024001)');
    const create = vi.mocked(prisma.dataSubjectRequest.create).mock.calls[0][0] as any;
    expect(create.data.subjectStudentId).toBe('stu-1');
    expect(create.data.requesterUserId).toBe('wali-1');
  });

  it('menolak wali yang meminta santri BUKAN tanggungannya', async () => {
    // Inilah cabang yang paling berharga untuk merah: santri itu ada, tetapi
    // tidak ada tautan `StudentParent` dari pemohon ke santri tersebut. Tanpa
    // penolakan ini, siapa pun yang mengetahui sebuah id santri dapat membaca
    // data anak orang lain.
    vi.mocked(prisma.student.findUnique).mockResolvedValue({
      id: 'stu-1',
      nis: '2024001',
      userId: 'usr-1',
      user: { name: 'Ahmad' },
    } as any);
    vi.mocked(prisma.studentParent.findUnique).mockResolvedValue(null as any);

    await expect(
      service.submitGuardianRequest(guardianInput(), guardianActor)
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.dataSubjectRequest.create).not.toHaveBeenCalled();
  });

  it('petugas PDP boleh mengajukan atas nama santri mana pun tanpa tautan wali', async () => {
    vi.mocked(prisma.student.findUnique).mockResolvedValue({
      id: 'stu-1',
      nis: '2024001',
      userId: 'usr-1',
      user: { name: 'Ahmad' },
    } as any);
    vi.mocked(prisma.dataSubjectRequest.count).mockResolvedValue(0);
    vi.mocked(prisma.dataSubjectRequest.create).mockResolvedValue(
      requestRow({
        subjectCategory: 'STUDENT',
        subjectStudentId: 'stu-1',
        subjectRegistrantId: null,
        requesterUserId: 'petugas-1',
      }) as any
    );

    await expect(
      service.submitGuardianRequest(guardianInput(), {
        userId: 'petugas-1',
        name: 'Petugas',
        hasPdpPermission: true,
      })
    ).resolves.toBeTruthy();
    // Tautan wali tidak diperiksa untuk petugas: kewenangannya lewat izin.
    expect(prisma.studentParent.findUnique).not.toHaveBeenCalled();
  });

  it('wali yang meminta datanya SENDIRI tidak memerlukan id santri', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      name: 'Bapak Wali',
      email: 'wali@example.com',
    } as any);
    vi.mocked(prisma.dataSubjectRequest.count).mockResolvedValue(0);
    vi.mocked(prisma.dataSubjectRequest.create).mockResolvedValue(
      requestRow({
        subjectCategory: 'GUARDIAN',
        subjectStudentId: null,
        subjectRegistrantId: null,
        requesterUserId: 'wali-1',
        subjectLabel: 'Bapak Wali (wali@example.com)',
      }) as any
    );

    const result = await service.submitGuardianRequest(
      guardianInput({ subjectCategory: 'GUARDIAN', subjectStudentId: undefined }),
      guardianActor
    );

    expect(result.subjectLabel).toBe('Bapak Wali (wali@example.com)');
    // Tidak ada santri yang diperiksa, jadi tidak ada tautan yang dituntut.
    expect(prisma.student.findUnique).not.toHaveBeenCalled();
  });

  it('menolak kategori STUDENT tanpa id santri', async () => {
    await expect(
      service.submitGuardianRequest(guardianInput({ subjectStudentId: undefined }), guardianActor)
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
