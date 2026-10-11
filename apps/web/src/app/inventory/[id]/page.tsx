"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Edit, Trash2, QrCode, Wrench, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import api from "@/lib/api";
import {
  useInventoryItem,
  useDeleteInventoryItem,
  useAssetDepreciation,
  useAssetAssignments,
  useCreateAssignment,
  useReturnAssignment,
  useCreateMaintenanceRequest,
  AssetCondition,
  AssetStatus,
} from "@/hooks/use-inventory";
import { useUnits } from "@/hooks/use-units";
import { useTeachers } from "@/hooks/use-teachers";

import { MainLayout } from "@/components/layout";
function getConditionBadge(condition: AssetCondition) {
  const colorMap: Record<AssetCondition, string> = {
    [AssetCondition.EXCELLENT]: "bg-green-100 text-green-800",
    [AssetCondition.GOOD]: "bg-blue-100 text-blue-800",
    [AssetCondition.FAIR]: "bg-yellow-100 text-yellow-800",
    [AssetCondition.POOR]: "bg-orange-100 text-orange-800",
    [AssetCondition.BROKEN]: "bg-red-100 text-red-800",
  };

  return (
    <Badge variant="outline" className={colorMap[condition] || "bg-gray-100"}>
      {condition}
    </Badge>
  );
}

function getStatusBadge(status: AssetStatus) {
  const colorMap: Record<AssetStatus, string> = {
    [AssetStatus.ACTIVE]: "bg-green-100 text-green-800",
    [AssetStatus.MAINTENANCE]: "bg-yellow-100 text-yellow-800",
    [AssetStatus.DAMAGED]: "bg-red-100 text-red-800",
    [AssetStatus.DISPOSED]: "bg-gray-100 text-gray-800",
  };

  return (
    <Badge variant="outline" className={colorMap[status] || "bg-gray-100"}>
      {status}
    </Badge>
  );
}

