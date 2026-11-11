"use client";
import { useState } from "react";
import { safeFormat } from "@/lib/date";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { id as localeId } from "date-fns/locale";
import {
  CalendarDays,
  Plus,
  Eye,
  Pencil,
  Trash2,
  CheckCircle,
  Circle,
} from "lucide-react";
import { toast } from "sonner";

import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth";
import { getActiveRoleCode } from "@/lib/rbac";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  useAcademicYears,
  useDeleteAcademicYear,
  useActivateAcademicYear,
} from "@/hooks/use-academic-years";
import { useUnits } from "@/hooks/use-units";

export default function AcademicYearsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [unitId, setUnitId] = useState<string>("ALL");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [activateId, setActivateId] = useState<string | null>(null);

  const { data: units } = useUnits();
  const { data: academicYearsData, isLoading } = useAcademicYears({
    page,
    limit: pageSize,
    unitId: unitId !== "ALL" ? unitId : undefined,
  });

  // Creating, changing, activating and deleting a year are Super Admin's
  // (the API guards every write with `isSuperAdmin`); a unit admin reads.
  const user = useAuthStore((state) => state.user);
  const isSuperAdmin = getActiveRoleCode(user) === "SUPER_ADMIN";
  const deleteAcademicYear = useDeleteAcademicYear();
  const activateAcademicYear = useActivateAcademicYear();

  const academicYears = academicYearsData?.data || [];
  const pagination = academicYearsData?.meta;

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      await deleteAcademicYear.mutateAsync(deleteId);
      toast.success("Tahun ajaran berhasil dihapus");
      setDeleteId(null);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Gagal menghapus tahun ajaran";
      toast.error(errorMessage);
    }
  };

  const handleActivate = async () => {
    if (!activateId) return;

    try {
      await activateAcademicYear.mutateAsync(activateId);
      toast.success("Tahun ajaran berhasil diaktifkan");
      setActivateId(null);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Gagal mengaktifkan tahun ajaran";
      toast.error(errorMessage);
    }
  };

  return (
    <MainLayout>
      <PageHeader
        title="Tahun Ajaran"
        description="Kelola tahun ajaran untuk setiap unit pendidikan"
        action={
          isSuperAdmin
            ? {
                label: "Tambah Tahun Ajaran",
                icon: <Plus className="h-4 w-4" />,
                href: "/academic-years/new",
              }
            : undefined
        }
      />

      {/* Filter */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="Semua Unit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua Unit</SelectItem>
                {units?.map((unit) => (
                  <SelectItem key={unit.id} value={unit.id}>
                    {unit.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {unitId !== "ALL" && (
              <Button variant="ghost" onClick={() => setUnitId("ALL")}>
                Reset
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Tanggal Mulai</TableHead>
                <TableHead>Tanggal Selesai</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[150px]">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                    </div>
                  </TableCell>
                </TableRow>
              ) : academicYears.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <CalendarDays className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">
                      Tidak ada tahun ajaran
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                academicYears.map((ay) => (
                  <TableRow key={ay.id}>
                    <TableCell className="font-medium">{ay.name}</TableCell>
                    <TableCell>{ay.unit?.name || "-"}</TableCell>
                    <TableCell>
                      {safeFormat(new Date(ay.startDate), "d MMMM yyyy", {
                        locale: localeId,
                      })}
                    </TableCell>
                    <TableCell>
                      {safeFormat(new Date(ay.endDate), "d MMMM yyyy", {
                        locale: localeId,
                      })}
                    </TableCell>
                    <TableCell>
                      {ay.isActive ? (
                        <Badge
                          variant="default"
                          className="bg-green-100 text-green-800"
                        >
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Aktif
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          <Circle className="h-3 w-3 mr-1" />
                          Tidak Aktif
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/academic-years/${ay.id}`}>
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                        {isSuperAdmin && (
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/academic-years/${ay.id}/edit`}>
                              <Pencil className="h-4 w-4" />
                            </Link>
                          </Button>
                        )}
                        {isSuperAdmin && !ay.isActive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActivateId(ay.id)}
                            title="Aktifkan"
                          >
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          </Button>
                        )}
                        {isSuperAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteId(ay.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {pagination && (
        <div className="mt-4">
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.limit}
            total={pagination.total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Hapus Tahun Ajaran"
        description="Apakah Anda yakin ingin menghapus tahun ajaran ini? Semua data terkait (kelas, nilai, dll) juga akan terhapus."
        onConfirm={handleDelete}
        isLoading={deleteAcademicYear.isPending}
      />

      <ConfirmDialog
        open={!!activateId}
        onOpenChange={(open) => !open && setActivateId(null)}
        title="Aktifkan Tahun Ajaran"
        description="Mengaktifkan tahun ajaran ini akan menonaktifkan tahun ajaran lain yang aktif di unit yang sama. Lanjutkan?"
        confirmLabel="Aktifkan"
        onConfirm={handleActivate}
        isLoading={activateAcademicYear.isPending}
      />
    </MainLayout>
  );
}
