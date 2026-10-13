"use client";
import { useState } from "react";
import { safeFormat } from "@/lib/date";
import { useRouter } from "next/navigation";
import { MainLayout } from "@/components/layout";
import { PageHeader, DataTable } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useCertificates,
  useDownloadCertificate,
  DigitalCertificate,
} from "@/hooks/use-certificate";
import { type ColumnDef } from "@/components/shared";

import { id } from "date-fns/locale";
import {
  Award,
  Plus,
  Search,
  MoreHorizontal,
  Eye,
  Download,
  FileCheck,
  ExternalLink,
  QrCode,
  GraduationCap,
  BookOpen,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";

const certificateTypeLabels: Record<string, string> = {
  IJAZAH: "Ijazah",
  STTB: "STTB",
  TAHFIDZ: "Sertifikat Tahfidz",
  SANAD: "Sanad Hafidz",
  ACHIEVEMENT: "Piagam Prestasi",
  GRADUATION: "Kelulusan",
  PARTICIPATION: "Partisipasi",
  OTHER: "Lainnya",
};

const certificateTypeBadgeVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  IJAZAH: "default",
  STTB: "default",
  TAHFIDZ: "secondary",
  SANAD: "secondary",
  ACHIEVEMENT: "outline",
  GRADUATION: "default",
  PARTICIPATION: "outline",
  OTHER: "outline",
};

const CertificateTypeIcon = ({ type }: { type: string }) => {
  const icons: Record<string, React.ReactNode> = {
    IJAZAH: <GraduationCap className="h-4 w-4" />,
    STTB: <FileCheck className="h-4 w-4" />,
    TAHFIDZ: <BookOpen className="h-4 w-4" />,
    SANAD: <BookOpen className="h-4 w-4" />,
    ACHIEVEMENT: <Trophy className="h-4 w-4" />,
    GRADUATION: <GraduationCap className="h-4 w-4" />,
  };
  return icons[type] || <Award className="h-4 w-4" />;
};

