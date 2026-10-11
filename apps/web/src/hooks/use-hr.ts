import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import {
  LeaveStatus,
  LeaveType,
  StaffAttendanceStatus,
  type AttendanceEvidence,
  type AttendanceExemption,
  type AttendancePolicy,
  type AttendanceSite,
  type HolidayDraft,
  type HolidaySyncConfig,
  type HolidaySyncResult,
  type LeaveTypeConfig,
  type MyAttendance,
  type MyAttendanceToday,
  type RetentionPolicy,
  type SelfAttendanceInput,
  type ShiftAssignment,
  type ShiftRotation,
  type StaffAttendance,
  type WorkCalendarDay,
  type WorkShift,
  type WorkWeekConfig,
} from "@cipansor/shared";

// Re-exported so existing pages keep importing these from the hook module; the
// contracts themselves live once, in `@cipansor/shared` (golden rule #8).
export {
  LeaveStatus,
  LeaveType,
  StaffAttendanceStatus,
  type AttendanceEvidence,
  type AttendanceExemption,
  type AttendancePolicy,
  type AttendanceSite,
  type HolidayDraft,
  type HolidaySyncConfig,
  type HolidaySyncResult,
  type LeaveTypeConfig,
  type MyAttendance,
  type MyAttendanceToday,
  type RetentionPolicy,
  type ShiftAssignment,
  type ShiftRotation,
  type StaffAttendance,
  type WorkCalendarDay,
  type WorkShift,
  type WorkWeekConfig,
};

// Types
export type EmployeeStatus =
  "ACTIVE" | "INACTIVE" | "ON_LEAVE" | "RESIGNED" | "RETIRED";
export type EmployeeType = "PERMANENT" | "CONTRACT" | "PART_TIME" | "INTERN";
type Gender = "MALE" | "FEMALE";

export const EMPLOYEE_STATUSES: EmployeeStatus[] = [
  "ACTIVE",
  "INACTIVE",
  "ON_LEAVE",
  "RESIGNED",
  "RETIRED",
];
export const EMPLOYEE_TYPES: EmployeeType[] = [
  "PERMANENT",
  "CONTRACT",
  "PART_TIME",
  "INTERN",
];

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  ACTIVE: "Aktif",
  INACTIVE: "Tidak Aktif",
  ON_LEAVE: "Cuti",
  RESIGNED: "Resign",
  RETIRED: "Pensiun",
};

export const EMPLOYEE_TYPE_LABELS: Record<EmployeeType, string> = {
  PERMANENT: "Tetap",
  CONTRACT: "Kontrak",
  PART_TIME: "Part Time",
  INTERN: "Magang",
};

export interface Employee {
  id: string;
  nip?: string;
  userId?: string;
  /** The Teacher or Staff profile id — what the leave list filters on. */
  teacherId?: string;
  staffId?: string;
  user?: {
    id: string;
    name: string;
    email: string;
    phone?: string | null;
    isActive?: boolean;
  };
  unitId: string;
  unit?: {
    id: string;
    name: string;
  };
  departmentId?: string;
  department?: string;

  // Personal info
  fullName: string;
  gender?: Gender;
  birthPlace?: string;
  birthDate?: string;
  nationalId?: string;
  nik?: string;
  taxId?: string;
  npwp?: string;
  maritalStatus?: string;
  religion?: string;

  // Contact
  phone?: string;
  email: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;

  // Employment
  position: string;
  employeeType: EmployeeType;
  status: EmployeeStatus;
  role?: string;
  joinDate?: string;
  endDate?: string;
  resignDate?: string;

  // Education
  lastEducation?: string;
  educationMajor?: string;
  educationInstitution?: string;
  graduationYear?: number;

  // Bank info
  bankName?: string;
  bankAccount?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;

  // Insurance
  bpjsKesehatan?: string;
  bpjsKetenagakerjaan?: string;

  // Leave
  leaveBalance?: number;

  // Documents
  photoUrl?: string;
  cvUrl?: string;
  contractUrl?: string;
  documents?: {
    name: string;
    url: string;
    type?: string;
    uploadedAt?: string;
  }[];

