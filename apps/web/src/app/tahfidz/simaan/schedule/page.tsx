"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { MainLayout } from "@/components/layout";
import { PageHeader } from "@/components/shared";
import {
  useSimaanExams,
  useUpcomingSimaan,
  SimaanExam,
  SIMAAN_TYPES,
  simaanExamStatus,
} from "@/hooks/use-simaan";
import { useClasses } from "@/hooks/use-classes";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  Clock,
  User,
  BookOpen,
  Plus,
  ChevronRight,
  Users,
  Award,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  isSameDay,
  parseISO,
} from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { getEffectiveRole } from "@/lib/rbac";

// The values and Indonesian labels live in @cipansor/shared (#1024).
const examTypeLabel = (type: string) =>
  SIMAAN_TYPES.find((t) => t.value === type)?.label || type;

// Status colors — the record has no `status` column, so a simaan is read as
// scheduled until it is graded, then complete.
const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
};

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Terjadwal",
  COMPLETED: "Selesai",
};

export default function SimaanSchedulePage() {
  const { user } = useAuthStore();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedClass, setSelectedClass] = useState<string>("");
  const [viewMonth, setViewMonth] = useState<Date>(new Date());

  const { data: classes } = useClasses({ unitId: user?.unitId });
  const { data: upcomingData } = useUpcomingSimaan();

  // Fetch exams for the current month view
  const dateFrom = format(startOfMonth(viewMonth), "yyyy-MM-dd");
  const dateTo = format(endOfMonth(viewMonth), "yyyy-MM-dd");

  const { data: monthExams, isLoading } = useSimaanExams({
    halaqohId: selectedClass || undefined,
    unitId: getEffectiveRole(user) !== "SUPER_ADMIN" ? user?.unitId : undefined,
    dateFrom,
    dateTo,
    limit: 100,
  });

  const exams = monthExams?.data || [];
  const upcoming = upcomingData || [];

  // Get exams for selected date
  const selectedDateExams = useMemo(() => {
    return exams.filter((exam) =>
      isSameDay(parseISO(exam.examDate), selectedDate),
    );
  }, [exams, selectedDate]);

  // Get dates with exams for calendar highlighting
  const datesWithExams = useMemo(() => {
    return exams.map((exam) => parseISO(exam.examDate));
  }, [exams]);

  return (
    <MainLayout allowedRoles={["SUPER_ADMIN", "UNIT_ADMIN", "TEACHER"]}>
      <div className="space-y-6">
        <PageHeader
          title="Jadwal Simaan"
          description="Kelola jadwal ujian simaan/tasmi santri"
          action={{
            label: "Jadwalkan Simaan",
            href: "/tahfidz/simaan/new",
          }}
        />

        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <Select value={selectedClass} onValueChange={setSelectedClass}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Semua Kelas" />
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

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Calendar */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5" />
                Kalender
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => date && setSelectedDate(date)}
                onMonthChange={setViewMonth}
                locale={idLocale}
                className="rounded-md border"
                modifiers={{
                  hasExam: datesWithExams,
                }}
                modifiersStyles={{
                  hasExam: {
                    backgroundColor: "var(--primary)",
                    color: "white",
                    fontWeight: "bold",
                  },
                }}
              />

              {/* Legend */}
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <div className="w-4 h-4 rounded bg-primary" />
                <span>Ada jadwal simaan</span>
              </div>
            </CardContent>
          </Card>

          {/* Selected Date Exams */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>
                Jadwal{" "}
                {format(selectedDate, "EEEE, dd MMMM yyyy", {
                  locale: idLocale,
                })}
              </CardTitle>
              <CardDescription>
                {selectedDateExams.length} ujian terjadwal
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedDateExams.length > 0 ? (
                <div className="space-y-4">
                  {selectedDateExams.map((exam) => (
                    <Link
                      key={exam.id}
                      href={`/tahfidz/simaan/${exam.id}`}
                      className="block"
                    >
                      <Card className="hover:shadow-md transition-shadow cursor-pointer">
                        <CardContent className="py-4">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-4">
                              <div className="p-2 bg-primary/10 rounded-lg">
                                <BookOpen className="h-6 w-6 text-primary" />
                              </div>
                              <div>
                                <h3 className="font-semibold">
                                  {exam.student?.user?.name || "Santri"}
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                  {exam.student?.nis}
                                </p>
                                <div className="flex items-center gap-2 mt-2">
                                  <Badge variant="outline">
                                    {examTypeLabel(exam.simaanType)}
                                  </Badge>
                                  {exam.juzStart && exam.juzEnd && (
                                    <span className="text-sm text-muted-foreground">
                                      Juz {exam.juzStart}-{exam.juzEnd}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <Badge
                                className={
                                  STATUS_COLORS[simaanExamStatus(exam)]
                                }
                              >
                                {STATUS_LABELS[simaanExamStatus(exam)]}
                              </Badge>
                              {/* {exam.duration && (
                                <p className="text-sm text-muted-foreground mt-2 flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {exam.duration} menit
                                </p>
                              )} */}
                              {exam.examiners && (
                                <p className="text-sm text-muted-foreground flex items-center gap-1 justify-end">
                                  <Users className="h-3 w-3" />
                                  {exam.examiners.length} penguji
                                </p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <CalendarDays className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-semibold">Tidak Ada Jadwal</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Belum ada simaan yang dijadwalkan untuk tanggal ini
                  </p>
                  <Button asChild>
                    <Link href="/tahfidz/simaan/new">
                      <Plus className="mr-2 h-4 w-4" />
                      Jadwalkan Simaan
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Upcoming Exams */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Simaan Mendatang
            </CardTitle>
            <CardDescription>
              Daftar simaan yang akan datang dalam waktu dekat
            </CardDescription>
          </CardHeader>
          <CardContent>
            {upcoming.length > 0 ? (
              <div className="space-y-3">
                {upcoming.slice(0, 5).map((exam) => (
                  <Link
                    key={exam.id}
                    href={`/tahfidz/simaan/${exam.id}`}
                    className="flex items-center justify-between p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="text-center min-w-[60px]">
                        <p className="text-2xl font-bold">
                          {format(parseISO(exam.examDate), "dd")}
                        </p>
                        <p className="text-xs text-muted-foreground uppercase">
                          {format(parseISO(exam.examDate), "MMM", {
                            locale: idLocale,
                          })}
                        </p>
                      </div>
                      <div>
                        <h4 className="font-medium">
                          {exam.student?.user?.name || "Santri"}
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {examTypeLabel(exam.simaanType)}
                          {/* {exam.location && ` • ${exam.location}`} */}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </Link>
                ))}

                {upcoming.length > 5 && (
                  <Button variant="outline" className="w-full" asChild>
                    <Link href="/tahfidz/simaan">
                      Lihat Semua ({upcoming.length})
                    </Link>
                  </Button>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <Award className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-semibold">Belum Ada Jadwal Mendatang</h3>
                <p className="text-sm text-muted-foreground">
                  Tidak ada simaan yang dijadwalkan dalam waktu dekat
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
