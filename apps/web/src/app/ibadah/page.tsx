"use client";

import { useState } from "react";
import { safeFormat } from "@/lib/date";
import Link from "next/link";
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
} from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  Sparkles,
  Plus,
  Eye,
  Pencil,
  Trash2,
  Calendar as CalendarIcon,
  Filter,
  Trophy,
  Target,
  CheckCircle,
  Clock,
  Flame,
  Star,
  Users,
  BarChart3,
  Settings,
} from "lucide-react";
import { toast } from "sonner";

import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useIbadahRecords,
  useIbadahTargets,
  useIbadahLeaderboard,
  useDeleteIbadahRecord,
  useDeleteIbadahTarget,
  IBADAH_CATEGORIES,
  LEADERBOARD_PERIODS,
  VERIFICATION_STATUSES,
  getCategoryInfo,
  getVerificationStatusInfo,
  formatPoints,
  getStreakEmoji,
  type IbadahCategory,
  type LeaderboardPeriod,
  type VerificationStatus,
} from "@/hooks/use-ibadah";
import { useUnits } from "@/hooks/use-units";
import { cn } from "@/lib/utils";

export default function IbadahPage() {
  const [activeTab, setActiveTab] = useState("records");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [category, setCategory] = useState<string>("");
  const [verificationStatus, setVerificationStatus] = useState<string>("");
  const [selectedUnit, setSelectedUnit] = useState<string>("");
  const [leaderboardPeriod, setLeaderboardPeriod] =
    useState<LeaderboardPeriod>("WEEKLY");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [deleteRecordId, setDeleteRecordId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  // Queries
  const { data: units = [] } = useUnits({ limit: 100 });

  const { data: recordsData, isLoading: recordsLoading } = useIbadahRecords({
    page,
    limit: pageSize,
    unitId: selectedUnit || undefined,
    category: (category as IbadahCategory) || undefined,
    verificationStatus: (verificationStatus as VerificationStatus) || undefined,
    startDate: startDate ? format(startDate, "yyyy-MM-dd") : undefined,
    endDate: endDate ? format(endDate, "yyyy-MM-dd") : undefined,
  });

  const { data: targetsData, isLoading: targetsLoading } = useIbadahTargets({
    unitId: selectedUnit || undefined,
    category: (category as IbadahCategory) || undefined,
    isActive: true,
    limit: 100,
  });

  const { data: leaderboardData, isLoading: leaderboardLoading } =
    useIbadahLeaderboard({
      unitId: selectedUnit || units[0]?.id || "",
      periodType: leaderboardPeriod,
      limit: 10,
    });

  // Mutations
  const deleteRecord = useDeleteIbadahRecord();
  const deleteTarget = useDeleteIbadahTarget();

  const records = recordsData?.data || [];
  const targets = targetsData?.data || [];
  const leaderboard = leaderboardData || [];
  // The list endpoints return the pagination block as `meta.pagination`
  // (SharedPaginatedResponse), not a flat `meta`. Reading `meta.total` gave
  // `undefined`, which the footer rendered as "Showing 1 to NaN of results".
  const pagination = recordsData?.meta?.pagination;

  // Stats
  const totalRecords = pagination?.total || 0;
  const completedRecords = records.filter((r) => r.isCompleted).length;
  const verifiedRecords = records.filter(
    (r) => r.verificationStatus === "VERIFIED",
  ).length;
  const pendingRecords = records.filter(
    (r) => r.verificationStatus === "PENDING",
  ).length;

  const handleDeleteRecord = async () => {
    if (!deleteRecordId) return;
    try {
      await deleteRecord.mutateAsync(deleteRecordId);
      toast.success("Catatan ibadah berhasil dihapus");
      setDeleteRecordId(null);
    } catch {
      toast.error("Gagal menghapus catatan");
    }
  };

  const handleDeleteTarget = async () => {
    if (!deleteTargetId) return;
    try {
      await deleteTarget.mutateAsync(deleteTargetId);
      toast.success("Target ibadah berhasil dihapus");
      setDeleteTargetId(null);
    } catch {
      toast.error("Gagal menghapus target");
    }
  };

  const clearFilters = () => {
    setCategory("");
    setVerificationStatus("");
    setStartDate(undefined);
    setEndDate(undefined);
    setPage(1);
  };

  return (
    <MainLayout>
      <PageHeader
        title="Jurnal Ibadah Harian"
        description="Pantau dan kelola catatan ibadah harian santri"
        action={{
          label: "Check-in Hari Ini",
          icon: <Plus className="h-4 w-4" />,
          href: "/ibadah/check-in",
        }}
      />

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Button variant="outline" asChild>
          <Link href="/ibadah/targets">
            <Target className="h-4 w-4 mr-2" />
            Kelola Target
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/ibadah/verify">
            <CheckCircle className="h-4 w-4 mr-2" />
            Verifikasi
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/ibadah/statistics">
            <BarChart3 className="h-4 w-4 mr-2" />
            Statistik
          </Link>
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Total Catatan
              </span>
            </div>
            <p className="text-2xl font-bold">{totalRecords}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm text-muted-foreground">Selesai</span>
            </div>
            <p className="text-2xl font-bold text-green-600">
              {completedRecords}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">
                Terverifikasi
              </span>
            </div>
            <p className="text-2xl font-bold text-blue-600">
              {verifiedRecords}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-yellow-500" />
              <span className="text-sm text-muted-foreground">Pending</span>
            </div>
            <p className="text-2xl font-bold text-yellow-600">
              {pendingRecords}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="records">Catatan Ibadah</TabsTrigger>
          <TabsTrigger value="targets">Target Aktif</TabsTrigger>
          <TabsTrigger value="leaderboard">Papan Peringkat</TabsTrigger>
        </TabsList>

        {/* Records Tab */}
        <TabsContent value="records" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filter
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                <Select
                  value={selectedUnit || "all"}
                  onValueChange={(val) =>
                    setSelectedUnit(val === "all" ? "" : val)
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Pilih Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Unit</SelectItem>
                    {units.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={category || "all"}
                  onValueChange={(val) => setCategory(val === "all" ? "" : val)}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Kategori</SelectItem>
                    {IBADAH_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.icon} {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={verificationStatus || "all"}
                  onValueChange={(val) =>
                    setVerificationStatus(val === "all" ? "" : val)
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    {VERIFICATION_STATUSES.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-[180px] justify-start"
                    >
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {startDate
                        ? format(startDate, "dd MMM yyyy")
                        : "Dari Tanggal"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={startDate}
                      onSelect={setStartDate}
                      locale={localeId}
                    />
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-[180px] justify-start"
                    >
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {endDate
                        ? format(endDate, "dd MMM yyyy")
                        : "Sampai Tanggal"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={setEndDate}
                      locale={localeId}
                    />
                  </PopoverContent>
                </Popover>

                <Button variant="ghost" onClick={clearFilters}>
                  Reset Filter
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Records Table */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Santri</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Capaian</TableHead>
                    <TableHead>Poin</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recordsLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-32" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-28" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-12" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : records.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Belum ada catatan ibadah
                      </TableCell>
                    </TableRow>
                  ) : (
                    records.map((record) => {
                      const categoryInfo = getCategoryInfo(
                        record.target?.category || "OTHER",
                      );
                      const statusInfo = getVerificationStatusInfo(
                        record.verificationStatus,
                      );
                      return (
                        <TableRow key={record.id}>
                          <TableCell>
                            {safeFormat(new Date(record.date), "dd MMM yyyy", {
                              locale: localeId,
                            })}
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">
                                {record.student?.name || "-"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {record.student?.nis} •{" "}
                                {record.student?.class?.name}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>{record.target?.name || "-"}</TableCell>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className={categoryInfo.color}
                            >
                              {categoryInfo.icon} {categoryInfo.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {record.isCompleted ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : (
                                <Clock className="h-4 w-4 text-yellow-500" />
                              )}
                              <span>{record.actualCount}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Star className="h-3 w-3 text-yellow-500" />
                              <span>
                                {record.pointsEarned + record.bonusEarned}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className={statusInfo.color}
                            >
                              {statusInfo.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" asChild>
                                <Link href={`/ibadah/records/${record.id}`}>
                                  <Eye className="h-4 w-4" />
                                </Link>
                              </Button>
                              <Button variant="ghost" size="icon" asChild>
                                <Link
                                  href={`/ibadah/records/${record.id}/edit`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Link>
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteRecordId(record.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {pagination && (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={pagination.total}
              totalPages={Math.ceil(pagination.total / pageSize)}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          )}
        </TabsContent>

        {/* Targets Tab */}
        <TabsContent value="targets" className="space-y-4">
          <div className="flex justify-between items-center">
            <Select
              value={category || "all"}
              onValueChange={(val) => setCategory(val === "all" ? "" : val)}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filter Kategori" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Kategori</SelectItem>
                {IBADAH_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.icon} {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button asChild>
              <Link href="/ibadah/targets/new">
                <Plus className="h-4 w-4 mr-2" />
                Tambah Target
              </Link>
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {targetsLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-6 w-32 mb-2" />
                    <Skeleton className="h-4 w-full mb-2" />
                    <Skeleton className="h-4 w-24" />
                  </CardContent>
                </Card>
              ))
            ) : targets.length === 0 ? (
              <Card className="col-span-full">
                <CardContent className="p-8 text-center text-muted-foreground">
                  <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Belum ada target ibadah</p>
                  <Button className="mt-4" asChild>
                    <Link href="/ibadah/targets/new">Buat Target Pertama</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              targets.map((target) => {
                const categoryInfo = getCategoryInfo(target.category);
                return (
                  <Card
                    key={target.id}
                    className="group hover:shadow-md transition-shadow"
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{categoryInfo.icon}</span>
                          <div>
                            <CardTitle className="text-base">
                              {target.name}
                            </CardTitle>
                            {target.nameAr && (
                              <p className="text-sm text-muted-foreground font-arabic">
                                {target.nameAr}
                              </p>
                            )}
                          </div>
                        </div>
                        <Badge
                          variant="secondary"
                          className={categoryInfo.color}
                        >
                          {categoryInfo.label}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {target.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {target.description}
                        </p>
                      )}
                      <div className="flex items-center justify-between text-sm">
                        <span>
                          Target: {target.targetCount}{" "}
                          {target.targetUnit.toLowerCase()}
                        </span>
                        <div className="flex items-center gap-1 text-yellow-600">
                          <Star className="h-4 w-4" />
                          <span>{target.points} poin</span>
                        </div>
                      </div>
                      {target.bonusPoints > 0 && (
                        <p className="text-xs text-green-600">
                          + {target.bonusPoints} bonus jika istiqomah
                        </p>
                      )}
                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="outline"
                          size="sm"
                          asChild
                          className="flex-1"
                        >
                          <Link href={`/ibadah/targets/${target.id}/edit`}>
                            <Pencil className="h-3 w-3 mr-1" />
                            Edit
                          </Link>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setDeleteTargetId(target.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </TabsContent>

        {/* Leaderboard Tab */}
        <TabsContent value="leaderboard" className="space-y-4">
          <div className="flex justify-between items-center">
            <Select
              value={leaderboardPeriod}
              onValueChange={(v) =>
                setLeaderboardPeriod(v as LeaderboardPeriod)
              }
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Pilih Periode" />
              </SelectTrigger>
              <SelectContent>
                {LEADERBOARD_PERIODS.map((period) => (
                  <SelectItem key={period.value} value={period.value}>
                    {period.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedUnit} onValueChange={setSelectedUnit}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Pilih Unit" />
              </SelectTrigger>
              <SelectContent>
                {units.map((unit) => (
                  <SelectItem key={unit.id} value={unit.id}>
                    {unit.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-yellow-500" />
                <CardTitle>Papan Peringkat</CardTitle>
              </div>
              <CardDescription>
                {LEADERBOARD_PERIODS.find((p) => p.value === leaderboardPeriod)
                  ?.label || "Periode"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {leaderboardLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1">
                        <Skeleton className="h-4 w-32 mb-1" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                      <Skeleton className="h-6 w-16" />
                    </div>
                  ))}
                </div>
              ) : leaderboard.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Trophy className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Belum ada data peringkat</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {leaderboard.map((entry, index) => {
                    const rank = index + 1;
                    const isTop3 = rank <= 3;
                    const rankColors = {
                      1: "bg-yellow-100 text-yellow-800 border-yellow-300",
                      2: "bg-gray-100 text-gray-800 border-gray-300",
                      3: "bg-orange-100 text-orange-800 border-orange-300",
                    };
                    const rankEmoji = { 1: "🥇", 2: "🥈", 3: "🥉" };

                    return (
                      <div
                        key={entry.id}
                        className={cn(
                          "flex items-center gap-4 p-3 rounded-lg transition-colors",
                          isTop3 ? "bg-muted/50" : "hover:bg-muted/30",
                        )}
                      >
                        <div
                          className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center font-bold",
                            isTop3
                              ? rankColors[rank as keyof typeof rankColors]
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {isTop3
                            ? rankEmoji[rank as keyof typeof rankEmoji]
                            : rank}
                        </div>

                        <Avatar className="h-10 w-10">
                          <AvatarImage src={entry.student?.avatar} />
                          <AvatarFallback>
                            {entry.student?.name?.charAt(0) || "?"}
                          </AvatarFallback>
                        </Avatar>

                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {entry.student?.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {entry.student?.class?.name} • {entry.student?.nis}
                          </p>
                        </div>

                        <div className="text-right">
                          <div className="flex items-center gap-1 text-lg font-bold">
                            <Star className="h-4 w-4 text-yellow-500" />
                            {formatPoints(entry.totalPoints)}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Flame className="h-3 w-3 text-orange-500" />
                            {entry.streakDays} hari{" "}
                            {getStreakEmoji(entry.streakDays)}
                          </div>
                        </div>

                        <div className="hidden md:block w-24">
                          <Progress
                            value={entry.completionRate}
                            className="h-2"
                          />
                          <p className="text-xs text-muted-foreground text-center mt-1">
                            {entry.completionRate.toFixed(0)}%
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Record Dialog */}
      <ConfirmDialog
        open={!!deleteRecordId}
        onOpenChange={() => setDeleteRecordId(null)}
        title="Hapus Catatan Ibadah"
        description="Apakah Anda yakin ingin menghapus catatan ini? Tindakan ini tidak dapat dibatalkan."
        confirmLabel="Hapus"
        onConfirm={handleDeleteRecord}
        isLoading={deleteRecord.isPending}
        variant="destructive"
      />

      {/* Delete Target Dialog */}
      <ConfirmDialog
        open={!!deleteTargetId}
        onOpenChange={() => setDeleteTargetId(null)}
        title="Hapus Target Ibadah"
        description="Apakah Anda yakin ingin menghapus target ini? Semua catatan terkait target ini juga akan terpengaruh."
        confirmLabel="Hapus"
        onConfirm={handleDeleteTarget}
        isLoading={deleteTarget.isPending}
        variant="destructive"
      />
    </MainLayout>
  );
}