function InventoryDetailPageContent({ params }: { params: { id: string } }) {
  const router = useRouter();
  const itemId = params.id;
  const { data: item, isLoading } = useInventoryItem(itemId);
  const deleteMutation = useDeleteInventoryItem();
  const { data: units } = useUnits();
  const { data: depreciation } = useAssetDepreciation(itemId);
  const { data: assignments } = useAssetAssignments({ assetId: itemId });
  const { data: teachers } = useTeachers({ status: "ACTIVE", limit: 100 });

  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [isReturnOpen, setIsReturnOpen] = useState(false);
  const [isMaintenanceOpen, setIsMaintenanceOpen] = useState(false);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>("");

  const createAssignmentMutation = useCreateAssignment();
  const returnAssignmentMutation = useReturnAssignment();
  const createMaintenanceRequestMutation = useCreateMaintenanceRequest();

  const unitName = units?.find((u) => u.id === item?.unitId)?.name || "-";

  useEffect(() => {
    if (isPrintOpen && itemId && !qrCodeUrl) {
      api
        .get<{ data: string }>(`/inventory/items/${itemId}/qrcode`)
        .then((res) => setQrCodeUrl(res.data.data))
        .catch(() => toast.error("Gagal memuat QR Code"));
    }
  }, [isPrintOpen, itemId, qrCodeUrl]);

  const handlePrint = () => {
    window.print();
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(itemId);
      toast.success("Inventaris berhasil dihapus");
      router.push("/inventory");
    } catch {
      toast.error("Gagal menghapus inventaris");
    }
  };

  const handleAssign = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    try {
      await createAssignmentMutation.mutateAsync({
        assetId: itemId,
        userId: formData.get("userId") as string,
        assignedAt: new Date(formData.get("assignedAt") as string),
        dueDate: formData.get("dueDate")
          ? new Date(formData.get("dueDate") as string)
          : undefined,
        conditionBefore:
          (formData.get("conditionBefore") as AssetCondition) ||
          AssetCondition.GOOD,
        notes: formData.get("notes") as string,
      });
      toast.success("Aset berhasil dipinjamkan");
      setIsAssignOpen(false);
    } catch {
      toast.error("Gagal meminjamkan aset");
    }
  };

  const handleReturn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    try {
      await returnAssignmentMutation.mutateAsync({
        id: selectedAssignmentId,
        data: {
          returnedAt: new Date(formData.get("returnedAt") as string),
          conditionAfter: formData.get("conditionAfter") as AssetCondition,
          notes: formData.get("notes") as string,
        },
      });
      toast.success("Aset berhasil dikembalikan");
      setIsReturnOpen(false);
    } catch {
      toast.error("Gagal mengembalikan aset");
    }
  };

  const handleMaintenanceRequest = async (
    e: React.FormEvent<HTMLFormElement>,
  ) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    try {
      await createMaintenanceRequestMutation.mutateAsync({
        assetId: itemId,
        type: formData.get("type") as string,
        description: formData.get("description") as string,
        notes: formData.get("notes") as string,
      });
      toast.success("Permintaan maintenance berhasil dibuat");
      setIsMaintenanceOpen(false);
    } catch {
      toast.error("Gagal membuat permintaan maintenance");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Data inventaris tidak ditemukan</p>
        <Button asChild className="mt-4">
          <Link href="/inventory">Kembali ke Daftar</Link>
        </Button>
      </div>
    );
  }

  const formatCurrency = (amount?: number | string | null) => {
    if (!amount) return "-";
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(Number(amount));
  };

  const formatDate = (dateString?: string | Date | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/inventory">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{item.name}</h1>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="font-mono text-sm">{item.code}</span>
              <span>•</span>
              <span>{item.category?.name}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsPrintOpen(true)}>
            <QrCode className="mr-2 h-4 w-4" />
            Label
          </Button>

          <Dialog open={isMaintenanceOpen} onOpenChange={setIsMaintenanceOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Wrench className="mr-2 h-4 w-4" />
                Lapor
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Lapor Kerusakan / Maintenance</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleMaintenanceRequest} className="space-y-4">
                <div className="space-y-2">
                  <Label>Jenis Masalah</Label>
                  <Select name="type" required>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih jenis..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Perbaikan">
                        Perbaikan (Rusak)
                      </SelectItem>
                      <SelectItem value="Servis Rutin">Servis Rutin</SelectItem>
                      <SelectItem value="Penggantian Sparepart">
                        Penggantian Sparepart
                      </SelectItem>
                      <SelectItem value="Lainnya">Lainnya</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Deskripsi Masalah</Label>
                  <Textarea
                    name="description"
                    placeholder="Jelaskan detail kerusakan atau masalah..."
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Catatan Tambahan</Label>
                  <Textarea
                    name="notes"
                    placeholder="Lokasi spesifik, urgensi, dll..."
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={createMaintenanceRequestMutation.isPending}
                  >
                    Kirim Laporan
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {item.status === "ACTIVE" && (
            <Dialog open={isAssignOpen} onOpenChange={setIsAssignOpen}>
              <DialogTrigger asChild>
                <Button variant="default">Pinjamkan Aset</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Pinjamkan Aset</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleAssign} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Peminjam (Guru)</Label>
                    <Select name="userId" required>
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih Peminjam" />
                      </SelectTrigger>
                      <SelectContent>
                        {teachers?.data.map((t) => (
                          <SelectItem key={t.userId} value={t.userId}>
                            {t.user?.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Tanggal Pinjam</Label>
                    <Input
                      type="date"
                      name="assignedAt"
                      defaultValue={new Date().toISOString().split("T")[0]}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Batas Kembali (Opsional)</Label>
                    <Input type="date" name="dueDate" />
                  </div>
                  <div className="space-y-2">
                    <Label>Kondisi Awal</Label>
                    <Select
                      name="conditionBefore"
                      defaultValue={item.condition}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.values(AssetCondition).map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Catatan</Label>
                    <Textarea name="notes" />
                  </div>
                  <DialogFooter>
                    <Button
                      type="submit"
                      disabled={createAssignmentMutation.isPending}
                    >
                      Simpan
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}

          <Button variant="outline" asChild>
            <Link href={`/inventory/${itemId}/edit`}>
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Link>
          </Button>
          <ConfirmDialog
            title="Hapus Inventaris"
            description="Apakah Anda yakin ingin menghapus data inventaris ini? Data yang dihapus tidak dapat dikembalikan."
            onConfirm={handleDelete}
            loading={deleteMutation.isPending}
          >
            <Button variant="destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              Hapus
            </Button>
          </ConfirmDialog>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Informasi Umum</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="assignments">Peminjaman</TabsTrigger>
          <TabsTrigger value="financial">Keuangan</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Basic Info */}
            <Card>
              <CardHeader>
                <CardTitle>Informasi Dasar</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Status
                    </p>
                    <div className="mt-1">{getStatusBadge(item.status)}</div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Kondisi
                    </p>
                    <div className="mt-1">
                      {getConditionBadge(item.condition)}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Brand
                    </p>
                    <p className="font-medium">{item.brand || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Model
                    </p>
                    <p className="font-medium">{item.model || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Serial Number
                    </p>
                    <p className="font-mono">{item.serialNumber || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Unit
                    </p>
                    <p className="font-medium">{unitName}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Deskripsi
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">
                    {item.notes || "-"}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Location & Purchase Info */}
            <Card>
              <CardHeader>
                <CardTitle>Lokasi & Pembelian</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Lokasi
                  </p>
                  <p className="font-medium">
                    {item.room?.name
                      ? `${item.room.name} (${item.location || ""})`
                      : item.location || "-"}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Tanggal Beli
                    </p>
                    <p className="font-medium">
                      {formatDate(item.purchaseDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Harga Beli
                    </p>
                    <p className="font-medium">
                      {formatCurrency(item.purchasePrice)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Supplier
                    </p>
                    <p className="font-medium">{item.supplier || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Garansi Sampai
                    </p>
                    <p className="font-medium">
                      {formatDate(item.warrantyExpiry)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      No. PO
                    </p>
                    <p className="font-medium">{item.purchaseOrderNo || "-"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="maintenance">
          <Card>
            <CardHeader>
              <CardTitle>Riwayat Maintenance</CardTitle>
            </CardHeader>
            <CardContent>
              {item.maintenanceLogs && item.maintenanceLogs.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Tipe</TableHead>
                      <TableHead>Deskripsi</TableHead>
                      <TableHead>Biaya</TableHead>
                      <TableHead>Pelaksana</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {item.maintenanceLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>{formatDate(log.maintenanceDate)}</TableCell>
                        <TableCell>{log.type}</TableCell>
                        <TableCell>{log.description}</TableCell>
                        <TableCell>{formatCurrency(log.cost)}</TableCell>
                        <TableCell>{log.performedBy}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-4">
                  Belum ada riwayat maintenance
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assignments">
          <Card>
            <CardHeader>
              <CardTitle>Riwayat Peminjaman</CardTitle>
            </CardHeader>
            <CardContent>
              {assignments?.data && assignments.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Peminjam</TableHead>
                      <TableHead>Tanggal Pinjam</TableHead>
                      <TableHead>Batas Kembali</TableHead>
                      <TableHead>Tanggal Kembali</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.data.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>{log.user?.name || "-"}</TableCell>
                        <TableCell>{formatDate(log.assignedAt)}</TableCell>
                        <TableCell>{formatDate(log.dueDate)}</TableCell>
                        <TableCell>{formatDate(log.returnedAt)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              log.status === "ACTIVE" ? "default" : "secondary"
                            }
                          >
                            {log.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {log.status === "ACTIVE" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedAssignmentId(log.id);
                                setIsReturnOpen(true);
                              }}
                            >
                              Kembalikan
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-4">
                  Belum ada riwayat peminjaman
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="financial">
          <Card>
            <CardHeader>
              <CardTitle>Depresiasi Aset (Metode Garis Lurus)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {depreciation ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Masa Manfaat
                    </p>
                    <p className="text-xl font-semibold">
                      {depreciation.lifeMonths || 0} Bulan
                    </p>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Umur Aset
                    </p>
                    <p className="text-xl font-semibold">
                      {depreciation.ageMonths || 0} Bulan
                    </p>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Nilai Sisa (Residual)
                    </p>
                    <p className="text-xl font-semibold">
                      {formatCurrency(depreciation.residual)}
                    </p>
                  </div>
                  <div className="p-4 bg-primary/10 rounded-lg border border-primary/20">
                    <p className="text-sm font-medium text-primary mb-1">
                      Nilai Buku Saat Ini
                    </p>
                    <p className="text-2xl font-bold text-primary">
                      {formatCurrency(depreciation.bookValue)}
                    </p>
                  </div>
                  <div className="col-span-2 p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Akumulasi Penyusutan
                    </p>
                    <p className="text-lg font-semibold">
                      {formatCurrency(depreciation.accumulatedDepreciation)}
                    </p>
                  </div>
                  <div className="col-span-2 p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Beban Penyusutan per Bulan
                    </p>
                    <p className="text-lg font-semibold">
                      {formatCurrency(depreciation.monthlyDepreciation)}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-4">
                  Data depresiasi tidak tersedia (lengkapi harga beli, tanggal
                  beli, dan masa manfaat)
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Return Dialog */}
      <Dialog open={isReturnOpen} onOpenChange={setIsReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kembalikan Aset</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleReturn} className="space-y-4">
            <div className="space-y-2">
              <Label>Tanggal Kembali</Label>
              <Input
                type="date"
                name="returnedAt"
                defaultValue={new Date().toISOString().split("T")[0]}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Kondisi Akhir</Label>
              <Select name="conditionAfter" defaultValue={item.condition}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(AssetCondition).map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Catatan Pengembalian</Label>
              <Textarea name="notes" />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={returnAssignmentMutation.isPending}
              >
                Simpan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Print Label Dialog */}
      <Dialog open={isPrintOpen} onOpenChange={setIsPrintOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Label Aset</DialogTitle>
          </DialogHeader>
          <div
            className="flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg"
            id="printable-label"
          >
            <h3 className="font-bold text-lg text-center">{item.name}</h3>
            {qrCodeUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrCodeUrl} alt="QR Code" className="w-32 h-32 my-2" />
            ) : (
              <div className="w-32 h-32 my-2 bg-muted flex items-center justify-center text-xs">
                Loading...
              </div>
            )}
            <p className="font-mono font-bold text-sm">{item.code}</p>
            <p className="text-xs text-muted-foreground mt-1">{unitName}</p>
          </div>
          <DialogFooter>
            <Button onClick={handlePrint} className="w-full">
              <Printer className="mr-2 h-4 w-4" />
              Cetak Label
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print Style */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #printable-label,
          #printable-label * {
            visibility: visible;
          }
          #printable-label {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            border: 2px solid black !important;
            border-style: solid !important;
            width: 300px;
            height: auto;
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          }
        }
      `}</style>
    </div>
  );
}

export default function InventoryDetailPage({
  params,
}: {
  params: Promise<Parameters<typeof InventoryDetailPageContent>[0]["params"]>;
}) {
  const resolved = use(params);
  return (
    <MainLayout>
      <InventoryDetailPageContent params={resolved} />
    </MainLayout>
  );
}