export default function CertificatesPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useCertificates({
    page,
    limit: 20,
    certificateType: typeFilter === "ALL" ? undefined : typeFilter,
  });

  // Download through the scoped API route rather than opening the stored file
  // directly: `/uploads` is served to anyone signed in, so a raw `pdfUrl` would
  // let a parent or teacher of another unit fetch the file. The route checks
  // the certificate is in the caller's scope and counts the download.
  const downloadMutation = useDownloadCertificate();
  const handleDownload = async (cert: DigitalCertificate) => {
    try {
      const blob = await downloadMutation.mutateAsync(cert.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sertifikat-${cert.certificateNumber?.replace(/[^A-Za-z0-9]+/g, "-") ?? cert.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // The axios interceptor already surfaced the error to the user.
    }
  };

  const columns: ColumnDef<DigitalCertificate>[] = [
    {
      accessorKey: "certificateNumber",
      header: "No. Sertifikat",
      cell: ({ row }) => (
        <div className="font-mono text-sm">
          {row.original.certificateNumber}
        </div>
      ),
    },
    {
      accessorKey: "student",
      header: "Santri",
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.student?.name || "-"}</div>
          <div className="text-sm text-muted-foreground">
            {row.original.student?.nis || "-"}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "certificateType",
      header: "Tipe",
      cell: ({ row }) => (
        <Badge
          variant={
            certificateTypeBadgeVariant[row.original.certificateType] ||
            "outline"
          }
          className="flex items-center gap-1 w-fit"
        >
          <CertificateTypeIcon type={row.original.certificateType} />
          {certificateTypeLabels[row.original.certificateType] ||
            row.original.certificateType}
        </Badge>
      ),
    },
    {
      accessorKey: "title",
      header: "Judul",
      cell: ({ row }) => (
        <div className="max-w-[200px] truncate">{row.original.title}</div>
      ),
    },
    {
      accessorKey: "grade",
      header: "Predikat",
      cell: ({ row }) =>
        row.original.grade ? (
          <Badge variant="secondary">{row.original.grade}</Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      accessorKey: "issueDate",
      header: "Tanggal Terbit",
      cell: ({ row }) =>
        safeFormat(new Date(row.original.issueDate), "dd MMM yyyy", {
          locale: id,
        }),
    },
    {
      accessorKey: "isPublic",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.isPublic ? "default" : "secondary"}>
          {row.original.isPublic ? "Publik" : "Privat"}
        </Badge>
      ),
    },
    {
      accessorKey: "downloadCount",
      header: "Download",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.downloadCount}x
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => router.push(`/certificates/${row.original.id}`)}
            >
              <Eye className="mr-2 h-4 w-4" />
              Lihat Detail
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                window.open(row.original.verificationUrl, "_blank")
              }
            >
              <QrCode className="mr-2 h-4 w-4" />
              Verifikasi
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDownload(row.original)}>
              <Download className="mr-2 h-4 w-4" />
              Download PDF
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                navigator.clipboard.writeText(row.original.verificationUrl)
              }
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Salin Link
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const filteredData =
    data?.data?.filter(
      (cert) =>
        cert.student?.name?.toLowerCase().includes(search.toLowerCase()) ||
        cert.certificateNumber.toLowerCase().includes(search.toLowerCase()) ||
        cert.title.toLowerCase().includes(search.toLowerCase()),
    ) || [];

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <PageHeader
            title="Sertifikat Digital"
            description="Kelola sertifikat dan piagam digital santri"
            icon={Award}
          />
          <Button
            onClick={() => router.push("/certificates/new")}
            className="transition-all hover:shadow-md hover:-translate-y-0.5"
          >
            <Plus className="mr-2 h-4 w-4" />
            Buat Sertifikat
          </Button>
        </div>

        {/* Filters */}
        <div className="glass-card p-4 rounded-xl flex flex-wrap gap-4 shadow-sm border-none">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cari santri, nomor, atau judul..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-background/50 backdrop-blur-sm border-muted-foreground/20"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[200px] bg-background/50 backdrop-blur-sm border-muted-foreground/20">
              <SelectValue placeholder="Semua tipe" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Semua tipe</SelectItem>
              <SelectItem value="IJAZAH">Ijazah</SelectItem>
              <SelectItem value="STTB">STTB</SelectItem>
              <SelectItem value="TAHFIDZ">Sertifikat Tahfidz</SelectItem>
              <SelectItem value="SANAD">Sanad Hafidz</SelectItem>
              <SelectItem value="ACHIEVEMENT">Piagam Prestasi</SelectItem>
              <SelectItem value="GRADUATION">Kelulusan</SelectItem>
              <SelectItem value="PARTICIPATION">Partisipasi</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            title="Total Sertifikat"
            value={data?.meta?.total || 0}
            icon={<Award className="h-6 w-6 text-blue-600" />}
            bgColor="bg-blue-50/50"
            iconBg="bg-blue-100"
          />
          <StatCard
            title="Sertifikat Tahfidz"
            value={
              data?.data?.filter((c) => c.certificateType === "TAHFIDZ")
                .length || 0
            }
            icon={<BookOpen className="h-6 w-6 text-emerald-600" />}
            bgColor="bg-emerald-50/50"
            iconBg="bg-emerald-100"
          />
          <StatCard
            title="Ijazah/STTB"
            value={
              data?.data?.filter(
                (c) =>
                  c.certificateType === "IJAZAH" ||
                  c.certificateType === "STTB",
              ).length || 0
            }
            icon={<GraduationCap className="h-6 w-6 text-indigo-600" />}
            bgColor="bg-indigo-50/50"
            iconBg="bg-indigo-100"
          />
          <StatCard
            title="Piagam Prestasi"
            value={
              data?.data?.filter((c) => c.certificateType === "ACHIEVEMENT")
                .length || 0
            }
            icon={<Trophy className="h-6 w-6 text-amber-600" />}
            bgColor="bg-amber-50/50"
            iconBg="bg-amber-100"
          />
        </div>

        {/* Data Table */}
        <DataTable
          columns={columns}
          data={filteredData}
          isLoading={isLoading}
        />

        {/* Pagination */}
        {data?.meta && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Sebelumnya
            </Button>
            <span className="text-sm text-muted-foreground">
              Halaman {page} dari {data.meta.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setPage((p) => Math.min(data.meta.totalPages, p + 1))
              }
              disabled={page === data.meta.totalPages}
            >
              Selanjutnya
            </Button>
          </div>
        )}
      </div>
    </MainLayout>
  );
}

function StatCard({
  title,
  value,
  icon,
  bgColor,
  iconBg,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  bgColor: string;
  iconBg: string;
}) {
  return (
    <div
      className={cn(
        "glass-card border-none rounded-xl p-4 transition-all hover:shadow-lg group",
        bgColor,
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider group-hover:text-foreground transition-colors">
            {title}
          </p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <div
          className={cn(
            "p-2 rounded-lg group-hover:scale-110 transition-transform",
            iconBg,
          )}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}