  createdAt?: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// The API models an employee as a User with either a Teacher or a Staff row
// (`/hr/employees` returns the User with both relations). The HR pages read a
// flat `Employee`, so normalize once here — and derive the two fields the API
// has no column for:
//
//   status       from `user.isActive`
//   employeeType from `employmentStatus` (PNS/GTY…), defaulting to PERMANENT
//
// Without this the roster renders blank cells and a "Total Karyawan 0" count,
// even though the endpoint returns dozens of people.
// ---------------------------------------------------------------------------
const EMPLOYEE_TYPE_BY_EMPLOYMENT_STATUS: Record<string, EmployeeType> = {
  PNS: "PERMANENT",
  PPPK: "CONTRACT",
  GTY: "PERMANENT",
  GTT: "CONTRACT",
  HONOR: "PART_TIME",
  KONTRAK: "CONTRACT",
};

export function normalizeEmployee(raw: any): Employee {
  const teacher = raw?.teacher ?? null;
  const staff = raw?.staff ?? null;
  const profile = staff ?? teacher ?? {};
  const user = raw?.user ?? raw ?? {};

  const employmentStatus =
    profile.employmentStatus ?? teacher?.employmentStatus;

  return {
    ...profile,
    id: raw?.id ?? user.id,
    userId: user.id ?? raw?.userId,
    teacherId: teacher?.id ?? undefined,
    staffId: staff?.id ?? undefined,
    user,
    nip: profile.nip ?? undefined,
    unitId: raw?.unitId ?? user.unitId ?? "",
    unit: raw?.unit ?? user.unit ?? undefined,
    departmentId: profile.departmentId ?? undefined,
    department: staff?.department ?? teacher?.department ?? undefined,

    fullName: user.name ?? raw?.name ?? "",
    email: user.email ?? raw?.email ?? "",
    phone: user.phone ?? undefined,
    gender: profile.gender ?? undefined,
    birthPlace: profile.birthPlace ?? undefined,
    birthDate: profile.birthDate ?? undefined,
    nik: profile.nik ?? undefined,
    address: profile.address ?? undefined,
    religion: profile.religion ?? undefined,
    joinDate: profile.joinDate ?? undefined,

    position: staff?.position ?? (teacher ? "Guru" : "Pegawai"),
    employeeType:
      EMPLOYEE_TYPE_BY_EMPLOYMENT_STATUS[employmentStatus] ?? "PERMANENT",
    status: user.isActive === false ? "INACTIVE" : "ACTIVE",
    role: raw?.role,
    createdAt: raw?.createdAt,
    updatedAt: raw?.updatedAt,
  };
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description?: string;
  headId?: string;
  head?: Employee;
  parentId?: string;
  parent?: Department;
  unitId: string;
  unit?: {
    id: string;
    name: string;
  };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    employees?: number;
  };
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employee?: Employee;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  approvedById?: string;
  approvedBy?: {
    id: string;
    name?: string;
    fullName: string;
  };
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  cancelledAt?: string;
  attachmentUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/** The payload the API's POST /hr/leaves accepts. */
export interface CreateLeavePayload {
  type: LeaveType;
  staffId?: string;
  teacherId?: string;
  startDate: string;
  endDate: string;
  reason: string;
}

export const LEAVE_TYPES: LeaveType[] = [
  "ANNUAL",
  "SICK",
  "MATERNITY",
  "PATERNITY",
  "MARRIAGE",
  "BEREAVEMENT",
  "UNPAID",
  "OTHER",
];
export const LEAVE_STATUSES: LeaveStatus[] = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
];

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  ANNUAL: "Cuti Tahunan",
  SICK: "Sakit",
  MATERNITY: "Melahirkan",
  PATERNITY: "Kelahiran Anak",
  MARRIAGE: "Menikah",
  BEREAVEMENT: "Duka Cita",
  UNPAID: "Tanpa Gaji",
  OTHER: "Lainnya",
};

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  PENDING: "Menunggu",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  CANCELLED: "Dibatalkan",
};

export interface Payroll {
  id: string;
  periodId: string;
  period?: PayrollPeriod;
  staffId: string;
  // The API stores the employee name/NIP/department/position as flat snapshot
  // columns on the Payroll row (`employeeName`, `employeeNo`, `department`,
  // `position`), not as nested `staff.*` fields. The page reads the flat ones;
  // `staff` carries only the live user + unit.
  employeeName?: string;
  employeeNo?: string;
  department?: string;
  position?: string;
  staff?: {
    id: string;
    employeeId?: string;
    fullName?: string;
    nip?: string;
    position?: string;
    unitId?: string;
    unit?: { id: string; name: string };
    user?: { name: string; email: string };
    departmentId?: string;
    bankName?: string;
    bankAccount?: string;
    employeeType?: string;
  };
  // Map to Employee interface for backward compatibility
  employeeId?: string;
  employee?: Employee;
  month: number;
  year: number;

  // Earnings
  basicSalary: number;
  baseSalary: number;
  allowances: { name: string; amount: number; componentId?: string }[];
  totalAllowances: number;
  overtime: number;
  bonus: number;

  // Deductions
  deductions?: { name: string; amount: number; componentId?: string }[];
  taxDeduction: number;
  bpjsHealth: number;
  bpjsEmployment: number;
  otherDeductions: number;

  // Net
  grossSalary: number;
  totalDeductions: number;
  netSalary: number;

  // Items
  items?: PayrollItem[];

  status: PayrollStatus;
  paidAt?: string;
  notes?: string;

  processedById?: string;
  processedAt?: string;
  approvedById?: string;
  approvedAt?: string;

  createdAt: string;
  updatedAt: string;
}

export interface PayrollPeriod {
  id: string;
  unitId?: string;
  unit?: { id: string; name: string };
  name: string;
  month: number;
  year: number;
  startDate: string;
  endDate: string;
  status: PayrollPeriodStatus;
  closedAt?: string;
  closedById?: string;
  createdById?: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    payrolls?: number;
  };
}

