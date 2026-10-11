"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { id as localeId } from "date-fns/locale";
import { safeFormat } from "@/lib/date";
import { useAuth } from "@/hooks/use-auth";
import { useCorrespondence, fetchAgendaCsv } from "@/hooks/use-correspondence";
import { objectUrlForBlob, releaseObjectUrl } from "@/lib/files";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { LetterStatusBadge } from "@/components/e-office/letter-status-badge";
import {
  LETTER_NATURE_LABELS,
  LETTER_URGENCY_LABELS,
  LetterDirection,
  LetterNature,
  LetterStatus,
  LetterUrgency,
  letterPartyName,
  type LetterDetail,
} from "@cipansor/shared";
import { Inbox, Plus, Search, Send, Download } from "lucide-react";
import { toast } from "sonner";

/**
 * Buku agenda surat — satu daftar, dipakai surat masuk dan surat keluar.
 *
 * Sebelumnya `/e-office/outbox` hanya me-render ulang komponen inbox, yang
 * memulai arahnya pada INCOMING dari state internalnya. Akibatnya menu "Surat
 * Keluar" membuka daftar **surat masuk**, dan satu-satunya cara sampai ke surat
 * keluar adalah menekan kartu di dalam halaman. Arah kini ditentukan rutenya —
 * itulah yang dijanjikan alamatnya — dan komponen ini tidak menyimpan arah
 * sebagai state sama sekali.
 *
 * Yang lain yang diperbaiki di sini, semuanya terlihat sekali daftar ini
 * benar-benar dibuka:
 *
 * - Kolom berjudul **Sifat** menampilkan `letter.urgency`. Sifat dan derajat
 *   kecepatan adalah dua hal yang berbeda dan keduanya tercetak pada naskah
 *   dinas; sekarang keduanya punya kolom sendiri, dengan istilah Indonesia
 *   yang sama dengan formulir pembuatannya.
 * - Nilainya tampil sebagai enum mentah berbahasa Inggris — `IMMEDIATE`,
 *   `NORMAL` — kepada petugas tata usaha.
 * - `page` dan `setPage` ada, tombol halamannya tidak pernah dirender. Dengan
 *   `limit: 10`, surat ke-11 dan seterusnya tidak dapat dicapai sama sekali.
 * - Pencarian menembak satu permintaan per ketukan tombol.
 * - Dua kartu besar bertuliskan "Inbox" dan "Outbox" sebagai *angka* statistik
 *   — kerangka kartu KPI tanpa satu pun angka di dalamnya.
 */

const STATUS_LABEL: Record<string, string> = {
  ALL: "Semua status",
  [LetterStatus.DRAFT]: "Konsep",
  [LetterStatus.PENDING_REVIEW]: "Menunggu review",
  [LetterStatus.REVISION_NEEDED]: "Perlu revisi",
  [LetterStatus.READY_TO_SIGN]: "Siap tanda tangan",
  [LetterStatus.SIGNED]: "Sudah ditandatangani",
  [LetterStatus.SENT]: "Terkirim",
  [LetterStatus.DISPOSED]: "Didisposisikan",
  [LetterStatus.ARCHIVED]: "Diarsipkan",
};

/** Status yang masuk akal disaring per arah surat. */
const STATUSES: Record<LetterDirection, LetterStatus[]> = {
  [LetterDirection.INCOMING]: [
    LetterStatus.PENDING_REVIEW,
    LetterStatus.DISPOSED,
    LetterStatus.ARCHIVED,
  ],
  [LetterDirection.OUTGOING]: [
    LetterStatus.DRAFT,
    LetterStatus.PENDING_REVIEW,
    LetterStatus.REVISION_NEEDED,
    LetterStatus.READY_TO_SIGN,
    LetterStatus.SIGNED,
    LetterStatus.SENT,
    LetterStatus.ARCHIVED,
  ],
};

const URGENCY_TONE: Record<LetterUrgency, string> = {
  [LetterUrgency.URGENT]: "border-red-300 bg-red-50 text-red-700",
  [LetterUrgency.IMMEDIATE]: "border-orange-300 bg-orange-50 text-orange-700",
  [LetterUrgency.NORMAL]: "border-slate-200 bg-slate-50 text-slate-600",
};

/** Banyaknya baris per halaman yang boleh dipilih petugas. */
const PAGE_SIZES = [10, 25, 50, 100] as const;

