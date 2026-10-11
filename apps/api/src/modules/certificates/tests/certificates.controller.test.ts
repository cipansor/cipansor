import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

vi.mock('../certificates.service', () => ({
  getCertificates: vi.fn(),
  getCertificateById: vi.fn(),
  getStudentCertificates: vi.fn(),
  verifyCertificate: vi.fn(),
  createCertificate: vi.fn(),
  updateCertificate: vi.fn(),
  deleteCertificate: vi.fn(),
  renderCertificatePdf: vi.fn(),
  renderPublicCertificatePdf: vi.fn(),
  incrementDownloadCount: vi.fn(),
}));

import * as service from '../certificates.service';
import * as controller from '../certificates.controller';
import router from '../certificates.routes';

const mocked = service as unknown as Record<string, ReturnType<typeof vi.fn>>;

function mockRequest(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    user: {
      sub: 'user-1',
      roleCode: 'SDIT_GURU',
      unitId: 'unit-1',
    },
    ...overrides,
  } as unknown as Request;
}

function mockResponse() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.locals = {};
  return res;
}

/**
 * `asyncHandler` catches into `next` but returns void, so the handler's promise
 * cannot be awaited directly. Invoking it and draining the microtask queue lets
 * the wrapped promise settle before the assertions read the response mocks.
 */
async function run(handler: RequestHandler, req: Request, res: Response) {
  const next = vi.fn() as unknown as NextFunction;
  handler(req, res, next);
  await new Promise((resolve) => setImmediate(resolve));
  return next as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => vi.clearAllMocks());

describe('certificatesController — list', () => {
  it('passes the validated query, never the raw query string, and the caller scope', async () => {
    mocked.getCertificates.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    const req = mockRequest({ query: { page: '1', studentId: 'raw-from-the-url' } });
    const res = mockResponse();
    res.locals.validatedQuery = { page: 1, limit: 20 };

    await run(controller.listCertificates, req, res);

    expect(mocked.getCertificates).toHaveBeenCalledWith(
      { page: 1, limit: 20 },
      expect.objectContaining({ sub: 'user-1', roleCode: 'SDIT_GURU', unitId: 'unit-1' })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: [] }));
  });
});

describe('certificatesController — detail', () => {
  it('404s when the service returns nothing (out of the caller\u2019s scope)', async () => {
    mocked.getCertificateById.mockResolvedValue(null);
    const req = mockRequest({ params: { id: 'cert-other' } });
    const res = mockResponse();

    const next = await run(controller.getCertificate, req, res);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('answers the envelope for a reachable certificate', async () => {
    mocked.getCertificateById.mockResolvedValue({ id: 'cert-1' });
    const req = mockRequest({ params: { id: 'cert-1' } });
    const res = mockResponse();

    await run(controller.getCertificate, req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data: { id: 'cert-1' } })
    );
  });
});

describe('certificatesController — verify', () => {
  it('is reachable without a token and answers the verification envelope', async () => {
    mocked.verifyCertificate.mockResolvedValue({ valid: true, certificate: { id: 'cert-1' } });
    const req = mockRequest({ params: { code: 'TAH/09/2026/ABCDE' }, user: undefined });
    const res = mockResponse();

    await run(controller.verifyCertificate, req, res);

    expect(mocked.verifyCertificate).toHaveBeenCalledWith('TAH/09/2026/ABCDE');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ valid: true }),
      })
    );
  });
});