export interface PayrollItem {
  id: string;
  payrollId: string;
  componentId: string;
  component?: SalaryComponent;
  name: string;
  type: ComponentType;
  amount: number;
  calculatedAmount: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SalaryComponent {
  id: string;
  unitId?: string;
  unit?: { id: string; name: string };
  code: string;
  name: string;
  description?: string;
  type: ComponentType;
  calculationType: CalculationType;
  defaultAmount?: number;
  percentage?: number;
  formula?: string;
  isTaxable: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface StaffSalary {
  id: string;
  staffId: string;
  staff?: {
    id: string;
    fullName: string;
    nip?: string;
    position?: string;
  };
  baseSalary: number;
  effectiveDate: string;
  notes?: string;
  isActive: boolean;
  components?: StaffSalaryComponent[];
  createdAt: string;
  updatedAt: string;
}

export interface StaffSalaryComponent {
  id: string;
  staffSalaryId: string;
  componentId: string;
  component?: SalaryComponent;
  customAmount?: number;
  customPercentage?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ComponentType = "ALLOWANCE" | "DEDUCTION";
export type CalculationType = "FIXED" | "PERCENTAGE" | "FORMULA";
export type PayrollPeriodStatus = "OPEN" | "PROCESSING" | "CLOSED";
export type PayrollStatus =
  | "DRAFT"
  | "CALCULATED"
  | "APPROVED"
  | "PAID"
  | "CANCELLED"
  | "PENDING"
  | "PROCESSED";

export const PAYROLL_STATUSES: PayrollStatus[] = [
  "DRAFT",
  "CALCULATED",
  "APPROVED",
  "PAID",
  "CANCELLED",
];
export const PAYROLL_PERIOD_STATUSES: PayrollPeriodStatus[] = [
  "OPEN",
  "PROCESSING",
  "CLOSED",
];
export const COMPONENT_TYPES: ComponentType[] = ["ALLOWANCE", "DEDUCTION"];
export const CALCULATION_TYPES: CalculationType[] = [
  "FIXED",
  "PERCENTAGE",
  "FORMULA",
];

export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = {
  DRAFT: "Draft",
  CALCULATED: "Dihitung",
  APPROVED: "Disetujui",
  PAID: "Dibayar",
  CANCELLED: "Dibatalkan",
  PENDING: "Menunggu",
  PROCESSED: "Diproses",
};

export const PAYROLL_PERIOD_STATUS_LABELS: Record<PayrollPeriodStatus, string> =
  {
    OPEN: "Buka",
    PROCESSING: "Diproses",
    CLOSED: "Ditutup",
  };

export const COMPONENT_TYPE_LABELS: Record<ComponentType, string> = {
  ALLOWANCE: "Tunjangan",
  DEDUCTION: "Potongan",
};

export const CALCULATION_TYPE_LABELS: Record<CalculationType, string> = {
  FIXED: "Tetap",
  PERCENTAGE: "Persentase",
  FORMULA: "Formula",
};

// Employee queries
export function useEmployees(params?: {
  unitId?: string;
  departmentId?: string;
  status?: EmployeeStatus;
  type?: EmployeeType;
  search?: string;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["employees", params],
    queryFn: async () => {
      const response = await api.get("/hr/employees", { params });
      const body = response.data as {
        data: unknown[];
        meta: {
          total: number;
          page: number;
          limit: number;
          totalPages: number;
        };
      };
      return { ...body, data: (body.data ?? []).map(normalizeEmployee) };
    },
  });
}

/**
 * Active staff members for pickers (bulk attendance). The API serves the list
 * at GET /hr/staff; the name lives on `user`.
 */
export function useStaffList(params?: { unitId?: string; search?: string }) {
  return useQuery({
    queryKey: ["staff-list", params],
    queryFn: async () => {
      const response = await api.get("/hr/staff", {
        params: { limit: 100, ...params },
      });
      return response.data as {
        data: {
          id: string;
          nip?: string;
          position?: string;
          unitId: string;
          user: { id: string; name: string; email?: string };
          unit?: { id: string; name: string };
        }[];
        meta: {
          total: number;
          page: number;
          limit: number;
          totalPages: number;
        };
      };
    },
  });
}

export function useRetentionRisk(unitId?: string) {
  return useQuery({
    queryKey: ["hr-retention-risk", unitId],
    queryFn: async () => {
      const response = await api.get("/hr/analytics/retention-risk", {
        params: unitId ? { unitId } : undefined,
      });
      return response.data.data as {
        userId: string;
        name: string;
        role: string;
        riskScore: number;
        riskLevel: "LOW" | "MEDIUM" | "HIGH";
        factors: string[];
      }[];
    },
    // Always enable; the backend scopes to the authenticated user's unit
    // when no unitId is provided (non-SUPER_ADMIN). SUPER_ADMIN must pick
    // a unit explicitly via the unitFilter control.
    enabled: true,
  });
}

export function useEmployee(id: string) {
  return useQuery({
    queryKey: ["employee", id],
    queryFn: async () => {
      const response = await api.get(`/hr/employees/${id}`);
      return normalizeEmployee(response.data.data);
    },
    enabled: !!id,
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: FormData) => {
      const response = await api.post("/hr/employees", data, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: FormData | Partial<Employee>;
    }) => {
      const isFormData = data instanceof FormData;
      const response = await api.put(`/hr/employees/${id}`, data, {
        headers: isFormData
          ? { "Content-Type": "multipart/form-data" }
          : undefined,
      });
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee", id] });
    },
  });
}

export function useDeleteEmployee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/hr/employees/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}

// Leave request queries
export function useLeaveRequests(
  params?: {
    /** One employee's leave: the API filters on the Teacher or Staff profile. */
    teacherId?: string;
    staffId?: string;
    status?: LeaveStatus;
    leaveType?: LeaveType;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
    mine?: boolean;
  },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["leave-requests", params],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const response = await api.get("/hr/leaves", { params });
      return response.data as {
        data: LeaveRequest[];
        meta: {
          total: number;
          page: number;
          limit: number;
          totalPages: number;
        };
      };
    },
  });
}

