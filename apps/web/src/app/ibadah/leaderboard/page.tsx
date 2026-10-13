"use client";

import { useState, useMemo } from "react";
import { MainLayout } from "@/components/layout";
import { PageHeader } from "@/components/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Trophy,
  Medal,
  Crown,
  Target,
  Star,
  TrendingUp,
  Users,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useUnits } from "@/hooks/use-units";
import {
  useIbadahLeaderboard,
  LeaderboardPeriod,
  LEADERBOARD_PERIODS,
} from "@/hooks/use-ibadah";

// Period mapping for UI filter to API enum
const PERIOD_MAP: Record<string, LeaderboardPeriod> = {
  today: "DAILY",
  week: "WEEKLY",
  month: "MONTHLY",
  semester: "SEMESTER",
};

const getRankIcon = (rank: number) => {
  switch (rank) {
    case 1:
      return <Crown className="h-6 w-6 text-yellow-500" />;
    case 2:
      return <Medal className="h-6 w-6 text-gray-400" />;
    case 3:
      return <Medal className="h-6 w-6 text-amber-600" />;
    default:
      return <span className="font-bold text-muted-foreground">#{rank}</span>;
  }
};

const getRankBg = (rank: number) => {
  switch (rank) {
    case 1:
      return "bg-gradient-to-r from-yellow-100 to-amber-100 border-yellow-300";
    case 2:
      return "bg-gradient-to-r from-gray-100 to-slate-100 border-gray-300";
    case 3:
      return "bg-gradient-to-r from-amber-100 to-orange-100 border-amber-300";
    default:
      return "bg-background hover:bg-muted/50";
  }
};

interface LeaderboardEntry {
  id: string;
  rank: number;
  name: string;
  class: string;
  score: number;
  /** Share of the period's targets done, in percent. */
  completion: number;
  avatar: string;
}

