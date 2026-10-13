"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Search, Loader2 } from "lucide-react";
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
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  useViolation,
  useUpdateViolation,
  useViolationTypes,
  VIOLATION_CATEGORIES,
} from "@/hooks/use-violations";
import { useStudents } from "@/hooks/use-students";

import { MainLayout } from "@/components/layout";
const formSchema = z.object({
  studentId: z.string().min(1, "Santri wajib dipilih"),
  violationTypeId: z.string().min(1, "Jenis pelanggaran wajib dipilih"),
  date: z.string().min(1, "Tanggal wajib diisi"),
  description: z.string().optional(),
  witness: z.string().optional(),
  actionTaken: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

function EditViolationPageContent() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [search, setSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<{
    id: string;
    name: string;
    nis: string;
  } | null>(null);

  const { data: violation, isLoading } = useViolation(id);
  const updateMutation = useUpdateViolation();
  const { data: violationTypes } = useViolationTypes({ isActive: true });

  const { data: studentsData, isLoading: studentsLoading } = useStudents({
    search: search || undefined,
    limit: 10,
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      studentId: "",
      violationTypeId: "",
      date: "",
      description: "",
      witness: "",
      actionTaken: "",
    },
  });

  useEffect(() => {
    if (violation) {
      form.reset({
        studentId: violation.studentId,
        violationTypeId: violation.violationTypeId,
        date: violation.date.split("T")[0],
        description: violation.description || "",
        witness: violation.witness || "",
        actionTaken: violation.actionTaken || "",
      });
      if (violation.student) {
        setSelectedStudent({
          id: violation.student.id,
          name: violation.student.name,
          nis: violation.student.nis,
        });
      }
    }
  }, [violation, form]);

  const onSubmit = async (data: FormData) => {
    try {
      await updateMutation.mutateAsync({
        id,
        data: {
          type: selectedType?.category
            ? ({ LIGHT: "MINOR", MEDIUM: "MODERATE", HEAVY: "MAJOR" }[
                selectedType.category
              ] ?? "MINOR")
            : undefined,
          category: data.violationTypeId,
          description: data.description?.trim() || "Pelanggaran dicatat",
          occurredAt: new Date(data.date).toISOString(),
          points: selectedType?.points,
          action: data.actionTaken || undefined,
        },
      });
      toast.success("Pelanggaran berhasil diperbarui");
      router.push(`/violations/${id}`);
    } catch {
      toast.error("Gagal memperbarui pelanggaran");
    }
  };

  const handleSelectStudent = (student: {
    id: string;
    name: string;
    nis: string;
  }) => {
    setSelectedStudent(student);
    form.setValue("studentId", student.id);
    setSearch("");
  };

  const selectedType = violationTypes?.find(
    (t) => t.id === form.watch("violationTypeId"),
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!violation) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">
          Data pelanggaran tidak ditemukan
        </p>
        <Button variant="link" asChild>
          <Link href="/violations">Kembali ke daftar</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/violations/${id}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Edit Pelanggaran
          </h1>
          <p className="text-muted-foreground">
            Perbarui data pelanggaran santri
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Student Selection */}
            <Card>
              <CardHeader>
                <CardTitle>Pilih Santri</CardTitle>
                <CardDescription>
                  Santri yang melakukan pelanggaran
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedStudent ? (
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <p className="font-medium">{selectedStudent.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {selectedStudent.nis}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedStudent(null);
                        form.setValue("studentId", "");
                      }}
                    >
                      Ganti
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Cari nama/NIS santri..."
                        className="pl-10"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>

                    {search && (
                      <div className="max-h-[300px] overflow-auto rounded-md border">
                        {studentsLoading ? (
                          <div className="flex items-center justify-center py-4">
                            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                          </div>
                        ) : studentsData?.data.length === 0 ? (
                          <div className="py-4 text-center text-muted-foreground">
                            Tidak ada santri ditemukan
                          </div>
                        ) : (
                          <Table>
                            <TableBody>
                              {studentsData?.data.map((student) => (
                                <TableRow
                                  key={student.id}
                                  className="cursor-pointer"
                                  onClick={() =>
                                    handleSelectStudent({
                                      id: student.id,
                                      name: student.name,
                                      nis: student.nis,
                                    })
                                  }
                                >
                                  <TableCell>{student.nis}</TableCell>
                                  <TableCell className="font-medium">
                                    {student.name}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                    )}
                  </>
                )}

                {form.formState.errors.studentId && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.studentId.message}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Violation Details */}
            <Card>
              <CardHeader>
                <CardTitle>Detail Pelanggaran</CardTitle>
                <CardDescription>Informasi pelanggaran</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="violationTypeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Jenis Pelanggaran</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih jenis pelanggaran" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {violationTypes?.map((type) => (
                            <SelectItem key={type.id} value={type.id}>
                              <div className="flex items-center gap-2">
                                <span>{type.name}</span>
                                <Badge
                                  variant="outline"
                                  className={
                                    VIOLATION_CATEGORIES.find(
                                      (c) => c.value === type.category,
                                    )?.color
                                  }
                                >
                                  {type.points} poin
                                </Badge>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {selectedType && (
                  <div className="rounded-lg border bg-muted/50 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Kategori:
                      </span>
                      <Badge
                        variant="outline"
                        className={
                          VIOLATION_CATEGORIES.find(
                            (c) => c.value === selectedType.category,
                          )?.color
                        }
                      >
                        {
                          VIOLATION_CATEGORIES.find(
                            (c) => c.value === selectedType.category,
                          )?.label
                        }
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        Poin:
                      </span>
                      <span className="font-semibold">
                        {selectedType.points}
                      </span>
                    </div>
                    {selectedType.description && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {selectedType.description}
                      </p>
                    )}
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tanggal Pelanggaran</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Deskripsi (Opsional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Jelaskan kronologi pelanggaran..."
                          rows={3}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="witness"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Saksi (Opsional)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Nama saksi yang melihat"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="actionTaken"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tindakan (Opsional)</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Tindakan yang sudah diambil..."
                          rows={2}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-4">
            <Button variant="outline" asChild>
              <Link href={`/violations/${id}`}>Batal</Link>
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

export default function EditViolationPage() {
  return (
    <MainLayout>
      <EditViolationPageContent />
    </MainLayout>
  );
}