export function useLeaveRequest(id: string) {
  return useQuery({
    queryKey: ["leave-request", id],
    queryFn: async () => {
      const response = await api.get(`/hr/leaves/${id}`);
      return response.data.data as LeaveRequest;
    },
    enabled: !!id,
  });
}

// The API serves leaves at /hr/leaves: create is POST /hr/leaves, a decision is
// PATCH /hr/leaves/{id}/approve, cancellation PATCH /hr/leaves/{id}/cancel.
// These hooks used to post to /hr/leave-requests, which no route answers — the
// apply/approve/reject/cancel buttons all 404'd (baseline of
// web-api-contract.guard.test.ts).
export function useCreateLeaveRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: FormData | CreateLeavePayload) => {
      const isFormData = data instanceof FormData;
      const response = await api.post("/hr/leaves", data, {
        headers: isFormData
          ? { "Content-Type": "multipart/form-data" }
          : undefined,
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
    },
  });
}

export function useApproveLeaveRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.patch(`/hr/leaves/${id}/approve`, {
        status: "APPROVED",
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
    },
  });
}

export function useRejectLeaveRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const response = await api.patch(`/hr/leaves/${id}/approve`, {
        status: "REJECTED",
        rejectedNote: reason,
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
    },
  });
}

export function useCancelLeaveRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.patch(`/hr/leaves/${id}/cancel`);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
    },
  });
}

// Payroll queries - Connected to /api/payroll endpoints
export function usePayrolls(params?: {
  employeeId?: string;
  staffId?: string;
  unitId?: string;
  periodId?: string;
  month?: number;
  year?: number;
  status?: PayrollStatus;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["payrolls", params],
    queryFn: async () => {
      const response = await api.get("/payroll/slips", { params });
      return response.data as {
        data: Payroll[];
        meta: {
          total: number;
          page: number;
          limit: number;
          totalPages: number;
        };
      };
    },
  });
}

export function usePayroll(id: string) {
  return useQuery({
    queryKey: ["payroll", id],
    queryFn: async () => {
      const response = await api.get(`/payroll/slips/${id}`);
      return response.data.data as Payroll;
    },
    enabled: !!id,
  });
}

export function useGeneratePayrollSlips() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      periodId,
      staffIds,
      overwrite,
    }: {
      periodId: string;
      staffIds?: string[];
      overwrite?: boolean;
    }) => {
      const response = await api.post("/payroll/generate", {
        periodId,
        staffIds,
        overwrite,
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
    },
  });
}

export function useUpdatePayroll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Payroll>;
    }) => {
      const response = await api.put(`/payroll/slips/${id}`, data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
    },
  });
}

export function useApprovePayroll() {
  const queryClient = useQueryClient();

  // Assuming approval is done via Period or individual Slip status update
  return useMutation({
    mutationFn: async (id: string) => {
      // Using adjust route or we need a status update route on slips?
      // Check routes: only PUT /slips/:id exists for update, and PUT /slips/:id/adjust
      // Status update is not explicitly exposed for single slip in routes.ts except via update
      // But period approve exists: POST /periods/:id/approve
      const response = await api.put(`/payroll/slips/${id}`, {
        status: "APPROVED",
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
    },
  });
}

export function usePayPayroll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string | string[]) => {
      const idArray = Array.isArray(ids) ? ids : [ids];
      // Update each payroll status to PAID via PUT /slips/:id
      const results = await Promise.all(
        idArray.map((id) =>
          api.put(`/payroll/slips/${id}`, { status: "PAID" }),
        ),
      );
      return results.map((r) => r.data.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
    },
  });
}

export function useProcessPayroll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { periodId: string; staffIds: string[] }) => {
      const response = await api.post(`/payroll/process`, data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payrolls"] });
    },
  });
}

export function useCancelPayroll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string | string[]) => {
      const idArray = Array.isArray(ids) ? ids : [ids];
      const results = await Promise.all(
        idArray.map((id) =>
          api.put(`/payroll/slips/${id}`, { status: "CANCELLED" }),
        ),
      );
      return results.map((r) => r.data.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
    },
  });
}

export function usePayrollSummary(params?: {
  month?: number;
  year?: number;
  unitId?: string;
}) {
  return useQuery({
    queryKey: ["payroll-summary", params],
    queryFn: async () => {
      // Get periods for this month/year and aggregate summary
      const periodParams = {
        month: params?.month,
        year: params?.year,
      };
      const periodsResponse = await api.get("/payroll/periods", {
        params: periodParams,
      });
      const periods = periodsResponse.data.data || [];

      // Aggregate summary from all matching periods
      let totalEmployees = 0;
      let totalGross = 0;
      let totalDeductions = 0;
      let totalNet = 0;

      for (const period of periods) {
        if (period.id) {
          try {
            const summaryResponse = await api.get(
              `/payroll/periods/${period.id}/summary`,
            );
            const summary = summaryResponse.data.data || {};
            totalEmployees += summary.totalStaff || 0;
            totalGross += summary.totalBaseSalary || 0;
            totalDeductions += summary.totalDeductions || 0;
            totalNet += summary.totalNetSalary || 0;
          } catch (e) {
            // Period may not have summary yet
          }
        }
      }

      return {
        totalEmployees,
        employeeCount: totalEmployees,
        totalGross,
        totalGrossSalary: totalGross,
        totalDeductions,
        totalNetSalary: totalNet,
        totalNet,
        byStatus: [] as {
          status: PayrollStatus;
          count: number;
          total: number;
        }[],
        byDepartment: [] as {
          departmentId: string;
          departmentName: string;
          count: number;
          total: number;
        }[],
      };
    },
  });
}

