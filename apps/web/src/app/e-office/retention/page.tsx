"use client";

import { useState } from "react";
import {
  useLetterRetention,
  fetchRetentionCsv,
} from "@/hooks/use-correspondence";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Download, ArchiveX, AlertTriangle, FileSearch } from "lucide-react";
import { toast } from "sonner";
import { objectUrlForBlob, releaseObjectUrl } from "@/lib/files";
import { safeFormat } from "@/lib/date";

/**
 * Peninjauan Retensi Arsip.
 *
 * Halaman ini menjawab satu pertanyaan yang sampai sekarang hanya terjawab di
 * log penjadwal: **naskah mana yang masa retensinya sudah lewat?** Tanpa layar
 * ini, laporan mingguan yang benar-benar berjalan tidak pernah dibaca siapa
 * pun, dan kepatuhan kearsipan hanya ada di atas kertas.
 *
 * **Tidak ada tombol musnah, dan itu disengaja.** Memusnahkan arsip bukan
 * pekerjaan satu klik: JRA adalah instrumen yang disahkan, dan pemusnahan
 * menuntut penilaian serta berita acara (UU 43/2009 Pasal 51–52 dan PP 28/2012). Yang
 * disediakan halaman ini adalah daftar usul dan ekspornya untuk dibawa ke
 * rapat penilaian — keputusan tetap di tangan manusia.
 *
 * Cakupan daftarnya sudah dibatasi peladen (`letterScopeWhere`), jadi seorang
 * Tata Usaha satu sekolah tidak melihat perihal naskah Rahasia unit lain.
 */
export default function RetentionPage() {
  const { data, isLoading, isError } = useLetterRetention();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await fetchRetentionCsv();
      const url = objectUrlForBlob(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Peninjauan-Retensi.csv";
      document.body.appendChild(a);
      a.click();
      releaseObjectUrl(url);
      document.body.removeChild(a);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Gagal mengekspor daftar retensi",
      );
    } finally {
      setExporting(false);
    }
  };

  const due = data?.due ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Peninjauan Retensi Arsip
          </h1>
          <p className="text-muted-foreground">
            Naskah yang masa retensinya sudah lewat, menurut klasifikasi
            arsipnya — daftar usul untuk dinilai, bukan untuk dimusnahkan
            otomatis.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Mengekspor…" : "Ekspor CSV"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSearch className="h-5 w-5" />
            Ringkasan
          </CardTitle>
          <CardDescription>
            Yang dihitung hanya surat berklasifikasi dengan status terbit.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-6">
          <div>
            <div className="text-3xl font-bold">{due.length}</div>
            <div className="text-sm text-muted-foreground">
              Naskah lewat retensi
            </div>
          </div>
          <div>
            <div className="text-3xl font-bold">
              {data?.consideredCount ?? 0}
            </div>
            <div className="text-sm text-muted-foreground">
              Naskah berklasifikasi diperiksa
            </div>
          </div>
          <div>
            <div className="text-3xl font-bold">
              {data?.missingRetention ?? 0}
            </div>
            <div className="text-sm text-muted-foreground">
              Tanpa nilai retensi (kekosongan JRA)
            </div>
          </div>
        </CardContent>
      </Card>

      {(data?.missingRetention ?? 0) > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Ada naskah terarsip yang klasifikasinya belum punya masa retensi.
            Itu kekosongan JRA, bukan alasan memusnahkan: lengkapi
            klasifikasinya lebih dulu.
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArchiveX className="h-5 w-5" />
            Naskah Lewat Retensi
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">
              Memuat…
            </div>
          ) : isError ? (
            <div className="py-8 text-center text-muted-foreground">
              Daftar retensi tidak dapat dimuat.
            </div>
          ) : due.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              Tidak ada naskah yang lewat masa retensinya.
            </div>
          ) : (
            <div className="relative w-full overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nomor</TableHead>
                    <TableHead>Perihal</TableHead>
                    <TableHead>Klasifikasi</TableHead>
                    <TableHead>Masa Retensi</TableHead>
                    <TableHead>Retensi Berakhir</TableHead>
                    <TableHead>Sifat</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {due.map((letter) => (
                    <TableRow key={letter.id}>
                      <TableCell className="font-medium">
                        {letter.letterNumber || letter.agendaNumber || "—"}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {letter.subject}
                      </TableCell>
                      <TableCell>
                        {letter.classificationCode
                          ? `${letter.classificationCode} — ${letter.classificationName ?? ""}`
                          : "—"}
                      </TableCell>
                      <TableCell>{letter.retentionYears} tahun</TableCell>
                      <TableCell>
                        {safeFormat(letter.dueAt, "d MMM yyyy")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{letter.nature}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
