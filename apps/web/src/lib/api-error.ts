/**
 * API Error Handling Utilities
 * Provides consistent error parsing and user-friendly messages
 */

export interface ApiErrorResponse {
  success: false;
  message: string;
  errors?: Record<string, string[]>;
  code?: string;
  statusCode?: number;
}

export interface ParsedApiError {
  title: string;
  message: string;
  details?: string[];
  code?: string;
  statusCode: number;
  isNetworkError: boolean;
  isAuthError: boolean;
  isValidationError: boolean;
  isServerError: boolean;
  isNotFound: boolean;
  isForbidden: boolean;
  isConflict: boolean;
  retry: boolean;
}

const ERROR_MESSAGES: Record<number, { title: string; message: string }> = {
  400: {
    title: "Permintaan Tidak Valid",
    message:
      "Data yang dikirim tidak sesuai format. Periksa kembali input Anda.",
  },
  401: {
    title: "Sesi Berakhir",
    message: "Silakan login kembali untuk melanjutkan.",
  },
  403: {
    title: "Akses Ditolak",
    message: "Anda tidak memiliki izin untuk melakukan tindakan ini.",
  },
  404: {
    title: "Data Tidak Ditemukan",
    message: "Data yang Anda cari tidak ditemukan atau telah dihapus.",
  },
  409: {
    title: "Konflik Data",
    message: "Data sudah ada atau terjadi konflik dengan data lain.",
  },
  422: {
    title: "Validasi Gagal",
    message: "Beberapa field tidak valid. Periksa kembali input Anda.",
  },
  429: {
    title: "Terlalu Banyak Permintaan",
    message: "Anda telah melakukan terlalu banyak permintaan. Coba lagi nanti.",
  },
  500: {
    title: "Kesalahan Server",
    message: "Terjadi kesalahan pada server. Coba lagi nanti.",
  },
  502: {
    title: "Server Tidak Tersedia",
    message: "Server sedang tidak dapat dijangkau. Coba lagi nanti.",
  },
  503: {
    title: "Layanan Tidak Tersedia",
    message: "Layanan sedang dalam pemeliharaan. Coba lagi nanti.",
  },
  504: {
    title: "Timeout",
    message: "Server tidak merespon dalam waktu yang ditentukan.",
  },
};

const NETWORK_ERROR_CODES = [
  "ERR_NETWORK",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
];

/**
 * Parse API error response into a user-friendly format
 */
