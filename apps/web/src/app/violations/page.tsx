"use client";
import { MainLayout } from "@/components/layout";
// Force HMR Rebuild
import { useState } from "react";
import { safeFormat } from "@/lib/date";
import Link from "next/link";

import { id as localeId } from "date-fns/locale";
import {
  Plus,
  Search,
  AlertTriangle,
  Eye,
  Trash2,
  Filter,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Pagination } from "@/components/shared/pagination";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { toast } from "sonner";
import {
  useViolations,
  useViolationTypes,
  useDeleteViolation,
  useDeleteViolationType,
  useViolationSummary,
  VIOLATION_CATEGORIES,
  ViolationCategory,
} from "@/hooks/use-violations";

function getCategoryBadge(category: ViolationCategory) {
  const cat = VIOLATION_CATEGORIES.find((c) => c.value === category);
  return (
    <Badge variant="outline" className={cat?.color}>
      {cat?.label || category}
    </Badge>
  );
}

function ViolationsPageContent() {
  const [activeTab, setActiveTab] = useState<"violations" | "types">(
    "violations",
  );
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const { data: violationsData, isLoading: violationsLoading } = useViolations({
    page,
    limit: 10,
    category:
      categoryFilter !== "all"
        ? (categoryFilter as ViolationCategory)
        : undefined,
  });

  const { data: violationTypes, isLoading: typesLoading } = useViolationTypes();
  const { data: summaryData } = useViolationSummary();

  const deleteViolationMutation = useDeleteViolation();
  const deleteTypeMutation = useDeleteViolationType();

  const handleDeleteViolation = async (id: string) => {
    try {
      await deleteViolationMutation.mutateAsync(id);
      toast.success("Pelanggaran berhasil dihapus");
    } catch {
      toast.error("Gagal menghapus pelanggaran");
    }
  };

  const handleDeleteType = async (id: string) => {
    try {
      await deleteTypeMutation.mutateAsync(id);
      toast.success("Jenis pelanggaran berhasil dihapus");
    } catch {
      toast.error("Gagal menghapus jenis pelanggaran");
    }
  };

  const filteredTypes = violationTypes?.filter(
    (type) =>
      (type.name?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (type.description?.toLowerCase().includes(search.toLowerCase()) ?? false),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pelanggaran</h1>
          <p className="text-muted-foreground">
            Kelola data pelanggaran santri
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/violations/types/new">
              <Settings className="mr-2 h-4 w-4" />
              Tambah Jenis
            </Link>
          </Button>
          <Button asChild>
            <Link href="/violations/new">
              <Plus className="mr-2 h-4 w-4" />
              Catat Pelanggaran
            </Link>
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Pelanggaran
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summaryData?.totalViolations || 0}
            </div>
          </CardContent>
        </Card>
        {VIOLATION_CATEGORIES.map((cat) => {
          const count =
            summaryData?.bySeverity?.find((c) => c.severity === cat.value)
              ?.count || 0;
          return (
            <Card key={cat.value}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {cat.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{count}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "violations" | "types")}
      >
        <TabsList>
          <TabsTrigger value="violations">Data Pelanggaran</TabsTrigger>
          <TabsTrigger value="types">Jenis Pelanggaran</TabsTrigger>
        </TabsList>

        {/* Violations Tab */}
        <TabsContent value="violations" className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Semua Kategori" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Kategori</SelectItem>
                  {VIOLATION_CATEGORIES.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Violations Table */}
          <Card>
            <CardContent className="p-0">
              {violationsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : violationsData?.data.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <AlertTriangle className="h-12 w-12 text-muted-foreground" />
                  <p className="mt-4 text-muted-foreground">
                    Belum ada data pelanggaran
                  </p>
                  <Button asChild className="mt-4">
                    <Link href="/violations/new">Catat Pelanggaran Baru</Link>
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Santri</TableHead>
                      <TableHead>Jenis Pelanggaran</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Poin</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {violationsData?.data.map((violation) => (
                      <TableRow key={violation.id}>
                        <TableCell>
                          {safeFormat(new Date(violation.date), "dd MMM yyyy", {
                            locale: localeId,
                          })}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">
                              {violation.student?.name}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {violation.student?.nis}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>{violation.violationType?.name}</TableCell>
                        <TableCell>
                          {violation.violationType &&
                            getCategoryBadge(violation.violationType.category)}
                        </TableCell>
                        <TableCell>
                          {violation.violationType?.points} poin
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="icon" asChild>
                              <Link href={`/violations/${violation.id}`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                            <ConfirmDialog
                              title="Hapus Pelanggaran"
                              description="Apakah Anda yakin ingin menghapus data pelanggaran ini?"
                              onConfirm={() =>
                                handleDeleteViolation(violation.id)
                              }
                              loading={deleteViolationMutation.isPending}
                            >
                              <Button variant="ghost" size="icon">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </ConfirmDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Pagination */}
          {violationsData && violationsData.meta.totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={violationsData.meta.totalPages}
              pageSize={violationsData.meta.limit}
              total={violationsData.meta.total}
              onPageChange={setPage}
            />
          )}
        </TabsContent>

        {/* Types Tab */}
        <TabsContent value="types" className="space-y-4">
          {/* Search */}
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cari jenis pelanggaran..."
              className="pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Types Table */}
          <Card>
            <CardContent className="p-0">
              {typesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : filteredTypes?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Settings className="h-12 w-12 text-muted-foreground" />
                  <p className="mt-4 text-muted-foreground">
                    Belum ada jenis pelanggaran
                  </p>
                  <Button asChild className="mt-4">
                    <Link href="/violations/types/new">
                      Tambah Jenis Pelanggaran
                    </Link>
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nama</TableHead>
                      <TableHead>Deskripsi</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Poin</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTypes?.map((type) => (
                      <TableRow key={type.id}>
                        <TableCell className="font-medium">
                          {type.name}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {type.description || "-"}
                        </TableCell>
                        <TableCell>{getCategoryBadge(type.category)}</TableCell>
                        <TableCell>{type.points}</TableCell>
                        <TableCell>
                          <Badge
                            variant={type.isActive ? "default" : "secondary"}
                          >
                            {type.isActive ? "Aktif" : "Nonaktif"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="icon" asChild>
                              <Link href={`/violations/types/${type.id}/edit`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                            <ConfirmDialog
                              title="Hapus Jenis Pelanggaran"
                              description="Apakah Anda yakin ingin menghapus jenis pelanggaran ini?"
                              onConfirm={() => handleDeleteType(type.id)}
                              loading={deleteTypeMutation.isPending}
                            >
                              <Button variant="ghost" size="icon">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </ConfirmDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ViolationsPageWithShell() {
  return (
    <MainLayout>
      <ViolationsPageContent />
    </MainLayout>
  );
}
