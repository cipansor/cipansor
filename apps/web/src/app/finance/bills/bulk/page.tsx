"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Users, Check } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { toast } from "sonner";
import { format, addMonths } from "date-fns";

import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreateBulkBills, useBillPaymentTypes } from "@/hooks/use-finance";
import { useUnits } from "@/hooks/use-units";
import { useClasses } from "@/hooks/use-classes";
import { useStudents } from "@/hooks/use-students";
import { STUDENT_STATUS } from "@cipansor/shared";

const bulkBillSchema = z.object({
  paymentTypeId: z.string().min(1, "Pilih jenis tagihan"),
  amount: z.coerce.number().min(1, "Jumlah harus lebih dari 0"),
  dueDate: z.string().min(1, "Pilih tanggal jatuh tempo"),
  period: z.string().optional(),
  notes: z.string().optional(),
});

type BulkBillFormData = z.infer<typeof bulkBillSchema>;

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}

export default function BulkBillsPage() {
  const router = useRouter();
  const [unitId, setUnitId] = useState<string>("");
  const [classId, setClassId] = useState<string>("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: unitsData } = useUnits();
  const units = unitsData || [];

  const { data: classesData } = useClasses({
    unitId: unitId || undefined,
    limit: 100,
  });
  const classes = classesData?.data || [];

  const { data: studentsData, isLoading: studentsLoading } = useStudents({
    unitId: unitId || undefined,
    classId: classId || undefined,
    limit: 500,
    status: STUDENT_STATUS.ACTIVE,
  });
  const students = studentsData?.data || [];

  const { data: paymentTypes } = useBillPaymentTypes();
  const createBulkBills = useCreateBulkBills();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<BulkBillFormData>({
    resolver: zodResolver(bulkBillSchema),
    defaultValues: {
      paymentTypeId: "",
      amount: 0,
      dueDate: format(addMonths(new Date(), 1), "yyyy-MM-dd"),
      period: "",
      notes: "",
    },
  });

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      setSelectedStudentIds(students.map((s) => s.id));
    } else {
      setSelectedStudentIds([]);
    }
  };

  const handleStudentSelect = (studentId: string, checked: boolean) => {
    if (checked) {
      setSelectedStudentIds([...selectedStudentIds, studentId]);
    } else {
      setSelectedStudentIds(
        selectedStudentIds.filter((id) => id !== studentId),
      );
      setSelectAll(false);
    }
  };

  const onSubmit = async (data: BulkBillFormData) => {
    if (selectedStudentIds.length === 0) {
      toast.error("Pilih minimal satu santri");
      return;
    }

    setIsSubmitting(true);
    try {
      await createBulkBills.mutateAsync({
        studentIds: selectedStudentIds,
        paymentTypeId: data.paymentTypeId,
        amount: data.amount,
        dueDate: data.dueDate,
        period: data.period || undefined,
        notes: data.notes || undefined,
      });

      toast.success(`Berhasil membuat ${selectedStudentIds.length} tagihan`);
      router.push("/finance");
    } catch {
      toast.error("Gagal membuat tagihan");
    } finally {
      setIsSubmitting(false);
    }
  };

  const amount = watch("amount") || 0;
  const totalAmount = amount * selectedStudentIds.length;

  return (
    <MainLayout>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/finance">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Buat Tagihan Massal</h1>
          <p className="text-muted-foreground">
            Buat tagihan untuk beberapa santri sekaligus
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Form Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Detail Tagihan</CardTitle>
            <CardDescription>
              Tentukan detail tagihan yang akan dibuat
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="paymentTypeId">Jenis Tagihan</Label>
              <Select
                value={watch("paymentTypeId")}
                onValueChange={(v) => setValue("paymentTypeId", v)}
              >
                <SelectTrigger id="paymentTypeId">
                  <SelectValue placeholder="Pilih jenis tagihan" />
                </SelectTrigger>
                <SelectContent>
                  {paymentTypes?.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.paymentTypeId && (
                <p className="text-sm text-destructive">
                  {errors.paymentTypeId.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">Jumlah (Rp)</Label>
              <Input
                id="amount"
                type="number"
                {...register("amount")}
                placeholder="Masukkan jumlah"
              />
              {errors.amount && (
                <p className="text-sm text-destructive">
                  {errors.amount.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="dueDate">Tanggal Jatuh Tempo</Label>
              <Input id="dueDate" type="date" {...register("dueDate")} />
              {errors.dueDate && (
                <p className="text-sm text-destructive">
                  {errors.dueDate.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="period">Periode (Opsional)</Label>
              <Input
                id="period"
                {...register("period")}
                placeholder="mis. September 2026"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notes">Keterangan</Label>
              <Textarea
                id="notes"
                {...register("notes")}
                placeholder="Keterangan tagihan (opsional)"
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        {/* Student Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Pilih Santri</CardTitle>
            <CardDescription>
              Filter dan pilih santri yang akan dibuatkan tagihan
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-4">
              <Select
                value={unitId}
                onValueChange={(v) => {
                  setUnitId(v);
                  setClassId("");
                  setSelectedStudentIds([]);
                  setSelectAll(false);
                }}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Filter Unit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Semua Unit</SelectItem>
                  {units.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {unit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={classId}
                onValueChange={(v) => {
                  setClassId(v);
                  setSelectedStudentIds([]);
                  setSelectAll(false);
                }}
                disabled={!unitId}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Filter Kelas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Semua Kelas</SelectItem>
                  {classes.map((cls) => (
                    <SelectItem key={cls.id} value={cls.id}>
                      {cls.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedStudentIds.length > 0 && (
                <Badge variant="secondary" className="h-10 px-4 text-sm">
                  <Check className="mr-1 h-3 w-3" />
                  {selectedStudentIds.length} santri dipilih
                </Badge>
              )}
            </div>

            {/* Student Table */}
            {studentsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : students.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Users className="h-12 w-12 text-muted-foreground" />
                <p className="mt-2 text-muted-foreground">
                  {unitId || classId
                    ? "Tidak ada santri untuk filter yang dipilih"
                    : "Pilih unit atau kelas untuk menampilkan santri"}
                </p>
              </div>
            ) : (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={selectAll}
                          onCheckedChange={handleSelectAll}
                          aria-label="Select all students"
                        />
                      </TableHead>
                      <TableHead>NIS</TableHead>
                      <TableHead>Nama</TableHead>
                      <TableHead>Kelas</TableHead>
                      <TableHead>Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {students.map((student) => (
                      <TableRow key={student.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedStudentIds.includes(student.id)}
                            onCheckedChange={(checked) =>
                              handleStudentSelect(student.id, !!checked)
                            }
                            aria-label={`Select ${student.name}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {student.nis}
                        </TableCell>
                        <TableCell className="font-medium">
                          {student.name}
                        </TableCell>
                        <TableCell>
                          {student.currentClass?.name || "-"}
                        </TableCell>
                        <TableCell>{student.unit?.name || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Summary & Submit */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-center sm:text-left">
                <p className="text-sm text-muted-foreground">Total Tagihan</p>
                <p className="text-2xl font-bold">
                  {selectedStudentIds.length} santri × {formatCurrency(amount)}{" "}
                  ={" "}
                  <span className="text-primary">
                    {formatCurrency(totalAmount)}
                  </span>
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" asChild>
                  <Link href="/finance">Batal</Link>
                </Button>
                <Button
                  type="submit"
                  disabled={selectedStudentIds.length === 0 || isSubmitting}
                >
                  {isSubmitting
                    ? "Membuat..."
                    : `Buat ${selectedStudentIds.length} Tagihan`}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </form>
    </MainLayout>
  );
}