const NATURE_TONE: Record<LetterNature, string> = {
  [LetterNature.PUBLIC]: "border-slate-200 bg-slate-50 text-slate-600",
  [LetterNature.LIMITED]: "border-amber-300 bg-amber-50 text-amber-700",
  [LetterNature.CONFIDENTIAL]: "border-rose-300 bg-rose-50 text-rose-700",
  [LetterNature.STRICTLY_CONFIDENTIAL]:
    "border-rose-500 bg-rose-100 text-rose-800",
};

const COPY = {
  [LetterDirection.INCOMING]: {
    title: "Surat Masuk",
    lead: "Buku agenda surat masuk — surat yang diterima yayasan, beserta disposisinya.",
    party: "Pengirim",
    empty: "Belum ada surat masuk yang tercatat.",
    otherHref: "/e-office/outbox",
    otherLabel: "Lihat surat keluar",
  },
  [LetterDirection.OUTGOING]: {
    title: "Surat Keluar",
    lead: "Buku agenda surat keluar — naskah dinas yang diterbitkan yayasan.",
    party: "Tujuan",
    empty: "Belum ada surat keluar yang tercatat.",
    otherHref: "/e-office/inbox",
    otherLabel: "Lihat surat masuk",
  },
} as const;

export interface LetterListProps {
  direction: LetterDirection;
  /** Kunci daftarnya pada satu status — dipakai halaman arsip. */
  fixedStatus?: LetterStatus;
  /** Ganti judul dan kalimat pengantarnya; arah tetap menentukan sisanya. */
  heading?: { title: string; lead: string };
  /** Sembunyikan tautan silang ke arah sebaliknya. */
  hideCrossLink?: boolean;
}

