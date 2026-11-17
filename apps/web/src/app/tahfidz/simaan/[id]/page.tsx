"use client";
import { use } from "react";
import { safeFormat } from "@/lib/date";
import { useRouter } from "next/navigation";
import { MainLayout } from "@/components/layout";
import { PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  useSimaanExam,
  useDeleteSimaan,
  simaanExamStatus,
} from "@/hooks/use-simaan";
import { SIMAAN_TYPE_LABELS, simaanCoverageLabel } from "@cipansor/shared";

import { id } from "date-fns/locale";
import {
  ArrowLeft,
  Calendar,
  User,
  Users,
  BookOpen,
  Edit,
  Trash2,
  CheckCircle,
  Clock,
  AlertTriangle,
  Award,
  FileText,
} from "lucide-react";

type ExamStatus = "SCHEDULED" | "COMPLETED";

const statusLabels: Record<ExamStatus, string> = {
  SCHEDULED: "Terjadwal",
  COMPLETED: "Selesai",
};

const StatusBadge = ({ status }: { status: ExamStatus }) => {
  const variants: Record<ExamStatus, "default" | "outline"> = {
    SCHEDULED: "outline",
    COMPLETED: "default",
  };

  const icons: Record<ExamStatus, React.ReactNode> = {
    SCHEDULED: <Clock className="h-3 w-3 mr-1" />,
    COMPLETED: <CheckCircle className="h-3 w-3 mr-1" />,
  };

  return (
    <Badge
      variant={variants[status] || "default"}
      className="flex items-center w-fit"
    >
      {icons[status]}
      {statusLabels[status]}
    </Badge>
  );
};

