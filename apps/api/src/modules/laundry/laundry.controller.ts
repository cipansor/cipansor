import { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error';
import { ListTransactionsQuerySchema } from './laundry.schema';
import { laundryReadScope, pricingService, transactionService } from './laundry.service';
import { ApiResponse } from '../../utils/response';

/** Guard: pull the caller's unit or bail with 400. */
function requireUnit(req: Request, res: Response): string | undefined {
  const unitId = req.user?.unitId;
  if (!unitId) {
    res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
    return undefined;
  }
  return unitId;
}

// =============================================================================
// PRICING
// =============================================================================

/** GET /api/laundry/pricing */
export const listPricing = asyncHandler(async (req: Request, res: Response) => {
  const unitId = requireUnit(req, res);
  if (!unitId) return;
  const pricing = await pricingService.getAll(unitId);
  return res.json(ApiResponse.success(pricing, 'Berhasil mengambil data harga layanan'));
});

/** GET /api/laundry/pricing/:id */
export const getPricing = asyncHandler(async (req: Request, res: Response) => {
  const unitId = requireUnit(req, res);
  if (!unitId) return;
  const pricing = await pricingService.getById(req.params.id, unitId);
  if (!pricing) {
    return res.status(404).json(ApiResponse.error('Harga layanan tidak ditemukan', 'NOT_FOUND'));
  }
  return res.json(ApiResponse.success(pricing, 'Berhasil mengambil data harga layanan'));
});

/** POST /api/laundry/pricing */
export const createPricing = asyncHandler(async (req: Request, res: Response) => {
  const unitId = requireUnit(req, res);
  if (!unitId) return;
  const pricing = await pricingService.create(unitId, req.body);
  return res.status(201).json(ApiResponse.success(pricing, 'Harga layanan berhasil dibuat'));
});

/** PUT /api/laundry/pricing/:id */
export const updatePricing = asyncHandler(async (req: Request, res: Response) => {
  const unitId = requireUnit(req, res);
  if (!unitId) return;
  const pricing = await pricingService.update(req.params.id, unitId, req.body);
  return res.json(ApiResponse.success(pricing, 'Harga layanan berhasil diperbarui'));
});

/** DELETE /api/laundry/pricing/:id */
export const deletePricing = asyncHandler(async (req: Request, res: Response) => {
  const unitId = requireUnit(req, res);
  if (!unitId) return;
  await pricingService.delete(req.params.id, unitId);
  return res.json(ApiResponse.success(null, 'Harga layanan berhasil dihapus'));
});

// =============================================================================
// TRANSACTION
// =============================================================================

/** GET /api/laundry/transactions */
export const listTransactions = asyncHandler(async (req: Request, res: Response) => {
  const parsedQuery = ListTransactionsQuerySchema.parse(req.query);
  const result = await transactionService.getAll(laundryReadScope(req.user!), parsedQuery);
  return res.json(
    ApiResponse.success(result.data, 'Berhasil mengambil data transaksi', result.pagination)
  );
});

/** GET /api/laundry/transactions/stats */
export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const { startDate, endDate } = req.query;
  const stats = await transactionService.getStats(
    laundryReadScope(req.user!),
    startDate as string,
    endDate as string
  );
  return res.json(ApiResponse.success(stats, 'Berhasil mengambil statistik laundry'));
});

/** GET /api/laundry/transactions/ready */
export const getReadyForPickup = asyncHandler(async (req: Request, res: Response) => {
  const transactions = await transactionService.getReadyForPickup(laundryReadScope(req.user!));
  return res.json(
    ApiResponse.success(transactions, 'Berhasil mengambil data laundry siap diambil')
  );
});

/** GET /api/laundry/transactions/student/:studentId */
export const getByStudent = asyncHandler(async (req: Request, res: Response) => {
  const transactions = await transactionService.getByStudent(
    req.params.studentId,
    laundryReadScope(req.user!)
  );
  return res.json(ApiResponse.success(transactions, 'Berhasil mengambil data laundry santri'));
});

/** GET /api/laundry/transactions/:id */
export const getTransaction = asyncHandler(async (req: Request, res: Response) => {
  const transaction = await transactionService.getById(req.params.id, laundryReadScope(req.user!));
  if (!transaction) {
    return res.status(404).json(ApiResponse.error('Transaksi tidak ditemukan', 'NOT_FOUND'));
  }
  return res.json(ApiResponse.success(transaction, 'Berhasil mengambil data transaksi'));
});

/** POST /api/laundry/transactions */
export const createTransaction = asyncHandler(async (req: Request, res: Response) => {
  const unitId = req.user?.unitId;
  const userId = req.user?.sub;
  if (!unitId || !userId) {
    return res
      .status(400)
      .json(ApiResponse.error('Unit ID atau User ID tidak ditemukan', 'REQUIRED'));
  }
  const transaction = await transactionService.create(unitId, userId, req.body);
  return res
    .status(201)
    .json(ApiResponse.success(transaction, 'Transaksi laundry berhasil dibuat'));
});

/** PATCH /api/laundry/transactions/:id/status */
export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const unitId = req.user?.unitId;
  const userId = req.user?.sub;
  if (!unitId || !userId) {
    return res
      .status(400)
      .json(ApiResponse.error('Unit ID atau User ID tidak ditemukan', 'REQUIRED'));
  }
  const transaction = await transactionService.updateStatus(
    req.params.id,
    unitId,
    userId,
    req.body
  );
  return res.json(ApiResponse.success(transaction, 'Status laundry berhasil diperbarui'));
});

/** POST /api/laundry/transactions/:id/pay */
export const processPayment = asyncHandler(async (req: Request, res: Response) => {
  const unitId = req.user?.unitId;
  const userId = req.user?.sub;
  if (!unitId || !userId) {
    return res
      .status(400)
      .json(ApiResponse.error('Unit ID atau User ID tidak ditemukan', 'REQUIRED'));
  }
  const transaction = await transactionService.processPayment(
    req.params.id,
    unitId,
    userId,
    req.body
  );
  return res.json(ApiResponse.success(transaction, 'Pembayaran laundry berhasil'));
});
