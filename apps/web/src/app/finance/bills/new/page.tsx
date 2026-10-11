"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { ArrowLeft, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  useCreateBill,
  useCreateBulkBills,
  BILL_TYPES,
  BillType,
} from "@/hooks/use-finance";
import {
  useAcademicYears,
  useActiveAcademicYear,
} from "@/hooks/use-academic-years";
import { useStudents } from "@/hooks/use-students";
import { useClasses } from "@/hooks/use-classes";

import { MainLayout } from "@/components/layout";
const formSchema = z.object({
  billType: z.string().min(1, "Jenis tagihan wajib dipilih"),
  amount: z.coerce.number().min(1, "Jumlah minimal Rp 1"),
  dueDate: z.string().min(1, "Tanggal jatuh tempo wajib diisi"),
  academicYearId: z.string().min(1, "Tahun ajaran wajib dipilih"),
  description: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

function NewBillPageContent() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [classId, setClassId] = useState<string>("");
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [isBulk, setIsBulk] = useState(false);

  const createBillMutation = useCreateBill();
  const createBulkBillsMutation = useCreateBulkBills();

  const { data: activeYear } = useActiveAcademicYear();
  const { data: academicYears } = useAcademicYears({ limit: 20 });
  const { data: classesData } = useClasses({ limit: 100 });
  const { data: studentsData, isLoading: studentsLoading } = useStudents({
    search: search || undefined,
    classId: classId || undefined,
    limit: 50,
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      billType: "",
      amount: 0,
      dueDate: "",
      academicYearId: activeYear?.id || "",
      description: "",
    },
  });

  // Update academicYearId when activeYear loads. This must run in an effect:
  // calling `form.setValue` during render updates a component while another one
  // renders, which React reports as an error and which can drop the value.
  useEffect(() => {
    if (activeYear?.id && !form.getValues("academicYearId")) {
      form.setValue("academicYearId", activeYear.id);
    }
  }, [activeYear?.id, form]);

  const toggleStudent = (studentId: string) => {
    setSelectedStudents((prev) =>
      prev.includes(studentId)
        ? prev.filter((id) => id !== studentId)
        : [...prev, studentId],
    );
  };

  const toggleAll = () => {
    if (!studentsData?.data) return;
    const allIds = studentsData.data.map((s) => s.id);
    if (selectedStudents.length === allIds.length) {
      setSelectedStudents([]);
    } else {
      setSelectedStudents(allIds);
    }
  };

  const onSubmit = async (data: FormData) => {
    if (selectedStudents.length === 0) {
      toast.error("Pilih minimal 1 santri");
      return;
    }

    try {
      if (selectedStudents.length === 1) {
        await createBillMutation.mutateAsync({
          studentId: selectedStudents[0],
          academicYearId: data.academicYearId,
          billType: data.billType as BillType,
          amount: data.amount,
          dueDate: data.dueDate,
          description: data.description,
        });
        toast.success(
          "Tagihan berhasil dibuat dan notifikasi dikirim ke santri",
        );
      } else {
        await createBulkBillsMutation.mutateAsync({
          studentIds: selectedStudents,
          academicYearId: data.academicYearId,
          billType: data.billType as BillType,
          amount: data.amount,
          dueDate: data.dueDate,
          description: data.description,
        });
        toast.success(`${selectedStudents.length} tagihan berhasil dibuat`);
      }
      router.push("/finance");
    } catch {
      toast.error("Gagal membuat tagihan");
    }
  };

  const isPending =
    createBillMutation.isPending || createBulkBillsMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/finance">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Buat Tagihan</h1>
          <p className="text-muted-foreground">
            Buat tagihan baru untuk santri
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Bill Details Form */}
        <Card>
          <CardHeader>
            <CardTitle>Detail Tagihan</CardTitle>
            <CardDescription>Tentukan jenis dan jumlah tagihan</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form className="space-y-4">
                <FormField
                  control={form.control}
                  name="billType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Jenis Tagihan</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih jenis tagihan" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {BILL_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Jumlah (Rp)</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="0" {...field} />
                      </FormControl>
                      <FormDescription>
                        Jumlah tagihan dalam Rupiah
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tanggal Jatuh Tempo</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="academicYearId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tahun Ajaran</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih tahun ajaran" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {academicYears?.data.map((year) => (
                            <SelectItem key={year.id} value={year.id}>
                              {year.name} {year.isActive && "(Aktif)"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Keterangan (Opsional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Keterangan tambahan..."
                          rows={3}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* Student Selection */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Pilih Santri</CardTitle>
                <CardDescription>
                  Pilih santri yang akan dibuatkan tagihan
                </CardDescription>
              </div>
              {selectedStudents.length > 0 && (
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {selectedStudents.length} dipilih
                  </span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Cari nama/NIS..."
                  className="pl-10"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={classId} onValueChange={setClassId}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Kelas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Semua Kelas</SelectItem>
                  {classesData?.data.map((cls) => (
                    <SelectItem key={cls.id} value={cls.id}>
                      {cls.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="max-h-[400px] overflow-auto rounded-md border">
              {studentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : studentsData?.data.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  Tidak ada santri ditemukan
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={
                            studentsData?.data &&
                            studentsData.data.length > 0 &&
                            selectedStudents.length === studentsData.data.length
                          }
                          onCheckedChange={toggleAll}
                        />
                      </TableHead>
                      <TableHead>NIS</TableHead>
                      <TableHead>Nama</TableHead>
                      <TableHead>Kelas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {studentsData?.data.map((student) => (
                      <TableRow
                        key={student.id}
                        className="cursor-pointer"
                        onClick={() => toggleStudent(student.id)}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedStudents.includes(student.id)}
                            onCheckedChange={() => toggleStudent(student.id)}
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end gap-4">
        <Button variant="outline" asChild>
          <Link href="/finance">Batal</Link>
        </Button>
        <Button
          onClick={form.handleSubmit(onSubmit)}
          disabled={isPending || selectedStudents.length === 0}
        >
          {isPending
            ? "Menyimpan..."
            : selectedStudents.length > 1
              ? `Buat ${selectedStudents.length} Tagihan`
              : "Buat Tagihan"}
        </Button>
      </div>
    </div>
  );
}

export default function NewBillPage() {
  return (
    <MainLayout>
      <NewBillPageContent />
    </MainLayout>
  );
}
