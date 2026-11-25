"use client";

import { useState, useEffect, useMemo } from "react";
import { safeFormat } from "@/lib/date";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  Search,
  Calculator,
  FileText,
  BookOpen,
  RefreshCw,
  Filter,
  Banknote,
  TrendingUp,
  TrendingDown,
  Download,
  Wallet,
  PieChart,
  Settings,
  Save,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as localeID } from "date-fns/locale";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/api-error";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  useAccountCodes,
  useCreateAccountCode,
  useJournalEntries,
  useCreateJournalEntry,
  useTrialBalanceReport,
  useIncomeExpenseReport,
  type AccountCode,
  type JournalEntry,
  AccountType,
  FinanceReportPeriod,
} from "@/hooks/use-finance-enhancement";
import { useUnits } from "@/hooks/use-units";
import {
  buildAccountTree,
  flattenAccountTree,
  type AccountCode as TreeAccountCode,
} from "@/lib/finance-utils";

// Account type labels and colors
const ACCOUNT_TYPES: { value: AccountType; label: string; color: string }[] = [
  { value: AccountType.ASSET, label: "Aset", color: "bg-blue-500" },
  { value: AccountType.LIABILITY, label: "Kewajiban", color: "bg-red-500" },
  { value: AccountType.EQUITY, label: "Modal", color: "bg-purple-500" },
  { value: AccountType.REVENUE, label: "Pendapatan", color: "bg-green-500" },
  { value: AccountType.EXPENSE, label: "Beban", color: "bg-orange-500" },
];

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// Account Codes Tab
function AccountCodesTab() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<AccountType | "ALL">("ALL");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const {
    data: accountCodesData,
    isLoading,
    refetch,
  } = useAccountCodes({
    type: typeFilter === "ALL" ? undefined : typeFilter,
    search: search || undefined,
    limit: 100,
  });

  const flattenedData = useMemo(() => {
    if (!accountCodesData?.data) return [];
    // If searching or filtering by type, don't build tree (show flat results)
    if (search || typeFilter !== "ALL") {
      return accountCodesData.data;
    }
    const tree = buildAccountTree(accountCodesData.data as any[]);
    return flattenAccountTree(tree);
  }, [accountCodesData, search, typeFilter]);

  const createAccountCode = useCreateAccountCode();

  const handleCreateAccountCode = async (formData: FormData) => {
    try {
      await createAccountCode.mutateAsync({
        code: formData.get("code") as string,
        name: formData.get("name") as string,
        type: formData.get("type") as unknown as AccountType,
        parentId: (formData.get("parentId") as string) || undefined,
        isActive: true,
      });
      toast.success("Kode akun berhasil ditambahkan");
      setIsAddDialogOpen(false);
      refetch();
    } catch (error: any) {
      toast.error(
        error.response?.data?.message || "Gagal menambahkan kode akun",
      );
    }
  };

  const getAccountTypeBadge = (type: AccountType) => {
    const accountType = ACCOUNT_TYPES.find((t) => t.value === type);
    return (
      <Badge
        variant="outline"
        className={`${accountType?.color} text-white border-0`}
      >
        {accountType?.label || type}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari kode atau nama akun..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as AccountType | "ALL")}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter tipe" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Semua Tipe</SelectItem>
            {ACCOUNT_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Tambah Kode Akun
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form action={handleCreateAccountCode}>
              <DialogHeader>
                <DialogTitle>Tambah Kode Akun Baru</DialogTitle>
                <DialogDescription>
                  Masukkan detail kode akun sesuai standar Chart of Accounts
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="code">Kode Akun</Label>
                    <Input
                      id="code"
                      name="code"
                      placeholder="1-10001"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="type">Tipe Akun</Label>
                    <Select name="type" required>
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih tipe" />
                      </SelectTrigger>
                      <SelectContent>
                        {ACCOUNT_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Nama Akun</Label>
                  <Input id="name" name="name" placeholder="Kas" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="parentId">Akun Induk (Opsional)</Label>
                  <Select name="parentId">
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih akun induk" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Tidak ada</SelectItem>
                      {accountCodesData?.data.map((acc) => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.code} - {acc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddDialogOpen(false)}
                >
                  Batal
                </Button>
                <Button type="submit" disabled={createAccountCode.isPending}>
                  {createAccountCode.isPending ? "Menyimpan..." : "Simpan"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Nama Akun</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Akun Induk</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
                    Memuat data...
                  </TableCell>
                </TableRow>
              ) : flattenedData.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Belum ada kode akun
                  </TableCell>
                </TableRow>
              ) : (
                flattenedData.map((account: any) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-mono font-medium">
                      <span
                        style={{
                          paddingLeft: `${(account.level || 0) * 20}px`,
                        }}
                      >
                        {account.code}
                      </span>
                    </TableCell>
                    <TableCell>{account.name}</TableCell>
                    <TableCell>
                      {getAccountTypeBadge(account.type as AccountType)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {account.parent
                        ? `${account.parent.code} - ${account.parent.name}`
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={account.isActive ? "default" : "secondary"}
                      >
                        {account.isActive ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// Journal Entries Tab
function JournalEntriesTab() {
  const [search, setSearch] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState<string | undefined>();

  const { data: unitsData } = useUnits();
  const { data: accountCodesData } = useAccountCodes({
    isActive: true,
    limit: 100,
  });
  const {
    data: entriesData,
    isLoading,
    refetch,
  } = useJournalEntries({
    unitId: selectedUnitId,
    search: search || undefined,
    limit: 50,
  });

  const createJournalEntry = useCreateJournalEntry();

  const handleCreateEntry = async (formData: FormData) => {
    try {
      const debit = parseFloat(formData.get("debit") as string) || 0;
      const credit = parseFloat(formData.get("credit") as string) || 0;

      if (debit === 0 && credit === 0) {
        toast.error("Debit atau kredit harus diisi");
        return;
      }

      await createJournalEntry.mutateAsync({
        unitId: (formData.get("unitId") as string) || undefined,
        accountId: formData.get("accountId") as string,
        date: formData.get("date") as string,
        description: formData.get("description") as string,
        debit,
        credit,
        reference: (formData.get("reference") as string) || undefined,
        referenceType: (formData.get("referenceType") as string) || undefined,
      });
      toast.success("Jurnal berhasil dicatat");
      setIsAddDialogOpen(false);
      refetch();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Gagal mencatat jurnal");
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari deskripsi jurnal..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select
          value={selectedUnitId || "ALL"}
          onValueChange={(v) => setSelectedUnitId(v === "ALL" ? undefined : v)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter unit" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Semua Unit</SelectItem>
            {unitsData?.map((unit: any) => (
              <SelectItem key={unit.id} value={unit.id}>
                {unit.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Tambah Jurnal
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <form action={handleCreateEntry}>
              <DialogHeader>
                <DialogTitle>Tambah Entri Jurnal</DialogTitle>
                <DialogDescription>
                  Catat transaksi keuangan ke buku jurnal
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="date">Tanggal</Label>
                    <Input
                      id="date"
                      name="date"
                      type="date"
                      defaultValue={safeFormat(new Date(), "yyyy-MM-dd")}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="unitId">Unit</Label>
                    <Select name="unitId">
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih unit" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Tidak ada</SelectItem>
                        {unitsData?.map((unit: any) => (
                          <SelectItem key={unit.id} value={unit.id}>
                            {unit.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="accountId">Kode Akun</Label>
                  <Select name="accountId" required>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih akun" />
                    </SelectTrigger>
                    <SelectContent>
                      {accountCodesData?.data.map((acc) => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.code} - {acc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Deskripsi</Label>
                  <Textarea
                    id="description"
                    name="description"
                    placeholder="Deskripsi transaksi..."
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="debit">Debit (Rp)</Label>
                    <Input
                      id="debit"
                      name="debit"
                      type="number"
                      min="0"
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="credit">Kredit (Rp)</Label>
                    <Input
                      id="credit"
                      name="credit"
                      type="number"
                      min="0"
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="reference">No. Referensi</Label>
                    <Input
                      id="reference"
                      name="reference"
                      placeholder="INV-001"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="referenceType">Tipe Referensi</Label>
                    <Select name="referenceType">
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih tipe" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Tidak ada</SelectItem>
                        <SelectItem value="INVOICE">Invoice</SelectItem>
                        <SelectItem value="PAYMENT">Pembayaran</SelectItem>
                        <SelectItem value="EXPENSE">Pengeluaran</SelectItem>
                        <SelectItem value="TRANSFER">Transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddDialogOpen(false)}
                >
                  Batal
                </Button>
                <Button type="submit" disabled={createJournalEntry.isPending}>
                  {createJournalEntry.isPending ? "Menyimpan..." : "Simpan"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Akun</TableHead>
                <TableHead>Deskripsi</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Kredit</TableHead>
                <TableHead>Referensi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
                    Memuat data...
                  </TableCell>
                </TableRow>
              ) : entriesData?.data.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Belum ada entri jurnal
                  </TableCell>
                </TableRow>
              ) : (
                entriesData?.data.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      {safeFormat(new Date(entry.date), "dd MMM yyyy", {
                        locale: localeID,
                      })}
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-sm">
                        {entry.account?.code}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {entry.account?.name}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {entry.description}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {entry.debit > 0 ? formatCurrency(entry.debit) : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {entry.credit > 0 ? formatCurrency(entry.credit) : "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {entry.reference || "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// Reports Tab
function ReportsTab() {
  const currentDate = new Date();
  const [startDate, setStartDate] = useState(
    safeFormat(new Date(currentDate.getFullYear(), 0, 1), "yyyy-MM-dd"),
  );
  const [endDate, setEndDate] = useState(format(currentDate, "yyyy-MM-dd"));

  const { data: trialBalance, isLoading: trialBalanceLoading } =
    useTrialBalanceReport({
      startDate,
      endDate,
    });

  const { data: incomeExpense, isLoading: incomeExpenseLoading } =
    useIncomeExpenseReport({
      startDate,
      endDate,
      groupBy: FinanceReportPeriod.MONTH,
    });

  return (
    <div className="space-y-6">
      {/* Date Range Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-2">
              <Label>Tanggal Mulai</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Tanggal Akhir</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Income/Expense Summary */}
      {incomeExpense && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Pendapatan
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center">
                <TrendingUp className="h-5 w-5 text-green-500 mr-2" />
                <span className="text-2xl font-bold text-green-600">
                  {formatCurrency(incomeExpense.summary.totalIncome)}
                </span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Beban
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center">
                <TrendingDown className="h-5 w-5 text-red-500 mr-2" />
                <span className="text-2xl font-bold text-red-600">
                  {formatCurrency(incomeExpense.summary.totalExpense)}
                </span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Laba Bersih
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center">
                <Banknote className="h-5 w-5 text-primary mr-2" />
                <span
                  className={`text-2xl font-bold ${incomeExpense.summary.netIncome >= 0 ? "text-green-600" : "text-red-600"}`}
                >
                  {formatCurrency(incomeExpense.summary.netIncome)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Trial Balance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Neraca Saldo (Trial Balance)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {trialBalanceLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin mr-2" />
              Memuat data...
            </div>
          ) : trialBalance ? (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kode Akun</TableHead>
                    <TableHead>Nama Akun</TableHead>
                    <TableHead>Tipe</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Kredit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trialBalance.accounts.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Belum ada data transaksi dalam periode ini
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {trialBalance.accounts.map((account, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-mono">
                            {account.code}
                          </TableCell>
                          <TableCell>{account.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {ACCOUNT_TYPES.find(
                                (t) => t.value === account.type,
                              )?.label || account.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {account.debit > 0
                              ? formatCurrency(account.debit)
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {account.credit > 0
                              ? formatCurrency(account.credit)
                              : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell colSpan={3}>TOTAL</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(trialBalance.totals.debit)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(trialBalance.totals.credit)}
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
              <div className="flex items-center justify-end gap-2">
                <Badge
                  variant={trialBalance.isBalanced ? "default" : "destructive"}
                >
                  {trialBalance.isBalanced ? "Seimbang ✓" : "Tidak Seimbang ✗"}
                </Badge>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Pilih periode untuk melihat neraca saldo
            </div>
          )}
        </CardContent>
      </Card>

      {/* Income/Expense Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Pendapatan vs Beban per Bulan
          </CardTitle>
        </CardHeader>
        <CardContent>
          {incomeExpenseLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin mr-2" />
              Memuat data...
            </div>
          ) : incomeExpense ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Periode</TableHead>
                  <TableHead className="text-right">Pendapatan</TableHead>
                  <TableHead className="text-right">Beban</TableHead>
                  <TableHead className="text-right">Selisih</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incomeExpense.breakdown.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center py-8 text-muted-foreground"
                    >
                      Belum ada data dalam periode ini
                    </TableCell>
                  </TableRow>
                ) : (
                  incomeExpense.breakdown.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">
                        {item.period}
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-600">
                        {formatCurrency(item.income)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-red-600">
                        {formatCurrency(item.expense)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono font-bold ${item.net >= 0 ? "text-green-600" : "text-red-600"}`}
                      >
                        {formatCurrency(item.net)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Pilih periode untuk melihat laporan
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Accounting Settings Tab
function AccountingSettingsTab() {
  const { data: units } = useUnits();
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");
  const [settings, setSettings] = useState<Record<string, string | null>>({});

  // Fetch settings when unit selected
  const { data: fetchedSettings } = useQuery({
    queryKey: ["accounting-settings", selectedUnitId],
    queryFn: async () => {
      if (!selectedUnitId) return {};
      const res = await api.get("/finance/accounting/settings", {
        params: { unitId: selectedUnitId },
      });
      return res.data.data;
    },
    enabled: !!selectedUnitId,
  });

  // Sync settings when fetched data changes
  useEffect(() => {
    if (fetchedSettings) {
      setSettings(fetchedSettings);
    }
  }, [fetchedSettings]);

  const { data: accounts } = useAccountCodes({
    isActive: true,
    limit: 500, // Fetch all for selection
  });

  const updateMutation = useMutation({
    mutationFn: async (newSettings: Record<string, string | null>) => {
      await api.post("/finance/accounting/settings", {
        unitId: selectedUnitId,
        settings: newSettings,
      });
    },
    onSuccess: () => {
      toast.success("Pengaturan berhasil disimpan");
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  const handleSave = () => {
    if (!selectedUnitId) return;
    updateMutation.mutate(settings);
  };

  const MAPPINGS = [
    {
      key: "ACCOUNT_MAPPING_CASH",
      label: "Akun Kas Tunai",
      description: "Akun default untuk penerimaan tunai (Kas)",
    },
    {
      key: "ACCOUNT_MAPPING_BANK",
      label: "Akun Bank/Transfer",
      description: "Akun default untuk penerimaan transfer (Bank)",
    },
    {
      key: "ACCOUNT_MAPPING_PAYROLL_EXPENSE",
      label: "Beban Gaji",
      description: "Akun beban untuk pencatatan gaji karyawan",
    },
    {
      key: "ACCOUNT_MAPPING_TAX_PAYABLE",
      label: "Utang PPh 21",
      description: "Akun kewajiban untuk mencatat PPh 21 gaji karyawan",
    },
    {
      key: "ACCOUNT_MAPPING_INVENTORY_ASSET",
      label: "Aset Inventaris",
      description: "Akun aset untuk pembelian inventaris baru",
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Pengaturan Integrasi Akuntansi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Pilih Unit</Label>
            <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
              <SelectTrigger aria-label="Pilih Unit">
                <SelectValue placeholder="Pilih Unit Sekolah/Pesantren" />
              </SelectTrigger>
              <SelectContent>
                {units?.map((unit: any) => (
                  <SelectItem key={unit.id} value={unit.id}>
                    {unit.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedUnitId ? (
            <div className="space-y-4">
              {fetchedSettings !== undefined &&
                !settings["ACCOUNT_MAPPING_TAX_PAYABLE"] && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      Pemetaan Utang PPh 21 belum diisi. Pembayaran gaji dengan
                      potongan PPh 21 akan ditolak sampai akun ini dipilih.
                    </p>
                  </div>
                )}
              {MAPPINGS.map((mapping) => (
                <div key={mapping.key} className="space-y-2">
                  <Label>{mapping.label}</Label>
                  <p className="text-sm text-muted-foreground mb-2">
                    {mapping.description}
                  </p>
                  <Select
                    value={settings[mapping.key] || ""}
                    onValueChange={(val) =>
                      setSettings((prev) => ({ ...prev, [mapping.key]: val }))
                    }
                  >
                    <SelectTrigger aria-label={mapping.label}>
                      <SelectValue placeholder="Pilih Akun" />
                    </SelectTrigger>
                    <SelectContent>
                      {(accounts?.data ?? [])
                        .filter(
                          (acc) =>
                            mapping.key !== "ACCOUNT_MAPPING_TAX_PAYABLE" ||
                            (acc.type === "LIABILITY" &&
                              (acc.unitId === selectedUnitId ||
                                acc.unitId == null)),
                        )
                        .map((acc) => (
                          <SelectItem key={acc.id} value={acc.id}>
                            {acc.code} - {acc.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}

              <div className="pt-4">
                <Button
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {updateMutation.isPending
                    ? "Menyimpan..."
                    : "Simpan Pengaturan"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground border rounded-md bg-muted/20">
              Silakan pilih unit terlebih dahulu untuk mengatur pemetaan akun.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Main Page
export default function AccountingPage() {
  const [activeTab, setActiveTab] = useState("account-codes");

  return (
    <MainLayout>
      <div className="space-y-6">
        <PageHeader
          title="Akuntansi"
          description="Kelola chart of accounts, jurnal umum, dan laporan keuangan"
        />

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Kode Akun</CardTitle>
              <BookOpen className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">-</div>
              <p className="text-xs text-muted-foreground">
                Total akun terdaftar
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                Jurnal Bulan Ini
              </CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">-</div>
              <p className="text-xs text-muted-foreground">
                Total entri jurnal
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Debit</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">-</div>
              <p className="text-xs text-muted-foreground">Bulan ini</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                Total Kredit
              </CardTitle>
              <TrendingDown className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">-</div>
              <p className="text-xs text-muted-foreground">Bulan ini</p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Links for New Features */}
        <div className="flex gap-4">
          <Link href="/finance/budgeting">
            <Button variant="outline" className="flex gap-2">
              <Wallet className="h-4 w-4" />
              Kelola Anggaran
            </Button>
          </Link>
          <Link href="/finance/reports">
            <Button variant="outline" className="flex gap-2">
              <PieChart className="h-4 w-4" />
              Laporan Detail (Neraca/Laba Rugi)
            </Button>
          </Link>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger
              value="account-codes"
              className="flex items-center gap-2"
            >
              <BookOpen className="h-4 w-4" />
              Kode Akun
            </TabsTrigger>
            <TabsTrigger
              value="journal-entries"
              className="flex items-center gap-2"
            >
              <FileText className="h-4 w-4" />
              Jurnal Umum
            </TabsTrigger>
            <TabsTrigger value="reports" className="flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Ringkasan Laporan
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Pengaturan
            </TabsTrigger>
          </TabsList>

          <TabsContent value="account-codes" className="mt-6">
            <AccountCodesTab />
          </TabsContent>

          <TabsContent value="journal-entries" className="mt-6">
            <JournalEntriesTab />
          </TabsContent>

          <TabsContent value="reports" className="mt-6">
            <ReportsTab />
          </TabsContent>

          <TabsContent value="settings" className="mt-6">
            <AccountingSettingsTab />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
