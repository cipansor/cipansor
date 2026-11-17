"use client";

import { useState } from "react";
import { safeFormat } from "@/lib/date";
import { useRouter } from "next/navigation";
import { type ColumnDef } from "@/components/shared";
import { MainLayout } from "@/components/layout";
import {
  PageHeader,
  DataTable,
  SearchInput,
  ConfirmDialog,
} from "@/components/shared";
import {
  useSimaanExams,
  useDeleteSimaan,
  SimaanExam,
  SIMAAN_TYPES,
  type SimaanTypeCode,
} from "@/hooks/use-simaan";
import { useClasses } from "@/hooks/use-classes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import {
  MoreHorizontal,
  Eye,
  Pencil,
  Trash2,
  Plus,
  BookOpen,
  CheckCircle,
  Clock,
  Play,
  XCircle,
  Calendar,
  Users,
  Award,
} from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";
import { DateRange } from "react-day-picker";
import { getEffectiveRole } from "@/lib/rbac";

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Terjadwal",
  IN_PROGRESS: "Berlangsung",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-800",
  IN_PROGRESS: "bg-yellow-100 text-yellow-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-800",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  SCHEDULED: <Calendar className="h-3 w-3" />,
  IN_PROGRESS: <Play className="h-3 w-3" />,
  COMPLETED: <CheckCircle className="h-3 w-3" />,
  CANCELLED: <XCircle className="h-3 w-3" />,
};

