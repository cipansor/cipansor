"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar as CalendarIcon,
  Search,
  Filter,
  MoreHorizontal,
  Plus,
  Users,
  CheckCircle2,
  XCircle,
  FileText,
  Clock,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";

import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";

import { toast } from "sonner";
import {
  CROSS_UNIT_ROLE_CODES,
  DAILY_REPORT_STAFF_ROLE_CODES,
} from "@cipansor/shared";
import { ConfirmDialog } from "@/components/shared";
import {
  useDailyReports,
  useDeleteDailyReport,
} from "@/hooks/use-daily-report";
import { useAuthStore } from "@/stores/auth";
import { getEffectiveRole, getPrimaryRoleCode } from "@/lib/rbac";
import { getErrorMessage } from "@/lib/api-error";
import { useClasses } from "@/hooks/use-classes";
import { defaultSantriUnitId, useUnits } from "@/hooks/use-units";
import { cn } from "@/lib/utils";
import Link from "next/link";

/**
 * Laporan Harian — the one page for a child's day (decided 2026-09-27): the
 * TK guru writes for their class, the TK kepala sekolah reads, SD's teachers
 * keep it as Mutabaah Yaumiyah. The TK tree (/tk/daily-reports/*) and
 * /homeroom/daily-report answer with a permanent redirect here.
 */
