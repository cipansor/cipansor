import { Request, Response } from 'express';
import { asyncHandler } from '@/middleware/error';
import { ApiResponse } from '@/utils/response';
import * as portfolioService from './portfolio.service';

// =====================================
// PORTFOLIO
// =====================================

/** GET /api/portfolio/types */
export const getTypes = (_req: Request, res: Response) => {
  res.json(
    ApiResponse.success({
      types: portfolioService.PORTFOLIO_TYPES,
      categories: portfolioService.PORTFOLIO_CATEGORIES,
    })
  );
};

/** GET /api/portfolio */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const {
    studentId,
    unitId,
    type,
    category,
    academicYearId,
    isPublic,
    isShowcase,
    search,
    page,
    limit,
  } = req.query;

  const result = await portfolioService.getPortfolios(
    {
      studentId: studentId as string,
      unitId: unitId as string,
      type: type as string,
      category: category as string,
      academicYearId: academicYearId as string,
      isPublic: isPublic === 'true' ? true : isPublic === 'false' ? false : undefined,
      isShowcase: isShowcase === 'true' ? true : isShowcase === 'false' ? false : undefined,
      search: search as string,
      page: page ? parseInt(page as string) : 1,
      limit: limit ? parseInt(limit as string) : 20,
    },
    req.user!
  );

  res.json(ApiResponse.success(result.data, undefined, result.pagination));
});

/** POST /api/portfolio */
export const create = asyncHandler(async (req: Request, res: Response) => {
  const portfolio = await portfolioService.createPortfolio(req.body, req.user!);
  res.status(201).json(ApiResponse.success(portfolio, 'Portfolio berhasil dibuat'));
});

/** GET /api/portfolio/:id */
export const getById = asyncHandler(async (req: Request, res: Response) => {
  const portfolio = await portfolioService.getPortfolioById(req.params.id, req.user!);
  if (!portfolio) {
    return res.status(404).json(ApiResponse.error('Portfolio tidak ditemukan', 'NOT_FOUND'));
  }
  res.json(ApiResponse.success(portfolio));
});

/** PUT /api/portfolio/:id */
export const update = asyncHandler(async (req: Request, res: Response) => {
  const portfolio = await portfolioService.updatePortfolio(req.params.id, req.body, req.user!);
  res.json(ApiResponse.success(portfolio, 'Portfolio berhasil diperbarui'));
});

/** DELETE /api/portfolio/:id */
export const remove = asyncHandler(async (req: Request, res: Response) => {
  await portfolioService.deletePortfolio(req.params.id, req.user!);
  res.json(ApiResponse.success(null, 'Portfolio berhasil dihapus'));
});

// =====================================
// FILES
// =====================================

/** POST /api/portfolio/:id/files */
export const addFile = asyncHandler(async (req: Request, res: Response) => {
  const file = await portfolioService.addPortfolioFile(
    { ...req.body, portfolioId: req.params.id },
    req.user!
  );
  res.status(201).json(ApiResponse.success(file, 'File berhasil ditambahkan'));
});

/** PATCH /api/portfolio/files/:fileId */
export const updateFile = asyncHandler(async (req: Request, res: Response) => {
  const { isCover, sortOrder } = req.body;
  const file = await portfolioService.updatePortfolioFile(
    req.params.fileId,
    { isCover, sortOrder },
    req.user!
  );
  res.json(ApiResponse.success(file, 'File berhasil diperbarui'));
});

/** DELETE /api/portfolio/files/:fileId */
export const deleteFile = asyncHandler(async (req: Request, res: Response) => {
  await portfolioService.deletePortfolioFile(req.params.fileId, req.user!);
  res.json(ApiResponse.success(null, 'File berhasil dihapus'));
});

// =====================================
// COMMENTS
// =====================================

/** POST /api/portfolio/:id/comments */
export const addComment = asyncHandler(async (req: Request, res: Response) => {
  const comment = await portfolioService.addPortfolioComment(
    { portfolioId: req.params.id, content: req.body.content },
    req.user!
  );
  res.status(201).json(ApiResponse.success(comment, 'Komentar berhasil ditambahkan'));
});

/** PATCH /api/portfolio/comments/:commentId */
export const updateComment = asyncHandler(async (req: Request, res: Response) => {
  const { content } = req.body;
  const comment = await portfolioService.updatePortfolioComment(
    req.params.commentId,
    content,
    req.user!
  );
  res.json(ApiResponse.success(comment, 'Komentar berhasil diperbarui'));
});

/** DELETE /api/portfolio/comments/:commentId */
export const deleteComment = asyncHandler(async (req: Request, res: Response) => {
  await portfolioService.deletePortfolioComment(req.params.commentId, req.user!);
  res.json(ApiResponse.success(null, 'Komentar berhasil dihapus'));
});

// =====================================
// REVIEW
// =====================================

/** POST /api/portfolio/:id/review */
export const review = asyncHandler(async (req: Request, res: Response) => {
  const portfolio = await portfolioService.reviewPortfolio(
    req.params.id,
    { ...req.body, reviewedBy: req.user!.sub },
    req.user!
  );
  res.json(ApiResponse.success(portfolio, 'Portfolio berhasil direview'));
});

// =====================================
// STATISTICS
// =====================================

/** GET /api/portfolio/statistics/summary */
export const getStatistics = asyncHandler(async (req: Request, res: Response) => {
  const { studentId, unitId, academicYearId } = req.query;
  const stats = await portfolioService.getPortfolioStatistics(
    {
      studentId: studentId as string,
      unitId: unitId as string,
      academicYearId: academicYearId as string,
    },
    req.user!
  );
  res.json(ApiResponse.success(stats));
});

/** GET /api/portfolio/showcase/:studentId */
export const getShowcase = asyncHandler(async (req: Request, res: Response) => {
  const showcase = await portfolioService.getStudentShowcase(req.params.studentId, req.user!);
  res.json(ApiResponse.success(showcase));
});
