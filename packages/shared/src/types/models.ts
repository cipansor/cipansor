import { UnitType, Gender } from "./enums";

// Base types
export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

// Unit
export interface Unit extends BaseEntity {
  name: string;
  type: UnitType;
  address: string;
  phone?: string | null;
  email?: string | null;
}

// Student
export interface Student extends BaseEntity {
  userId: string;
  unitId: string;
  nis: string;
  nisn?: string | null;
  gender: Gender;
  birthPlace: string;
  birthDate: Date;
  address: string;
  parentName: string;
  parentPhone: string;
}

// API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  message?: string;
  error?: ApiError;
  /**
   * Pagination, at the top level — the shape `ApiResponse.success(data, message,
   * pagination)` actually returns (`apps/api/src/utils/response.ts`).
   *
   * `meta.pagination` is the other envelope some modules use; both are declared
   * so a client can read either without guessing. Reading the wrong one
   * silently yields `undefined`, which is how a list once lost its page control.
   */
  pagination?: Pagination;
  meta?: {
    pagination?: Pagination;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: Array<{ field: string; message: string }>;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  message?: string;
  meta: {
    pagination: Pagination;
  };
}

// Alias for consistency with new modules
export type SharedPaginatedResponse<T> = PaginatedResponse<T>;