export default function DailyReportPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const roleCode = getPrimaryRoleCode(user);
  // Writing is the staff's; the API decides which children (per role and
  // per child), this only hides buttons a reader could not use.
  const canWrite =
    !!roleCode && DAILY_REPORT_STAFF_ROLE_CODES.includes(roleCode);
  // Everyone works in their own unit but the super admin and the cross-unit
  // staff: the pesantren's musyrif keeps the mutabaah of santri in every
  // school, and belongs to the Pesantren unit, which holds none of them.
  const reachesEveryUnit =
    !!roleCode && CROSS_UNIT_ROLE_CODES.includes(roleCode);
  const ownUnit =
    user && getEffectiveRole(user) !== "SUPER_ADMIN" && !reachesEveryUnit
      ? (user.unitId ?? "")
      : "";
  const deleteReport = useDeleteDailyReport();
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [date, setDate] = useState<Date>(new Date());
  const [search, setSearch] = useState("");
  const [pickedUnit, setUnitId] = useState<string>("");
  const { data: unitsData } = useUnits();
  // A cross-unit reader opens on a school that has santri, not on an empty
  // list; the picker changes it.
  const unitId =
    ownUnit ||
    pickedUnit ||
    (reachesEveryUnit
      ? (defaultSantriUnitId(unitsData, user?.unitId) ?? "")
      : "");
  const [classId, setClassId] = useState<string>("");
  const [page, setPage] = useState(1);

  // Fetch data
  const { data: classesData } = useClasses({ unitId: unitId || undefined });
  const { data: reportsData, isLoading } = useDailyReports({
    page,
    limit: 20,
    search,
    unitId: unitId || undefined,
    classId: classId || undefined,
    date: date ? format(date, "yyyy-MM-dd") : undefined,
  });

  const reports = reportsData?.data || [];
  const pagination = reportsData?.meta?.pagination ?? {
    totalPages: 1,
    page: 1,
    total: 0,
  };

  // Helper to format mood
  const getMoodConfig = (mood?: string | null) => {
    switch (mood) {
      case "HAPPY":
        return {
          label: "Senang",
          color: "bg-green-100 text-green-700",
          icon: "😊",
        };
      case "SAD":
        return {
          label: "Sedih",
          color: "bg-blue-100 text-blue-700",
          icon: "😢",
        };
      case "TIRED":
        return {
          label: "Lelah",
          color: "bg-orange-100 text-orange-700",
          icon: "😴",
        };
      case "SICK":
        return { label: "Sakit", color: "bg-red-100 text-red-700", icon: "🤒" };
      case "EXCITED":
        return {
          label: "Antusias",
          color: "bg-yellow-100 text-yellow-700",
          icon: "🤩",
        };
      case "NEUTRAL":
        return {
          label: "Biasa",
          color: "bg-gray-100 text-gray-700",
          icon: "😐",
        };
      default:
        // Not recorded — saying "Biasa" would tell the wali something no one observed.
        return {
          label: "Belum diisi",
          color: "bg-transparent text-muted-foreground",
          icon: "",
        };
    }
  };

  return (
    <MainLayout>
      <PageHeader
        title="Laporan Harian"
        description="Hari santri untuk walinya: kegiatan, ibadah, makan, dan suasana hati."
        actions={
          canWrite ? (
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link href="/daily-report/check-in">
                  <Users className="mr-2 h-4 w-4" />
                  Check-in Kelas
                </Link>
              </Button>
              <Button asChild>
                <Link href="/daily-report/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Buat Laporan
                </Link>
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cari santri..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-[240px] justify-start text-left font-normal",
                    !date && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? (
                    format(date, "PPP", { locale: idLocale })
                  ) : (
                    <span>Pilih Tanggal</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => d && setDate(d)}
                  autoFocus
                />
              </PopoverContent>
            </Popover>

            {!ownUnit && (
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger className="w-[200px]" aria-label="Unit">
                  <SelectValue placeholder="Pilih Unit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Semua Unit</SelectItem>
                  {unitsData?.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {unit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select
              value={classId}
              onValueChange={setClassId}
              disabled={!unitId || unitId === "ALL"}
            >
              <SelectTrigger className="w-[200px]" aria-label="Kelas">
                <SelectValue placeholder="Pilih Kelas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua Kelas</SelectItem>
                {classesData?.data?.map((cls) => (
                  <SelectItem key={cls.id} value={cls.id}>
                    {cls.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Reports List */}
      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : reports.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>Belum ada laporan harian untuk tanggal ini.</p>
              {canWrite && (
                <Button variant="link" asChild className="mt-2">
                  <Link href="/daily-report/new">Buat Laporan Baru</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {reports.map((report: any) => {
              const mood = getMoodConfig(report.mood);

              return (
                <Card
                  key={report.id}
                  role="article"
                  aria-label={`Laporan ${report.student?.user?.name ?? ""}`}
                  className="hover:shadow-md transition-shadow"
                >
                  <CardHeader className="p-4 pb-2">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarImage src={report.student?.photoUrl} />
                          <AvatarFallback>
                            {report.student?.user?.name?.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <CardTitle className="text-base">
                            {report.student?.user?.name}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            {report.student?.nis}
                          </CardDescription>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`Aksi laporan ${report.student?.user?.name ?? ""}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/daily-report/${report.id}`}>
                              Lihat Detail
                            </Link>
                          </DropdownMenuItem>
                          {canWrite && (
                            <>
                              <DropdownMenuItem asChild>
                                <Link href={`/daily-report/${report.id}/edit`}>
                                  Ubah
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onSelect={() =>
                                  setDeleting({
                                    id: report.id,
                                    name: report.student?.user?.name ?? "",
                                  })
                                }
                              >
                                Hapus
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 pt-2 space-y-3">
                    <Separator />
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground text-xs">
                          Mood:
                        </span>
                        <Badge
                          variant="outline"
                          className={cn("text-xs font-normal", mood.color)}
                        >
                          {mood.icon
                            ? `${mood.icon} ${mood.label}`
                            : mood.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 justify-end">
                        <span className="text-muted-foreground text-xs">
                          Orang Tua:
                        </span>
                        {report.parentReadAt ? (
                          <Badge
                            variant="secondary"
                            className="bg-green-100 text-green-700 hover:bg-green-100 text-xs gap-1"
                          >
                            <CheckCircle2 className="h-3 w-3" /> Dibaca
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="bg-gray-100 text-gray-500 hover:bg-gray-100 text-xs gap-1"
                          >
                            <Clock className="h-3 w-3" /> Belum
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Activity Snippet */}
                    <div className="bg-muted/30 p-2 rounded text-xs text-muted-foreground line-clamp-2">
                      {report.activitiesSummary ||
                        "Tidak ada ringkasan aktivitas."}
                    </div>

                    {/* Prayer Indicators (New Feature) */}
                    <div className="flex gap-1 justify-center pt-1">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-1",
                          report.sholatDhuha
                            ? "bg-green-50 border-green-200 text-green-700"
                            : "opacity-50",
                        )}
                      >
                        Dhuha
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-1",
                          report.sholatDzuhur
                            ? "bg-green-50 border-green-200 text-green-700"
                            : "opacity-50",
                        )}
                      >
                        Dzuhur
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-1",
                          report.sholatAshar
                            ? "bg-green-50 border-green-200 text-green-700"
                            : "opacity-50",
                        )}
                      >
                        Ashar
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-6">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="flex items-center text-sm px-2">
              Halaman {page} dari {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page === pagination.totalPages}
              onClick={() =>
                setPage((p) => Math.min(pagination.totalPages, p + 1))
              }
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus laporan harian?"
        description={`Laporan ${deleting?.name ?? ""} tanggal ini dihapus, dan walinya tidak lagi bisa membacanya.`}
        confirmLabel="Hapus"
        cancelLabel="Batal"
        variant="destructive"
        isLoading={deleteReport.isPending}
        onConfirm={() => {
          if (!deleting) return;
          deleteReport.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Laporan harian dihapus");
              setDeleting(null);
            },
            onError: (error) => toast.error(getErrorMessage(error)),
          });
        }}
      />
    </MainLayout>
  );
}
