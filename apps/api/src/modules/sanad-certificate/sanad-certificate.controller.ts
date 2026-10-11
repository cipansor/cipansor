import { Request, Response } from 'express';
import { asyncHandler } from '@/middleware/error';
import { SanadCertificateService } from './sanad-certificate.service';
import type { ListSanadQuery } from './sanad-certificate.schema';

// ============================================
// LIST SANAD RECORDS
// ============================================

export const listSanadRecords = asyncHandler(async (req: Request, res: Response) => {
  const context = {
    role: req.user!.role,
    unitId: req.user!.unitId,
    userId: req.user!.sub,
  };

  // Read what `validateQuery` produced, not the raw query. Express 5 makes
  // `req.query` read-only, so the middleware parks the parsed result in
  // `res.locals.validatedQuery`; falling back to `req.query` here would throw
  // that away along with the schema's page=1/limit=20 defaults and would let a
  // raw, unvalidated `hasCertificate` reach the service (CodeQL
  // js/sensitive-get-query flagged it). A caller sending only `?limit=50` left
  // `page` undefined, `skip` became NaN, and Prisma rejected the query with
  // "Argument `skip` is missing" — a 500 on a plain list call.
  const query = res.locals.validatedQuery as ListSanadQuery;

  const result = await SanadCertificateService.findAllSanadRecords(query, context);

  res.json({
    success: true,
    data: result.records,
    pagination: result.pagination,
  });
});

// ============================================
// GET SANAD TREE (Silsilah)
// ============================================

export const getSanadTree = asyncHandler(async (_req: Request, res: Response) => {
  const tree = await SanadCertificateService.getSanadTree();

  res.json({
    success: true,
    data: tree,
  });
});

// ============================================
// GET SANAD BY ID
// ============================================

export const getSanadById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const record = await SanadCertificateService.findSanadById(id);

  res.json({
    success: true,
    data: record,
  });
});

// ============================================
// CREATE SANAD RECORD
// ============================================

export const createSanadRecord = asyncHandler(async (req: Request, res: Response) => {
  const context = { userId: req.user!.sub };
  const record = await SanadCertificateService.createSanadRecord(req.body, context);

  res.status(201).json({
    success: true,
    data: record,
    message: 'Sanad record created successfully',
  });
});

// ============================================
// UPDATE SANAD RECORD
// ============================================

export const updateSanadRecord = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const context = { userId: req.user!.sub };
  const record = await SanadCertificateService.updateSanadRecord(id, req.body, context);

  res.json({
    success: true,
    data: record,
    message: 'Sanad record updated successfully',
  });
});

// ============================================
// DELETE SANAD RECORD
// ============================================

export const deleteSanadRecord = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  await SanadCertificateService.deleteSanadRecord(id);

  res.json({
    success: true,
    message: 'Sanad record deleted successfully',
  });
});

// ============================================
// BULK CREATE SANAD RECORDS
// ============================================

export const bulkCreateSanadRecords = asyncHandler(async (req: Request, res: Response) => {
  const context = { userId: req.user!.sub };
  const result = await SanadCertificateService.bulkCreateSanadRecords(req.body, context);

  res.status(201).json({
    success: true,
    data: result,
    message: `Created ${result.success} records, ${result.failed} failed`,
  });
});

// ============================================
// GET STUDENT SANAD SUMMARY
// ============================================

export const getStudentSanadSummary = asyncHandler(async (req: Request, res: Response) => {
  const { studentId } = req.params;
  const summary = await SanadCertificateService.getStudentSanadSummary(studentId);

  res.json({
    success: true,
    data: summary,
  });
});

// ============================================
// GENERATE CERTIFICATE
// ============================================

export const generateCertificate = asyncHandler(async (req: Request, res: Response) => {
  const context = { userId: req.user!.sub };
  const certificateData = await SanadCertificateService.generateCertificate(req.body, context);

  res.json({
    success: true,
    data: certificateData,
  });
});

// ============================================
// GET CERTIFICATE PDF (HTML)
// ============================================

export const getCertificatePdf = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const context = { userId: req.user!.sub };

  const certificateData = await SanadCertificateService.generateCertificate(
    {
      sanadId: id,
      templateType: (req.query.template as any) || 'STANDARD',
      includeQRCode: req.query.qr !== 'false',
      // The print flow exists to hand a santri a QR that points at the public
      // page, so its certificate is public unless an issuer says otherwise.
      // (This endpoint has no visibility param; POST /certificate does.)
      isPublic: true,
      signedBy: req.query.signedBy as string,
      signedByTitle: req.query.signedByTitle as string,
    },
    context
  );

  const html = SanadCertificateService.generateCertificateHtml(certificateData);

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ============================================
// VERIFY CERTIFICATE (PUBLIC)
// ============================================

export const verifyCertificate = asyncHandler(async (req: Request, res: Response) => {
  const result = await SanadCertificateService.verifyCertificate(req.body);

  res.json({
    success: true,
    data: result,
  });
});
