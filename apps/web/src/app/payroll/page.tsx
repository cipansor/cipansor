"use client";
import { MainLayout } from "@/components/layout";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Users,
  Calendar,
  FileText,
  Plus,
  Search,
  MoreHorizontal,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  Download,
  RefreshCw,
  Building2,
  Wallet,
  TrendingUp,
  Clock,
  Calculator,
  Eye,
  Printer,
  ChevronRight,
  Settings,
  Play,
  Ban,
  Banknote,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { payrollButtons, type PayrollAction } from "@cipansor/shared";
import {
  usePayrollPeriods,
  usePayrollSlips,
  useSalaryComponents,
  useEmployeeSalaries,
  usePayrollPeriodSummary,
  useCreatePayrollPeriod,
  useApprovePayrollPeriod,
  usePayPayrollPeriod,
  useCancelPayrollPeriod,
  useGeneratePayroll,
  useCreateSalaryComponent,
  useUpdateSalaryComponent,
  useDeleteSalaryComponent,
  useSeedSalaryComponents,
  useCreateEmployeeSalary,
  useUpdateEmployeeSalary,
  formatCurrency,
  getMonthName,
  PAYROLL_STATUS_MAP,
  TAX_STATUS_OPTIONS,
  type PayrollPeriod,
  type PayrollSlip,
  type SalaryComponent,
  type EmployeeSalary,
  type SalaryComponentType,
  type PayrollStatus,
} from "@/hooks/use-payroll";
import { useAuth } from "@/hooks/use-auth";
import { useUnits } from "@/hooks/use-units";
import { getActiveRoleCode } from "@/lib/rbac";

