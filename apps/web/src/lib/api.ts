import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { toast } from "sonner";

// Allow any request to opt out of the global error toast in the response
// interceptor. Best-effort aggregation calls (the role dashboards fire several
// parallel requests the user may not be authorised for) set this so a 403/404
// on one of them doesn't spam "missing permission" / "route not found".
declare module "axios" {
  export interface AxiosRequestConfig {
    skipErrorToast?: boolean;
  }
}
import {
  User,
  LoginRequest,
  LoginResponse,
  UserRoleAssignment,
  Role,
  RoleAssignment,
  SwitchRoleResponse,
  AssignRoleRequest,
  TwoFactorStatus,
  ApiResponse,
  PaginatedResponse as SharedPaginatedResponse,
  TahfidzRecord,
  TahfidzDashboardStats,
  TahfidzStudentSummary,
  CreateTahfidzInput,
  UpdateTahfidzInput,
} from "@cipansor/shared";

// 2FA Types
export interface TwoFactorGenerateResponse {
  secret: string;
  qrCodeUrl: string;
}

export interface TwoFactorEnableResponse {
  recoveryCodes: string[];
}

export type TwoFactorStatusResponse = TwoFactorStatus;

// Explicitly export SharedPaginatedResponse for new modules
export type { SharedPaginatedResponse };
// Re-export shared types
export * from "@cipansor/shared";

// Compatibility alias
export type UserRole = UserRoleAssignment;

