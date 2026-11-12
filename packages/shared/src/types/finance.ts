import { Unit } from "./models";

// Enums
export enum AccountType {
  ASSET = "ASSET",
  LIABILITY = "LIABILITY",
  EQUITY = "EQUITY",
  REVENUE = "REVENUE",
  EXPENSE = "EXPENSE",
}

export enum CashFlowCategory {
  OPERATING = "OPERATING",
  INVESTING = "INVESTING",
  FINANCING = "FINANCING",
}

export enum JournalReferenceType {
  MANUAL = "MANUAL",
  INVOICE = "INVOICE",
  PAYMENT = "PAYMENT",
  SCHOLARSHIP = "SCHOLARSHIP",
  PAYROLL = "PAYROLL",
  CANTEEN = "CANTEEN",
  LAUNDRY = "LAUNDRY",
  OTHER = "OTHER",
}

export enum ScholarshipType {
  FULL = "FULL",
  PARTIAL = "PARTIAL",
  FIXED_AMOUNT = "FIXED_AMOUNT",
  SPECIFIC = "SPECIFIC",
}

export enum ScholarshipSource {
  INTERNAL = "INTERNAL",
  GOVERNMENT = "GOVERNMENT",
  FOUNDATION = "FOUNDATION",
  DONOR = "DONOR",
  COMPANY = "COMPANY",
  OTHER = "OTHER",
}

export enum ScholarshipStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
  EXPIRED = "EXPIRED",
  REVOKED = "REVOKED",
}

export enum PaymentCategory {
  SPP = "SPP",
  REGISTRATION = "REGISTRATION",
  BUILDING = "BUILDING",
  UNIFORM = "UNIFORM",
  BOOK = "BOOK",
  ACTIVITY = "ACTIVITY",
  EXAM = "EXAM",
  OTHER = "OTHER",
}

export enum FinanceReportPeriod {
  DAY = "day",
  MONTH = "month",
  YEAR = "year",
}

// Interfaces

export interface AccountCode {
  id: string;
  code: string;
  name: string;
  type: AccountType | string;
  // Owning unit, or null for a shared/legacy row any unit may use.
  unitId?: string | null;
  parentId?: string | null;
  isActive: boolean;
  normalBalance?: "DEBIT" | "CREDIT";
  cashFlowCategory?: CashFlowCategory | string | null;
  createdAt?: Date;
  updatedAt?: Date;
  parent?: AccountCode;
  children?: AccountCode[];
}

export interface Budget {
  id: string;
  unitId: string;
  academicYearId: string;
  accountId: string;
  amount: number;
  usedAmount: number;
  periodType: "YEARLY" | "MONTHLY";
  notes?: string | null;
  createdById: string;
  createdAt?: Date;
  updatedAt?: Date;

  unit?: Unit;
  academicYear?: { id: string; name: string };
  account?: AccountCode;
  createdBy?: { id: string; name: string };
}

export interface FinancialPeriod {
  id: string;
  unitId: string;
  name: string;
  startDate: Date | string;
  endDate: Date | string;
  isClosed: boolean;
  closedAt?: Date | string | null;
  closedById?: string | null;
  notes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;

  unit?: Unit;
  closedBy?: { id: string; name: string };
}

export interface JournalEntry {
  id: string;
  unitId: string;
  accountId: string;
  date: Date | string;
  description?: string | null;
  debit: number;
  credit: number;
  reference?: string | null;
  referenceType?: JournalReferenceType | string | null;
  createdById: string;
  createdAt?: Date;
  updatedAt?: Date;

  unit?: Unit;
  account?: AccountCode;
  createdBy?: { id: string; name: string };
}

export interface Scholarship {
  id: string;
  name: string;
  description?: string | null;
  source: ScholarshipSource | string;
  type: ScholarshipType | string;
  quota?: number | null;
  requirements?: string | null;
  startDate: Date | string;
  endDate?: Date | string | null;
  unitId: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;

  unit?: Unit;
  _count?: {
    recipients: number;
    discounts: number;
  };
}

export interface ScholarshipRecipient {
  id: string;
  scholarshipId: string;
  studentId: string;
  academicYearId: string;
  startDate: Date | string;
  endDate?: Date | string | null;
  notes?: string | null;
  status: ScholarshipStatus | string;
  createdAt?: Date;
  updatedAt?: Date;

