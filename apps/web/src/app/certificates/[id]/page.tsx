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
  useCertificate,
  useDeleteCertificate,
  useDownloadCertificate,
} from "@/hooks/use-certificate";
import { useCreateSanad } from "@/hooks/use-takhosus";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import {
  ArrowLeft,
  Award,
  User,
  Calendar,
  FileText,
  Download,
  Share2,
  Edit,
  Trash2,
  QrCode,
  ExternalLink,
  AlertTriangle,
  Eye,
  Copy,
  Loader2,
  CheckCircle,
} from "lucide-react";
import Image from "next/image";

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

export default function CertificateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();

  const {
    data: certificate,
    isLoading,
    error,
  } = useCertificate(resolvedParams.id);
  const deleteMutation = useDeleteCertificate();
  const downloadMutation = useDownloadCertificate();

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(resolvedParams.id);
      toast.success("Sertifikat berhasil dihapus");
      router.push("/certificates");
    } catch {
      toast.error("Gagal menghapus sertifikat");
    }
  };

  /**
   * Download the rendered PDF as a file. The API answers with the bytes (not a
   * URL), so they are turned into a blob URL here and revoked once the click
   * has happened; leaving it alive would pin the file in memory for the
   * document's lifetime.
   */
  const handleDownloadPDF = async () => {
    try {
      const blob = await downloadMutation.mutateAsync(resolvedParams.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sertifikat-${certificate?.certificateNumber?.replace(/[^A-Za-z0-9]+/g, "-") ?? resolvedParams.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Sertifikat berhasil diunduh");
    } catch {
      toast.error("Gagal mengunduh PDF sertifikat");
    }
  };

  const handleCopyLink = () => {
    if (certificate?.verificationUrl) {
      navigator.clipboard.writeText(certificate.verificationUrl);
      toast.success("Link verifikasi disalin ke clipboard");
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

  if (error || !certificate) {
    return (
      <MainLayout>
        <div className="text-center py-12">
          <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
          <h2 className="mt-4 text-lg font-semibold">Data Tidak Ditemukan</h2>
          <p className="text-muted-foreground">Sertifikat tidak ditemukan</p>
          <Button className="mt-4" onClick={() => router.push("/certificates")}>
            Kembali ke Daftar
          </Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push("/certificates")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <PageHeader
              title="Detail Sertifikat"
              description={`No. ${certificate.certificateNumber}`}
              icon={Award}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                router.push(`/certificates/${resolvedParams.id}/edit`)
              }
            >
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Hapus
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Hapus Sertifikat?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Tindakan ini tidak dapat dibatalkan. Sertifikat akan dihapus
                    permanen.
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
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Certificate Info Card */}
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>{certificate.title}</CardTitle>
                    <CardDescription>
                      {certificateTypeLabels[certificate.certificateType] ||
                        certificate.certificateType}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={certificate.isPublic ? "default" : "secondary"}
                  >
                    {certificate.isPublic ? "Publik" : "Privat"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Student Info */}
                <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                  <Avatar className="h-16 w-16">
                    <AvatarImage src={certificate.student?.photoUrl} />
                    <AvatarFallback className="text-lg">
                      {certificate.student?.name
                        ?.substring(0, 2)
                        .toUpperCase() || "ST"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="text-lg font-semibold">
                      {certificate.student?.name ||
                        certificate.student?.user?.name ||
                        "N/A"}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {certificate.student?.nis || "-"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {certificate.student?.class?.name || "-"}
                    </p>
                  </div>
                </div>

                <Separator />

                {/* Details */}
                <div className="grid gap-4 md:grid-cols-2">
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
                          "dd MMMM yyyy",
                          { locale: idLocale },
                        )}
                      </p>
                    </div>
                  </div>

                  {certificate.grade && (
                    <div className="flex items-start gap-3">
                      <Award className="h-5 w-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Predikat/Nilai
                        </p>
                        <Badge variant="secondary">{certificate.grade}</Badge>
                      </div>
                    </div>
                  )}

                  {certificate.rank && (
                    <div className="flex items-start gap-3">
                      <Award className="h-5 w-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Peringkat
                        </p>
                        <p className="font-medium">
                          Peringkat {certificate.rank}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Signatory */}
                <div>
                  <h4 className="font-medium mb-3">Penandatangan</h4>
                  <div className="flex items-center gap-4">
                    {certificate.signatureUrl && (
                      <div className="w-24 h-16 bg-muted rounded relative overflow-hidden">
                        <Image
                          src={certificate.signatureUrl}
                          alt="Tanda tangan"
                          fill
                          className="object-contain"
                        />
                      </div>
                    )}
                    <div>
                      <p className="font-medium">{certificate.signatoryName}</p>
                      <p className="text-sm text-muted-foreground">
                        {certificate.signatoryTitle}
                      </p>
                    </div>
                  </div>
                </div>

                {certificate.description && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="font-medium mb-2">Keterangan</h4>
                      <p className="text-muted-foreground">
                        {certificate.description}
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Preview Card */}
            {certificate.thumbnailUrl && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Eye className="h-5 w-5" />
                    Preview Sertifikat
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="relative aspect-[1.414/1] bg-muted rounded-lg overflow-hidden">
                    <Image
                      src={certificate.thumbnailUrl}
                      alt="Preview sertifikat"
                      fill
                      className="object-contain"
                    />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* QR Code Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <QrCode className="h-5 w-5" />
                  QR Verifikasi
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-white p-4 rounded-lg flex items-center justify-center">
                  {/* Placeholder for QR Code - in real implementation use qrcode library */}
                  <div className="w-32 h-32 bg-muted rounded flex items-center justify-center text-muted-foreground">
                    <QrCode className="h-16 w-16" />
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-2">
                    Kode Verifikasi
                  </p>
                  <p className="font-mono text-sm">{certificate.qrCode}</p>
                </div>
              </CardContent>
            </Card>

            {/* Actions Card */}
            <Card>
              <CardHeader>
                <CardTitle>Aksi</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  className="w-full"
                  onClick={handleDownloadPDF}
                  disabled={downloadMutation.isPending}
                >
                  {downloadMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Download PDF
                </Button>

                <Button variant="outline" className="w-full" asChild>
                  <a
                    href={certificate.verificationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Buka Link Verifikasi
                  </a>
                </Button>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleCopyLink}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Salin Link
                </Button>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    navigator.share?.({
                      title: certificate.title,
                      text: `Sertifikat ${certificate.student?.name}`,
                      url: certificate.verificationUrl,
                    });
                  }}
                >
                  <Share2 className="mr-2 h-4 w-4" />
                  Bagikan
                </Button>
              </CardContent>
            </Card>

            {/* Stats Card */}
            <Card>
              <CardHeader>
                <CardTitle>Statistik</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total Download</span>
                  <span className="font-medium">
                    {certificate.downloadCount}x
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Dibuat pada</span>
                  <span className="font-medium">
                    {safeFormat(
                      new Date(certificate.createdAt),
                      "dd MMM yyyy",
                      {
                        locale: idLocale,
                      },
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Dibuat oleh</span>
                  <span className="font-medium">
                    {certificate.createdBy?.name || "-"}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
