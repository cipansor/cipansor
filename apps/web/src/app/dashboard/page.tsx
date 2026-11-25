"use client";

import { MainLayout } from "@/components/layout";
import { safeFormat } from "@/lib/date";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuthStore } from "@/stores/auth";
import {
  useDashboardStats,
  useAttendanceStats,
  useFinanceStats,
  useViolationRewardStats,
  useTahfidzStats,
  useTahfidzRecords,
} from "@/hooks";
import { useStudents } from "@/hooks/use-students";
import { useQuickStats } from "@/hooks/use-dashboard-enhancement";
import { useHealthSummary } from "@/hooks/use-health";
import { useDonationStats, useRecentDonations } from "@/hooks/use-donation";
import {
  Users,
  GraduationCap,
  Building2,
  BookOpen,
  TrendingUp,
  TrendingDown,
  Activity,
  Banknote,
  Calendar,
  AlertTriangle,
  Award,
  Heart,
  Stethoscope,
  Pill,
} from "lucide-react";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useMemo } from "react";
import { AdmissionsStatsCard } from "@/components/dashboard/AdmissionsStatsCard";
import { CBTMonitoringWidget } from "@/components/dashboard/CBTMonitoringWidget";
import { STUDENT_STATUS } from "@cipansor/shared";

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { data: stats, isLoading } = useDashboardStats();
  const { data: attendanceData } = useAttendanceStats();
  const { data: financeData } = useFinanceStats();
  // Today's WIB counts (attendance + murojaah) — the endpoint the dashboard's
  // "hari ini" cards read, kept fresh every five minutes. A unit user is
  // scoped to their unit; a foundation-wide user passes none.
  const { data: quickStats } = useQuickStats({ unitId: user?.unitId });

  // New hooks for enhanced dashboard
  const { data: tahfidzData, isLoading: tahfidzLoading } = useTahfidzStats({
    period: "month",
  });
  const { data: recentTahfidz } = useTahfidzRecords({ limit: 5 });
  const { data: violationData, isLoading: violationLoading } =
    useViolationRewardStats({ period: "month" });
  const { data: healthData } = useHealthSummary();
  const { data: recentStudents } = useStudents({
    limit: 5,
    status: STUDENT_STATUS.ACTIVE,
  }); // Assume default sort is filtered by new/active
  const { data: donationStats } = useDonationStats();
  const { data: recentDonations } = useRecentDonations();

  // Combine activity feed
  const activities = useMemo(() => {
    const allActivities = [
      ...(recentStudents?.data?.map((s) => ({
        id: s.id,
        title: "Santri Baru",
        description: `${s.name} bergabung di ${s.currentClass?.name || "sekolah"}`,
        time: s.createdAt,
        type: "student",
        rawTime: new Date(s.createdAt).getTime(),
      })) || []),
      ...(recentTahfidz?.data?.map((t: any) => ({
        id: t.id,
        title: "Setoran Hafalan",
        description: `${t.student?.user?.name || "Santri"} - QS. ${t.surahName} : ${t.ayahStart}-${t.ayahEnd}`,
        time: t.recordedAt,
        type: "tahfidz",
        rawTime: new Date(t.recordedAt).getTime(),
      })) || []),
      ...(violationData?.recentViolations?.map((v) => ({
        id: v.id,
        title: "Pelanggaran",
        description: `${v.studentName} - ${v.type} (${v.points} poin)`,
        time: v.date,
        type: "violation",
        rawTime: new Date(v.date).getTime(),
      })) || []),
      ...(violationData?.recentRewards?.map((r) => ({
        id: r.id,
        title: "Penghargaan",
        description: `${r.studentName} - ${r.type} (${r.points} poin)`,
        time: r.date,
        type: "reward",
        rawTime: new Date(r.date).getTime(),
      })) || []),
      ...(financeData?.recentPayments?.map((p) => ({
        id: p.id,
        title: "Pembayaran",
        description: `${p.studentName} membayar Rp ${p.amount.toLocaleString("id-ID")}`,
        time: p.date,
        type: "finance",
        rawTime: new Date(p.date).getTime(),
      })) || []),
      ...(recentDonations?.map((d) => ({
        id: d.id,
        title: "Donasi Masuk",
        description: `${d.donorName} - ${d.type} (Rp ${d.amount.toLocaleString("id-ID")})`,
        time: (d as any).donatedAt || d.createdAt,
        type: "donation",
        rawTime: new Date((d as any).donatedAt || d.createdAt).getTime(),
      })) || []),
    ];

    return allActivities.sort((a, b) => b.rawTime - a.rawTime).slice(0, 5);
  }, [
    recentStudents,
    recentTahfidz,
    violationData,
    financeData,
    recentDonations,
  ]);

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Welcome Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Selamat datang, {user?.name}!
          </h1>
          <p className="text-muted-foreground">
            Berikut ringkasan {user?.unit?.name || "sistem"} hari ini.
          </p>
        </div>

        {/* Admissions & CBT summaries — the API includes these fields only
            for admin/staff (admissions) and admin/staff/teacher (cbt), so
            the cards hide themselves for other roles. */}
        {(stats?.admissions || stats?.cbt) && (
          <div className="grid gap-4 md:grid-cols-2">
            <AdmissionsStatsCard
              stats={stats?.admissions}
              isLoading={isLoading}
            />
            <CBTMonitoringWidget stats={stats?.cbt} isLoading={isLoading} />
          </div>
        )}

        {/* Main Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Total Santri"
            value={stats?.totalStudents ?? "-"}
            description="Santri terdaftar"
            icon={GraduationCap}
            trend={stats?.studentsGrowth}
            isLoading={isLoading}
          />
          <StatsCard
            title="Ustadz/Ustadzah"
            value={stats?.totalTeachers ?? "-"}
            description="Tenaga pengajar"
            icon={Users}
            isLoading={isLoading}
          />
          <StatsCard
            title="Kelas"
            value={stats?.totalClasses ?? "-"}
            description="Kelas aktif"
            icon={BookOpen}
            isLoading={isLoading}
          />
          <StatsCard
            title="Kehadiran"
            value={stats?.attendanceRate ? `${stats.attendanceRate}%` : "-"}
            description="Tingkat kehadiran"
            icon={Calendar}
            isLoading={isLoading}
          />
        </div>

        {/* Secondary Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <StatsCard
            title="Total Hafalan"
            value={tahfidzData?.totalMemorized?.toLocaleString("id-ID") ?? "-"}
            description="Total ayat dihafal"
            icon={BookOpen}
            isLoading={tahfidzLoading}
          />
          <StatsCard
            title="Rata-rata Hafalan"
            value={
              tahfidzData?.averageJuz !== undefined
                ? `${tahfidzData.averageJuz} Juz`
                : "-"
            }
            description="Per santri"
            icon={Award}
            isLoading={tahfidzLoading}
          />
          <StatsCard
            title="Pelanggaran"
            value={violationData?.totalViolations ?? "-"}
            description="Bulan ini"
            icon={AlertTriangle}
            variant="destructive"
            isLoading={violationLoading}
          />
          <StatsCard
            title="Penghargaan"
            value={violationData?.totalRewards ?? "-"}
            description="Bulan ini"
            icon={Award}
            variant="warning"
            isLoading={violationLoading}
          />
          <StatsCard
            title="Total Unit"
            value={stats?.totalUnits ?? "-"}
            description="Unit pendidikan"
            icon={Building2}
            isLoading={isLoading}
          />
          <StatsCard
            title="Tahun Ajaran"
            value={stats?.activeAcademicYear?.name ?? "-"}
            description="Tahun ajaran aktif"
            icon={Calendar}
            isLoading={isLoading}
          />
          <StatsCard
            title="Kehadiran Hari Ini"
            value={quickStats?.todayAttendance ?? "-"}
            description="Santri hadir (WIB)"
            icon={Calendar}
          />
          <StatsCard
            title="Murojaah Hari Ini"
            value={quickStats?.todayMurojaah ?? "-"}
            description="Setoran murojaah (WIB)"
            icon={BookOpen}
          />
        </div>

        {/* Tahfidz Section */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Tahfidz Progress Chart */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Progress Tahfidz (Bulanan)
              </CardTitle>
              <CardDescription>Jumlah ayat yang disetorkan</CardDescription>
            </CardHeader>
            <CardContent>
              {tahfidzLoading ? (
                <div className="h-[250px] flex items-center justify-center">
                  <div className="h-full w-full animate-pulse bg-muted rounded-md" />
                </div>
              ) : tahfidzData?.monthlyProgress &&
                tahfidzData.monthlyProgress.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart
                    data={tahfidzData.monthlyProgress}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                    />
                    <XAxis dataKey="month" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                    />
                    <Bar
                      dataKey="ayahCount"
                      name="Ayat"
                      fill="#8b5cf6"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[250px] text-sm text-muted-foreground">
                  Belum ada data tahfidz
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Hafidz List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5" />
                Top 5 Hafidz
              </CardTitle>
              <CardDescription>Capaian hafalan terbanyak</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {tahfidzLoading ? (
                  Array(5)
                    .fill(0)
                    .map((_, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between animate-pulse"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-muted" />
                          <div className="space-y-1">
                            <div className="h-4 w-32 bg-muted rounded" />
                            <div className="h-3 w-20 bg-muted rounded" />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="h-4 w-10 bg-muted rounded" />
                          <div className="h-3 w-16 bg-muted rounded" />
                        </div>
                      </div>
                    ))
                ) : tahfidzData?.topStudents &&
                  tahfidzData.topStudents.length > 0 ? (
                  tahfidzData.topStudents.map((student, i) => (
                    <div
                      key={student.id}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 text-purple-600 font-bold text-sm">
                          {i + 1}
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            {student.studentName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {student.unitName}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-purple-600">
                          {student.totalJuz} Juz
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(student.totalAyah ?? 0).toLocaleString()} Ayat
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-sm text-muted-foreground py-4">
                    Belum ada data
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                Donasi & Infak
              </CardTitle>
              <Heart className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">
                {donationStats?.totalAmount
                  ? `Rp ${(donationStats.totalAmount / 1000000).toFixed(1)}jt`
                  : "-"}
              </div>
              <p className="text-xs text-muted-foreground">
                {donationStats?.pendingVerification ?? 0} menunggu verifikasi
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Charts and Activity Section */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Attendance Chart - Recharts Area */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Kehadiran 7 Hari Terakhir
              </CardTitle>
              <CardDescription>Tingkat kehadiran harian santri</CardDescription>
            </CardHeader>
            <CardContent>
              {attendanceData && attendanceData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart
                    data={attendanceData.slice(-7).map((item) => {
                      const total =
                        item.present + item.absent + item.sick + item.excused;
                      return {
                        date: safeFormat(new Date(item.date), "EEE", {
                          locale: id,
                        }),
                        hadir: item.present,
                        sakit: item.sick,
                        izin: item.excused,
                        alpha: item.absent,
                        rate:
                          total > 0
                            ? Math.round((item.present / total) * 100)
                            : 0,
                      };
                    })}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="colorHadir"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#22c55e"
                          stopOpacity={0.8}
                        />
                        <stop
                          offset="95%"
                          stopColor="#22c55e"
                          stopOpacity={0.1}
                        />
                      </linearGradient>
                      <linearGradient
                        id="colorSakit"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#f59e0b"
                          stopOpacity={0.8}
                        />
                        <stop
                          offset="95%"
                          stopColor="#f59e0b"
                          stopOpacity={0.1}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                    />
                    <XAxis dataKey="date" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="hadir"
                      stroke="#22c55e"
                      fillOpacity={1}
                      fill="url(#colorHadir)"
                      name="Hadir"
                    />
                    <Area
                      type="monotone"
                      dataKey="sakit"
                      stroke="#f59e0b"
                      fillOpacity={1}
                      fill="url(#colorSakit)"
                      name="Sakit"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[250px] text-sm text-muted-foreground">
                  Belum ada data kehadiran
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity (Dynamic) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Aktivitas Terbaru
              </CardTitle>
              <CardDescription>Kegiatan sistem terkini</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {activities.length > 0 ? (
                  activities.map((activity) => (
                    <ActivityItem
                      key={`${activity.type}-${activity.id}`}
                      title={activity.title}
                      description={activity.description}
                      time={safeFormat(new Date(activity.time), "HH:mm", {
                        locale: id,
                      })}
                      type={activity.type}
                    />
                  ))
                ) : (
                  <div className="text-center text-sm text-muted-foreground py-4">
                    Belum ada aktivitas
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Finance Charts Row */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Finance Bar Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Banknote className="h-5 w-5" />
                Keuangan Bulan Ini
              </CardTitle>
              <CardDescription>
                Perbandingan tagihan dan pembayaran
              </CardDescription>
            </CardHeader>
            <CardContent>
              {financeData ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart
                    data={[
                      {
                        name: "Total Tagihan",
                        value: financeData.totalBilled || 0,
                        fill: "#3b82f6",
                      },
                      {
                        name: "Sudah Bayar",
                        value: financeData.totalPaid || 0,
                        fill: "#22c55e",
                      },
                      {
                        name: "Belum Bayar",
                        value: financeData.totalUnpaid || 0,
                        fill: "#f59e0b",
                      },
                    ]}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                    />
                    <XAxis dataKey="name" className="text-xs" />
                    <YAxis
                      className="text-xs"
                      tickFormatter={(value) =>
                        `${(value / 1000000).toFixed(0)}jt`
                      }
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                      formatter={(value: any) => [
                        `Rp ${(value / 1000000).toFixed(1)} jt`,
                        "",
                      ]}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {[0, 1, 2].map((index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={["#3b82f6", "#22c55e", "#f59e0b"][index]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[250px] text-sm text-muted-foreground">
                  Belum ada data keuangan
                </div>
              )}
            </CardContent>
          </Card>

          {/* Finance Pie Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Banknote className="h-5 w-5" />
                Distribusi Pembayaran
              </CardTitle>
              <CardDescription>Tingkat koleksi pembayaran</CardDescription>
            </CardHeader>
            <CardContent>
              {financeData && financeData.totalBilled > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: "Lunas", value: financeData.totalPaid || 0 },
                        {
                          name: "Belum Bayar",
                          value: financeData.totalUnpaid || 0,
                        },
                      ]}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) =>
                        `${name}: ${((percent || 0) * 100).toFixed(0)}%`
                      }
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      <Cell fill="#22c55e" />
                      <Cell fill="#f59e0b" />
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                      formatter={(value: any) => [
                        `Rp ${(value / 1000000).toFixed(1)} jt`,
                        "",
                      ]}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[250px] text-sm text-muted-foreground">
                  Belum ada data pembayaran
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Additional Info Row - Health & AY */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Health Summary (Connected) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Heart className="h-5 w-5" />
                Kesehatan Santri (Bulan Ini)
              </CardTitle>
              <CardDescription>Ringkasan pemeriksaan kesehatan</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Stethoscope className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-medium">Total Periksa</span>
                  </div>
                  <div className="text-2xl font-bold text-blue-600">
                    {healthData?.thisMonthRecords ?? "-"}
                  </div>
                </div>
                <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Pill className="h-4 w-4 text-red-600" />
                    <span className="text-sm font-medium">Sakit/Obat</span>
                  </div>
                  <div className="text-2xl font-bold text-red-600">
                    {healthData?.recordsByType?.find(
                      (r) => r.type === "ILLNESS",
                    )?.count ?? 0}
                  </div>
                </div>
              </div>

              {(healthData?.medications?.lowStock ?? 0) > 0 && (
                <div className="mt-4 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <span className="text-xs text-yellow-700 dark:text-yellow-400">
                    {healthData?.medications?.lowStock} obat stok menipis
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Academic Year Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Tahun Ajaran Aktif
              </CardTitle>
              <CardDescription>Informasi tahun ajaran berjalan</CardDescription>
            </CardHeader>
            <CardContent>
              {stats?.activeAcademicYear ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b">
                    <span className="text-sm text-muted-foreground">Nama</span>
                    <span className="font-semibold">
                      {stats.activeAcademicYear.name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pb-2 border-b">
                    <span className="text-sm text-muted-foreground">Mulai</span>
                    <span className="font-semibold">
                      {format(
                        new Date(stats.activeAcademicYear.startDate),
                        "d MMM yyyy",
                        { locale: id },
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Selesai
                    </span>
                    <span className="font-semibold">
                      {format(
                        new Date(stats.activeAcademicYear.endDate),
                        "d MMM yyyy",
                        { locale: id },
                      )}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-4">
                  Belum ada tahun ajaran aktif
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}

interface StatsCardProps {
  title: string;
  value: number | string;
  description: string;
  icon: React.ElementType;
  trend?: number;
  isLoading?: boolean;
  variant?: "default" | "destructive" | "warning" | "success";
}

function StatsCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  isLoading,
  variant = "default",
}: StatsCardProps) {
  const getVariantStyles = () => {
    switch (variant) {
      case "destructive":
        return { icon: "text-red-500", text: "text-red-600" };
      case "warning":
        return { icon: "text-yellow-500", text: "" };
      case "success":
        return { icon: "text-green-500", text: "text-green-600" };
      default:
        return { icon: "text-muted-foreground", text: "" };
    }
  };

  const styles = getVariantStyles();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${styles.icon}`} />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-8 w-20 animate-pulse rounded bg-muted" />
        ) : (
          <>
            <div className={`text-2xl font-bold ${styles.text}`}>{value}</div>
            <div className="flex items-center gap-1">
              <p className="text-xs text-muted-foreground">{description}</p>
              {trend !== undefined && trend !== 0 && (
                <span
                  className={`flex items-center text-xs ${
                    trend > 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {trend > 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {Math.abs(trend)}%
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface ActivityItemProps {
  title: string;
  description: string;
  time: string;
  type?: string;
}

function ActivityItem({ title, description, time, type }: ActivityItemProps) {
  const getColor = () => {
    switch (type) {
      case "student":
        return "bg-blue-500";
      case "attendance":
        return "bg-green-500";
      case "tahfidz":
        return "bg-purple-500";
      case "violation":
        return "bg-red-500";
      case "reward":
        return "bg-yellow-500";
      case "health":
        return "bg-pink-500";
      case "finance":
        return "bg-emerald-500";
      case "donation":
        return "bg-teal-500";
      default:
        return "bg-primary";
    }
  };

  return (
    <div className="flex items-start gap-3">
      <div className={`h-2 w-2 mt-2 rounded-full ${getColor()}`} />
      <div className="flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
        <p className="text-xs text-muted-foreground">{time}</p>
      </div>
    </div>
  );
}
