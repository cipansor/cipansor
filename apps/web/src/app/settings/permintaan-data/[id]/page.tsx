"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDataSubjectRequest,
  useUpdateDataSubjectRequestStatus,
} from "@/hooks/use-data-subject-requests";
import { PERMISSIONS } from "@/constants/permissions";
import { safeFormat } from "@/lib/date";
import {
  DATA_SUBJECT_REQUEST_STATUSES,
  DATA_SUBJECT_REQUEST_STATUS_LABELS,
  DATA_SUBJECT_REQUEST_TYPE_LABELS,
  type DataSubjectRequestStatus,
} from "@cipansor/shared";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Satu permintaan bagi petugas pelindungan data pribadi, beserta tindakannya.
 *
 * Riwayat ditampilkan utuh: yang menjadikan alur ini bukti kepatuhan bukan
 * status terakhir, melainkan catatan siapa memindahkan apa, kapan, dan dengan
 * alasan apa (Pasal 33 menuntut alasan penolakan ada).
 *
 * Salinan data untuk permintaan akses datang SEKALI pada jawaban penutupan dan
 * ditampilkan di sini, tidak disimpan: salinan data pribadi yang tinggal di
 * peramban atau cache akan hidup lebih lama daripada alasan ia dibuat.
 */
export default function DataSubjectRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data, isLoading } = useDataSubjectRequest(id);
  const updateStatus = useUpdateDataSubjectRequestStatus();

  const [nextStatus, setNextStatus] = useState<DataSubjectRequestStatus | "">(
    "",
  );
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [exportPayload, setExportPayload] = useState<unknown>(null);

  // Permintaan publik yang belum terverifikasi hanya boleh ditolak atau
  // diverifikasi luring. Peladen menolak status lain (memindahkannya memutus
  // langkah verifikasi), jadi pilihannya dibatasi di sini alih-alih
  // menawarkan langkah yang pasti dijawab 409.
  const unverifiedPublic = !!data?.isPublic && !data?.verifiedAt;
  const selectableStatuses: DataSubjectRequestStatus[] = unverifiedPublic
    ? ["VERIFIED", "REJECTED"]
    : [...DATA_SUBJECT_REQUEST_STATUSES];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!id || !nextStatus) return;
    setFailure(null);
    try {
      const result = await updateStatus.mutateAsync({
        id,
        payload: { status: nextStatus, ...(note.trim() ? { note } : {}) },
      });
      const exported = (result as { exportPayload?: unknown }).exportPayload;
      if (exported) {
        setExportPayload(exported);
      }
      setNote("");
      setNextStatus("");
      toast.success("Status permintaan diperbarui");
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ??
        "Status tidak dapat diperbarui. Silakan coba lagi.";
      setFailure(message);
    }
  };

  return (
    <MainLayout allowedPermissions={[PERMISSIONS.PDP_MANAGE]}>
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Button asChild variant="ghost" size="sm">
          <Link href="/settings/permintaan-data">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Kembali ke daftar
          </Link>
        </Button>

        {isLoading || !data ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  {DATA_SUBJECT_REQUEST_TYPE_LABELS[data.type]}
                </h1>
                <p className="font-mono text-sm text-muted-foreground">
                  {data.requestNo}
                </p>
              </div>
              <Badge
                variant={
                  data.status === "COMPLETED"
                    ? "default"
                    : data.status === "REJECTED"
                      ? "destructive"
                      : "secondary"
                }
              >
                {DATA_SUBJECT_REQUEST_STATUS_LABELS[data.status]}
              </Badge>
            </div>

            {data.overdue && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription>
                  Tenggat sudah lewat. Selesaikan dan catat alasannya pada
                  riwayat tindakan.
                </AlertDescription>
              </Alert>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Ringkasan permintaan</CardTitle>
                <CardDescription>
                  Tenggat: {safeFormat(data.dueAt, "d MMMM yyyy HH:mm")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  <span className="text-muted-foreground">Subjek: </span>
                  {data.subjectLabel}
                </p>
                <p>
                  <span className="text-muted-foreground">Pemohon: </span>
                  {data.requesterName}
                  {data.requesterRelation ? ` (${data.requesterRelation})` : ""}
                </p>
                <p>
                  <span className="text-muted-foreground">Kontak: </span>
                  {data.requesterContact}
                </p>
                <div>
                  <p className="text-muted-foreground">Rincian</p>
                  <p className="whitespace-pre-wrap">{data.detail}</p>
                </div>
                {data.rejectionReason && (
                  <p>
                    <span className="text-muted-foreground">
                      Alasan penolakan:{" "}
                    </span>
                    {data.rejectionReason}
                  </p>
                )}
              </CardContent>
            </Card>

            {exportPayload !== null && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    Salinan data yang diserahkan
                  </CardTitle>
                  <CardDescription>
                    Ditampilkan sekali, di sini. Tidak disimpan di mana pun —
                    salin dan serahkan lewat kanal yang aman.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 text-xs">
                    {JSON.stringify(exportPayload, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Riwayat tindakan</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-4">
                  {data.actions.map((action, index) => (
                    <li key={index} className="border-l-2 pl-4">
                      <p className="text-sm font-medium">
                        {action.from
                          ? `${DATA_SUBJECT_REQUEST_STATUS_LABELS[action.from]} → ${DATA_SUBJECT_REQUEST_STATUS_LABELS[action.to]}`
                          : DATA_SUBJECT_REQUEST_STATUS_LABELS[action.to]}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {action.byName} ·{" "}
                        {safeFormat(action.at, "d MMM yyyy HH:mm")}
                      </p>
                      {action.note && (
                        <p className="mt-1 text-sm">{action.note}</p>
                      )}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            {data.status !== "COMPLETED" && data.status !== "REJECTED" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Pindahkan status</CardTitle>
                  <CardDescription>
                    Alasan wajib diisi bila permintaan ditolak (Pasal 33).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="dsr-status">Status berikutnya</Label>
                      <Select
                        value={nextStatus}
                        onValueChange={(v) =>
                          setNextStatus(v as DataSubjectRequestStatus)
                        }
                      >
                        <SelectTrigger id="dsr-status">
                          <SelectValue placeholder="Pilih status" />
                        </SelectTrigger>
                        <SelectContent>
                          {selectableStatuses.map((value) => (
                            <SelectItem key={value} value={value}>
                              {DATA_SUBJECT_REQUEST_STATUS_LABELS[value]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="dsr-note">
                        Catatan / alasan penolakan
                      </Label>
                      <Textarea
                        id="dsr-note"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={4}
                        maxLength={2000}
                      />
                    </div>

                    {failure && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                        <AlertDescription>{failure}</AlertDescription>
                      </Alert>
                    )}

                    <Button
                      type="submit"
                      disabled={updateStatus.isPending || !nextStatus}
                    >
                      {updateStatus.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Menyimpan…
                        </>
                      ) : (
                        "Simpan status"
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </MainLayout>
  );
}