export function LetterList({
  direction,
  fixedStatus,
  heading,
  hideCrossLink,
}: LetterListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const copy = COPY[direction];

  const initialStatus = searchParams.get("status")?.toUpperCase() ?? "ALL";
  const [status, setStatus] = useState<string>(
    STATUSES[direction].includes(initialStatus as LetterStatus)
      ? initialStatus
      : "ALL",
  );
  const [page, setPage] = useState(1);
  // `?scope=personal` is what the dashboard's "Disposisi" tile asks for: the
  // letters this official personally has to act on.
  const [scope, setScope] = useState<"ALL" | "PERSONAL">(
    searchParams.get("scope")?.toUpperCase() === "PERSONAL"
      ? "PERSONAL"
      : "ALL",
  );
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // Banyaknya baris per halaman. Sebelumnya tetap 10, sehingga buku agenda
  // yang seharusnya dilihat sebagai satu lembar kerja terpaksa disusuri
  // sepuluh baris sekaligus. Pilihannya sengaja kecil dan tetap — sebuah
  // buku agenda dibaca, bukan ditelusuri tanpa batas.
  const [limit, setLimit] = useState(10);

  const effectiveStatus =
    fixedStatus ?? (status === "ALL" ? undefined : (status as LetterStatus));

  // One request when the typing stops, not one per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Any change of filter invalidates the page number: page 3 of the old result
  // is rarely page 3 of the new one, and is often past its end.
  useEffect(() => setPage(1), [search, status, scope, direction, limit]);

  const { useLetters } = useCorrespondence(user?.unitId);
  const { data, isLoading } = useLetters({
    page,
    limit,
    direction,
    status: effectiveStatus,
    search: search || undefined,
    scope,
  });

  const rows: LetterDetail[] = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = Math.max(1, meta?.totalPages ?? 1);
  const total = meta?.total ?? rows.length;

  const range = useMemo(() => {
    if (total === 0) return null;
    const from = (page - 1) * limit + 1;
    return `${from}–${Math.min(page * limit, total)} dari ${total}`;
  }, [page, total, limit]);

  /**
   * Buku agenda yang dapat diserahkan — CSV dari penyaring yang sedang dilihat.
   *
   * Diekspor dengan saringan yang sama persis dengan yang tampil di layar:
   * sebuah "ekspor" yang diam-diam mengembalikan seluruh riwayat akan membuat
   * petugas menyerahkan berkas yang tidak sesuai dengan yang ia periksa.
   */
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await fetchAgendaCsv({
        direction,
        status: effectiveStatus,
        search: search || undefined,
        scope,
      });
      const url = objectUrlForBlob(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Buku-Agenda-${direction === LetterDirection.INCOMING ? "Masuk" : "Keluar"}.csv`;
      document.body.appendChild(a);
      a.click();
      releaseObjectUrl(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Gagal mengekspor buku agenda",
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {heading?.title ?? copy.title}
          </h1>
          <p className="text-muted-foreground">{heading?.lead ?? copy.lead}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!hideCrossLink && (
            <Button variant="outline" asChild>
              <Link href={copy.otherHref}>
                {direction === LetterDirection.INCOMING ? (
                  <Send className="mr-2 h-4 w-4" />
                ) : (
                  <Inbox className="mr-2 h-4 w-4" />
                )}
                {copy.otherLabel}
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            <Download className="mr-2 h-4 w-4" />
            {exporting ? "Mengekspor…" : "Ekspor Buku Agenda"}
          </Button>
          <Button
            onClick={() =>
              router.push(
                `/e-office/create?direction=${direction.toLowerCase()}`,
              )
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            Buat Surat
          </Button>
        </div>
      </div>

      {/* Disposisi hanya ada pada surat masuk, jadi penyaringnya pun begitu. */}
      {direction === LetterDirection.INCOMING && !fixedStatus && (
        <Tabs
          value={scope}
          onValueChange={(v) => setScope(v as "ALL" | "PERSONAL")}
        >
          <TabsList>
            <TabsTrigger value="ALL">Semua surat unit</TabsTrigger>
            <TabsTrigger value="PERSONAL">Disposisi untuk saya</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Cari perihal atau nomor surat…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Cari surat"
          />
        </div>
        {!fixedStatus && (
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger
              className="w-full sm:w-56"
              aria-label="Saring menurut status"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{STATUS_LABEL.ALL}</SelectItem>
              {STATUSES[direction].map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select
          value={String(limit)}
          onValueChange={(v) => setLimit(Number(v))}
        >
          <SelectTrigger
            className="w-full sm:w-40"
            aria-label="Banyaknya baris per halaman"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} per halaman
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {range && (
          <span className="text-sm text-muted-foreground sm:ml-auto">
            {range} surat
          </span>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nomor / Agenda</TableHead>
                  <TableHead>Perihal</TableHead>
                  <TableHead>{copy.party}</TableHead>
                  <TableHead>Tanggal</TableHead>
                  {/* Sifat dan urgensi berbagi satu kolom.
                      Keduanya wajib tampil — sifat menentukan siapa boleh
                      membacanya, urgensi menentukan kapan harus dijawab — tetapi
                      tujuh kolom tidak muat di lebar isi yang tersisa setelah
                      bilah samping, dan yang terdorong keluar adalah Status,
                      kolom yang paling sering dicari petugas. */}
                  <TableHead>Sifat / Urgensi</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      Memuat data…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-24 text-center text-muted-foreground"
                    >
                      {search || effectiveStatus
                        ? "Tidak ada surat yang cocok dengan penyaring ini."
                        : copy.empty}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((letter) => {
                    const classification = letter.classification
                      ? `${letter.classification.code} — ${letter.classification.name}`
                      : null;
                    return (
                      <TableRow
                        key={letter.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() =>
                          router.push(`/e-office/letter/${letter.id}`)
                        }
                      >
                        <TableCell className="font-medium whitespace-nowrap">
                          {letter.letterNumber || letter.agendaNumber || "—"}
                        </TableCell>
                        <TableCell className="max-w-[22rem]">
                          <span className="font-medium">{letter.subject}</span>
                          {/* Kode klasifikasi hanya ditulis bila memang ada;
                              sebelumnya barisnya selalu dirender dan berbunyi
                              " - " untuk surat yang belum diklasifikasi. */}
                          {classification && (
                            <span className="block text-xs text-muted-foreground">
                              {classification}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{letterPartyName(letter) || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {safeFormat(new Date(letter.date), "dd MMM yyyy", {
                            locale: localeId,
                          })}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Badge
                              variant="outline"
                              className={
                                NATURE_TONE[letter.nature] ??
                                NATURE_TONE[LetterNature.PUBLIC]
                              }
                            >
                              {LETTER_NATURE_LABELS[letter.nature] ??
                                letter.nature}
                            </Badge>
                            {/* Urgensi Biasa tidak dicetak: menandai setiap
                                surat "Biasa" membuat yang sungguh mendesak
                                tenggelam di antara puluhan lencana abu-abu. */}
                            {letter.urgency !== LetterUrgency.NORMAL && (
                              <Badge
                                variant="outline"
                                className={
                                  URGENCY_TONE[letter.urgency] ??
                                  URGENCY_TONE[LetterUrgency.NORMAL]
                                }
                              >
                                {LETTER_URGENCY_LABELS[letter.urgency] ??
                                  letter.urgency}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <LetterStatusBadge status={letter.status} />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Tanpa ini, surat ke-11 tidak dapat dicapai dari mana pun. */}
      {totalPages > 1 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">
            Halaman {page} dari {totalPages}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(1)}
              disabled={page <= 1}
            >
              Pertama
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Berikutnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
            >
              Terakhir
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
