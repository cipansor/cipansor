"use client";

import { use } from "react";
import { MainLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import {
  useExamMonitoring,
  useTopicMastery,
  useExamDifficultyInsights,
} from "@/hooks/use-cbt";
import {
  Loader2,
  UserCheck,
  Pencil,
  Calendar,
  BarChart2,
  AlertCircle,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import Link from "next/link";

export default function ExamMonitoringPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: exam, isLoading } = useExamMonitoring(id);
  const { data: topicMasteryData, isLoading: loadingTopics } =
    useTopicMastery(id);
  const topicMastery = topicMasteryData?.items;
  const curriculumMastery = topicMasteryData?.topicMastery;

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </MainLayout>
    );
  }

  if (!exam) {
    return (
      <MainLayout>
        <p>Jadwal Ujian tidak ditemukan</p>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Monitoring Ujian
            </h1>
            <p className="text-muted-foreground">{exam.title}</p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/cbt/exams">Kembali</Link>
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Status Ujian
              </CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{exam.status}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Siswa Selesai
              </CardTitle>
              <UserCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {exam.attempts?.filter(
                  (a: any) =>
                    a.status === "COMPLETED" || a.status === "NEEDS_REVIEW",
                ).length || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Siswa Mengerjakan
              </CardTitle>
              <Pencil className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {exam.attempts?.filter((a: any) => a.status === "IN_PROGRESS")
                  .length || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Total Peserta Ujian
              </CardTitle>
              <UserCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {exam.attempts?.length || 0}
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="participants" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="participants">Daftar Peserta</TabsTrigger>
            <TabsTrigger value="mastery">Analisis Penguasaan</TabsTrigger>
            <TabsTrigger value="difficulty">Analisis Soal</TabsTrigger>
          </TabsList>

          <TabsContent value="participants" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Daftar Peserta</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nama Siswa</TableHead>
                      <TableHead>Status Pengerjaan</TableHead>
                      <TableHead>Skor Sementara</TableHead>
                      <TableHead className="text-right">
                        Aksi Penilaian
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {exam.attempts?.map((attempt: any) => {
                      const totalQuestions =
                        exam.questionBank?._count?.questions || 0;
                      const answeredQuestions = attempt._count?.answers || 0;
                      const progress =
                        totalQuestions > 0
                          ? (answeredQuestions / totalQuestions) * 100
                          : 0;
                      return (
                        <TableRow key={attempt.id}>
                          <TableCell className="font-medium">
                            {attempt.student?.user?.name || "Unknown"}
                            {totalQuestions > 0 && (
                              <div
                                className="mt-1 w-24 bg-slate-100 h-1 rounded-full overflow-hidden"
                                title={`${answeredQuestions}/${totalQuestions} soal dijawab`}
                              >
                                <div
                                  className={`h-full ${attempt.status === "IN_PROGRESS" ? "bg-blue-500" : "bg-emerald-500"}`}
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                attempt.status === "COMPLETED"
                                  ? "default"
                                  : attempt.status === "NEEDS_REVIEW"
                                    ? "destructive"
                                    : attempt.status === "IN_PROGRESS"
                                      ? "secondary"
                                      : "outline"
                              }
                            >
                              {attempt.status === "COMPLETED"
                                ? "Selesai"
                                : attempt.status === "NEEDS_REVIEW"
                                  ? "Butuh Review"
                                  : attempt.status === "IN_PROGRESS"
                                    ? "Sedang Mengerjakan"
                                    : attempt.status === "EXPIRED"
                                      ? "Kedaluwarsa"
                                      : attempt.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-semibold text-lg">
                            {attempt.score
                              ? parseFloat(attempt.score).toFixed(2)
                              : "0"}
                          </TableCell>
                          <TableCell className="text-right">
                            {attempt.status === "COMPLETED" ||
                            attempt.status === "NEEDS_REVIEW" ? (
                              <Link
                                href={`/cbt/attempts/${attempt.id}/grading`}
                              >
                                <Button variant="outline" size="sm">
                                  Nilai (Manual)
                                </Button>
                              </Link>
                            ) : attempt.status === "EXPIRED" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled
                                title="Tidak dapat menilai ujian yang sudah kedaluwarsa"
                              >
                                Kedaluwarsa
                              </Button>
                            ) : (
                              <Button variant="outline" size="sm" disabled>
                                Nilai (Manual)
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="mastery" className="space-y-6 mt-4">
            {loadingTopics && (
              <Card>
                <CardContent className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
              </Card>
            )}

            {!loadingTopics && (topicMastery || curriculumMastery) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Curriculum-aligned Analytics (TP) */}
                {curriculumMastery && curriculumMastery.length > 0 && (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <BarChart2 className="w-5 h-5 text-indigo-600" />
                        <div>
                          <CardTitle>
                            Analisis Kurikulum (Pencapaian TP)
                          </CardTitle>
                          <CardDescription>
                            Rata-rata penguasaan per Tujuan Pembelajaran
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={curriculumMastery}
                            layout="vertical"
                            margin={{ left: 80 }}
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              horizontal={true}
                              vertical={false}
                            />
                            <XAxis type="number" domain={[0, 100]} hide />
                            <YAxis
                              dataKey="code"
                              type="category"
                              tick={{ fontSize: 10, fontWeight: "bold" }}
                              width={70}
                            />
                            <Tooltip
                              formatter={(value: any) => [
                                `${value.toFixed(1)}%`,
                                "Penguasaan",
                              ]}
                            />
                            <Bar
                              dataKey="masteryLevel"
                              radius={[0, 4, 4, 0]}
                              barSize={15}
                            >
                              {curriculumMastery.map(
                                (entry: any, index: number) => (
                                  <Cell
                                    key={`cell-${index}`}
                                    fill={
                                      entry.masteryLevel < 60
                                        ? "#f43f5e"
                                        : entry.masteryLevel < 80
                                          ? "#f59e0b"
                                          : "#10b981"
                                    }
                                  />
                                ),
                              )}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Question-level Analytics */}
                {topicMastery && topicMastery.length > 0 && (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <BarChart2 className="w-5 h-5 text-indigo-600" />
                        <div>
                          <CardTitle>Performa Butir Soal</CardTitle>
                          <CardDescription>
                            Rata-rata skor per butir soal
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={topicMastery}
                            layout="vertical"
                            margin={{ left: 50 }}
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              horizontal={true}
                              vertical={false}
                            />
                            <XAxis type="number" domain={[0, 100]} hide />
                            <YAxis
                              dataKey="code"
                              type="category"
                              tick={{ fontSize: 10, fontWeight: "bold" }}
                              width={40}
                            />
                            <Tooltip
                              formatter={(value: any) => [
                                `${value.toFixed(1)}%`,
                                "Benar",
                              ]}
                            />
                            <Bar
                              dataKey="masteryLevel"
                              radius={[0, 4, 4, 0]}
                              barSize={15}
                            >
                              {topicMastery.map((entry: any, index: number) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={
                                    entry.masteryLevel < 50
                                      ? "#f43f5e"
                                      : "#3b82f6"
                                  }
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="difficulty" className="mt-4">
            <DifficultyInsightsTab examId={id} />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

function DifficultyInsightsTab({ examId }: { examId: string }) {
  const { data: insights, isLoading } = useExamDifficultyInsights(examId);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!insights) return null;

  const hasDiscrimination = insights.discriminationGroupSize != null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Rata-rata Keberhasilan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {insights.averageSuccessRate != null
                ? `${Math.round(insights.averageSuccessRate)}%`
                : "-"}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {insights.totalParticipants ?? 0} peserta teranalisis
            </p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-rose-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500" /> Killer Questions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {insights.questionInsights?.filter((q) => q.isKiller).length || 0}{" "}
              Soal
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Daya Beda Sangat Baik
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {hasDiscrimination
                ? `${insights.questionInsights?.filter((q) => (q.discriminationIndex ?? 0) >= 0.4).length || 0} Soal`
                : "-"}
            </div>
            {!hasDiscrimination && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Butuh ≥ 10 peserta selesai untuk analisis daya beda
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Analisis Butir Soal</CardTitle>
          <CardDescription>
            Indeks kesulitan (P: proporsi jawaban benar) dan daya beda (D:
            selisih kelompok atas vs bawah 27%). D &lt; 0,2 berarti butir perlu
            direview.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {insights.questionInsights?.map((q, index: number) => {
              const p = q.difficultyIndex;
              const diffLabel =
                p == null
                  ? "Belum ada data"
                  : p < 0.3
                    ? "Sukar"
                    : p > 0.7
                      ? "Mudah"
                      : "Sedang";
              const d = q.discriminationIndex;
              const discLabel =
                d == null
                  ? null
                  : d >= 0.4
                    ? "Sangat Baik"
                    : d >= 0.3
                      ? "Baik"
                      : d >= 0.2
                        ? "Cukup"
                        : "Buruk";
              return (
                <div
                  key={q.questionId}
                  className={`p-4 border rounded-lg flex flex-col gap-2 ${q.needsReview ? "bg-rose-50/50 border-rose-200" : "bg-slate-50/50"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-indigo-400">
                      Q{index + 1}
                    </span>
                    <div className="flex gap-1">
                      <Badge
                        variant={
                          diffLabel === "Sukar"
                            ? "destructive"
                            : diffLabel === "Mudah"
                              ? "default"
                              : "secondary"
                        }
                        className="text-[10px] h-4"
                      >
                        {diffLabel}
                      </Badge>
                      {discLabel && d != null && (
                        <Badge
                          variant={d < 0.2 ? "destructive" : "outline"}
                          className="text-[10px] h-4"
                        >
                          Daya Beda: {discLabel}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 italic">
                    "{q.content}"
                  </p>
                  <div className="grid grid-cols-2 gap-3 mt-1">
                    <div>
                      <span className="text-[10px] text-muted-foreground block uppercase font-semibold">
                        Kesulitan (P)
                      </span>
                      <span className="text-sm font-mono">
                        {p != null ? p.toFixed(2) : "-"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block uppercase font-semibold">
                        Daya Beda (D)
                      </span>
                      <span
                        className={`text-sm font-mono ${d != null && d < 0.2 ? "text-rose-600 font-bold" : ""}`}
                      >
                        {d != null ? d.toFixed(2) : "-"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1">
                    <div className="flex justify-between text-[10px] mb-1">
                      <span>Success Rate ({q.totalGraded} dinilai)</span>
                      <span className="font-bold">
                        {Math.round(q.successRate)}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 h-1 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${q.successRate < 40 ? "bg-rose-500" : q.successRate > 80 ? "bg-emerald-500" : "bg-blue-500"}`}
                        style={{ width: `${q.successRate}%` }}
                      />
                    </div>
                  </div>
                  {q.needsReview && (
                    <div className="flex items-center gap-1 text-[10px] text-rose-600 font-medium">
                      <AlertCircle className="w-3 h-3" /> Perlu review/revisi
                      butir
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
