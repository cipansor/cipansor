import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
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
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
    studentNote: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    marketingInteraction: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    medicalRecord: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    specialDiet: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    immunizationRecord: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    growthRecord: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    clinicAppointment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    medicationUsageLog: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    prescription: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    prescriptionItem: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    counselingSession: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    counselingNote: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    counselingReferral: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { create: vi.fn() },
    role: { findMany: vi.fn().mockResolvedValue([]) },
    userRoleAssignment: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
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

  it('menyapu catatan bebas yang menaut subjek: StudentNote.content dan MarketingInteraction.notes', async () => {
    // Kelas cacat CWE-212 yang sama: baris `Student`/`Registrant` dianonimkan,
    // bukan dihapus, sehingga `onDelete: Cascade` tidak pernah menyala. Catatan
    // bebas di tabel sebelah — konseling santri dan CRM pendaftar — tetap hidup
    // dan masih memuat nama/telepon. Keduanya harus ditimpa penanda.
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
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ERASURE', status: 'COMPLETED' }) as any
    );

    await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    const noteSweep = vi.mocked(prisma.studentNote.updateMany).mock.calls[0][0] as any;
    expect(noteSweep.where).toEqual({ studentId: 'stu-1' });
    expect(noteSweep.data.content).toContain('UU PDP');

    const interactionSweep = vi.mocked(prisma.marketingInteraction.updateMany).mock
      .calls[0][0] as any;
    expect(interactionSweep.where).toEqual({ registrantId: 'reg-1' });
    expect(interactionSweep.data.notes).toContain('UU PDP');

    const audit = vi.mocked(prisma.auditLog.create).mock.calls[0][0] as any;
    expect(audit.data.newValues.erased).toContain('catatan santri');
    expect(audit.data.newValues.erased).toContain('catatan interaksi pemasaran');
  });

  it('menyapu teks bebas kategori khusus: kesehatan dan konseling (UU PDP Pasal 4)', async () => {
    // Data kesehatan dan kesehatan jiwa diperlakukan lebih ketat. Barisnya
    // tetap ada setelah anonimisasi, jadi teks bebasnya — keluhan, diagnosis,
    // ringkasan sesi konseling — harus ditimpa penanda; kalau tidak, staf dan
    // wali masih dapat membukanya lewat jalur baca masing-masing.
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
    vi.mocked(prisma.counselingSession.findMany).mockResolvedValue([{ id: 'ses-1' }] as any);
    vi.mocked(prisma.prescription.findMany).mockResolvedValue([{ id: 'pres-1' }] as any);
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ERASURE', status: 'COMPLETED' }) as any
    );

    await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    const medical = vi.mocked(prisma.medicalRecord.updateMany).mock.calls[0][0] as any;
    expect(medical.where).toEqual({ studentId: 'stu-1' });
    expect(medical.data.complaint).toContain('UU PDP');
    expect(medical.data.diagnosis).toContain('UU PDP');
    // Kolom rujukan menyebut rumah sakit/klinik tujuan — bagian rekam medis.
    expect(medical.data.referredTo).toContain('UU PDP');

    const diet = vi.mocked(prisma.specialDiet.updateMany).mock.calls[0][0] as any;
    expect(diet.data.medicalNotes).toContain('UU PDP');
    // Daftar alergi adalah data kesehatan yang menyebut kondisi subjek.
    expect(diet.data.allergies).toEqual([]);

    const immunization = vi.mocked(prisma.immunizationRecord.updateMany).mock.calls[0][0] as any;
    expect(immunization.data.notes).toContain('UU PDP');

    const growth = vi.mocked(prisma.growthRecord.updateMany).mock.calls[0][0] as any;
    expect(growth.where).toEqual({ studentId: 'stu-1' });
    expect(growth.data.notes).toContain('UU PDP');

    const appointment = vi.mocked(prisma.clinicAppointment.updateMany).mock.calls[0][0] as any;
    expect(appointment.data.complaint).toContain('UU PDP');

    // Log penggunaan obat menyimpan alasan bebas ("Demam tinggi, paracetamol").
    const usage = vi.mocked(prisma.medicationUsageLog.updateMany).mock.calls[0][0] as any;
    expect(usage.where).toEqual({ studentId: 'stu-1' });
    expect(usage.data.reason).toContain('UU PDP');

    const prescription = vi.mocked(prisma.prescription.updateMany).mock.calls[0][0] as any;
    expect(prescription.data.notes).toContain('UU PDP');

    // `PrescriptionItem` menaut lewat `prescriptionId`, bukan `studentId`.
    const item = vi.mocked(prisma.prescriptionItem.updateMany).mock.calls[0][0] as any;
    expect(item.where).toEqual({ prescriptionId: { in: ['pres-1'] } });
    expect(item.data.instructions).toContain('UU PDP');

    const session = vi.mocked(prisma.counselingSession.updateMany).mock.calls[0][0] as any;
    expect(session.data.title).toContain('UU PDP');
    expect(session.data.description).toContain('UU PDP');
    expect(session.data.summary).toContain('UU PDP');
    expect(session.data.recommendations).toContain('UU PDP');
    // `psychologyData` (Json) dibuang, bukan ditandai — isinya observasi terstruktur.
    expect(session.data.psychologyData).toEqual(Prisma.DbNull);

    // `CounselingNote` menaut lewat `sessionId`, bukan `studentId`.
    const note = vi.mocked(prisma.counselingNote.updateMany).mock.calls[0][0] as any;
    expect(note.where).toEqual({ sessionId: { in: ['ses-1'] } });
    expect(note.data.content).toContain('UU PDP');

    // Rujukan konseling menaut lewat `sessionId` yang sama.
    const referral = vi.mocked(prisma.counselingReferral.updateMany).mock.calls[0][0] as any;
    expect(referral.where).toEqual({ sessionId: { in: ['ses-1'] } });
    expect(referral.data.reason).toContain('UU PDP');
    expect(referral.data.outcome).toContain('UU PDP');

    const studentNote = vi.mocked(prisma.studentNote.updateMany).mock.calls[0][0] as any;
    expect(studentNote.data.title).toContain('UU PDP');

    const audit = vi.mocked(prisma.auditLog.create).mock.calls[0][0] as any;
    expect(audit.data.newValues.erased).toContain('catatan kesehatan');
    expect(audit.data.newValues.erased).toContain('catatan konseling');
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
    // Kolom teks bebas lain di baris yang sama ikut disapu: sekolah asal
    // (yang juga dimuat ekspor ACCESS sebagai data pribadi) dan catatan biaya
    // pendaftaran.
    expect(registrant.data.previousSchool).toContain('UU PDP');
    expect(registrant.data.registrationFeeNote).toContain('UU PDP');
    // Berkas pendaftaran yang tertinggal ikut dijadwalkan untuk dihapus.
    expect(prisma.registrantDocument.updateMany).toHaveBeenCalled();
    const audit = vi.mocked(prisma.auditLog.create).mock.calls[0][0] as any;
    expect(audit.data.newValues.erased).toContain('sekolah asal');
    expect(audit.data.newValues.erased).toContain('catatan biaya pendaftaran');
    expect(audit.data.newValues.retained).toContain(
      'bukti persetujuan (tanggal, versi, alamat IP)'
    );
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

  it('penghapusan atas nama diri sendiri (GUARDIAN) menjangkau baris Student yang tertaut', async () => {
    // `Student.userId` adalah `@unique` yang menunjuk `User`: seorang santri
    // yang mewakili dirinya sendiri lewat `subjectCategory = GUARDIAN`
    // (`service.ts` `assertCanActForStudent` menyatakan jalur ini didukung).
    // Mengosongkan `User` saja meninggalkan NIK/KK/akta dan identitas orang
    // tuanya pada `Student` — orang yang sama, masih dapat dikenali.
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'ERASURE',
        status: 'PROCESSING',
        requesterUserId: 'usr-1',
        subjectCategory: 'GUARDIAN',
        subjectUserId: 'usr-1',
        subjectStudentId: null,
        subjectRegistrantId: null,
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

    // Baris `Student` yang menunjuk pengguna ini benar-benar disapu.
    const student = vi.mocked(prisma.student.update).mock.calls[0][0] as any;
    expect(student.where.id).toBe('stu-1');
    expect(student.data.nik).toBeNull();
    expect(student.data.noKK).toBeNull();
    expect(student.data.fatherName).toBeNull();
    expect(student.data.motherNik).toBeNull();
    // Akunnya sendiri tetap dianonimkan.
    const user = vi.mocked(prisma.user.update).mock.calls[0][0] as any;
    expect(user.data.isActive).toBe(false);
    const audit = vi.mocked(prisma.auditLog.create).mock.calls[0][0] as any;
    expect(audit.data.newValues.erased).toContain('identitas santri');
  });

  it('penghapusan GUARDIAN tanpa santri tertaut tidak menyentuh baris Student', async () => {
    // Wali murni: akunnya tidak menautkan baris `Student`, jadi tidak ada yang
    // boleh disapu. Tanpa cabang ini, penghapusan wali bisa menjangkau santri
    // yang bukan subjeknya.
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'ERASURE',
        status: 'PROCESSING',
        requesterUserId: 'wali-1',
        subjectCategory: 'GUARDIAN',
        subjectUserId: 'wali-1',
        subjectStudentId: null,
        subjectRegistrantId: null,
      }) as any
    );
    vi.mocked(prisma.student.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ERASURE', status: 'COMPLETED' }) as any
    );

    await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    expect(prisma.student.update).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalled();
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

  it('akses atas nama diri sendiri (GUARDIAN) menyertakan data santri yang tertaut', async () => {
    // Seorang santri yang mewakili dirinya sendiri lewat `GUARDIAN` berhak
    // menerima salinan data akademik dan identitasnya — bukan hanya nama/email
    // akunnya. Tanpa cabang ini, pemohon lewat jalur ini tidak menerima
    // sebagian data pribadinya sendiri.
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'ACCESS',
        status: 'PROCESSING',
        requesterUserId: 'usr-1',
        subjectCategory: 'GUARDIAN',
        subjectUserId: 'usr-1',
        subjectStudentId: null,
        subjectRegistrantId: null,
      }) as any
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      name: 'Ahmad Dewasa',
      email: 'ahmad@example.com',
      phone: '0812',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    } as any);
    vi.mocked(prisma.student.findUnique).mockResolvedValue({
      nis: '2024001',
      nisn: '0012345678',
      gender: 'MALE',
      birthPlace: 'Bandung',
      birthDate: new Date('2008-03-05T00:00:00.000Z'),
      address: 'Jl. Contoh 1',
      parentName: 'Bapak',
      parentPhone: '0813',
      parentEmail: 'b@example.com',
      status: 'ACTIVE',
      entryYear: 2021,
      graduateYear: null,
      user: { name: 'Ahmad Dewasa', email: 'ahmad@example.com', phone: '0812' },
      unit: { name: 'SMA IT Cipansor' },
      parents: [],
    } as any);
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ACCESS', status: 'COMPLETED' }) as any
    );

    const result = await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    expect(result.exportPayload).toMatchObject({
      subjectCategory: 'GUARDIAN',
      personalData: expect.objectContaining({ name: 'Ahmad Dewasa' }),
      studentData: expect.objectContaining({ nis: '2024001' }),
    });
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

  it('cabang GUARDIAN selalu memakai id pemanggil, bukan id yang diselundupkan di masukan', async () => {
    // `subjectUserId` tidak ada di skema masukan; layanan menetapkannya dari
    // `actor.userId`. Uji ini mengunci invarian itu: walaupun masukan membawa
    // `subjectUserId` orang lain, yang tersimpan tetap id pemanggil — jadi
    // jalur "atas nama diri sendiri" tidak dapat dipakai mewakili orang lain.
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      name: 'Bapak Wali',
      email: 'wali@example.com',
    } as any);
    vi.mocked(prisma.dataSubjectRequest.count).mockResolvedValue(0);
    vi.mocked(prisma.dataSubjectRequest.create).mockResolvedValue(
      requestRow({ subjectCategory: 'GUARDIAN', subjectUserId: 'wali-1' }) as any
    );

    await service.submitGuardianRequest(
      guardianInput({
        subjectCategory: 'GUARDIAN',
        subjectStudentId: undefined,
        subjectUserId: 'orang-lain',
      }),
      guardianActor
    );

    const create = vi.mocked(prisma.dataSubjectRequest.create).mock.calls[0][0] as any;
    expect(create.data.subjectUserId).toBe('wali-1');
    expect(create.data.subjectStudentId).toBeNull();
  });

  it('menolak kategori STUDENT tanpa id santri', async () => {
    await expect(
      service.submitGuardianRequest(guardianInput({ subjectStudentId: undefined }), guardianActor)
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('data-subject-requests — penemuan lanjutan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txPassThrough();
    vi.mocked(prisma.registrantDocument.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.studentDocument.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.registrant.findMany).mockResolvedValue([] as any);
  });

  const actor = { userId: 'officer-1', name: 'Petugas PDP' };

  // ---------- A1: identitas santri tetap terbaca setelah penghapusan ----------

  it('menghapus identitas langsung santri (NIK, KK, akta, orang tua) saat penghapusan', async () => {
    // Sebelumnya hanya foto dan kontak yang dibersihkan; NIK, nomor KK, nomor
    // akta, dan identitas ayah/ibu/wali tetap utuh, sehingga subjek masih
    // dapat dikenali setelah permintaan dinyatakan selesai (CWE-212).
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
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ERASURE', status: 'COMPLETED' }) as any
    );

    await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    const student = vi.mocked(prisma.student.update).mock.calls[0][0] as any;
    expect(student.data.nik).toBeNull();
    expect(student.data.noKK).toBeNull();
    expect(student.data.noAkta).toBeNull();
    expect(student.data.fatherName).toBeNull();
    expect(student.data.motherName).toBeNull();
    expect(student.data.fatherNik).toBeNull();
    expect(student.data.motherNik).toBeNull();
    expect(student.data.fatherPhone).toBeNull();
    expect(student.data.motherPhone).toBeNull();
    expect(student.data.guardianName).toBeNull();
    expect(student.data.guardianPhone).toBeNull();
    expect(student.data.guardianNik).toBeNull();
  });

  // ---------- A2: baris permintaan menyimpan PII ----------

  it('menganonimkan nama, kontak, dan rincian permintaan saat penghapusan', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'ERASURE',
        status: 'PROCESSING',
        requesterUserId: 'usr-1',
        subjectCategory: 'STUDENT',
        subjectStudentId: 'stu-1',
        subjectRegistrantId: null,
        requesterName: 'Budi Santoso',
        requesterContact: '081234567890',
        detail: 'Tolong hapus data anak saya, Budi Santoso.',
      }) as any
    );
    vi.mocked(prisma.student.findUnique).mockResolvedValue({
      id: 'stu-1',
      userId: 'usr-1',
      photoUrl: null,
    } as any);
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ERASURE', status: 'COMPLETED' }) as any
    );

    await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    const requestUpdate = vi
      .mocked(prisma.dataSubjectRequest.update)
      .mock.calls.map((c) => c[0] as any)
      .find((c) => c.where.id === 'dsr-1' && c.data.requesterName !== undefined);
    expect(requestUpdate, 'baris permintaan harus dianonimkan').toBeTruthy();
    expect(requestUpdate.data.requesterName).not.toContain('Budi');
    expect(requestUpdate.data.requesterContact).toBe('—');
    expect(requestUpdate.data.detail).not.toContain('Budi');
  });

  it('mengosongkan catatan tindakan yang dapat memuat PII', async () => {
    const actionsWithPii = [
      {
        at: '2026-11-17T00:00:00.000Z',
        byId: 'usr-1',
        byName: 'Budi Santoso',
        from: null,
        to: 'RECEIVED',
        note: 'Hubungi Budi Santoso di 081234567890.',
      },
    ];
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'ERASURE',
        status: 'PROCESSING',
        requesterUserId: 'usr-1',
        subjectCategory: 'STUDENT',
        subjectStudentId: 'stu-1',
        subjectRegistrantId: null,
        actions: actionsWithPii,
      }) as any
    );
    vi.mocked(prisma.student.findUnique).mockResolvedValue({
      id: 'stu-1',
      userId: 'usr-1',
      photoUrl: null,
    } as any);
    // Pencarian riwayat untuk disapu mengembalikan barisnya sendiri.
    vi.mocked(prisma.dataSubjectRequest.findMany).mockResolvedValue([
      { id: 'dsr-1', actions: actionsWithPii },
    ] as any);
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ERASURE', status: 'COMPLETED' }) as any
    );

    await service.updateStatus(
      'dsr-1',
      { status: 'COMPLETED', note: 'Selesai, Budi Santoso sudah dihubungi.' },
      actor
    );

    // SETIAP pembaruan yang membawa `actions` diperiksa, bukan hanya yang
    // pertama: jalur penghapusan menulis riwayat dua kali (penyapuan di dalam
    // `executeErasure`, lalu pembaruan status), dan penulisan terakhir itulah
    // yang menentukan apa yang benar-benar tersimpan.
    const actionsWritten = vi
      .mocked(prisma.dataSubjectRequest.update)
      .mock.calls.map((c) => (c[0] as any).data.actions)
      .filter(Array.isArray);
    expect(actionsWritten.length).toBeGreaterThan(0);
    for (const actions of actionsWritten) {
      expect(JSON.stringify(actions)).not.toContain('Budi');
      expect(JSON.stringify(actions)).not.toContain('081234567890');
    }
  });

  it('mengirim pemberitahuan penghapusan ke kontak asli pemohon publik', async () => {
    // Baris permintaan dianonimkan saat penghapusan, termasuk kontaknya.
    // Notifikasi penutupan harus tetap ditujukan ke kontak ASLI yang dipakai
    // saat mengajukan — kalau memakai nilai tersimpan yang sudah menjadi "—",
    // pemohon tidak pernah tahu permintaannya selesai.
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'ERASURE',
        status: 'PROCESSING',
        requesterUserId: null,
        verifiedAt: new Date('2026-11-18T00:00:00.000Z'),
        requesterContact: 'wali@example.com',
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
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'ERASURE', status: 'COMPLETED' }) as any
    );

    await service.updateStatus('dsr-1', { status: 'COMPLETED' }, actor);

    const sent = vi.mocked(notificationService.send).mock.calls[0][0] as any;
    expect(sent.channel).toBe('EMAIL');
    expect(sent.recipientEmail).toBe('wali@example.com');
  });

  // ---------- A3: pemasaran mengabaikan penarikan persetujuan ----------

  it('menolak penarikan persetujuan atas subjek GUARDIAN yang tidak punya dasar pemrosesan itu', async () => {
    await expect(
      service.submitGuardianRequest(
        {
          type: 'CONSENT_WITHDRAWAL',
          subjectCategory: 'GUARDIAN',
          detail: 'Saya menarik persetujuan pemasaran saya.',
        },
        { userId: 'wali-1', name: 'Bapak Wali', hasPdpPermission: false }
      )
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.dataSubjectRequest.create).not.toHaveBeenCalled();
  });

  // ---------- A4: nomor permintaan bertabrakan ----------

  it('mengulang pembuatan permintaan saat nomornya bertabrakan (P2002)', async () => {
    let attempt = 0;
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: any) => {
      attempt++;
      if (attempt === 1) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.0.0',
        });
      }
      return fn(prisma);
    }) as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      name: 'Bapak Wali',
      email: 'wali@example.com',
    } as any);
    vi.mocked(prisma.dataSubjectRequest.count).mockResolvedValue(0);
    vi.mocked(prisma.dataSubjectRequest.create).mockResolvedValue(
      requestRow({ subjectCategory: 'GUARDIAN', requesterUserId: 'wali-1' }) as any
    );

    await expect(
      service.submitGuardianRequest(
        { type: 'ACCESS', subjectCategory: 'GUARDIAN', detail: 'Data saya sendiri.' },
        { userId: 'wali-1', name: 'Bapak Wali', hasPdpPermission: false }
      )
    ).resolves.toBeTruthy();
    expect(attempt).toBe(2);
  });

  // ---------- B1: pengajuan publik untuk pendaftar yang sudah dihapus ----------

  it('menolak pengajuan publik atas pendaftar yang sudah dihapus, dengan galat yang sama', async () => {
    vi.mocked(prisma.registrant.findUnique).mockResolvedValue(
      registrantRow({ fullName: 'Data dihapus (UU PDP)', name: 'Data dihapus (UU PDP)' }) as any
    );

    await expect(
      service.submitPublicRequest({
        type: 'ACCESS',
        registrationNo: 'SPMB-2026-0001',
        birthDate: new Date('2014-03-05T00:00:00.000Z'),
        requesterName: 'Siti Aminah',
        requesterContact: '081200000002',
        detail: 'Mohon salinan data pendaftaran anak saya.',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.dataSubjectRequest.create).not.toHaveBeenCalled();
  });

  // ---------- B2: petugas penangan harus benar-benar memegang PDP_MANAGE ----------

  it('menolak petugas penangan yang tidak memegang PDP_MANAGE', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'RECTIFICATION',
        status: 'PROCESSING',
        requesterUserId: 'usr-1',
      }) as any
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-9' } as any);
    // Tidak ada peran yang memuat PDP_MANAGE.
    vi.mocked(prisma.role.findMany).mockResolvedValue([] as any);

    await expect(
      service.updateStatus(
        'dsr-1',
        { status: 'PROCESSING', handledById: '00000000-0000-0000-0000-000000000009' },
        actor
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('menerima petugas penangan yang memegang PDP_MANAGE, lewat kueri yang menyasar satu pengguna', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'RECTIFICATION',
        status: 'PROCESSING',
        requesterUserId: 'usr-1',
      }) as any
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-9' } as any);
    vi.mocked(prisma.userRoleAssignment.findFirst).mockResolvedValue({ id: 'assign-1' } as any);
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'RECTIFICATION', status: 'PROCESSING' }) as any
    );

    await service.updateStatus(
      'dsr-1',
      { status: 'PROCESSING', handledById: '00000000-0000-0000-0000-000000000009' },
      actor
    );

    // Kueri menyasar `handledById` saja; memuat seluruh daftar petugas di dalam
    // transaksi yang sudah menahan baris permintaan hanya memboroskan.
    expect(prisma.userRoleAssignment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: '00000000-0000-0000-0000-000000000009' }),
      })
    );
    expect(prisma.role.findMany).not.toHaveBeenCalled();
  });

  // ---------- B3: nomor permintaan memakai tahun Jakarta ----------

  it('menomori permintaan dengan tahun Asia/Jakarta, bukan tahun UTC', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-12-31T17:30:00.000Z')); // 1 Jan 2026 00:30 WIB
    try {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        name: 'Bapak Wali',
        email: 'wali@example.com',
      } as any);
      vi.mocked(prisma.dataSubjectRequest.count).mockResolvedValue(0);
      vi.mocked(prisma.dataSubjectRequest.create).mockResolvedValue(
        requestRow({ subjectCategory: 'GUARDIAN', requesterUserId: 'wali-1' }) as any
      );

      await service.submitGuardianRequest(
        { type: 'ACCESS', subjectCategory: 'GUARDIAN', detail: 'Data saya sendiri.' },
        { userId: 'wali-1', name: 'Bapak Wali', hasPdpPermission: false }
      );

      const create = vi.mocked(prisma.dataSubjectRequest.create).mock.calls[0][0] as any;
      expect(create.data.requestNo).toMatch(/^DSR-2026-/);
    } finally {
      vi.useRealTimers();
    }
  });

  // ---------- B4: permintaan publik belum terverifikasi tidak boleh dipindah ke PROCESSING ----------

  it('menolak memindahkan permintaan publik yang belum terverifikasi ke PROCESSING', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'RECTIFICATION',
        status: 'RECEIVED',
        requesterUserId: null,
        verifiedAt: null,
      }) as any
    );

    await expect(
      service.updateStatus('dsr-1', { status: 'PROCESSING' }, actor)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.dataSubjectRequest.update).not.toHaveBeenCalled();
  });

  it('mencatat verifiedAt saat petugas memverifikasi luring', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'RECTIFICATION',
        status: 'RECEIVED',
        requesterUserId: null,
        verifiedAt: null,
      }) as any
    );
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'RECTIFICATION', status: 'VERIFIED' }) as any
    );

    await service.updateStatus(
      'dsr-1',
      { status: 'VERIFIED', note: 'Identitas dicek di kantor' },
      actor
    );

    const update = vi.mocked(prisma.dataSubjectRequest.update).mock.calls[0][0] as any;
    expect(update.data.verifiedAt).toBeInstanceOf(Date);
  });

  // ---------- C1: alasan penolakan tidak dikirim ke kontak yang belum terbukti ----------

  it('tidak mengirim alasan penolakan ke permintaan publik yang belum terverifikasi', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'RECTIFICATION',
        status: 'RECEIVED',
        requesterUserId: null,
        verifiedAt: null,
      }) as any
    );
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'RECTIFICATION', status: 'REJECTED' }) as any
    );

    await service.updateStatus(
      'dsr-1',
      { status: 'REJECTED', note: 'Dokumen Budi Santoso kurang.' },
      actor
    );

    const sent = vi.mocked(notificationService.send).mock.calls[0][0] as any;
    expect(JSON.stringify(sent)).not.toContain('Budi Santoso');
    expect(JSON.stringify(sent)).not.toContain('Dokumen Budi');
  });

  it('mengirim alasan penolakan kepada pemohon portal yang sudah terbukti', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'RECTIFICATION',
        status: 'PROCESSING',
        requesterUserId: 'usr-1',
      }) as any
    );
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({ type: 'RECTIFICATION', status: 'REJECTED' }) as any
    );

    await service.updateStatus('dsr-1', { status: 'REJECTED', note: 'Dokumen kurang' }, actor);

    const sent = vi.mocked(notificationService.send).mock.calls[0][0] as any;
    expect(sent.message).toContain('Alasan: Dokumen kurang');
  });

  // ---------- C2: DTO menandai permintaan publik ----------

  it('menandai permintaan publik lewat isPublic pada DTO', async () => {
    vi.mocked(prisma.dataSubjectRequest.findUnique).mockResolvedValue(
      requestRow({
        type: 'RECTIFICATION',
        status: 'RECEIVED',
        requesterUserId: null,
        verifiedAt: new Date('2026-11-18T00:00:00.000Z'),
      }) as any
    );
    vi.mocked(prisma.dataSubjectRequest.update).mockResolvedValue(
      requestRow({
        type: 'RECTIFICATION',
        status: 'PROCESSING',
        requesterUserId: null,
        verifiedAt: new Date('2026-11-18T00:00:00.000Z'),
      }) as any
    );

    const result = await service.updateStatus('dsr-1', { status: 'PROCESSING' }, actor);
    expect(result.request.isPublic).toBe(true);
  });

  // ---------- C3: pembandingan tanggal lahir tahan konvensi penyimpanan ----------

  it('menerima tanggal lahir yang sama meski konvensi penyimpanannya berbeda', async () => {
    // Tengah malam WIB tersimpan sebagai `T17:00Z` hari sebelumnya; membandingkan
    // potongan `toISOString()` menolak keluarga yang sah.
    vi.mocked(prisma.registrant.findUnique).mockResolvedValue(
      registrantRow({ birthDate: new Date('2014-03-04T17:00:00.000Z') }) as any
    );
    vi.mocked(prisma.dataSubjectRequest.count).mockResolvedValue(0);
    vi.mocked(prisma.dataSubjectRequest.create).mockResolvedValue({
      requestNo: 'DSR-2026-0001',
      dueAt: new Date('2026-11-20T00:00:00.000Z'),
    } as any);

    await expect(
      service.submitPublicRequest({
        type: 'ACCESS',
        registrationNo: 'SPMB-2026-0001',
        birthDate: new Date('2014-03-05T00:00:00.000Z'),
        requesterName: 'Siti Aminah',
        requesterContact: '081200000002',
        detail: 'Mohon salinan data pendaftaran anak saya.',
      })
    ).resolves.toBeTruthy();
  });
});