export function parseApiError(error: unknown): ParsedApiError {
  // Default error
  const defaultError: ParsedApiError = {
    title: "Terjadi Kesalahan",
    message: "Terjadi kesalahan yang tidak terduga. Silakan coba lagi.",
    statusCode: 0,
    isNetworkError: false,
    isAuthError: false,
    isValidationError: false,
    isServerError: false,
    isNotFound: false,
    isForbidden: false,
    isConflict: false,
    retry: true,
  };

  if (!error) {
    return defaultError;
  }

  // Handle network errors
  if (error instanceof TypeError && error.message === "Failed to fetch") {
    return {
      ...defaultError,
      title: "Koneksi Terputus",
      message:
        "Tidak dapat terhubung ke server. Periksa koneksi internet Anda.",
      isNetworkError: true,
      retry: true,
    };
  }

  // Handle Axios-like errors
  if (typeof error === "object" && error !== null) {
    const err = error as Record<string, unknown>;

    // Check for network error codes
    if (err.code && NETWORK_ERROR_CODES.includes(err.code as string)) {
      return {
        ...defaultError,
        title: "Koneksi Terputus",
        message:
          "Tidak dapat terhubung ke server. Periksa koneksi internet Anda.",
        code: err.code as string,
        isNetworkError: true,
        retry: true,
      };
    }

    // Extract status code
    const statusCode =
      (err.status as number) ||
      (err.statusCode as number) ||
      ((err.response as Record<string, unknown>)?.status as number) ||
      0;

    // Extract message from response
    let message = "";
    let details: string[] = [];

    const responseData = (err.response as Record<string, unknown>)
      ?.data as Record<string, unknown>;

    if (responseData) {
      // The API's envelope is `{ success: false, error: { code, message } }`;
      // a bare `message` is the older shape some routes still send. Reading
      // only the latter showed "Data yang dikirim tidak sesuai format" for
      // every refusal whose reason the API had spelled out.
      const envelope = responseData.error as
        { message?: unknown; details?: unknown } | undefined;
      message =
        (typeof envelope?.message === "string" && envelope.message) ||
        (responseData.message as string) ||
        "";

      // The API puts per-field reasons in `error.details` as
      // `{ field, message }`; older routes used `errors` as
      // `{ field: string[] }`. Read both.
      if (Array.isArray(envelope?.details)) {
        details = envelope.details.flatMap((detail) => {
          if (typeof detail === "string") return [detail];
          if (!detail || typeof detail !== "object") return [];
          const { field, message: reason } = detail as {
            field?: unknown;
            message?: unknown;
          };
          if (typeof reason !== "string" || !reason) return [];
          return [
            typeof field === "string" && field ? `${field}: ${reason}` : reason,
          ];
        });
      }
      if (responseData.errors && typeof responseData.errors === "object") {
        const errors = responseData.errors as Record<string, string[]>;
        details.push(
          ...Object.entries(errors).flatMap(([field, messages]) =>
            messages.map((msg) => `${field}: ${msg}`),
          ),
        );
      }

      // "Validation failed" alone is not actionable; the field name says which
      // input was refused, and the reason says how to fix it.
      if (
        /^(validation failed|validasi gagal)$/i.test(message.trim()) &&
        details[0]
      ) {
        message = details[0];
      }
    } else if (err.message) {
      message = err.message as string;
    }

    const errorInfo = ERROR_MESSAGES[statusCode] || defaultError;

    return {
      title: errorInfo.title,
      message: message || errorInfo.message,
      details: details.length > 0 ? details : undefined,
      code: err.code as string | undefined,
      statusCode,
      isNetworkError: statusCode === 0,
      isAuthError: statusCode === 401,
      isValidationError: statusCode === 400 || statusCode === 422,
      isServerError: statusCode >= 500,
      isNotFound: statusCode === 404,
      isForbidden: statusCode === 403,
      isConflict: statusCode === 409,
      retry: statusCode >= 500 || statusCode === 429 || statusCode === 0,
    };
  }

  // Handle string errors
  if (typeof error === "string") {
    return {
      ...defaultError,
      message: error,
    };
  }

  return defaultError;
}

/**
 * Get a short, user-friendly error message
 */
export function getErrorMessage(error: unknown): string {
  const parsed = parseApiError(error);
  return parsed.message;
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  const parsed = parseApiError(error);
  return parsed.retry;
}

/**
 * Check if error requires re-authentication
 */
export function isAuthError(error: unknown): boolean {
  const parsed = parseApiError(error);
  return parsed.isAuthError;
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(error: unknown): Record<string, string> {
  const parsed = parseApiError(error);

  if (!parsed.details) {
    return {};
  }

  const formatted: Record<string, string> = {};

  for (const detail of parsed.details) {
    const [field, ...messageParts] = detail.split(": ");
    if (field && messageParts.length > 0) {
      formatted[field] = messageParts.join(": ");
    }
  }

  return formatted;
}

/**
 * Create an error handler for React Query mutations
 */
export function createMutationErrorHandler(options?: {
  onAuthError?: () => void;
  onValidationError?: (errors: Record<string, string>) => void;
  showToast?: (
    title: string,
    message: string,
    type: "error" | "warning",
  ) => void;
}) {
  return (error: unknown) => {
    const parsed = parseApiError(error);

    // Handle auth errors - redirect to login
    if (parsed.isAuthError && options?.onAuthError) {
      options.onAuthError();
      return;
    }

    // Handle validation errors - show field errors
    if (parsed.isValidationError && options?.onValidationError) {
      const errors = formatValidationErrors(error);
      options.onValidationError(errors);
    }

    // Show toast notification
    if (options?.showToast) {
      options.showToast(
        parsed.title,
        parsed.message,
        parsed.isServerError ? "error" : "warning",
      );
    }
  };
}
