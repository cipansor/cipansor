"use client";
import { MainLayout } from "@/components/layout";

import { getEffectiveRole } from "@/lib/rbac";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Calendar,
  Clock,
  BookOpen,
  Users,
  Coffee,
  Utensils,
  Moon,
  Plus,
  AlertCircle,
  Trash2,
} from "lucide-react";
import {
  useSchedules,
  useCreateSchedule,
  useDeleteSchedule,
} from "@/hooks/use-schedule";
import { useAuth } from "@/hooks/use-auth";
import { wibWeekdayOf } from "@/lib/wib";
import { DayOfWeek } from "@cipansor/shared";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useClasses } from "@/hooks/use-classes";
import { useSubjects } from "@/hooks/use-curriculum";
import { useTeachers } from "@/hooks/use-teachers";
import {
  useAcademicYear,
  useActiveAcademicYear,
} from "@/hooks/use-academic-years";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function SchedulePageContent() {
  const { user } = useAuth();
  const role = getEffectiveRole(user);
  const isAdminOrTeacher =
    role === "SUPER_ADMIN" || role === "UNIT_ADMIN" || role === "TEACHER";
  const [selectedDay, setSelectedDay] = useState<number>(
    wibWeekdayOf(new Date()),
  ); // 0 = Sunday, on the WIB school calendar

  const days = [
    { label: "Minggu", value: "SUNDAY", index: 0 },
    { label: "Senin", value: "MONDAY", index: 1 },
    { label: "Selasa", value: "TUESDAY", index: 2 },
    { label: "Rabu", value: "WEDNESDAY", index: 3 },
    { label: "Kamis", value: "THURSDAY", index: 4 },
    { label: "Jumat", value: "FRIDAY", index: 5 },
    { label: "Sabtu", value: "SATURDAY", index: 6 },
  ];

  const currentDayValue = days.find((d) => d.index === selectedDay)
    ?.value as DayOfWeek;

  // Re-query with correct Enum
  const {
    data: schedulesData,
    isLoading,
    refetch,
  } = useSchedules({
    dayOfWeek: currentDayValue,
    isActive: true,
    limit: 100,
  });

  const schedules = schedulesData?.data || [];

  const getTypeIcon = (subjectName: string) => {
    const lower = subjectName.toLowerCase();
    if (lower.includes("tahfidz") || lower.includes("quran"))
      return <BookOpen className="h-4 w-4" />;
    if (lower.includes("sholat") || lower.includes("ibadah"))
      return <Moon className="h-4 w-4" />;
    if (lower.includes("istirahat") || lower.includes("break"))
      return <Coffee className="h-4 w-4" />;
    if (lower.includes("makan")) return <Utensils className="h-4 w-4" />;
    return <Users className="h-4 w-4" />;
  };

  const getBadgeVariant = (subjectName: string) => {
    const lower = subjectName.toLowerCase();
    if (lower.includes("tahfidz")) return "bg-green-500 hover:bg-green-600";
    if (lower.includes("matematika") || lower.includes("ipa"))
      return "bg-blue-500 hover:bg-blue-600";
    return "bg-slate-500 hover:bg-slate-600";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Calendar className="h-8 w-8" />
            Jadwal Kegiatan
          </h1>
          <p className="text-muted-foreground">
            {new Date().toLocaleDateString("id-ID", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        {isAdminOrTeacher && <ScheduleFormDialog onSuccess={refetch} />}
      </div>

      <Tabs
        defaultValue={currentDayValue}
        onValueChange={(val) => {
          const day = days.find((d) => d.value === val);
          if (day) setSelectedDay(day.index);
        }}
      >
        <TabsList className="w-full justify-start overflow-x-auto">
          {days.map((d) => (
            <TabsTrigger key={d.value} value={d.value}>
              {d.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {days.map((d) => (
          <TabsContent key={d.value} value={d.value} className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Jadwal {d.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex justify-center p-8">
                    <Loader2 className="animate-spin" />
                  </div>
                ) : schedules.length === 0 ? (
                  <div className="text-center p-8 text-muted-foreground">
                    Tidak ada jadwal untuk hari ini.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {schedules.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                      >
                        <div className="w-24 text-sm font-medium text-muted-foreground shrink-0">
                          {item.startTime} - {item.endTime}
                        </div>
                        <div className="p-2 rounded-lg bg-muted shrink-0">
                          {getTypeIcon(item.subject?.name || "")}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">
                              {item.subject?.name}
                            </p>
                            <Badge
                              className={getBadgeVariant(
                                item.subject?.name || "",
                              )}
                            >
                              {item.class?.name}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground truncate">
                            {item.teacher?.user?.name}{" "}
                            {item.room ? `• ${item.room}` : ""}
                          </p>
                        </div>
                        {isAdminOrTeacher && (
                          <DeleteScheduleButton id={item.id} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function DeleteScheduleButton({ id }: { id: string }) {
  const { mutate, isPending } = useDeleteSchedule();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-destructive hover:text-destructive hover:bg-destructive/10"
      disabled={isPending}
      onClick={() => {
        if (confirm("Apakah Anda yakin ingin menghapus jadwal ini?")) {
          mutate(id);
        }
      }}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

function ScheduleFormDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const { data: activeYear } = useActiveAcademicYear();
  const { data: classes } = useClasses({ isActive: true });
  const { data: subjects } = useSubjects({ isActive: true });
  const { data: teachers } = useTeachers({ isActive: true });

  const createMutation = useCreateSchedule();

  // Form State
  const [formData, setFormData] = useState({
    classId: "",
    subjectId: "",
    teacherId: "",
    dayOfWeek: "MONDAY",
    startTime: "07:30",
    endTime: "08:30",
    room: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeYear) {
      alert("Tahun ajaran aktif tidak ditemukan");
      return;
    }

    createMutation.mutate(
      {
        ...formData,
        academicYearId: activeYear.id,
        // We might need to fetch teacher's unitId or class's unitId.
        // Assuming backend handles or we pick from class.
        // Let's check shared type. unitId is optional in CreateScheduleInput?
        // Backend service usually needs it. Let's try to pass the class's unitId.
        unitId: classes?.data?.find((c) => c.id === formData.classId)?.unitId,
        dayOfWeek: formData.dayOfWeek as DayOfWeek,
      },
      {
        onSuccess: () => {
          setOpen(false);
          onSuccess();
          setFormData((prev) => ({
            ...prev,
            startTime: prev.endTime,
            endTime: "",
          })); // Convenience
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Tambah Jadwal
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Tambah Jadwal Pelajaran</DialogTitle>
          <DialogDescription>
            Pastikan tidak ada bentrok jadwal untuk guru dan kelas yang dipilih.
          </DialogDescription>
        </DialogHeader>

        {createMutation.isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Gagal</AlertTitle>
            <AlertDescription>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(createMutation.error as any)?.response?.data?.message ||
                "Terjadi kesalahan"}
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Kelas</Label>
              <Select
                onValueChange={(v) => setFormData({ ...formData, classId: v })}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih Kelas" />
                </SelectTrigger>
                <SelectContent>
                  {classes?.data?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Hari</Label>
              <Select
                value={formData.dayOfWeek}
                onValueChange={(v) =>
                  setFormData({ ...formData, dayOfWeek: v })
                }
                required
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONDAY">Senin</SelectItem>
                  <SelectItem value="TUESDAY">Selasa</SelectItem>
                  <SelectItem value="WEDNESDAY">Rabu</SelectItem>
                  <SelectItem value="THURSDAY">Kamis</SelectItem>
                  <SelectItem value="FRIDAY">Jumat</SelectItem>
                  <SelectItem value="SATURDAY">Sabtu</SelectItem>
                  <SelectItem value="SUNDAY">Minggu</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Mata Pelajaran</Label>
            <Select
              onValueChange={(v) => setFormData({ ...formData, subjectId: v })}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih Mapel" />
              </SelectTrigger>
              <SelectContent>
                {subjects?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Guru Pengampu</Label>
            <Select
              onValueChange={(v) => setFormData({ ...formData, teacherId: v })}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih Guru" />
              </SelectTrigger>
              <SelectContent>
                {teachers?.data?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.user?.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Jam Mulai</Label>
              <Input
                type="time"
                value={formData.startTime}
                onChange={(e) =>
                  setFormData({ ...formData, startTime: e.target.value })
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Jam Selesai</Label>
              <Input
                type="time"
                value={formData.endTime}
                onChange={(e) =>
                  setFormData({ ...formData, endTime: e.target.value })
                }
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Ruangan (Opsional)</Label>
            <Input
              placeholder="Contoh: Lab Komputer"
              value={formData.room}
              onChange={(e) =>
                setFormData({ ...formData, room: e.target.value })
              }
            />
          </div>

          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Simpan Jadwal
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SchedulePageWithShell() {
  return (
    <MainLayout>
      <SchedulePageContent />
    </MainLayout>
  );
}
