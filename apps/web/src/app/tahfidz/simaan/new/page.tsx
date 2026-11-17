"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import {
  SimaanTypeEnum,
  SIMAAN_TYPE_LABELS,
  type SimaanTypeCode,
} from "@cipansor/shared";
import { MainLayout } from "@/components/layout";
import { PageHeader } from "@/components/shared";
import { useCreateSimaan } from "@/hooks/use-simaan";
import { useClasses } from "@/hooks/use-classes";
import { useStudents } from "@/hooks/use-students";
import { useTeachers } from "@/hooks/use-teachers";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowLeft,
  CalendarIcon,
  Save,
  Loader2,
  BookOpen,
  Users,
} from "lucide-react";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";
import { useState } from "react";

const EXAM_TYPES: { value: SimaanTypeCode; label: string }[] =
  SimaanTypeEnum.options.map((value) => ({
    value,
    label: SIMAAN_TYPE_LABELS[value],
  }));

const simaanSchema = z
  .object({
    studentId: z.string().min(1, "Santri wajib dipilih"),
    examDate: z.date({ error: "Tanggal wajib diisi" }),
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
    examinerIds: z.array(z.string()).min(1, "Minimal 1 penguji"),
  })
  .refine((data) => data.juzEnd >= data.juzStart, {
    message: "Juz akhir harus lebih besar atau sama dengan juz awal",
    path: ["juzEnd"],
  });

type SimaanFormData = z.infer<typeof simaanSchema>;

export default function CreateSimaanPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [selectedClassId, setSelectedClassId] = useState<string>("");

  const { data: classes } = useClasses({ unitId: user?.unitId });
  const { data: students } = useStudents({
    classId: selectedClassId || undefined,
    unitId: user?.unitId,
    limit: 100,
  });
  const { data: teachers } = useTeachers({ unitId: user?.unitId });

  const createMutation = useCreateSimaan();

  const form = useForm<SimaanFormData>({
    resolver: zodResolver(simaanSchema),
    defaultValues: {
      studentId: "",
      examDate: new Date(),
      simaanType: "BIN_NAZHR",
      juzStart: 1,
      juzEnd: 1,
      notes: "",
      examinerIds: [],
    },
  });

  const watchExaminerIds = form.watch("examinerIds");

  const onSubmit = async (data: SimaanFormData) => {
    try {
      await createMutation.mutateAsync({
        studentId: data.studentId,
        simaanType: data.simaanType,
        examDate: format(data.examDate, "yyyy-MM-dd"),
        juzStart: data.juzStart,
        juzEnd: data.juzEnd,
        notes: data.notes,
        examinerIds: data.examinerIds,
      });
      toast.success("Ujian simaan berhasil dijadwalkan");
      router.push("/tahfidz/simaan");
    } catch {
      toast.error("Gagal menjadwalkan ujian simaan");
    }
  };

  const toggleExaminer = (examinerId: string) => {
    const current = form.getValues("examinerIds");
    if (current.includes(examinerId)) {
      form.setValue(
        "examinerIds",
        current.filter((id) => id !== examinerId),
      );
    } else {
      form.setValue("examinerIds", [...current, examinerId]);
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <PageHeader
          title="Jadwalkan Ujian Simaan"
          description="Buat jadwal ujian simaan (tasmi') untuk santri"
          actions={
            <Button variant="outline" onClick={() => router.back()}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Kembali
            </Button>
          }
        />

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic Info */}
            <Card>
              <CardHeader>
                <CardTitle>Informasi Santri</CardTitle>
                <CardDescription>Data santri yang akan diuji</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-2">
                {/* Class filter */}
                <div className="space-y-2">
                  <Label>Filter Kelas/Halaqah</Label>
                  <Select
                    value={selectedClassId}
                    onValueChange={setSelectedClassId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Semua kelas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Semua Kelas</SelectItem>
                      {classes?.data?.map((cls) => (
                        <SelectItem key={cls.id} value={cls.id}>
                          {cls.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <FormField
                  control={form.control}
                  name="studentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Santri *</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih santri" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {students?.data?.map((student) => (
                            <SelectItem key={student.id} value={student.id}>
                              {student.name} ({student.nis})
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
                      <FormLabel>Tanggal Ujian *</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left font-normal",
                                !field.value && "text-muted-foreground",
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {field.value
                                ? format(field.value, "EEEE, dd MMMM yyyy", {
                                    locale: idLocale,
                                  })
                                : "Pilih tanggal"}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            locale={idLocale}
                            disabled={(date) => date < new Date()}
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="juzStart"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Juz Awal *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={30}
                          {...field}
                          onChange={(e) =>
                            field.onChange(parseInt(e.target.value) || 1)
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Juz pertama yang diujikan
                      </FormDescription>
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
                        <Input
                          type="number"
                          min={1}
                          max={30}
                          {...field}
                          onChange={(e) =>
                            field.onChange(parseInt(e.target.value) || 1)
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Juz terakhir yang diujikan
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Exam Type */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  Jenis Ujian
                </CardTitle>
                <CardDescription>
                  Pilih cara simaan dilaksanakan
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="simaanType"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                          {EXAM_TYPES.map((type) => (
                            <div
                              key={type.value}
                              className={cn(
                                "border rounded-lg p-4 cursor-pointer transition-colors",
                                field.value === type.value
                                  ? "border-primary bg-primary/5"
                                  : "hover:bg-muted/50",
                              )}
                              onClick={() => field.onChange(type.value)}
                            >
                              <p className="font-medium">{type.label}</p>
                            </div>
                          ))}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Examiners */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Dewan Penguji
                </CardTitle>
                <CardDescription>Pilih satu atau lebih penguji</CardDescription>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="examinerIds"
                  render={() => (
                    <FormItem>
                      <div className="mb-4">
                        <FormLabel>
                          Penguji * ({watchExaminerIds.length} dipilih)
                        </FormLabel>
                      </div>
                      <ScrollArea className="h-[200px] border rounded-lg">
                        <div className="space-y-3 p-4">
                          {teachers?.data?.map((teacher) => (
                            <div
                              key={teacher.userId}
                              className={cn(
                                "flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors",
                                watchExaminerIds.includes(teacher.userId)
                                  ? "bg-primary/10"
                                  : "hover:bg-muted/50",
                              )}
                              onClick={() => toggleExaminer(teacher.userId)}
                            >
                              <Checkbox
                                checked={watchExaminerIds.includes(
                                  teacher.userId,
                                )}
                                onCheckedChange={() =>
                                  toggleExaminer(teacher.userId)
                                }
                              />
                              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                                <span className="text-xs font-medium">
                                  {teacher.user?.name?.[0] || "?"}
                                </span>
                              </div>
                              <div>
                                <p className="font-medium">
                                  {teacher.user?.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Pengajar
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Notes */}
            <Card>
              <CardHeader>
                <CardTitle>Catatan</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Catatan tambahan untuk ujian..."
                          rows={4}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Submit */}
            <div className="flex justify-end gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                Batal
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Jadwalkan Ujian
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
