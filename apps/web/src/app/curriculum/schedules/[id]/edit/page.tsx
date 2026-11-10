"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Calendar, Clock, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { toast } from "sonner";
import {
  useSchedules,
  useUpdateSchedule,
  useDeleteSchedule,
  useSubjects,
  SCHEDULE_DAYS,
  SCHEDULE_DAY_LABELS,
  ScheduleDay,
} from "@/hooks/use-curriculum";
import { useClasses } from "@/hooks/use-classes";
import { useTeachers } from "@/hooks/use-teachers";
import { useAcademicYears } from "@/hooks/use-academic-years";

import { MainLayout } from "@/components/layout";
const scheduleSchema = z.object({
  classId: z.string().min(1, "Kelas wajib dipilih"),
  subjectId: z.string().min(1, "Mata pelajaran wajib dipilih"),
  teacherId: z.string().min(1, "Guru wajib dipilih"),
  day: z.enum(
    [
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ] as const,
    {
      error: "Hari wajib dipilih",
    },
  ),
  startTime: z.string().min(1, "Waktu mulai wajib diisi"),
  endTime: z.string().min(1, "Waktu selesai wajib diisi"),
  room: z.string().optional(),
  academicYearId: z.string().min(1, "Tahun ajaran wajib dipilih"),
  isActive: z.boolean(),
});

type ScheduleFormData = z.infer<typeof scheduleSchema>;

function EditSchedulePageContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const { data: schedules } = useSchedules();
  const schedule = schedules?.find((s) => s.id === id);

  const updateMutation = useUpdateSchedule();
  const deleteMutation = useDeleteSchedule();
  const { data: subjects } = useSubjects({ isActive: true });
  const { data: classesData } = useClasses();
  const { data: academicYearsData } = useAcademicYears();

  const classes = classesData?.data || [];
  const academicYears = academicYearsData?.data || [];

  const form = useForm<ScheduleFormData>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      classId: "",
      subjectId: "",
      teacherId: "",
      day: undefined,
      startTime: "07:00",
      endTime: "08:30",
      room: "",
      academicYearId: "",
      isActive: true,
    },
  });

  // A slot's teacher is a Teacher record of the class's unit (the API checks
  // both); the list of user accounts offered before gave ids it refused.
  const selectedClassId = form.watch("classId");
  const selectedClassUnitId = classes.find(
    (c) => c.id === selectedClassId,
  )?.unitId;
  const { data: teachersData } = useTeachers({
    unitId: selectedClassUnitId,
    limit: 100,
  });
  const teachers = teachersData?.data || [];

  useEffect(() => {
    if (schedule) {
      form.reset({
        classId: schedule.classId,
        subjectId: schedule.subjectId,
        teacherId: schedule.teacherId,
        day: schedule.day,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        room: schedule.room || "",
        academicYearId: schedule.academicYearId,
        isActive: schedule.isActive,
      });
    }
  }, [schedule, form]);

  const onSubmit = async (data: ScheduleFormData) => {
    try {
      await updateMutation.mutateAsync({
        id,
        data: {
          classId: data.classId,
          unitId: selectedClassUnitId,
          subjectId: data.subjectId,
          teacherId: data.teacherId,
          day: data.day as ScheduleDay,
          startTime: data.startTime,
          endTime: data.endTime,
          room: data.room || undefined,
          academicYearId: data.academicYearId,
          isActive: data.isActive,
        },
      });
      toast.success("Jadwal berhasil diperbarui");
      router.push("/curriculum?tab=schedule");
    } catch {
      toast.error("Gagal memperbarui jadwal");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success("Jadwal berhasil dihapus");
      router.push("/curriculum?tab=schedule");
    } catch {
      toast.error("Gagal menghapus jadwal");
    }
  };

  if (!schedule) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Calendar className="h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-muted-foreground">Jadwal tidak ditemukan</p>
        <Button asChild className="mt-4">
          <Link href="/curriculum">Kembali ke Mata Pelajaran &amp; Jadwal</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/curriculum">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Edit Jadwal</h1>
          <p className="text-muted-foreground">
            {schedule.subject?.name} - {SCHEDULE_DAY_LABELS[schedule.day]}
          </p>
        </div>
        <ConfirmDialog
          title="Hapus Jadwal"
          description="Apakah Anda yakin ingin menghapus jadwal ini?"
          onConfirm={handleDelete}
          loading={deleteMutation.isPending}
        >
          <Button variant="destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            Hapus
          </Button>
        </ConfirmDialog>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Main Form */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Informasi Jadwal</CardTitle>
                <CardDescription>Edit jadwal mata pelajaran</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="classId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Kelas *</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Pilih kelas" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {classes.map((cls) => (
                              <SelectItem key={cls.id} value={cls.id}>
                                {cls.name}
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
                    name="subjectId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mata Pelajaran *</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Pilih mata pelajaran" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {subjects?.map((subject) => (
                              <SelectItem key={subject.id} value={subject.id}>
                                {subject.name} ({subject.code})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="teacherId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Guru Pengajar *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih guru" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {teachers.map((teacher) => (
                            <SelectItem key={teacher.id} value={teacher.id}>
                              {teacher.user?.name ?? "—"}
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
                  name="day"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hari *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih hari" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SCHEDULE_DAYS.slice(0, 6).map((day) => (
                            <SelectItem key={day} value={day}>
                              {SCHEDULE_DAY_LABELS[day]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="startTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Waktu Mulai *</FormLabel>
                        <FormControl>
                          <Input type="time" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="endTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Waktu Selesai *</FormLabel>
                        <FormControl>
                          <Input type="time" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="room"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ruangan</FormLabel>
                      <FormControl>
                        <Input placeholder="Ruang 101" {...field} />
                      </FormControl>
                      <FormDescription>Lokasi ruangan kelas</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Side Panel */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Tahun Ajaran</CardTitle>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="academicYearId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tahun Ajaran *</FormLabel>
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
                            {academicYears.map((ay) => (
                              <SelectItem key={ay.id} value={ay.id}>
                                {ay.name} {ay.isActive && "(Aktif)"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="isActive"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Aktif</FormLabel>
                          <FormDescription>
                            Jadwal akan ditampilkan
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Preview
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Hari</span>
                    <span>
                      {form.watch("day")
                        ? SCHEDULE_DAY_LABELS[form.watch("day")]
                        : "-"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Waktu</span>
                    <span>
                      {form.watch("startTime")} - {form.watch("endTime")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ruangan</span>
                    <span>{form.watch("room") || "-"}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" asChild>
              <Link href="/curriculum">Batal</Link>
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
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
  );
}

export default function EditSchedulePage(
  props: Parameters<typeof EditSchedulePageContent>[0],
) {
  return (
    <MainLayout>
      <EditSchedulePageContent {...props} />
    </MainLayout>
  );
}
