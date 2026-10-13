"use client";
import { use, useState } from "react";
import { safeFormat } from "@/lib/date";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Edit2,
  User,
  Calendar as CalendarIcon,
  Clock,
  Thermometer,
  Utensils,
  BookOpen,
  MessageSquare,
  CheckCircle2,
} from "lucide-react";

import { id as dateLocale } from "date-fns/locale";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LoadingSpinner,
  PhotoGallery,
  type PhotoGalleryItem,
} from "@/components/shared";
import { Separator } from "@/components/ui/separator";

import { useDailyReport } from "@/hooks/use-daily-report";

import { MainLayout } from "@/components/layout";
function DailyReportDetailPageContent({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { data: report, isLoading } = useDailyReport(params.id);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="container mx-auto p-6 text-center">
        <h1 className="text-2xl font-bold">Laporan tidak ditemukan</h1>
        <Button onClick={() => router.push("/daily-report")} className="mt-4">
          Kembali ke Daftar
        </Button>
      </div>
    );
  }

  const getMoodEmoji = (mood?: string) => {
    switch (mood) {
      case "HAPPY":
        return "😊 Senang";
      case "EXCITED":
        return "🤩 Antusias";
      case "NEUTRAL":
        return "😐 Biasa";
      case "TIRED":
        return "😴 Lelah";
      case "SAD":
        return "😢 Sedih";
      case "SICK":
        return "🤒 Sakit";
      default:
        return "-";
    }
  };

  const getMealLabel = (status?: string) => {
    switch (status) {
      case "FULL":
        return "Habis";
      case "HALF":
        return "Setengah";
      case "QUARTER":
        return "Sedikit";
      case "NONE":
        return "Tidak Mau";
      default:
        return "-";
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Detail Laporan Harian
            </h1>
            <p className="text-muted-foreground">
              {safeFormat(new Date(report.reportDate), "EEEE, dd MMMM yyyy", {
                locale: dateLocale,
              })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {report.parentReadAt && (
            <Badge
              variant="secondary"
              className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200"
            >
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Dibaca Orang Tua
            </Badge>
          )}
          <Button
            variant="outline"
            onClick={() => router.push(`/daily-report/${params.id}/edit`)}
          >
            <Edit2 className="w-4 h-4 mr-2" />
            Edit
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Sidebar Info */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="w-4 h-4" />
                Identitas Siswa
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                {report.student?.photoUrl ? (
                  <img
                    src={report.student.photoUrl}
                    alt="Student"
                    className="w-16 h-16 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                    <User className="w-8 h-8 text-muted-foreground" />
                  </div>
                )}
                <div>
                  <h3 className="font-bold text-lg">
                    {report.student?.user?.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {report.student?.nis}
                  </p>
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground block">Unit</span>
                  <span className="font-medium">{report.unit?.name}</span>
                </div>
                <div>
                  {/* Class info usually comes from enrollment or needs to be fetched, simplistic fallback */}
                  <span className="text-muted-foreground block">Kelas</span>
                  <span className="font-medium">-</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Waktu & Kehadiran
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Jam Datang
                </span>
                <span className="font-medium">
                  {report.arrivalTime
                    ? safeFormat(new Date(report.arrivalTime), "HH:mm")
                    : "-"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Jam Pulang
                </span>
                <span className="font-medium">
                  {report.departureTime
                    ? safeFormat(new Date(report.departureTime), "HH:mm")
                    : "-"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Penjemput</span>
                <span className="font-medium">{report.pickedUpBy || "-"}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="md:col-span-2 space-y-6">
          {/* Mood & Health */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Mood</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold mb-1">
                  {getMoodEmoji(report.mood)}
                </div>
                <p className="text-sm text-muted-foreground">
                  Suasana hati pagi ini
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">
                  Kesehatan
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 mb-2">
                  <Thermometer className="w-5 h-5 text-red-500" />
                  <span className="text-xl font-bold">
                    {report.temperature ? `${report.temperature}°C` : "-"}
                  </span>
                </div>
                <p className="text-sm">{report.healthStatus || "Sehat"}</p>
                {report.napDuration && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Tidur Siang: {report.napDuration} menit
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Meals */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Utensils className="w-5 h-5" />
                Konsumsi Makan
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-3 bg-muted/20 rounded-lg">
                  <div className="text-sm text-muted-foreground mb-1">
                    Sarapan
                  </div>
                  <div className="font-bold">
                    {report.hadBreakfast ? "Ya" : "Tidak"}
                  </div>
                </div>
                <div className="p-3 bg-muted/20 rounded-lg">
                  <div className="text-sm text-muted-foreground mb-1">
                    Makan Siang
                  </div>
                  <div className="font-bold">
                    {getMealLabel(report.mealStatus)}
                  </div>
                </div>
                <div className="p-3 bg-muted/20 rounded-lg">
                  <div className="text-sm text-muted-foreground mb-1">
                    Snack
                  </div>
                  <div className="font-bold">
                    {getMealLabel(report.snackStatus)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Photos */}
          {report.photos && report.photos.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarIcon className="w-5 h-5" />
                  Dokumentasi
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PhotoGallery
                  photos={report.photos.map((p) => ({
                    id: p.id,
                    url: p.photoUrl,
                    uploadedAt: new Date(p.createdAt),
                    caption: p.caption,
                    category: "Kegiatan",
                  }))}
                  editable={false}
                />
              </CardContent>
            </Card>
          )}

          {/* Activities */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="w-5 h-5" />
                Aktivitas & Pembelajaran
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold mb-1">
                  Kegiatan Hari Ini
                </h4>
                <p className="text-sm leading-relaxed">
                  {report.activitiesSummary || "-"}
                </p>
              </div>
              <Separator />
              <div>
                <h4 className="text-sm font-semibold mb-1">
                  Capaian (Achievements)
                </h4>
                <p className="text-sm leading-relaxed">
                  {report.achievements || "-"}
                </p>
              </div>
              <Separator />
              <div>
                <h4 className="text-sm font-semibold mb-1">Tahfidz / Ibadah</h4>
                <p className="text-sm leading-relaxed">
                  {report.tahfidzActivity || "-"}
                </p>
                {report.sholatDhuha && (
                  <Badge variant="outline" className="mt-2">
                    Sholat Dhuha
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                Catatan & Komunikasi
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {report.behaviorNotes && (
                <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-100">
                  <h4 className="text-sm font-semibold text-yellow-800 mb-1">
                    Catatan Perilaku
                  </h4>
                  <p className="text-sm text-yellow-700">
                    {report.behaviorNotes}
                  </p>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold mb-1">Catatan Guru</h4>
                <p className="text-sm leading-relaxed">
                  {report.teacherNotes || "-"}
                </p>
              </div>

              {report.homeActivity && (
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                  <h4 className="text-sm font-semibold text-blue-800 mb-1">
                    PR / Tugas di Rumah
                  </h4>
                  <p className="text-sm text-blue-700">{report.homeActivity}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function DailyReportDetailPage({
  params,
}: {
  params: Promise<Parameters<typeof DailyReportDetailPageContent>[0]["params"]>;
}) {
  const resolved = use(params);
  return (
    <MainLayout>
      <DailyReportDetailPageContent params={resolved} />
    </MainLayout>
  );
}