describe('certificatesController — create', () => {
  it('answers 201 and passes the creating user id', async () => {
    mocked.createCertificate.mockResolvedValue({ id: 'cert-new' });
    const req = mockRequest({ body: { studentId: 's-1', certificateType: 'TAHFIDZ' } });
    const res = mockResponse();

    await run(controller.createCertificate, req, res);

    expect(mocked.createCertificate).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 's-1' }),
      'user-1',
      expect.objectContaining({ sub: 'user-1' })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('certificatesController — download', () => {
  it('streams the PDF bytes with an attachment header and counts the download', async () => {
    mocked.renderCertificatePdf.mockResolvedValue({
      certificate: { id: 'cert-1', certificateNumber: 'TAH/09/2026/ABCDE' },
      buffer: Buffer.from('%PDF-1.4'),
    });
    mocked.incrementDownloadCount.mockResolvedValue({ id: 'cert-1' });
    const req = mockRequest({ params: { id: 'cert-1' } });
    const res = mockResponse();

    await run(controller.downloadCertificate, req, res);

    expect(mocked.renderCertificatePdf).toHaveBeenCalledWith(
      'cert-1',
      expect.objectContaining({ sub: 'user-1' })
    );
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="sertifikat-TAH-09-2026-ABCDE.pdf"'
    );
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
    expect(mocked.incrementDownloadCount).toHaveBeenCalledWith('cert-1');
  });

  it('sends no bytes when the certificate is out of the caller\u2019s scope', async () => {
    mocked.renderCertificatePdf.mockRejectedValue(
      Object.assign(new Error('Certificate not found'), { statusCode: 404 })
    );
    const req = mockRequest({ params: { id: 'cert-other' } });
    const res = mockResponse();

    const next = await run(controller.downloadCertificate, req, res);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(res.send).not.toHaveBeenCalled();
    expect(mocked.incrementDownloadCount).not.toHaveBeenCalled();
  });
});

describe('certificatesController — public download', () => {
  it('streams the PDF bytes for a public number without a session', async () => {
    mocked.renderPublicCertificatePdf.mockResolvedValue({
      certificate: { id: 'cert-1', certificateNumber: 'CERT-TFZ-30-2024001' },
      buffer: Buffer.from('%PDF-1.4'),
    });
    const req = mockRequest({
      params: { code: 'CERT-TFZ-30-2024001' },
      user: undefined,
    });
    const res = mockResponse();

    await run(controller.downloadPublicCertificate, req, res);

    // The number, not a row id, is what the public caller holds — and no actor
    // is passed, because there is no session.
    expect(mocked.renderPublicCertificatePdf).toHaveBeenCalledWith('CERT-TFZ-30-2024001');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="sertifikat-CERT-TFZ-30-2024001.pdf"'
    );
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
    // No download count: the counter is written only on the scoped route.
    expect(mocked.incrementDownloadCount).not.toHaveBeenCalled();
  });

  it('sends no bytes for a private or unknown number', async () => {
    mocked.renderPublicCertificatePdf.mockRejectedValue(
      Object.assign(new Error('Certificate not found'), { statusCode: 404 })
    );
    const req = mockRequest({ params: { code: 'SANAD-202601-PRIVATE1' }, user: undefined });
    const res = mockResponse();

    const next = await run(controller.downloadPublicCertificate, req, res);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(res.send).not.toHaveBeenCalled();
  });
});

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

function hasRoute(method: string, path: string) {
  return (router.stack as unknown as RouteLayer[]).some(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
}

/**
 * Public routes sit before `router.use(authenticate)` in the stack, so their
 * index is lower than that middleware layer's.
 */
function isPublicRoute(method: string, path: string) {
  const stack = router.stack as unknown as Array<RouteLayer & { name?: string }>;
  const authIndex = stack.findIndex((l) => !l.route && l.name === 'authenticate');
  const routeIndex = stack.findIndex(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  if (routeIndex === -1) throw new Error(`No route for ${method.toUpperCase()} ${path}`);
  return authIndex === -1 || routeIndex < authIndex;
}

describe('certificatesRoutes — registration', () => {
  it('serves verification and public download without a session and every other route behind auth', () => {
    expect(hasRoute('get', '/verify/:code')).toBe(true);
    expect(isPublicRoute('get', '/verify/:code')).toBe(true);

    // Public PDF delivery, keyed by number — the route the verification page's
    // "Unduh Sertifikat" button calls. It must stay before `authenticate`.
    expect(hasRoute('get', '/public/:code/download')).toBe(true);
    expect(isPublicRoute('get', '/public/:code/download')).toBe(true);

    for (const [method, path] of [
      ['get', '/'],
      ['get', '/student/:studentId'],
      ['get', '/:id'],
      ['get', '/:id/download'],
      ['post', '/'],
      ['put', '/:id'],
      ['patch', '/:id'],
      ['delete', '/:id'],
    ] as const) {
      expect(hasRoute(method, path)).toBe(true);
      expect(isPublicRoute(method, path)).toBe(false);
    }
  });

  it('does not register the removed generate-pdf route', () => {
    // The PDF is rendered by the download route; a second endpoint that wrote
    // the bytes to a public directory is what the route used to do.
    expect(hasRoute('post', '/:id/generate-pdf')).toBe(false);
  });
});
