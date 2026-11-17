"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  BookOpen,
  Award,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  MessageCircle,
  FileText,
  Edit,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { MainLayout } from "@/components/layout";
import {
  useHomeroomStudentDetail,
  useHomeroomStudentNotes,
} from "@/hooks/use-homeroom";
import { authFileUrl } from "@/lib/files";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// Fallback demo data for when API returns empty
const FALLBACK_STUDENT = {
  id: "",
  nis: "—",
  name: "Loading...",
  gender: "MALE" as const,
  birthDate: "2011-01-01",
  birthPlace: "—",
  address: "—",
  phone: "",
  email: "",
  parentName: "—",
  parentPhone: "",
  motherName: "",
  motherPhone: "",
  enrollmentDate: "",
  photo: null as string | null,
  enrollments: [] as Array<{ class?: { name: string; grade?: number } }>,
  tahfidzRecords: [] as Array<{
    id: string;
    activityType: string;
    juz: number;
    surahName: string;
    ayatStart: number;
    ayatEnd: number;
    score?: number;
    grade?: string;
    recordedAt: string;
  }>,
  attendances: [] as Array<{
    id: string;
    date: string;
    status: string;
    notes?: string;
  }>,
};

// Fallback data for attendance (will be computed from API data)
const FALLBACK_ATTENDANCE = {
  totalDays: 0,
  present: 0,
  absent: 0,
  sick: 0,
  permitted: 0,
  late: 0,
  attendanceRate: 0,
};

// Fallback academic data
const FALLBACK_ACADEMIC = {
  averageScore: 0,
  rank: 0,
  totalStudents: 0,
  semester: 1,
  subjects: [] as Array<{ name: string; score: number; grade: string }>,
};

// Fallback extracurricular data
const FALLBACK_EXTRACURRICULAR = [
  { name: "Pramuka", status: "Aktif", achievement: null },
];

