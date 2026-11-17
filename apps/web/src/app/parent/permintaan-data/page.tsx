"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCreateDataSubjectRequest,
  useMyDataSubjectRequests,
} from "@/hooks/use-data-subject-requests";
import { useParentChildren } from "@/hooks/use-parent-portal";
import { useAuthStore } from "@/stores/auth";
import { safeFormat } from "@/lib/date";
import {
  DATA_SUBJECT_REQUEST_STATUS_LABELS,
  DATA_SUBJECT_REQUEST_TYPES,
  DATA_SUBJECT_REQUEST_TYPE_LABELS,
  type DataSubjectRequestType,
} from "@cipansor/shared";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

/** Nilai sentinel untuk "data saya sendiri" pada pemilih subjek. */
const SELF = "self";

/**
 * Hak subjek data bagi wali yang sudah punya akun (UU 27/2022 Pasal 30, 40,
 * 43).
 *
 * Permukaannya berbeda dari formulir publik dengan alasan yang keras: wali yang
 * sudah masuk tidak perlu membuktikan dirinya lewat kode ke kontak terdaftar —
 * peladen memeriksa tautan `StudentParent` untuk santri tanggungannya, dan
 * tautan itu tidak dapat dipalsukan dengan menebak nomor. Karena itu tidak ada
 * Turnstile dan tidak ada langkah verifikasi di sini.
 *
 * `subjectCategory` GUARDIAN dengan `subjectStudentId` kosong berarti wali
 * meminta datanya SENDIRI; STUDENT mewajibkan santri yang ditunjuk. Pilihan itu
 * dikirim apa adanya — layanan yang memutuskan sah atau tidak, dan menolaknya
 * dengan pesan yang dapat dibaca.
 */
export default function ParentDataRequestPage() {
  const { user } = useAuthStore();
  const { data: children, isLoading: childrenLoading } = useParentChildren();
  const { data: mine, isLoading: mineLoading } = useMyDataSubjectRequests(
    user?.id,
  );
  const create = useCreateDataSubjectRequest();

  const [subject, setSubject] = useState<string>(SELF);
  const [type, setType] = useState<DataSubjectRequestType>("ACCESS");
  const [relation, setRelation] = useState("");
  const [detail, setDetail] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFailure(null);
    const isSelf = subject === SELF;
    try {
      await create.mutateAsync({
        type,
        subjectCategory: isSelf ? "GUARDIAN" : "STUDENT",
        ...(isSelf ? {} : { subjectStudentId: subject }),
        detail,
        ...(relation.trim() ? { requesterRelation: relation.trim() } : {}),
      });
      setDetail("");
      setRelation("");
      setSubject(SELF);
      setType("ACCESS");
      toast.success("Permintaan Anda tercatat");
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ??
        "Permintaan tidak dapat dikirim. Silakan coba lagi.";
      setFailure(message);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Permintaan Data Pribadi
        </h1>
        <p className="text-muted-foreground">
          Ajukan permintaan akses, perbaikan, penghapusan, atau penarikan
          persetujuan atas data Anda atau data anak Anda (UU PDP No. 27 Tahun
          2022). Akses, perbaikan, dan penarikan persetujuan ditenggat 3×24 jam.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Permintaan baru</CardTitle>
          <CardDescription>
            Kami menghubungi Anda melalui kontak akun ini, dan mencatat
            tenggatnya begitu permintaan masuk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dsr-subject">Untuk data siapa</Label>
              <Select value={subject} onValueChange={setSubject}>
                <SelectTrigger id="dsr-subject">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SELF}>Data saya sendiri</SelectItem>
                  {(children ?? []).map((child) => (
                    <SelectItem key={child.id} value={child.id}>
                      {child.name} — {child.nis}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {childrenLoading && (
                <Skeleton className="h-4 w-40" aria-hidden="true" />
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="dsr-type">Jenis permintaan</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as DataSubjectRequestType)}
              >
                <SelectTrigger id="dsr-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATA_SUBJECT_REQUEST_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {DATA_SUBJECT_REQUEST_TYPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dsr-relation">Hubungan dengan subjek</Label>
              <Input
                id="dsr-relation"
                value={relation}
                onChange={(e) => setRelation(e.target.value)}
                placeholder="mis. Ayah, Ibu, Wali"
                maxLength={50}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dsr-detail">Rincian permintaan</Label>
              <Textarea
                id="dsr-detail"
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={5}
                required
                minLength={10}
                maxLength={5000}
                placeholder="Jelaskan data apa yang Anda maksud dan apa yang Anda minta."
              />
            </div>

            {failure && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Mengirim…
                </>
              ) : (
                "Kirim permintaan"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Permintaan saya</CardTitle>
          <CardDescription>
            Status dan tenggat permintaan yang pernah Anda ajukan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nomor</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead>Subjek</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tenggat</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mineLoading ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                </TableRow>
              ) : (mine ?? []).length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Belum ada permintaan.
                  </TableCell>
                </TableRow>
              ) : (
                (mine ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">
                      {row.requestNo}
                    </TableCell>
                    <TableCell>
                      {DATA_SUBJECT_REQUEST_TYPE_LABELS[row.type]}
                    </TableCell>
                    <TableCell>{row.subjectLabel}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.status === "COMPLETED"
                            ? "default"
                            : row.status === "REJECTED"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {DATA_SUBJECT_REQUEST_STATUS_LABELS[row.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          row.overdue
                            ? "inline-flex items-center gap-1 font-medium text-destructive"
                            : undefined
                        }
                      >
                        {row.overdue && (
                          <AlertTriangle
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                        )}
                        {safeFormat(row.dueAt, "d MMM yyyy HH:mm")}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
