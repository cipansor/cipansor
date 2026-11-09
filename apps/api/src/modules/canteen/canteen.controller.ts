import { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error';
import {
  ListCategoriesQuerySchema,
  ListItemsQuerySchema,
  ListTransactionsQuerySchema,
  ListStockMovementsQuerySchema,
  type TransactionStatsQuery,
} from './canteen.schema';
import {
  categoryService,
  itemService,
  transactionService,
  stockMovementService,
} from './canteen.service';
import { ApiResponse } from '../../utils/response';
import { resolveUnitId, isSuperAdminUser } from '../../utils/resolve-unit-id';

// =============================================================================
// CATEGORY
// =============================================================================

/** GET /api/canteen/categories */
export const listCategories = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  // SUPER_ADMIN may list across all units (no unitId scoping required)
  if (!unitId && !isSuperAdminUser(req)) {
    return res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
  }
  const parsedQuery = ListCategoriesQuerySchema.parse(req.query);
  const categories = await categoryService.getAll(unitId, parsedQuery.businessUnitId);
  return res.json(ApiResponse.success(categories, 'Berhasil mengambil data kategori'));
});

/** GET /api/canteen/categories/:id */
export const getCategory = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  if (!unitId) {
    return res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
  }
  const category = await categoryService.getById(req.params.id, unitId);
  if (!category) {
    return res.status(404).json(ApiResponse.error('Kategori tidak ditemukan', 'NOT_FOUND'));
  }
  return res.json(ApiResponse.success(category, 'Berhasil mengambil data kategori'));
});

/** GET /api/canteen/efficiency */
export const getEfficiency = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  if (!unitId && !isSuperAdminUser(req)) {
    return res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
  }
  const businessUnitId = req.query.businessUnitId as string | undefined;
  const efficiency = await categoryService.getBusinessEfficiency(unitId, businessUnitId);
  return res.json(ApiResponse.success(efficiency, 'Berhasil mengambil data efisiensi'));
});

/** POST /api/canteen/categories */
export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  if (!unitId) {
    return res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
  }
  const category = await categoryService.create(unitId, req.body);
  return res.status(201).json(ApiResponse.success(category, 'Kategori berhasil dibuat'));
});

/** PUT /api/canteen/categories/:id */
export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  if (!unitId) {
    return res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
  }
  const category = await categoryService.update(req.params.id, unitId, req.body);
  return res.json(ApiResponse.success(category, 'Kategori berhasil diperbarui'));
});

/** DELETE /api/canteen/categories/:id */
export const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  if (!unitId) {
    return res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
  }
  await categoryService.delete(req.params.id, unitId);
  return res.json(ApiResponse.success(null, 'Kategori berhasil dihapus'));
});

// =============================================================================
// ITEM
// =============================================================================

/** GET /api/canteen/items */
export const listItems = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  if (!unitId && !isSuperAdminUser(req)) {
    return res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
  }
  const parsedQuery = ListItemsQuerySchema.parse(req.query);
  const result = await itemService.getAll(unitId, parsedQuery);
  return res.json(
    ApiResponse.success(result.data, 'Berhasil mengambil data item', result.pagination)
  );
});

/** GET /api/canteen/items/low-stock */
export const listLowStockItems = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  if (!unitId && !isSuperAdminUser(req)) {
    return res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
  }
  const items = await itemService.getLowStockItems(unitId);
  return res.json(ApiResponse.success(items, 'Berhasil mengambil data item stok rendah'));
});

/** GET /api/canteen/items/:id */
export const getItem = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  if (!unitId) {
    return res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
  }
  const item = await itemService.getById(req.params.id, unitId);
  if (!item) {
    return res.status(404).json(ApiResponse.error('Item tidak ditemukan', 'NOT_FOUND'));
  }
  return res.json(ApiResponse.success(item, 'Berhasil mengambil data item'));
});

