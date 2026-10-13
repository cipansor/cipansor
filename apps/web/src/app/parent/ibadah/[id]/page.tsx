"use client";

import { useEffect, useState } from "react";
import { safeFormat } from "@/lib/date";
import { useParams, useRouter } from "next/navigation";
import { format, startOfMonth, endOfMonth, parse } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Star,
  Flame,
  CheckCircle2,
  TrendingUp,
  Award,
  AlertCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";

interface IbadahStats {
  summary: {
    totalRecords: number;
    completedRecords: number;
    totalPoints: number;
    completionRate: number;
    currentStreak: number;
    maxStreak: number;
  };
  byCategory: Array<{
    category: string;
    completed: number;
    total: number;
    points: number;
    completionRate: number;
  }>;
  startDate: string;
  endDate: string;
}

interface StudentProfile {
  id: string;
  nis: string;
  user: {
    name: string;
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  SHOLAT_WAJIB: "Sholat 5 Waktu",
  SHOLAT_JAMAAH: "Sholat Berjamaah",
  SHOLAT_SUNNAH: "Sholat Sunnah",
  QIYAMULLAIL: "Qiyamullail",
  TILAWAH: "Tilawah Al-Quran",
  DZIKIR: "Dzikir Harian",
  PUASA: "Puasa Sunnah",
  SEDEKAH: "Infaq & Sedekah",
  OTHER: "Lainnya",
};

export default function ParentChildIbadahPage() {
  const params = useParams();
  const router = useRouter();
  const studentId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<IbadahStats | null>(null);
  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<string>(safeFormat(new Date(), "yyyy-MM"));

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Calculate date range from selected month
        // Parse "yyyy-MM" to Date object safely to avoid timezone issues
        const date = parse(month, "yyyy-MM", new Date());
        const startDate = format(startOfMonth(date), "yyyy-MM-dd");
        const endDate = format(endOfMonth(date), "yyyy-MM-dd");

        // Fetch profile and stats in parallel
        const [profileRes, statsRes] = await Promise.all([
          api.get(`/parent/children/${studentId}/profile`),
          api.get(`/parent/children/${studentId}/ibadah`, {
            params: { startDate, endDate },
          }),
        ]);

        setStudent(profileRes.data.data);
        setStats(statsRes.data.data);
      } catch (err: any) {
        setError(
          err?.response?.data?.error?.message ||
            err?.message ||
            "Gagal memuat data ibadah anak.",
        );
      } finally {
        setLoading(false);
      }
    };

    if (studentId) {
      fetchData();
    }
  }, [studentId, month]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push("/parent/ibadah")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Laporan Mutaba&apos;ah
          </h1>
          <p className="text-muted-foreground">
            {student?.user?.name || "Memuat..."}
          </p>
        </div>
      </div>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Tidak dapat menampilkan data
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-end">
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-[180px]">
                <CalendarIcon className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Pilih Bulan" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 6 }).map((_, i) => {
                  const d = new Date();
                  d.setDate(1); // Set to first day to avoid month overflow on 31st
                  d.setMonth(d.getMonth() - i);
                  const value = format(d, "yyyy-MM");
                  const label = format(d, "MMMM yyyy", { locale: localeId });
                  return (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Summary Stats */}
          {stats && (
            <div className="grid gap-4 md:grid-cols-3">
              <Card className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Persentase
                  </CardTitle>
                  <TrendingUp className="h-4 w-4 text-green-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-700">
                    {stats.summary.completionRate}%
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Keterlaksanaan Ibadah
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950 dark:to-amber-950">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Streak (Maksimal)
                  </CardTitle>
                  <Flame className="h-4 w-4 text-orange-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-700">
                    {stats.summary.maxStreak} Hari
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Rekor konsistensi terbaik
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Poin
                  </CardTitle>
                  <Star className="h-4 w-4 text-blue-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-700">
                    {stats.summary.totalPoints}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Poin terkumpul bulan ini
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Category Breakdown */}
          {stats && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-primary" />
                  Detail Kategori
                </CardTitle>
                <CardDescription>
                  Capaian ibadah berdasarkan kategori
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {stats.byCategory.map((cat) => (
                    <div key={cat.category} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">
                          {CATEGORY_LABELS[cat.category] || cat.category}
                        </span>
                        <span className="text-muted-foreground">
                          {cat.completed} / {cat.total} ({cat.completionRate}%)
                        </span>
                      </div>
                      <Progress
                        value={cat.completionRate}
                        className="h-2"
                        // Dynamic color based on score
                        indicatorClassName={
                          cat.completionRate >= 80
                            ? "bg-green-500"
                            : cat.completionRate >= 60
                              ? "bg-yellow-500"
                              : "bg-red-500"
                        }
                      />
                    </div>
                  ))}

                  {stats.byCategory.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      Belum ada data ibadah untuk periode ini.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
