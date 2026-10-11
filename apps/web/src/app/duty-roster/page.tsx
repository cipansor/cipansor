"use client";
import { MainLayout } from "@/components/layout";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  CalendarDays,
  Clock,
  Users,
  CheckCircle,
  XCircle,
  AlertCircle,
  Plus,
  Filter,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Star,
  Award,
  ClipboardList,
  Settings,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DUTY_TYPE_LABELS,
  DutyType,
  DutyStatus,
  DutyShift,
  useDutyRosters,
  useDutyStatistics,
} from "@/hooks/use-duty-roster";

// Extended UI status for local display
type UIStatus = DutyStatus | "SCHEDULED" | "IN_PROGRESS" | "MISSED" | "EXCUSED";

const STATUS_CONFIG: Record<
  UIStatus,
  { label: string; color: string; icon: React.ReactNode }
> = {
  PENDING: {
    label: "Menunggu",
    color: "bg-gray-100 text-gray-800",
    icon: <Clock className="h-4 w-4" />,
  },
  SCHEDULED: {
    label: "Terjadwal",
    color: "bg-gray-100 text-gray-800",
    icon: <Clock className="h-4 w-4" />,
  },
  IN_PROGRESS: {
    label: "Berlangsung",
    color: "bg-blue-100 text-blue-800",
    icon: <Clock className="h-4 w-4" />,
  },
  COMPLETED: {
    label: "Selesai",
    color: "bg-green-100 text-green-800",
    icon: <CheckCircle className="h-4 w-4" />,
  },
  ABSENT: {
    label: "Tidak Hadir",
    color: "bg-red-100 text-red-800",
    icon: <XCircle className="h-4 w-4" />,
  },
  MISSED: {
    label: "Tidak Hadir",
    color: "bg-red-100 text-red-800",
    icon: <XCircle className="h-4 w-4" />,
  },
  SUBSTITUTED: {
    label: "Digantikan",
    color: "bg-yellow-100 text-yellow-800",
    icon: <AlertCircle className="h-4 w-4" />,
  },
  EXCUSED: {
    label: "Izin",
    color: "bg-yellow-100 text-yellow-800",
    icon: <AlertCircle className="h-4 w-4" />,
  },
};

const SHIFT_CONFIG: Record<DutyShift, { label: string; color: string }> = {
  MORNING: { label: "Pagi", color: "bg-amber-100 text-amber-800" },
  AFTERNOON: { label: "Siang", color: "bg-orange-100 text-orange-800" },
  EVENING: { label: "Sore/Malam", color: "bg-purple-100 text-purple-800" },
};

const DAYS_OF_WEEK = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];