  scholarship?: Scholarship;
  student?: any;
  academicYear?: { id: string; name: string };
}

export interface PaymentComponent {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  category: PaymentCategory | string;
  amount: number;
  unitId: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;

  unit?: Unit;
}

// DTOs

export interface CreateAccountCodeInput {
  code: string;
  name: string;
  type: AccountType;
  parentId?: string;
  isActive?: boolean;
  cashFlowCategory?: CashFlowCategory;
}

export type UpdateAccountCodeInput = Partial<CreateAccountCodeInput>;

export interface CreateJournalEntryInput {
  unitId: string;
  accountId: string;
  date: Date | string;
  description?: string;
  debit?: number;
  credit?: number;
  reference?: string;
  referenceType?: JournalReferenceType;
}

export interface CreateScholarshipInput {
  name: string;
  description?: string;
  source: ScholarshipSource;
  type: ScholarshipType;
  quota?: number;
  requirements?: string;
  startDate: Date | string;
  endDate?: Date | string;
  unitId: string;
  isActive?: boolean;
}

export interface AssignScholarshipInput {
  scholarshipId: string;
  studentId: string;
  academicYearId: string;
  startDate: Date | string;
  endDate?: Date | string;
  notes?: string;
}

export interface CreatePaymentComponentInput {
  code: string;
  name: string;
  description?: string;
  category: PaymentCategory;
  amount: number;
  unitId: string;
  isActive?: boolean;
}

export interface CreateBudgetInput {
  unitId: string;
  academicYearId: string;
  accountId: string;
  amount: number;
  periodType?: "YEARLY" | "MONTHLY";
  notes?: string;
}

export type UpdateBudgetInput = Partial<CreateBudgetInput>;

export interface CreateFinancialPeriodInput {
  unitId: string;
  name: string;
  startDate: Date | string;
  endDate: Date | string;
  notes?: string;
}

// Report Types

// Trial Balance
export interface TrialBalanceItem {
  accountId: string;
  code: string;
  name: string;
  type: string;
  startBalance: number; // Saldo Awal
  debit: number; // Mutasi Debit
  credit: number; // Mutasi Credit
  endBalance: number; // Saldo Akhir
}

export interface TrialBalanceReport {
  period: { startDate: string; endDate: string };
  accounts: TrialBalanceItem[];
  totals: {
    startBalance: number;
    debit: number;
    credit: number;
    endBalance: number;
  };
  isBalanced: boolean;
}

// General Ledger (Buku Besar)
export interface GeneralLedgerEntry {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  debit: number;
  credit: number;
  balance: number; // Running balance
}

export interface GeneralLedgerAccount {
  accountId: string;
  code: string;
  name: string;
  startBalance: number;
  entries: GeneralLedgerEntry[];
  endBalance: number;
}

export interface GeneralLedgerReport {
  period: { startDate: string; endDate: string };
  accounts: GeneralLedgerAccount[];
}

// Income Statement (Laba Rugi)
export interface IncomeExpenseItem {
  period: string;
  income: number;
  expense: number;
  net: number;
  accountName?: string;
  accountCode?: string;
}

export interface IncomeExpenseReport {
  period: { startDate: string; endDate: string };
  summary: {
    totalIncome: number;
    totalExpense: number;
    netIncome: number;
  };
  breakdown: IncomeExpenseItem[];
}

// Balance Sheet (Neraca)
export interface BalanceSheetItem {
  code: string;
  name: string;
  amount: number;
  level: number;
  children?: BalanceSheetItem[];
}

export interface BalanceSheetSection {
  title: string;
  total: number;
  items: BalanceSheetItem[];
}

export interface BalanceSheetReport {
  assets: BalanceSheetSection;
  liabilities: BalanceSheetSection;
  equity: BalanceSheetSection;
  periodDate: string;
}

// Cash Flow (Arus Kas)
export interface CashFlowItem {
  name: string;
  amount: number;
}

export interface CashFlowSection {
  title: string;
  total: number;
  items: CashFlowItem[];
}

export interface CashFlowReport {
  period: { startDate: string; endDate: string };
  operatingActivities: CashFlowSection;
  investingActivities: CashFlowSection;
  financingActivities: CashFlowSection;
  netChangeInCash: number;
  beginningCashBalance: number;
  endingCashBalance: number;
}
