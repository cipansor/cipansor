"use client";

import { use } from "react";
import { safeFormat } from "@/lib/date";
import { MainLayout } from "@/components/layout";
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
import { toast } from "sonner";
import {
  useVerifyCertificate,
  useDownloadPublicCertificate,
} from "@/hooks/use-certificate";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import {
  CheckCircle2,
  XCircle,
  Award,
  User,
  Calendar,
  FileText,
  Download,
  Share2,
  Shield,
  AlertTriangle,
  Building2,
  GraduationCap,
} from "lucide-react";
import Link from "next/link";

export default function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const resolvedParams = use(params);
  const { data, isLoading, error } = useVerifyCertificate(resolvedParams.code);
  const downloadMutation = useDownloadPublicCertificate();

  /**
   * Fetch the public certificate's PDF by its verification number and save it.
   *
   * The button used to link to `/public/verify-sanad` — the *verification
   * form* — so clicking "Unduh Sertifikat" only re-asked for the number and
   * never delivered a file. The bytes come from the session-free
   * `/certificates/public/{code}/download` route, which answers only for a
   * certificate marked public; the blob is turned into an object URL and
   * revoked after the click so it does not pin the file in memory.
   */
  const handleDownload = async () => {
    try {
      const blob = await downloadMutation.mutateAsync(resolvedParams.code);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sertifikat-${resolvedParams.code.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // The axios interceptor already surfaced the error to the user.
      toast.error("Gagal mengunduh sertifikat");
    }
  };

  if (isLoading) {
    return (
      <MainLayout showSidebar={false}>
        <div className="max-w-2xl mx-auto py-12">
          <Card>
            <CardHeader className="text-center">
              <Skeleton className="h-16 w-16 rounded-full mx-auto" />
              <Skeleton className="h-6 w-48 mx-auto mt-4" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  if (error || !data) {
    return (
      <MainLayout showSidebar={false}>
        <div className="max-w-2xl mx-auto py-12">
          <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900">
                <AlertTriangle className="h-8 w-8 text-red-600" />
              </div>
              <CardTitle className="text-red-600">Verifikasi Gagal</CardTitle>
              <CardDescription>
                Terjadi kesalahan saat memverifikasi sertifikat
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-muted-foreground">
                Kode verifikasi mungkin tidak valid atau terjadi masalah
                koneksi.
              </p>
              <Button className="mt-6" asChild>
                <Link href="/">Kembali ke Beranda</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  const { valid, certificate, message } = data;

  if (!valid || !certificate) {
    return (
      <MainLayout showSidebar={false}>
        <div className="max-w-2xl mx-auto py-12">
          <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900">
                <XCircle className="h-8 w-8 text-red-600" />
              </div>
              <CardTitle className="text-red-600">
                Sertifikat Tidak Valid
              </CardTitle>
              <CardDescription>
                {message || "Sertifikat dengan kode ini tidak ditemukan"}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-muted-foreground mb-6">
                Pastikan Anda memasukkan kode verifikasi yang benar atau scan
                ulang QR Code pada sertifikat.
              </p>
              <div className="space-x-4">
                <Button variant="outline" asChild>
                  <Link href="/certificates/verify">Coba Lagi</Link>
                </Button>
                <Button asChild>
                  <Link href="/">Kembali ke Beranda</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout showSidebar={false}>
      <div className="max-w-2xl mx-auto py-12">
        {/* Verification Status Card */}
        <Card className="border-green-200 bg-green-50 dark:bg-green-950/20 mb-6">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
              <CheckCircle2 className="h-10 w-10 text-green-600" />
            </div>
            <CardTitle className="text-green-600 text-2xl">
              Sertifikat Terverifikasi
            </CardTitle>
            <CardDescription className="flex items-center justify-center gap-2 text-green-700">
              <Shield className="h-4 w-4" />
              Dokumen ini asli dan dikeluarkan oleh sistem kami
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Certificate Details Card */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <Award className="h-8 w-8 text-primary" />
                <div>
                  <CardTitle>{certificate.title}</CardTitle>
                  <CardDescription>
                    {certificateTypeLabels[certificate.certificateType] ||
                      certificate.certificateType}
                  </CardDescription>
                </div>
              </div>
              {certificate.grade && (
                <Badge variant="secondary" className="text-lg py-1 px-3">
                  {certificate.grade}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Student Info */}
            <div className="bg-muted/50 rounded-lg p-4">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <User className="h-4 w-4" />
                Informasi Penerima
              </h4>
              <div className="grid gap-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nama</span>
                  <span className="font-medium">
                    {certificate.student?.name || "-"}
                  </span>
                </div>
                {certificate.student?.unit && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Unit</span>
                    <span className="font-medium">
                      {certificate.student.unit.name}
                    </span>
                  </div>
                )}
                {certificate.student?.class && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kelas</span>
                    <span className="font-medium">
                      {certificate.student.class.name}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Certificate Info */}
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">
                    Nomor Sertifikat
                  </p>
                  <p className="font-mono font-medium">
                    {certificate.certificateNumber}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">
                    Tanggal Terbit
                  </p>
                  <p className="font-medium">
                    {format(
                      new Date(certificate.issueDate),
                      "EEEE, dd MMMM yyyy",
                      { locale: id },
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <GraduationCap className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">Penandatangan</p>
                  <p className="font-medium">{certificate.signatoryName}</p>
                  <p className="text-sm text-muted-foreground">
                    {certificate.signatoryTitle}
                  </p>
                </div>
              </div>

              {certificate.description && (
                <div className="flex items-start gap-3">
                  <Building2 className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">Keterangan</p>
                    <p className="text-sm">{certificate.description}</p>
                  </div>
                </div>
              )}

              {certificate.rank && (
                <div className="flex items-start gap-3">
                  <Award className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">Peringkat</p>
                    <p className="font-medium">Peringkat {certificate.rank}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-3 pt-4 border-t">
              {certificate.isPublic && (
                <Button
                  onClick={handleDownload}
                  disabled={downloadMutation.isPending}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Unduh Sertifikat
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  navigator.share?.({
                    title: certificate.title,
                    text: `Verifikasi sertifikat ${certificate.student?.name}`,
                    url: window.location.href,
                  });
                }}
              >
                <Share2 className="mr-2 h-4 w-4" />
                Bagikan
              </Button>
            </div>

            {/* Verification Info */}
            <div className="bg-muted/30 rounded-lg p-4 text-center text-sm text-muted-foreground">
              <p>
                Verifikasi dilakukan pada{" "}
                {safeFormat(new Date(), "dd MMMM yyyy 'pukul' HH:mm", {
                  locale: id,
                })}
              </p>
              <p className="mt-1">Kode: {resolvedParams.code}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}

const certificateTypeLabels: Record<string, string> = {
  IJAZAH: "Ijazah",
  STTB: "STTB",
  TAHFIDZ: "Sertifikat Tahfidz",
  SANAD: "Sanad Hafidz",
  ACHIEVEMENT: "Piagam Prestasi",
  GRADUATION: "Sertifikat Kelulusan",
  PARTICIPATION: "Sertifikat Partisipasi",
  OTHER: "Sertifikat",
};
