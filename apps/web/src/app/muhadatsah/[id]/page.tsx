"use client";

import { useParams, useRouter } from "next/navigation";
import { safeFormat } from "@/lib/date";
import Link from "next/link";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  ArrowLeft,
  Calendar,
  Clock,
  User,
  Users,
  Languages,
  FileText,
  Play,
  Edit,
  Trash2,
  X,
  Star,
  XCircle,
  BookOpen,
  Volume2,
  MessageCircle,
} from "lucide-react";
import { toast } from "sonner";

import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

import {
  useMuhadatsahDetail,
  useDeleteMuhadatsah,
  useCancelMuhadatsah,
  getStatusColor,
  getGradeColor,
  getLanguageLabel,
} from "@/hooks/use-muhadatsah";

// Scoring components for Muhadatsah
const SCORING_COMPONENTS = [
  {
    key: "fluencyScore",
    label: "Kelancaran (Fluency)",
    description: "Kemampuan berbicara dengan lancar tanpa terlalu banyak jeda",
    icon: MessageCircle,
  },
  {
    key: "grammarScore",
    label: "Tata Bahasa (Grammar)",
    description: "Ketepatan penggunaan struktur kalimat dan kaidah bahasa",
    icon: BookOpen,
  },
  {
    key: "vocabularyScore",
    label: "Kosa Kata (Vocabulary)",
    description: "Penggunaan kosa kata yang tepat dan beragam",
    icon: FileText,
  },
  {
    key: "pronunciationScore",
    label: "Pengucapan (Pronunciation)",
    description: "Kejelasan dan ketepatan pengucapan kata",
    icon: Volume2,
  },
];

// Grade mapping
const GRADE_INFO = [
  { grade: "A", label: "Mumtaz", range: "86-100", color: "text-green-600" },
  {
    grade: "B",
    label: "Jayyid Jiddan",
    range: "71-85",
    color: "text-blue-600",
  },
  { grade: "C", label: "Jayyid", range: "56-70", color: "text-yellow-600" },
  { grade: "D", label: "Maqbul", range: "41-55", color: "text-orange-600" },
  { grade: "E", label: "Rasib", range: "0-40", color: "text-red-600" },
];