// ============================================
// SALARY COMPONENTS
// ============================================

export function useSalaryComponents(params?: {
  type?: ComponentType;
  isActive?: boolean;
  search?: string;
}) {
  return useQuery({
    queryKey: ["salary-components", params],
    queryFn: async () => {
      const response = await api.get("/payroll/components", { params });
      return response.data.data as SalaryComponent[];
    },
  });
}

export function useSalaryComponent(id: string) {
  return useQuery({
    queryKey: ["salary-component", id],
    queryFn: async () => {
      const response = await api.get(`/payroll/components/${id}`);
      return response.data.data as SalaryComponent;
    },
    enabled: !!id,
  });
}

export function useCreateSalaryComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<SalaryComponent>) => {
      const response = await api.post("/payroll/components", data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-components"] });
    },
  });
}

export function useUpdateSalaryComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<SalaryComponent>;
    }) => {
      const response = await api.put(`/payroll/components/${id}`, data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-components"] });
      queryClient.invalidateQueries({ queryKey: ["salary-component"] });
    },
  });
}

export function useDeleteSalaryComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.delete(`/payroll/components/${id}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-components"] });
    },
  });
}

// ============================================
// STAFF ATTENDANCE
// ============================================

export const STAFF_ATTENDANCE_STATUS_LABELS: Record<
  StaffAttendanceStatus,
  string
> = {
  PRESENT: "Hadir",
  ABSENT: "Alpa",
  LATE: "Terlambat",
  LEAVE: "Izin/Cuti",
  SICK: "Sakit",
  REMOTE: "WFH",
  DUTY: "Dinas Luar",
  HOLIDAY: "Libur",
};

export interface Department {
  id: string;
  unitId: string;
  code: string;
  name: string;
  description?: string;
  managerId?: string;
  isActive: boolean;
  manager?: {
    id: string;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
}

export function useStaffAttendances(params?: {
  staffId?: string;
  teacherId?: string;
  unitId?: string;
  status?: StaffAttendanceStatus;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["staff-attendances", params],
    queryFn: async () => {
      const response = await api.get("/hr/attendance", { params });
      return response.data as {
        data: StaffAttendance[];
        meta: {
          total: number;
          page: number;
          limit: number;
          totalPages: number;
        };
      };
    },
  });
}

export function useCreateStaffAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<StaffAttendance>) => {
      const response = await api.post("/hr/attendance", data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-attendances"] });
    },
  });
}

export function useBulkStaffAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      date: string;
      records: {
        staffId: string;
        status: StaffAttendanceStatus;
        notes?: string;
      }[];
    }) => {
      const response = await api.post("/hr/attendance/bulk", data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-attendances"] });
    },
  });
}

export function useStaffAttendanceSummary(
  staffId: string,
  month: number,
  year: number,
) {
  return useQuery({
    queryKey: ["staff-attendance-summary", staffId, month, year],
    queryFn: async () => {
      const response = await api.get(
        `/hr/staff/${staffId}/attendance/summary`,
        {
          params: { month, year },
        },
      );
      return response.data.data;
    },
    enabled: !!staffId,
  });
}

// ============================================
// PAYROLL PERIODS
// ============================================

export function usePayrollPeriods(params?: {
  unitId?: string;
  status?: PayrollPeriodStatus;
  month?: number;
  year?: number;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["payroll-periods", params],
    queryFn: async () => {
      const response = await api.get("/payroll/periods", { params });
      return response.data as {
        data: PayrollPeriod[];
        meta?: {
          total: number;
          page: number;
          limit: number;
          totalPages: number;
        };
      };
    },
  });
}

export function usePayrollPeriod(id: string) {
  return useQuery({
    queryKey: ["payroll-period", id],
    queryFn: async () => {
      const response = await api.get(`/payroll/periods/${id}`);
      return response.data.data as PayrollPeriod;
    },
    enabled: !!id,
  });
}

export function useCreatePayrollPeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      month: number;
      year: number;
      startDate: string;
      endDate: string;
      unitId?: string;
    }) => {
      const response = await api.post("/payroll/periods", data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
    },
  });
}

export function useUpdatePayrollPeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<PayrollPeriod>;
    }) => {
      const response = await api.put(`/payroll/periods/${id}`, data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-period"] });
    },
  });
}

export function useClosePayrollPeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/payroll/periods/${id}/close`);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payroll-periods"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-period"] });
    },
  });
}

export function usePayrollPeriodSummary(id: string) {
  return useQuery({
    queryKey: ["payroll-period-summary", id],
    queryFn: async () => {
      const response = await api.get(`/payroll/periods/${id}/summary`);
      return response.data.data as {
        period: PayrollPeriod;
        totalStaff: number;
        totalBaseSalary: number;
        totalAllowances: number;
        totalDeductions: number;
        totalNetSalary: number;
        byStatus: { status: PayrollStatus; count: number; total: number }[];
      };
    },
    enabled: !!id,
  });
}

// ============================================
// STAFF SALARY
// ============================================

export function useStaffSalaries(params?: {
  staffId?: string;
  unitId?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["staff-salaries", params],
    queryFn: async () => {
      const response = await api.get("/payroll/staff-salary", { params });
      return response.data as {
        data: StaffSalary[];
        meta?: {
          total: number;
          page: number;
          limit: number;
          totalPages: number;
        };
      };
    },
  });
}

