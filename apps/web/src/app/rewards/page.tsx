"use client";
import { MainLayout } from "@/components/layout";
import { useState } from "react";
import { safeFormat } from "@/lib/date";
import Link from "next/link";

import { id as localeId } from "date-fns/locale";
import {
  Plus,
  Search,
  Award,
  Eye,
  Trash2,
  Filter,
  Settings,
  Star,
  Trophy,
  Medal,
  Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Pagination } from "@/components/shared/pagination";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { toast } from "sonner";
import {
  useRewards,
  useRewardTypes,
  useDeleteReward,
  useDeleteRewardType,
  useRewardSummary,
  REWARD_CATEGORIES,
  RewardCategory,
} from "@/hooks/use-rewards";

function getCategoryBadge(category: RewardCategory) {
  const cat = REWARD_CATEGORIES.find((c) => c.value === category);
  return (
    <Badge variant="outline" className={cat?.color}>
      {cat?.label || category}
    </Badge>
  );
}

function RewardsPageContent() {
  const [activeTab, setActiveTab] = useState<
    "rewards" | "types" | "leaderboard"
  >("rewards");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const { data: rewardsData, isLoading: rewardsLoading } = useRewards({
    page,
    limit: 10,
    category:
      categoryFilter !== "all" ? (categoryFilter as RewardCategory) : undefined,
  });

  const { data: rewardTypes, isLoading: typesLoading } = useRewardTypes();
  const { data: summaryData } = useRewardSummary();

  const deleteRewardMutation = useDeleteReward();
  const deleteTypeMutation = useDeleteRewardType();

  const handleDeleteReward = async (id: string) => {
    try {
      await deleteRewardMutation.mutateAsync(id);
      toast.success("Penghargaan berhasil dihapus");
    } catch {
      toast.error("Gagal menghapus penghargaan");
    }
  };

  const handleDeleteType = async (id: string) => {
    try {
      await deleteTypeMutation.mutateAsync(id);
      toast.success("Jenis penghargaan berhasil dihapus");
    } catch {
      toast.error("Gagal menghapus jenis penghargaan");
    }
  };

  const filteredTypes = rewardTypes?.filter(
    (type) =>
      (type.name?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      (type.description?.toLowerCase().includes(search.toLowerCase()) ?? false),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Penghargaan</h1>
          <p className="text-muted-foreground">
            Kelola data penghargaan santri
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/rewards/types/new">
              <Settings className="mr-2 h-4 w-4" />
              Tambah Jenis
            </Link>
          </Button>
          <Button asChild>
            <Link href="/rewards/new">
              <Plus className="mr-2 h-4 w-4" />
              Berikan Penghargaan
            </Link>
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total</CardTitle>
            <Award className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summaryData?.totalRewards || 0}
            </div>
          </CardContent>
        </Card>
        {(summaryData?.byCategory ?? []).slice(0, 5).map((cat) => (
          <Card key={cat.category}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium capitalize">
                {cat.category}
              </CardTitle>
              <Star className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{cat.count}</div>
              <p className="text-xs text-muted-foreground">{cat.points} poin</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) =>
          setActiveTab(v as "rewards" | "types" | "leaderboard")
        }
      >
        <TabsList>
          <TabsTrigger value="rewards">Data Penghargaan</TabsTrigger>
          <TabsTrigger value="leaderboard" className="flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            Leaderboard
          </TabsTrigger>
          <TabsTrigger value="types">Jenis Penghargaan</TabsTrigger>
        </TabsList>

        {/* Rewards Tab */}
        <TabsContent value="rewards" className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Semua Kategori" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Kategori</SelectItem>
                  {REWARD_CATEGORIES.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Rewards Table */}
          <Card>
            <CardContent className="p-0">
              {rewardsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : rewardsData?.data.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Award className="h-12 w-12 text-muted-foreground" />
                  <p className="mt-4 text-muted-foreground">
                    Belum ada data penghargaan
                  </p>
                  <Button asChild className="mt-4">
                    <Link href="/rewards/new">Berikan Penghargaan Baru</Link>
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Santri</TableHead>
                      <TableHead>Jenis Penghargaan</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Poin</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rewardsData?.data.map((reward) => (
                      <TableRow key={reward.id}>
                        <TableCell>
                          {safeFormat(new Date(reward.date), "dd MMM yyyy", {
                            locale: localeId,
                          })}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">
                              {reward.student?.name}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {reward.student?.nis}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>{reward.rewardType?.name}</TableCell>
                        <TableCell>
                          {reward.rewardType &&
                            getCategoryBadge(reward.rewardType.category)}
                        </TableCell>
                        <TableCell className="text-green-600">
                          +{reward.rewardType?.points} poin
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="icon" asChild>
                              <Link href={`/rewards/${reward.id}`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                            <ConfirmDialog
                              title="Hapus Penghargaan"
                              description="Apakah Anda yakin ingin menghapus data penghargaan ini?"
                              onConfirm={() => handleDeleteReward(reward.id)}
                              loading={deleteRewardMutation.isPending}
                            >
                              <Button variant="ghost" size="icon">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </ConfirmDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Pagination */}
          {rewardsData && rewardsData.meta.totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={rewardsData.meta.totalPages}
              pageSize={rewardsData.meta.limit}
              total={rewardsData.meta.total}
              onPageChange={setPage}
            />
          )}
        </TabsContent>

        {/* Leaderboard Tab */}
        <TabsContent value="leaderboard" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-yellow-500" />
                Top Santri Berprestasi
              </CardTitle>
              <CardDescription>
                Peringkat santri dengan poin penghargaan tertinggi
              </CardDescription>
            </CardHeader>
            <CardContent>
              {summaryData?.topStudents &&
              summaryData.topStudents.length > 0 ? (
                <div className="space-y-4">
                  {/* Top 3 Podium */}
                  <div className="grid grid-cols-3 gap-4 mb-8">
                    {/* 2nd Place */}
                    <div className="flex flex-col items-center order-1">
                      {summaryData.topStudents[1] && (
                        <div className="text-center">
                          <div className="w-20 h-20 mx-auto bg-gray-100 rounded-full flex items-center justify-center mb-2">
                            <Medal className="h-10 w-10 text-gray-400" />
                          </div>
                          <div className="bg-gray-100 rounded-lg p-4 mt-4">
                            <p className="font-medium truncate">
                              {summaryData.topStudents[1].name}
                            </p>
                            <p className="text-lg font-bold text-gray-600">
                              {summaryData.topStudents[1].points} poin
                            </p>
                            <Badge variant="secondary">
                              {summaryData.topStudents[1].count} penghargaan
                            </Badge>
                          </div>
                        </div>
                      )}
                    </div>
                    {/* 1st Place */}
                    <div className="flex flex-col items-center order-0 -mt-4">
                      {summaryData.topStudents[0] && (
                        <div className="text-center">
                          <div className="relative">
                            <Crown className="h-8 w-8 text-yellow-500 absolute -top-6 left-1/2 -translate-x-1/2" />
                            <div className="w-24 h-24 mx-auto bg-yellow-100 rounded-full flex items-center justify-center mb-2 ring-4 ring-yellow-400">
                              <Trophy className="h-12 w-12 text-yellow-500" />
                            </div>
                          </div>
                          <div className="bg-yellow-50 rounded-lg p-4 mt-4 border border-yellow-200">
                            <p className="font-medium truncate">
                              {summaryData.topStudents[0].name}
                            </p>
                            <p className="text-xl font-bold text-yellow-600">
                              {summaryData.topStudents[0].points} poin
                            </p>
                            <Badge className="bg-yellow-500">
                              {summaryData.topStudents[0].count} penghargaan
                            </Badge>
                          </div>
                        </div>
                      )}
                    </div>
                    {/* 3rd Place */}
                    <div className="flex flex-col items-center order-2">
                      {summaryData.topStudents[2] && (
                        <div className="text-center">
                          <div className="w-20 h-20 mx-auto bg-orange-50 rounded-full flex items-center justify-center mb-2">
                            <Medal className="h-10 w-10 text-orange-400" />
                          </div>
                          <div className="bg-orange-50 rounded-lg p-4 mt-4">
                            <p className="font-medium truncate">
                              {summaryData.topStudents[2].name}
                            </p>
                            <p className="text-lg font-bold text-orange-600">
                              {summaryData.topStudents[2].points} poin
                            </p>
                            <Badge variant="secondary">
                              {summaryData.topStudents[2].count} penghargaan
                            </Badge>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Rest of Leaderboard */}
                  {summaryData.topStudents.length > 3 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">Rank</TableHead>
                          <TableHead>Nama Santri</TableHead>
                          <TableHead className="text-center">
                            Jumlah Penghargaan
                          </TableHead>
                          <TableHead className="text-right">
                            Total Poin
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summaryData.topStudents
                          .slice(3)
                          .map((student, idx) => (
                            <TableRow key={student.studentId}>
                              <TableCell className="font-bold text-muted-foreground">
                                #{idx + 4}
                              </TableCell>
                              <TableCell className="font-medium">
                                {student.name}
                              </TableCell>
                              <TableCell className="text-center">
                                {student.count}
                              </TableCell>
                              <TableCell className="text-right text-green-600 font-bold">
                                {student.points} poin
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Trophy className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    Belum ada data leaderboard
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Types Tab */}
        <TabsContent value="types" className="space-y-4">
          {/* Search */}
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cari jenis penghargaan..."
              className="pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Types Table */}
          <Card>
            <CardContent className="p-0">
              {typesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : filteredTypes?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Settings className="h-12 w-12 text-muted-foreground" />
                  <p className="mt-4 text-muted-foreground">
                    Belum ada jenis penghargaan
                  </p>
                  <Button asChild className="mt-4">
                    <Link href="/rewards/types/new">
                      Tambah Jenis Penghargaan
                    </Link>
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nama</TableHead>
                      <TableHead>Deskripsi</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Poin</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTypes?.map((type) => (
                      <TableRow key={type.id}>
                        <TableCell className="font-medium">
                          {type.name}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {type.description || "-"}
                        </TableCell>
                        <TableCell>{getCategoryBadge(type.category)}</TableCell>
                        <TableCell className="text-green-600">
                          +{type.points}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={type.isActive ? "default" : "secondary"}
                          >
                            {type.isActive ? "Aktif" : "Nonaktif"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="icon" asChild>
                              <Link href={`/rewards/types/${type.id}/edit`}>
                                <Eye className="h-4 w-4" />
                              </Link>
                            </Button>
                            <ConfirmDialog
                              title="Hapus Jenis Penghargaan"
                              description="Apakah Anda yakin ingin menghapus jenis penghargaan ini?"
                              onConfirm={() => handleDeleteType(type.id)}
                              loading={deleteTypeMutation.isPending}
                            >
                              <Button variant="ghost" size="icon">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </ConfirmDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function RewardsPageWithShell() {
  return (
    <MainLayout>
      <RewardsPageContent />
    </MainLayout>
  );
}
