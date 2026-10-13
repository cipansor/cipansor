"use client";

import { useState } from "react";
import { safeFormat } from "@/lib/date";
import { MainLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useStaffAttendances,
  useUnits,
  STAFF_ATTENDANCE_STATUS_LABELS,
  StaffAttendanceStatus,
} from "@/hooks";
import {
  Calendar as CalendarIcon,
  CheckCircle,
  Clock,
  Search,
  Users,
  XCircle,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { PunchEvidence } from "@/components/hr/PunchEvidence";
import { StaffAttendanceAdminOnly } from "@/components/hr/StaffAttendanceAdminOnly";
import { useAuth } from "@/hooks/use-auth";
import { canManageStaffAttendance } from "@/lib/staff-attendance-access";

/** The name is on `user` for both a staff member and a teacher record. */
const attendanceName = (item: {
  staff?: { user?: { name: string } };
  teacher?: { user?: { name: string } };
}) => item.staff?.user?.name || item.teacher?.user?.name || "Tanpa nama";

export default function StaffAttendancePage() {
  const { user } = useAuth();
  if (user && !canManageStaffAttendance(user))
    return <StaffAttendanceAdminOnly title="Absensi Pegawai" />;
  return <StaffAttendanceList />;
}

function StaffAttendanceList() {
  const [date, setDate] = useState<Date>(new Date());
  const [unitFilter, setUnitFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  // Queries
  const { data: attendanceData, isLoading } = useStaffAttendances({
    startDate: format(date, "yyyy-MM-dd"),
    endDate: format(date, "yyyy-MM-dd"),
    unitId: unitFilter || undefined,
    limit: 100, // Fetch more for daily view
  });

  const { data: units } = useUnits();

  const attendances = attendanceData?.data || [];

  // Stats
  const stats = {
    present: attendances.filter(
      (a) =>
        a.status === "PRESENT" || a.status === "REMOTE" || a.status === "DUTY",
    ).length,
    late: attendances.filter((a) => a.status === "LATE").length,
    absent: attendances.filter((a) => a.status === "ABSENT").length,
    leave: attendances.filter(
      (a) => a.status === "LEAVE" || a.status === "SICK",
    ).length,
  };

  const getStatusBadge = (status: StaffAttendanceStatus) => {
    const colors: Record<StaffAttendanceStatus, string> = {
      PRESENT: "bg-green-100 text-green-800",
      LATE: "bg-yellow-100 text-yellow-800",
      ABSENT: "bg-red-100 text-red-800",
      LEAVE: "bg-blue-100 text-blue-800",
      SICK: "bg-purple-100 text-purple-800",
      REMOTE: "bg-sky-100 text-sky-800",
      DUTY: "bg-teal-100 text-teal-800",
      HOLIDAY: "bg-gray-100 text-gray-800",
    };
    return (
      <Badge className={colors[status]}>
        {STAFF_ATTENDANCE_STATUS_LABELS[status]}
      </Badge>
    );
  };

  // Filtered Data (search stays client-side; the unit filter goes to the API)
  const filteredAttendances = attendances.filter((item) => {
    if (!search) return true;
    return attendanceName(item).toLowerCase().includes(search.toLowerCase());
  });

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Absensi Pegawai
            </h1>
            <p className="text-muted-foreground">
              Kelola kehadiran harian guru dan staf
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-[240px] justify-start text-left font-normal",
                    !date && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? (
                    format(date, "PPP", { locale: id })
                  ) : (
                    <span>Pilih Tanggal</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => d && setDate(d)}
                  autoFocus
                />
              </PopoverContent>
            </Popover>
            <Button
              variant="outline"
              onClick={() => {
                const params = new URLSearchParams({
                  date: format(date, "yyyy-MM-dd"),
                });
                window.location.href = `/hr/attendance/bulk?${params}`;
              }}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              Absensi Massal
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Hadir</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.present}</div>
              <p className="text-xs text-muted-foreground">Pegawai</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Terlambat</CardTitle>
              <Clock className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.late}</div>
              <p className="text-xs text-muted-foreground">Pegawai</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Izin/Sakit</CardTitle>
              <Users className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.leave}</div>
              <p className="text-xs text-muted-foreground">Pegawai</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                Absen (Alpha)
              </CardTitle>
              <XCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.absent}</div>
              <p className="text-xs text-muted-foreground">Pegawai</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters & Table */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Cari nama pegawai..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={unitFilter} onValueChange={setUnitFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Semua Unit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Semua Unit</SelectItem>
                  {units?.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama Pegawai</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Jam Masuk</TableHead>
                    <TableHead>Jam Pulang</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Bukti</TableHead>
                    <TableHead>Catatan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : filteredAttendances.length ? (
                    filteredAttendances.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {attendanceName(item)}
                        </TableCell>
                        <TableCell>
                          {item.staff?.unit?.name ||
                            item.teacher?.unit?.name ||
                            "-"}
                        </TableCell>
                        <TableCell>
                          {item.checkIn
                            ? safeFormat(new Date(item.checkIn), "HH:mm")
                            : "-"}
                        </TableCell>
                        <TableCell>
                          {item.checkOut
                            ? safeFormat(new Date(item.checkOut), "HH:mm")
                            : "-"}
                        </TableCell>
                        <TableCell>{getStatusBadge(item.status)}</TableCell>
                        <TableCell>
                          <PunchEvidence
                            name={attendanceName(item)}
                            records={item.records ?? []}
                          />
                        </TableCell>
                        <TableCell
                          className="max-w-[200px] truncate"
                          title={item.notes ?? undefined}
                        >
                          {item.notes || "-"}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Belum ada data absensi untuk tanggal ini
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