function StudentDetailPageContent() {
  const params = useParams();
  const router = useRouter();
  const studentId = params.id as string;
  const [activeTab, setActiveTab] = useState("overview");

  // Fetch student detail from API
  const {
    data: studentData,
    isLoading: isLoadingStudent,
    isError: studentNotReached,
  } = useHomeroomStudentDetail(studentId);
  const { data: notesData, isLoading: isLoadingNotes } =
    useHomeroomStudentNotes(studentId);

  // Use API data or fallback
  const student = studentData || FALLBACK_STUDENT;
  const className = student.enrollments?.[0]?.class?.name || "—";
  const classGrade = student.enrollments?.[0]?.class?.grade || 0;

  // Compute attendance summary from records
  const attendances = student.attendances || [];
  const attendance = {
    totalDays: attendances.length || FALLBACK_ATTENDANCE.totalDays,
    present: attendances.filter((a) => a.status === "PRESENT").length,
    absent: attendances.filter((a) => a.status === "ABSENT").length,
    sick: attendances.filter((a) => a.status === "SICK").length,
    permitted: attendances.filter((a) => a.status === "EXCUSED").length,
    late: attendances.filter((a) => a.status === "LATE").length,
    attendanceRate:
      attendances.length > 0
        ? Math.round(
            (attendances.filter((a) => a.status === "PRESENT").length /
              attendances.length) *
              100 *
              10,
          ) / 10
        : 0,
  };

  // Academic data (would need separate API in production)
  const academic = FALLBACK_ACADEMIC;

  // Tahfidz from student records
  const tahfidzRecords = student.tahfidzRecords || [];
  const tahfidz = {
    totalJuz: 30,
    memorized: new Set(
      tahfidzRecords
        .filter((t) => t.activityType === "ZIYADAH")
        .map((t) => t.juz),
    ).size,
    inProgress: 1,
    currentSurah: tahfidzRecords[0]?.surahName || "—",
    currentAyat: tahfidzRecords[0]?.ayatEnd || 0,
    lastAssessment:
      tahfidzRecords.find((t) => t.activityType === "ASSESSMENT")?.recordedAt ||
      "",
    lastGrade:
      tahfidzRecords.find((t) => t.activityType === "ASSESSMENT")?.grade || "—",
  };

  // Behavior notes from API
  const behaviorNotes = [
    ...(notesData?.rewards || []).map((r: any) => ({
      id: r.id,
      type: "POSITIVE" as const,
      description: r.description,
      date: r.givenAt,
      points: r.points,
    })),
    ...(notesData?.violations || []).map((v: any) => ({
      id: v.id,
      type: "NEGATIVE" as const,
      description: v.description,
      date: v.occurredAt,
      points: -v.points,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const extracurricular = FALLBACK_EXTRACURRICULAR;

  const calculateAge = (birthDate: string) => {
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birth.getDate())
    ) {
      age--;
    }
    return age;
  };

  const getGradeColor = (grade: string) => {
    if (grade.startsWith("A")) return "text-green-600";
    if (grade.startsWith("B")) return "text-blue-600";
    if (grade.startsWith("C")) return "text-yellow-600";
    return "text-red-600";
  };

  const totalPoints = behaviorNotes.reduce(
    (sum, note) => sum + (note.points || 0),
    0,
  );

  // Loading state
  if (isLoadingStudent) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/homeroom">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-24 mt-2" />
          </div>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-6">
              <Skeleton className="h-32 w-32 rounded-full" />
              <div className="flex-1 space-y-4">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-32" />
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="pt-4">
                <Skeleton className="h-12 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // The API answers 404 for a pupil outside the caller's classes — another
  // teacher's pupil reads exactly like one that does not exist.
  if (studentNotReached) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Kembali
        </Button>
        <Alert>
          <AlertTitle>Siswa tidak ditemukan</AlertTitle>
          <AlertDescription>
            Data siswa dibuka oleh wali kelasnya serta kepala sekolah dan admin
            unitnya.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/homeroom">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Detail Siswa</h1>
          <p className="text-muted-foreground">Kelas {className}</p>
        </div>
        <Link href={`/homeroom/messages/new?studentId=${studentId}`}>
          <Button variant="outline">
            <MessageCircle className="h-4 w-4 mr-2" />
            Hubungi Wali
          </Button>
        </Link>
      </div>

      {/* Student Profile Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-6">
            {/* Photo & Basic Info */}
            <div className="flex flex-col items-center md:items-start gap-4">
              <Avatar className="h-32 w-32">
                <AvatarImage src={authFileUrl(student.photo) || undefined} />
                <AvatarFallback className="text-4xl">
                  {student.name?.charAt(0) || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="text-center md:text-left">
                <h2 className="text-2xl font-bold">
                  {student.name || (student as any).user?.name || "—"}
                </h2>
                <p className="text-muted-foreground font-mono">{student.nis}</p>
                <div className="flex gap-2 mt-2">
                  <Badge
                    variant={
                      student.gender === "MALE" ? "default" : "secondary"
                    }
                  >
                    {student.gender === "MALE" ? "Laki-laki" : "Perempuan"}
                  </Badge>
                  <Badge variant="outline">{className}</Badge>
                </div>
              </div>
            </div>

            {/* Contact Info */}
            <div className="flex-1 grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <h3 className="font-semibold text-lg">Data Pribadi</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>
                      {student.birthPlace || "—"},{" "}
                      {student.birthDate
                        ? new Date(student.birthDate).toLocaleDateString(
                            "id-ID",
                          )
                        : "—"}
                      {student.birthDate &&
                        ` (${calculateAge(student.birthDate)} tahun)`}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-1" />
                    <span>{student.address || "—"}</span>
                  </div>
                  {student.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <a
                        href={`tel:${student.phone}`}
                        className="text-blue-600 hover:underline"
                      >
                        {student.phone}
                      </a>
                    </div>
                  )}
                  {student.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <a
                        href={`mailto:${student.email}`}
                        className="text-blue-600 hover:underline"
                      >
                        {student.email}
                      </a>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold text-lg">Data Orang Tua/Wali</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span>
                      <strong>Ayah:</strong> {student.parentName || "—"}
                    </span>
                  </div>
                  {student.parentPhone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <a
                        href={`tel:${student.parentPhone}`}
                        className="text-blue-600 hover:underline"
                      >
                        {student.parentPhone}
                      </a>
                    </div>
                  )}
                  {student.motherName && (
                    <>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span>
                          <strong>Ibu:</strong> {student.motherName}
                        </span>
                      </div>
                      {student.motherPhone && (
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          <a
                            href={`tel:${student.motherPhone}`}
                            className="text-blue-600 hover:underline"
                          >
                            {student.motherPhone}
                          </a>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-green-100 dark:bg-green-900/20">
                <Calendar className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {attendance.attendanceRate}%
                </p>
                <p className="text-sm text-muted-foreground">Kehadiran</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/20">
                <BookOpen className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{academic.averageScore}</p>
                <p className="text-sm text-muted-foreground">Rata-rata Nilai</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900/20">
                <Award className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">#{academic.rank}</p>
                <p className="text-sm text-muted-foreground">Ranking Kelas</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-full ${totalPoints >= 0 ? "bg-green-100 dark:bg-green-900/20" : "bg-red-100 dark:bg-red-900/20"}`}
              >
                {totalPoints >= 0 ? (
                  <TrendingUp className="h-5 w-5 text-green-600" />
                ) : (
                  <TrendingDown className="h-5 w-5 text-red-600" />
                )}
              </div>
              <div>
                <p
                  className={`text-2xl font-bold ${totalPoints >= 0 ? "text-green-600" : "text-red-600"}`}
                >
                  {totalPoints > 0 ? "+" : ""}
                  {totalPoints}
                </p>
                <p className="text-sm text-muted-foreground">Poin Perilaku</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Ringkasan</TabsTrigger>
          <TabsTrigger value="academic">Akademik</TabsTrigger>
          <TabsTrigger value="attendance">Kehadiran</TabsTrigger>
          <TabsTrigger value="tahfidz">Tahfidz</TabsTrigger>
          <TabsTrigger value="behavior">Perilaku</TabsTrigger>
          <TabsTrigger value="extracurricular">Ekstrakurikuler</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Academic Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  Ringkasan Akademik
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span>Rata-rata Nilai</span>
                  <span className="text-2xl font-bold">
                    {academic.averageScore}
                  </span>
                </div>
                <Progress value={academic.averageScore} className="h-3" />
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>
                    Peringkat: {academic.rank} dari {academic.totalStudents}
                  </span>
                  <span>Semester {academic.semester}</span>
                </div>
                <div className="pt-4 border-t">
                  <h4 className="font-medium mb-2">3 Nilai Tertinggi</h4>
                  {academic.subjects
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 3)
                    .map((subject, idx) => (
                      <div key={idx} className="flex justify-between py-1">
                        <span>{subject.name}</span>
                        <span
                          className={`font-medium ${getGradeColor(subject.grade)}`}
                        >
                          {subject.score} ({subject.grade})
                        </span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            {/* Tahfidz Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Progress Tahfidz
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span>Hafalan</span>
                  <span className="text-2xl font-bold">
                    {tahfidz.memorized} / {tahfidz.totalJuz} Juz
                  </span>
                </div>
                <Progress
                  value={(tahfidz.memorized / tahfidz.totalJuz) * 100}
                  className="h-3"
                />
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Sedang dihafal
                    </span>
                    <span>
                      Juz {tahfidz.memorized + 1} ({tahfidz.currentSurah} ayat{" "}
                      {tahfidz.currentAyat})
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      Penilaian terakhir
                    </span>
                    <span>
                      {new Date(tahfidz.lastAssessment).toLocaleDateString(
                        "id-ID",
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Predikat</span>
                    <Badge className="bg-green-100 text-green-800">
                      {tahfidz.lastGrade}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="academic" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Nilai Semester {academic.semester}</CardTitle>
              <CardDescription>
                Rata-rata: {academic.averageScore} | Peringkat: {academic.rank}{" "}
                dari {academic.totalStudents} siswa
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-2">No</th>
                      <th className="text-left py-3 px-2">Mata Pelajaran</th>
                      <th className="text-center py-3 px-2">Nilai</th>
                      <th className="text-center py-3 px-2">Grade</th>
                      <th className="text-center py-3 px-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {academic.subjects.map((subject, index) => (
                      <tr key={index} className="border-b">
                        <td className="py-3 px-2">{index + 1}</td>
                        <td className="py-3 px-2">{subject.name}</td>
                        <td className="py-3 px-2 text-center font-medium">
                          {subject.score}
                        </td>
                        <td
                          className={`py-3 px-2 text-center font-bold ${getGradeColor(subject.grade)}`}
                        >
                          {subject.grade}
                        </td>
                        <td className="py-3 px-2 text-center">
                          <Badge
                            variant={
                              subject.score >= 75 ? "default" : "destructive"
                            }
                          >
                            {subject.score >= 75 ? "Tuntas" : "Belum Tuntas"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Rekap Kehadiran</CardTitle>
              <CardDescription>
                Total {attendance.totalDays} hari efektif
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-6 mb-6">
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
                  <p className="text-2xl font-bold text-green-600">
                    {attendance.present}
                  </p>
                  <p className="text-sm text-muted-foreground">Hadir</p>
                </div>
                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-center">
                  <p className="text-2xl font-bold text-yellow-600">
                    {attendance.late}
                  </p>
                  <p className="text-sm text-muted-foreground">Terlambat</p>
                </div>
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center">
                  <p className="text-2xl font-bold text-blue-600">
                    {attendance.sick}
                  </p>
                  <p className="text-sm text-muted-foreground">Sakit</p>
                </div>
                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg text-center">
                  <p className="text-2xl font-bold text-purple-600">
                    {attendance.permitted}
                  </p>
                  <p className="text-sm text-muted-foreground">Izin</p>
                </div>
                <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-center">
                  <p className="text-2xl font-bold text-red-600">
                    {attendance.absent}
                  </p>
                  <p className="text-sm text-muted-foreground">Alpha</p>
                </div>
                <div className="p-4 bg-gray-50 dark:bg-gray-900/20 rounded-lg text-center">
                  <p className="text-2xl font-bold">
                    {attendance.attendanceRate}%
                  </p>
                  <p className="text-sm text-muted-foreground">Persentase</p>
                </div>
              </div>
              <Progress value={attendance.attendanceRate} className="h-4" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tahfidz" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Progress Tahfidz Al-Quran</CardTitle>
              <CardDescription>
                Target: {tahfidz.totalJuz} Juz | Tercapai: {tahfidz.memorized}{" "}
                Juz
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <span>Progress Keseluruhan</span>
                    <span className="font-medium">
                      {((tahfidz.memorized / tahfidz.totalJuz) * 100).toFixed(
                        1,
                      )}
                      %
                    </span>
                  </div>
                  <Progress
                    value={(tahfidz.memorized / tahfidz.totalJuz) * 100}
                    className="h-4"
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="p-4 border rounded-lg">
                    <p className="text-sm text-muted-foreground">Juz Selesai</p>
                    <p className="text-2xl font-bold text-green-600">
                      {tahfidz.memorized}
                    </p>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      Sedang Dihafal
                    </p>
                    <p className="text-2xl font-bold text-blue-600">
                      {tahfidz.inProgress}
                    </p>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      Belum Dimulai
                    </p>
                    <p className="text-2xl font-bold text-gray-600">
                      {tahfidz.totalJuz -
                        tahfidz.memorized -
                        tahfidz.inProgress}
                    </p>
                  </div>
                </div>
                <div className="pt-4 border-t">
                  <h4 className="font-medium mb-3">Posisi Hafalan Saat Ini</h4>
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                    <BookOpen className="h-5 w-5 text-muted-foreground" />
                    <span>
                      Surah {tahfidz.currentSurah}, Ayat {tahfidz.currentAyat}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="behavior" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Catatan Perilaku</CardTitle>
              <CardDescription>
                Total Poin:{" "}
                <span
                  className={
                    totalPoints >= 0 ? "text-green-600" : "text-red-600"
                  }
                >
                  {totalPoints > 0 ? "+" : ""}
                  {totalPoints}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {behaviorNotes.map((note) => (
                  <div
                    key={note.id}
                    className={`p-4 rounded-lg border ${
                      note.type === "POSITIVE"
                        ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800"
                        : "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-start gap-3">
                        {note.type === "POSITIVE" ? (
                          <Award className="h-5 w-5 text-green-600 mt-0.5" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
                        )}
                        <div>
                          <p className="font-medium">{note.description}</p>
                          <p className="text-sm text-muted-foreground">
                            {new Date(note.date).toLocaleDateString("id-ID", {
                              weekday: "long",
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            })}
                          </p>
                        </div>
                      </div>
                      <Badge
                        className={
                          note.points > 0 ? "bg-green-600" : "bg-red-600"
                        }
                      >
                        {note.points > 0 ? "+" : ""}
                        {note.points} poin
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="extracurricular" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Kegiatan Ekstrakurikuler</CardTitle>
              <CardDescription>Ekskul yang diikuti siswa</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                {extracurricular.map((ekskul, idx) => (
                  <div key={idx} className="p-4 border rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">{ekskul.name}</h4>
                      <Badge
                        variant={
                          ekskul.status === "Aktif" ? "default" : "secondary"
                        }
                      >
                        {ekskul.status}
                      </Badge>
                    </div>
                    {ekskul.achievement && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Award className="h-4 w-4 text-amber-500" />
                        <span>{ekskul.achievement}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function StudentDetailPage() {
  return (
    <MainLayout>
      <StudentDetailPageContent />
    </MainLayout>
  );
}