function DutyRosterPageContent() {
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [filterShift, setFilterShift] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("today");

  // Fetch rosters for selected date
  const { data: rostersData, isLoading: isLoadingRosters } = useDutyRosters({
    date: selectedDate,
  });

  // Fetch statistics for report view
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  const { data: statisticsData, isLoading: isLoadingStats } = useDutyStatistics(
    {
      startDate: startOfMonth.toISOString().split("T")[0],
      endDate: new Date().toISOString().split("T")[0],
    },
  );

  // Transform API data to UI format
  const todayRosters = useMemo(() => {
    if (!rostersData?.data) return [];
    return rostersData.data.map((roster) => ({
      id: roster.id,
      date: roster.date,
      dayOfWeek: new Date(roster.date).getDay(),
      dutyType: roster.dutyType,
      location: roster.location,
      shift: roster.shift,
      startTime: roster.startTime,
      endTime: roster.endTime,
      students:
        roster.assignments?.map((a) => ({
          id: a.id,
          studentId: a.student.id,
          student: a.student,
          status: a.status as UIStatus,
          checkInTime: a.completedAt?.slice(11, 16),
          checkOutTime: undefined,
          rating: undefined,
          points: undefined,
        })) || [],
      supervisor: roster.supervisor,
    }));
  }, [rostersData]);

  // Transform statistics for report
  const report = useMemo(
    () => ({
      totalAssignments: statisticsData?.totalAssignments || 0,
      completed: statisticsData?.completed || 0,
      missed: statisticsData?.absent || 0,
      excused: 0,
      averageRating: 0,
      topPerformers: [],
    }),
    [statisticsData],
  );

  const filteredRosters =
    filterShift === "all"
      ? todayRosters
      : todayRosters.filter((r) => r.shift === filterShift);

  const getCompletionRate = (roster: (typeof todayRosters)[0]) => {
    const completed = roster.students.filter(
      (s) => s.status === "COMPLETED",
    ).length;
    return (completed / roster.students.length) * 100;
  };

  const navigateDate = (direction: "prev" | "next") => {
    const date = new Date(selectedDate);
    date.setDate(date.getDate() + (direction === "next" ? 1 : -1));
    setSelectedDate(date.toISOString().split("T")[0]);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // Loading state
  if (isLoadingRosters && isLoadingStats) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <ClipboardList className="h-8 w-8 text-primary" />
            Piket Santri
          </h1>
          <p className="text-muted-foreground">
            Kelola jadwal dan verifikasi piket harian santri
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/duty-roster/new">
            <Button variant="outline">
              <Settings className="h-4 w-4 mr-2" />
              Kelola Jadwal
            </Button>
          </Link>
          <Link href="/duty-roster/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Buat Piket
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/20">
                <ClipboardList className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{report.totalAssignments}</p>
                <p className="text-sm text-muted-foreground">Total Tugas</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-green-100 dark:bg-green-900/20">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{report.completed}</p>
                <p className="text-sm text-muted-foreground">Selesai</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/20">
                <XCircle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{report.missed}</p>
                <p className="text-sm text-muted-foreground">Tidak Hadir</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-yellow-100 dark:bg-yellow-900/20">
                <AlertCircle className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{report.excused}</p>
                <p className="text-sm text-muted-foreground">Izin</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900/20">
                <Star className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {report.averageRating.toFixed(1)}
                </p>
                <p className="text-sm text-muted-foreground">
                  Rata-rata Rating
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="today">Jadwal Hari Ini</TabsTrigger>
          <TabsTrigger value="calendar">Kalender</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
        </TabsList>

        {/* Today's Schedule */}
        <TabsContent value="today" className="space-y-6 mt-6">
          {/* Date Navigation */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigateDate("prev")}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <div className="text-center">
                  <div className="flex items-center gap-2 justify-center">
                    <CalendarDays className="h-5 w-5 text-muted-foreground" />
                    <span className="font-medium">
                      {formatDate(selectedDate)}
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigateDate("next")}
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Filter */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Filter Shift:
              </span>
            </div>
            <Select value={filterShift} onValueChange={setFilterShift}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Shift</SelectItem>
                <SelectItem value="MORNING">Pagi</SelectItem>
                <SelectItem value="AFTERNOON">Siang</SelectItem>
                <SelectItem value="EVENING">Sore/Malam</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Roster List */}
          <div className="grid gap-4 md:grid-cols-2">
            {filteredRosters.map((roster) => (
              <Card key={roster.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">
                        {DUTY_TYPE_LABELS[roster.dutyType]}
                      </CardTitle>
                      <CardDescription className="flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3" />
                        {roster.location}
                      </CardDescription>
                    </div>
                    <Badge className={SHIFT_CONFIG[roster.shift]?.color}>
                      {SHIFT_CONFIG[roster.shift]?.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {roster.startTime} - {roster.endTime}
                    </span>
                    {roster.supervisor && (
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {roster.supervisor.name}
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="mb-3">
                    <div className="flex justify-between text-sm mb-1">
                      <span>Progress</span>
                      <span>{getCompletionRate(roster).toFixed(0)}%</span>
                    </div>
                    <Progress
                      value={getCompletionRate(roster)}
                      className="h-2"
                    />
                  </div>
                  <div className="space-y-2">
                    {roster.students.map((assignment) => (
                      <div
                        key={assignment.id}
                        className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback>
                              {assignment.student.name.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">
                              {assignment.student.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {assignment.student.class.name}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {assignment.rating && (
                            <div className="flex items-center gap-1 text-amber-500">
                              <Star className="h-3 w-3 fill-current" />
                              <span className="text-xs">
                                {assignment.rating}
                              </span>
                            </div>
                          )}
                          <Badge
                            className={`text-xs ${STATUS_CONFIG[assignment.status]?.color}`}
                          >
                            <span className="flex items-center gap-1">
                              {STATUS_CONFIG[assignment.status]?.icon}
                              {STATUS_CONFIG[assignment.status]?.label}
                            </span>
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3">
                    <Link href={`/duty-roster/${roster.id}`}>
                      <Button variant="outline" className="w-full" size="sm">
                        Detail & Verifikasi
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredRosters.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  Tidak ada jadwal piket untuk tanggal ini
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Calendar View */}
        <TabsContent value="calendar" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Kalender Piket</CardTitle>
              <CardDescription>
                Lihat jadwal piket dalam tampilan kalender
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-96 flex items-center justify-center bg-muted rounded-lg">
                <div className="text-center">
                  <CalendarDays className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">Tampilan Kalender</p>
                  <p className="text-sm text-muted-foreground">
                    (Integrasi kalender interaktif)
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Leaderboard */}
        <TabsContent value="leaderboard" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Top Performers */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-amber-500" />
                  Santri Terbaik
                </CardTitle>
                <CardDescription>
                  Berdasarkan penyelesaian tugas dan rating
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {report.topPerformers.map((performer: any, index) => (
                    <div
                      key={performer.student.id}
                      className={`flex items-center gap-4 p-4 rounded-lg ${
                        index === 0
                          ? "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
                          : index === 1
                            ? "bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-800"
                            : index === 2
                              ? "bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800"
                              : "bg-muted/50"
                      }`}
                    >
                      <div
                        className={`flex items-center justify-center w-10 h-10 rounded-full font-bold ${
                          index === 0
                            ? "bg-amber-500 text-white"
                            : index === 1
                              ? "bg-gray-400 text-white"
                              : index === 2
                                ? "bg-orange-400 text-white"
                                : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {index + 1}
                      </div>
                      <Avatar className="h-12 w-12">
                        <AvatarFallback>
                          {performer.student.name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <p className="font-medium">{performer.student.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {performer.student.nis}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                          <span className="font-medium">
                            {performer.averageRating.toFixed(1)}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {performer.completedDuties} tugas
                        </p>
                        <p className="text-xs text-green-600">
                          {performer.totalPoints} poin
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Stats by Duty Type */}
            <Card>
              <CardHeader>
                <CardTitle>Statistik per Jenis Piket</CardTitle>
                <CardDescription>Bulan ini</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(DUTY_TYPE_LABELS)
                    .slice(0, 6)
                    .map(([type, label], idx) => {
                      const completionRate = ((idx * 17) % 30) + 70; // Demo deterministic
                      return (
                        <div key={type} className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>{label}</span>
                            <span className="font-medium">
                              {completionRate.toFixed(0)}%
                            </span>
                          </div>
                          <Progress value={completionRate} className="h-2" />
                        </div>
                      );
                    })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function DutyRosterPageWithShell() {
  return (
    <MainLayout>
      <DutyRosterPageContent />
    </MainLayout>
  );
}
