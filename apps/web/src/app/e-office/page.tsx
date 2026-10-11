"use client";
import { useState, useEffect } from "react";
import { safeFormat } from "@/lib/date";
import { useRouter } from "next/navigation";
import { useCorrespondence } from "@/hooks/use-correspondence";
import { useAuth } from "@/hooks/use-auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  BarChart3,
  Mail,
  Send,
  FileText,
  Clock,
  CheckCircle,
  AlertCircle,
  Plus,
  ArrowRight,
  Inbox,
  SendHorizontal,
  FolderOpen,
  ArchiveX,
  PenTool,
  Users,
  Calendar,
  RefreshCw,
} from "lucide-react";

import { id as localeId } from "date-fns/locale";
import {
  LETTER_URGENCY_LABELS,
  LetterDirection,
  LetterStatus,
  LetterUrgency,
  mayReviewLetterRetention,
  type LetterDetail,
} from "@cipansor/shared";
import { getActiveRoleCode } from "@/lib/rbac";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function EOfficeMainPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { useLetters, useStats } = useCorrespondence(user?.unitId);

  /**
   * Kartu Retensi Arsip ditawarkan hanya kepada jabatan yang memang mengurus
   * surat — Tata Usaha, kepala sekolah, dan pengurus yayasan.
   *
   * Sebelumnya kartunya muncul untuk setiap staf yang punya `unitId`, dan
   * hampir setiap akun punya satu; endpoint-nya lalu menjawab 403, sehingga
   * yang mengeklik mendarat di halaman yang menolak mereka. `mayReviewLetterRetention`
   * membaca daftar yang sama dengan penjaga di `correspondence.controller.ts`.
   */
  const roleCode = getActiveRoleCode(user);

  // Fetch inbox and outbox
  const { data: inboxData, isLoading: loadingInbox } = useLetters({
    direction: LetterDirection.INCOMING,
    limit: 5,
  });

  const { data: outboxData, isLoading: loadingOutbox } = useLetters({
    direction: LetterDirection.OUTGOING,
    limit: 5,
  });

  // Fetch real stats
  const { data: statsData, isLoading: loadingStats } = useStats();

  const inbox = inboxData?.data || [];
  const outbox = outboxData?.data || [];

  // Stats from backend
  const stats = {
    totalIncoming: statsData?.counts?.totalIncoming || 0,
    totalOutgoing: statsData?.counts?.totalOutgoing || 0,
    pendingReview: statsData?.counts?.pendingReview || 0,
    needsAction: statsData?.counts?.needsAction || 0,
    urgentLetters: statsData?.counts?.urgentLetters || 0,
  };

  const getStatusBadge = (status: LetterStatus) => {
    const config: Record<LetterStatus, { label: string; className: string }> = {
      [LetterStatus.DRAFT]: {
        label: "Draft",
        className: "bg-gray-100 text-gray-800",
      },
      [LetterStatus.PENDING_REVIEW]: {
        label: "Menunggu Review",
        className: "bg-yellow-100 text-yellow-800",
      },
      [LetterStatus.REVISION_NEEDED]: {
        label: "Perlu Revisi",
        className: "bg-orange-100 text-orange-800",
      },
      [LetterStatus.READY_TO_SIGN]: {
        label: "Siap TTD",
        className: "bg-cyan-100 text-cyan-800",
      },
      [LetterStatus.SIGNED]: {
        label: "Sudah TTD",
        className: "bg-green-100 text-green-800",
      },
      [LetterStatus.SENT]: {
        label: "Terkirim",
        className: "bg-blue-100 text-blue-800",
      },
      [LetterStatus.DISPOSED]: {
        label: "Didisposisi",
        className: "bg-indigo-100 text-indigo-800",
      },
      [LetterStatus.ARCHIVED]: {
        label: "Diarsip",
        className: "bg-slate-100 text-slate-800",
      },
    };
    const c = config[status] || {
      label: status,
      className: "bg-gray-100 text-gray-800",
    };
    return <Badge className={c.className}>{c.label}</Badge>;
  };

  /**
   * Derajat kecepatan, dengan istilah yang sama di seluruh aplikasi.
   *
   * Peta di sini dahulu menyebut IMMEDIATE sebagai "Penting" dan URGENT sebagai
   * "Segera" — menggeser artinya satu tingkat terhadap formulir pembuatan surat
   * dan terhadap skema, sehingga surat "Segera" tampil sebagai "Penting" dan
   * "Amat Segera" tampil sebagai "Segera". Pada naskah dinas, derajat kecepatan
   * menentukan tenggat penyampaian.
   */
  const getUrgencyBadge = (urgency: string) => {
    const config: Record<string, string> = {
      URGENT: "bg-red-100 text-red-800 border-red-200",
      IMMEDIATE: "bg-orange-100 text-orange-800 border-orange-200",
      NORMAL: "bg-gray-100 text-gray-800 border-gray-200",
    };
    return (
      <span
        className={`text-xs px-2 py-0.5 rounded border ${config[urgency] || config.NORMAL}`}
      >
        {LETTER_URGENCY_LABELS[urgency as LetterUrgency] ?? urgency}
      </span>
    );
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">E-Office</h1>
          <p className="text-muted-foreground">
            Sistem Manajemen Surat & Disposisi Digital
          </p>
        </div>
        <Button onClick={() => router.push("/e-office/create")}>
          <Plus className="mr-2 h-4 w-4" />
          Buat Surat Baru
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push("/e-office/inbox")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Surat Masuk</CardTitle>
            <Inbox className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalIncoming}</div>
            <p className="text-xs text-muted-foreground">
              Total surat diterima
            </p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => router.push("/e-office/outbox")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Surat Keluar</CardTitle>
            <SendHorizontal className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalOutgoing}</div>
            <p className="text-xs text-muted-foreground">
              Total surat terkirim
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Menunggu Review
            </CardTitle>
            <Clock className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {stats.pendingReview}
            </div>
            <p className="text-xs text-muted-foreground">Perlu persetujuan</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Perlu Tindakan
            </CardTitle>
            <AlertCircle className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {stats.needsAction}
            </div>
            <p className="text-xs text-muted-foreground">Memerlukan aksi</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Surat Urgen</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {stats.urgentLetters}
            </div>
            <p className="text-xs text-muted-foreground">
              Segera/amat segera, belum selesai
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Chart Section */}
      <Card>
        <CardHeader>
          <CardTitle>Statistik Surat</CardTitle>
          <CardDescription>
            Tren surat masuk dan keluar 6 bulan terakhir
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            {loadingStats ? (
              <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                Memuat grafik...
              </div>
            ) : !statsData?.chart?.length ? (
              /* Recharts draws nothing for an empty series, and "nothing" here
                 is 300px of blank card that reads as a broken chart. */
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-center text-muted-foreground">
                <BarChart3 className="h-8 w-8 opacity-40" aria-hidden="true" />
                <p className="text-sm font-medium">Belum ada data tren</p>
                <p className="text-xs">
                  Grafik muncul setelah ada surat masuk atau keluar yang
                  tercatat dalam enam bulan terakhir.
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={statsData?.chart || []}
                  margin={{
                    top: 10,
                    right: 30,
                    left: 0,
                    bottom: 0,
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="name"
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${value}`}
                  />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="incoming"
                    stroke="#2563eb"
                    fill="#3b82f6"
                    fillOpacity={0.2}
                    name="Surat Masuk"
                  />
                  <Area
                    type="monotone"
                    dataKey="outgoing"
                    stroke="#16a34a"
                    fill="#22c55e"
                    fillOpacity={0.2}
                    name="Surat Keluar"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card
          className="cursor-pointer hover:bg-primary/5 transition-colors border-2 border-dashed"
          onClick={() => router.push("/e-office/create?direction=incoming")}
        >
          <CardContent className="flex flex-col items-center justify-center p-6 gap-2">
            <div className="p-3 bg-blue-100 rounded-full">
              <Mail className="h-6 w-6 text-blue-600" />
            </div>
            <span className="font-medium">Catat Surat Masuk</span>
            <span className="text-xs text-muted-foreground text-center">
              Registrasi surat yang diterima
            </span>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:bg-primary/5 transition-colors border-2 border-dashed"
          onClick={() => router.push("/e-office/create?direction=outgoing")}
        >
          <CardContent className="flex flex-col items-center justify-center p-6 gap-2">
            <div className="p-3 bg-green-100 rounded-full">
              <PenTool className="h-6 w-6 text-green-600" />
            </div>
            <span className="font-medium">Buat Surat Keluar</span>
            <span className="text-xs text-muted-foreground text-center">
              Buat surat baru untuk dikirim
            </span>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:bg-primary/5 transition-colors border-2 border-dashed"
          onClick={() => router.push("/e-office/inbox?scope=personal")}
        >
          <CardContent className="flex flex-col items-center justify-center p-6 gap-2">
            <div className="p-3 bg-yellow-100 rounded-full">
              <Users className="h-6 w-6 text-yellow-600" />
            </div>
            <span className="font-medium">Disposisi Saya</span>
            <span className="text-xs text-muted-foreground text-center">
              Surat yang perlu Anda tindak lanjuti
            </span>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:bg-primary/5 transition-colors border-2 border-dashed"
          onClick={() => router.push("/e-office/archive")}
        >
          <CardContent className="flex flex-col items-center justify-center p-6 gap-2">
            <div className="p-3 bg-purple-100 rounded-full">
              <FolderOpen className="h-6 w-6 text-purple-600" />
            </div>
            <span className="font-medium">Arsip Surat</span>
            <span className="text-xs text-muted-foreground text-center">
              Akses arsip surat lama
            </span>
          </CardContent>
        </Card>

        {mayReviewLetterRetention(roleCode) && (
          <Card
            className="cursor-pointer hover:bg-primary/5 transition-colors border-2 border-dashed"
            onClick={() => router.push("/e-office/retention")}
          >
            <CardContent className="flex flex-col items-center justify-center p-6 gap-2">
              <div className="p-3 bg-amber-100 rounded-full">
                <ArchiveX className="h-6 w-6 text-amber-600" />
              </div>
              <span className="font-medium">Retensi Arsip</span>
              <span className="text-xs text-muted-foreground text-center">
                Naskah yang masa retensinya sudah lewat
              </span>
            </CardContent>
          </Card>
        )}
      </div>

      {/*
        Recent Letters.

        `grid-cols-[minmax(0,1fr)]` on the mobile column, and it is load-bearing.
        With no explicit columns Tailwind leaves the implicit column at `auto`,
        which is floored by its item's min-content — and `1fr` alone would not
        help either, since `1fr` means `minmax(auto, 1fr)`. Measured here: the
        container was 310px while `grid-template-columns` computed to
        **577.172px**, so each card hung 227px off a 390px screen.

        The subject line is what inflates min-content: `truncate` sets
        `white-space: nowrap`, whose min-content is the whole untruncated string.
        `min-w-0` further down the chain (see the letter rows) lets the text
        ellipsize once the column is capped, but it cannot cap the column itself
        — that has to happen here, on the container. Only `minmax(0,1fr)` brought
        the card back to exactly 310px.

        Tailwind's own `md:grid-cols-2` already expands to
        `repeat(2, minmax(0, 1fr))`, so the desktop half was never affected.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2">
        {/* Recent Inbox */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Inbox className="h-5 w-5 text-blue-600" />
                  Surat Masuk Terbaru
                </CardTitle>
                <CardDescription>5 surat masuk terbaru</CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/e-office/inbox">
                  Lihat Semua
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingInbox ? (
              <div className="flex justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : inbox.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Belum ada surat masuk
              </div>
            ) : (
              <div className="space-y-3">
                {inbox.map((letter: LetterDetail) => (
                  <div
                    key={letter.id}
                    className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => router.push(`/e-office/letter/${letter.id}`)}
                  >
                    <div className="p-2 bg-blue-100 rounded">
                      <Mail className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {/*
                        min-w-0 here as well as on the flex-1 parent. `truncate`
                        only shortens text when every flex ancestor is allowed to
                        shrink below its content: a flex item defaults to
                        min-width:auto, which resolves to the min-content width of
                        the subject line. Without it this row measured 457px inside
                        a 310px grid column and pushed the whole card 227px off a
                        390px screen, while the span dutifully reported "truncate".
                      */}
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="font-medium truncate">
                          {letter.subject}
                        </span>
                        {getUrgencyBadge(letter.urgency)}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">
                        {letter.senderName || letter.senderInstance}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">
                          {safeFormat(new Date(letter.date), "dd MMM yyyy", {
                            locale: localeId,
                          })}
                        </span>
                        {getStatusBadge(letter.status)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Outbox */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Send className="h-5 w-5 text-green-600" />
                  Surat Keluar Terbaru
                </CardTitle>
                <CardDescription>5 surat keluar terbaru</CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/e-office/outbox">
                  Lihat Semua
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingOutbox ? (
              <div className="flex justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : outbox.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Belum ada surat keluar
              </div>
            ) : (
              <div className="space-y-3">
                {outbox.map((letter: LetterDetail) => (
                  <div
                    key={letter.id}
                    className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => router.push(`/e-office/letter/${letter.id}`)}
                  >
                    <div className="p-2 bg-green-100 rounded">
                      <Send className="h-4 w-4 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {/*
                        min-w-0 here as well as on the flex-1 parent. `truncate`
                        only shortens text when every flex ancestor is allowed to
                        shrink below its content: a flex item defaults to
                        min-width:auto, which resolves to the min-content width of
                        the subject line. Without it this row measured 457px inside
                        a 310px grid column and pushed the whole card 227px off a
                        390px screen, while the span dutifully reported "truncate".
                      */}
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="font-medium truncate">
                          {letter.subject}
                        </span>
                        {getUrgencyBadge(letter.urgency)}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">
                        Kepada:{" "}
                        {letter.recipientName || letter.recipientInstance}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">
                          {safeFormat(new Date(letter.date), "dd MMM yyyy", {
                            locale: localeId,
                          })}
                        </span>
                        {getStatusBadge(letter.status)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/*
        Kotak "Tips Penggunaan E-Office" dihapus dari sini.

        Empat butirnya menerangkan cara memakai sistem kepada petugas yang sudah
        membukanya, dan salah satu butir menyebut "filter sifat surat
        (Segera/Penting/Biasa)" — menyebut derajat kecepatan sebagai sifat, dan
        menjanjikan penyaring yang memang tidak ada. Penyaring statusnya kini
        benar-benar ada, di daftar suratnya, tempat ia dipakai.
      */}
    </div>
  );
}
