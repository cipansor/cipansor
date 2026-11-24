"use client";
import { MainLayout } from "@/components/layout";

import { useState } from "react";
import { safeFormat } from "@/lib/date";
import { getErrorMessage } from "@/lib/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Pagination } from "@/components/shared/pagination";
import {
  Banknote,
  CheckCircle,
  Clock,
  Eye,
  Loader2,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  WashingMachine,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  LAUNDRY_PAYMENT_METHOD_LABELS,
  LAUNDRY_PAYMENT_STATUS_LABELS,
  LAUNDRY_STATUS_LABELS,
  LAUNDRY_STATUS_VALUES,
  laundryItemCount,
  laundryStatusOptions,
  type LaundryItemInput,
  type LaundryPaymentMethodCode,
  type LaundryPaymentStatusCode,
  type LaundryPricingDTO,
  type LaundryStatusCode,
  type LaundryTransactionDTO,
} from "@cipansor/shared";
import {
  useCreateLaundryPricing,
  useCreateLaundryTransaction,
  useDeleteLaundryPricing,
  useLaundryPricing,
  useLaundryStats,
  useLaundryTransaction,
  useLaundryTransactions,
  useProcessLaundryPayment,
  useUpdateLaundryPricing,
  useUpdateLaundryStatus,
} from "@/hooks/use-laundry";
import { useStudents } from "@/hooks/use-students";

/**
 * `/laundry` — Sarana & Layanan → Laundry.
 *
 * Every read and write goes through `use-laundry` (#1010, R22.1). The page used
 * to call `fetch` directly — no CSRF header, so each write was refused — and
 * named columns the API does not send (`transactionNumber`, `student.fullName`,
 * `totalItems`, `totalAmount`). The status menu is derived from
 * `LAUNDRY_STATUS_FLOW`, the table the API validates against (R22.6), so a move
 * a button offers is a move the API accepts.
 */

function formatCurrency(amount: number | string) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

