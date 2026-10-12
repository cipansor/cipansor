"use client";

import { useParams, useRouter } from "next/navigation";
import { safeFormat } from "@/lib/date";
import { MainLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useEmployee,
  useDeleteEmployee,
  useLeaveRequests,
  useUserContracts,
  useLeaveBalances,
  useUpdateLeaveBalance,
  useActiveAcademicYear,
  useCreateContract,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  type EmployeeStatus,
  type LeaveStatus,
  type LeaveType,
} from "@/hooks";
import {
  ArrowLeft,
  Edit,
  Trash2,
  User,
  Mail,
  Phone,
  MapPin,
  Briefcase,
  Calendar,
  CreditCard,
  FileText,
  Loader2,
  AlertCircle,
  GraduationCap,
  ClipboardList,
  Scale,
  Plus,
  Pencil,
} from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import Link from "next/link";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { DocumentsTab } from "./components/documents-tab";
import { HistoryTab } from "./components/history-tab";
import { useAuthStore } from "@/stores/auth";
import {
  managesEmployees,
  readsEmployeeRecord,
} from "@/lib/employee-record-access";

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const employeeId = params.id as string;
  const [activeTab, setActiveTab] = useState("info");
  const [isContractDialogOpen, setIsContractDialogOpen] = useState(false);
  const [balanceToEdit, setBalanceToEdit] = useState<any>(null);

  const { data: employee, isLoading } = useEmployee(employeeId);
  const { data: activeAcademicYear } = useActiveAcademicYear();
  // A colleague sees the directory; the HR record — personal data, bank,
  // contracts, leave, documents, history — is for the employee and whoever
  // keeps HR records (decisions/akses-data-pegawai.md). The API answers 404
  // to anyone else, so the page neither asks nor offers.
  const viewer = useAuthStore((s) => s.user);
  const full = readsEmployeeRecord(viewer, employee?.userId);
  const canManage = managesEmployees(viewer);
  const recordUserId = full ? employee?.userId || "" : "";
  const { data: leaveRequestsData } = useLeaveRequests(
    employee?.teacherId
      ? { teacherId: employee.teacherId }
      : { staffId: employee?.staffId },
    { enabled: full && !!(employee?.teacherId || employee?.staffId) },
  );

  const { data: contracts } = useUserContracts(recordUserId);
  const { data: leaveBalances } = useLeaveBalances(
    recordUserId,
    activeAcademicYear?.id,
  );
  const createContract = useCreateContract();
  const updateLeaveBalance = useUpdateLeaveBalance();

  const deleteEmployee = useDeleteEmployee();

  const leaveRequests = leaveRequestsData?.data || [];

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </MainLayout>
    );
  }

  if (!employee) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-64 space-y-4">
          <AlertCircle className="h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">Karyawan tidak ditemukan</p>
          <Button onClick={() => router.push("/hr")}>Kembali ke Daftar</Button>
        </div>
      </MainLayout>
    );
  }

  const handleDelete = async () => {
    try {
      await deleteEmployee.mutateAsync(employeeId);
      toast.success("Karyawan berhasil dihapus");
      router.push("/hr");
    } catch (error) {
      toast.error("Gagal menghapus karyawan");
    }
  };

  const handleCreateContract = async (data: any) => {
    if (!employee.userId) {
      toast.error("User ID not found for this employee");
      return;
    }
    try {
      await createContract.mutateAsync({
        ...data,
        userId: employee.userId,
      });
      toast.success("Kontrak berhasil dibuat");
      setIsContractDialogOpen(false);
    } catch (error) {
      toast.error("Gagal membuat kontrak");
    }
  };

  const handleUpdateBalance = async (data: any) => {
    if (!balanceToEdit || !employee.userId) return;
    try {
      await updateLeaveBalance.mutateAsync({
        id: balanceToEdit.id,
        totalDays: parseInt(data.totalDays),
        userId: employee.userId,
      });
      toast.success("Saldo cuti berhasil diperbarui");
      setBalanceToEdit(null);
    } catch (error) {
      toast.error("Gagal memperbarui saldo cuti");
    }
  };

  const getStatusBadge = (status: EmployeeStatus) => {
    const colors: Record<EmployeeStatus, string> = {
      ACTIVE: "bg-green-100 text-green-800",
      INACTIVE: "bg-gray-100 text-gray-800",
      ON_LEAVE: "bg-yellow-100 text-yellow-800",
      RESIGNED: "bg-red-100 text-red-800",
      RETIRED: "bg-blue-100 text-blue-800",
    };
    return (
      <Badge className={colors[status]}>{EMPLOYEE_STATUS_LABELS[status]}</Badge>
    );
  };

  const getLeaveStatusBadge = (status: LeaveStatus) => {
    const colors: Record<LeaveStatus, string> = {
      PENDING: "bg-yellow-100 text-yellow-800",
      APPROVED: "bg-green-100 text-green-800",
      REJECTED: "bg-red-100 text-red-800",
      CANCELLED: "bg-gray-100 text-gray-800",
    };
    return (
      <Badge className={colors[status]}>{LEAVE_STATUS_LABELS[status]}</Badge>
    );
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-bold tracking-tight">
                  {employee.fullName}
                </h1>
                {getStatusBadge(employee.status)}
              </div>
              <p className="text-muted-foreground">
                {employee.position} • {employee.unit?.name}
              </p>
            </div>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link href={`/hr/employees/${employeeId}/edit`}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Link>
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Hapus
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Hapus Karyawan?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Tindakan ini tidak dapat dibatalkan. Semua data karyawan
                      termasuk riwayat cuti akan dihapus permanen.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete}>
                      Hapus
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>

        {/* Profile Overview */}
        <div
          className={`grid gap-6 ${full ? "md:grid-cols-4" : "md:grid-cols-3"}`}
        >
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">NIP</CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-xl font-bold font-mono">{employee.nip}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                Tipe Karyawan
              </CardTitle>
              <Briefcase className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-xl font-bold">
                {EMPLOYEE_TYPE_LABELS[employee.employeeType]}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                Tanggal Bergabung
              </CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-xl font-bold">
                {safeFormat(employee.joinDate, "d MMM yyyy", {
                  locale: idLocale,
                })}
              </p>
            </CardContent>
          </Card>
          {full && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  Sisa Cuti Tahunan
                </CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold">
                  {leaveBalances?.find((b) => b.leaveType === "ANNUAL")
                    ?.remainingDays ?? "-"}{" "}
                  hari
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="info">
              <User className="mr-2 h-4 w-4" />
              Informasi
            </TabsTrigger>
            {full && (
              <>
                <TabsTrigger value="education">
                  <GraduationCap className="mr-2 h-4 w-4" />
                  Pendidikan
                </TabsTrigger>
                <TabsTrigger value="contracts">
                  <ClipboardList className="mr-2 h-4 w-4" />
                  Kontrak
                </TabsTrigger>
                <TabsTrigger value="leave-balance">
                  <Scale className="mr-2 h-4 w-4" />
                  Kuota Cuti
                </TabsTrigger>
                <TabsTrigger value="leaves">
                  <Calendar className="mr-2 h-4 w-4" />
                  Riwayat Cuti
                </TabsTrigger>
                <TabsTrigger value="documents">
                  <FileText className="mr-2 h-4 w-4" />
                  Dokumen
                </TabsTrigger>
                <TabsTrigger value="history">
                  <Briefcase className="mr-2 h-4 w-4" />
                  Riwayat Karir
                </TabsTrigger>
              </>
            )}
          </TabsList>

          {/* Info Tab */}
          <TabsContent value="info" className="space-y-4">
            <div className="grid gap-6 md:grid-cols-2">
              {/* Personal Info */}
              {full && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <User className="h-5 w-5" />
                      Data Pribadi
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="space-y-4">
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Nama Lengkap</dt>
                        <dd className="font-medium">{employee.fullName}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Jenis Kelamin</dt>
                        <dd>
                          {employee.gender === "MALE"
                            ? "Laki-laki"
                            : "Perempuan"}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Tempat Lahir</dt>
                        <dd>{employee.birthPlace ?? "-"}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Tanggal Lahir</dt>
                        <dd>
                          {employee.birthDate
                            ? format(
                                new Date(employee.birthDate),
                                "d MMMM yyyy",
                                { locale: idLocale },
                              )
                            : "-"}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Agama</dt>
                        <dd>{employee.religion ?? "Islam"}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">
                          Status Pernikahan
                        </dt>
                        <dd>{employee.maritalStatus ?? "-"}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">NIK</dt>
                        <dd className="font-mono">{employee.nik ?? "-"}</dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              )}

              {/* Contact Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Phone className="h-5 w-5" />
                    Kontak
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <dd>{employee.email ?? "-"}</dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <dd>{employee.phone ?? "-"}</dd>
                    </div>
                    <div className="flex items-start gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground mt-1" />
                      <dd>{employee.address ?? "-"}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>

              {/* Employment Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Briefcase className="h-5 w-5" />
                    Data Kepegawaian
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-4">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Unit</dt>
                      <dd className="font-medium">
                        {employee.unit?.name ?? "-"}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Departemen</dt>
                      <dd>{employee.department ?? "-"}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Jabatan</dt>
                      <dd>{employee.position}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Tipe</dt>
                      <dd>
                        <Badge variant="outline">
                          {EMPLOYEE_TYPE_LABELS[employee.employeeType]}
                        </Badge>
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">
                        Tanggal Bergabung
                      </dt>
                      <dd>
                        {safeFormat(employee.joinDate, "d MMMM yyyy", {
                          locale: idLocale,
                        })}
                      </dd>
                    </div>
                    {employee.resignDate && (
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">
                          Tanggal Resign
                        </dt>
                        <dd className="text-red-600">
                          {format(
                            new Date(employee.resignDate),
                            "d MMMM yyyy",
                            { locale: idLocale },
                          )}
                        </dd>
                      </div>
                    )}
                  </dl>
                </CardContent>
              </Card>

              {/* Bank Info */}
              {full && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CreditCard className="h-5 w-5" />
                      Informasi Bank
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="space-y-4">
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Nama Bank</dt>
                        <dd>{employee.bankName ?? "-"}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">No. Rekening</dt>
                        <dd className="font-mono">
                          {employee.bankAccountNumber ?? "-"}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Atas Nama</dt>
                        <dd>{employee.bankAccountName ?? "-"}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">NPWP</dt>
                        <dd className="font-mono">{employee.npwp ?? "-"}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">
                          No. BPJS Kesehatan
                        </dt>
                        <dd className="font-mono">
                          {employee.bpjsKesehatan ?? "-"}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">
                          No. BPJS Ketenagakerjaan
                        </dt>
                        <dd className="font-mono">
                          {employee.bpjsKetenagakerjaan ?? "-"}
                        </dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Education Tab */}
          <TabsContent value="education" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Riwayat Pendidikan</CardTitle>
                <CardDescription>
                  Informasi pendidikan terakhir karyawan
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="space-y-4">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">
                      Pendidikan Terakhir
                    </dt>
                    <dd className="font-medium">
                      {employee.lastEducation ?? "-"}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Institusi</dt>
                    <dd>{employee.educationInstitution ?? "-"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Jurusan</dt>
                    <dd>{employee.educationMajor ?? "-"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Tahun Lulus</dt>
                    <dd>{employee.graduationYear ?? "-"}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Contracts Tab */}
          <TabsContent value="contracts" className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-medium">Riwayat Kontrak Kerja</h3>
              <Button size="sm" onClick={() => setIsContractDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Tambah Kontrak
              </Button>
            </div>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nomor Kontrak</TableHead>
                    <TableHead>Tipe</TableHead>
                    <TableHead>Mulai</TableHead>
                    <TableHead>Selesai</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Dokumen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contracts?.length ? (
                    contracts.map((contract) => (
                      <TableRow key={contract.id}>
                        <TableCell className="font-mono">
                          {contract.contractNumber}
                        </TableCell>
                        <TableCell>{contract.type}</TableCell>
                        <TableCell>
                          {safeFormat(
                            new Date(contract.startDate),
                            "d MMM yyyy",
                            {
                              locale: idLocale,
                            },
                          )}
                        </TableCell>
                        <TableCell>
                          {contract.endDate
                            ? safeFormat(
                                new Date(contract.endDate),
                                "d MMM yyyy",
                                {
                                  locale: idLocale,
                                },
                              )
                            : "Permanen"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              contract.status === "ACTIVE"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {contract.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {contract.documentUrl && (
                            <Button variant="ghost" size="icon" asChild>
                              <Link href={contract.documentUrl} target="_blank">
                                <FileText className="h-4 w-4" />
                              </Link>
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Belum ada riwayat kontrak
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Leave Balances Tab */}
          <TabsContent value="leave-balance" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Saldo & Kuota Cuti</CardTitle>
                <CardDescription>
                  Sisa hak cuti untuk tahun berjalan
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Jenis Cuti</TableHead>
                      <TableHead className="text-center">Total Jatah</TableHead>
                      <TableHead className="text-center">Terpakai</TableHead>
                      <TableHead className="text-center">Sisa</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaveBalances?.length ? (
                      leaveBalances.map((balance) => (
                        <TableRow key={balance.id}>
                          <TableCell>
                            {LEAVE_TYPE_LABELS[
                              balance.leaveType as LeaveType
                            ] || balance.leaveType}
                          </TableCell>
                          <TableCell className="text-center">
                            {balance.totalDays}
                          </TableCell>
                          <TableCell className="text-center">
                            {balance.usedDays}
                          </TableCell>
                          <TableCell className="text-center font-bold text-green-600">
                            {balance.remainingDays}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setBalanceToEdit(balance)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center py-8 text-muted-foreground"
                        >
                          Belum ada data saldo cuti
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Leave History Tab */}
          <TabsContent value="leaves" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Riwayat Pengajuan Cuti</CardTitle>
                <CardDescription>
                  Daftar pengajuan cuti yang pernah dibuat
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Jenis Cuti</TableHead>
                      <TableHead>Tanggal Mulai</TableHead>
                      <TableHead>Tanggal Selesai</TableHead>
                      <TableHead>Durasi</TableHead>
                      <TableHead>Alasan</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaveRequests.length ? (
                      leaveRequests.map((leave) => (
                        <TableRow key={leave.id}>
                          <TableCell>
                            {LEAVE_TYPE_LABELS[leave.leaveType]}
                          </TableCell>
                          <TableCell>
                            {safeFormat(
                              new Date(leave.startDate),
                              "d MMM yyyy",
                              {
                                locale: idLocale,
                              },
                            )}
                          </TableCell>
                          <TableCell>
                            {safeFormat(new Date(leave.endDate), "d MMM yyyy", {
                              locale: idLocale,
                            })}
                          </TableCell>
                          <TableCell>{leave.totalDays} hari</TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {leave.reason}
                          </TableCell>
                          <TableCell>
                            {getLeaveStatusBadge(leave.status)}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center py-8 text-muted-foreground"
                        >
                          Belum ada riwayat cuti
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents" className="space-y-4">
            <DocumentsTab userId={employee.id} />
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4">
            <HistoryTab userId={employee.id} />
          </TabsContent>
        </Tabs>

        <ContractDialog
          open={isContractDialogOpen}
          onOpenChange={setIsContractDialogOpen}
          onSubmit={handleCreateContract}
        />

        <EditBalanceDialog
          open={!!balanceToEdit}
          onOpenChange={(open) => !open && setBalanceToEdit(null)}
          balance={balanceToEdit}
          onSubmit={handleUpdateBalance}
        />
      </div>
    </MainLayout>
  );
}

function ContractDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm();

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Kontrak Kerja</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="contractNumber">Nomor Kontrak</Label>
            <Input
              id="contractNumber"
              {...register("contractNumber", { required: true })}
              placeholder="e.g. KONTRAK/2024/001"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="type">Tipe Kontrak</Label>
            <Select
              onValueChange={(v) =>
                register("type").onChange({
                  target: { value: v, name: "type" },
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih tipe kontrak" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PKWT">
                  PKWT (Kontrak Waktu Tertentu)
                </SelectItem>
                <SelectItem value="PKWTT">PKWTT (Tetap)</SelectItem>
                <SelectItem value="PART_TIME">Part Time</SelectItem>
                <SelectItem value="PROBATION">Probation</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">Tanggal Mulai</Label>
              <Input
                id="startDate"
                type="date"
                {...register("startDate", { required: true })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">Tanggal Selesai</Label>
              <Input id="endDate" type="date" {...register("endDate")} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Catatan</Label>
            <Textarea id="notes" {...register("notes")} />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Simpan
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditBalanceDialog({
  open,
  onOpenChange,
  balance,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balance: any;
  onSubmit: (data: any) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { isSubmitting },
  } = useForm();

  useEffect(() => {
    if (open && balance) {
      setValue("totalDays", balance.totalDays);
    }
  }, [open, balance, setValue]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Saldo Cuti</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Jenis Cuti</Label>
            <div className="font-medium">
              {balance
                ? LEAVE_TYPE_LABELS[balance.leaveType as LeaveType] ||
                  balance.leaveType
                : "-"}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="totalDays">Total Jatah Cuti (Hari)</Label>
            <Input
              id="totalDays"
              type="number"
              {...register("totalDays", { required: true })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Simpan
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
