"use client";

import { useState, Suspense } from "react";
import {
  TurnstileWidget,
  useTurnstile,
} from "@/components/security/turnstile-widget";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle,
  XCircle,
  Search,
  ShieldCheck,
  Award,
  Calendar,
  User,
  School,
  BookOpen,
  Download,
} from "lucide-react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";
import { useDownloadPublicCertificate } from "@/hooks/use-certificate";

interface VerificationResult {
  valid: boolean;
  message: string;
  data?: {
    certificateNumber: string;
    certificateType: string;
    title: string;
    studentName: string | null;
    grade: string | null;
    issueDate: string;
    unitName: string | null;
    signatoryName: string;
    signatoryTitle: string;
  };
}

function VerifySanadContent() {
  const searchParams = useSearchParams();
  const initialCode = searchParams.get("code") || "";

  const [code, setCode] = useState(initialCode);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const turnstile = useTurnstile();
  const downloadMutation = useDownloadPublicCertificate();

  /**
   * Fetch the verified certificate's PDF and save it.
   *
   * This is the page the printed QR opens (`certificateVerificationUrl`), and
   * the recipient holds only the number — so the bytes come from the
   * session-free `/certificates/public/{code}/download`, which answers only for
   * a certificate marked `isPublic`. A visitor who reaches the portal's
   * `/certificates/verify/[code]` page gets the same file; this is the same
   * flow on the public host. The blob URL is revoked after the click so it does
   * not pin the file in memory.
   */
  const handleDownload = async () => {
    const number = result?.data?.certificateNumber;
    if (!number) return;
    try {
      const blob = await downloadMutation.mutateAsync(number);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sertifikat-${number.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // The axios interceptor already surfaced the error to the visitor.
      setError("Gagal mengunduh sertifikat. Silakan coba lagi.");
    }
  };

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!code.trim()) return;
    if (!turnstile.ready) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await api.post<{ data: VerificationResult }>(
        "/sanad/verify",
        {
          certificateNumber: code.trim(),
          turnstileToken: turnstile.token ?? undefined,
        },
      );
      const verification = response.data.data;
      if (verification.valid) {
        setResult(verification);
      } else {
        setError(verification.message);
      }
    } catch (err: unknown) {
      const axiosError = err as {
        response?: { data?: { error?: { message?: string } } };
      };
      setError(
        axiosError.response?.data?.error?.message ||
          "Terjadi kesalahan saat memverifikasi sertifikat.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container max-w-2xl mx-auto py-12 px-4">
      <div className="text-center mb-8">
        <div className="flex justify-center mb-4">
          <div className="bg-primary/10 p-3 rounded-full">
            <ShieldCheck className="h-10 w-10 text-primary" />
          </div>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          Verifikasi Sertifikat Sanad
        </h1>
        <p className="text-muted-foreground mt-2 text-pretty">
          Periksa keaslian sertifikat Sanad dan Tahfidz yang diterbitkan Yayasan
          Pesantren Cipansor.
        </p>
      </div>

      {/*
        This page was the thinnest on the site (~250 characters) — a form and
        nothing else. Explaining what a sanad is and why verification exists
        gives it standalone value, which is what the Ad Grants content policy
        asks for and what a reader who arrives cold actually needs.
      */}
      <div className="mb-8 space-y-4 text-muted-foreground">
        <p className="leading-relaxed">
          <strong className="text-foreground">Sanad</strong> adalah mata rantai
          periwayatan yang menghubungkan bacaan Al-Qur&rsquo;an seorang santri
          kepada gurunya, guru kepada gurunya, hingga bersambung sampai
          Rasulullah shallallahu &lsquo;alaihi wasallam. Sertifikat sanad
          menjadi bukti bahwa hafalan dan bacaan santri telah disimak serta
          disahkan oleh musyrif yang berwenang.
        </p>
        <p className="leading-relaxed">
          Setiap sertifikat yang diterbitkan Pesantren Cipansor memuat nomor
          unik dan kode verifikasi. Lembaga pendidikan, calon pemberi kerja,
          maupun wali santri dapat memastikan keasliannya di halaman ini tanpa
          perlu menghubungi pesantren terlebih dahulu.
        </p>
      </div>

      <Card className="shadow-lg border-2">
        <CardHeader>
          <CardTitle>Cek Nomor Sertifikat</CardTitle>
          <CardDescription>
            Masukkan nomor sertifikat yang tertera pada bagian bawah dokumen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleVerify} className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Contoh: SANAD-202601-A1B2C3D4"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="flex-1"
              />
              <Button
                type="submit"
                disabled={isLoading || !code.trim() || !turnstile.ready}
              >
                {isLoading ? (
                  "Mengecek..."
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Verifikasi
                  </>
                )}
              </Button>
            </div>

            <TurnstileWidget action="verify-sanad" {...turnstile.widgetProps} />
          </form>

          {error && (
            <div className="mt-6 p-4 bg-destructive/10 text-destructive rounded-lg flex items-start gap-3">
              <XCircle className="h-5 w-5 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Verifikasi Gagal</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          )}

          {result?.valid && result.data && (
            <div className="mt-6 space-y-6">
              <div className="p-4 bg-green-50 text-green-800 border border-green-200 rounded-lg flex items-start gap-3">
                <CheckCircle className="h-5 w-5 mt-0.5 text-green-600 shrink-0" />
                <div>
                  <p className="font-semibold text-lg text-green-700">
                    Sertifikat Terverifikasi
                  </p>
                  <p className="text-sm">{result.message}</p>
                </div>
              </div>

              <div className="grid gap-4 pt-4 border-t">
                <div className="flex items-center gap-3">
                  <User className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Nama Lengkap
                    </p>
                    <p className="font-medium text-lg">
                      {result.data.studentName ?? "-"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <BookOpen className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Sertifikat</p>
                    <p className="font-medium">{result.data.title}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-3">
                    <Award className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Predikat</p>
                      {result.data.grade ? (
                        <Badge
                          variant="outline"
                          className="bg-primary/5 text-primary border-primary/20"
                        >
                          {result.data.grade}
                        </Badge>
                      ) : (
                        <p className="font-medium">-</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Calendar className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Tanggal Terbit
                      </p>
                      <p className="font-medium">
                        {format(
                          new Date(result.data.issueDate),
                          "dd MMMM yyyy",
                          {
                            locale: localeId,
                          },
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <School className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Unit</p>
                    <p className="font-medium">{result.data.unitName ?? "-"}</p>
                  </div>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleDownload}
                disabled={downloadMutation.isPending}
              >
                <Download className="h-4 w-4 mr-2" />
                {downloadMutation.isPending
                  ? "Mengunduh..."
                  : "Unduh Sertifikat (PDF)"}
              </Button>
            </div>
          )}
        </CardContent>
        <CardFooter className="bg-muted/30 text-xs text-center justify-center py-3">
          Sistem Informasi Cipansor &copy; {new Date().getFullYear()}
        </CardFooter>
      </Card>
    </div>
  );
}

function PublicVerifySanadPageContent() {
  return (
    <Suspense fallback={null}>
      <VerifySanadContent />
    </Suspense>
  );
}

export default function PublicVerifySanadPage() {
  return (
    <main id="main-content">
      <PublicVerifySanadPageContent />
    </main>
  );
}