function statusBadgeClass(status: LaundryStatusCode) {
  switch (status) {
    case "RECEIVED":
      return "bg-yellow-100 text-yellow-800";
    case "WASHING":
    case "DRYING":
    case "IRONING":
      return "bg-blue-100 text-blue-800";
    case "READY":
      return "bg-green-100 text-green-800";
    case "DELIVERED":
      return "bg-gray-100 text-gray-800";
    case "CANCELLED":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function paymentBadgeClass(status: LaundryPaymentStatusCode) {
  switch (status) {
    case "PAID":
      return "bg-green-100 text-green-800";
    case "UNPAID":
      return "bg-yellow-100 text-yellow-800";
    case "REFUNDED":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

/** R22.2: the pieces a transaction carries, from its own `items` rows. */
function itemCount(tx: LaundryTransactionDTO) {
  return laundryItemCount(tx.items);
}

// =============================================================================
// TARIF — the API's per-kilogram tiers (R22.8)
// =============================================================================

interface PricingFormState {
  name: string;
  description: string;
  pricePerKg: number;
  minWeight: number;
  processDays: number;
  isExpress: boolean;
  isActive: boolean;
}

const EMPTY_PRICING: PricingFormState = {
  name: "",
  description: "",
  pricePerKg: 0,
  minWeight: 1,
  processDays: 2,
  isExpress: false,
  isActive: true,
};

function PricingTab() {
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<LaundryPricingDTO | null>(null);
  const [form, setForm] = useState<PricingFormState>(EMPTY_PRICING);

  const { data: pricing = [], isLoading } = useLaundryPricing();
  const createPricing = useCreateLaundryPricing();
  const updatePricing = useUpdateLaundryPricing();
  const deletePricing = useDeleteLaundryPricing();

  const reset = () => {
    setForm(EMPTY_PRICING);
    setEditing(null);
  };

  const handleEdit = (item: LaundryPricingDTO) => {
    setEditing(item);
    setForm({
      name: item.name,
      description: item.description ?? "",
      pricePerKg: Number(item.pricePerKg),
      minWeight: Number(item.minWeight),
      processDays: item.processDays,
      isExpress: item.isExpress,
      isActive: item.isActive,
    });
    setShowDialog(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const onError = (error: unknown) =>
      toast.error(getErrorMessage(error) || "Gagal menyimpan tarif laundry");
    const onSuccess = (message: string) => {
      toast.success(message);
      setShowDialog(false);
      reset();
    };
    if (editing) {
      updatePricing.mutate(
        { id: editing.id, data: form },
        {
          onSuccess: () => onSuccess("Tarif laundry berhasil diperbarui"),
          onError,
        },
      );
    } else {
      createPricing.mutate(form, {
        onSuccess: () => onSuccess("Tarif laundry berhasil ditambahkan"),
        onError,
      });
    }
  };

  const saving = createPricing.isPending || updatePricing.isPending;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog
          open={showDialog}
          onOpenChange={(open) => {
            setShowDialog(open);
            if (!open) reset();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Tambah Tarif
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editing ? "Edit Tarif Laundry" : "Tambah Tarif Laundry"}
              </DialogTitle>
              <DialogDescription>
                Tarif dihitung per kilogram, dengan berat minimal dan lama
                proses.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pricing-name">Nama Layanan</Label>
                <Input
                  id="pricing-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Contoh: Cuci Setrika Reguler"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pricing-description">
                  Deskripsi (opsional)
                </Label>
                <Textarea
                  id="pricing-description"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder="Keterangan tambahan..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pricing-price">Harga per Kg (Rp)</Label>
                  <Input
                    id="pricing-price"
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={form.pricePerKg}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        pricePerKg: Number(e.target.value) || 0,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pricing-min-weight">Berat Minimal (kg)</Label>
                  <Input
                    id="pricing-min-weight"
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={form.minWeight}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        minWeight: Number(e.target.value) || 1,
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pricing-process-days">Lama Proses (hari)</Label>
                <Input
                  id="pricing-process-days"
                  type="number"
                  min={1}
                  value={form.processDays}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      processDays: Number(e.target.value) || 1,
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="pricing-express">Layanan Express</Label>
                <Switch
                  id="pricing-express"
                  checked={form.isExpress}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, isExpress: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="pricing-active">Status Aktif</Label>
                <Switch
                  id="pricing-active"
                  checked={form.isActive}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, isActive: checked })
                  }
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowDialog(false);
                    reset();
                  }}
                >
                  Batal
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {editing ? "Simpan" : "Tambah"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Layanan</TableHead>
              <TableHead>Harga/Kg</TableHead>
              <TableHead>Berat Minimal</TableHead>
              <TableHead>Lama Proses</TableHead>
              <TableHead>Jenis</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : pricing.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-8 text-muted-foreground"
                >
                  Belum ada tarif laundry
                </TableCell>
              </TableRow>
            ) : (
              pricing.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-medium">{item.name}</div>
                    {item.description && (
                      <div className="text-sm text-muted-foreground">
                        {item.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{formatCurrency(item.pricePerKg)}</TableCell>
                  <TableCell>{Number(item.minWeight)} kg</TableCell>
                  <TableCell>{item.processDays} hari</TableCell>
                  <TableCell>
                    <Badge variant={item.isExpress ? "default" : "secondary"}>
                      {item.isExpress ? "Express" : "Reguler"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.isActive ? "default" : "secondary"}>
                      {item.isActive ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Aksi">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(item)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={() => {
                            if (confirm("Hapus tarif ini?")) {
                              deletePricing.mutate(item.id, {
                                onSuccess: () =>
                                  toast.success(
                                    "Tarif laundry berhasil dihapus",
                                  ),
                                onError: (error) =>
                                  toast.error(
                                    getErrorMessage(error) ||
                                      "Gagal menghapus tarif laundry",
                                  ),
                              });
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Hapus
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// =============================================================================
// TRANSAKSI BARU (R22.9)
// =============================================================================

function NewTransactionDialog() {
  const [open, setOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentId, setStudentId] = useState("");
  const [studentLabel, setStudentLabel] = useState("");
  const [pricingId, setPricingId] = useState("");
  const [weight, setWeight] = useState(1);
  const [paymentMethod, setPaymentMethod] =
    useState<LaundryPaymentMethodCode>("CASH");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LaundryItemInput[]>([]);

  const { data: pricing = [] } = useLaundryPricing();
  const { data: studentPage } = useStudents({
    search: studentSearch || undefined,
    limit: 10,
  });
  const createTransaction = useCreateLaundryTransaction();

  const students = studentSearch.length > 2 ? (studentPage?.data ?? []) : [];

  const reset = () => {
    setStudentSearch("");
    setStudentId("");
    setStudentLabel("");
    setPricingId("");
    setWeight(1);
    setPaymentMethod("CASH");
    setNotes("");
    setItems([]);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId || !pricingId || weight <= 0) {
      toast.error("Lengkapi santri, tarif, dan berat cucian");
      return;
    }
    createTransaction.mutate(
      {
        studentId,
        pricingId,
        weight,
        paymentMethod,
        ...(notes ? { notes } : {}),
        ...(items.length > 0 ? { items } : {}),
      },
      {
        onSuccess: () => {
          toast.success("Transaksi laundry berhasil dibuat");
          setOpen(false);
          reset();
        },
        onError: (error) =>
          toast.error(getErrorMessage(error) || "Gagal membuat transaksi"),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Transaksi Baru
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transaksi Laundry Baru</DialogTitle>
          <DialogDescription>
            Catat cucian santri beserta berat dan tarifnya.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="laundry-student">Cari Santri</Label>
            <Input
              id="laundry-student"
              placeholder="Ketik nama atau NIS..."
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
            />
            {students.length > 0 && !studentId && (
              <div className="border rounded-md max-h-32 overflow-y-auto">
                {students.map((student) => (
                  <button
                    key={student.id}
                    type="button"
                    className="w-full text-left p-2 hover:bg-muted"
                    onClick={() => {
                      setStudentId(student.id);
                      setStudentLabel(`${student.name} (${student.nis})`);
                      setStudentSearch(student.name);
                    }}
                  >
                    <div className="font-medium">{student.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {student.nis}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {studentId && (
              <div className="flex items-center justify-between p-2 bg-muted rounded-md">
                <span>{studentLabel}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Hapus pilihan santri"
                  onClick={() => {
                    setStudentId("");
                    setStudentLabel("");
                    setStudentSearch("");
                  }}
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tarif</Label>
              <Select value={pricingId} onValueChange={setPricingId}>
                <SelectTrigger aria-label="Pilih tarif">
                  <SelectValue placeholder="Pilih tarif" />
                </SelectTrigger>
                <SelectContent>
                  {pricing
                    .filter((tier) => tier.isActive)
                    .map((tier) => (
                      <SelectItem key={tier.id} value={tier.id}>
                        {tier.name} — {formatCurrency(tier.pricePerKg)}/kg
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="laundry-weight">Berat (kg)</Label>
              <Input
                id="laundry-weight"
                type="number"
                min={0.01}
                step="0.01"
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Metode Pembayaran</Label>
            <Select
              value={paymentMethod}
              onValueChange={(value) =>
                setPaymentMethod(value as LaundryPaymentMethodCode)
              }
            >
              <SelectTrigger aria-label="Metode pembayaran">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  Object.keys(
                    LAUNDRY_PAYMENT_METHOD_LABELS,
                  ) as LaundryPaymentMethodCode[]
                ).map((method) => (
                  <SelectItem key={method} value={method}>
                    {LAUNDRY_PAYMENT_METHOD_LABELS[method]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Rincian Pakaian (opsional)</Label>
            {items.map((item, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  aria-label={`Jenis pakaian ${index + 1}`}
                  value={item.itemType}
                  placeholder="Contoh: Seragam"
                  onChange={(e) =>
                    setItems(
                      items.map((row, i) =>
                        i === index
                          ? { ...row, itemType: e.target.value }
                          : row,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Jumlah pakaian ${index + 1}`}
                  type="number"
                  min={1}
                  className="w-24"
                  value={item.quantity}
                  onChange={(e) =>
                    setItems(
                      items.map((row, i) =>
                        i === index
                          ? { ...row, quantity: Number(e.target.value) || 1 }
                          : row,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Hapus pakaian ${index + 1}`}
                  onClick={() => setItems(items.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setItems([...items, { itemType: "", quantity: 1 }])
              }
            >
              <Plus className="h-4 w-4 mr-2" />
              Tambah Pakaian
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="laundry-notes">Catatan (opsional)</Label>
            <Textarea
              id="laundry-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan khusus..."
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Batal
            </Button>
            <Button type="submit" disabled={createTransaction.isPending}>
              {createTransaction.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Buat Transaksi
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// DETAIL — the status menu comes from the shared flow (R22.6)
// =============================================================================

function TransactionDetail({
  transactionId,
  onClose,
}: {
  transactionId: string;
  onClose: () => void;
}) {
  const { data: transaction, isLoading } = useLaundryTransaction(transactionId);
  const updateStatus = useUpdateLaundryStatus();
  const processPayment = useProcessLaundryPayment();

  /**
   * R22.3, R22.7: the hook writes nothing to the cache before the API answers,
   * so a refusal (409 outside the flow, 404 out of reach) leaves the dialog
   * showing the status it had, and the toast carries the API's Indonesian
   * message.
   */
  const changeStatus = (status: LaundryStatusCode) => {
    if (!transaction) return;
    updateStatus.mutate(
      { id: transaction.id, status },
      {
        onSuccess: () =>
          toast.success(
            `Status diubah menjadi ${LAUNDRY_STATUS_LABELS[status]}`,
          ),
        onError: (error) =>
          toast.error(
            getErrorMessage(error) || "Gagal mengubah status transaksi",
          ),
      },
    );
  };

  const options = transaction ? laundryStatusOptions(transaction.status) : [];

  const settlePayment = (paymentMethod: "WALLET" | "CASH") => {
    if (!transaction) return;
    processPayment.mutate(
      { id: transaction.id, paymentMethod },
      {
        onSuccess: () => toast.success("Pembayaran laundry berhasil dicatat"),
        onError: (error) =>
          toast.error(
            getErrorMessage(error) || "Gagal mencatat pembayaran laundry",
          ),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detail Transaksi</DialogTitle>
          <DialogDescription>
            {transaction?.transactionNo ?? "-"}
          </DialogDescription>
        </DialogHeader>
        {isLoading || !transaction ? (
          <div className="py-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Santri</Label>
                <div className="font-medium">
                  {transaction.student?.user?.name ?? "-"}
                </div>
                <div className="text-sm text-muted-foreground">
                  {transaction.student?.nis ?? "-"}
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground">Status</Label>
                <div>
                  <Badge className={statusBadgeClass(transaction.status)}>
                    {LAUNDRY_STATUS_LABELS[transaction.status]}
                  </Badge>
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground">Tanggal Masuk</Label>
                <div>
                  {safeFormat(transaction.createdAt, "dd MMM yyyy HH:mm")}
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground">
                  Estimasi Selesai
                </Label>
                <div>{safeFormat(transaction.estimatedAt, "dd MMM yyyy")}</div>
              </div>
              <div>
                <Label className="text-muted-foreground">Jumlah Barang</Label>
                <div>{itemCount(transaction)} item</div>
              </div>
              <div>
                <Label className="text-muted-foreground">Total</Label>
                <div className="font-bold">
                  {formatCurrency(transaction.total)}
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground">Berat</Label>
                <div>{Number(transaction.weight)} kg</div>
              </div>
              <div>
                <Label className="text-muted-foreground">Pembayaran</Label>
                <div className="flex items-center gap-2">
                  <Badge
                    className={paymentBadgeClass(transaction.paymentStatus)}
                  >
                    {LAUNDRY_PAYMENT_STATUS_LABELS[transaction.paymentStatus]}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {LAUNDRY_PAYMENT_METHOD_LABELS[transaction.paymentMethod]}
                  </span>
                </div>
              </div>
            </div>

            {transaction.items && transaction.items.length > 0 && (
              <div className="space-y-2">
                <Label>Rincian Pakaian</Label>
                <div className="border rounded-md divide-y">
                  {transaction.items.map((item) => (
                    <div key={item.id} className="flex justify-between p-2">
                      <div>{item.itemType}</div>
                      <div className="font-medium">{item.quantity} item</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {transaction.notes && (
              <div>
                <Label className="text-muted-foreground">Catatan</Label>
                <div>{transaction.notes}</div>
              </div>
            )}

            {transaction.paymentStatus === "UNPAID" &&
              transaction.status !== "CANCELLED" && (
                <div className="space-y-2">
                  <Label>Pelunasan</Label>
                  <p className="text-sm text-muted-foreground">
                    Tagihan ini belum dibayar.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => settlePayment("CASH")}
                      disabled={processPayment.isPending}
                    >
                      <Banknote className="h-4 w-4 mr-2" />
                      Lunasi Tunai
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => settlePayment("WALLET")}
                      disabled={processPayment.isPending}
                    >
                      <Banknote className="h-4 w-4 mr-2" />
                      Lunasi Dompet
                    </Button>
                  </div>
                </div>
              )}

            <div className="space-y-2">
              <Label>Ubah Status</Label>
              {options.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Transaksi ini sudah selesai; tidak ada status lanjutan.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {options.map((option) => (
                    <Button
                      key={option.value}
                      variant={
                        option.value === "CANCELLED" ? "destructive" : "default"
                      }
                      disabled={updateStatus.isPending}
                      onClick={() => {
                        if (
                          option.value === "CANCELLED" &&
                          !confirm("Batalkan transaksi ini?")
                        ) {
                          return;
                        }
                        changeStatus(option.value);
                      }}
                    >
                      {option.value === "CANCELLED" ? (
                        <XCircle className="h-4 w-4 mr-2" />
                      ) : (
                        <CheckCircle className="h-4 w-4 mr-2" />
                      )}
                      {option.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// TRANSAKSI
// =============================================================================

function TransactionsTab() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | LaundryStatusCode>(
    "ALL",
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailId, setDetailId] = useState<string | null>(null);

  const searchTerm = search.trim().slice(0, 100);

  const { data, isLoading, isError } = useLaundryTransactions({
    ...(searchTerm ? { search: searchTerm } : {}),
    ...(statusFilter !== "ALL" ? { status: statusFilter } : {}),
    page,
    limit: pageSize,
  });

  const transactions = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Cari transaksi"
            placeholder="Cari nomor transaksi, nama, atau NIS..."
            value={search}
            maxLength={100}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-64"
          />
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value as "ALL" | LaundryStatusCode);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44" aria-label="Saring status">
              <SelectValue placeholder="Semua status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Semua status</SelectItem>
              {LAUNDRY_STATUS_VALUES.map((status) => (
                <SelectItem key={status} value={status}>
                  {LAUNDRY_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <NewTransactionDialog />
      </div>

      {detailId && (
        <TransactionDetail
          transactionId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No. Transaksi</TableHead>
              <TableHead>Santri</TableHead>
              <TableHead>Tanggal</TableHead>
              <TableHead>Barang</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Pembayaran</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  role="alert"
                  className="text-center py-8 text-muted-foreground"
                >
                  Gagal memuat transaksi laundry. Coba muat ulang halaman.
                </TableCell>
              </TableRow>
            ) : transactions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center py-8 text-muted-foreground"
                >
                  Belum ada transaksi laundry
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="font-mono">
                    {tx.transactionNo}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">
                      {tx.student?.user?.name ?? "-"}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {tx.student?.nis ?? "-"}
                    </div>
                  </TableCell>
                  <TableCell>
                    {safeFormat(tx.createdAt, "dd/MM/yy HH:mm")}
                  </TableCell>
                  <TableCell>{itemCount(tx)} item</TableCell>
                  <TableCell>{formatCurrency(tx.total)}</TableCell>
                  <TableCell>
                    <Badge className={statusBadgeClass(tx.status)}>
                      {LAUNDRY_STATUS_LABELS[tx.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={paymentBadgeClass(tx.paymentStatus)}>
                      {LAUNDRY_PAYMENT_STATUS_LABELS[tx.paymentStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Lihat detail"
                      onClick={() => setDetailId(tx.id)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {pagination && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          pageSize={pagination.limit}
          total={pagination.total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// HALAMAN
// =============================================================================

const IN_PROGRESS: readonly LaundryStatusCode[] = [
  "WASHING",
  "DRYING",
  "IRONING",
];

function LaundryPageContent() {
  // R22.10: the cards read `GET /transactions/stats`, not one page of the list.
  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
  } = useLaundryStats();
  const summary = stats?.summary;
  const inProgress = (stats?.statusBreakdown ?? [])
    .filter((row) => IN_PROGRESS.includes(row.status))
    .reduce((sum, row) => sum + row.count, 0);

  // A failed request is not a zero: say so rather than printing figures the
  // API never sent.
  const statValue = (value: number | undefined) =>
    statsError ? "—" : statsLoading ? "…" : (value ?? 0);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Laundry</h1>
        <p className="text-muted-foreground">
          Kelola layanan laundry untuk santri
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Transaksi</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statValue(summary?.totalTransactions)}
            </div>
            <p className="text-xs text-muted-foreground">hari ini</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Diproses</CardTitle>
            <WashingMachine className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statValue(inProgress)}</div>
            <p className="text-xs text-muted-foreground">
              dicuci, dikeringkan, disetrika
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Siap Ambil</CardTitle>
            <Package className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statValue(summary?.pendingPickup)}
            </div>
            <p className="text-xs text-muted-foreground">menunggu diambil</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pendapatan</CardTitle>
            <Banknote className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsError
                ? "—"
                : statsLoading
                  ? "…"
                  : formatCurrency(summary?.totalRevenue ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {statsError
                ? "gagal memuat statistik"
                : `${summary?.pendingPayments ?? 0} transaksi belum dibayar`}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="transactions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="transactions" className="gap-2">
            <Package className="h-4 w-4" />
            Transaksi
          </TabsTrigger>
          <TabsTrigger value="pricing" className="gap-2">
            <Tag className="h-4 w-4" />
            Tarif
          </TabsTrigger>
        </TabsList>
        <TabsContent value="transactions">
          <TransactionsTab />
        </TabsContent>
        <TabsContent value="pricing">
          <PricingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function LaundryPageWithShell() {
  return (
    <MainLayout>
      <LaundryPageContent />
    </MainLayout>
  );
}
