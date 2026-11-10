"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authFileUrl } from "@/lib/files";
import { safeFormat } from "@/lib/date";
import { MainLayout } from "@/components/layout";
import { BoardOrgans } from "@/components/foundation/board-organs";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  useFoundation,
  useUpdateFoundation,
  useFoundationDocuments,
  useDeleteFoundationDocument,
  useFoundationBoardMembers,
  useDeleteFoundationBoardMember,
  useFoundationFinancialOverview,
  DOCUMENT_TYPE_LABELS,
  type DocumentType,
  type Foundation,
  type FoundationProfileForm,
  foundationProfilePayload,
} from "@/hooks";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Building2,
  FileText,
  Users,
  Edit,
  Trash2,
  Plus,
  Download,
  Calendar,
  Phone,
  Mail,
  Globe,
  MapPin,
  Loader2,
  Save,
  Eye,
  AlertTriangle,
  Banknote,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { format, isPast, isBefore, addMonths } from "date-fns";
import { id } from "date-fns/locale";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FOUNDATION_WRITER_ROLE_CODES } from "@cipansor/shared";
import { useAuthStore } from "@/stores/auth";
import { getActiveRoleCode } from "@/lib/rbac";

const TABS = ["info", "documents", "board", "financial"] as const;

type ProfileForm = FoundationProfileForm;

/** The record as the form's fields: strings only, the date as YYYY-MM-DD. */
function toProfileForm(f: Foundation | null | undefined): ProfileForm {
  return {
    name: f?.name ?? "",
    legalName: f?.legalName ?? "",
    taxId: f?.taxId ?? "",
    address: f?.address ?? "",
    phone: f?.phone ?? "",
    email: f?.email ?? "",
    website: f?.website ?? "",
    vision: f?.vision ?? "",
    mission: f?.mission ?? "",
    foundingDate: f?.foundingDate ? f.foundingDate.slice(0, 10) : "",
  };
}

