import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodSchema } from 'zod';
import { logger } from '@/lib/logger';

// Error codes
export enum ErrorCode {
  // Client errors
  BAD_REQUEST = 'BAD_REQUEST',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',

  // Server errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
}

// HTTP status mapping
const statusCodeMap: Record<ErrorCode, number> = {
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.DATABASE_ERROR]: 500,
};

// Custom API Error class
export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: Array<{ field: string; message: string }>
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get statusCode(): number {
    return statusCodeMap[this.code];
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export class AppError extends ApiError {}

// Helper functions to create common errors
export const Errors = {
  badRequest: (message: string) => new ApiError(ErrorCode.BAD_REQUEST, message),

  validationError: (details: Array<{ field: string; message: string }>) =>
    new ApiError(ErrorCode.VALIDATION_ERROR, 'Validation failed', details),

  /**
   * A 400 that carries its own sentence, for callers whose message is meant to
   * be read by the person who sent the request rather than by a developer.
   *
   * `validationError` hardcodes "Validation failed" as the top-level message,
   * which is fine when the per-field details carry the explanation. Some
   * refusals have no field to attach to — "no registered contact to verify
   * against" is about the record, not the payload — and there the generic
   * sentence leaves the caller with nothing actionable.
   */
  validation: (message: string, details?: Array<{ field: string; message: string }>) =>
    new ApiError(ErrorCode.VALIDATION_ERROR, message, details),

  unauthorized: (message = 'Authentication required') =>
    new ApiError(ErrorCode.UNAUTHORIZED, message),

  forbidden: (message = 'Access denied') => new ApiError(ErrorCode.FORBIDDEN, message),

  notFound: (resource: string) => new ApiError(ErrorCode.NOT_FOUND, `${resource} not found`),

  conflict: (message: string) => new ApiError(ErrorCode.CONFLICT, message),

  internal: (message = 'Internal server error') => new ApiError(ErrorCode.INTERNAL_ERROR, message),
};

// Error handler middleware
export function errorHandler(error: Error, req: Request, res: Response, next: NextFunction) {
  // Log error
  logger.error('Request error:', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
  });

  // Handle API errors
  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({
      success: false,
      error: error.toJSON(),
    });
  }

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const details = error.issues.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));

    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details,
      },
    });
  }

  /**
   * Unggahan yang ditolak multer: berkas melebihi batas, terlalu banyak
   * berkas, atau kolom yang tidak dikenal. `middleware/upload.ts` menangkapnya
   * sendiri, tetapi rute yang memasang multer langsung — sertifikat
   * akreditasi, surat dokter izin — meneruskannya ke sini, dan tanpa cabang ini
   * sebuah PDF 6 MB dijawab 500 "Internal server error": kesalahan pengirim
   * terbaca sebagai kerusakan server. Dikenali lewat `name`, tanpa mengimpor
   * multer.
   */
  if (error.name === 'MulterError') {
    const tooLarge = (error as { code?: string }).code === 'LIMIT_FILE_SIZE';
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCode.BAD_REQUEST,
        message: tooLarge
          ? 'Berkas melebihi ukuran yang diizinkan'
          : 'Unggahan tidak dapat diterima',
      },
    });
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: {
        code: ErrorCode.UNAUTHORIZED,
        message: 'Invalid token',
      },
    });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: {
        code: ErrorCode.UNAUTHORIZED,
        message: 'Token expired',
      },
    });
  }

  /**
   * Aturan alur surat menolak dengan alasannya sendiri — dan alasan itu harus
   * sampai kepada petugasnya.
   *
   * `utils/letter-workflow.ts` sengaja melempar, bukan mengembalikan boolean,
   * supaya "belum giliran Anda, menunggu verifikator urutan 2" berbeda dari
   * "surat ini sudah ditandatangani". Tanpa cabang ini keduanya jatuh ke
   * penanganan galat umum di bawah, yang di produksi menjawab 500 "Internal
   * server error": setiap penolakan alur yang wajar terbaca sebagai kerusakan
   * server, dan kalimat yang ditulis untuk menjelaskannya dibuang tepat
   * sebelum dibaca.
   *
   * 409, bukan 400: permintaannya sendiri sah, keadaan suratlah yang belum
   * mengizinkannya.
   *
   * Dikenali lewat `name`, seperti galat JWT di atas, agar middleware ini
   * tidak perlu mengimpor modul alur surat.
   */
  if (error.name === 'WorkflowError') {
    return res.status(409).json({
      success: false,
      error: {
        code: ErrorCode.CONFLICT,
        message: error.message,
      },
    });
  }

  // Handle Prisma errors
  if (error.name === 'PrismaClientKnownRequestError') {
    const prismaError = error as any;

    // Unique constraint violation
    if (prismaError.code === 'P2002') {
      const field = prismaError.meta?.target?.[0] || 'field';
      return res.status(409).json({
        success: false,
        error: {
          code: ErrorCode.CONFLICT,
          message: `${field} already exists`,
        },
      });
    }

    // Record not found
    if (prismaError.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: {
          code: ErrorCode.NOT_FOUND,
          message: 'Record not found',
        },
      });
    }
  }

  // Generic error
  return res.status(500).json({
    success: false,
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    },
  });
}

// Async handler wrapper
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Validation middleware
export function validate<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Validate query params (parses and attaches to res.locals.query)
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // In Express 5, req.query is read-only, so we validate and store in res.locals
      res.locals.validatedQuery = schema.parse(req.query);
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Validate params
export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Just validate, params is also read-only in Express 5
      schema.parse(req.params);
      next();
    } catch (error) {
      next(error);
    }
  };
}

// 404 Not Found handler
export function notFoundHandler(req: Request, res: Response, _next: NextFunction) {
  res.status(404).json({
    success: false,
    error: {
      code: ErrorCode.NOT_FOUND,
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}