/** POST /api/canteen/items */
export const createItem = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  if (!unitId) {
    return res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
  }
  const item = await itemService.create(unitId, req.body);
  return res.status(201).json(ApiResponse.success(item, 'Item berhasil dibuat'));
});

/** PUT /api/canteen/items/:id */
export const updateItem = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  if (!unitId) {
    return res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
  }
  const item = await itemService.update(req.params.id, unitId, req.body);
  return res.json(ApiResponse.success(item, 'Item berhasil diperbarui'));
});

/** DELETE /api/canteen/items/:id */
export const deleteItem = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  if (!unitId) {
    return res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
  }
  await itemService.delete(req.params.id, unitId);
  return res.json(ApiResponse.success(null, 'Item berhasil dihapus'));
});

// =============================================================================
// TRANSACTION
// =============================================================================

/** GET /api/canteen/transactions */
export const listTransactions = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  if (!unitId && !isSuperAdminUser(req)) {
    return res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
  }
  const parsedQuery = ListTransactionsQuerySchema.parse(req.query);
  const result = await transactionService.getAll(unitId, parsedQuery);
  return res.json(
    ApiResponse.success(result.data, 'Berhasil mengambil data transaksi', result.pagination)
  );
});

/** GET /api/canteen/transactions/stats */
export const getTransactionStats = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  if (!unitId && !isSuperAdminUser(req)) {
    return res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
  }
  // Validated at the route (TransactionStatsQuerySchema): two WIB days, YYYY-MM-DD.
  const { startDate, endDate } = res.locals.validatedQuery as TransactionStatsQuery;
  const stats = await transactionService.getStats(unitId, startDate, endDate);
  return res.json(ApiResponse.success(stats, 'Berhasil mengambil statistik transaksi'));
});

/** GET /api/canteen/transactions/:id */
export const getTransaction = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  if (!unitId) {
    return res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
  }
  const transaction = await transactionService.getById(req.params.id, unitId);
  if (!transaction) {
    return res.status(404).json(ApiResponse.error('Transaksi tidak ditemukan', 'NOT_FOUND'));
  }
  return res.json(ApiResponse.success(transaction, 'Berhasil mengambil data transaksi'));
});

/** POST /api/canteen/transactions */
export const createTransaction = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  const userId = req.user?.sub;
  if (!unitId || !userId) {
    return res
      .status(400)
      .json(ApiResponse.error('Unit ID atau User ID tidak ditemukan', 'REQUIRED'));
  }
  const transaction = await transactionService.create(unitId, userId, req.body);
  return res.status(201).json(ApiResponse.success(transaction, 'Transaksi berhasil dibuat'));
});

/** PATCH /api/canteen/transactions/:id/status */
export const updateTransactionStatus = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
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
  return res.json(ApiResponse.success(transaction, 'Status transaksi berhasil diperbarui'));
});

// =============================================================================
// STOCK MOVEMENT
// =============================================================================

/** GET /api/canteen/stock-movements */
export const listStockMovements = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  if (!unitId) {
    return res.status(400).json(ApiResponse.error('Unit ID tidak ditemukan', 'UNIT_REQUIRED'));
  }
  const parsedQuery = ListStockMovementsQuerySchema.parse(req.query);
  const result = await stockMovementService.getAll(unitId, parsedQuery);
  return res.json(
    ApiResponse.success(result.data, 'Berhasil mengambil data pergerakan stok', result.pagination)
  );
});

/** POST /api/canteen/stock-movements */
export const createStockMovement = asyncHandler(async (req: Request, res: Response) => {
  const unitId = resolveUnitId(req);
  const userId = req.user?.sub;
  if (!unitId || !userId) {
    return res
      .status(400)
      .json(ApiResponse.error('Unit ID atau User ID tidak ditemukan', 'REQUIRED'));
  }
  const movement = await stockMovementService.create(unitId, userId, req.body);
  return res.status(201).json(ApiResponse.success(movement, 'Pergerakan stok berhasil dicatat'));
});