export default function SimaanListPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [examTypeFilter, setExamTypeFilter] = useState<SimaanTypeCode | "">("");
  const [classFilter, setClassFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: classes } = useClasses({ unitId: user?.unitId });

  const { data, isLoading } = useSimaanExams({
    page,
    limit: pageSize,
    search: search || undefined,
    status: statusFilter || undefined,
    simaanType: examTypeFilter || undefined,
    // classId not supported in filters currently
    dateFrom: dateRange?.from
      ? format(dateRange.from, "yyyy-MM-dd")
      : undefined,
    dateTo: dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : undefined,
    unitId: getEffectiveRole(user) !== "SUPER_ADMIN" ? user?.unitId : undefined,
  });

  const deleteMutation = useDeleteSimaan();

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast.success("Ujian simaan berhasil dihapus");
      setDeleteId(null);
    } catch {
      toast.error("Gagal menghapus ujian simaan");
    }
  };

  const columns: ColumnDef<SimaanExam>[] = [
    {
      accessorKey: "student",
      header: "Santri",
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          {row.original.student?.photoUrl ? (
            <img
              src={row.original.student.photoUrl}
              alt=""
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
              <span className="text-xs font-medium">
                {row.original.student?.user?.name?.[0] || "?"}
              </span>
            </div>
          )}
          <div>
            <p className="font-medium">
              {row.original.student?.user?.name || "-"}
            </p>
            <p className="text-xs text-muted-foreground">
              {row.original.student?.nis}
            </p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "examDate",
      header: "Tanggal",
      cell: ({ row }) => (
        <div>
          <p className="font-medium">
            {safeFormat(new Date(row.original.examDate), "dd MMM yyyy", {
              locale: idLocale,
            })}
          </p>
          {/* <p className="text-xs text-muted-foreground">
            {row.original.duration} menit
          </p> */}
        </div>
      ),
    },
    {
      accessorKey: "simaanType",
      header: "Jenis Ujian",
      cell: ({ row }) => (
        <Badge variant="outline" className="font-normal">
          <BookOpen className="h-3 w-3 mr-1" />
          {SIMAAN_TYPES.find((t) => t.value === row.original.simaanType)
            ?.label || row.original.simaanType}
        </Badge>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.original.status || "SCHEDULED";
        return (
          <Badge className={cn("font-normal gap-1", STATUS_COLORS[status])}>
            {STATUS_ICONS[status]}
            {STATUS_LABELS[status]}
          </Badge>
        );
      },
    },
    {
      accessorKey: "examiners",
      header: "Penguji",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{row.original.examiners?.length || 0}</span>
        </div>
      ),
    },
    {
      accessorKey: "overallScore",
      header: "Nilai",
      cell: ({ row }) => (
        <span
          className={cn(
            "font-semibold",
            row.original.overallScore
              ? row.original.overallScore >= 80
                ? "text-green-600"
                : row.original.overallScore >= 60
                  ? "text-yellow-600"
                  : "text-red-600"
              : "text-muted-foreground",
          )}
        >
          {row.original.overallScore ?? "-"}
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => router.push(`/tahfidz/simaan/${row.original.id}`)}
            >
              <Eye className="mr-2 h-4 w-4" />
              Lihat Detail
            </DropdownMenuItem>
            {(row.original.status === "SCHEDULED" || !row.original.status) && (
              <>
                <DropdownMenuItem
                  onClick={() =>
                    router.push(`/tahfidz/simaan/${row.original.id}/edit`)
                  }
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    router.push(`/tahfidz/simaan/${row.original.id}/start`)
                  }
                >
                  <Play className="mr-2 h-4 w-4" />
                  Mulai Ujian
                </DropdownMenuItem>
              </>
            )}
            {row.original.status === "IN_PROGRESS" && (
              <DropdownMenuItem
                onClick={() =>
                  router.push(`/tahfidz/simaan/${row.original.id}/score`)
                }
              >
                <Award className="mr-2 h-4 w-4" />
                Input Nilai
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {(row.original.status === "SCHEDULED" || !row.original.status) && (
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setDeleteId(row.original.id)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Hapus
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <MainLayout>
      <div className="space-y-6">
        <PageHeader
          title="Ujian Simaan"
          description="Kelola ujian simaan (tasmi') hafalan santri"
          actions={
            <Button
              onClick={() => router.push("/tahfidz/simaan/new")}
              className="transition-all hover:shadow-md hover:-translate-y-0.5"
            >
              <Plus className="mr-2 h-4 w-4" />
              Jadwalkan Simaan
            </Button>
          }
        />

        {/* Filters */}
        <div className="glass-card p-4 rounded-xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 shadow-sm border-none">
          <SearchInput
            placeholder="Cari nama santri..."
            value={search}
            onChange={setSearch}
          />

          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="bg-background/50 backdrop-blur-sm border-muted-foreground/20">
              <SelectValue placeholder="Semua Kelas/Halaqah" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Semua Kelas/Halaqah</SelectItem>
              {classes?.data?.map((cls) => (
                <SelectItem key={cls.id} value={cls.id}>
                  {cls.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={examTypeFilter}
            onValueChange={(v) => setExamTypeFilter(v as SimaanTypeCode | "")}
          >
            <SelectTrigger className="bg-background/50 backdrop-blur-sm border-muted-foreground/20">
              <SelectValue placeholder="Semua Jenis" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Semua Jenis</SelectItem>
              {SIMAAN_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="bg-background/50 backdrop-blur-sm border-muted-foreground/20">
              <SelectValue placeholder="Semua Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Semua Status</SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DatePickerWithRange date={dateRange} setDate={setDateRange} />
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="glass-card border-none bg-blue-50/50 rounded-xl p-4 transition-all hover:shadow-lg group">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-blue-600 uppercase tracking-wider">
                  Terjadwal
                </p>
                <p className="text-2xl font-bold text-blue-800 mt-1">
                  {data?.summary?.scheduled || 0}
                </p>
              </div>
              <div className="p-2 bg-blue-100 rounded-lg group-hover:scale-110 transition-transform">
                <Calendar className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </div>
          <div className="glass-card border-none bg-yellow-50/50 rounded-xl p-4 transition-all hover:shadow-lg group">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-yellow-600 uppercase tracking-wider">
                  Berlangsung
                </p>
                <p className="text-2xl font-bold text-yellow-800 mt-1">
                  {data?.summary?.inProgress || 0}
                </p>
              </div>
              <div className="p-2 bg-yellow-100 rounded-lg group-hover:scale-110 transition-transform">
                <Play className="h-6 w-6 text-yellow-600" />
              </div>
            </div>
          </div>
          <div className="glass-card border-none bg-green-50/50 rounded-xl p-4 transition-all hover:shadow-lg group">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-green-600 uppercase tracking-wider">
                  Selesai
                </p>
                <p className="text-2xl font-bold text-green-800 mt-1">
                  {data?.summary?.completed || 0}
                </p>
              </div>
              <div className="p-2 bg-green-100 rounded-lg group-hover:scale-110 transition-transform">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </div>
          <div className="glass-card border-none bg-purple-50/50 rounded-xl p-4 transition-all hover:shadow-lg group">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-purple-600 uppercase tracking-wider">
                  Rata-rata Nilai
                </p>
                <p className="text-2xl font-bold text-purple-800 mt-1">
                  {data?.summary?.averageGrade?.toFixed(1) || "-"}
                </p>
              </div>
              <div className="p-2 bg-purple-100 rounded-lg group-hover:scale-110 transition-transform">
                <Award className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Data Table */}
        <DataTable
          columns={columns}
          data={data?.data || []}
          isLoading={isLoading}
          pagination={{
            page: page,
            pageSize,
            totalPages: data?.meta?.totalPages || 0,
            total: data?.meta?.total || 0,
            onPageChange: (newPage) => setPage(newPage),
            onPageSizeChange: setPageSize,
          }}
        />

        {/* Delete Confirmation */}
        <ConfirmDialog
          open={!!deleteId}
          onOpenChange={() => setDeleteId(null)}
          title="Hapus Ujian Simaan"
          description="Apakah Anda yakin ingin menghapus ujian simaan ini? Tindakan ini tidak dapat dibatalkan."
          onConfirm={handleDelete}
          loading={deleteMutation.isPending}
        />
      </div>
    </MainLayout>
  );
}
