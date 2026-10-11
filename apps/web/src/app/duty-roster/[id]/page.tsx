"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  MapPin,
  Users,
  Star,
  LogIn,
  LogOut,
  AlertTriangle,
  MessageSquare,
  Save,
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { MainLayout } from "@/components/layout";
import {
  DutyType,
  DutyStatus,
  DutyShift,
  DUTY_STATUS_LABELS,
  useDutyRoster,
  useUpdateDutyStatus,
} from "@/hooks/use-duty-roster";

// Extended status for UI display (includes additional states used in demo)
type UIStatus = DutyStatus | "SCHEDULED" | "IN_PROGRESS" | "MISSED" | "EXCUSED";

interface StudentAssignment {
  id: string;
  studentId: string;
  student: {
    id: string;
    nis: string;
    name: string;
    class: { id: string; name: string };
  };
  status: UIStatus;
  checkInTime?: string;
  checkOutTime?: string;
  rating?: number;
  points?: number;
  feedback?: string;
}

const STATUS_CONFIG: Record<
  UIStatus,
  { label: string; color: string; icon: React.ReactNode; bgColor: string }
> = {
  PENDING: {
    label: "Menunggu",
    color: "bg-gray-100 text-gray-800",
    bgColor: "bg-gray-50",
    icon: <Clock className="h-4 w-4" />,
  },
  SCHEDULED: {
    label: "Terjadwal",
    color: "bg-gray-100 text-gray-800",
    bgColor: "bg-gray-50",
    icon: <Clock className="h-4 w-4" />,
  },
  IN_PROGRESS: {
    label: "Berlangsung",
    color: "bg-blue-100 text-blue-800",
    bgColor: "bg-blue-50",
    icon: <Clock className="h-4 w-4" />,
  },
  COMPLETED: {
    label: "Selesai",
    color: "bg-green-100 text-green-800",
    bgColor: "bg-green-50",
    icon: <CheckCircle className="h-4 w-4" />,
  },
  ABSENT: {
    label: "Tidak Hadir",
    color: "bg-red-100 text-red-800",
    bgColor: "bg-red-50",
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  MISSED: {
    label: "Tidak Hadir",
    color: "bg-red-100 text-red-800",
    bgColor: "bg-red-50",
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  SUBSTITUTED: {
    label: "Digantikan",
    color: "bg-yellow-100 text-yellow-800",
    bgColor: "bg-yellow-50",
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  EXCUSED: {
    label: "Izin",
    color: "bg-yellow-100 text-yellow-800",
    bgColor: "bg-yellow-50",
    icon: <AlertTriangle className="h-4 w-4" />,
  },
};

const SHIFT_CONFIG: Record<DutyShift, { label: string; color: string }> = {
  MORNING: { label: "Pagi", color: "bg-amber-100 text-amber-800" },
  AFTERNOON: { label: "Siang", color: "bg-orange-100 text-orange-800" },
  EVENING: { label: "Sore/Malam", color: "bg-purple-100 text-purple-800" },
};

function DutyRosterDetailPageContent() {
  const params = useParams();
  const router = useRouter();
  const rosterId = params.id as string;

  // Fetch roster detail from API
  const { data: rosterData, isLoading: isLoadingRoster } =
    useDutyRoster(rosterId);
  const updateStatusMutation = useUpdateDutyStatus();

  // Transform API data to UI format.
  //
  // `GET /duty-roster/:id` returns a single DutyRoster row whose relations are
  // `dutyType` (object) and `student` (object) — there is no `assignments`
  // array. Feeding it through the list-shaped mapper left `dutyType` a string,
  // `shift` undefined (→ `SHIFT_CONFIG[undefined].color` threw) and
  // `students` empty. Normalize from the real shape instead.
  const roster = useMemo(() => {
    if (!rosterData) return null;
    const r = rosterData as unknown as {
      id: string;
      date: string;
      status?: UIStatus;
      completedAt?: string | null;
      notes?: string | null;
      dutyType?: {
        name?: string;
        location?: string | null;
        startTime?: string | null;
        endTime?: string | null;
      };
      student?: {
        id: string;
        nis: string;
        name?: string;
        user?: { name?: string } | null;
        class?: { id: string; name: string } | null;
      };
      supervisor?: { id: string; name: string } | null;
    };
    const student = r.student;
    const studentName = student?.name ?? student?.user?.name ?? "Santri";
    return {
      id: r.id,
      date: r.date,
      dutyTypeName: r.dutyType?.name ?? "Piket",
      location: r.dutyType?.location ?? "-",
      // The DutyRoster model has no `shift` column (only DutyType.startTime/
      // endTime), so there is nothing to show — leave it undefined and let the
      // render guard drop the badge rather than index SHIFT_CONFIG with it.
      shift: undefined as DutyShift | undefined,
      startTime: r.dutyType?.startTime ?? "-",
      endTime: r.dutyType?.endTime ?? "-",
      notes: r.notes ?? undefined,
      supervisor: r.supervisor ?? undefined,
      students: student
        ? [
            {
              id: student.id,
              studentId: student.id,
              student: {
                id: student.id,
                nis: student.nis,
                name: studentName,
                class: student.class ?? { id: "", name: "-" },
              },
              status: (r.status ?? "PENDING") as UIStatus,
              checkInTime: r.completedAt
                ? r.completedAt.slice(11, 16)
                : undefined,
              checkOutTime: undefined,
              rating: undefined,
              points: undefined,
              feedback: r.notes ?? undefined,
            },
          ]
        : [],
    };
  }, [rosterData]);

  const [selectedAssignment, setSelectedAssignment] =
    useState<StudentAssignment | null>(null);
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [verifyForm, setVerifyForm] = useState({
    rating: 5,
    feedback: "",
    points: 10,
  });

  const handleCheckIn = (assignmentId: string) => {
    updateStatusMutation.mutate(
      {
        assignmentId: assignmentId,
        status: "PENDING", // In a real scenario, you might have a different status or the backend handles this
      },
      {
        onSuccess: () => {
          toast.success("Check-in berhasil");
        },
        onError: (error) => {
          toast.error("Gagal check-in: " + (error as Error).message);
        },
      },
    );
  };

  const handleCheckOut = (assignmentId: string) => {
    const assignment = roster?.students.find((s) => s.id === assignmentId);
    if (assignment) {
      setSelectedAssignment(assignment);
      setVerifyDialogOpen(true);
    }
  };

  const handleVerify = () => {
    if (!selectedAssignment) return;

    updateStatusMutation.mutate(
      {
        assignmentId: selectedAssignment.id,
        status: "COMPLETED",
        notes: verifyForm.feedback,
      },
      {
        onSuccess: () => {
          setVerifyDialogOpen(false);
          setSelectedAssignment(null);
          setVerifyForm({ rating: 5, feedback: "", points: 10 });
          toast.success("Tugas berhasil diverifikasi");
        },
        onError: (error) => {
          toast.error("Gagal verifikasi: " + (error as Error).message);
        },
      },
    );
  };

  const handleMarkMissed = (assignmentId: string) => {
    updateStatusMutation.mutate(
      {
        assignmentId: assignmentId,
        status: "ABSENT",
      },
      {
        onSuccess: () => {
          toast.warning("Santri ditandai tidak hadir");
        },
        onError: (error) => {
          toast.error("Gagal update status: " + (error as Error).message);
        },
      },
    );
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getCompletionStats = () => {
    if (!roster)
      return { total: 0, completed: 0, inProgress: 0, scheduled: 0, missed: 0 };
    const total = roster.students.length;
    const completed = roster.students.filter(
      (s) => s.status === "COMPLETED",
    ).length;
    const inProgress = roster.students.filter(
      (s) => s.status === "IN_PROGRESS",
    ).length;
    const scheduled = roster.students.filter(
      (s) => s.status === "PENDING" || s.status === "SCHEDULED",
    ).length;
    const missed = roster.students.filter(
      (s) => s.status === "ABSENT" || s.status === "MISSED",
    ).length;
    return { total, completed, inProgress, scheduled, missed };
  };

  const stats = getCompletionStats();

  // Loading state
  if (isLoadingRoster) {
    return (
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-32" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  // Not found state
  if (!roster) {
    return (
      <div className="container mx-auto py-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-medium">Data Piket Tidak Ditemukan</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Piket dengan ID tersebut tidak ditemukan
            </p>
            <Link href="/duty-roster">
              <Button variant="link" className="mt-4">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Kembali ke Daftar Piket
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/duty-roster">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{roster.dutyTypeName}</h1>
          <p className="text-muted-foreground">{formatDate(roster.date)}</p>
        </div>
      </div>

      {/* Roster Info */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Lokasi</p>
                <p className="font-medium">{roster.location}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Waktu</p>
                <p className="font-medium">
                  {roster.startTime} - {roster.endTime}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {roster.shift && (
                <Badge className={SHIFT_CONFIG[roster.shift].color}>
                  {SHIFT_CONFIG[roster.shift].label}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Pengawas</p>
                <p className="font-medium">{roster.supervisor?.name || "-"}</p>
              </div>
            </div>
          </div>
          {roster.notes && (
            <div className="mt-4 p-3 bg-muted rounded-lg">
              <p className="text-sm">
                <strong>Catatan:</strong> {roster.notes}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-3xl font-bold">{stats.total}</p>
            <p className="text-sm text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-3xl font-bold text-green-600">
              {stats.completed}
            </p>
            <p className="text-sm text-muted-foreground">Selesai</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-3xl font-bold text-blue-600">
              {stats.inProgress}
            </p>
            <p className="text-sm text-muted-foreground">Berlangsung</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-3xl font-bold text-gray-600">
              {stats.scheduled}
            </p>
            <p className="text-sm text-muted-foreground">Terjadwal</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-3xl font-bold text-red-600">{stats.missed}</p>
            <p className="text-sm text-muted-foreground">Tidak Hadir</p>
          </CardContent>
        </Card>
      </div>

      {/* Student List */}
      <Card>
        <CardHeader>
          <CardTitle>Daftar Santri Piket</CardTitle>
          <CardDescription>
            Kelola kehadiran dan verifikasi tugas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {roster.students.map((assignment) => (
              <div
                key={assignment.id}
                className={`p-4 rounded-lg border ${STATUS_CONFIG[assignment.status].bgColor}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-12 w-12">
                      <AvatarFallback>
                        {assignment.student.name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{assignment.student.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {assignment.student.nis} •{" "}
                        {assignment.student.class.name}
                      </p>
                    </div>
                  </div>
                  <Badge className={STATUS_CONFIG[assignment.status].color}>
                    <span className="flex items-center gap-1">
                      {STATUS_CONFIG[assignment.status].icon}
                      {STATUS_CONFIG[assignment.status].label}
                    </span>
                  </Badge>
                </div>

                {/* Time Info */}
                {(assignment.checkInTime || assignment.checkOutTime) && (
                  <div className="mt-3 flex items-center gap-6 text-sm">
                    {assignment.checkInTime && (
                      <div className="flex items-center gap-2">
                        <LogIn className="h-4 w-4 text-green-600" />
                        <span>Check-in: {assignment.checkInTime}</span>
                      </div>
                    )}
                    {assignment.checkOutTime && (
                      <div className="flex items-center gap-2">
                        <LogOut className="h-4 w-4 text-blue-600" />
                        <span>Check-out: {assignment.checkOutTime}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Rating & Feedback */}
                {assignment.status === "COMPLETED" && (
                  <div className="mt-3 p-3 bg-white dark:bg-gray-800 rounded-lg">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            className={`h-4 w-4 ${
                              star <= (assignment.rating || 0)
                                ? "text-amber-500 fill-amber-500"
                                : "text-gray-300"
                            }`}
                          />
                        ))}
                        <span className="ml-2 text-sm font-medium">
                          {assignment.rating}/5
                        </span>
                      </div>
                      {assignment.points && (
                        <Badge className="bg-green-100 text-green-800">
                          +{assignment.points} poin
                        </Badge>
                      )}
                    </div>
                    {assignment.feedback && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        <MessageSquare className="h-3 w-3 inline mr-1" />
                        {assignment.feedback}
                      </p>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="mt-4 flex gap-2">
                  {(assignment.status === "PENDING" ||
                    assignment.status === "SCHEDULED") && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => handleCheckIn(assignment.id)}
                      >
                        <LogIn className="h-4 w-4 mr-1" />
                        Check-in
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600"
                        onClick={() => handleMarkMissed(assignment.id)}
                      >
                        <AlertTriangle className="h-4 w-4 mr-1" />
                        Tidak Hadir
                      </Button>
                    </>
                  )}
                  {assignment.status === "IN_PROGRESS" && (
                    <Button
                      size="sm"
                      onClick={() => handleCheckOut(assignment.id)}
                    >
                      <LogOut className="h-4 w-4 mr-1" />
                      Check-out & Verifikasi
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Verify Dialog */}
      <Dialog open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verifikasi Tugas Piket</DialogTitle>
            <DialogDescription>
              Berikan penilaian untuk {selectedAssignment?.student.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Rating</Label>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() =>
                      setVerifyForm((prev) => ({
                        ...prev,
                        rating: star,
                        points: star * 2,
                      }))
                    }
                    className="focus:outline-none"
                  >
                    <Star
                      className={`h-8 w-8 transition-colors ${
                        star <= verifyForm.rating
                          ? "text-amber-500 fill-amber-500"
                          : "text-gray-300 hover:text-amber-300"
                      }`}
                    />
                  </button>
                ))}
                <span className="ml-2 text-lg font-medium">
                  {verifyForm.rating}/5
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Poin yang Diberikan</Label>
              <div className="flex items-center gap-2">
                <Badge className="text-lg px-4 py-2 bg-green-100 text-green-800">
                  +{verifyForm.points} poin
                </Badge>
                <span className="text-sm text-muted-foreground">
                  (otomatis berdasarkan rating)
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Feedback (opsional)</Label>
              <Textarea
                placeholder="Berikan catatan atau masukan..."
                value={verifyForm.feedback}
                onChange={(e) =>
                  setVerifyForm((prev) => ({
                    ...prev,
                    feedback: e.target.value,
                  }))
                }
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setVerifyDialogOpen(false)}
            >
              Batal
            </Button>
            <Button onClick={handleVerify}>
              <Save className="h-4 w-4 mr-2" />
              Verifikasi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function DutyRosterDetailPage() {
  return (
    <MainLayout>
      <DutyRosterDetailPageContent />
    </MainLayout>
  );
}
