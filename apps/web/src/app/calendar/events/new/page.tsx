"use client";
import { useEffect, useState } from "react";
import { safeFormat } from "@/lib/date";
import { useRouter } from "next/navigation";
import { MainLayout } from "@/components/layout/main-layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import {
  useCreateCalendarEvent,
  EVENT_CATEGORIES,
  EVENT_RECURRENCES,
  EventCategory,
  EventRecurrence,
} from "@/hooks/use-calendar";
import { useUnits } from "@/hooks/use-units";
import { useClasses } from "@/hooks/use-classes";
import { useAuthStore } from "@/stores/auth";
import { getActiveRoleCode } from "@/lib/rbac";
import { CALENDAR_FOUNDATION_WRITE_ROLE_CODES } from "@cipansor/shared";
import {
  Calendar as CalendarIcon,
  ArrowLeft,
  Save,
  MapPin,
  Clock,
  Repeat,
  Globe,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { useCanWriteCalendar } from "@/hooks/use-calendar-permissions";
import { toast } from "sonner";

export default function NewEventPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "ACADEMIC" as EventCategory,
    startDate: safeFormat(new Date(), "yyyy-MM-dd"),
    endDate: safeFormat(new Date(), "yyyy-MM-dd"),
    startTime: "",
    endTime: "",
    isAllDay: true,
    location: "",
    unitId: "",
    classId: "",
    recurrence: "NONE" as EventRecurrence,
    recurrenceEnd: "",
    isPublic: true,
  });

  const { data: units = [] } = useUnits();
  const { data: classesData } = useClasses({
    unitId: formData.unitId || undefined,
  });
  const classes = classesData?.data || [];

  const { user } = useAuthStore();
  const canWrite = useCanWriteCalendar();
  const roleCode = getActiveRoleCode(user);
  const canPublishFoundationWide =
    !!roleCode && CALENDAR_FOUNDATION_WRITE_ROLE_CODES.includes(roleCode);
  const activeAssignment =
    user?.userRoles?.find((assignment) => assignment.isPrimary) ??
    user?.userRoles?.[0];
  const activeUnitId = formData.unitId || user?.unitId;
  const activeUnitName =
    units.find((unit) => unit.id === activeUnitId)?.name ??
    (activeAssignment?.unit?.id === activeUnitId
      ? activeAssignment?.unit?.name
      : undefined) ??
    (user?.unit?.id === activeUnitId ? user?.unit?.name : undefined);

  useEffect(() => {
    if (canPublishFoundationWide || !user?.unitId) return;
    setFormData((prev) =>
      prev.unitId === user.unitId
        ? prev
        : { ...prev, unitId: user.unitId!, classId: "" },
    );
  }, [canPublishFoundationWide, user?.unitId]);

  const createEvent = useCreateCalendarEvent();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title.trim()) {
      toast.error("Judul event harus diisi");
      return;
    }

    if (!formData.startDate) {
      toast.error("Tanggal mulai harus diisi");
      return;
    }

    setIsSubmitting(true);
    try {
      await createEvent.mutateAsync({
        title: formData.title,
        description: formData.description || undefined,
        category: formData.category,
        startDate: formData.startDate,
        endDate: formData.endDate || formData.startDate,
        startTime: formData.isAllDay ? undefined : formData.startTime,
        endTime: formData.isAllDay ? undefined : formData.endTime,
        isAllDay: formData.isAllDay,
        location: formData.location || undefined,
        unitId: formData.unitId || undefined,
        classId: formData.classId || undefined,
        recurrence: formData.recurrence,
        recurrenceEnd:
          formData.recurrence !== "NONE" ? formData.recurrenceEnd : undefined,
        isPublic: formData.isPublic,
      });
      toast.success("Event berhasil dibuat");
      router.push("/calendar/events");
    } catch {
      toast.error("Gagal membuat event");
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedCategory = EVENT_CATEGORIES.find(
    (c) => c.value === formData.category,
  );

  if (user && !canWrite) {
    return (
      <MainLayout>
        <Card className="mx-auto mt-10 max-w-xl">
          <CardContent className="space-y-4 py-10 text-center">
            <ShieldAlert className="mx-auto h-12 w-12 text-muted-foreground" />
            <div>
              <h1 className="text-xl font-semibold">Akses ditolak</h1>
              <p className="mt-1 text-muted-foreground">
                Peran Anda hanya dapat membaca kalender. Hubungi admin unit atau
                pengurus yayasan untuk menambah event.
              </p>
            </div>
            <Link href="/calendar">
              <Button variant="outline">Kembali ke Kalender</Button>
            </Link>
          </CardContent>
        </Card>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/calendar/events">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CalendarIcon className="h-6 w-6 text-primary" />
              Tambah Event Baru
            </h1>
            <p className="text-muted-foreground">
              Buat event atau kegiatan baru di kalender
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Form */}
            <div className="lg:col-span-2 space-y-6">
              {/* Basic Info */}
              <Card>
                <CardHeader>
                  <CardTitle>Informasi Dasar</CardTitle>
                  <CardDescription>Detail utama event</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Judul Event *</Label>
                    <Input
                      id="title"
                      value={formData.title}
                      onChange={(e) =>
                        setFormData({ ...formData, title: e.target.value })
                      }
                      placeholder="Contoh: Ujian Tengah Semester"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Deskripsi</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          description: e.target.value,
                        })
                      }
                      placeholder="Deskripsi singkat tentang event..."
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Kategori *</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(v) =>
                        setFormData({
                          ...formData,
                          category: v as EventCategory,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EVENT_CATEGORIES.map((cat) => (
                          <SelectItem key={cat.value} value={cat.value}>
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: cat.color }}
                              />
                              {cat.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              {/* Date & Time */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Tanggal & Waktu
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="isAllDay">Sepanjang Hari</Label>
                    <Switch
                      id="isAllDay"
                      checked={formData.isAllDay}
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, isAllDay: checked })
                      }
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="startDate">Tanggal Mulai *</Label>
                      <Input
                        id="startDate"
                        type="date"
                        value={formData.startDate}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            startDate: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="endDate">Tanggal Selesai</Label>
                      <Input
                        id="endDate"
                        type="date"
                        value={formData.endDate}
                        onChange={(e) =>
                          setFormData({ ...formData, endDate: e.target.value })
                        }
                        min={formData.startDate}
                      />
                    </div>
                  </div>

                  {!formData.isAllDay && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="startTime">Waktu Mulai</Label>
                        <Input
                          id="startTime"
                          type="time"
                          value={formData.startTime}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              startTime: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="endTime">Waktu Selesai</Label>
                        <Input
                          id="endTime"
                          type="time"
                          value={formData.endTime}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              endTime: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Location */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    Lokasi
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Label htmlFor="location">Tempat Pelaksanaan</Label>
                    <Input
                      id="location"
                      value={formData.location}
                      onChange={(e) =>
                        setFormData({ ...formData, location: e.target.value })
                      }
                      placeholder="Contoh: Aula Utama"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Preview */}
              <Card>
                <CardHeader>
                  <CardTitle>Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className="p-4 rounded-lg border-l-4"
                    style={{
                      backgroundColor: `${selectedCategory?.color}10`,
                      borderColor: selectedCategory?.color,
                    }}
                  >
                    <p className="font-semibold">
                      {formData.title || "Judul Event"}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {formData.startDate &&
                        safeFormat(new Date(formData.startDate), "d MMM yyyy")}
                      {!formData.isAllDay &&
                        formData.startTime &&
                        ` • ${formData.startTime}`}
                    </p>
                    {formData.location && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3" />
                        {formData.location}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Recurrence */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Repeat className="h-5 w-5" />
                    Pengulangan
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Ulangi Event</Label>
                    <Select
                      value={formData.recurrence}
                      onValueChange={(v) =>
                        setFormData({
                          ...formData,
                          recurrence: v as EventRecurrence,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EVENT_RECURRENCES.map((rec) => (
                          <SelectItem key={rec.value} value={rec.value}>
                            {rec.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {formData.recurrence !== "NONE" && (
                    <div className="space-y-2">
                      <Label htmlFor="recurrenceEnd">Berakhir Pada</Label>
                      <Input
                        id="recurrenceEnd"
                        type="date"
                        value={formData.recurrenceEnd}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            recurrenceEnd: e.target.value,
                          })
                        }
                        min={formData.startDate}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Visibility */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="h-5 w-5" />
                    Visibilitas
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="isPublic">Event Publik</Label>
                      <p className="text-sm text-muted-foreground">
                        Tampilkan di kalender publik
                      </p>
                    </div>
                    <Switch
                      id="isPublic"
                      checked={formData.isPublic}
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, isPublic: checked })
                      }
                    />
                  </div>

                  {canPublishFoundationWide ? (
                    <div className="space-y-2">
                      <Label>Unit (Opsional)</Label>
                      <Select
                        value={formData.unitId}
                        onValueChange={(v) =>
                          setFormData({ ...formData, unitId: v, classId: "" })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Semua Unit" />
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
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>Unit</Label>
                      <p
                        data-testid="event-unit"
                        className="text-sm font-medium"
                      >
                        {activeUnitName ?? "Unit aktif"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Event masuk ke unit Anda. Agenda seluruh yayasan hanya
                        dapat dibuat pengurus yayasan.
                      </p>
                    </div>
                  )}

                  {formData.unitId && (
                    <div className="space-y-2">
                      <Label>Kelas (Opsional)</Label>
                      <Select
                        value={formData.classId}
                        onValueChange={(v) =>
                          setFormData({ ...formData, classId: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Semua Kelas" />
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
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Actions */}
              <div className="flex gap-2">
                <Link href="/calendar/events" className="flex-1">
                  <Button variant="outline" className="w-full">
                    Batal
                  </Button>
                </Link>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {isSubmitting ? "Menyimpan..." : "Simpan"}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </MainLayout>
  );
}
