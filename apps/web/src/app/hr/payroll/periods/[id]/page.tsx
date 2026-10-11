"use client";

import { use, useState } from "react";
import { safeFormat } from "@/lib/date";
import { useRouter } from "next/navigation";
import { MainLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  usePayrollPeriod,
  usePayrollPeriodSummary,
  usePayrolls,
  useClosePayrollPeriod,
  useProcessPayroll,
  usePayPayroll,
  type Payroll,
  type PayrollStatus,
  type PayrollPeriodStatus,
  PAYROLL_STATUS_LABELS,
  PAYROLL_PERIOD_STATUS_LABELS,
} from "@/hooks";
import {
  ArrowLeft,
  Search,
  Loader2,
  Eye,
  Download,
  Send,
  CheckCircle,
  Clock,
  Lock,
  Banknote,
  Users,
  TrendingUp,
  AlertCircle,
  Calculator,
  FileText,
} from "lucide-react";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import { toast } from "sonner";

interface PageProps {
  params: Promise<{ id: string }>;
}

const months = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export default function PayrollPeriodDetailPage({ params }: PageProps) {
  const { id: periodId } = use(params);
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PayrollStatus | "ALL">(
    "ALL",
  );
  const [isCloseOpen, setIsCloseOpen] = useState(false);
  const [selectedPayrolls, setSelectedPayrolls] = useState<string[]>([]);
  const [selectedSlip, setSelectedSlip] = useState<Payroll | null>(null);

  const { data: period, isLoading: periodLoading } = usePayrollPeriod(periodId);
  const { data: summary, isLoading: summaryLoading } =
    usePayrollPeriodSummary(periodId);
  const { data: payrollsData, isLoading: payrollsLoading } = usePayrolls({
    periodId,
    status: statusFilter !== "ALL" ? statusFilter : undefined,
  });
  const closePeriod = useClosePayrollPeriod();
  const processPayroll = useProcessPayroll();
  const payPayroll = usePayPayroll();

  const payrolls = payrollsData?.data || [];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusBadge = (status: PayrollStatus) => {
    const colors: Record<PayrollStatus, string> = {
      DRAFT: "bg-gray-100 text-gray-800",
      CALCULATED: "bg-blue-100 text-blue-800",
      APPROVED: "bg-indigo-100 text-indigo-800",
      PENDING: "bg-yellow-100 text-yellow-800",
      PROCESSED: "bg-blue-100 text-blue-800",
      PAID: "bg-green-100 text-green-800",
      CANCELLED: "bg-red-100 text-red-800",
    };
    return (
      <Badge className={colors[status]}>{PAYROLL_STATUS_LABELS[status]}</Badge>
    );
  };

  const getPeriodStatusBadge = (status: PayrollPeriodStatus) => {
    const colors: Record<PayrollPeriodStatus, string> = {
      OPEN: "bg-green-100 text-green-800",
      PROCESSING: "bg-yellow-100 text-yellow-800",
      CLOSED: "bg-gray-100 text-gray-800",
    };
    const icons: Record<PayrollPeriodStatus, React.ReactNode> = {
      OPEN: <Clock className="h-3 w-3 mr-1" />,
      PROCESSING: <AlertCircle className="h-3 w-3 mr-1" />,
      CLOSED: <Lock className="h-3 w-3 mr-1" />,
    };
    return (
      <Badge className={`${colors[status]} flex items-center`}>
        {icons[status]}
        {PAYROLL_PERIOD_STATUS_LABELS[status]}
      </Badge>
    );
  };

  const handleClosePeriod = async () => {
    try {
      await closePeriod.mutateAsync(periodId);
      toast.success("Periode berhasil ditutup");
      setIsCloseOpen(false);
    } catch (error) {
      toast.error("Gagal menutup periode");
    }
  };

  const handleProcessSelected = async () => {
    if (selectedPayrolls.length === 0) {
      toast.info("Pilih payroll yang ingin diproses");
      return;
    }
    try {
      await processPayroll.mutateAsync({
        periodId: periodId,
        staffIds: selectedPayrolls,
      });
      toast.success(`${selectedPayrolls.length} payroll berhasil diproses`);
      setSelectedPayrolls([]);
    } catch (error) {
      toast.error("Gagal memproses payroll");
    }
  };

  const handlePaySelected = async () => {
    if (selectedPayrolls.length === 0) {
      toast.info("Pilih payroll yang ingin dibayar");
      return;
    }
    try {
      await payPayroll.mutateAsync(selectedPayrolls);
      toast.success(`${selectedPayrolls.length} payroll berhasil dibayar`);
      setSelectedPayrolls([]);
    } catch (error) {
      toast.error("Gagal membayar payroll");
    }
  };

  const handleProcessAll = async () => {
    const draftPayrolls = payrolls
      .filter((p) => p.status === "DRAFT")
      .map((p) => p.id);
    if (draftPayrolls.length === 0) {
      toast.info("Tidak ada payroll draft");
      return;
    }
    try {
      await processPayroll.mutateAsync({
        periodId: periodId,
        staffIds: draftPayrolls,
      });
      toast.success(`${draftPayrolls.length} payroll berhasil diproses`);
    } catch (error) {
      toast.error("Gagal memproses payroll");
    }
  };

  const handlePayAll = async () => {
    const approvedPayrolls = payrolls
      .filter((p) => p.status === "APPROVED" || p.status === "CALCULATED")
      .map((p) => p.id);
    if (approvedPayrolls.length === 0) {
      toast.info("Tidak ada payroll yang siap dibayar");
      return;
    }
    try {
      await payPayroll.mutateAsync(approvedPayrolls);
      toast.success(`${approvedPayrolls.length} payroll berhasil dibayar`);
    } catch (error) {
      toast.error("Gagal membayar payroll");
    }
  };

  const toggleSelectPayroll = (id: string) => {
    setSelectedPayrolls((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const toggleSelectAll = () => {
    if (selectedPayrolls.length === filteredPayrolls.length) {
      setSelectedPayrolls([]);
    } else {
      setSelectedPayrolls(filteredPayrolls.map((p) => p.id));
    }
  };

  const filteredPayrolls = payrolls.filter((payroll) => {
    if (search) {
      const searchLower = search.toLowerCase();
      const staffName =
        payroll.staff?.fullName || payroll.employee?.fullName || "";
      const staffNip = payroll.staff?.nip || payroll.employee?.nip || "";
      return (
        staffName.toLowerCase().includes(searchLower) ||
        staffNip.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  const draftCount = payrolls.filter((p) => p.status === "DRAFT").length;
  const calculatedCount = payrolls.filter(
    (p) => p.status === "CALCULATED",
  ).length;
  const approvedCount = payrolls.filter((p) => p.status === "APPROVED").length;
  const paidCount = payrolls.filter((p) => p.status === "PAID").length;

  if (periodLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  if (!period) {
    return (
      <MainLayout>
        <div className="text-center py-12">
          <h2 className="text-lg font-medium">Periode tidak ditemukan</h2>
          <Button
            className="mt-4"
            onClick={() => router.push("/hr/payroll/periods")}
          >
            Kembali
          </Button>
        </div>
      </MainLayout>
    );
  }

  const periodLabel = `${months[period.month - 1]} ${period.year}`;

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push("/hr/payroll/periods")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight">
                  {period.name}
                </h1>
                {getPeriodStatusBadge(period.status)}
              </div>
              <p className="text-muted-foreground">
                {safeFormat(new Date(period.startDate), "d MMMM", {
                  locale: id,
                })}{" "}
                -{" "}
                {safeFormat(new Date(period.endDate), "d MMMM yyyy", {
                  locale: id,
                })}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {period.status === "OPEN" && (
              <>
                {draftCount > 0 && (
                  <Button
                    variant="outline"
                    onClick={handleProcessAll}
                    disabled={processPayroll.isPending}
                  >
                    {processPayroll.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Calculator className="mr-2 h-4 w-4" />
                    )}
                    Proses Semua ({draftCount})
                  </Button>
                )}
                {(calculatedCount > 0 || approvedCount > 0) && (
                  <Button
                    variant="outline"
                    onClick={handlePayAll}
                    disabled={payPayroll.isPending}
                    className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
                  >
                    {payPayroll.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Banknote className="mr-2 h-4 w-4" />
                    )}
                    Bayar Semua ({calculatedCount + approvedCount})
                  </Button>
                )}
                <Button variant="outline" onClick={() => setIsCloseOpen(true)}>
                  <Lock className="mr-2 h-4 w-4" />
                  Tutup Periode
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                Total Karyawan
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {summary?.totalStaff ?? payrolls.length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Gaji Pokok</CardTitle>
              <Banknote className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(summary?.totalBaseSalary ?? 0)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Tunjangan</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                +{formatCurrency(summary?.totalAllowances ?? 0)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Potongan</CardTitle>
              <TrendingUp className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                -{formatCurrency(summary?.totalDeductions ?? 0)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Gaji Bersih</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(summary?.totalNetSalary ?? 0)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Status Summary */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="text-sm">
            Draft: {draftCount}
          </Badge>
          <Badge variant="outline" className="text-sm bg-blue-50">
            Dihitung: {calculatedCount}
          </Badge>
          <Badge variant="outline" className="text-sm bg-indigo-50">
            Disetujui: {approvedCount}
          </Badge>
          <Badge variant="outline" className="text-sm bg-green-50">
            Dibayar: {paidCount}
          </Badge>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Cari nama atau NIP..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(v) =>
                  setStatusFilter(v as PayrollStatus | "ALL")
                }
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Semua Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Semua Status</SelectItem>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="CALCULATED">Dihitung</SelectItem>
                  <SelectItem value="APPROVED">Disetujui</SelectItem>
                  <SelectItem value="PAID">Dibayar</SelectItem>
                  <SelectItem value="CANCELLED">Dibatalkan</SelectItem>
                </SelectContent>
              </Select>
              {selectedPayrolls.length > 0 && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleProcessSelected}
                    disabled={processPayroll.isPending}
                  >
                    <Calculator className="mr-2 h-4 w-4" />
                    Proses ({selectedPayrolls.length})
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePaySelected}
                    disabled={payPayroll.isPending}
                  >
                    <Banknote className="mr-2 h-4 w-4" />
                    Bayar ({selectedPayrolls.length})
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Payrolls Table */}
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  <input
                    type="checkbox"
                    checked={
                      filteredPayrolls.length > 0 &&
                      selectedPayrolls.length === filteredPayrolls.length
                    }
                    onChange={toggleSelectAll}
                    className="rounded"
                  />
                </TableHead>
                <TableHead>NIP</TableHead>
                <TableHead>Nama Karyawan</TableHead>
                <TableHead className="text-right">Gaji Pokok</TableHead>
                <TableHead className="text-right">Tunjangan</TableHead>
                <TableHead className="text-right">Potongan</TableHead>
                <TableHead className="text-right">Gaji Bersih</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payrollsLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filteredPayrolls.length ? (
                filteredPayrolls.map((payroll) => {
                  const staffName =
                    payroll.staff?.fullName ||
                    payroll.employee?.fullName ||
                    "-";
                  const staffNip =
                    payroll.staff?.nip || payroll.employee?.nip || "-";
                  const staffPosition =
                    payroll.staff?.position ||
                    payroll.employee?.position ||
                    "-";

                  return (
                    <TableRow key={payroll.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedPayrolls.includes(payroll.id)}
                          onChange={() => toggleSelectPayroll(payroll.id)}
                          className="rounded"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {staffNip}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{staffName}</p>
                          <p className="text-sm text-muted-foreground">
                            {staffPosition}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(
                          payroll.baseSalary || payroll.basicSalary || 0,
                        )}
                      </TableCell>
                      <TableCell className="text-right text-green-600">
                        +{formatCurrency(payroll.totalAllowances || 0)}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        -{formatCurrency(payroll.totalDeductions || 0)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(payroll.netSalary || 0)}
                      </TableCell>
                      <TableCell>{getStatusBadge(payroll.status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedSlip(payroll)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon">
                            <Download className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Belum ada payroll untuk periode ini
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>

        {/* Close Period Dialog */}
        <Dialog open={isCloseOpen} onOpenChange={setIsCloseOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Tutup Periode Penggajian</DialogTitle>
              <DialogDescription>
                Apakah Anda yakin ingin menutup periode &quot;{period.name}
                &quot;?
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span>Total Karyawan</span>
                  <span className="font-medium">{payrolls.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Sudah Dibayar</span>
                  <span className="font-medium text-green-600">
                    {paidCount}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Belum Dibayar</span>
                  <span className="font-medium text-yellow-600">
                    {payrolls.length - paidCount}
                  </span>
                </div>
              </div>
              {payrolls.length - paidCount > 0 && (
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    Masih ada {payrolls.length - paidCount} payroll yang belum
                    dibayar
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCloseOpen(false)}>
                Batal
              </Button>
              <Button
                onClick={handleClosePeriod}
                disabled={closePeriod.isPending}
              >
                {closePeriod.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Tutup Periode
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Slip Detail Dialog */}
        <Dialog
          open={!!selectedSlip}
          onOpenChange={(open) => !open && setSelectedSlip(null)}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Detail Slip Gaji</DialogTitle>
              <DialogDescription>
                {selectedSlip?.employeeName || selectedSlip?.staff?.fullName} -{" "}
                {period?.name}
              </DialogDescription>
            </DialogHeader>
            {selectedSlip && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                  <div>
                    <div className="text-sm text-muted-foreground">
                      Nama Karyawan
                    </div>
                    <div className="font-medium">
                      {selectedSlip.employeeName ||
                        selectedSlip.staff?.fullName ||
                        "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">NIP</div>
                    <div className="font-medium">
                      {selectedSlip.employeeNo ||
                        selectedSlip.staff?.nip ||
                        "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Jabatan</div>
                    <div className="font-medium">
                      {selectedSlip.position || "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Status</div>
                    <div className="font-medium">
                      {PAYROLL_STATUS_LABELS[selectedSlip.status]}
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-green-600 mb-2">
                    Pendapatan
                  </h4>
                  <div className="space-y-2">
                    <div className="flex justify-between p-2 border-b">
                      <span>Gaji Pokok</span>
                      <span className="font-medium">
                        {formatCurrency(selectedSlip.basicSalary)}
                      </span>
                    </div>
                    {(selectedSlip.allowances ?? []).map((item, idx) => (
                      <div
                        key={item.componentId ?? idx}
                        className="flex justify-between p-2 border-b"
                      >
                        <span>{item.name}</span>
                        <span className="font-medium">
                          {formatCurrency(item.amount)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between p-2 bg-green-50 rounded font-semibold">
                      <span>Total Pendapatan</span>
                      <span className="text-green-600">
                        {formatCurrency(selectedSlip.grossSalary)}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold text-red-600 mb-2">Potongan</h4>
                  <div className="space-y-2">
                    {(selectedSlip.deductions ?? []).map((item, idx) => (
                      <div
                        key={item.componentId ?? idx}
                        className="flex justify-between p-2 border-b"
                      >
                        <span>{item.name}</span>
                        <span className="font-medium text-red-600">
                          -{formatCurrency(item.amount)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between p-2 border-b">
                      <span>PPh 21</span>
                      <span className="font-medium text-orange-600">
                        -{formatCurrency(selectedSlip.taxDeduction ?? 0)}
                      </span>
                    </div>
                    <div className="flex justify-between p-2 bg-red-50 rounded font-semibold">
                      <span>Total Potongan</span>
                      <span className="text-red-600">
                        -{formatCurrency(selectedSlip.totalDeductions ?? 0)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between p-4 bg-primary/10 rounded-lg text-lg font-bold">
                  <span>Gaji Bersih (Take Home Pay)</span>
                  <span className="text-primary">
                    {formatCurrency(selectedSlip.netSalary)}
                  </span>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedSlip(null)}>
                Tutup
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