function FoundationPageContent() {
  // The organ forms come back to `/foundation?tab=board`.
  const tabParam = useSearchParams().get("tab");
  const [activeTab, setActiveTab] = useState<string>(
    TABS.find((t) => t === tabParam) ?? "info",
  );
  const [isEditing, setIsEditing] = useState(false);
  // The other organs read the profile; `PUT /foundation/:id` refuses them, so
  // they get no "Edit" to press.
  const user = useAuthStore((state) => state.user);
  const canEditProfile = FOUNDATION_WRITER_ROLE_CODES.includes(
    getActiveRoleCode(user) ?? "",
  );

  const { data: foundation, isLoading } = useFoundation();
  const { data: documents } = useFoundationDocuments();
  const { data: boardMembers } = useFoundationBoardMembers({ isActive: true });
  // This used to call useFinancialSummary(foundation?.id) — the SPP/invoice
  // summary hook, passed a foundation id where it expects an academic year id.
  // Every read below was cast through `as any` because the shapes do not match
  // at all. The endpoint this page actually wants is /foundation/stats/financial.
  const { data: financialSummary } = useFoundationFinancialOverview();
  const updateFoundation = useUpdateFoundation();
  const deleteDocument = useDeleteFoundationDocument();
  const deleteBoardMember = useDeleteFoundationBoardMember();

  const COLORS = [
    "#0088FE",
    "#00C49F",
    "#FFBB28",
    "#FF8042",
    "#8884d8",
    "#82ca9d",
  ];

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const { register, handleSubmit, reset } = useForm<ProfileForm>({
    defaultValues: toProfileForm(foundation),
  });

  const onSubmit = async (values: ProfileForm) => {
    if (!foundation) return;
    const data = foundationProfilePayload(values);
    try {
      await updateFoundation.mutateAsync({ id: foundation.id, data });
      toast.success("Data yayasan berhasil diperbarui");
      setIsEditing(false);
    } catch {
      // The shared client already shows the API's reason.
    }
  };

  const handleDeleteDocument = async (id: string) => {
    try {
      await deleteDocument.mutateAsync(id);
      toast.success("Dokumen berhasil dihapus");
    } catch {
      toast.error("Gagal menghapus dokumen");
    }
  };

  const handleDeleteBoardMember = async (id: string) => {
    try {
      await deleteBoardMember.mutateAsync(id);
      toast.success("Anggota organ berhasil dihapus");
    } catch {
      toast.error("Gagal menghapus anggota organ");
    }
  };

  const getDocumentStatus = (expiryDate?: string) => {
    if (!expiryDate) return null;
    const expiry = new Date(expiryDate);
    if (isPast(expiry)) {
      return {
        status: "expired",
        label: "Kadaluarsa",
        variant: "destructive" as const,
      };
    }
    if (isBefore(expiry, addMonths(new Date(), 3))) {
      return {
        status: "expiring",
        label: "Segera Habis",
        variant: "secondary" as const,
      };
    }
    return { status: "valid", label: "Aktif", variant: "default" as const };
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Yayasan</h1>
            <p className="text-muted-foreground">
              Kelola informasi dan dokumen yayasan
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="info" className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Informasi
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Dokumen
            </TabsTrigger>
            <TabsTrigger value="board" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Organ Yayasan
            </TabsTrigger>
            <TabsTrigger value="financial" className="flex items-center gap-2">
              <Banknote className="h-4 w-4" />
              Keuangan
            </TabsTrigger>
          </TabsList>

          {/* Foundation Info Tab */}
          <TabsContent value="info" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Profil Yayasan</CardTitle>
                  <CardDescription>Informasi dasar yayasan</CardDescription>
                </div>
                {canEditProfile && (
                  <Button
                    variant={isEditing ? "outline" : "default"}
                    onClick={() => {
                      reset(toProfileForm(foundation));
                      setIsEditing(!isEditing);
                    }}
                  >
                    {isEditing ? (
                      "Batal"
                    ) : (
                      <>
                        <Edit className="mr-2 h-4 w-4" /> Edit
                      </>
                    )}
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {isEditing && canEditProfile ? (
                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="name">Nama Yayasan</Label>
                        <Input id="name" {...register("name")} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="legalName">Nama Badan Hukum</Label>
                        <Input id="legalName" {...register("legalName")} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="taxId">NPWP</Label>
                        <Input id="taxId" {...register("taxId")} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">Telepon</Label>
                        <Input id="phone" {...register("phone")} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" {...register("email")} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="website">Website</Label>
                        <Input id="website" {...register("website")} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="foundingDate">Tanggal Berdiri</Label>
                        <Input
                          id="foundingDate"
                          type="date"
                          {...register("foundingDate")}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="address">Alamat</Label>
                      <Textarea id="address" {...register("address")} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vision">Visi</Label>
                      <Textarea id="vision" {...register("vision")} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mission">Misi</Label>
                      <Textarea
                        id="mission"
                        {...register("mission")}
                        rows={4}
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="submit"
                        disabled={updateFoundation.isPending}
                      >
                        {updateFoundation.isPending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        <Save className="mr-2 h-4 w-4" />
                        Simpan
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-6">
                    {/* Logo and Basic Info */}
                    <div className="flex items-start gap-6">
                      <div className="h-24 w-24 rounded-lg bg-muted flex items-center justify-center">
                        <Building2 className="h-12 w-12 text-muted-foreground" />
                      </div>
                      <div className="flex-1">
                        <h2 className="text-2xl font-bold">
                          {foundation?.name || "-"}
                        </h2>
                        <p className="text-muted-foreground">
                          {foundation?.legalName || "-"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-4 text-sm">
                          <span className="flex items-center gap-1">
                            <FileText className="h-4 w-4" />
                            NPWP {foundation?.taxId || "-"}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {foundation?.foundingDate
                              ? format(
                                  new Date(foundation.foundingDate),
                                  "d MMMM yyyy",
                                  { locale: id },
                                )
                              : "-"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Contact Info */}
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-3">
                        <h3 className="font-semibold">Kontak</h3>
                        <div className="space-y-2 text-sm">
                          <p className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            {foundation?.phone || "-"}
                          </p>
                          <p className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            {foundation?.email || "-"}
                          </p>
                          {foundation?.website && (
                            <p className="flex items-center gap-2">
                              <Globe className="h-4 w-4 text-muted-foreground" />
                              <a
                                href={foundation.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                              >
                                {foundation.website}
                              </a>
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="space-y-3">
                        <h3 className="font-semibold">Alamat</h3>
                        <p className="flex items-start gap-2 text-sm">
                          <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                          <span>{foundation?.address || "-"}</span>
                        </p>
                      </div>
                    </div>

                    {/* Vision & Mission */}
                    {(foundation?.vision || foundation?.mission) && (
                      <div className="grid gap-4 md:grid-cols-2">
                        {foundation?.vision && (
                          <div className="space-y-2">
                            <h3 className="font-semibold">Visi</h3>
                            <p className="text-sm text-muted-foreground">
                              {foundation.vision}
                            </p>
                          </div>
                        )}
                        {foundation?.mission && (
                          <div className="space-y-2">
                            <h3 className="font-semibold">Misi</h3>
                            <p className="text-sm text-muted-foreground whitespace-pre-line">
                              {foundation.mission}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold">Dokumen Yayasan</h2>
                <p className="text-sm text-muted-foreground">
                  Kelola dokumen legalitas dan perizinan
                </p>
              </div>
              <Button asChild>
                <Link href="/foundation/documents/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Tambah Dokumen
                </Link>
              </Button>
            </div>

            {/* Expiring Documents Alert */}
            {documents?.filter((d) => {
              const status = getDocumentStatus(d.expiryDate);
              return (
                status?.status === "expired" || status?.status === "expiring"
              );
            }).length ? (
              <Card className="border-yellow-500">
                <CardContent className="py-4">
                  <div className="flex items-center gap-2 text-yellow-600">
                    <AlertTriangle className="h-5 w-5" />
                    <span className="font-medium">
                      Terdapat dokumen yang kadaluarsa atau akan segera habis
                      masa berlakunya
                    </span>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama Dokumen</TableHead>
                    <TableHead>Jenis</TableHead>
                    <TableHead>Tanggal Kadaluarsa</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents?.length ? (
                    documents.map((doc) => {
                      const status = getDocumentStatus(doc.expiryDate);
                      return (
                        <TableRow key={doc.id}>
                          <TableCell className="font-medium">
                            {doc.name}
                          </TableCell>
                          <TableCell>
                            {DOCUMENT_TYPE_LABELS[doc.type as DocumentType]}
                          </TableCell>
                          <TableCell>
                            {doc.expiryDate
                              ? safeFormat(
                                  new Date(doc.expiryDate),
                                  "d MMM yyyy",
                                  {
                                    locale: id,
                                  },
                                )
                              : "-"}
                          </TableCell>
                          <TableCell>
                            {status ? (
                              <Badge variant={status.variant}>
                                {status.label}
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Permanen</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button variant="ghost" size="icon" asChild>
                                <a
                                  href={authFileUrl(doc.fileUrl)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Eye className="h-4 w-4" />
                                </a>
                              </Button>
                              <Button variant="ghost" size="icon" asChild>
                                <a href={authFileUrl(doc.fileUrl)} download>
                                  <Download className="h-4 w-4" />
                                </a>
                              </Button>
                              <Button variant="ghost" size="icon" asChild>
                                <Link
                                  href={`/foundation/documents/${doc.id}/edit`}
                                >
                                  <Edit className="h-4 w-4" />
                                </Link>
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon">
                                    <Trash2 className="h-4 w-4 text-red-500" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      Hapus Dokumen?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Tindakan ini tidak dapat dibatalkan.
                                      Dokumen akan dihapus secara permanen.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Batal</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() =>
                                        handleDeleteDocument(doc.id)
                                      }
                                    >
                                      Hapus
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Belum ada dokumen
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Organs Tab — Pembina, Pengurus and Pengawas who hold office */}
          <TabsContent value="board" className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Organ Yayasan</h2>
                <p className="text-sm text-muted-foreground">
                  Pembina, Pengurus, dan Pengawas yang sedang menjabat
                </p>
              </div>
              <Button asChild>
                <Link href="/foundation/board/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Tambah
                </Link>
              </Button>
            </div>

            <BoardOrgans
              members={boardMembers ?? []}
              onDelete={handleDeleteBoardMember}
            />
          </TabsContent>

          {/* Financial Tab */}
          <TabsContent value="financial" className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold">Ringkasan Keuangan</h2>
              <p className="text-sm text-muted-foreground">
                Overview keuangan yayasan bulan ini
              </p>
            </div>

            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Pemasukan Bulan Ini
                  </CardTitle>
                  <TrendingUp className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">
                    {formatCurrency(
                      financialSummary?.currentMonth?.revenue || 0,
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Bulan lalu:{" "}
                    {formatCurrency(financialSummary?.lastMonth?.revenue || 0)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Pengeluaran Bulan Ini
                  </CardTitle>
                  <TrendingDown className="h-4 w-4 text-red-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600">
                    {formatCurrency(
                      financialSummary?.currentMonth?.expense || 0,
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Bulan lalu:{" "}
                    {formatCurrency(financialSummary?.lastMonth?.expense || 0)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Saldo Bersih
                  </CardTitle>
                  <Banknote className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div
                    className={`text-2xl font-bold ${(financialSummary?.currentMonth?.net || 0) >= 0 ? "text-green-600" : "text-red-600"}`}
                  >
                    {formatCurrency(financialSummary?.currentMonth?.net || 0)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Selisih pemasukan dan pengeluaran
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Charts Row */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* Expense Composition Pie Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Komposisi Pengeluaran</CardTitle>
                  <CardDescription>
                    Distribusi pengeluaran berdasarkan kategori
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    {financialSummary?.expenseComposition?.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={financialSummary.expenseComposition}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            outerRadius={100}
                            fill="#8884d8"
                            dataKey="value"
                            nameKey="name"
                          >
                            {financialSummary.expenseComposition.map(
                              (
                                entry: { name: string; value: number },
                                index: number,
                              ) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={COLORS[index % COLORS.length]}
                                />
                              ),
                            )}
                          </Pie>
                          <Tooltip
                            formatter={(value: any) => formatCurrency(value)}
                          />
                          <Legend
                            layout="horizontal"
                            verticalAlign="bottom"
                            align="center"
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        Belum ada data pengeluaran
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Revenue vs Expense Bar Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Pemasukan vs Pengeluaran per Unit</CardTitle>
                  <CardDescription>
                    Perbandingan keuangan per unit pendidikan
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    {financialSummary?.byUnit?.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={financialSummary.byUnit}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="unitName"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) =>
                              `${(value / 1000000).toFixed(0)}jt`
                            }
                          />
                          <Tooltip
                            formatter={(value: any) => formatCurrency(value)}
                          />
                          <Legend />
                          <Bar
                            dataKey="revenue"
                            name="Pemasukan"
                            fill="#22c55e"
                            radius={[4, 4, 0, 0]}
                          />
                          <Bar
                            dataKey="expense"
                            name="Pengeluaran"
                            fill="#ef4444"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        Belum ada data transaksi
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Unit Breakdown Table */}
            <Card>
              <CardHeader>
                <CardTitle>Rincian per Unit</CardTitle>
                <CardDescription>
                  Ringkasan keuangan berdasarkan unit pendidikan
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nama Unit</TableHead>
                      <TableHead className="text-right">Pemasukan</TableHead>
                      <TableHead className="text-right">Pengeluaran</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {financialSummary?.units?.length ? (
                      financialSummary.units.map((unit: any) => (
                        <TableRow key={unit.unitId}>
                          <TableCell className="font-medium">
                            {unit.unitName}
                          </TableCell>
                          <TableCell className="text-right text-green-600">
                            {formatCurrency(unit.revenue)}
                          </TableCell>
                          <TableCell className="text-right text-red-600">
                            {formatCurrency(unit.expense)}
                          </TableCell>
                          <TableCell className="text-right font-bold">
                            {formatCurrency(unit.netIncome)}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="text-center py-8 text-muted-foreground"
                        >
                          Belum ada data transaksi
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

export default function FoundationPage() {
  return (
    <Suspense fallback={null}>
      <FoundationPageContent />
    </Suspense>
  );
}
