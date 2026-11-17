"use client";

import { useState } from "react";
import Link from "next/link";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDataSubjectRequests } from "@/hooks/use-data-subject-requests";
import { PERMISSIONS } from "@/constants/permissions";
import { safeFormat } from "@/lib/date";
import {
  DATA_SUBJECT_REQUEST_STATUSES,
  DATA_SUBJECT_REQUEST_STATUS_LABELS,
  DATA_SUBJECT_REQUEST_TYPES,
  DATA_SUBJECT_REQUEST_TYPE_LABELS,
  type DataSubjectRequestStatus,
  type DataSubjectRequestType,
} from "@cipansor/shared";
import { AlertTriangle, ChevronRight } from "lucide-react";

/**
 * Daftar kerja petugas pelindungan data pribadi (UU 27/2022 Pasal 30, 35, 40,
 * 43).
 *
 * Layar ini SATU-satunya tempat tenggat 3×24 jam terlihat. Permintaan yang
 * hampir lewat dan yang sudah lewat ditandai di barisnya, bukan disembunyikan
 * di balik penyaring: petugas yang membuka halaman ini harus langsung tahu mana
 * yang harus dikerjakan hari ini.
 *
 * `PDP_MANAGE` yang menjaganya — bukan jabatan. Yayasan menunjuk petugas
 * beserta penggantinya (Pasal 53), dan penunjukan itu berpindah orang tanpa
 * berpindah jabatan struktural. Karena itu `allowedPermissions`, bukan
 * `allowedRoles`: pemegangnya boleh berasal dari peran mana pun.
 */
export default function DataSubjectRequestsPage() {
  const [status, setStatus] = useState<string>("ALL");
  const [type, setType] = useState<string>("ALL");
  const [openOnly, setOpenOnly] = useState(true);

  const { data, isLoading } = useDataSubjectRequests({
    status: status === "ALL" ? undefined : (status as DataSubjectRequestStatus),
    type: type === "ALL" ? undefined : (type as DataSubjectRequestType),
    openOnly,
    limit: 50,
  });

  const rows = data?.data ?? [];

  return (
    <MainLayout allowedPermissions={[PERMISSIONS.PDP_MANAGE]}>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Permintaan Data Pribadi
          </h1>
          <p className="text-muted-foreground">
            Tindak lanjuti permintaan akses, perbaikan, penghapusan, dan
            penarikan persetujuan atas data pribadi (UU PDP No. 27 Tahun 2022).
            Akses, perbaikan, dan penarikan persetujuan ditenggat 3×24 jam.
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          <Select value={status} onValueChange={(val) => setStatus(val)}>
            <SelectTrigger className="w-[200px]" aria-label="Saring status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Semua status</SelectItem>
              {DATA_SUBJECT_REQUEST_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {DATA_SUBJECT_REQUEST_STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={type} onValueChange={(val) => setType(val)}>
            <SelectTrigger className="w-[220px]" aria-label="Saring jenis">
              <SelectValue placeholder="Jenis permintaan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Semua jenis</SelectItem>
              {DATA_SUBJECT_REQUEST_TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {DATA_SUBJECT_REQUEST_TYPE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant={openOnly ? "default" : "outline"}
            onClick={() => setOpenOnly((v) => !v)}
            aria-pressed={openOnly}
          >
            Hanya yang belum selesai
          </Button>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nomor</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead>Subjek</TableHead>
                <TableHead>Pemohon</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tenggat</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Tidak ada permintaan pada penyaring ini.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">
                      {row.requestNo}
                    </TableCell>
                    <TableCell>
                      {DATA_SUBJECT_REQUEST_TYPE_LABELS[row.type]}
                    </TableCell>
                    <TableCell>{row.subjectLabel}</TableCell>
                    <TableCell>{row.requesterName}</TableCell>
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
                    <TableCell>
                      <Link
                        href={`/settings/permintaan-data/${row.id}`}
                        aria-label={`Buka permintaan ${row.requestNo}`}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </MainLayout>
  );
}