export function useStaffSalary(id: string) {
  return useQuery({
    queryKey: ["staff-salary", id],
    queryFn: async () => {
      const response = await api.get(`/payroll/staff-salary/${id}`);
      return response.data.data as StaffSalary;
    },
    enabled: !!id,
  });
}

export function useStaffSalaryByStaffId(staffId: string) {
  return useQuery({
    queryKey: ["staff-salary-by-staff", staffId],
    queryFn: async () => {
      const response = await api.get(`/payroll/staff-salary`, {
        params: { staffId },
      });
      const salaries = response.data.data as StaffSalary[];
      return salaries.find((s) => s.isActive) || salaries[0];
    },
    enabled: !!staffId,
  });
}

export function useCreateStaffSalary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      staffId: string;
      baseSalary: number;
      effectiveDate: string;
      notes?: string;
    }) => {
      const response = await api.post("/payroll/staff-salary", data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-salaries"] });
    },
  });
}

export function useUpdateStaffSalary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<StaffSalary>;
    }) => {
      const response = await api.put(`/payroll/staff-salary/${id}`, data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-salaries"] });
      queryClient.invalidateQueries({ queryKey: ["staff-salary"] });
    },
  });
}

export function useSetStaffSalaryComponents() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      staffSalaryId,
      components,
    }: {
      staffSalaryId: string;
      components: {
        componentId: string;
        customAmount?: number;
        customPercentage?: number;
      }[];
    }) => {
      const response = await api.post(
        `/payroll/staff-salary/${staffSalaryId}/components`,
        { components },
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff-salaries"] });
      queryClient.invalidateQueries({ queryKey: ["staff-salary"] });
    },
  });
}

// ============================================
// PAYROLL SLIP
// ============================================

export function usePayrollSlip(payrollId: string) {
  return useQuery({
    queryKey: ["payroll-slip", payrollId],
    queryFn: async () => {
      // Assuming GET /slips/:id returns the slip data
      const response = await api.get(`/payroll/slips/${payrollId}`);
      return response.data.data;
    },
    enabled: !!payrollId,
  });
}

export function useRecalculatePayroll() {
  // Not implemented in backend yet, placeholder
  return { mutateAsync: async () => {} };
}

export function useAddPayrollAdjustment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      payrollId,
      data,
    }: {
      payrollId: string;
      data: {
        componentId: string;
        amount: number;
        notes?: string;
      };
    }) => {
      const response = await api.put(
        `/payroll/slips/${payrollId}/adjust`,
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["payroll"] });
    },
  });
}

// ============================================
// SELF ATTENDANCE (clock in / out)
// ============================================

/** GET /hr/attendance/me — the day's row plus what the caller may do next. */
/** The punch body, as `@cipansor/shared` validates it — minus the admin-only staffId. */
export type SelfAttendancePayload = Omit<SelfAttendanceInput, "staffId">;

/**
 * Keep a selfie in the private attendance store and get back the reference a
 * punch names it by. Not `/upload`: that store is readable by every signed-in
 * account, and a selfie is a facial image.
 */
export function useUploadPunchPhoto() {
  return useMutation({
    mutationFn: async (photo: Blob) => {
      const form = new FormData();
      const type = photo.type || "image/jpeg";
      const ext =
        type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
      form.append("file", new File([photo], `absen.${ext}`, { type }));
      const response = await api.post("/hr/attendance/photo", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data.data as { photoRef: string };
    },
  });
}

/**
 * One punch's selfie as a Blob, fetched only when asked for (`enabled`). The
 * API checks the reader and records the read, so a list never loads them all.
 */
export function usePunchPhoto(recordId: string | null) {
  return useQuery({
    queryKey: ["punch-photo", recordId],
    enabled: Boolean(recordId),
    staleTime: Infinity,
    gcTime: 60_000,
    queryFn: async () => {
      const response = await api.get(
        `/hr/attendance/records/${recordId}/photo`,
        {
          responseType: "blob",
        },
      );
      return response.data as Blob;
    },
  });
}

export function useMyAttendanceToday() {
  return useQuery({
    queryKey: ["my-attendance-today"],
    queryFn: async () => {
      const response = await api.get("/hr/attendance/me");
      return response.data.data as MyAttendanceToday;
    },
    // A clock-in is a once-a-day action; refresh so the page agrees with the
    // server after the mutation, without polling the endpoint.
    refetchOnWindowFocus: true,
  });
}

export function useSelfCheckIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: SelfAttendancePayload) => {
      const response = await api.post("/hr/attendance/check-in", data);
      return response.data.data as {
        attendance: MyAttendance;
        lateMinutes: number;
        withinRadius: boolean | null;
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-attendance-today"] });
      queryClient.invalidateQueries({ queryKey: ["staff-attendances"] });
    },
  });
}

export function useSelfCheckOut() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: SelfAttendancePayload) => {
      const response = await api.post("/hr/attendance/check-out", data);
      return response.data.data as {
        attendance: MyAttendance;
        withinRadius: boolean | null;
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-attendance-today"] });
      queryClient.invalidateQueries({ queryKey: ["staff-attendances"] });
    },
  });
}

// ============================================
// ATTENDANCE SETTINGS
// ============================================

