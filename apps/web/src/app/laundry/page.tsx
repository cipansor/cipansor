"use client";
import { MainLayout } from "@/components/layout";

import { useState } from "react";
import { safeFormat } from "@/lib/date";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Plus,
  Search,
  MoreHorizontal,
  Edit,
  Trash2,
  RefreshCw,
  Shirt,
  Package,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  WashingMachine,
  Eye,
  Tag,
  Banknote,
  TrendingUp,
  AlertCircle,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { useBusinessUnits } from "@/hooks/use-business-unit";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";

// Types
interface LaundryPricing {
  id: string;
  unitId: string;
  itemType: string;
  description?: string;
  pricePerItem: number;
  pricePerKg?: number;
  estimatedDays: number;
  isActive: boolean;
  unit?: {
    id: string;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface LaundryTransaction {
  id: string;
  transactionNumber: string;
  unitId: string;
  studentId: string;
  status: "PENDING" | "PROCESSING" | "READY" | "DELIVERED" | "CANCELLED";
  totalWeight?: number;
  totalItems: number;
  totalAmount: number;
  paymentMethod: "CASH" | "WALLET" | "TRANSFER";
  paymentStatus: "PENDING" | "PAID" | "REFUNDED";
  receivedAt: string;
  estimatedReady?: string;
  readyAt?: string;
  deliveredAt?: string;
  notes?: string;
  unit?: {
    id: string;
    name: string;
  };
  student?: {
    id: string;
    nis: string;
    fullName: string;
  };
  items?: LaundryItem[];
  createdAt: string;
  updatedAt: string;
}

interface LaundryItem {
  id: string;
  transactionId: string;
  pricingId: string;
  quantity: number;
  weight?: number;
  price: number;
  subtotal: number;
  pricing?: LaundryPricing;
}

interface Student {
  id: string;
  nis: string;
  fullName: string;
}

// API functions
// `??` so an empty value stays empty and the base is relative — see lib/api.ts.
const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api`;

async function fetchPricing(params?: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/laundry/pricing?${query}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch pricing");
  return res.json();
}

async function createPricing(data: Partial<LaundryPricing>) {
  const res = await fetch(`${API_BASE}/laundry/pricing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create pricing");
  return res.json();
}

async function updatePricing(id: string, data: Partial<LaundryPricing>) {
  const res = await fetch(`${API_BASE}/laundry/pricing/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update pricing");
  return res.json();
}

async function deletePricing(id: string) {
  const res = await fetch(`${API_BASE}/laundry/pricing/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete pricing");
  return res.json();
}

async function fetchTransactions(params?: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/laundry/transactions?${query}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch transactions");
  return res.json();
}

async function createTransaction(data: {
  studentId: string;
  unitId: string;
  businessUnitId?: string;
  items: { pricingId: string; quantity: number; weight?: number }[];
  paymentMethod: string;
  notes?: string;
}) {
  const res = await fetch(`${API_BASE}/laundry/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create transaction");
  return res.json();
}

async function updateTransactionStatus(
  id: string,
  status: string,
  notes?: string,
) {
  const res = await fetch(`${API_BASE}/laundry/transactions/${id}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ status, notes }),
  });
  if (!res.ok) throw new Error("Failed to update status");
  return res.json();
}