export default function MuhadatsahDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: muhadatsah, isLoading, error } = useMuhadatsahDetail(id);
  const deleteMuhadatsah = useDeleteMuhadatsah();
  const cancelMuhadatsah = useCancelMuhadatsah();

  // Handle delete
  const handleDelete = async () => {
    try {
      await deleteMuhadatsah.mutateAsync(id);
      toast.success("Data muhadatsah berhasil dihapus");
      router.push("/muhadatsah");
    } catch {
      toast.error("Gagal menghapus data");
    }
  };

  // Handle cancel
  const handleCancel = async () => {
    try {
      await cancelMuhadatsah.mutateAsync(id);
      toast.success("Jadwal muhadatsah dibatalkan");
      router.refresh();
    } catch {
      toast.error("Gagal membatalkan jadwal");
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <MainLayout>
        <div className="mb-6">
          <Skeleton className="h-4 w-24 mb-4" />
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-6">
            <Skeleton className="h-[300px] w-full rounded-lg" />
            <Skeleton className="h-[200px] w-full rounded-lg" />
          </div>
          <div>
            <Skeleton className="h-[400px] w-full rounded-lg" />
          </div>
        </div>
      </MainLayout>
    );
  }

  // Error state
  if (error || !muhadatsah) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center py-12">
          <XCircle className="h-12 w-12 text-destructive mb-4" />
          <h2 className="text-lg font-semibold mb-2">Data Tidak Ditemukan</h2>
          <p className="text-muted-foreground mb-4">
            Muhadatsah yang Anda cari tidak ditemukan atau telah dihapus.
          </p>
          <Button asChild>
            <Link href="/muhadatsah">Kembali ke Daftar</Link>
          </Button>
        </div>
      </MainLayout>
    );
  }

  const isScheduled = muhadatsah.status === "SCHEDULED";
  const isCompleted = muhadatsah.status === "COMPLETED";

  return (
    <MainLayout>
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/muhadatsah">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Kembali
          </Link>
        </Button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold">Detail Muhadatsah</h1>
              <Badge className={getStatusColor(muhadatsah.status)}>
                {muhadatsah.status === "SCHEDULED" && "Terjadwal"}
                {muhadatsah.status === "COMPLETED" && "Selesai"}
                {muhadatsah.status === "CANCELLED" && "Dibatalkan"}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              Sesi latihan percakapan {getLanguageLabel(muhadatsah.language)}
            </p>
          </div>
          <div className="flex gap-2">
            {isScheduled && (
              <Button asChild>
                <Link href={`/muhadatsah/${id}/evaluate`}>
                  <Play className="h-4 w-4 mr-2" />
                  Mulai & Nilai
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Main Content */}
        <div className="md:col-span-2 space-y-6">
          {/* Participants Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Peserta Muhadatsah
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {/* Student 1 */}
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center gap-3 mb-3">
                    <Avatar className="h-12 w-12">
                      <AvatarFallback>
                        {muhadatsah.student?.name
                          ?.split(" ")
                          .map((n: string) => n[0])
                          .join("")
                          .slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold">
                        {muhadatsah.student?.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {muhadatsah.student?.nis}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1 text-sm">
                    <p>
                      <span className="text-muted-foreground">Kelas:</span>{" "}
                      {muhadatsah.student?.class?.name || "-"}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Unit:</span>{" "}
                      {muhadatsah.unit?.name || "-"}
                    </p>
                  </div>
                  {isCompleted && muhadatsah.totalScore && (
                    <div className="mt-3 pt-3 border-t">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Nilai:
                        </span>
                        <Badge
                          className={getGradeColor(muhadatsah.grade || "")}
                        >
                          {muhadatsah.totalScore} - {muhadatsah.grade}
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>

                {/* Partner / Student 2 */}
                <div className="p-4 border rounded-lg">
                  {muhadatsah.partner ? (
                    <>
                      <div className="flex items-center gap-3 mb-3">
                        <Avatar className="h-12 w-12">
                          <AvatarFallback>
                            {muhadatsah.partner?.name
                              ?.split(" ")
                              .map((n: string) => n[0])
                              .join("")
                              .slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-semibold">
                            {muhadatsah.partner?.name}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {muhadatsah.partner?.nis}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-1 text-sm">
                        <p>
                          <span className="text-muted-foreground">Unit:</span>{" "}
                          {muhadatsah.unit?.name || "-"}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full py-6 text-muted-foreground">
                      <User className="h-8 w-8 mb-2 opacity-50" />
                      <p className="text-sm">Partner belum ditentukan</p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Evaluation Results - Only if completed */}
          {isCompleted && muhadatsah.totalScore && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Star className="h-5 w-5 text-yellow-500" />
                  Hasil Evaluasi
                </CardTitle>
                {muhadatsah.evaluatedAt && (
                  <CardDescription>
                    Dinilai pada{" "}
                    {format(
                      new Date(muhadatsah.evaluatedAt),
                      "dd MMMM yyyy HH:mm",
                      {
                        locale: localeId,
                      },
                    )}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Overall Score */}
                <div className="text-center p-6 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground mb-2">
                    Nilai Total
                  </p>
                  <div className="flex items-center justify-center gap-4">
                    <span className="text-5xl font-bold">
                      {muhadatsah.totalScore}
                    </span>
                    <Badge
                      className={`text-lg ${getGradeColor(muhadatsah.grade || "")}`}
                    >
                      {muhadatsah.grade}
                    </Badge>
                  </div>
                  <p className="mt-2 text-muted-foreground">
                    {muhadatsah.grade === "A" && "Mumtaz (Istimewa)"}
                    {muhadatsah.grade === "B" && "Jayyid Jiddan (Sangat Baik)"}
                    {muhadatsah.grade === "C" && "Jayyid (Baik)"}
                    {muhadatsah.grade === "D" && "Maqbul (Cukup)"}
                    {muhadatsah.grade === "E" && "Rasib (Perlu Peningkatan)"}
                  </p>
                </div>

                {/* Component Scores */}
                <div className="grid gap-4 md:grid-cols-2">
                  {SCORING_COMPONENTS.map((component) => {
                    const score =
                      (muhadatsah[
                        component.key as keyof typeof muhadatsah
                      ] as number) || 0;
                    return (
                      <div
                        key={component.key}
                        className="p-4 border rounded-lg"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <component.icon className="h-4 w-4 text-primary" />
                          <span className="font-medium">{component.label}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <Progress value={score} className="flex-1" />
                          <span className="text-lg font-semibold w-12 text-right">
                            {score}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Duration */}
                {muhadatsah.duration && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    Durasi percakapan: {muhadatsah.duration} menit
                  </div>
                )}

                {/* Feedback */}
                {muhadatsah.feedback && (
                  <div>
                    <h4 className="font-medium mb-2">Catatan Evaluator</h4>
                    <p className="text-sm text-muted-foreground bg-muted p-4 rounded-lg">
                      {muhadatsah.feedback}
                    </p>
                  </div>
                )}

                {/* Evaluator */}
                {muhadatsah.evaluator && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <User className="h-4 w-4" />
                    Dinilai oleh: {muhadatsah.evaluator.name}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Grade Legend */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Keterangan Nilai</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 gap-2 text-center text-sm">
                {GRADE_INFO.map((grade) => (
                  <div key={grade.grade} className="p-2 bg-muted rounded">
                    <span className={`font-bold ${grade.color}`}>
                      {grade.grade}
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">
                      {grade.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {grade.range}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Schedule Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Informasi Jadwal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Language */}
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Languages className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Bahasa</p>
                  <p className="font-medium">
                    {getLanguageLabel(muhadatsah.language)}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Date */}
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Calendar className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tanggal</p>
                  <p className="font-medium">
                    {format(
                      new Date(muhadatsah.scheduledAt),
                      "EEEE, dd MMMM yyyy",
                      {
                        locale: localeId,
                      },
                    )}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Time */}
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Waktu</p>
                  <p className="font-medium">
                    {safeFormat(new Date(muhadatsah.scheduledAt), "HH:mm", {
                      locale: localeId,
                    })}
                  </p>
                </div>
              </div>

              {/* Topic */}
              {muhadatsah.topic && (
                <>
                  <Separator />
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Tema Percakapan
                      </p>
                      <p className="font-medium">{muhadatsah.topic}</p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Aksi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {isScheduled && (
                <>
                  <Button className="w-full" asChild>
                    <Link href={`/muhadatsah/${id}/evaluate`}>
                      <Play className="h-4 w-4 mr-2" />
                      Mulai & Nilai
                    </Link>
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" className="w-full">
                        <X className="h-4 w-4 mr-2" />
                        Batalkan
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Batalkan Muhadatsah?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Jadwal muhadatsah ini akan dibatalkan. Apakah Anda
                          yakin?
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Tidak</AlertDialogCancel>
                        <AlertDialogAction onClick={handleCancel}>
                          Ya, Batalkan
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}

              {isCompleted && (
                <Button variant="outline" className="w-full" asChild>
                  <Link href={`/muhadatsah/${id}/evaluate`}>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Penilaian
                  </Link>
                </Button>
              )}

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Hapus
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Hapus Muhadatsah?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Data muhadatsah ini akan dihapus permanen dan tidak dapat
                      dikembalikan.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      className="bg-destructive"
                    >
                      Hapus
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

          {/* Tips for Muhadatsah */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">💡 Tips Evaluasi</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• Perhatikan kelancaran berbicara</li>
                <li>• Cek ketepatan tata bahasa</li>
                <li>• Evaluasi keragaman kosa kata</li>
                <li>• Dengarkan kejelasan pengucapan</li>
                <li>• Berikan feedback yang membangun</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
