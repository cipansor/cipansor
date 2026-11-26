"use client";
import { useState } from "react";
import { safeFormat, todayWibDay } from "@/lib/date";
import Link from "next/link";

import { id as localeId } from "date-fns/locale";
import {
  Heart,
  Plus,
  Eye,
  Pencil,
  Trash2,
  Filter,
  TrendingUp,
  Users,
  Banknote,
  Clock,
  CheckCircle2,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  useCampaigns,
  useDeleteCampaign,
  useDonations,
  useDeleteDonation,
  useVerifyDonation,
  useDonationStats,
  useDonationMonthlyReport,
  CAMPAIGN_STATUSES,
  DONATION_STATUSES,
  DONATION_TYPES,
  CampaignStatus,
  DonationStatus,
  formatCurrency,
  calculateProgress,
} from "@/hooks/use-donation";

export default function DonationPage() {
  const [activeTab, setActiveTab] = useState("campaigns");

  // Campaign state
  const [campaignPage, setCampaignPage] = useState(1);
  const [campaignPageSize, setCampaignPageSize] = useState(10);
  const [campaignStatusFilter, setCampaignStatusFilter] =
    useState<string>("ALL");
  const [deleteCampaignId, setDeleteCampaignId] = useState<string | null>(null);

  // Donation state
  const [donationPage, setDonationPage] = useState(1);
  const [donationPageSize, setDonationPageSize] = useState(10);
  const [donationStatusFilter, setDonationStatusFilter] =
    useState<string>("ALL");
  const [deleteDonationId, setDeleteDonationId] = useState<string | null>(null);

  // Data fetching
  const { data: campaignsData, isLoading: campaignsLoading } = useCampaigns({
    page: campaignPage,
    limit: campaignPageSize,
    status:
      campaignStatusFilter !== "ALL"
        ? (campaignStatusFilter as CampaignStatus)
        : undefined,
  });

  const { data: donationsData, isLoading: donationsLoading } = useDonations({
    page: donationPage,
    limit: donationPageSize,
    status:
      donationStatusFilter !== "ALL"
        ? (donationStatusFilter as DonationStatus)
        : undefined,
  });

  const { data: stats } = useDonationStats();

  // The report year is the running WIB year: on 1 January before 07:00 WIB the
  // UTC year is still the previous one.
  const [reportYearBase] = useState(() => Number(todayWibDay().slice(0, 4)));
  const [reportYear, setReportYear] = useState(reportYearBase);
  const reportYears = [reportYearBase, reportYearBase - 1, reportYearBase - 2];
  const { data: monthlyReport, isLoading: monthlyReportLoading } =
    useDonationMonthlyReport(reportYear);

  const deleteCampaign = useDeleteCampaign();
  const deleteDonation = useDeleteDonation();
  const verifyDonation = useVerifyDonation();

  const campaigns = campaignsData?.data || [];
  const campaignPagination = campaignsData?.meta;

  const donations = donationsData?.data || [];
  const donationPagination = donationsData?.meta;

  const handleDeleteCampaign = async () => {
    if (!deleteCampaignId) return;
    try {
      await deleteCampaign.mutateAsync(deleteCampaignId);
      toast.success("Campaign berhasil dihapus");
      setDeleteCampaignId(null);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Gagal menghapus campaign";
      toast.error(errorMessage);
    }
  };

  const handleDeleteDonation = async () => {
    if (!deleteDonationId) return;
    try {
      await deleteDonation.mutateAsync(deleteDonationId);
      toast.success("Donasi berhasil dihapus");
      setDeleteDonationId(null);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Gagal menghapus donasi";
      toast.error(errorMessage);
    }
  };

  const handleVerifyDonation = async (id: string, status: DonationStatus) => {
    try {
      await verifyDonation.mutateAsync({ id, status });
      toast.success(
        status === "VERIFIED" ? "Donasi terverifikasi" : "Donasi dibatalkan",
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Gagal memverifikasi donasi";
      toast.error(errorMessage);
    }
  };

  const getCampaignStatusBadge = (status: CampaignStatus) => {
    const config = CAMPAIGN_STATUSES.find((s) => s.value === status);
    return (
      <Badge variant="secondary" className={config?.color}>
        {config?.label || status}
      </Badge>
    );
  };

  const getDonationStatusBadge = (status: DonationStatus) => {
    const config = DONATION_STATUSES.find((s) => s.value === status);
    return (
      <Badge variant="secondary" className={config?.color}>
        {config?.label || status}
      </Badge>
    );
  };

  const getDonationTypeLabel = (type: string) => {
    return DONATION_TYPES.find((t) => t.value === type)?.label || type;
  };

  return (
    <MainLayout>
      <PageHeader
        title="Donasi & Infak"
        description="Kelola campaign donasi dan infak yayasan"
      />

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-red-500" />
              <span className="text-sm text-muted-foreground">
                Total Donasi
              </span>
            </div>
            <p className="text-2xl font-bold">{stats?.totalDonations || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-green-500" />
              <span className="text-sm text-muted-foreground">
                Total Terkumpul
              </span>
            </div>
            <p className="text-2xl font-bold text-green-600">
              {formatCurrency(stats?.totalAmount || 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">
                Campaign Aktif
              </span>
            </div>
            <p className="text-2xl font-bold text-blue-600">
              {stats?.activeCampaigns || 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-yellow-500" />
              <span className="text-sm text-muted-foreground">
                Menunggu Verifikasi
              </span>
            </div>
            <p className="text-2xl font-bold text-yellow-600">
              {stats?.pendingVerification || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="campaigns" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Campaign
            </TabsTrigger>
            <TabsTrigger value="donations" className="flex items-center gap-2">
              <Heart className="h-4 w-4" />
              Donasi
            </TabsTrigger>
            <TabsTrigger value="report" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Laporan Bulanan
            </TabsTrigger>
          </TabsList>

          <div className="flex gap-2">
            {activeTab === "campaigns" && (
              <Button asChild>
                <Link href="/donation/campaigns/new">
                  <Plus className="h-4 w-4 mr-2" />
                  Buat Campaign
                </Link>
              </Button>
            )}
            {activeTab === "donations" && (
              <Button asChild>
                <Link href="/donation/new">
                  <Plus className="h-4 w-4 mr-2" />
                  Catat Donasi
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Campaigns Tab */}
        <TabsContent value="campaigns">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filter
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                <Select
                  value={campaignStatusFilter}
                  onValueChange={setCampaignStatusFilter}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Semua Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Semua Status</SelectItem>
                    {CAMPAIGN_STATUSES.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  onClick={() => setCampaignStatusFilter("ALL")}
                >
                  Reset
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Terkumpul</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead>Donatur</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[120px]">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaignsLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        <div className="flex items-center justify-center">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : campaigns.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        <Heart className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                        <p className="text-muted-foreground">
                          Tidak ada campaign
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    campaigns.map((campaign) => {
                      const progress = calculateProgress(
                        campaign.collectedAmount,
                        campaign.targetAmount,
                      );
                      return (
                        <TableRow key={campaign.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{campaign.title}</p>
                              <p className="text-sm text-muted-foreground">
                                {campaign.unit?.name || "Yayasan"}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            {formatCurrency(campaign.targetAmount)}
                          </TableCell>
                          <TableCell className="text-green-600 font-medium">
                            {formatCurrency(campaign.collectedAmount)}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 w-24">
                              <Progress value={progress} className="h-2" />
                              <p className="text-xs text-muted-foreground">
                                {progress}%
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              <Users className="h-3 w-3 mr-1" />
                              {campaign.donorCount}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {getCampaignStatusBadge(campaign.status)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" asChild>
                                <Link
                                  href={`/donation/campaigns/${campaign.id}`}
                                >
                                  <Eye className="h-4 w-4" />
                                </Link>
                              </Button>
                              <Button variant="ghost" size="sm" asChild>
                                <Link
                                  href={`/donation/campaigns/${campaign.id}/edit`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Link>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteCampaignId(campaign.id)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {campaignPagination && (
            <div className="mt-4">
              <Pagination
                page={campaignPagination.page}
                totalPages={campaignPagination.totalPages}
                pageSize={campaignPagination.limit}
                total={campaignPagination.total}
                onPageChange={setCampaignPage}
                onPageSizeChange={(size) => {
                  setCampaignPageSize(size);
                  setCampaignPage(1);
                }}
              />
            </div>
          )}
        </TabsContent>

        {/* Donations Tab */}
        <TabsContent value="donations">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filter
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4">
                <Select
                  value={donationStatusFilter}
                  onValueChange={setDonationStatusFilter}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Semua Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Semua Status</SelectItem>
                    {DONATION_STATUSES.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  onClick={() => setDonationStatusFilter("ALL")}
                >
                  Reset
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Donatur</TableHead>
                    <TableHead>Tipe</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Jumlah</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[150px]">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {donationsLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        <div className="flex items-center justify-center">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : donations.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        <Heart className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                        <p className="text-muted-foreground">
                          Tidak ada donasi
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    donations.map((donation) => (
                      <TableRow key={donation.id}>
                        <TableCell>
                          {safeFormat(
                            new Date(donation.createdAt),
                            "d MMM yyyy",
                            {
                              locale: localeId,
                            },
                          )}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">
                              {donation.isAnonymous
                                ? "Hamba Allah"
                                : donation.donorName}
                            </p>
                            {!donation.isAnonymous && donation.donorPhone && (
                              <p className="text-sm text-muted-foreground">
                                {donation.donorPhone}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {getDonationTypeLabel(donation.type)}
                          </Badge>
                        </TableCell>
                        <TableCell>{donation.campaign?.title || "-"}</TableCell>
                        <TableCell className="font-medium text-green-600">
                          {formatCurrency(donation.amount)}
                        </TableCell>
                        <TableCell>
                          {getDonationStatusBadge(donation.status)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {donation.status === "PENDING" && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleVerifyDonation(
                                      donation.id,
                                      "VERIFIED",
                                    )
                                  }
                                  className="text-green-600 hover:text-green-700"
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                            <Button variant="ghost" size="sm" asChild>
                              <Link href={`/donation/${donation.id}`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteDonationId(donation.id)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {donationPagination && (
            <div className="mt-4">
              <Pagination
                page={donationPagination.page}
                totalPages={donationPagination.totalPages}
                pageSize={donationPagination.limit}
                total={donationPagination.total}
                onPageChange={setDonationPage}
                onPageSizeChange={(size) => {
                  setDonationPageSize(size);
                  setDonationPage(1);
                }}
              />
            </div>
          )}
        </TabsContent>

        {/* Monthly Report Tab */}
        <TabsContent value="report">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                Laporan Donasi Bulanan {reportYear}
              </CardTitle>
              <Select
                value={String(reportYear)}
                onValueChange={(value) => setReportYear(Number(value))}
              >
                <SelectTrigger className="w-[140px]" aria-label="Tahun laporan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reportYears.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {monthlyReportLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                </div>
              ) : (
                <>
                  <div className="mb-4 rounded-lg border p-4">
                    <p className="text-sm text-muted-foreground">
                      Total donasi terverifikasi {reportYear}
                    </p>
                    <p className="text-2xl font-bold text-green-600">
                      {formatCurrency(monthlyReport?.yearTotal || 0)}
                    </p>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bulan</TableHead>
                        <TableHead>Rincian Jenis</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(monthlyReport?.months || []).map((month) => {
                        const byType = Object.entries(month.byType);
                        return (
                          <TableRow key={month.month}>
                            <TableCell className="font-medium">
                              {month.monthName}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {byType.length === 0
                                ? "-"
                                : byType
                                    .map(
                                      ([type, amount]) =>
                                        `${getDonationTypeLabel(type)}: ${formatCurrency(amount)}`,
                                    )
                                    .join(", ")}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(month.total)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Campaign Dialog */}
      <ConfirmDialog
        open={!!deleteCampaignId}
        onOpenChange={(open) => !open && setDeleteCampaignId(null)}
        title="Hapus Campaign"
        description="Apakah Anda yakin ingin menghapus campaign ini? Data donasi terkait akan tetap tersimpan."
        onConfirm={handleDeleteCampaign}
        isLoading={deleteCampaign.isPending}
      />

      {/* Delete Donation Dialog */}
      <ConfirmDialog
        open={!!deleteDonationId}
        onOpenChange={(open) => !open && setDeleteDonationId(null)}
        title="Hapus Donasi"
        description="Apakah Anda yakin ingin menghapus catatan donasi ini?"
        onConfirm={handleDeleteDonation}
        isLoading={deleteDonation.isPending}
      />
    </MainLayout>
  );
}
