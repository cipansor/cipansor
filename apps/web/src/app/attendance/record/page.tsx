"use client";

import { useState, useEffect, Suspense, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { toast } from "sonner";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  CheckCircle,
  XCircle,
  Clock,
  ThermometerSun,
  FileText,
  Users,
  Loader2,
} from "lucide-react";
import Link from "next/link";

import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
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
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useClasses, useClassEnrollments } from "@/hooks/use-classes";
import { useUnits } from "@/hooks/use-units";
import {
  describeAttendanceSave,
  useAttendanceRecorderScope,
  useBulkCreateAttendance,
  useClassAttendance,
  ATTENDANCE_STATUSES,
  AttendanceStatus,
} from "@/hooks/use-attendance";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface StudentAttendance {
  studentId: string;
  name: string;
  nis: string;
  status: AttendanceStatus;
  notes: string;
}

function RecordAttendanceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [date, setDate] = useState<Date>(new Date());
  const [unitId, setUnitId] = useState<string>("");
  const [classId, setClassId] = useState<string>(
    searchParams.get("classId") || "",
  );
  const [studentAttendances, setStudentAttendances] = useState<
    StudentAttendance[]
  >([]);

  // Track if we've initialized from data to prevent re-initialization
  const initializedRef = useRef(false);
  const lastDataKeyRef = useRef<string>("");

  // Which registers this user takes: any class, their unit's classes, or
  // the ones they are wali kelas of or teach in (the API decides).
  const { data: recorder, isLoading: recorderLoading } =
    useAttendanceRecorderScope();
  const assigned = recorder?.scope === "ASSIGNED";
  const unitScoped = recorder?.scope === "UNIT";

  const { data: units } = useUnits();
  const { data: classesData } = useClasses({ unitId: unitId || undefined });
  const classes = assigned
    ? (recorder?.classes ?? []).map((c) => ({
        id: c.id,
        name: `${c.name} · ${c.as === "HOMEROOM" ? "Wali Kelas" : "Mengajar"}`,
      }))
    : classesData?.data || [];

  // An admin unit records their own unit only; a teacher starts on their own
  // class (listed first), unless the link named another one they record.
  useEffect(() => {
    if (unitScoped && recorder?.unitId && !unitId) {
      setUnitId(recorder.unitId);
    }
    if (assigned && recorder && !classId && recorder.classes.length > 0) {
      setClassId(recorder.classes[0].id);
    }
  }, [assigned, unitScoped, recorder, unitId, classId]);

  const { data: enrollments, isLoading: enrollmentsLoading } =
    useClassEnrollments(classId);
  const { data: existingAttendance, isLoading: existingLoading } =
    useClassAttendance(classId, format(date, "yyyy-MM-dd"));

  const bulkCreate = useBulkCreateAttendance();

  // Initialize student attendances when enrollments and the day's register
  // have both loaded — the saved statuses, not "Hadir" for everyone.
  useEffect(() => {
    if (!enrollments || enrollments.length === 0) return;
    if (existingAttendance === undefined) return;

    // Create a key to track if data has changed
    const dataKey = `${classId}-${format(date, "yyyy-MM-dd")}-${enrollments.length}-${existingAttendance.length}`;

    // Only initialize if data key changed
    if (dataKey === lastDataKeyRef.current) return;
    lastDataKeyRef.current = dataKey;

    const initialAttendances = enrollments
      .map((enrollment) => {
        // Check if there's existing attendance for this student
        if (!enrollment.student) return null;

        const existing = existingAttendance?.find(
          (a) => a.studentId === enrollment.student!.id,
        );

        return {
          studentId: enrollment.student.id,
          name: enrollment.student.user?.name || enrollment.student.name || "",
          nis: enrollment.student.nis || "",
          status: existing?.status || ("PRESENT" as AttendanceStatus),
          notes: existing?.notes || "",
        };
      })
      .filter((a): a is StudentAttendance => a !== null);
    setStudentAttendances(initialAttendances);
  }, [enrollments, existingAttendance, classId, date]);

  const handleStatusChange = useCallback(
    (studentId: string, status: AttendanceStatus) => {
      setStudentAttendances((prev) =>
        prev.map((s) => (s.studentId === studentId ? { ...s, status } : s)),
      );
    },
    [],
  );

  const handleNotesChange = useCallback((studentId: string, notes: string) => {
    setStudentAttendances((prev) =>
      prev.map((s) => (s.studentId === studentId ? { ...s, notes } : s)),
    );
  }, []);

  const handleSetAllStatus = useCallback((status: AttendanceStatus) => {
    setStudentAttendances((prev) => prev.map((s) => ({ ...s, status })));
  }, []);

  const handleSubmit = async () => {
    if (!classId) {
      toast.error("Pilih kelas terlebih dahulu");
      return;
    }

    try {
      const result = await bulkCreate.mutateAsync({
        classId,
        date: format(date, "yyyy-MM-dd"),
        records: studentAttendances.map((s) => ({
          studentId: s.studentId,
          status: s.status,
          notes: s.notes || undefined,
        })),
      });
      toast.success(describeAttendanceSave(result));
      router.push("/attendance");
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Gagal menyimpan kehadiran";
      toast.error(errorMessage);
    }
  };

  const getStatusIcon = (status: AttendanceStatus) => {
    switch (status) {
      case "PRESENT":
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case "ABSENT":
        return <XCircle className="h-5 w-5 text-red-600" />;
      case "LATE":
        return <Clock className="h-5 w-5 text-yellow-600" />;
      case "SICK":
        return <ThermometerSun className="h-5 w-5 text-blue-600" />;
      case "EXCUSED":
        return <FileText className="h-5 w-5 text-purple-600" />;
      default:
        return null;
    }
  };

  const summary = {
    total: studentAttendances.length,
    present: studentAttendances.filter((s) => s.status === "PRESENT").length,
    absent: studentAttendances.filter((s) => s.status === "ABSENT").length,
    late: studentAttendances.filter((s) => s.status === "LATE").length,
    sick: studentAttendances.filter((s) => s.status === "SICK").length,
    excused: studentAttendances.filter((s) => s.status === "EXCUSED").length,
  };

  const isLoading = enrollmentsLoading || existingLoading;
  const hasExistingData = existingAttendance && existingAttendance.length > 0;

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/attendance" aria-label="Kembali ke Kehadiran">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Absensi Harian
            </h1>
            <p className="text-muted-foreground">
              Catat kehadiran siswa per kelas
            </p>
          </div>
        </div>

        {/* Selection Card */}
        <Card>
          <CardHeader>
            <CardTitle>Pilih Kelas & Tanggal</CardTitle>
            <CardDescription>
              Tentukan kelas dan tanggal untuk mencatat kehadiran
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[200px] justify-start text-left font-normal",
                      !date && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date
                      ? format(date, "d MMMM yyyy", { locale: localeId })
                      : "Pilih tanggal"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => d && setDate(d)}
                    disabled={(d) => d > new Date()}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>

              {!assigned && (
                <Select
                  value={unitId}
                  onValueChange={(v) => {
                    setUnitId(v);
                    setClassId("");
                  }}
                  disabled={unitScoped}
                >
                  <SelectTrigger className="w-[180px]" aria-label="Unit">
                    <SelectValue placeholder="Pilih Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {units?.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Select value={classId} onValueChange={setClassId}>
                <SelectTrigger className="w-[220px]" aria-label="Kelas">
                  <SelectValue placeholder="Pilih Kelas" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {assigned && !recorderLoading && classes.length === 0 && (
              <Alert className="mt-4">
                <AlertTitle>Tidak ada kelas untuk dicatat</AlertTitle>
                <AlertDescription>
                  Absensi harian dicatat oleh wali kelas, guru yang mengajar di
                  kelas itu, dan admin unit. Anda belum menjadi wali kelas atau
                  mengajar di kelas mana pun tahun ajaran ini.
                </AlertDescription>
              </Alert>
            )}

            {hasExistingData && (
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  ⚠️ Data kehadiran untuk tanggal ini sudah ada. Menyimpan akan
                  memperbarui data yang ada.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Attendance Input */}
        {classId && (
          <>
            {/* Quick Actions & Summary */}
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="h-5 w-5" />
                      Daftar Siswa
                    </CardTitle>
                    <CardDescription>
                      {summary.total} siswa terdaftar di kelas ini
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleSetAllStatus(AttendanceStatus.PRESENT)
                      }
                    >
                      <CheckCircle className="h-4 w-4 mr-1 text-green-600" />
                      Semua Hadir
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleSetAllStatus(AttendanceStatus.ABSENT)
                      }
                    >
                      <XCircle className="h-4 w-4 mr-1 text-red-600" />
                      Semua Tidak Hadir
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Summary Badges */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <Badge
                    variant="secondary"
                    className="bg-green-100 text-green-800"
                  >
                    Hadir: {summary.present}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-red-100 text-red-800"
                  >
                    Tidak Hadir: {summary.absent}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-yellow-100 text-yellow-800"
                  >
                    Terlambat: {summary.late}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-blue-100 text-blue-800"
                  >
                    Sakit: {summary.sick}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-purple-100 text-purple-800"
                  >
                    Izin: {summary.excused}
                  </Badge>
                </div>

                {/* Student List */}
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : studentAttendances.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">
                      Tidak ada siswa di kelas ini
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {studentAttendances.map((student, index) => (
                      <div
                        key={student.studentId}
                        data-testid={`attendance-row-${student.studentId}`}
                        className="flex items-center gap-4 p-3 border rounded-lg hover:bg-muted/50"
                      >
                        <span className="w-8 text-sm text-muted-foreground">
                          {index + 1}.
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{student.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {student.nis}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {ATTENDANCE_STATUSES.map((statusOption) => (
                            <Button
                              key={statusOption.value}
                              variant={
                                student.status === statusOption.value
                                  ? "default"
                                  : "outline"
                              }
                              size="sm"
                              className={cn(
                                "w-10 h-10 p-0",
                                student.status === statusOption.value &&
                                  statusOption.color,
                              )}
                              onClick={() =>
                                handleStatusChange(
                                  student.studentId,
                                  statusOption.value,
                                )
                              }
                              title={statusOption.label}
                              aria-label={statusOption.label}
                              aria-pressed={
                                student.status === statusOption.value
                              }
                            >
                              {getStatusIcon(statusOption.value)}
                            </Button>
                          ))}
                        </div>
                        <Input
                          placeholder="Keterangan"
                          value={student.notes}
                          onChange={(e) =>
                            handleNotesChange(student.studentId, e.target.value)
                          }
                          className="w-[200px]"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Submit Button */}
            <div className="flex justify-end gap-4">
              <Button variant="outline" asChild>
                <Link href="/attendance">Batal</Link>
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={
                  bulkCreate.isPending || studentAttendances.length === 0
                }
              >
                {bulkCreate.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  "Simpan Kehadiran"
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
}

export default function RecordAttendancePage() {
  return (
    <Suspense
      fallback={
        <MainLayout>
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </MainLayout>
      }
    >
      <RecordAttendanceContent />
    </Suspense>
  );
}
