"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  useAssetAudit,
  useUpdateAuditItem,
  useCompleteAudit,
  AssetCondition,
  AssetStatus,
} from "@/hooks/use-inventory";

// Need to import types or define them if not exported from hook
import { AssetAuditItem } from "@cipansor/shared";

import { MainLayout } from "@/components/layout";
function AuditDetailPageContent({ params }: { params: { id: string } }) {
  const router = useRouter();
  const auditId = params.id;
  const { data: audit, isLoading } = useAssetAudit(auditId);
  const updateItemMutation = useUpdateAuditItem();
  const completeAuditMutation = useCompleteAudit();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<AssetAuditItem | null>(null);
  const [scanInput, setScanInput] = useState("");

  const handleMatch = async (item: AssetAuditItem) => {
    try {
      await updateItemMutation.mutateAsync({
        itemId: item.id,
        data: {
          isMatch: true,
          actualStatus: item.systemStatus,
          condition: item.condition,
          notes: item.notes || undefined,
        },
      });
      toast.success("Item diverifikasi (Match)");
    } catch {
      toast.error("Gagal update item");
    }
  };

  const handleScan = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const code = scanInput.trim();
      if (!code) return;

      // Case insensitive search
      const item = audit?.items?.find(
        (i) => i.asset?.code.toLowerCase() === code.toLowerCase(),
      );

      if (item) {
        if (item.isMatch) {
          toast.info("Item sudah terverifikasi sebelumnya");
        } else {
          await handleMatch(item);
          toast.success(`Item ditemukan: ${item.asset?.name}`);
        }
        setScanInput("");
      } else {
        toast.error("Item tidak ditemukan dalam audit ini");
      }
    }
  };

  const handleEdit = (item: AssetAuditItem) => {
    setSelectedItem(item);
    setIsEditOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedItem) return;
    const formData = new FormData(e.currentTarget);
    try {
      await updateItemMutation.mutateAsync({
        itemId: selectedItem.id,
        data: {
          isMatch: false,
          actualStatus: formData.get("actualStatus") as string,
          condition: formData.get("condition") as AssetCondition,
          notes: formData.get("notes") as string,
        },
      });
      toast.success("Item diperbarui (Mismatch)");
      setIsEditOpen(false);
    } catch {
      toast.error("Gagal update item");
    }
  };

  const handleComplete = async () => {
    try {
      await completeAuditMutation.mutateAsync(auditId);
      toast.success("Audit selesai");
    } catch {
      toast.error("Gagal menyelesaikan audit");
    }
  };

  const formatDate = (dateString?: string | Date | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!audit) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Audit tidak ditemukan</p>
        <Button asChild className="mt-4">
          <Link href="/inventory/audits">Kembali ke Daftar</Link>
        </Button>
      </div>
    );
  }

  const isCompleted = audit.status === "COMPLETED";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/inventory/audits">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Detail Stock Opname
            </h1>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>{audit.unit?.name}</span>
              <span>•</span>
              <span>{formatDate(audit.date)}</span>
              <span>•</span>
              <Badge variant={isCompleted ? "default" : "outline"}>
                {audit.status}
              </Badge>
            </div>
          </div>
        </div>
        {!isCompleted && (
          <Button
            onClick={handleComplete}
            disabled={completeAuditMutation.isPending}
          >
            Selesaikan Audit
          </Button>
        )}
      </div>

      {!isCompleted && (
        <Card>
          <CardHeader>
            <CardTitle>Scan Barcode / QR Code</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4">
              <Input
                placeholder="Scan atau ketik kode aset lalu tekan Enter..."
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={handleScan}
                className="max-w-md"
                autoFocus
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Daftar Aset</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Lokasi</TableHead>
                <TableHead>Status Sistem</TableHead>
                <TableHead>Status Fisik</TableHead>
                <TableHead>Kondisi</TableHead>
                <TableHead>Match?</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.items?.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono">
                    {item.asset?.code}
                  </TableCell>
                  <TableCell>{item.asset?.name}</TableCell>
                  <TableCell>{item.asset?.location || "-"}</TableCell>
                  <TableCell>{item.systemStatus}</TableCell>
                  <TableCell>
                    {item.actualStatus === "UNKNOWN" ? (
                      <span className="text-muted-foreground">-</span>
                    ) : (
                      <Badge variant="outline">{item.actualStatus}</Badge>
                    )}
                  </TableCell>
                  <TableCell>{item.condition}</TableCell>
                  <TableCell>
                    {item.isMatch ? (
                      <Badge
                        variant="secondary"
                        className="bg-green-100 text-green-800 hover:bg-green-100"
                      >
                        Match
                      </Badge>
                    ) : (
                      <Badge variant="destructive">Mismatch</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {!isCompleted && (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-green-600"
                          onClick={() => handleMatch(item)}
                          title="Tandai Sesuai"
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-yellow-600"
                          onClick={() => handleEdit(item)}
                          title="Laporkan Masalah"
                        >
                          <AlertTriangle className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Status Aset</DialogTitle>
          </DialogHeader>
          {selectedItem && (
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="space-y-2">
                <Label>Aset</Label>
                <div className="font-medium">
                  {selectedItem.asset?.name} ({selectedItem.asset?.code})
                </div>
              </div>
              <div className="space-y-2">
                <Label>Status Fisik</Label>
                <Select
                  name="actualStatus"
                  defaultValue={
                    selectedItem.actualStatus === "UNKNOWN"
                      ? AssetStatus.ACTIVE
                      : selectedItem.actualStatus
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(AssetStatus).map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                    <SelectItem value="MISSING">MISSING</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Kondisi</Label>
                <Select name="condition" defaultValue={selectedItem.condition}>
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
                <Textarea
                  name="notes"
                  defaultValue={selectedItem.notes || ""}
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={updateItemMutation.isPending}>
                  Simpan Perubahan
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AuditDetailPage({
  params,
}: {
  params: Promise<Parameters<typeof AuditDetailPageContent>[0]["params"]>;
}) {
  const resolved = use(params);
  return (
    <MainLayout>
      <AuditDetailPageContent params={resolved} />
    </MainLayout>
  );
}