// LEGACY PaginatedResponse
export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Local types for Roles (since shared was not updated)
export interface CreateRoleInput {
  code: string;
  name: string;
  description?: string;
  permissions?: string[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  permissions?: string[];
}

// NEXT_PUBLIC_API_URL is the API *base* origin (no /api suffix); the `/api`
// prefix is appended here so every consumer of this env var uses one
// convention. Callers of this axios instance use bare paths (e.g. "/students").
//
// `??`, not `||`, on purpose. An empty value is a meaningful setting: it makes
// the base relative ("/api"), so the bundle talks to whichever origin served
// the page. That is what lets one image serve both cipansor.or.id and
// portal.cipansor.or.id with the API same-origin on each — the value is inlined
// at build time, so an absolute origin baked here would make one of the two
// hosts cross-origin and put CORS on the critical path. `||` would have folded
// that empty string into the localhost fallback and silently broken it.
// Unset still falls back to localhost:3001 for `pnpm dev`, where the web dev
// server (:3000) and the API (:3001) really are different origins.
const API_URL = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api`;

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
  // Send and receive the HttpOnly session cookies. In development the web
  // (:3000) and API (:3001) are different origins, so without this the browser
  // would not attach the cookie; in production the two are same-origin, where
  // this is a no-op. The API's CORS allowlist must (and does) echo the origin
  // and set `Access-Control-Allow-Credentials`.
  withCredentials: true,
});

/** Read a cookie the API set for the double-submit CSRF check. */
function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** A method that changes state and therefore needs the CSRF header. */
const UNSAFE_METHODS = new Set(["post", "put", "patch", "delete"]);

// Request interceptor to attach the double-submit CSRF token.
//
// The session cookie rides along automatically; this only echoes the readable
// CSRF cookie the API set beside it. The API rejects an unsafe request that
// carries a session cookie without a matching header — the cross-site forgery
// the cookie would otherwise permit. There is no Authorization header any
// more: the bearer lives in the HttpOnly cookie, invisible to this code.
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (typeof window === "undefined") return config;
    const method = (config.method ?? "get").toLowerCase();
    if (UNSAFE_METHODS.has(method)) {
      const csrf = readCookie("cipansor_csrf");
      if (csrf) config.headers["x-csrf-token"] = csrf;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

/**
 * Single-flight refresh.
 *
 * The API rotates refresh tokens: `/auth/refresh` deletes the presented token
 * and issues a new one. A page that fires several requests in parallel with an
 * expired access token therefore used to send several concurrent refreshes —
 * the first rotated the token and the rest presented one the server had just
 * deleted, got 401 "Refresh token not found", and the catch below logged the
 * user out. That is exactly what the audit caught: pages bouncing to /login
 * and then, via middleware, to the role dashboard, losing the requested page.
 *
 * Now the first 401 performs the refresh and everyone else awaits its result.
 */
let refreshInFlight: Promise<void> | null = null;

/**
 * Serialize the refresh across tabs of the same origin.
 *
 * The in-page single-flight above only covers one document. Two tabs whose
 * access token expired at the same moment both call `/auth/refresh`, and the
 * server rotates the refresh token on first use — so the second tab presents a
 * token that was just deleted and is logged out. The Web Locks API holds the
 * lock while one tab refreshes; the other waits, then presents the *rotated*
 * refresh cookie the first tab's response already set, and succeeds. Falls back
 * to running inline where the API is unavailable.
 */
function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && "locks" in navigator) {
    return navigator.locks.request(
      "cipansor-session-refresh",
      fn,
    ) as Promise<T>;
  }
  return fn();
}

function refreshAccessToken(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = withRefreshLock(async () => {
    // The refresh token is an HttpOnly cookie the API reads itself; there is
    // nothing to read here. `withCredentials` on the shared instance makes the
    // browser attach it. No local session is a normal, non-error state for an
    // anonymous visitor, and the API answers 401, which the caller treats the
    // same way NoSessionError used to be treated.
    //
    // This bypasses the `api` instance (and its request interceptor), so it
    // must echo the CSRF cookie itself: the refresh cookie makes this an
    // unsafe, cookie-authenticated POST, which the API's CSRF gate rejects
    // without a matching header. The API keeps the same CSRF value across a
    // refresh, so a request holding the previous value still matches.
    const csrf = readCookie("cipansor_csrf");
    await axios.post(
      `${API_URL}/auth/refresh`,
      {},
      {
        withCredentials: true,
        ...(csrf ? { headers: { "x-csrf-token": csrf } } : {}),
      },
    );
  }).finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

// Response interceptor for token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
      skipErrorToast?: boolean;
    };

    // Auth endpoints that should NEVER trigger token refresh —
    // their 401 means "wrong credentials", not "expired token". A wrong code
    // on the 2FA step is one: there is no session to refresh yet.
    const authPaths = [
      "/auth/login",
      "/auth/register",
      "/auth/refresh",
      "/auth/2fa/login",
      "/auth/new-password",
    ];
    const requestUrl = originalRequest?.url ?? "";
    const isAuthEndpoint = authPaths.some((p) => requestUrl.includes(p));

    // Handle 401 Unauthorized (Token Refresh) — skip for auth endpoints
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !isAuthEndpoint
    ) {
      originalRequest._retry = true;

      // An anonymous visitor never had a session to lose, so there is nothing
      // to refresh and nowhere to send them. Public pages call protected
      // endpoints (the SPMB page reads /units), and bouncing a prospective
      // parent to the staff login screen over that 401 is far worse than
      // letting the caller render its own empty state. Nor is a refresh sent:
      // it would spend the per-IP auth rate limit on every anonymous page, and
      // its refusal could land after a sign-in has set the cookies.
      //
      // The readable CSRF cookie is set with every session and cleared with
      // it — the one trace of the HttpOnly session that script can see. Read
      // it before the refresh: a refused refresh clears it in its own response.
      if (readCookie("cipansor_csrf") === null) {
        return Promise.reject(error);
      }

      try {
        await refreshAccessToken();
        // The rotated token is in a new cookie; simply replay the request and
        // let the browser attach it.
        return api(originalRequest);
      } catch (refreshError) {
        // Only a definitive rejection means the session is really gone. A 429
        // from the rate limiter, a 5xx or a dropped connection says nothing
        // about the token's validity, and logging the user out over one would
        // throw away a working session — the same reasoning as `fetchUser` in
        // stores/auth.ts.
        const status = (refreshError as AxiosError)?.response?.status;
        const isDefinitive = status === 400 || status === 401 || status === 403;
        if (!isDefinitive) {
          return Promise.reject(error);
        }

        if (
          typeof window !== "undefined" &&
          !window.location.pathname.includes("/login")
        ) {
          window.location.href = "/login";
        }
      }
    }

    // Extract the human-readable error message from the API response envelope
    const data = error.response?.data as any;
    const friendlyMessage =
      data?.error?.message ||
      data?.message ||
      error.message ||
      "Terjadi kesalahan sistem";
    const code = data?.error?.code;

    // Show toast for all errors EXCEPT 401 on non-auth endpoints
    // (those are handled by the refresh logic above or silently redirected)
    // and EXCEPT calls that opted out via `skipErrorToast` — best-effort
    // aggregation calls (e.g. the role dashboards fire several parallel
    // requests the user may not be authorised for) handle their own failures
    // and must not spam "missing permission" / "route not found" toasts.
    if (
      !originalRequest?.skipErrorToast &&
      (error.response?.status !== 401 || isAuthEndpoint)
    ) {
      toast.error(friendlyMessage, {
        description: code ? `Error Code: ${code}` : undefined,
      });
    }

    // Attach the friendly message so downstream catch blocks get it easily
    if (data?.error?.message) {
      error.message = data.error.message;
    }

    return Promise.reject(error);
  },
);

// Auth API
export const authApi = {
  login: (data: LoginRequest) =>
    api.post<ApiResponse<LoginResponse>>("/auth/login", data),

  // `pushEndpoint` scopes the server's push cleanup to this browser, so a
  // logout here does not stop push on the user's other signed-in devices.
  logout: (pushEndpoint?: string | null) =>
    api.post("/auth/logout", pushEndpoint ? { pushEndpoint } : {}),

  me: () => api.get<ApiResponse<User>>("/auth/me"),

  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.put("/auth/password", data),

  // An admin e-mails a reset link to a user (Pengguna → ⋯ → Kirim tautan
  // reset password). Keyed on a user id: there is deliberately no public
  // "lupa password" form.
  sendPasswordReset: (data: { userId: string }) =>
    api.post<ApiResponse<{ message: string; expiresInHours: number }>>(
      "/auth/send-password-reset",
      data,
    ),

  // The link's page sets the new password. The page shows one message for
  // every refusal, so the interceptor's toast would say it twice.
  resetPassword: (data: {
    token: string;
    newPassword: string;
    turnstileToken?: string;
  }) => api.post("/auth/reset-password", data, { skipErrorToast: true }),

  // 2FA methods
  generate2FA: () =>
    api.post<ApiResponse<TwoFactorGenerateResponse>>("/auth/2fa/generate"),
  enable2FA: (data: { token: string }) =>
    api.post<ApiResponse<TwoFactorEnableResponse>>("/auth/2fa/enable", data),
  // The new password a sign-in asked for (`requiresPasswordChange`); the
  // form shows the reason for a refusal on its field.
  newPassword: (data: { newPassword: string }) =>
    api.post<ApiResponse<LoginResponse>>("/auth/new-password", data, {
      skipErrorToast: true,
    }),
  // The sign-in card shows the error inline; a toast would say it twice.
  verify2FA: (data: { token: string }) =>
    api.post<ApiResponse<LoginResponse>>("/auth/2fa/login", data, {
      skipErrorToast: true,
    }),
  // `mustChangePassword`: the password is under 15 characters, allowed only
  // with 2FA on, so a new one is due before the next sign-in completes.
  disable2FA: (data: { token: string; userId?: string }) =>
    api.post<ApiResponse<{ message: string; mustChangePassword: boolean }>>(
      "/auth/2fa/disable",
      data,
    ),
  get2FAStatus: () =>
    api.get<ApiResponse<TwoFactorStatusResponse>>("/auth/2fa/status"),
};

export const rolesApi = {
  // Get current user's roles
  getMyRoles: () =>
    api.get<ApiResponse<UserRoleAssignment[]>>("/roles/my-roles"),

  // Switch active role
  switchRole: (roleAssignmentId: string) =>
    api.post<ApiResponse<SwitchRoleResponse>>("/roles/switch", {
      roleAssignmentId,
    }),

  // Get all roles (optionally filtered by realm)
  getAllRoles: (realm?: string) =>
    api.get<ApiResponse<Role[]>>("/roles", {
      params: realm ? { realm } : undefined,
    }),

  // Get role by ID
  getRoleById: (id: string) => api.get<ApiResponse<Role>>(`/roles/${id}`),

  // Create role
  createRole: (data: CreateRoleInput) =>
    api.post<ApiResponse<Role>>("/roles", data),

  // Update role
  updateRole: (id: string, data: UpdateRoleInput) =>
    api.patch<ApiResponse<Role>>(`/roles/${id}`, data),

  // Get roles assigned to a user
  getUserRoles: (userId: string) =>
    api.get<ApiResponse<RoleAssignment[]>>(`/roles/users/${userId}`),

  // Assign role to user
  assignRole: (data: AssignRoleRequest) =>
    api.post<ApiResponse<RoleAssignment>>("/roles/assign", data),

  // Set primary role for user
  setPrimaryRole: (userId: string, roleAssignmentId: string) =>
    api.patch<ApiResponse<RoleAssignment>>(`/roles/users/${userId}/primary`, {
      roleAssignmentId,
    }),

  // Remove role assignment
  removeRoleAssignment: (assignmentId: string) =>
    api.delete<ApiResponse<void>>(`/roles/assignments/${assignmentId}`),
};

// Tahfidz API
export const tahfidzApi = {
  getRecords: (params?: any) =>
    api.get<SharedPaginatedResponse<TahfidzRecord>>("/tahfidz", { params }),

  getRecordById: (id: string) =>
    api.get<ApiResponse<TahfidzRecord>>(`/tahfidz/${id}`),

  createRecord: (data: CreateTahfidzInput) =>
    api.post<ApiResponse<TahfidzRecord>>("/tahfidz", data),

  updateRecord: (id: string, data: UpdateTahfidzInput) =>
    api.put<ApiResponse<TahfidzRecord>>(`/tahfidz/${id}`, data),

  deleteRecord: (id: string) => api.delete<ApiResponse<void>>(`/tahfidz/${id}`),

  getDashboard: (params: { unitId?: string; year?: number; month?: number }) =>
    api.get<ApiResponse<TahfidzDashboardStats>>("/tahfidz/stats", {
      params,
    }),

  getStudentSummary: (studentId: string) =>
    api.get<ApiResponse<TahfidzStudentSummary>>(
      `/tahfidz/summary/${studentId}`,
    ),
};

// General Upload API
export const uploadApi = {
  uploadFile: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<
      ApiResponse<{
        url: string;
        filename: string;
        mimetype: string;
        size: number;
      }>
    >("/upload", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
  },
};

export default api;
