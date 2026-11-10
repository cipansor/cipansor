"use client";

import { useState } from "react";
import { safeFormat } from "@/lib/date";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import {
  Loader2,
  Plus,
  Scale,
  Ruler,
  Activity,
  Calendar as CalendarIcon,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClasses } from "@/hooks/use-classes";
import { useClassEnrollments } from "@/hooks/use-class-enrollments";
import {
  useCreateGrowthRecord,
  useDeleteGrowthRecord,
  useGrowthRecords,
} from "@/hooks/use-health";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { MainLayout } from "@/components/layout";

function GrowthTrackingPageContent() {
  const { user } = useAuthStore();
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(
    null,
  );
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    date: new Date(),
    weight: "",
    height: "",
    headCircumference: "",
    notes: "",
  });

  // Fetch Classes
  const { data: classesData } = useClasses({ unitId: user?.unitId });

  // Fetch Students for Class
  const { data: studentsData } = useClassEnrollments(selectedClassId ?? "");
  const { data: growthData, isLoading } = useGrowthRecords(
    selectedStudentId ?? undefined,
  );
  const createMutation = useCreateGrowthRecord();
  const deleteMutation = useDeleteGrowthRecord(selectedStudentId ?? undefined);

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id, {
      onSuccess: () => toast.success("Data tumbuh kembang berhasil dihapus"),
      onError: () => toast.error("Gagal menghapus data tumbuh kembang"),
    });
  };
  // The record goes under the santri's unit, read from the chosen class: an
  // account with no unit of its own (Super Admin, a cross-unit nurse) has none
  // to give, and the API requires one.
  const selectedClassUnitId = classesData?.data?.find(
    (c) => c.id === selectedClassId,
  )?.unitId;

  const handleSubmit = () => {
    if (!selectedStudentId || !selectedClassUnitId) return;
    createMutation.mutate(
      {
        studentId: selectedStudentId,
        unitId: selectedClassUnitId,
        recordDate: formData.date,
        weight: parseFloat(formData.weight) || undefined,
        height: parseFloat(formData.height) || undefined,
        headCircumference: parseFloat(formData.headCircumference) || undefined,
        notes: formData.notes,
      },
      {
        onSuccess: () => {
          toast.success("Data tumbuh kembang berhasil disimpan");
          setIsAddOpen(false);
          setFormData({
            date: new Date(),
            weight: "",
            height: "",
            headCircumference: "",
            notes: "",
          });
        },
      },
    );
  };

  // Prepare chart data (reverse to show chronological order left to right)
  const chartData = growthData
    ? [...growthData].reverse().map((r) => ({
        date: safeFormat(new Date(r.recordDate), "dd/MM/yy"),
        weight: r.weight,
        height: r.height,
        head: r.headCircumference,
      }))
    : [];

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Pantau Tumbuh Kembang
          </h1>
          <p className="text-muted-foreground">
            Catat dan pantau Berat Badan (BB), Tinggi Badan (TB), dan Lingkar
            Kepala (LK).
          </p>
        </div>
        <div className="flex gap-2">
          <Select
            value={selectedClassId || ""}
            onValueChange={(val) => {
              setSelectedClassId(val);
              setSelectedStudentId(null);
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Pilih Kelas" />
            </SelectTrigger>
            <SelectContent>
              {classesData?.data?.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={selectedStudentId || ""}
            onValueChange={setSelectedStudentId}
            disabled={!selectedClassId}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Pilih Siswa" />
            </SelectTrigger>
            <SelectContent>
              {studentsData?.map((e: any) => (
                <SelectItem key={e.student.id} value={e.student.id}>
                  {e.student.user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button disabled={!selectedStudentId}>
                <Plus className="mr-2 h-4 w-4" />
                Catat Data
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Catat Tumbuh Kembang</DialogTitle>
                <DialogDescription>
                  Masukkan data pengukuran terbaru siswa.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="date" className="text-right">
                    Tanggal
                  </Label>
                  <div className="col-span-3">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant={"outline"}
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !formData.date && "text-muted-foreground",
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {formData.date ? (
                            format(formData.date, "PPP", { locale: id })
                          ) : (
                            <span>Pilih tanggal</span>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={formData.date}
                          onSelect={(d) =>
                            d && setFormData({ ...formData, date: d })
                          }
                          autoFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="weight" className="text-right">
                    Berat (kg)
                  </Label>
                  <Input
                    id="weight"
                    type="number"
                    step="0.1"
                    className="col-span-3"
                    value={formData.weight}
                    onChange={(e) =>
                      setFormData({ ...formData, weight: e.target.value })
                    }
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="height" className="text-right">
                    Tinggi (cm)
                  </Label>
                  <Input
                    id="height"
                    type="number"
                    step="0.1"
                    className="col-span-3"
                    value={formData.height}
                    onChange={(e) =>
                      setFormData({ ...formData, height: e.target.value })
                    }
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="head" className="text-right">
                    Lingkar Kpl (cm)
                  </Label>
                  <Input
                    id="head"
                    type="number"
                    step="0.1"
                    className="col-span-3"
                    value={formData.headCircumference}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        headCircumference: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="notes" className="text-right">
                    Catatan
                  </Label>
                  <Input
                    id="notes"
                    className="col-span-3"
                    value={formData.notes}
                    onChange={(e) =>
                      setFormData({ ...formData, notes: e.target.value })
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleSubmit}
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Simpan
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {!selectedStudentId ? (
        <div className="flex flex-col items-center justify-center h-[400px] border rounded-lg bg-muted/10">
          <Activity className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <p className="text-muted-foreground">
            Pilih siswa untuk melihat data tumbuh kembang.
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Charts */}
          <Card>
            <CardHeader>
              <CardTitle>Grafik Pertumbuhan</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
                  <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
                  <Tooltip />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="weight"
                    name="Berat (kg)"
                    stroke="#8884d8"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="height"
                    name="Tinggi (cm)"
                    stroke="#82ca9d"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Recent Records Table */}
          <Card>
            <CardHeader>
              <CardTitle>Riwayat Pengukuran</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>BB (kg)</TableHead>
                    <TableHead>TB (cm)</TableHead>
                    <TableHead>LK (cm)</TableHead>
                    <TableHead>Catatan</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {growthData?.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell>
                        {safeFormat(
                          new Date(record.recordDate),
                          "dd MMM yyyy",
                          {
                            locale: id,
                          },
                        )}
                      </TableCell>
                      <TableCell>{record.weight || "-"}</TableCell>
                      <TableCell>{record.height || "-"}</TableCell>
                      <TableCell>{record.headCircumference || "-"}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {record.notes}
                      </TableCell>
                      <TableCell className="text-right">
                        <ConfirmDialog
                          title="Hapus Data Tumbuh Kembang"
                          description="Tindakan ini tidak dapat dibatalkan."
                          confirmLabel="Hapus"
                          onConfirm={() => handleDelete(record.id)}
                          loading={deleteMutation.isPending}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            aria-label="Hapus"
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </ConfirmDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                  {growthData?.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-muted-foreground"
                      >
                        Belum ada data.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function GrowthTrackingPage() {
  return (
    <MainLayout>
      <GrowthTrackingPageContent />
    </MainLayout>
  );
}
