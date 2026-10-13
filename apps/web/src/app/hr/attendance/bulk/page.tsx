"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MainLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  useStaffList,
  useBulkStaffAttendance,
  useUnits,
  STAFF_ATTENDANCE_STATUS_LABELS,
  StaffAttendanceStatus,
} from "@/hooks";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

const STATUS_OPTIONS: StaffAttendanceStatus[] = [
  StaffAttendanceStatus.PRESENT,
  StaffAttendanceStatus.LATE,
  StaffAttendanceStatus.SICK,
  StaffAttendanceStatus.LEAVE,
  StaffAttendanceStatus.ABSENT,
  StaffAttendanceStatus.REMOTE,
  StaffAttendanceStatus.DUTY,
];

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function BulkStaffAttendancePage() {
  const searchParams = useSearchParams();
  const [date, setDate] = useState(searchParams.get("date") || todayISO());
  const [unitFilter, setUnitFilter] = useState("");
  const [statuses, setStatuses] = useState<
    Record<string, StaffAttendanceStatus>
  >({});

  const { data: units } = useUnits();
  const { data: staffData, isLoading } = useStaffList({
    unitId: unitFilter || undefined,
  });
  const bulkAttendance = useBulkStaffAttendance();

  const staff = useMemo(() => staffData?.data ?? [], [staffData]);

  const setStatus = (staffId: string, status: StaffAttendanceStatus) =>
    setStatuses((prev) => ({ ...prev, [staffId]: status }));

  const markAllPresent = () =>
    setStatuses(
      Object.fromEntries(
        staff.map((s) => [s.id, StaffAttendanceStatus.PRESENT]),
      ),
    );

  const handleSave = async () => {
    const records = Object.entries(statuses).map(([staffId, status]) => ({
      staffId,
      status,
    }));
    if (!records.length) {
      toast.error("Belum ada status yang dipilih");
      return;
    }
    try {
      await bulkAttendance.mutateAsync({ date, records });
      toast.success(`${records.length} absensi disimpan`);
      setStatuses({});
    } catch {
      toast.error("Gagal menyimpan absensi massal");
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Absensi Massal
            </h1>
            <p className="text-muted-foreground">
              Tandai kehadiran seluruh pegawai untuk satu hari sekaligus
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={markAllPresent}>
              Tandai Semua Hadir
            </Button>
            <Button onClick={handleSave} disabled={bulkAttendance.isPending}>
              {bulkAttendance.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Simpan
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end">
              <div className="space-y-2">
                <Label htmlFor="bulk-date">Tanggal</Label>
                <Input
                  id="bulk-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-[180px]"
                />
              </div>
              <div className="space-y-2">
                <Label>Unit</Label>
                <Select value={unitFilter} onValueChange={setUnitFilter}>
                  <SelectTrigger className="w-[200px]">
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
              <Badge variant="secondary" className="mb-1">
                {Object.keys(statuses).length} dipilih
              </Badge>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama Pegawai</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Jabatan</TableHead>
                    <TableHead className="w-[200px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                      </TableCell>
                    </TableRow>
                  ) : staff.length ? (
                    staff.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">
                          {s.user.name}
                        </TableCell>
                        <TableCell>{s.unit?.name || "-"}</TableCell>
                        <TableCell>{s.position || "-"}</TableCell>
                        <TableCell>
                          <Select
                            value={statuses[s.id] || ""}
                            onValueChange={(v) =>
                              setStatus(s.id, v as StaffAttendanceStatus)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Pilih status" />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map((status) => (
                                <SelectItem key={status} value={status}>
                                  {STAFF_ATTENDANCE_STATUS_LABELS[status]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-8 text-center text-muted-foreground"
                      >
                        Tidak ada pegawai untuk filter ini
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