/** All settings endpoints take an optional unitId; unit admins are pinned. */
type ScopedParams = { unitId?: string };

export function useAttendanceSites(params?: ScopedParams) {
  return useQuery({
    queryKey: ["attendance-sites", params],
    queryFn: async () => {
      const response = await api.get("/hr/attendance/sites", { params });
      return response.data.data as AttendanceSite[];
    },
  });
}

export function useWorkShifts(params?: ScopedParams) {
  return useQuery({
    queryKey: ["work-shifts", params],
    queryFn: async () => {
      const response = await api.get("/hr/attendance/shifts", { params });
      return response.data.data as WorkShift[];
    },
  });
}

export function useShiftAssignments(
  params?: ScopedParams & { staffId?: string },
) {
  return useQuery({
    queryKey: ["shift-assignments", params],
    queryFn: async () => {
      const response = await api.get("/hr/attendance/shift-assignments", {
        params,
      });
      return response.data.data as ShiftAssignment[];
    },
  });
}

export function useShiftRotations(params?: ScopedParams) {
  return useQuery({
    queryKey: ["shift-rotations", params],
    queryFn: async () => {
      const response = await api.get("/hr/attendance/rotations", { params });
      return response.data.data as ShiftRotation[];
    },
  });
}

export function useWorkWeekConfigs(params?: ScopedParams) {
  return useQuery({
    queryKey: ["work-week-configs", params],
    queryFn: async () => {
      const response = await api.get("/hr/attendance/work-weeks", { params });
      return response.data.data as WorkWeekConfig[];
    },
  });
}

export function useAttendancePolicies(params?: ScopedParams) {
  return useQuery({
    queryKey: ["attendance-policies", params],
    queryFn: async () => {
      const response = await api.get("/hr/attendance/policies", { params });
      return response.data.data as AttendancePolicy[];
    },
  });
}

export function useAttendanceExemptions() {
  return useQuery({
    queryKey: ["attendance-exemptions"],
    queryFn: async () => {
      const response = await api.get("/hr/attendance/exemptions");
      return response.data.data as AttendanceExemption[];
    },
  });
}

export function useRetentionPolicies() {
  return useQuery({
    queryKey: ["retention-policies"],
    queryFn: async () => {
      const response = await api.get("/hr/retention-policies");
      return response.data.data as RetentionPolicy[];
    },
  });
}

export function useUpsertRetentionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<RetentionPolicy>) => {
      const response = await api.put("/hr/retention-policies", data);
      return response.data.data as RetentionPolicy;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["retention-policies"] }),
  });
}

export function useLeaveTypeConfigs() {
  return useQuery({
    queryKey: ["leave-type-configs"],
    queryFn: async () => {
      const response = await api.get("/hr/leave-type-configs");
      return response.data.data as LeaveTypeConfig[];
    },
  });
}

export function useUpsertLeaveTypeConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<LeaveTypeConfig>) => {
      const response = await api.put("/hr/leave-type-configs", data);
      return response.data.data as LeaveTypeConfig;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["leave-type-configs"] }),
  });
}

export function useWorkCalendar(month: number, year: number, unitId?: string) {
  return useQuery({
    queryKey: ["work-calendar", month, year, unitId],
    queryFn: async () => {
      const response = await api.get("/hr/attendance/calendar", {
        params: { month, year, unitId },
      });
      return response.data.data as WorkCalendarDay[];
    },
  });
}

export function useHolidaySyncConfig() {
  return useQuery({
    queryKey: ["holiday-sync-config"],
    queryFn: async () => {
      const response = await api.get("/calendar/holidays/config");
      return response.data.data as HolidaySyncConfig;
    },
  });
}

export function useUpdateHolidaySyncConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<HolidaySyncConfig>) => {
      const response = await api.put("/calendar/holidays/config", data);
      return response.data.data as HolidaySyncConfig;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["holiday-sync-config"] }),
  });
}

export function useSyncHolidays() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { year: number; unitId?: string }) => {
      const response = await api.post("/calendar/holidays/sync", data);
      return response.data.data as HolidaySyncResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holiday-sync-config"] });
      queryClient.invalidateQueries({ queryKey: ["holiday-drafts"] });
      queryClient.invalidateQueries({ queryKey: ["work-calendar"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
    },
  });
}

export function useHolidayDrafts(unitId?: string) {
  return useQuery({
    queryKey: ["holiday-drafts", unitId],
    queryFn: async () => {
      const response = await api.get("/calendar/holidays/drafts", {
        params: { unitId },
      });
      return response.data.data as HolidayDraft[];
    },
  });
}

export function useApproveHolidayDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(
        `/calendar/holidays/drafts/${id}/approve`,
      );
      return response.data.data as HolidayDraft;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holiday-drafts"] });
      queryClient.invalidateQueries({ queryKey: ["work-calendar"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
    },
  });
}

export function useRejectHolidayDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/calendar/holidays/drafts/${id}/reject`);
      return response.data.data as { id: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holiday-drafts"] });
      queryClient.invalidateQueries({ queryKey: ["work-calendar"] });
    },
  });
}

/** The endpoints that upsert by natural key take a PUT with a JSON body. */
export function useUpsertWorkWeekConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<WorkWeekConfig>) => {
      const response = await api.put("/hr/attendance/work-weeks", data);
      return response.data.data as WorkWeekConfig;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["work-week-configs"] }),
  });
}

export function useUpsertAttendancePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<AttendancePolicy>) => {
      const response = await api.put("/hr/attendance/policies", data);
      return response.data.data as AttendancePolicy;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["attendance-policies"] }),
  });
}

export function useCreateAttendanceSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<AttendanceSite>) => {
      const response = await api.post("/hr/attendance/sites", data);
      return response.data.data as AttendanceSite;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["attendance-sites"] }),
  });
}

export function useDeleteAttendanceSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/hr/attendance/sites/${id}`);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["attendance-sites"] }),
  });
}