export default function IbadahLeaderboardPage() {
  const { user } = useAuthStore();
  const [period, setPeriod] = useState("week");
  const [category, setCategory] = useState("all");
  const [unitChoice, setUnitChoice] = useState("");

  // The API ranks only the santri this account reaches (a santri: their own
  // row, at their place in the unit). Whoever reaches more than one unit — the
  // pesantren's staff, the yayasan — may narrow to one.
  const { data: units } = useUnits({ limit: 100 });
  const choosesUnit = (units?.length ?? 0) > 1;

  // Fetch leaderboard data
  const { data: leaderboardData, isLoading } = useIbadahLeaderboard({
    unitId: unitChoice || undefined,
    periodType: PERIOD_MAP[period] || "WEEKLY",
    limit: 10,
  });

  // Transform API data to UI format
  const leaderboard: LeaderboardEntry[] = useMemo(() => {
    if (!leaderboardData) return [];
    // The fields the API sends (`IbadahLeaderboardEntry`). This used to read
    // `student.name` and `streakDays`, which it never sent — every name was
    // "Unknown" — and added the bonus to a total that already holds it.
    return leaderboardData.map((item, index) => {
      const rank = item.rank || index + 1;
      return {
        id: item.studentId,
        rank,
        name: item.studentName,
        class: item.className || "-",
        score: item.totalPoints,
        completion: Math.round(item.completionRate),
        avatar: rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : "👤",
      };
    });
  }, [leaderboardData]);

  // The top three by the API's rank — a santri placed fourth has no podium.
  const podium = leaderboard.filter((s) => s.rank <= 3);
  // A santri receives only their own row (the API's scope), so the list is
  // their place, not a top ten.
  const onlyOwnRow =
    !!user?.id &&
    !!leaderboardData?.length &&
    leaderboardData.every((item) => item.userId === user.id);

  // Find current user position (from leaderboard or default).
  // (React Compiler auto-memoizes; manual useMemo could not be preserved here.)
  const currentUserEntry = ((): { rank: number | string; score: number } => {
    if (!user?.id || !leaderboardData) return { rank: "-", score: 0 };
    const found = leaderboardData.find((item) => item.userId === user.id);
    if (found) {
      return { rank: found.rank || "-", score: found.totalPoints };
    }
    return { rank: "-", score: 0 };
  })();

  return (
    <MainLayout
      allowedRoles={[
        "STUDENT",
        "TEACHER",
        "SUPER_ADMIN",
        "UNIT_ADMIN",
        "PARENT",
      ]}
    >
      <div className="space-y-6">
        <PageHeader
          title="Papan Peringkat Ibadah"
          description="Kompetisi amaliyah harian santri"
        />

        {/* Top 3 Cards */}
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Card
                key={i}
                className={cn(
                  i === 0 && "md:order-2 md:scale-105 z-10",
                  i === 1 && "md:order-1",
                  i === 2 && "md:order-3",
                )}
              >
                <CardContent className="pt-6 text-center">
                  <Skeleton className="h-12 w-12 rounded-full mx-auto mb-2" />
                  <Skeleton className="h-6 w-6 mx-auto mb-2" />
                  <Skeleton className="h-5 w-24 mx-auto mb-1" />
                  <Skeleton className="h-4 w-16 mx-auto" />
                  <div className="mt-4 flex justify-center gap-4">
                    <Skeleton className="h-10 w-16" />
                    <Skeleton className="h-10 w-16" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : leaderboard.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                Belum ada data leaderboard untuk periode ini.
              </p>
            </CardContent>
          </Card>
        ) : podium.length === 0 ? null : (
          <div className="grid gap-4 md:grid-cols-3">
            {podium.map((student) => (
              <Card
                key={student.id}
                className={cn(
                  "relative overflow-hidden",
                  student.rank === 1 && "md:order-2 md:scale-105 z-10",
                  student.rank === 2 && "md:order-1",
                  student.rank === 3 && "md:order-3",
                )}
              >
                <div
                  className={cn(
                    "absolute inset-0 opacity-10",
                    student.rank === 1 && "bg-yellow-500",
                    student.rank === 2 && "bg-gray-500",
                    student.rank === 3 && "bg-amber-500",
                  )}
                />
                <CardContent className="pt-6 text-center relative">
                  <div className="text-5xl mb-2">{student.avatar}</div>
                  <div className="mb-2">{getRankIcon(student.rank)}</div>
                  <h3 className="font-bold text-lg">{student.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {student.class}
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-primary">
                        {student.score}
                      </p>
                      <p className="text-xs text-muted-foreground">Poin</p>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center gap-1">
                        <Target className="h-5 w-5 text-orange-500" />
                        <span className="text-xl font-bold">
                          {student.completion}%
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">Capaian</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          {choosesUnit && (
            <Select
              value={unitChoice || "all"}
              onValueChange={(v) => setUnitChoice(v === "all" ? "" : v)}
            >
              <SelectTrigger className="w-[200px]" aria-label="Unit">
                <SelectValue placeholder="Pilih unit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua unit</SelectItem>
                {units?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Hari Ini</SelectItem>
              <SelectItem value="week">Minggu Ini</SelectItem>
              <SelectItem value="month">Bulan Ini</SelectItem>
              <SelectItem value="semester">Semester</SelectItem>
            </SelectContent>
          </Select>

          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Ibadah</SelectItem>
              <SelectItem value="sholat">Sholat</SelectItem>
              <SelectItem value="tilawah">Tilawah</SelectItem>
              <SelectItem value="dzikir">Dzikir</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Your Position Card */}
        <Card className="border-primary bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Posisi Kamu</p>
                  <p className="text-sm text-muted-foreground">
                    Terus tingkatkan ibadahmu!
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <p className="text-2xl font-bold">#{currentUserEntry.rank}</p>
                  <p className="text-xs text-muted-foreground">Peringkat</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">
                    {currentUserEntry.score}
                  </p>
                  <p className="text-xs text-muted-foreground">Poin</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Full Leaderboard */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-500" />
              {onlyOwnRow ? "Peringkatmu" : "Top 10 Santri"}
            </CardTitle>
            <CardDescription>
              {onlyOwnRow
                ? "Peringkat di unitmu, berdasarkan total poin ibadah"
                : "Berdasarkan total poin ibadah"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-4 border rounded-xl"
                  >
                    <div className="flex items-center gap-4">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div>
                        <Skeleton className="h-4 w-24 mb-1" />
                        <Skeleton className="h-3 w-16" />
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Skeleton className="h-6 w-12" />
                      <Skeleton className="h-8 w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                Belum ada data leaderboard
              </div>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((student) => (
                  <div
                    key={student.id}
                    className={cn(
                      "flex items-center justify-between p-4 border rounded-xl transition-all",
                      getRankBg(student.rank),
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 flex items-center justify-center">
                        {getRankIcon(student.rank)}
                      </div>
                      <div>
                        <p className="font-medium">{student.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {student.class}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div
                        className="flex items-center gap-1"
                        title="Capaian target"
                      >
                        <Target className="h-4 w-4 text-orange-500" />
                        <span className="font-medium">
                          {student.completion}%
                        </span>
                      </div>
                      <Badge variant="secondary" className="text-lg px-3">
                        {student.score}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
