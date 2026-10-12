"use client";
import { MainLayout } from "@/components/layout";

import { useState } from "react";
import { safeFormat } from "@/lib/date";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  Mic2,
  Calendar,
  Users,
  Trophy,
  Plus,
  Search,
  Filter,
  Eye,
  Edit,
  Trash2,
  CheckCircle,
  Clock,
  XCircle,
  BarChart3,
  TrendingUp,
  Star,
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
import { Progress } from "@/components/ui/progress";
import {
  useMuhadhorohList,
  useUpcomingMuhadhoroh,
  useMuhadhorohStatistics,
  useTopPerformers,
  getStatusColor,
  getStatusLabel,
  getGradeColor,
  getLanguageLabel,
  formatDuration,
  MuhadhorohStatus,
} from "@/hooks/use-muhadhoroh";

function MuhadhorohPageContent() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<MuhadhorohStatus | "ALL">(
    "ALL",
  );
  const [languageFilter, setLanguageFilter] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);

  // No unitId: the API decides which santri the reader reaches — their own
  // unit's, or every unit's for the pesantren's ustadz, musyrif and muhafidz,
  // whose own unit is the pesantren and holds none of the schools' santri.
  const { data: listData, isLoading: isLoadingList } = useMuhadhorohList({
    page: currentPage,
    limit: 10,
    status: statusFilter === "ALL" ? undefined : statusFilter,
    language: languageFilter === "ALL" ? undefined : languageFilter,
  });

  const { data: upcomingData } = useUpcomingMuhadhoroh(undefined, 5);
  const { data: statsData } = useMuhadhorohStatistics();
  const { data: topPerformersData } = useTopPerformers(undefined, 5);

  const records = listData?.data ?? [];
  const meta = listData?.meta || {
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 1,
  };

  // Filter by search
  const filteredRecords = records.filter((record) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      record.topic?.toLowerCase().includes(query) ||
      record.student?.name.toLowerCase().includes(query) ||
      record.student?.nis.toLowerCase().includes(query)
    );
  });

  const stats = {
    total: statsData?.total ?? 0,
    byStatus: statsData?.byStatus ?? [],
    byLanguage: statsData?.byLanguage ?? [],
    averages: statsData?.averages ?? {
      content: 0,
      delivery: 0,
      language: 0,
      total: 0,
    },
  };

  const topPerformers = topPerformersData ?? [];

  const upcomingRecords = upcomingData ?? [];

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Mic2 className="h-8 w-8 text-primary" />
            Muhadhoroh
          </h1>
          <p className="text-muted-foreground mt-1">
            Manajemen latihan pidato dan public speaking santri
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Jadwalkan Muhadhoroh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Sesi</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">Semester ini</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Selesai</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.byStatus.find((s) => s.status === "COMPLETED")?.count || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {Math.round(
                ((stats.byStatus.find((s) => s.status === "COMPLETED")?.count ||
                  0) /
                  stats.total) *
                  100,
              )}
              % completion rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Terjadwal</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.byStatus.find((s) => s.status === "SCHEDULED")?.count || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Menunggu pelaksanaan
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Rata-rata Nilai
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.averages.total.toFixed(1)}
            </div>
            <p className="text-xs text-muted-foreground">Dari 100 poin</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="list" className="space-y-4">
        <TabsList>
          <TabsTrigger value="list">Daftar Muhadhoroh</TabsTrigger>
          <TabsTrigger value="upcoming">Jadwal Mendatang</TabsTrigger>
          <TabsTrigger value="statistics">Statistik</TabsTrigger>
          <TabsTrigger value="leaderboard">Peringkat</TabsTrigger>
        </TabsList>

        {/* List Tab */}
        <TabsContent value="list" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Cari santri atau topik..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <Select
                  value={statusFilter}
                  onValueChange={(v) =>
                    setStatusFilter(v as MuhadhorohStatus | "ALL")
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Semua Status</SelectItem>
                    <SelectItem value="SCHEDULED">Terjadwal</SelectItem>
                    <SelectItem value="COMPLETED">Selesai</SelectItem>
                    <SelectItem value="CANCELLED">Dibatalkan</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={languageFilter}
                  onValueChange={setLanguageFilter}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Bahasa" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Semua Bahasa</SelectItem>
                    <SelectItem value="Indonesian">Bahasa Indonesia</SelectItem>
                    <SelectItem value="Arabic">Bahasa Arab</SelectItem>
                    <SelectItem value="English">Bahasa Inggris</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Santri</TableHead>
                    <TableHead>Topik</TableHead>
                    <TableHead>Bahasa</TableHead>
                    <TableHead>Jadwal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Nilai</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRecords.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">
                            {record.student?.name}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {record.student?.nis} •{" "}
                            {record.student?.class?.name}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {record.topic}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {getLanguageLabel(record.language)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {format(
                          new Date(record.scheduledAt),
                          "dd MMM yyyy, HH:mm",
                          { locale: localeId },
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(record.status)}>
                          {getStatusLabel(record.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {record.totalScore ? (
                          <div className="flex items-center gap-2">
                            <Badge className={getGradeColor(record.grade)}>
                              {record.grade}
                            </Badge>
                            <span className="text-sm">{record.totalScore}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon">
                            <Eye className="h-4 w-4" />
                          </Button>
                          {record.status === "SCHEDULED" && (
                            <>
                              <Button variant="ghost" size="icon">
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-red-500"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-muted-foreground">
                  Menampilkan {filteredRecords.length} dari {meta.total} data
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                  >
                    Sebelumnya
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage >= meta.totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                  >
                    Selanjutnya
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Upcoming Tab */}
        <TabsContent value="upcoming" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Jadwal Muhadhoroh Mendatang</CardTitle>
              <CardDescription>
                Sesi muhadhoroh yang akan dilaksanakan
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {upcomingRecords.map((record, index) => (
                  <div
                    key={record.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <div className="font-medium">
                          {record.student?.name}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {record.topic}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge variant="outline">
                        {getLanguageLabel(record.language)}
                      </Badge>
                      <div className="text-sm text-right">
                        <div className="font-medium">
                          {safeFormat(
                            new Date(record.scheduledAt),
                            "dd MMM yyyy",
                            {
                              locale: localeId,
                            },
                          )}
                        </div>
                        <div className="text-muted-foreground">
                          {safeFormat(new Date(record.scheduledAt), "HH:mm", {
                            locale: localeId,
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Statistics Tab */}
        <TabsContent value="statistics" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Score Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Rata-rata Komponen Nilai
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Konten/Isi</span>
                    <span className="font-medium">
                      {stats.averages.content.toFixed(1)}
                    </span>
                  </div>
                  <Progress value={stats.averages.content} className="h-2" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Penyampaian</span>
                    <span className="font-medium">
                      {stats.averages.delivery.toFixed(1)}
                    </span>
                  </div>
                  <Progress value={stats.averages.delivery} className="h-2" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Bahasa</span>
                    <span className="font-medium">
                      {stats.averages.language.toFixed(1)}
                    </span>
                  </div>
                  <Progress value={stats.averages.language} className="h-2" />
                </div>
              </CardContent>
            </Card>

            {/* Language Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>Distribusi Bahasa</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {stats.byLanguage.map((item) => (
                    <div
                      key={item.language}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-3 h-3 rounded-full ${
                            item.language === "Indonesian"
                              ? "bg-red-500"
                              : item.language === "Arabic"
                                ? "bg-green-500"
                                : "bg-blue-500"
                          }`}
                        />
                        <span>{getLanguageLabel(item.language)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.count}</span>
                        <span className="text-muted-foreground text-sm">
                          ({Math.round((item.count / stats.total) * 100)}%)
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Leaderboard Tab */}
        <TabsContent value="leaderboard" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-yellow-500" />
                Top Performers
              </CardTitle>
              <CardDescription>
                Santri dengan nilai rata-rata terbaik
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {topPerformers.map((performer, index) => (
                  <div
                    key={performer.studentId}
                    className={`flex items-center justify-between p-4 rounded-lg ${
                      index === 0
                        ? "bg-yellow-50 border border-yellow-200"
                        : index === 1
                          ? "bg-gray-50 border border-gray-200"
                          : index === 2
                            ? "bg-orange-50 border border-orange-200"
                            : "border"
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full font-bold ${
                          index === 0
                            ? "bg-yellow-500 text-white"
                            : index === 1
                              ? "bg-gray-400 text-white"
                              : index === 2
                                ? "bg-orange-500 text-white"
                                : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {index + 1}
                      </div>
                      <div>
                        <div className="font-medium">{performer.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {performer.nis} • {performer.class}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1">
                        <Star className="h-4 w-4 text-yellow-500" />
                        <span className="font-bold text-lg">
                          {performer.averageScore.toFixed(1)}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {performer.totalSessions} sesi
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function MuhadhorohPageWithShell() {
  return (
    <MainLayout>
      <MuhadhorohPageContent />
    </MainLayout>
  );
}
