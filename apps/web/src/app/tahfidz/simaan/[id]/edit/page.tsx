"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import {
  SimaanTypeEnum,
  SIMAAN_TYPE_LABELS,
  type UpdateSimaanInput,
} from "@cipansor/shared";
import { MainLayout } from "@/components/layout";
import { PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useSimaanExam, useUpdateSimaan } from "@/hooks/use-simaan";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  BookOpen,
  CalendarIcon,
  Save,
  Loader2,
  AlertTriangle,
} from "lucide-react";

/**
 * Only the columns `SimaanExam` actually has are on this form (#1024). The old
 * form carried `startSurah`/`startAyat`/`endSurah`/`endAyat`, `location` and
 * `status` — none of which is a column — and sent `juzStart: 1` with the juz
 * count as `juzEnd`, so saving silently overwrote the real range. The fields
 * below are the ones the user changes; `onSubmit` sends only the ones they
 * touched, so an untouched juz range or notes stay as they were.
 */
const formSchema = z
  .object({
    examDate: z.date({ error: "Tanggal ujian wajib diisi" }),
    simaanType: SimaanTypeEnum,
    juzStart: z.coerce
      .number()
      .int()
      .min(1, "Minimal juz 1")
      .max(30, "Maksimal juz 30"),
    juzEnd: z.coerce
      .number()
      .int()
      .min(1, "Minimal juz 1")
      .max(30, "Maksimal juz 30"),
    notes: z.string().max(2000, "Maksimal 2000 karakter").optional(),
  })
  .refine((data) => data.juzEnd >= data.juzStart, {
    message: "Juz akhir harus lebih besar atau sama dengan juz awal",
    path: ["juzEnd"],
  });

type FormData = z.infer<typeof formSchema>;

export default function EditSimaanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();

  const { data: exam, isLoading, error } = useSimaanExam(resolvedParams.id);
  const updateMutation = useUpdateSimaan();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      simaanType: "BIN_NAZHR",
      juzStart: 1,
      juzEnd: 1,
      notes: "",
    },
  });

  // Populate form when data is loaded
  useEffect(() => {
    if (exam) {
      form.reset({
        examDate: new Date(exam.examDate),
        simaanType: exam.simaanType,
        juzStart: exam.juzStart,
        juzEnd: exam.juzEnd,
        notes: exam.notes || "",
      });
    }
  }, [exam, form]);

  const onSubmit = async (data: FormData) => {
    // Send only the fields the user actually changed. `dirtyFields` is reset
    // by `form.reset` above, so it tracks edits against the loaded record.
    const dirty = form.formState.dirtyFields;
    const payload: UpdateSimaanInput = {};
    if (dirty.examDate) payload.examDate = format(data.examDate, "yyyy-MM-dd");
    if (dirty.simaanType) payload.simaanType = data.simaanType;
    if (dirty.juzStart) payload.juzStart = data.juzStart;
    if (dirty.juzEnd) payload.juzEnd = data.juzEnd;
    // An emptied notes field clears the column (the API accepts `null`).
    if (dirty.notes) payload.notes = data.notes ? data.notes : null;

    if (Object.keys(payload).length === 0) {
      toast.info("Tidak ada perubahan untuk disimpan");
      return;
    }

    try {
      await updateMutation.mutateAsync({
        id: resolvedParams.id,
        data: payload,
      });
      toast.success("Data ujian simaan berhasil diperbarui");
      router.push(`/tahfidz/simaan/${resolvedParams.id}`);
    } catch {
      toast.error("Gagal memperbarui data ujian simaan");
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-96" />
        </div>
      </MainLayout>
    );
  }

  if (error || !exam) {
    return (
      <MainLayout>
        <div className="text-center py-12">
          <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
          <h2 className="mt-4 text-lg font-semibold">Data Tidak Ditemukan</h2>
          <p className="text-muted-foreground">
            Data ujian simaan tidak ditemukan
          </p>
          <Button
            className="mt-4"
            onClick={() => router.push("/tahfidz/simaan")}
          >
            Kembali ke Daftar
          </Button>
        </div>
      </MainLayout>
    );
  }

  if (exam.passed) {
    return (
      <MainLayout>
        <div className="text-center py-12">
          <AlertTriangle className="mx-auto h-12 w-12 text-yellow-500" />
          <h2 className="mt-4 text-lg font-semibold">Tidak Dapat Diedit</h2>
          <p className="text-muted-foreground">
            Ujian simaan yang sudah selesai atau dibatalkan tidak dapat diedit
          </p>
          <Button
            className="mt-4"
            onClick={() => router.push(`/tahfidz/simaan/${resolvedParams.id}`)}
          >
            Kembali ke Detail
          </Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push(`/tahfidz/simaan/${resolvedParams.id}`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <PageHeader
            title="Edit Ujian Simaan"
            description={`Santri: ${exam.student?.user?.name || "N/A"}`}
            icon={BookOpen}
          />
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Informasi Ujian</CardTitle>
                <CardDescription>Perbarui data ujian simaan</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                  {/* Exam Date */}
                  <FormField
                    control={form.control}
                    name="examDate"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Tanggal Ujian *</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  "w-full pl-3 text-left font-normal",
                                  !field.value && "text-muted-foreground",
                                )}
                              >
                                {field.value ? (
                                  format(field.value, "EEEE, dd MMMM yyyy", {
                                    locale: id,
                                  })
                                ) : (
                                  <span>Pilih tanggal</span>
                                )}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value}
                              onSelect={field.onChange}
                              autoFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Exam Type */}
                  <FormField
                    control={form.control}
                    name="simaanType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Jenis Simaan *</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Pilih jenis simaan" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {SimaanTypeEnum.options.map((value) => (
                              <SelectItem key={value} value={value}>
                                {SIMAAN_TYPE_LABELS[value]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Juz range */}
                  <FormField
                    control={form.control}
                    name="juzStart"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Juz Awal *</FormLabel>
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
                        <FormLabel>Juz Akhir *</FormLabel>
                        <FormControl>
                          <Input type="number" min={1} max={30} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Notes */}
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Catatan</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Catatan tambahan tentang ujian simaan..."
                          className="min-h-[100px]"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Kosongkan untuk menghapus catatan.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex items-center justify-end gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  router.push(`/tahfidz/simaan/${resolvedParams.id}`)
                }
              >
                Batal
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Simpan Perubahan
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </MainLayout>
  );
}
