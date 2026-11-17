import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

import * as controller from '../data-subject-requests.controller';
import * as service from '../data-subject-requests.service';
import { prisma } from '@/lib/prisma';

vi.mock('../data-subject-requests.service', () => ({
  submitPublicRequest: vi.fn(),
  verifyPublicRequest: vi.fn(),
  submitGuardianRequest: vi.fn(),
  listMyRequests: vi.fn(),
  listRequests: vi.fn(),
  getRequest: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

/**
 * Controller adalah tempat permintaan bertemu logika bisnis: ia mengurai
 * body/params/query, membaca identitas pemohon, dan membentuk jawaban HTTP. Uji
 * layanan memberikan argumennya langsung dan tidak melihat satu pun dari itu,
 * jadi pemetaan bidang yang salah atau kode status yang keliru akan lolos
 * (AGENTS.md butir 7).
 *
 * Handler-nya dibungkus `asyncHandler`, yang menelan promise-nya dan
 * meneruskan galat ke `next` — bukan mengembalikannya. Karena itu setiap
 * pemanggilan di sini menunggu satu putaran mikrotask sebelum memeriksa.
 */

function mockRequest(over: Partial<Request> = {}): Request {
  return { body: {}, params: {}, query: {}, ...over } as unknown as Request;
}

function mockResponse() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

/** Jalankan handler dan tunggu pekerjaannya selesai (asyncHandler tidak mengembalikan promise). */
async function invoke(
  handler: (req: Request, res: Response, next: NextFunction) => unknown,
  req: Request,
  res: Response
): Promise<{ next: NextFunction; error: unknown }> {
  let error: unknown;
  const next = vi.fn((e?: unknown) => {
    error = e;
  }) as unknown as NextFunction;
  handler(req, res, next);
  await new Promise((resolve) => setImmediate(resolve));
  return { next, error };
}

const summary = (over: Record<string, unknown> = {}) => ({
  id: 'dsr-1',
  requestNo: 'DSR-2026-0001',
  type: 'ACCESS',
  status: 'RECEIVED',
  subjectCategory: 'REGISTRANT',
  subjectLabel: 'Ahmad Fauzi (No. SPMB-2026-0001)',
  requesterName: 'Siti',
  dueAt: '2026-11-20T00:00:00.000Z',
  completedAt: null,
  overdue: false,
  handledBy: null,
  createdAt: '2026-11-17T00:00:00.000Z',
  ...over,
});

describe('data-subject-requests controller — permukaan publik', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: 'Petugas PDP' } as any);
  });

  it('menjawab 202, bukan 201: permintaannya belum selesai, masih menunggu verifikasi', async () => {
    vi.mocked(service.submitPublicRequest).mockResolvedValueOnce({
      requestNo: 'DSR-2026-0001',
      dueAt: '2026-11-20T00:00:00.000Z',
      verificationSentTo: '••••0002',
    } as any);
    const res = mockResponse();

    await invoke(
      controller.submitPublic,
      mockRequest({
        body: {
          type: 'ACCESS',
          registrationNo: 'SPMB-2026-0001',
          birthDate: '2014-03-05',
          requesterName: 'Siti Aminah',
          requesterContact: '081200000002',
          detail: 'Mohon salinan data pendaftaran anak saya.',
        },
      }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(202);
    const payload = vi.mocked(res.json).mock.calls[0][0] as any;
    // Jawaban publik tidak boleh memuat data subjek — hanya nomor permintaan.
    expect(payload.data).not.toHaveProperty('subjectLabel');
    expect(payload.data).not.toHaveProperty('requesterName');
  });

  it('menolak body yang tidak lengkap sebelum menyentuh layanan', async () => {
    const { error } = await invoke(
      controller.submitPublic,
      mockRequest({ body: { type: 'ACCESS', registrationNo: 'SPMB-2026-0001' } }),
      mockResponse()
    );

    expect(error).toBeTruthy();
    expect(service.submitPublicRequest).not.toHaveBeenCalled();
  });

  it('memverifikasi tanpa membuka data subjek', async () => {
    vi.mocked(service.verifyPublicRequest).mockResolvedValueOnce({
      requestNo: 'DSR-2026-0001',
      status: 'VERIFIED',
      dueAt: '2026-11-20T00:00:00.000Z',
    } as any);
    const res = mockResponse();

    await invoke(
      controller.verifyPublic,
      mockRequest({ body: { requestNo: 'DSR-2026-0001', code: '123456' } }),
      res
    );

    const payload = vi.mocked(res.json).mock.calls[0][0] as any;
    expect(payload.data.status).toBe('VERIFIED');
    expect(payload.data).not.toHaveProperty('personalData');
  });
});