export function useCreateWorkShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<WorkShift>) => {
      const response = await api.post("/hr/attendance/shifts", data);
      return response.data.data as WorkShift;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["work-shifts"] }),
  });
}

export function useDeleteWorkShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/hr/attendance/shifts/${id}`);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["work-shifts"] }),
  });
}

export function useCreateShiftAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      staffId: string;
      shiftId: string;
      effectiveFrom: string;
      effectiveTo?: string;
      daysOfWeek: number[];
    }) => {
      const response = await api.post("/hr/attendance/shift-assignments", data);
      return response.data.data as ShiftAssignment;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["shift-assignments"] }),
  });
}

export function useDeleteShiftAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/hr/attendance/shift-assignments/${id}`);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["shift-assignments"] }),
  });
}

export function useCreateShiftRotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      shiftId: string;
      name: string;
      memberIds: string[];
      startDate: string;
      endDate?: string;
      cycleDays: number;
    }) => {
      const response = await api.post("/hr/attendance/rotations", data);
      return response.data.data as ShiftRotation;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["shift-rotations"] }),
  });
}

export function useDeleteShiftRotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/hr/attendance/rotations/${id}`);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["shift-rotations"] }),
  });
}

export function useCreateAttendanceExemption() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      staffId?: string;
      roleCode?: string;
      reason?: string;
    }) => {
      const response = await api.post("/hr/attendance/exemptions", data);
      return response.data.data as AttendanceExemption;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["attendance-exemptions"] }),
  });
}

export function useDeleteAttendanceExemption() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/hr/attendance/exemptions/${id}`);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["attendance-exemptions"] }),
  });
}

// ============================================
// PAYROLL POLICY RULES
// ============================================

export interface PayrollPolicyRule {
  id: string;
  unitId?: string | null;
  code: string;
  kind: "EARNING" | "DEDUCTION";
  trigger: "LATE" | "ABSENT" | "EARLY_LEAVE" | "PRESENT" | "OVERTIME";
  basis: string;
  mode:
    | "NOMINAL"
    | "PERSENTASE"
    | "PRORATA"
    | "PENGALI"
    | "BERTINGKAT"
    | "FORMULA"
    | "MANUAL";
  rate?: number | null;
  unit: "PER_MENIT" | "PER_HARI" | "PER_KEJADIAN" | "PER_BULAN";
  tiersJson?: unknown;
  formulaExpr?: string | null;
  capPerDay?: number | null;
  capPerMonth?: number | null;
  rounding: "NONE" | "ROUND" | "FLOOR" | "CEIL";
  priority: number;
  legalBasisDoc?: string | null;
  isActive: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

export interface PayrollGuardConfig {
  id: string;
  unitId?: string | null;
  maxDeductionPercent: number;
  minBasicSharePercent: number;
  mustStayAboveUmk: boolean;
  umkNominal?: number | null;
  isActive: boolean;
}

export function usePayrollPolicyRules(params?: ScopedParams) {
  return useQuery({
    queryKey: ["payroll-policy-rules", params],
    queryFn: async () => {
      const response = await api.get("/hr/payroll/policy-rules", { params });
      return response.data.data as PayrollPolicyRule[];
    },
  });
}

export function useUpsertPayrollPolicyRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<PayrollPolicyRule> & { id?: string }) => {
      const { id, ...body } = data;
      const response = await api.put(
        `/hr/payroll/policy-rules/${id ?? "new"}`,
        body,
      );
      return response.data.data as PayrollPolicyRule;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["payroll-policy-rules"] }),
  });
}

export function useDeletePayrollPolicyRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/hr/payroll/policy-rules/${id}`);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["payroll-policy-rules"] }),
  });
}

export function usePayrollGuardConfig(params?: ScopedParams) {
  return useQuery({
    queryKey: ["payroll-guard-config", params],
    queryFn: async () => {
      const response = await api.get("/hr/payroll/guard-config", { params });
      return response.data.data as PayrollGuardConfig | null;
    },
  });
}

export function useUpsertPayrollGuardConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<PayrollGuardConfig>) => {
      const response = await api.put("/hr/payroll/guard-config", data);
      return response.data.data as PayrollGuardConfig;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["payroll-guard-config"] }),
  });
}

/** Dry run: what the rules would deduct from each slip in a period. */
export function useAttendanceDeductionPreview(periodId: string) {
  return useQuery({
    queryKey: ["attendance-deduction-preview", periodId],
    queryFn: async () => {
      const response = await api.get(
        `/payroll/periods/${periodId}/attendance-deductions`,
      );
      return response.data.data as {
        staffId: string;
        staffName: string;
        totalDeductions: number;
        totalEarningAdditions: number;
        gross: number;
        guardWarnings: string[];
        lines: {
          code: string;
          name: string;
          kind: "EARNING" | "DEDUCTION";
          amount: number;
          detail: string;
        }[];
      }[];
    },
    enabled: !!periodId,
  });
}