export default function SimaanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();

  const { data: exam, isLoading, error } = useSimaanExam(resolvedParams.id);
  const deleteMutation = useDeleteSimaan();

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(resolvedParams.id);
      toast.success("Data ujian simaan berhasil dihapus");
      router.push("/tahfidz/simaan");
    } catch {
      toast.error("Gagal menghapus data ujian simaan");
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="space-y-6">
          <Skeleton className="h-10 w-48" />
          <div className="grid gap-6 md:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        </div>
      </MainLayout>
    );
  }

  if (error || !exam) {
    return (
      <MainLayout>
        <div className="text-center py-12">
          <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
          <h2 className="mt-4 text-lg font-semibold">Data Tidak Ditemukan</h2>
          <p className="text-muted-foreground">
            Data ujian simaan tidak ditemukan
          </p>
          <Button
            className="mt-4"
            onClick={() => router.push("/tahfidz/simaan")}
          >
            Kembali ke Daftar
          </Button>
        </div>
      </MainLayout>
    );
  }

  // The model has no `status` column: a simaan is scheduled until it is graded,
  // then complete. Deriving it from the record keeps the badge truthful, and
  // `canEdit` in step with the edit page, which refuses a `passed` exam.
  const status: ExamStatus = simaanExamStatus(exam);
  const canEdit = !exam.passed;
  const canDelete = !exam.passed;

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push("/tahfidz/simaan")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <PageHeader
              title="Detail Ujian Simaan"
              description={`ID: ${exam.id.substring(0, 8)}...`}
              icon={BookOpen}
            />
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button
                variant="outline"
                onClick={() =>
                  router.push(`/tahfidz/simaan/${resolvedParams.id}/edit`)
                }
              >
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Button>
            )}

            {canDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Hapus
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Hapus Ujian Simaan?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Tindakan ini tidak dapat dibatalkan. Data ujian simaan
                      akan dihapus permanen.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Ya, Hapus
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Student & Exam Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Informasi Santri & Ujian
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Student Info */}
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarFallback className="text-lg">
                    {exam.student?.user?.name?.substring(0, 2).toUpperCase() ||
                      "ST"}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="text-lg font-semibold">
                    {exam.student?.user?.name || "N/A"}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {(exam.student as any)?.nis || "-"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {exam.halaqoh?.name || "-"}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Exam Details */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <StatusBadge status={status} />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Jenis Simaan</span>
                  <Badge variant="secondary">
                    {SIMAAN_TYPE_LABELS[exam.simaanType] || exam.simaanType}
                  </Badge>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-4 w-4" /> Tanggal
                  </span>
                  <span className="font-medium">
                    {safeFormat(new Date(exam.examDate), "EEEE, dd MMMM yyyy", {
                      locale: id,
                    })}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Cakupan Juz</span>
                  <span className="font-medium">
                    {simaanCoverageLabel(exam.juzStart, exam.juzEnd)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Results Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5 text-yellow-500" />
                Hasil Ujian
              </CardTitle>
              <CardDescription>Nilai dan predikat dari penguji</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {status === "COMPLETED" ? (
                <>
                  {/* Final Score */}
                  <div className="text-center py-6 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 rounded-lg">
                    <div className="text-5xl font-bold text-green-600 dark:text-green-400">
                      {(exam.overallScore || 0).toFixed(1)}
                    </div>
                    <div className="text-muted-foreground mt-1">
                      Nilai Akhir
                    </div>
                    {exam.grade && (
                      <Badge className="mt-3" variant="default">
                        {exam.grade}
                      </Badge>
                    )}
                  </div>

                  <Separator />

                  {/* Component Scores */}
                  <div className="space-y-3">
                    {exam.tajwidScore !== undefined &&
                      exam.tajwidScore !== null && (
                        <ScoreBar label="Tajwid" score={exam.tajwidScore} />
                      )}
                    {exam.fashohaScore !== undefined &&
                      exam.fashohaScore !== null && (
                        <ScoreBar label="Fashahah" score={exam.fashohaScore} />
                      )}
                    {exam.tartilScore !== undefined &&
                      exam.tartilScore !== null && (
                        <ScoreBar label="Tartil" score={exam.tartilScore} />
                      )}
                  </div>

                  {/* Pass/Fail Status */}
                  <div className="flex items-center justify-center pt-4">
                    <Badge
                      variant={exam.passed ? "default" : "destructive"}
                      className="text-lg py-2 px-4"
                    >
                      {exam.passed ? "✓ LULUS" : "✗ TIDAK LULUS"}
                    </Badge>
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <Clock className="mx-auto h-12 w-12 text-muted-foreground" />
                  <p className="mt-4 text-muted-foreground">
                    Ujian belum dinilai
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Examiners Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Dewan Penguji ({exam.examiners?.length || 0})
            </CardTitle>
            <CardDescription>
              Daftar penguji dan nilai yang diberikan
            </CardDescription>
          </CardHeader>
          <CardContent>
            {exam.examiners && exam.examiners.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {exam.examiners.map((examiner: any, index: number) => (
                  <Card key={examiner.id} className="bg-muted/30">
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-3 mb-4">
                        <Avatar>
                          <AvatarFallback>
                            {examiner.teacher?.name
                              ?.substring(0, 2)
                              .toUpperCase() || `P${index + 1}`}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">
                            {examiner.teacher?.name || `Penguji ${index + 1}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {examiner.isChairman
                              ? "Ketua Penguji"
                              : "Anggota Penguji"}
                          </p>
                        </div>
                      </div>

                      {examiner.score !== undefined ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">
                              Nilai
                            </span>
                            <Badge variant="default">{examiner.score}</Badge>
                          </div>
                          {examiner.notes && (
                            <p className="text-sm text-muted-foreground italic">
                              "{examiner.notes}"
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Belum memberikan nilai
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Users className="mx-auto h-12 w-12 text-muted-foreground" />
                <p className="mt-4 text-muted-foreground">
                  Belum ada penguji yang ditambahkan
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notes Section */}
        {exam.notes && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Catatan
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground whitespace-pre-wrap">
                {exam.notes}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}

// Score Bar Component
function ScoreBar({ label, score }: { label: string; score: number }) {
  const percentage = Math.min(100, Math.max(0, score));
  const colorClass =
    percentage >= 85
      ? "bg-green-500"
      : percentage >= 70
        ? "bg-blue-500"
        : percentage >= 55
          ? "bg-yellow-500"
          : "bg-red-500";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{score}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${colorClass} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