describe('data-subject-requests controller — permukaan portal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: 'Siti Aminah' } as any);
  });

  it('memakai identitas dari sesi, bukan dari body', async () => {
    vi.mocked(service.submitGuardianRequest).mockResolvedValueOnce(summary() as any);
    const res = mockResponse();

    await invoke(
      controller.submit,
      mockRequest({
        user: { sub: 'usr-1', role: 'PARENT', permissions: [] } as any,
        body: {
          type: 'ACCESS',
          subjectCategory: 'STUDENT',
          subjectStudentId: '9d1b3a4e-1f5a-4a5f-9d3e-3b1c9b7a2f01',
          detail: 'Mohon salinan data anak saya untuk keperluan sekolah.',
        },
      }),
      res
    );

    expect(service.submitGuardianRequest).toHaveBeenCalledWith(
      expect.objectContaining({ subjectStudentId: '9d1b3a4e-1f5a-4a5f-9d3e-3b1c9b7a2f01' }),
      expect.objectContaining({ userId: 'usr-1', hasPdpPermission: false })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('meneruskan izin petugas, sehingga petugas boleh mencatatkan permintaan lisan', async () => {
    vi.mocked(service.submitGuardianRequest).mockResolvedValueOnce(summary() as any);

    await invoke(
      controller.submit,
      mockRequest({
        user: { sub: 'usr-9', role: 'STAFF', permissions: ['PDP_MANAGE'] } as any,
        body: {
          type: 'ACCESS',
          subjectCategory: 'STUDENT',
          subjectStudentId: '9d1b3a4e-1f5a-4a5f-9d3e-3b1c9b7a2f01',
          detail: 'Permintaan lisan lewat telepon, dicatatkan petugas.',
        },
      }),
      mockResponse()
    );

    expect(service.submitGuardianRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hasPdpPermission: true })
    );
  });
});

describe('data-subject-requests controller — permukaan petugas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: 'Petugas PDP' } as any);
  });

  it('mengembalikan halaman beserta totalnya', async () => {
    vi.mocked(service.listRequests).mockResolvedValueOnce({ data: [summary()], total: 21 } as any);
    const res = mockResponse();

    await invoke(controller.list, mockRequest({ query: { page: '2', limit: '20' } }), res);

    expect(service.listRequests).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, limit: 20 })
    );
    const payload = vi.mocked(res.json).mock.calls[0][0] as any;
    expect(payload.pagination).toMatchObject({ page: 2, limit: 20, total: 21, totalPages: 2 });
  });

  it('menolak id yang bukan UUID sebelum menyentuh layanan', async () => {
    const { error } = await invoke(
      controller.findOne,
      mockRequest({ params: { id: 'bukan-uuid' } }),
      mockResponse()
    );

    expect(error).toBeTruthy();
    expect(service.getRequest).not.toHaveBeenCalled();
  });

  it('menyertakan salinan data pada jawaban penutupan permintaan akses', async () => {
    vi.mocked(service.updateStatus).mockResolvedValueOnce({
      request: summary({ status: 'COMPLETED' }),
      exportPayload: { subjectCategory: 'REGISTRANT', personalData: { registrationNo: 'X' } },
    } as any);
    const res = mockResponse();

    await invoke(
      controller.updateStatus,
      mockRequest({
        user: { sub: 'usr-9', role: 'STAFF', permissions: ['PDP_MANAGE'] } as any,
        params: { id: '9d1b3a4e-1f5a-4a5f-9d3e-3b1c9b7a2f01' },
        body: { status: 'COMPLETED' },
      }),
      res
    );

    const payload = vi.mocked(res.json).mock.calls[0][0] as any;
    expect(payload.data.exportPayload).toBeTruthy();
    expect(service.updateStatus).toHaveBeenCalledWith(
      '9d1b3a4e-1f5a-4a5f-9d3e-3b1c9b7a2f01',
      expect.objectContaining({ status: 'COMPLETED' }),
      expect.objectContaining({ userId: 'usr-9' })
    );
  });

  it('tidak menyertakan salinan data pada perpindahan status biasa', async () => {
    vi.mocked(service.updateStatus).mockResolvedValueOnce({
      request: summary({ status: 'PROCESSING' }),
    } as any);
    const res = mockResponse();

    await invoke(
      controller.updateStatus,
      mockRequest({
        user: { sub: 'usr-9', role: 'STAFF', permissions: ['PDP_MANAGE'] } as any,
        params: { id: '9d1b3a4e-1f5a-4a5f-9d3e-3b1c9b7a2f01' },
        body: { status: 'PROCESSING' },
      }),
      res
    );

    const payload = vi.mocked(res.json).mock.calls[0][0] as any;
    expect(payload.data).not.toHaveProperty('exportPayload');
  });
});
