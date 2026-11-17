"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import * as z from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useStudents } from "@/hooks/use-students";
import { useTeachers, type Teacher } from "@/hooks/use-teachers";
import { useCreateSimaan, SIMAAN_TYPES } from "@/hooks/use-simaan";
import { SimaanTypeEnum } from "@cipansor/shared";
import { toast } from "sonner";

import { MainLayout } from "@/components/layout";
const formSchema = z
  .object({
    studentId: z.string().min(1, "Santri harus dipilih"),
    simaanType: SimaanTypeEnum,
    examDate: z.string().min(1, "Tanggal ujian harus diisi"),
    juzStart: z.coerce.number().min(1).max(30),
    juzEnd: z.coerce.number().min(1).max(30),
    examinerId: z.string().min(1, "Penguji harus dipilih"),
    notes: z.string().optional(),
  })
  .refine((data) => data.juzEnd >= data.juzStart, {
    message: "Juz akhir harus lebih besar atau sama dengan juz awal",
    path: ["juzEnd"],
  });

function CreateSimaanPageContent() {
  const router = useRouter();
  const { mutate: createSimaan, isPending } = useCreateSimaan();

  // Fetch students and teachers for dropdowns
  const { data: studentsData, isLoading: isLoadingStudents } = useStudents({
    page: 1,
    limit: 100,
  });

  const { data: teachersData, isLoading: isLoadingTeachers } = useTeachers({
    page: 1,
    limit: 100,
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      studentId: "",
      simaanType: "BIN_NAZHR",
      examDate: "",
      juzStart: 1,
      juzEnd: 1,
      examinerId: "",
      notes: "",
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const studentOptions =
    studentsData?.data?.map((s: any) => ({
      value: s.id,
      label: `${s.user?.name} (${s.nis})`,
    })) || [];

  const teacherOptions =
    teachersData?.data?.map((t: Teacher) => ({
      // `SimaanExaminer.examinerId` references `users.id`, not the Teacher row.
      value: t.userId,
      label: t.user?.name ?? "",
    })) || [];

  function onSubmit(values: z.infer<typeof formSchema>) {
    // `examinerId` is a form field only; the API contract takes `examinerIds`
    // and is strict, so it must not be forwarded.
    const { examinerId, ...rest } = values;
    createSimaan(
      {
        ...rest,
        examinerIds: [examinerId],
      },
      {
        onSuccess: () => {
          toast.success("Jadwal simaan berhasil dibuat");
          router.push("/takhosus/simaan");
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onError: (error: any) => {
          toast.error(error?.response?.data?.message || "Gagal membuat jadwal");
        },
      },
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Buat Jadwal Simaan"
        description="Jadwalkan ujian simaan baru untuk santri."
        backHref="/takhosus/simaan"
      />

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Formulir Jadwal</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="studentId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Santri</FormLabel>
                        <FormControl>
                          <SearchableSelect
                            options={studentOptions}
                            value={field.value}
                            onValueChange={field.onChange}
                            placeholder="Pilih santri..."
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="examinerId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Penguji (Examiner)</FormLabel>
                        <FormControl>
                          <SearchableSelect
                            options={teacherOptions}
                            value={field.value}
                            onValueChange={field.onChange}
                            placeholder="Pilih penguji..."
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="simaanType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Jenis Simaan</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Pilih jenis simaan" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {SIMAAN_TYPES.map((type) => (
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
                    name="examDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tanggal Ujian</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="juzStart"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mulai Juz</FormLabel>
                        <FormControl>
                          <Input type="number" min={1} max={30} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="juzEnd"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sampai Juz</FormLabel>
                        <FormControl>
                          <Input type="number" min={1} max={30} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="flex justify-end gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.back()}
                  >
                    Batal
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? "Menyimpan..." : "Simpan Jadwal"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function CreateSimaanPage() {
  return (
    <MainLayout>
      <CreateSimaanPageContent />
    </MainLayout>
  );
}