function PayrollPageContent() {
  const { user } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("periods");
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [showCreatePeriodDialog, setShowCreatePeriodDialog] = useState(false);
  const [showCreateComponentDialog, setShowCreateComponentDialog] =
    useState(false);
  const [showEmployeeSalaryDialog, setShowEmployeeSalaryDialog] =
    useState(false);
  const [showSlipDetailDialog, setShowSlipDetailDialog] = useState(false);
  const [selectedSlip, setSelectedSlip] = useState<PayrollSlip | null>(null);
  const [periodFilters, setPeriodFilters] = useState({
    year: new Date().getFullYear().toString(),
    status: "all",
  });

  // Queries
  const { data: units } = useUnits();
  const { data: periodsData, isLoading: loadingPeriods } = usePayrollPeriods({
    year: periodFilters.year,
    status:
      periodFilters.status !== "all"
        ? (periodFilters.status as PayrollStatus)
        : undefined,
    limit: "20",
  });
  const { data: components, isLoading: loadingComponents } =
    useSalaryComponents();
  const { data: salariesData, isLoading: loadingSalaries } =
    useEmployeeSalaries();
  const { data: slipsData, isLoading: loadingSlips } = usePayrollSlips({
    periodId: selectedPeriod || undefined,
  });
  const { data: periodSummary } = usePayrollPeriodSummary(selectedPeriod || "");

  // Mutations
  const createPeriod = useCreatePayrollPeriod();
  const approvePeriod = useApprovePayrollPeriod();
  const payPeriod = usePayPayrollPeriod();
  const cancelPeriod = useCancelPayrollPeriod();
  const generatePayroll = useGeneratePayroll();
  const createComponent = useCreateSalaryComponent();
  const updateComponent = useUpdateSalaryComponent();
  const deleteComponent = useDeleteSalaryComponent();
  const seedComponents = useSeedSalaryComponents();
  const createEmployeeSalary = useCreateEmployeeSalary();
  const updateEmployeeSalary = useUpdateEmployeeSalary();

  const periods = periodsData?.data || [];
  const salaries = salariesData?.data || [];
  const slips = slipsData?.data || [];

  // Buttons come from the same policy the API enforces, so a button never
  // appears for an action the server would refuse.
  const payrollActions = (period: PayrollPeriod): PayrollAction[] => {
    if (!user) return [];
    const activeAssignment =
      user.userRoles?.find((assignment) => assignment.isPrimary) ??
      user.userRoles?.[0];
    return payrollButtons(
      {
        sub: user.id,
        roleCode: getActiveRoleCode(user) ?? "",
        unitId: activeAssignment?.unit?.id ?? user.unitId ?? null,
      },
      {
        unitId: period.unitId,
        status: period.status === "CALCULATED" ? "DRAFT" : period.status,
        createdById: period.createdById ?? "",
        approvedById: period.approvedById ?? null,
        slipCount: period.totalEmployees,
      },
    );
  };

  // Calculate stats
  const stats = {
    totalPeriods: periods.length,
    pendingPeriods: periods.filter(
      (p) => p.status === "DRAFT" || p.status === "CALCULATED",
    ).length,
    totalSalaries: salaries.length,
    totalComponents: components?.length || 0,
  };

  // Period form state
  const [periodForm, setPeriodForm] = useState({
    unitId: user?.unitId || "",
    name: "",
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    startDate: "",
    endDate: "",
    notes: "",
  });

  // Component form state
  const [componentForm, setComponentForm] = useState({
    code: "",
    name: "",
    type: "ALLOWANCE" as SalaryComponentType,
    description: "",
    defaultAmount: 0,
    isPercentage: false,
    isTaxable: true,
    sortOrder: 0,
  });

  const handleCreatePeriod = async () => {
    if (!periodForm.name || !periodForm.startDate || !periodForm.endDate) {
      toast.error("Mohon lengkapi data periode");
      return;
    }

    try {
      await createPeriod.mutateAsync(periodForm);
      toast.success("Periode penggajian berhasil dibuat");
      setShowCreatePeriodDialog(false);
      resetPeriodForm();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Gagal membuat periode");
    }
  };

  const resetPeriodForm = () => {
    setPeriodForm({
      unitId: user?.unitId || "",
      name: "",
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
      startDate: "",
      endDate: "",
      notes: "",
    });
  };

  const handleGeneratePayroll = async (periodId: string) => {
    try {
      const result = await generatePayroll.mutateAsync({ periodId });
      toast.success(
        `${result.created} slip gaji dibuat, ${result.updated} diperbarui`,
      );
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Gagal generate slip gaji");
    }
  };

  const handleApprovePeriod = async (periodId: string) => {
    try {
      await approvePeriod.mutateAsync({ id: periodId });
      toast.success("Periode berhasil disetujui");
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Gagal menyetujui periode");
    }
  };

  const handlePayPeriod = async (periodId: string) => {
    try {
      await payPeriod.mutateAsync({
        id: periodId,
        payDate: new Date().toISOString(),
      });
      toast.success("Periode ditandai sebagai dibayar");
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Gagal menandai pembayaran");
    }
  };

  const handleCancelPeriod = async (periodId: string) => {
    try {
      await cancelPeriod.mutateAsync({
        id: periodId,
        notes: "Dibatalkan oleh admin",
      });
      toast.success("Periode dibatalkan");
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Gagal membatalkan periode");
    }
  };

  const handleCreateComponent = async () => {
    if (!componentForm.code || !componentForm.name) {
      toast.error("Mohon lengkapi data komponen");
      return;
    }

    try {
      await createComponent.mutateAsync(componentForm);
      toast.success("Komponen gaji berhasil dibuat");
      setShowCreateComponentDialog(false);
      setComponentForm({
        code: "",
        name: "",
        type: "ALLOWANCE",
        description: "",
        defaultAmount: 0,
        isPercentage: false,
        isTaxable: true,
        sortOrder: 0,
      });
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Gagal membuat komponen");
    }
  };

  const handleSeedComponents = async () => {
    try {
      const result = await seedComponents.mutateAsync();
      toast.success(`${result.created} komponen default dibuat`);
    } catch (error: any) {
      toast.error(
        error.response?.data?.message || "Gagal membuat komponen default",
      );
    }
  };

  const getStatusBadge = (status: PayrollStatus) => {
    const config = PAYROLL_STATUS_MAP[status];
    return <Badge className={config.color}>{config.label}</Badge>;
  };

  const viewSlipDetail = (slip: PayrollSlip) => {
    setSelectedSlip(slip);
    setShowSlipDetailDialog(true);
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Penggajian</h1>
          <p className="text-muted-foreground">
            Kelola gaji karyawan, komponen, dan slip gaji
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowCreateComponentDialog(true)}
          >
            <Settings className="mr-2 h-4 w-4" />
            Komponen
          </Button>
          <Button onClick={() => setShowCreatePeriodDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Buat Periode
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Periode</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalPeriods}</div>
            <p className="text-xs text-muted-foreground">
              {stats.pendingPeriods} menunggu proses
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Karyawan Aktif
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalSalaries}</div>
            <p className="text-xs text-muted-foreground">
              Dengan pengaturan gaji
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Komponen Gaji</CardTitle>
            <Calculator className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalComponents}</div>
            <p className="text-xs text-muted-foreground">
              Tunjangan & potongan
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Gaji Bulan Ini
            </CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {periodSummary ? formatCurrency(periodSummary.totalNet) : "-"}
            </div>
            <p className="text-xs text-muted-foreground">
              {periodSummary?.totalEmployees || 0} karyawan
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 max-w-[600px]">
          <TabsTrigger value="periods">
            <Calendar className="mr-2 h-4 w-4" />
            Periode
          </TabsTrigger>
          <TabsTrigger value="slips">
            <FileText className="mr-2 h-4 w-4" />
            Slip Gaji
          </TabsTrigger>
          <TabsTrigger value="employees">
            <Users className="mr-2 h-4 w-4" />
            Karyawan
          </TabsTrigger>
          <TabsTrigger value="components">
            <Settings className="mr-2 h-4 w-4" />
            Komponen
          </TabsTrigger>
        </TabsList>

        {/* Periods Tab */}
        <TabsContent value="periods" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Periode Penggajian</CardTitle>
                  <CardDescription>
                    Kelola periode penggajian bulanan
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={periodFilters.year}
                    onValueChange={(v) =>
                      setPeriodFilters({ ...periodFilters, year: v })
                    }
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue placeholder="Tahun" />
                    </SelectTrigger>
                    <SelectContent>
                      {[2024, 2025, 2026].map((year) => (
                        <SelectItem key={year} value={year.toString()}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={periodFilters.status}
                    onValueChange={(v) =>
                      setPeriodFilters({ ...periodFilters, status: v })
                    }
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Status</SelectItem>
                      <SelectItem value="DRAFT">Draft</SelectItem>
                      <SelectItem value="CALCULATED">Dihitung</SelectItem>
                      <SelectItem value="APPROVED">Disetujui</SelectItem>
                      <SelectItem value="PAID">Dibayar</SelectItem>
                      <SelectItem value="CANCELLED">Dibatalkan</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingPeriods ? (
                <div className="flex justify-center p-8">
                  <RefreshCw className="h-6 w-6 animate-spin" />
                </div>
              ) : periods.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Belum ada periode penggajian
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Periode</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total Gaji</TableHead>
                      <TableHead className="text-right">Karyawan</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {periods.map((period) => (
                      <TableRow key={period.id}>
                        <TableCell>
                          <div className="font-medium">{period.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {getMonthName(period.month)} {period.year}
                          </div>
                        </TableCell>
                        <TableCell>{period.unit?.name || "-"}</TableCell>
                        <TableCell>{getStatusBadge(period.status)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(period.totalNet)}
                        </TableCell>
                        <TableCell className="text-right">
                          {period.totalEmployees}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => setSelectedPeriod(period.id)}
                              >
                                <Eye className="mr-2 h-4 w-4" />
                                Lihat Slip
                              </DropdownMenuItem>
                              {payrollActions(period).includes("GENERATE") && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    handleGeneratePayroll(period.id)
                                  }
                                >
                                  <Calculator className="mr-2 h-4 w-4" />
                                  Generate Slip
                                </DropdownMenuItem>
                              )}
                              {payrollActions(period).includes("APPROVE") && (
                                <DropdownMenuItem
                                  onClick={() => handleApprovePeriod(period.id)}
                                >
                                  <CheckCircle className="mr-2 h-4 w-4" />
                                  Setujui
                                </DropdownMenuItem>
                              )}
                              {payrollActions(period).includes("PAY") && (
                                <DropdownMenuItem
                                  onClick={() => handlePayPeriod(period.id)}
                                >
                                  <Banknote className="mr-2 h-4 w-4" />
                                  Tandai Dibayar
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              {payrollActions(period).includes("CANCEL") && (
                                <DropdownMenuItem
                                  onClick={() => handleCancelPeriod(period.id)}
                                  className="text-red-600"
                                >
                                  <Ban className="mr-2 h-4 w-4" />
                                  Batalkan
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Slips Tab */}
        <TabsContent value="slips" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Slip Gaji</CardTitle>
                  <CardDescription>
                    {selectedPeriod
                      ? `Slip gaji untuk periode terpilih`
                      : "Pilih periode untuk melihat slip gaji"}
                  </CardDescription>
                </div>
                <Select
                  value={selectedPeriod || ""}
                  onValueChange={setSelectedPeriod}
                >
                  <SelectTrigger className="w-[250px]">
                    <SelectValue placeholder="Pilih Periode" />
                  </SelectTrigger>
                  <SelectContent>
                    {periods.map((period) => (
                      <SelectItem key={period.id} value={period.id}>
                        {period.name} - {getMonthName(period.month)}{" "}
                        {period.year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {!selectedPeriod ? (
                <div className="text-center py-8 text-muted-foreground">
                  Pilih periode untuk melihat slip gaji
                </div>
              ) : loadingSlips ? (
                <div className="flex justify-center p-8">
                  <RefreshCw className="h-6 w-6 animate-spin" />
                </div>
              ) : slips.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Belum ada slip gaji untuk periode ini
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Karyawan</TableHead>
                      <TableHead className="text-right">Gaji Pokok</TableHead>
                      <TableHead className="text-right">Tunjangan</TableHead>
                      <TableHead className="text-right">Potongan</TableHead>
                      <TableHead className="text-right">PPh 21</TableHead>
                      <TableHead className="text-right">Gaji Bersih</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {slips.map((slip) => {
                      const allowances = slip.items
                        .filter((i) => i.componentType === "ALLOWANCE")
                        .reduce((sum, i) => sum + i.amount, 0);
                      const deductions = slip.items
                        .filter((i) => i.componentType === "DEDUCTION")
                        .reduce((sum, i) => sum + i.amount, 0);

                      return (
                        <TableRow key={slip.id}>
                          <TableCell>
                            <div className="font-medium">
                              {slip.staff?.name || "-"}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {slip.staff?.nip || "-"} •{" "}
                              {slip.staff?.position || "-"}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(slip.basicSalary)}
                          </TableCell>
                          <TableCell className="text-right text-green-600">
                            +{formatCurrency(allowances)}
                          </TableCell>
                          <TableCell className="text-right text-red-600">
                            -{formatCurrency(deductions)}
                          </TableCell>
                          <TableCell className="text-right text-orange-600">
                            -{formatCurrency(slip.taxAmount)}
                          </TableCell>
                          <TableCell className="text-right font-bold">
                            {formatCurrency(slip.netSalary)}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => viewSlipDetail(slip)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon">
                                <Printer className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}

              {/* Summary */}
              {periodSummary && selectedPeriod && (
                <div className="mt-6 p-4 bg-muted/50 rounded-lg">
                  <h4 className="font-semibold mb-3">Ringkasan Periode</h4>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">
                        Total Karyawan
                      </div>
                      <div className="text-lg font-semibold">
                        {periodSummary.totalEmployees}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">
                        Total Bruto
                      </div>
                      <div className="text-lg font-semibold">
                        {formatCurrency(periodSummary.totalGross)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">
                        Total Potongan
                      </div>
                      <div className="text-lg font-semibold text-red-600">
                        {formatCurrency(periodSummary.totalDeductions)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">
                        Total PPh 21
                      </div>
                      <div className="text-lg font-semibold text-orange-600">
                        {formatCurrency(periodSummary.totalTax)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">
                        Total Neto
                      </div>
                      <div className="text-lg font-semibold text-green-600">
                        {formatCurrency(periodSummary.totalNet)}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Employees Tab */}
        <TabsContent value="employees" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Pengaturan Gaji Karyawan</CardTitle>
                  <CardDescription>
                    Kelola gaji pokok dan komponen per karyawan
                  </CardDescription>
                </div>
                <Button onClick={() => setShowEmployeeSalaryDialog(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Tambah Pengaturan
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingSalaries ? (
                <div className="flex justify-center p-8">
                  <RefreshCw className="h-6 w-6 animate-spin" />
                </div>
              ) : salaries.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Belum ada pengaturan gaji karyawan
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Karyawan</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Gaji Pokok</TableHead>
                      <TableHead>Status Pajak</TableHead>
                      <TableHead>NPWP</TableHead>
                      <TableHead>Bank</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {salaries.map((salary) => (
                      <TableRow key={salary.id}>
                        <TableCell>
                          <div className="font-medium">
                            {salary.staff?.name || "-"}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {salary.staff?.nip || "-"} •{" "}
                            {salary.staff?.position || "-"}
                          </div>
                        </TableCell>
                        <TableCell>{salary.staff?.unit?.name || "-"}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(salary.basicSalary)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{salary.taxStatus}</Badge>
                        </TableCell>
                        <TableCell>
                          {salary.hasNpwp ? (
                            <Badge
                              variant="default"
                              className="bg-green-100 text-green-800"
                            >
                              Ada
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Tidak Ada</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {salary.bankName || "-"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {salary.bankAccountNumber || "-"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon">
                            <Edit className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Components Tab */}
        <TabsContent value="components" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Komponen Gaji</CardTitle>
                  <CardDescription>
                    Kelola tunjangan dan potongan gaji
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={handleSeedComponents}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Seed Default
                  </Button>
                  <Button onClick={() => setShowCreateComponentDialog(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Tambah Komponen
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingComponents ? (
                <div className="flex justify-center p-8">
                  <RefreshCw className="h-6 w-6 animate-spin" />
                </div>
              ) : !components || components.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Belum ada komponen gaji. Klik "Seed Default" untuk membuat
                  komponen standar.
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Allowances */}
                  <div>
                    <h4 className="font-semibold text-green-600 mb-3 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Tunjangan
                    </h4>
                    <div className="space-y-2">
                      {components
                        .filter((c) => c.type === "ALLOWANCE")
                        .map((component) => (
                          <div
                            key={component.id}
                            className="flex items-center justify-between p-3 border rounded-lg"
                          >
                            <div>
                              <div className="font-medium">
                                {component.name}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {component.code} •{" "}
                                {component.isTaxable
                                  ? "Kena Pajak"
                                  : "Bebas Pajak"}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {component.defaultAmount && (
                                <Badge variant="outline">
                                  {formatCurrency(component.defaultAmount)}
                                </Badge>
                              )}
                              <Button variant="ghost" size="icon">
                                <Edit className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Deductions */}
                  <div>
                    <h4 className="font-semibold text-red-600 mb-3 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 rotate-180" />
                      Potongan
                    </h4>
                    <div className="space-y-2">
                      {components
                        .filter((c) => c.type === "DEDUCTION")
                        .map((component) => (
                          <div
                            key={component.id}
                            className="flex items-center justify-between p-3 border rounded-lg"
                          >
                            <div>
                              <div className="font-medium">
                                {component.name}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {component.code}
                                {component.isPercentage && " • Persentase"}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {component.defaultAmount && (
                                <Badge variant="outline">
                                  {component.isPercentage
                                    ? `${component.defaultAmount}%`
                                    : formatCurrency(component.defaultAmount)}
                                </Badge>
                              )}
                              <Button variant="ghost" size="icon">
                                <Edit className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Period Dialog */}
      <Dialog
        open={showCreatePeriodDialog}
        onOpenChange={setShowCreatePeriodDialog}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Buat Periode Penggajian</DialogTitle>
            <DialogDescription>
              Buat periode penggajian baru untuk bulan tertentu
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nama Periode</Label>
              <Input
                value={periodForm.name}
                onChange={(e) =>
                  setPeriodForm({ ...periodForm, name: e.target.value })
                }
                placeholder="Gaji Januari 2026"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Bulan</Label>
                <Select
                  value={periodForm.month.toString()}
                  onValueChange={(v) =>
                    setPeriodForm({ ...periodForm, month: parseInt(v) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(
                      (month) => (
                        <SelectItem key={month} value={month.toString()}>
                          {getMonthName(month)}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tahun</Label>
                <Select
                  value={periodForm.year.toString()}
                  onValueChange={(v) =>
                    setPeriodForm({ ...periodForm, year: parseInt(v) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[2024, 2025, 2026, 2027].map((year) => (
                      <SelectItem key={year} value={year.toString()}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tanggal Mulai</Label>
                <Input
                  type="date"
                  value={periodForm.startDate}
                  onChange={(e) =>
                    setPeriodForm({ ...periodForm, startDate: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Tanggal Akhir</Label>
                <Input
                  type="date"
                  value={periodForm.endDate}
                  onChange={(e) =>
                    setPeriodForm({ ...periodForm, endDate: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Catatan</Label>
              <Textarea
                value={periodForm.notes}
                onChange={(e) =>
                  setPeriodForm({ ...periodForm, notes: e.target.value })
                }
                placeholder="Catatan tambahan (opsional)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreatePeriodDialog(false)}
            >
              Batal
            </Button>
            <Button
              onClick={handleCreatePeriod}
              disabled={createPeriod.isPending}
            >
              {createPeriod.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Component Dialog */}
      <Dialog
        open={showCreateComponentDialog}
        onOpenChange={setShowCreateComponentDialog}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah Komponen Gaji</DialogTitle>
            <DialogDescription>
              Buat komponen tunjangan atau potongan baru
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Kode</Label>
                <Input
                  value={componentForm.code}
                  onChange={(e) =>
                    setComponentForm({
                      ...componentForm,
                      code: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="TJ_001"
                />
              </div>
              <div className="space-y-2">
                <Label>Tipe</Label>
                <Select
                  value={componentForm.type}
                  onValueChange={(v) =>
                    setComponentForm({
                      ...componentForm,
                      type: v as SalaryComponentType,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALLOWANCE">Tunjangan</SelectItem>
                    <SelectItem value="DEDUCTION">Potongan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Nama Komponen</Label>
              <Input
                value={componentForm.name}
                onChange={(e) =>
                  setComponentForm({ ...componentForm, name: e.target.value })
                }
                placeholder="Tunjangan Transportasi"
              />
            </div>
            <div className="space-y-2">
              <Label>Deskripsi</Label>
              <Textarea
                value={componentForm.description}
                onChange={(e) =>
                  setComponentForm({
                    ...componentForm,
                    description: e.target.value,
                  })
                }
                placeholder="Deskripsi komponen (opsional)"
              />
            </div>
            <div className="space-y-2">
              <Label>Nilai Default</Label>
              <Input
                type="number"
                value={componentForm.defaultAmount}
                onChange={(e) =>
                  setComponentForm({
                    ...componentForm,
                    defaultAmount: parseInt(e.target.value) || 0,
                  })
                }
                placeholder="0"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="isTaxable"
                checked={componentForm.isTaxable}
                onCheckedChange={(checked) =>
                  setComponentForm({
                    ...componentForm,
                    isTaxable: checked as boolean,
                  })
                }
              />
              <Label htmlFor="isTaxable">Kena Pajak (PPh 21)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateComponentDialog(false)}
            >
              Batal
            </Button>
            <Button
              onClick={handleCreateComponent}
              disabled={createComponent.isPending}
            >
              {createComponent.isPending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Slip Detail Dialog */}
      <Dialog
        open={showSlipDetailDialog}
        onOpenChange={setShowSlipDetailDialog}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detail Slip Gaji</DialogTitle>
            <DialogDescription>
              {selectedSlip?.staff?.name} - {selectedSlip?.period?.name}
            </DialogDescription>
          </DialogHeader>
          {selectedSlip && (
            <div className="space-y-6">
              {/* Employee Info */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                <div>
                  <div className="text-sm text-muted-foreground">
                    Nama Karyawan
                  </div>
                  <div className="font-medium">{selectedSlip.staff?.name}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">NIP</div>
                  <div className="font-medium">
                    {selectedSlip.staff?.nip || "-"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Jabatan</div>
                  <div className="font-medium">
                    {selectedSlip.staff?.position || "-"}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">
                    Status Pajak
                  </div>
                  <div className="font-medium">{selectedSlip.taxStatus}</div>
                </div>
              </div>

              {/* Income */}
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
                  {selectedSlip.items
                    .filter((i) => i.componentType === "ALLOWANCE")
                    .map((item) => (
                      <div
                        key={item.id}
                        className="flex justify-between p-2 border-b"
                      >
                        <span>{item.componentName}</span>
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

              {/* Deductions */}
              <div>
                <h4 className="font-semibold text-red-600 mb-2">Potongan</h4>
                <div className="space-y-2">
                  {selectedSlip.items
                    .filter((i) => i.componentType === "DEDUCTION")
                    .map((item) => (
                      <div
                        key={item.id}
                        className="flex justify-between p-2 border-b"
                      >
                        <span>{item.componentName}</span>
                        <span className="font-medium text-red-600">
                          -{formatCurrency(item.amount)}
                        </span>
                      </div>
                    ))}
                  <div className="flex justify-between p-2 border-b">
                    <span>PPh 21</span>
                    <span className="font-medium text-orange-600">
                      -{formatCurrency(selectedSlip.taxAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between p-2 bg-red-50 rounded font-semibold">
                    <span>Total Potongan</span>
                    <span className="text-red-600">
                      -
                      {formatCurrency(
                        selectedSlip.totalDeductions + selectedSlip.taxAmount,
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Net Salary */}
              <div className="flex justify-between p-4 bg-primary/10 rounded-lg text-lg font-bold">
                <span>Gaji Bersih (Take Home Pay)</span>
                <span className="text-primary">
                  {formatCurrency(selectedSlip.netSalary)}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSlipDetailDialog(false)}
            >
              Tutup
            </Button>
            <Button>
              <Printer className="mr-2 h-4 w-4" />
              Cetak Slip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PayrollPageWithShell() {
  return (
    <MainLayout>
      <PayrollPageContent />
    </MainLayout>
  );
}