async function fetchStudents(search?: string) {
  const params = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await fetch(`${API_BASE}/students${params}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch students");
  return res.json();
}

async function fetchUnits() {
  const res = await fetch(`${API_BASE}/units`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch units");
  return res.json();
}

// Format currency
function formatCurrency(amount: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}

// Status badge colors
function getStatusColor(status: string) {
  switch (status) {
    case "PENDING":
      return "bg-yellow-100 text-yellow-800";
    case "PROCESSING":
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

function getPaymentStatusColor(status: string) {
  switch (status) {
    case "PAID":
      return "bg-green-100 text-green-800";
    case "PENDING":
      return "bg-yellow-100 text-yellow-800";
    case "REFUNDED":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

// Pricing Management Tab
function PricingTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<LaundryPricing | null>(null);
  const [formData, setFormData] = useState({
    itemType: "",
    description: "",
    pricePerItem: 0,
    pricePerKg: 0,
    estimatedDays: 2,
    isActive: true,
    unitId: "",
  });

  const { data: pricingData, isLoading } = useQuery({
    queryKey: ["laundry-pricing", search],
    queryFn: () => fetchPricing(search ? { search } : undefined),
  });

  const { data: unitsData } = useQuery({
    queryKey: ["units"],
    queryFn: fetchUnits,
  });

  const createMutation = useMutation({
    mutationFn: createPricing,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["laundry-pricing"] });
      toast.success("Harga laundry berhasil ditambahkan");
      setShowDialog(false);
      resetForm();
    },
    onError: () => toast.error("Gagal menambahkan harga laundry"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<LaundryPricing> }) =>
      updatePricing(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["laundry-pricing"] });
      toast.success("Harga laundry berhasil diperbarui");
      setShowDialog(false);
      resetForm();
    },
    onError: () => toast.error("Gagal memperbarui harga laundry"),
  });

  const deleteMutation = useMutation({
    mutationFn: deletePricing,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["laundry-pricing"] });
      toast.success("Harga laundry berhasil dihapus");
    },
    onError: () => toast.error("Gagal menghapus harga laundry"),
  });

  const resetForm = () => {
    setFormData({
      itemType: "",
      description: "",
      pricePerItem: 0,
      pricePerKg: 0,
      estimatedDays: 2,
      isActive: true,
      unitId: "",
    });
    setEditingItem(null);
  };

  const handleEdit = (item: LaundryPricing) => {
    setEditingItem(item);
    setFormData({
      itemType: item.itemType,
      description: item.description || "",
      pricePerItem: item.pricePerItem,
      pricePerKg: item.pricePerKg || 0,
      estimatedDays: item.estimatedDays,
      isActive: item.isActive,
      unitId: item.unitId,
    });
    setShowDialog(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const pricing = pricingData?.data || [];
  const units = unitsData?.data || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari jenis pakaian..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
        </div>
        <Dialog
          open={showDialog}
          onOpenChange={(open) => {
            setShowDialog(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Tambah Harga
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editingItem ? "Edit Harga Laundry" : "Tambah Harga Laundry"}
              </DialogTitle>
              <DialogDescription>
                Atur harga laundry per item atau per kilogram
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Unit</Label>
                <Select
                  value={formData.unitId}
                  onValueChange={(value) =>
                    setFormData({ ...formData, unitId: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map((unit: { id: string; name: string }) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Jenis Pakaian</Label>
                <Input
                  value={formData.itemType}
                  onChange={(e) =>
                    setFormData({ ...formData, itemType: e.target.value })
                  }
                  placeholder="Contoh: Kemeja, Celana, Seragam"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Deskripsi (opsional)</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder="Keterangan tambahan..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Harga per Item (Rp)</Label>
                  <Input
                    type="number"
                    value={formData.pricePerItem}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        pricePerItem: parseInt(e.target.value) || 0,
                      })
                    }
                    min={0}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Harga per Kg (Rp)</Label>
                  <Input
                    type="number"
                    value={formData.pricePerKg}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        pricePerKg: parseInt(e.target.value) || 0,
                      })
                    }
                    min={0}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Estimasi Selesai (hari)</Label>
                <Input
                  type="number"
                  value={formData.estimatedDays}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      estimatedDays: parseInt(e.target.value) || 1,
                    })
                  }
                  min={1}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Status Aktif</Label>
                <Switch
                  checked={formData.isActive}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, isActive: checked })
                  }
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowDialog(false);
                    resetForm();
                  }}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  disabled={
                    createMutation.isPending || updateMutation.isPending
                  }
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {editingItem ? "Simpan" : "Tambah"}
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
              <TableHead>Jenis Pakaian</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Harga/Item</TableHead>
              <TableHead>Harga/Kg</TableHead>
              <TableHead>Estimasi</TableHead>
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
                  Belum ada data harga laundry
                </TableCell>
              </TableRow>
            ) : (
              pricing.map((item: LaundryPricing) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{item.itemType}</div>
                      {item.description && (
                        <div className="text-sm text-muted-foreground">
                          {item.description}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{item.unit?.name || "-"}</TableCell>
                  <TableCell>{formatCurrency(item.pricePerItem)}</TableCell>
                  <TableCell>
                    {item.pricePerKg ? formatCurrency(item.pricePerKg) : "-"}
                  </TableCell>
                  <TableCell>{item.estimatedDays} hari</TableCell>
                  <TableCell>
                    <Badge variant={item.isActive ? "default" : "secondary"}>
                      {item.isActive ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(item)}>
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            if (confirm("Hapus harga ini?")) {
                              deleteMutation.mutate(item.id);
                            }
                          }}
                          className="text-red-600"
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

// Transactions Tab
function TransactionsTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showDialog, setShowDialog] = useState(false);
  const [selectedTransaction, setSelectedTransaction] =
    useState<LaundryTransaction | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);

  // Form state for new transaction
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [selectedUnit, setSelectedUnit] = useState("");
  const [selectedItems, setSelectedItems] = useState<
    {
      pricingId: string;
      quantity: number;
      weight?: number;
      price: number;
      itemType: string;
    }[]
  >([]);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [notes, setNotes] = useState("");

  const { data: transactionsData, isLoading } = useQuery({
    queryKey: ["laundry-transactions", search, statusFilter],
    queryFn: () =>
      fetchTransactions({
        ...(search && { search }),
        ...(statusFilter !== "ALL" && { status: statusFilter }),
      }),
  });

  const { data: studentsData } = useQuery({
    queryKey: ["students", studentSearch],
    queryFn: () => fetchStudents(studentSearch),
    enabled: studentSearch.length > 2,
  });

  const { data: unitsData } = useQuery({
    queryKey: ["units"],
    queryFn: fetchUnits,
  });
  const { data: laundryBusinessUnits } = useBusinessUnits({
    type: "LAUNDRY",
    isActive: true,
  });

  const { data: pricingData } = useQuery({
    queryKey: ["laundry-pricing", selectedUnit],
    queryFn: () =>
      fetchPricing(
        selectedUnit ? { unitId: selectedUnit, isActive: "true" } : undefined,
      ),
    enabled: !!selectedUnit,
  });

  const createMutation = useMutation({
    mutationFn: createTransaction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["laundry-transactions"] });
      toast.success("Transaksi laundry berhasil dibuat");
      setShowDialog(false);
      resetForm();
    },
    onError: () => toast.error("Gagal membuat transaksi"),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({
      id,
      status,
      notes,
    }: {
      id: string;
      status: string;
      notes?: string;
    }) => updateTransactionStatus(id, status, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["laundry-transactions"] });
      toast.success("Status transaksi diperbarui");
    },
    onError: () => toast.error("Gagal memperbarui status"),
  });

  const resetForm = () => {
    setStudentSearch("");
    setSelectedStudent(null);
    setSelectedUnit("");
    setSelectedItems([]);
    setPaymentMethod("CASH");
    setNotes("");
  };

  const addItem = (pricing: LaundryPricing) => {
    const existing = selectedItems.find((i) => i.pricingId === pricing.id);
    if (existing) {
      setSelectedItems(
        selectedItems.map((i) =>
          i.pricingId === pricing.id ? { ...i, quantity: i.quantity + 1 } : i,
        ),
      );
    } else {
      setSelectedItems([
        ...selectedItems,
        {
          pricingId: pricing.id,
          quantity: 1,
          price: pricing.pricePerItem,
          itemType: pricing.itemType,
        },
      ]);
    }
  };

  const updateItemQuantity = (pricingId: string, quantity: number) => {
    if (quantity <= 0) {
      setSelectedItems(selectedItems.filter((i) => i.pricingId !== pricingId));
    } else {
      setSelectedItems(
        selectedItems.map((i) =>
          i.pricingId === pricingId ? { ...i, quantity } : i,
        ),
      );
    }
  };

  const totalAmount = selectedItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent || !selectedUnit || selectedItems.length === 0) {
      toast.error("Lengkapi data transaksi");
      return;
    }

    createMutation.mutate({
      studentId: selectedStudent.id,
      unitId: selectedUnit,
      businessUnitId: (laundryBusinessUnits ?? []).find(
        (businessUnit) => businessUnit.unitId === selectedUnit,
      )?.id,
      items: selectedItems.map((i) => ({
        pricingId: i.pricingId,
        quantity: i.quantity,
        weight: i.weight,
      })),
      paymentMethod,
      notes,
    });
  };

  const transactions = transactionsData?.data || [];
  const students = studentsData?.data || [];
  const units = unitsData?.data || [];
  const availablePricing = pricingData?.data || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari nomor transaksi atau santri..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Semua status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Semua status</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="PROCESSING">Proses</SelectItem>
              <SelectItem value="READY">Siap Ambil</SelectItem>
              <SelectItem value="DELIVERED">Diambil</SelectItem>
              <SelectItem value="CANCELLED">Batal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Dialog
          open={showDialog}
          onOpenChange={(open) => {
            setShowDialog(open);
            if (!open) resetForm();
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
                Buat transaksi laundry baru untuk santri
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Select value={selectedUnit} onValueChange={setSelectedUnit}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih unit" />
                    </SelectTrigger>
                    <SelectContent>
                      {units.map((unit: { id: string; name: string }) => (
                        <SelectItem key={unit.id} value={unit.id}>
                          {unit.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Metode Pembayaran</Label>
                  <Select
                    value={paymentMethod}
                    onValueChange={setPaymentMethod}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CASH">Tunai</SelectItem>
                      <SelectItem value="WALLET">Dompet Digital</SelectItem>
                      <SelectItem value="TRANSFER">Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Cari Santri</Label>
                <Input
                  placeholder="Ketik nama atau NIS..."
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                />
                {students.length > 0 && !selectedStudent && (
                  <div className="border rounded-md max-h-32 overflow-y-auto">
                    {students.map((student: Student) => (
                      <div
                        key={student.id}
                        className="p-2 hover:bg-muted cursor-pointer"
                        onClick={() => {
                          setSelectedStudent(student);
                          setStudentSearch(student.fullName);
                        }}
                      >
                        <div className="font-medium">{student.fullName}</div>
                        <div className="text-sm text-muted-foreground">
                          {student.nis}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {selectedStudent && (
                  <div className="flex items-center justify-between p-2 bg-muted rounded-md">
                    <div>
                      <div className="font-medium">
                        {selectedStudent.fullName}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {selectedStudent.nis}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedStudent(null);
                        setStudentSearch("");
                      }}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              {selectedUnit && (
                <div className="space-y-2">
                  <Label>Pilih Item Laundry</Label>
                  <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                    {availablePricing.map((pricing: LaundryPricing) => (
                      <Button
                        key={pricing.id}
                        type="button"
                        variant="outline"
                        className="justify-start"
                        onClick={() => addItem(pricing)}
                      >
                        <Shirt className="h-4 w-4 mr-2" />
                        <div className="text-left">
                          <div>{pricing.itemType}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatCurrency(pricing.pricePerItem)}
                          </div>
                        </div>
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {selectedItems.length > 0 && (
                <div className="space-y-2">
                  <Label>Item Dipilih</Label>
                  <div className="border rounded-md divide-y">
                    {selectedItems.map((item) => (
                      <div
                        key={item.pricingId}
                        className="flex items-center justify-between p-2"
                      >
                        <div>
                          <div className="font-medium">{item.itemType}</div>
                          <div className="text-sm text-muted-foreground">
                            {formatCurrency(item.price)} × {item.quantity} ={" "}
                            {formatCurrency(item.price * item.quantity)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              updateItemQuantity(
                                item.pricingId,
                                item.quantity - 1,
                              )
                            }
                          >
                            -
                          </Button>
                          <span className="w-8 text-center">
                            {item.quantity}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              updateItemQuantity(
                                item.pricingId,
                                item.quantity + 1,
                              )
                            }
                          >
                            +
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between items-center p-2 bg-muted rounded-md">
                    <span className="font-medium">Total</span>
                    <span className="font-bold text-lg">
                      {formatCurrency(totalAmount)}
                    </span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Catatan (opsional)</Label>
                <Textarea
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
                    setShowDialog(false);
                    resetForm();
                  }}
                >
                  Batal
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Buat Transaksi
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Transaction Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detail Transaksi</DialogTitle>
            <DialogDescription>
              {selectedTransaction?.transactionNumber}
            </DialogDescription>
          </DialogHeader>
          {selectedTransaction && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Santri</Label>
                  <div className="font-medium">
                    {selectedTransaction.student?.fullName}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {selectedTransaction.student?.nis}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div>
                    <Badge
                      className={getStatusColor(selectedTransaction.status)}
                    >
                      {selectedTransaction.status}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Tanggal Masuk</Label>
                  <div>
                    {format(
                      new Date(selectedTransaction.receivedAt),
                      "dd MMM yyyy HH:mm",
                      { locale: localeId },
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">
                    Estimasi Selesai
                  </Label>
                  <div>
                    {selectedTransaction.estimatedReady
                      ? format(
                          new Date(selectedTransaction.estimatedReady),
                          "dd MMM yyyy",
                          { locale: localeId },
                        )
                      : "-"}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Total Item</Label>
                  <div>{selectedTransaction.totalItems} item</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Total</Label>
                  <div className="font-bold">
                    {formatCurrency(selectedTransaction.totalAmount)}
                  </div>
                </div>
              </div>

              {selectedTransaction.items &&
                selectedTransaction.items.length > 0 && (
                  <div className="space-y-2">
                    <Label>Item Laundry</Label>
                    <div className="border rounded-md divide-y">
                      {selectedTransaction.items.map((item) => (
                        <div key={item.id} className="flex justify-between p-2">
                          <div>
                            <div>{item.pricing?.itemType || "-"}</div>
                            <div className="text-sm text-muted-foreground">
                              {item.quantity} × {formatCurrency(item.price)}
                            </div>
                          </div>
                          <div className="font-medium">
                            {formatCurrency(item.subtotal)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {selectedTransaction.notes && (
                <div>
                  <Label className="text-muted-foreground">Catatan</Label>
                  <div>{selectedTransaction.notes}</div>
                </div>
              )}

              <div className="flex gap-2">
                {selectedTransaction.status === "PENDING" && (
                  <Button
                    onClick={() => {
                      updateStatusMutation.mutate({
                        id: selectedTransaction.id,
                        status: "PROCESSING",
                      });
                      setShowDetailDialog(false);
                    }}
                    className="flex-1"
                  >
                    <WashingMachine className="h-4 w-4 mr-2" />
                    Mulai Proses
                  </Button>
                )}
                {selectedTransaction.status === "PROCESSING" && (
                  <Button
                    onClick={() => {
                      updateStatusMutation.mutate({
                        id: selectedTransaction.id,
                        status: "READY",
                      });
                      setShowDetailDialog(false);
                    }}
                    className="flex-1"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Siap Ambil
                  </Button>
                )}
                {selectedTransaction.status === "READY" && (
                  <Button
                    onClick={() => {
                      updateStatusMutation.mutate({
                        id: selectedTransaction.id,
                        status: "DELIVERED",
                      });
                      setShowDetailDialog(false);
                    }}
                    className="flex-1"
                  >
                    <Package className="h-4 w-4 mr-2" />
                    Sudah Diambil
                  </Button>
                )}
                {["PENDING", "PROCESSING"].includes(
                  selectedTransaction.status,
                ) && (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      if (confirm("Batalkan transaksi ini?")) {
                        updateStatusMutation.mutate({
                          id: selectedTransaction.id,
                          status: "CANCELLED",
                        });
                        setShowDetailDialog(false);
                      }
                    }}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Batalkan
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No. Transaksi</TableHead>
              <TableHead>Santri</TableHead>
              <TableHead>Tanggal</TableHead>
              <TableHead>Item</TableHead>
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
              transactions.map((tx: LaundryTransaction) => (
                <TableRow key={tx.id}>
                  <TableCell className="font-mono">
                    {tx.transactionNumber}
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="font-medium">{tx.student?.fullName}</div>
                      <div className="text-sm text-muted-foreground">
                        {tx.student?.nis}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {safeFormat(new Date(tx.receivedAt), "dd/MM/yy HH:mm")}
                  </TableCell>
                  <TableCell>{tx.totalItems} item</TableCell>
                  <TableCell>{formatCurrency(tx.totalAmount)}</TableCell>
                  <TableCell>
                    <Badge className={getStatusColor(tx.status)}>
                      {tx.status === "PENDING" && "Pending"}
                      {tx.status === "PROCESSING" && "Proses"}
                      {tx.status === "READY" && "Siap Ambil"}
                      {tx.status === "DELIVERED" && "Diambil"}
                      {tx.status === "CANCELLED" && "Batal"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={getPaymentStatusColor(tx.paymentStatus)}>
                      {tx.paymentStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setSelectedTransaction(tx);
                        setShowDetailDialog(true);
                      }}
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
    </div>
  );
}

// Main Page Component
function LaundryPageContent() {
  const { data: transactionsData } = useQuery({
    queryKey: ["laundry-transactions"],
    queryFn: () => fetchTransactions(),
  });

  const transactions = transactionsData?.data || [];

  // Calculate stats
  const stats = {
    pending: transactions.filter(
      (t: LaundryTransaction) => t.status === "PENDING",
    ).length,
    processing: transactions.filter(
      (t: LaundryTransaction) => t.status === "PROCESSING",
    ).length,
    ready: transactions.filter((t: LaundryTransaction) => t.status === "READY")
      .length,
    totalRevenue: transactions
      .filter((t: LaundryTransaction) => t.paymentStatus === "PAID")
      .reduce((sum: number, t: LaundryTransaction) => sum + t.totalAmount, 0),
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Laundry</h1>
          <p className="text-muted-foreground">
            Kelola layanan laundry untuk santri
          </p>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Menunggu</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pending}</div>
            <p className="text-xs text-muted-foreground">transaksi pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Diproses</CardTitle>
            <WashingMachine className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.processing}</div>
            <p className="text-xs text-muted-foreground">sedang dicuci</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Siap Ambil</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.ready}</div>
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
              {formatCurrency(stats.totalRevenue)}
            </div>
            <p className="text-xs text-muted-foreground">total terbayar</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="transactions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="transactions" className="gap-2">
            <Package className="h-4 w-4" />
            Transaksi
          </TabsTrigger>
          <TabsTrigger value="pricing" className="gap-2">
            <Tag className="h-4 w-4" />
            Harga
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
